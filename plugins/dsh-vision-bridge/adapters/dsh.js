/**
 * DSH adapter — the ONLY module that touches @deepseek-ai DSH runtime APIs
 * (ctx.llm, ctx.attachments, ctx.on, ctx.provide, agent/request events).
 *
 * P0/P1: registers an image-capable virtual provider route
 *   provider: vision-router / model: deepseek-v4-pro-vision
 * whose inputModalities include image, so official image admission passes
 * without any node_modules patch.
 *
 * P5: capability probing + fail-soft — a missing or changed DSH API only
 * disables the affected feature with a warning; dsh web always boots.
 *
 * @module dsh-vision-bridge/adapters
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { normalizeLegacyConfig } from '../lib/config.js';
import { messagesHaveImages, collectImageRefs, transformMessages, imageBytes } from '../lib/content.js';
import { createCache, cacheKeyParts } from '../cache/cache.js';
import { createTelemetry } from '../telemetry/telemetry.js';
import { runOcr, removeTemp, writeTempImage, cropImage, resizeImage } from '../ocr/ocr.js';
import { captionImages, captionImage } from '../providers/vision.js';
import { decideRoute, estimateMessageTokens, lastUserText } from '../routing/policy.js';
import { renderCaption, renderOcrCaption, renderFailureCaption } from '../evidence/structured.js';
import { legacyCaptionBridge, deprecatedPatchNotice, legacyConfigNotes } from '../compat/legacy.js';

/** Probe which DSH capabilities are actually available (feature detection, not version checks). */
export function probeCapabilities(ctx) {
	const llm = ctx.get('llm');
	const attachments = ctx.get('attachments');
	return {
		llm: llm !== void 0 && typeof llm === 'object'
			&& typeof llm.stream === 'function' && typeof llm.registerAdapter === 'function',
		resolveModelInfo: llm !== void 0 && typeof llm?.resolveModelInfo === 'function',
		registerConfigurableProviders: llm !== void 0 && typeof llm?.registerConfigurableProviders === 'function',
		attachments: attachments !== void 0 && typeof attachments === 'object'
			&& typeof attachments.readImage === 'function' && typeof attachments.saveImage === 'function',
		stream: llm !== void 0 && typeof llm?.stream === 'function',
		events: typeof ctx.on === 'function',
		provide: typeof ctx.provide === 'function'
	};
}

/**
 * Build the shared runtime: cache (L1+L2), telemetry, evidence pipeline and
 * internal-request marking. No DSH calls happen here directly except through
 * the injected ctx captured by closures.
 */
