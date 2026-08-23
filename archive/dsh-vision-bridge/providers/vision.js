/**
 * Remote vision caption providers: primary engine + fallback chain, timeout,
 * strict-JSON retry and multi-image batch (P3.9/P3.10).
 *
 * No DSH imports here: the adapter injects `stream` (wraps ctx.llm.stream and
 * marks internal requests) and `resolveVisionInfo` (ctx.llm.resolveModelInfo
 * wrapper).
 *
 * @module dsh-vision-bridge/providers
 */
import { effectivePrompt, extractStructuredJson, extractStructuredBatch, isStructuredEvidence } from '../evidence/structured.js';

/** Combine caller signal + per-call timeout into one signal (or undefined). */
export function captionSignal(config, signal) {
	const signals = [];
	if (signal !== void 0) signals.push(signal);
	if ((config?.captionTimeoutMs ?? 0) > 0) signals.push(AbortSignal.timeout(config.captionTimeoutMs));
	if (signals.length === 0) return void 0;
	return signals.length === 1 ? signals[0] : AbortSignal.any(signals);
}

/** Minimal chunk collector: text deltas + finish + usage. No DSH imports. */
export async function collectText(chunks) {
	let text = '';
	let usage;
	let finish;
	for await (const chunk of chunks) {
		switch (chunk.type) {
			case 'text-delta':
				text += chunk.text ?? '';
				break;
			case 'usage':
				usage = chunk.usage;
				break;
			case 'finish':
				finish = chunk.reason;
				break;
			default:
				break;
		}
	}
	if (finish?.kind === 'error' || finish?.kind === 'aborted') {
		const failure = finish.failure ?? {};
		throw new Error('vision stream ' + finish.kind + ': ' + (failure.code ?? '?') + ' ' + (failure.message ?? ''));
	}
	return { text: text.trim(), usage };
}

/** Build one vision caption request (single image). */
function singleRequest({ config, engine, ref, ownerText, prompt, signal, sessionId, disableThinking }) {
	const content = [
		{ type: 'image', attachment: ref },
		{ type: 'text', text: ownerText.length > 0 ? prompt + '\n\n用户当前消息内容：' + ownerText : prompt }
	];
	return {
		provider: engine.provider,
		model: engine.model,
		messages: [{ role: 'user', content }],
		maxTokens: config.captionMaxTokens ?? config.maxTokens ?? 4096,
		temperature: config.temperature ?? 0.2,
		...(disableThinking ? { reasoningEffort: 'off' } : {}),
		signal: captionSignal(config, signal),
		...(sessionId !== void 0 ? { sessionId } : {})
	};
}

/** Build one multi-image batch request. */
function batchRequest({ config, engine, refs, ownerText, prompt, signal, sessionId, disableThinking }) {
	const content = [
		...refs.map((ref) => ({ type: 'image', attachment: ref })),
		{ type: 'text', text: ownerText.length > 0 ? prompt + '\n\n用户当前消息内容：' + ownerText : prompt }
	];
	return {
		provider: engine.provider,
		model: engine.model,
		messages: [{ role: 'user', content }],
		maxTokens: config.captionMaxTokens ?? config.maxTokens ?? 8192,
		temperature: config.temperature ?? 0.2,
		...(disableThinking ? { reasoningEffort: 'off' } : {}),
		signal: captionSignal(config, signal),
		...(sessionId !== void 0 ? { sessionId } : {})
	};
}

/** Run one engine call and return raw text (strictJson retry inside). */
async function runEngineCall({ config, stream, engine, request, structured }) {
	const { text } = await collectText(stream(request));
	if (!structured || !config.strictJson) return text;
	const extracted = extractStructuredJson(text);
	if (extracted !== null) return extracted;
	// strict retry with reinforced JSON-only prompt
	const lastBlock = request.messages[request.messages.length - 1].content.at(-1);
	const retryPrompt = lastBlock.text + '\n\n（注意：必须只输出一个 JSON 对象，不要任何其他文字）';
	const retried = await collectText(stream({
		...request,
		messages: [{
			role: 'user',
			content: [
				{ type: 'image', attachment: request.messages[0].content[0].attachment },
				{ type: 'text', text: retryPrompt }
			]
		}]
	}));
	const extractedRetry = extractStructuredJson(retried.text);
	if (extractedRetry !== null) return extractedRetry;
	throw new Error('vision engine ' + engine.provider + '/' + engine.model + ' 识别结果不是结构化 JSON（strictJson）: ' + retried.text.slice(0, 200));
}

/**
 * Caption one image through the fallback chain.
 * @returns {Promise<{source:'vision', text:string, provider:string, fallbackCount:number, visionMs:number}>}
 */