export function createRuntime(ctx, rawConfig, caps) {
	const config = normalizeLegacyConfig(rawConfig);
	const cacheDir = config.cacheDir && config.cacheDir.length > 0
		? config.cacheDir
		: join(homedir(), '.dsh', 'vision-bridge', 'cache');
	const cache = createCache({
		memorySize: config.cacheSize,
		diskDir: cacheDir,
		diskSize: config.diskCacheSize
	});
	const telemetry = createTelemetry({ mode: config.telemetry, file: config.telemetryFile, logger: ctx.logger });
	const internal = new WeakSet();
	const log = (message) => {
		try { ctx.logger?.info('vision bridge: ' + message); } catch { /* ignore */ }
	};
	const stream = (request) => {
		internal.add(request);
		return llmService.stream(request);
	};
	const resolveVisionInfo = async (provider, model, signal) => {
		try { return await llmService.resolveModelInfo(provider, model, signal); } catch { return null; }
	};
	const modelAcceptsImage = async (provider, model, signal) => {
		const info = await resolveVisionInfo(provider, model, signal);
		return info?.inputModalities?.includes('image') === true;
	};
	const llmService = caps.llm ? ctx.get('llm') : null;
	const attachments = caps.attachments ? ctx.get('attachments') : null;

	/** Write/derive a stored vision ref: crop + adaptive resize before remote vision. */
	async function prepareDataForVision(data, mediaType, key, { signal, region, width, height }) {
		if (!attachments) return null;
		const temp = writeTempImage(data, mediaType, key);
		try {
			let file = temp;
			if (region && region.w > 0 && region.h > 0) {
				const cropped = await cropImage(config, temp, region, signal);
				if (cropped !== null) {
					removeTemp(temp);
					file = cropped;
				}
			}
			if (config.resizeMaxDim > 0 && (width > config.resizeMaxDim || height > config.resizeMaxDim)) {
				const resized = await resizeImage(config, file, config.resizeMaxDim, signal);
				if (resized !== null) {
					if (file !== temp) removeTemp(file);
					file = resized;
				}
			}
			const bytes = file === temp ? data : readFileSync(file);
			const newRef = await attachments.saveImage({
				data: new Uint8Array(bytes),
				mediaType: file === temp ? mediaType : 'image/jpeg'
			});
			return { ref: newRef, processedBytes: newRef.bytes };
		} finally {
			removeTemp(temp);
		}
	}

	async function prepareVisionRef(ref, opts) {
		if (!attachments) return null;
		const stored = await attachments.readImage(ref, opts.signal);
		return prepareDataForVision(stored.data, ref.mediaType, String(ref.attachmentId), {
			signal: opts.signal,
			region: opts.region,
			width: ref.width,
			height: ref.height
		});
	}

	/**
	 * Build structured evidence for image refs: cache L1/L2 → local OCR →
	 * remote vision (batch + fallback chain) → fail-soft placeholder.
	 */
	async function buildEvidence(refs, opts) {
		const results = new Map();
		const pending = [];
		let ocrMs = 0;
		let visionMs = 0;
		let provider = '';
		let fallbackCount = 0;
		for (const ref of refs) {
			const id = String(ref.attachmentId);
			const key = cacheKeyParts({
				attachmentId: id,
				model: config.visionModel,
				promptVersion: config.promptVersion,
				schemaVersion: config.schemaVersion,
				kind: 'vision'
			});
			const cached = cache.get(key);
			if (cached !== void 0) {
				results.set(id, {
					entry: cached,
					cacheHit: true,
					ocrMs: 0,
					visionMs: 0,
					provider: cached.provider ?? '',
					fallbackCount: 0
				});
				continue;
			}
			if (config.localOcr && attachments) {
				const t0 = Date.now();
				try {
					const stored = await attachments.readImage(ref, opts.signal);
					const ocr = await runOcr(config, stored.data, ref, { signal: opts.signal, region: opts.region });
					ocrMs += Date.now() - t0;
					if (ocr !== null && ocr.charCount >= config.ocrMinChars) {
						const entry = {
							source: 'ocr',
							text: renderOcrCaption(ocr),
							ocrCharCount: ocr.charCount,
							provider: 'local-ocr',
							promptVersion: config.promptVersion,
							schemaVersion: config.schemaVersion,
							createdAtMs: Date.now()
						};
						cache.set(key, entry);
						results.set(id, {
							entry,
							cacheHit: false,
							ocrMs: Date.now() - t0,
							visionMs: 0,
							provider: 'local-ocr',
							fallbackCount: 0
						});
						continue;
					}
				} catch { /* OCR failed → remote vision */ }
			}
			pending.push({ ref, id, key });
		}
		if (pending.length > 0) {
			const prepared = [];
			const preparedKeys = [];
			for (const p of pending) {
				try {
					const out = await prepareVisionRef(p.ref, opts);
					if (out !== null) {
						prepared.push(out.ref);
						preparedKeys.push(p.id);
					}
				} catch { /* keep failed */ }
			}
			if (prepared.length > 0) {
				const batch = await captionImages({
					config,
					stream,
					refs: prepared,
					keys: preparedKeys,
					ownerText: opts.ownerText ?? '',
					signal: opts.signal,
					sessionId: opts.sessionId,
					resolveVisionInfo,
					log
				});
				visionMs += batch.visionMs;
				provider = batch.provider;
				fallbackCount += batch.fallbackCount;
				for (const p of pending) {
					const res = batch.results.get(p.id);
					if (res === void 0) continue;
					if (res.source === 'failed') {
						const entry = {
							source: 'failed',
							text: renderFailureCaption(res.error ?? '识别失败'),
							provider: '',
							promptVersion: config.promptVersion,
							schemaVersion: config.schemaVersion,
							createdAtMs: Date.now()
						};
						cache.set(p.key, entry);
						results.set(p.id, { entry, cacheHit: false, ocrMs, visionMs, provider: '', fallbackCount });
					} else {
						const entry = {
							source: res.source,
							text: renderCaption(config, res.text, res.source),
							provider: res.provider,
							promptVersion: config.promptVersion,
							schemaVersion: config.schemaVersion,
							createdAtMs: Date.now()
						};
						cache.set(p.key, entry);
						results.set(p.id, { entry, cacheHit: false, ocrMs, visionMs, provider: res.provider, fallbackCount: res.fallbackCount });
					}
				}
			}
			for (const p of pending) {
				if (!results.has(p.id)) {
					const entry = {
						source: 'failed',
						text: renderFailureCaption('附件/图像处理失败'),
						provider: '',
						promptVersion: config.promptVersion,
						schemaVersion: config.schemaVersion,
						createdAtMs: Date.now()
					};
					cache.set(p.key, entry);
					results.set(p.id, { entry, cacheHit: false, ocrMs, visionMs, provider: '', fallbackCount });
				}
			}
		}
		return { results, ocrMs, visionMs, provider, fallbackCount };
	}

	/** Replace image blocks in messages with rendered evidence text. */
	async function evidenceMessages(messages, opts) {
		const refs = collectImageRefs(messages);
		if (refs.length === 0) return messages;
		const { results } = await buildEvidence(refs, opts);
		return transformMessages(messages, async (ref) => {
			const got = results.get(String(ref.attachmentId));
			return { type: 'text', text: got?.entry?.text ?? renderFailureCaption('图像证据缺失') };
		});
	}

	/** Whole-turn request: route the full request to the vision model. */
	function buildWholeTurnRequest(options, visionInfo) {
		const out = { ...options, provider: config.visionProvider, model: config.visionModel };
		if (out.reasoningEffort !== void 0) {
			const offSupported = Array.isArray(visionInfo?.reasoning?.efforts)
				&& visionInfo.reasoning.efforts.some((e) => e?.id === 'off');
			if (!offSupported) delete out.reasoningEffort;
		}
		// pi-ai compat: some vision endpoints reject role 'developer'; merge the
		// system prompt into the first user message instead (matches legacy behavior).
		if (typeof out.system === 'string' && out.system.length > 0) {
			const systemText = out.system;
			out.system = void 0;
			out.messages = [
				{ role: 'user', content: [{ type: 'text', text: systemText }] },
				...out.messages
			];
		}
		return out;
	}

	function backend(options) {
		if (config.deepseekProvider === config.routerProvider) {
			throw new Error('vision bridge: deepseekProvider 不能等于 routerProvider（' + config.routerProvider + '）');
		}
		return stream({ ...options, provider: config.deepseekProvider, model: config.deepseekModel });
	}

	/** Duck-typed LlmAdapter (no @deepseek-ai/dsh-llm import → fail-soft by construction). */
	function createRouterAdapter() {
		return {
			providerInfo(provider) {
				return { id: provider, name: 'DeepSeek + Vision Bridge' };
			},
			providerRetryPolicy() {
				return void 0;
			},
			listModels(provider) {
				return [{
					provider,
					id: config.routerModel,
					name: 'DeepSeek V4 Pro (Vision Bridge)',
					description: 'DeepSeek 文本 + 按需视觉代理（OCR/结构化证据优先，整轮路由仅用于强视觉任务）',
					inputModalities: ['text', 'image']
				}];
			},
			async resolveModel(provider, model, signal) {
				const base = await resolveVisionInfo(config.deepseekProvider, config.deepseekModel, signal);
				const info = base ?? {};
				return {
					provider,
					id: model,
					name: 'DeepSeek V4 Pro (Vision Bridge)',
					inputModalities: ['text', 'image'],
					...(info.context ? { context: info.context } : {}),
					...(info.reasoning ? { reasoning: info.reasoning } : {}),
					...(typeof info.defaultMaxTokens === 'number' ? { defaultMaxTokens: info.defaultMaxTokens } : {})
				};
			},
			async *stream(options) {
				const start = Date.now();
				const rec = {
					mode: config.mode,
					route: 'backend',
					image_count: 0,
					input_bytes: 0,
					processed_bytes: 0,
					context_tokens: 0,
					total_ms: 0,
					cache_hit: false,
					provider: config.deepseekProvider,
					fallback_count: 0,
					ocr_ms: 0,
					vision_ms: 0
				};
				const finish = (error) => {
					rec.total_ms = Date.now() - start;
					if (error) rec.error = error?.code ?? error?.message ?? 'ERROR';
					telemetry.record(rec);
				};
				try {
					if (config.mode === 'off') {
						const result = yield* backend(options);
						finish();
						return result;
					}
					const hasImage = messagesHaveImages(options.messages);
					const refs = hasImage ? collectImageRefs(options.messages) : [];
					rec.image_count = refs.length;
					rec.input_bytes = imageBytes(refs);
					rec.context_tokens = estimateMessageTokens(options.messages);
					if (!hasImage) {
						const result = yield* backend(options);
						finish();
						return result;
					}
					const visionInfo = await resolveVisionInfo(config.visionProvider, config.visionModel, options.signal);
					const route = decideRoute({
						mode: config.mode,
						wholeTurn: config.wholeTurn,
						hasImage: true,
						messages: options.messages,
						visionAcceptsImage: visionInfo?.inputModalities?.includes('image') === true,
						contextWindow: visionInfo?.context?.contextWindow ?? 0,
						ratio: config.nativeContextRatio,
						keywords: config.strongVisualKeywords
					});
					rec.route = route;
					if (route === 'vision-whole-turn') {
						const rewritten = buildWholeTurnRequest(options, visionInfo);
						rec.provider = config.visionProvider;
						const result = yield* stream(rewritten);
						finish();
						return result;
					}
					const evidence = await buildEvidence(refs, {
						signal: options.signal,
						sessionId: options.sessionId,
						ownerText: lastUserText(options.messages)
					});
					rec.ocr_ms = evidence.ocrMs;
					rec.vision_ms = evidence.visionMs;
					rec.provider = evidence.provider || config.deepseekProvider;
					rec.fallback_count = evidence.fallbackCount;
					rec.cache_hit = evidence.results.size > 0
						&& [...evidence.results.values()].every((r) => r.cacheHit);
					rec.processed_bytes = refs.reduce((sum, ref) => {
						const got = evidence.results.get(String(ref.attachmentId));
						return sum + (got?.entry?.ocrCharCount ?? 0) * 4;
					}, 0);
					const messages = await transformMessages(options.messages, async (ref) => {
						const got = evidence.results.get(String(ref.attachmentId));
						return { type: 'text', text: got?.entry?.text ?? renderFailureCaption('图像证据缺失') };
					});
					const result = yield* backend({ ...options, messages });
					finish();
					return result;
				} catch (error) {
					finish(error);
					throw error;
				}
			}
		};
	}

	function registerRouter() {
		const adapter = createRouterAdapter();
		const handle = llmService.registerAdapter([config.routerProvider], adapter);
		let directory;
		if (caps.registerConfigurableProviders) {
			try {
				directory = llmService.registerConfigurableProviders([{
					provider: config.routerProvider,
					displayName: 'DeepSeek + Vision Bridge',
					settingsNs: 'vision-bridge',
					settingsPath: []
				}]);
			} catch { /* directory is optional */ }
		}
		return () => {
			try { handle(); } catch { /* ignore */ }
			if (directory !== void 0) { try { directory(); } catch { /* ignore */ } }
		};
	}

	return {
		config,
		cache,
		telemetry,
		internal,
		log,
		stream,
		resolveVisionInfo,
		modelAcceptsImage,
		isInternal: (request) => internal.has(request),
		buildEvidence,
		evidenceMessages,
		prepareVisionRef,
		registerRouter,
		capabilities: caps
	};
}

/** Provide ctx.visionBridge for Computer Use (ROI-first, P4). */
export function provideVisionBridgeService(ctx, config, runtime) {
	if (!runtime.capabilities.provide) return;
	ctx.provide('visionBridge', {
		/** Computer Use vision priority order (P4). */
		priority: ['dom', 'accessibility', 'keyboard', 'local-ocr', 'roi-vision', 'full-vision'],
		/** Local OCR on a region: returns {text, charCount, lineCount, lines} or null. */
		async ocrRegion(data, ref, region, opts = {}) {
			if (!runtime.capabilities.attachments || !config.localOcr) return null;
			return runOcr(config, data, ref, { signal: opts.signal, region });
		},
		/** ROI-first description: crop → OCR → (only if needed) ROI vision. */
		async describeRegion(data, ref, region, opts = {}) {
			const ocr = await runOcr(config, data, ref, { signal: opts.signal, region });
			if (ocr !== null && ocr.charCount >= config.ocrMinChars) {
				return { source: 'ocr', text: renderOcrCaption(ocr) };
			}
			if (!runtime.capabilities.attachments) {
				return { source: 'failed', text: renderFailureCaption('vision unavailable') };
			}
			try {
				const out = await runtime.prepareVisionRef(ref, { signal: opts.signal, region });
				if (out === null) return { source: 'failed', text: renderFailureCaption('vision unavailable') };
				const entry = await captionImage({
					config,
					stream: runtime.stream,
					ref: out.ref,
					ownerText: opts.ownerText ?? '',
					signal: opts.signal,
					sessionId: opts.sessionId,
					resolveVisionInfo: runtime.resolveVisionInfo,
					log: runtime.log
				});
				return { source: 'vision', text: renderCaption(config, entry.text, 'vision') };
			} catch (error) {
				return { source: 'failed', text: renderFailureCaption(error?.message ?? 'vision failed') };
			}
		}
	});
	runtime.log('已提供 ctx.visionBridge 服务（Computer Use ROI 优先）');
}