export async function captionImage({ config, stream, ref, ownerText, signal, sessionId, resolveVisionInfo, log }) {
	const chain = [
		{ provider: config.visionProvider, model: config.visionModel },
		...(Array.isArray(config.fallbackProviders) ? config.fallbackProviders : [])
	];
	const startedAt = Date.now();
	let lastError;
	for (let index = 0; index < chain.length; index++) {
		const engine = chain[index];
		try {
			let disableThinking = false;
			if (resolveVisionInfo !== void 0) {
				const info = await resolveVisionInfo(engine.provider, engine.model, signal);
				disableThinking = Array.isArray(info?.reasoning?.efforts)
					&& info.reasoning.efforts.some((e) => e?.id === 'off');
			}
			const prompt = effectivePrompt(config, 1);
			const request = singleRequest({ config, engine, ref, ownerText, prompt, signal, sessionId, disableThinking });
			const text = await runEngineCall({ config, stream, engine, request, structured: config.captionFormat === 'structured' });
			if (log) log('vision 识别尝试 ' + (index + 1) + '/' + chain.length + ': ' + engine.provider + '/' + engine.model + ' 成功（' + (Date.now() - startedAt) + 'ms）');
			return {
				source: 'vision',
				text,
				provider: engine.provider,
				fallbackCount: index,
				visionMs: Date.now() - startedAt
			};
		} catch (error) {
			if (log) log('vision 识别尝试 ' + (index + 1) + '/' + chain.length + ': ' + engine.provider + '/' + engine.model + ' 失败: ' + (error?.message ?? String(error).slice(0, 200)));
			lastError = error;
		}
	}
	throw lastError ?? new Error('vision chain exhausted');
}

/**
 * Caption multiple images, preferring one batched call (P3.9), then
 * per-image fallback for anything the batch missed.
 */
export async function captionImages({ config, stream, refs, keys, ownerText, signal, sessionId, resolveVisionInfo, log }) {
	const results = new Map();
	const idFor = (i) => keys?.[i] ?? String(refs[i].attachmentId);
	let provider = config.visionProvider;
	let fallbackCount = 0;
	const startedAt = Date.now();
	if (refs.length > 1) {
		const chain = [
			{ provider: config.visionProvider, model: config.visionModel },
			...(Array.isArray(config.fallbackProviders) ? config.fallbackProviders : [])
		];
		for (let index = 0; index < chain.length; index++) {
			const engine = chain[index];
			let disableThinking = false;
			if (resolveVisionInfo !== void 0) {
				try {
					const info = await resolveVisionInfo(engine.provider, engine.model, signal);
					disableThinking = Array.isArray(info?.reasoning?.efforts)
						&& info.reasoning.efforts.some((e) => e?.id === 'off');
				} catch { /* keep default */ }
			}
			try {
				const prompt = effectivePrompt(config, refs.length);
				const request = batchRequest({ config, engine, refs, ownerText, prompt, signal, sessionId, disableThinking });
				const { text } = await collectText(stream(request));
				const parsed = extractStructuredBatch(text);
				const byIndex = new Map();
				for (const entry of parsed ?? []) {
					if (typeof entry.index === 'number' && refs[entry.index] !== void 0) {
						byIndex.set(entry.index, JSON.stringify(entry));
					}
				}
				for (let i = 0; i < refs.length; i++) {
					const entryText = byIndex.get(i);
					if (entryText !== void 0 && isStructuredEvidence(entryText)) {
						results.set(idFor(i), {
							source: 'vision',
							text: entryText,
							provider: engine.provider,
							fallbackCount: index,
							visionMs: Date.now() - startedAt
						});
					}
				}
				if (results.size === refs.length) {
					if (log) log('vision batch ' + refs.length + ' 张一次调用成功（' + engine.provider + '/' + engine.model + '）');
					break;
				}
			} catch (error) {
				fallbackCount = index + 1;
				if (log) log('vision batch ' + engine.provider + '/' + engine.model + ' 失败: ' + (error?.message ?? String(error).slice(0, 200)));
			}
		}
	}
	// per-image fallback for refs the batch did not cover
	const missing = refs.map((ref, i) => ({ ref, id: idFor(i), index: i })).filter((item) => !results.has(item.id));
	for (const item of missing) {
		try {
			const entry = await captionImage({ config, stream, ref: item.ref, ownerText, signal, sessionId, resolveVisionInfo, log });
			entry.fallbackCount += fallbackCount;
			results.set(item.id, entry);
			provider = entry.provider;
		} catch (error) {
			if (log) log('vision 单图 ' + item.id + ' 全部失败: ' + (error?.message ?? String(error).slice(0, 200)));
			results.set(item.id, { source: 'failed', error: error?.message ?? 'vision failed', provider: '', fallbackCount: 0, visionMs: 0 });
		}
	}
	return {
		results,
		provider,
		fallbackCount,
		visionMs: Date.now() - startedAt
	};
}