/**
 * Plugin entry: fail-soft apply. Never throws — any missing/changed DSH API
 * disables only the affected feature and logs a warning.
 */
export function apply(ctx, rawConfig) {
	const warn = (message) => {
		try { ctx.logger?.warn('vision bridge: ' + message); } catch { /* ignore */ }
	};
	try {
		const caps = probeCapabilities(ctx);
		if (!caps.llm && !caps.attachments) {
			warn('DSH llm / attachments 服务均不可用 → vision bridge disabled（dsh web 继续正常运行）');
			return;
		}
		if (!caps.llm) warn('DSH llm 服务不可用 → 路由/描述功能 disabled（attachments 仍可用于本地 OCR）');
		const runtime = createRuntime(ctx, rawConfig, caps);
		deprecatedPatchNotice(runtime.log);
		legacyConfigNotes(runtime.config, runtime.log);
		if (runtime.config.mode === 'off') {
			runtime.log('mode=off：插件已禁用，dsh web 正常运行');
			return;
		}
		if (caps.llm && (runtime.config.mode === 'auto' || runtime.config.mode === 'native')) {
			try {
				runtime.registerRouter();
				runtime.log('已注册 image-capable 虚拟 provider: ' + runtime.config.routerProvider + ' / ' + runtime.config.routerModel
					+ '（mode=' + runtime.config.mode + '）');
			} catch (error) {
				warn('注册 vision-router 失败（仅禁用路由功能）: ' + (error?.message ?? String(error)));
			}
		}
		try {
			legacyCaptionBridge(ctx, runtime.config, runtime);
		} catch (error) {
			warn('注册 legacy caption bridge 失败: ' + (error?.message ?? String(error)));
		}
		try {
			provideVisionBridgeService(ctx, runtime.config, runtime);
		} catch (error) {
			warn('提供 ctx.visionBridge 服务失败: ' + (error?.message ?? String(error)));
		}
		runtime.log('dsh-vision-bridge 加载完成（fail-soft: 任何能力缺失只降级，不阻断 dsh web 启动）');
	} catch (error) {
		warn('vision bridge 初始化失败 → disabled（dsh web 继续正常启动）: ' + (error?.message ?? String(error)));
	}
}