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
import { Config, normalizeLegacyConfig, listPresets, resolvePreset } from '../lib/config.js';
import { messagesHaveImages, collectImageRefs, transformMessages, imageBytes } from '../lib/content.js';
import { createCache, cacheKeyParts } from '../cache/cache.js';
import { createTelemetry } from '../telemetry/telemetry.js';
import { runOcr, removeTemp, writeTempImage, cropImage, resizeImage } from '../ocr/ocr.js';
import { captionImages, captionImage } from '../providers/vision.js';
import { decideRoute, estimateMessageTokens, lastUserText } from '../routing/policy.js';
import { renderCaption, renderOcrCaption, renderFailureCaption } from '../evidence/structured.js';
import { createLegacyBridgeHandler, deprecatedPatchNotice, legacyConfigNotes } from '../compat/legacy.js';

/** Probe which DSH capabilities are actually available (feature detection, not version checks). */
export function probeCapabilities(ctx) {
	const llm = ctx.get('llm');
	const attachments = ctx.get('attachments');
	const hasLlm = llm !== null && llm !== void 0 && typeof llm === 'object';
	const hasAttachments = attachments !== null && attachments !== void 0 && typeof attachments === 'object';
	return {
		llm: hasLlm
			&& typeof llm.stream === 'function' && typeof llm.registerAdapter === 'function',
		resolveModelInfo: hasLlm && typeof llm?.resolveModelInfo === 'function',
		registerConfigurableProviders: hasLlm && typeof llm?.registerConfigurableProviders === 'function',
		// OCR 只需要 readImage；saveImage 仅远程视觉预处理需要（缺失时回退原图直发）。
		attachments: hasAttachments && typeof attachments.readImage === 'function',
		attachmentsStore: hasAttachments
			&& typeof attachments.readImage === 'function' && typeof attachments.saveImage === 'function',
		stream: hasLlm && typeof llm?.stream === 'function',
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
	// 用 schemastery 补全所有默认值（无论 Cordis 是否已应用 schema），
	// 避免 localOcr/wholeTurn 等关键默认缺失导致 OCR 被跳过。
	const config = normalizeLegacyConfig(Config(rawConfig));
	const presets = listPresets(config);
	const presetFor = (model) => resolvePreset(config, model);
	const defaultPreset = presets[0];
	const visionConfigFor = (preset) => ({ ...config, visionProvider: preset.visionProvider, visionModel: preset.visionModel });
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
	// 服务按需解析（lazy）：插件可能在 attachments 服务就绪前被 apply，
	// 每次请求再取，避免「图像证据构建失败」被永久降级。
	// 不依赖 apply 时的探测快照：每次实时取服务并按能力校验，
	// 服务晚于插件加载时也能在后续请求中生效。
	const getLlm = () => {
		const l = ctx.get('llm');
		return l && typeof l === 'object' && typeof l.stream === 'function' ? l : null;
	};
	const getAttachments = () => {
		const a = ctx.get('attachments');
		return a && typeof a === 'object' && typeof a.readImage === 'function' ? a : null;
	};
	const stream = (request) => {
		internal.add(request);
		return getLlm().stream(request);
	};
	const resolveVisionInfo = async (provider, model, signal) => {
		try { return await getLlm().resolveModelInfo(provider, model, signal); } catch { return null; }
	};
	const modelAcceptsImage = async (provider, model, signal) => {
		const info = await resolveVisionInfo(provider, model, signal);
		return info?.inputModalities?.includes('image') === true;
	};

	/** Write/derive a stored vision ref: crop + adaptive resize before remote vision. */
	async function prepareDataForVision(data, mediaType, key, { signal, region, width, height }) {
		const att = getAttachments();
		if (!att || typeof att.saveImage !== 'function') return null;
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
			const newRef = await att.saveImage({
				data: new Uint8Array(bytes),
				mediaType: file === temp ? mediaType : 'image/jpeg'
			});
			return { ref: newRef, processedBytes: newRef.bytes };
		} finally {
			removeTemp(temp);
		}
	}

	async function prepareVisionRef(ref, opts) {
		const att = getAttachments();
		if (!att || typeof att.readImage !== 'function') return null;
		const stored = await att.readImage(ref, opts.signal);
		if (typeof att.saveImage !== 'function') {
			// 无 saveImage（服务未就绪/降级）：跳过裁剪/缩放，原图 ref 直发视觉引擎。
			return { ref, processedBytes: ref.bytes ?? 0 };
		}
		return prepareDataForVision(stored.data, ref.mediaType, String(ref.attachmentId), {
			signal: opts.signal,
			region: opts.region,
			width: ref.width,
			height: ref.height
		});
	}

	/** In-flight evidence builds keyed by cache key (P3.8 dedup). */
	const inflight = new Map();

	/**
	 * Build structured evidence for image refs: cache L1/L2 → local OCR →
	 * remote vision (batch + fallback chain) → fail-soft placeholder.
	 * Same-image concurrent requests share one in-flight build so the remote
	 * vision call is paid at most once per cache key.
	 */
	async function buildEvidence(refs, opts, preset = defaultPreset) {
		const vcfg = visionConfigFor(preset);
		const results = new Map();
		const pending = [];
		let ocrMs = 0;
		let visionMs = 0;
		let provider = '';
		let fallbackCount = 0;
		const keyFor = (id) => cacheKeyParts({
			attachmentId: id,
			model: preset.visionModel,
			promptVersion: config.promptVersion,
			schemaVersion: config.schemaVersion,
			kind: 'vision'
		});
		for (const ref of refs) {
			const id = String(ref.attachmentId);
			const key = keyFor(id);
			const cached = cache.get(key);
			// 失败缓存不复用：下次请求自动重试，避免「图像证据构建失败」被永久缓存。
			if (cached !== void 0 && cached.source !== 'failed') {
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
			const existing = inflight.get(key);
			if (existing !== void 0) {
				try {
					const entry = await existing;
					if (entry?.source === 'failed') {
						// 失败的 in-flight 构建不共享：移除后自行重试
						inflight.delete(key);
					} else {
						results.set(id, {
							entry,
							cacheHit: true,
							ocrMs: 0,
							visionMs: 0,
							provider: entry.provider ?? '',
							fallbackCount: 0
						});
						continue;
					}
				} catch {
					// in-flight 构建被拒绝：移除后自行重试（不再留下空结果）
					inflight.delete(key);
				}
			}
			// register the in-flight build before any async work so concurrent
			// requests with the same new image await the same build (P3.8)
			let resolveEntry;
			const entryPromise = new Promise((resolve) => { resolveEntry = resolve; });
			inflight.set(key, entryPromise);
			pending.push({ ref, id, key, needsVision: false, resolve: resolveEntry });
		}
		// OCR pass (parallel) — text-dense screenshots never touch remote vision
		const att = getAttachments();
		await Promise.all(pending.map(async (p) => {
			if (!config.localOcr || !att || typeof att.readImage !== 'function') return;
			const t0 = Date.now();
			try {
				const stored = await att.readImage(p.ref, opts.signal);
				const ocr = await runOcr(config, stored.data, p.ref, { signal: opts.signal, region: opts.region });
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
					cache.set(p.key, entry);
					p.resolve(entry);
					results.set(p.id, {
						entry,
						cacheHit: false,
						ocrMs: Date.now() - t0,
						visionMs: 0,
						provider: 'local-ocr',
						fallbackCount: 0
					});
					return;
				}
			} catch { /* OCR failed → remote vision */ }
			p.needsVision = true;
		}));
		const visionPending = pending.filter((p) => p.needsVision);
		if (visionPending.length > 0) {
			const prepared = [];
			const preparedKeys = [];
			for (const p of visionPending) {
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
					config: vcfg,
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
				for (const p of visionPending) {
					const res = batch.results.get(p.id);
					if (res === void 0) continue;
					const entry = res.source === 'failed'
						? {
							source: 'failed',
							text: renderFailureCaption(res.error ?? '识别失败'),
							provider: '',
							promptVersion: config.promptVersion,
							schemaVersion: config.schemaVersion,
							createdAtMs: Date.now()
						}
						: {
							source: res.source,
							text: renderCaption(vcfg, res.text, res.source),
							provider: res.provider,
							promptVersion: config.promptVersion,
							schemaVersion: config.schemaVersion,
							createdAtMs: Date.now()
						};
					cache.set(p.key, entry);
					p.resolve(entry);
					results.set(p.id, {
						entry,
						cacheHit: false,
						ocrMs,
						visionMs,
						provider: res.provider,
						fallbackCount: res.fallbackCount
					});
				}
			}
			for (const p of visionPending) {
				if (results.has(p.id)) continue;
				const entry = {
					source: 'failed',
					text: renderFailureCaption('附件/图像处理失败'),
					provider: '',
					promptVersion: config.promptVersion,
					schemaVersion: config.schemaVersion,
					createdAtMs: Date.now()
				};
				cache.set(p.key, entry);
				p.resolve(entry);
				results.set(p.id, { entry, cacheHit: false, ocrMs, visionMs, provider: '', fallbackCount });
			}
		}
		for (const p of pending) {
			if (!results.has(p.id) && typeof p.resolve === 'function') {
				const entry = {
					source: 'failed',
					text: renderFailureCaption('图像证据构建失败'),
					provider: '',
					promptVersion: config.promptVersion,
					schemaVersion: config.schemaVersion,
					createdAtMs: Date.now()
				};
				cache.set(p.key, entry);
				p.resolve(entry);
			}
		}
		if (inflight.size > 2048) inflight.clear();
		return { results, ocrMs, visionMs, provider, fallbackCount };
	}

	/** Replace image blocks in messages with rendered evidence text. */
	async function evidenceMessages(messages, opts, preset = defaultPreset) {
		const refs = collectImageRefs(messages);
		if (refs.length === 0) return messages;
		const { results } = await buildEvidence(refs, opts, preset);
		return transformMessages(messages, async (ref) => {
			const got = results.get(String(ref.attachmentId));
			return { type: 'text', text: got?.entry?.text ?? renderFailureCaption('图像证据缺失') };
		});
	}

	/** Whole-turn request: route the full request to the vision model. */
	function buildWholeTurnRequest(options, visionInfo, preset) {
		const out = { ...options, provider: preset.visionProvider, model: preset.visionModel };
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

	function backend(options, preset) {
		if (preset.deepseekProvider === config.routerProvider) {
			throw new Error('vision bridge: deepseekProvider 不能等于 routerProvider（' + config.routerProvider + '）');
		}
		return stream({ ...options, provider: preset.deepseekProvider, model: preset.deepseekModel });
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
				return listPresets(config).map((preset) => ({
					provider,
					id: preset.routerModel,
					name: preset.name,
					description: preset.description,
					inputModalities: ['text', 'image']
				}));
			},
			async resolveModel(provider, model, signal) {
				const preset = presetFor(model);
				const base = await resolveVisionInfo(preset.deepseekProvider, preset.deepseekModel, signal);
				const info = base ?? {};
				return {
					provider,
					id: model,
					name: preset.name,
					inputModalities: ['text', 'image'],
					...(info.context ? { context: info.context } : {}),
					...(info.reasoning ? { reasoning: info.reasoning } : {}),
					...(typeof info.defaultMaxTokens === 'number' ? { defaultMaxTokens: info.defaultMaxTokens } : {})
				};
			},
			async *stream(options) {
				const start = Date.now();
				const preset = presetFor(options.model);
				const rec = {
					mode: config.mode,
					route: 'backend',
					image_count: 0,
					input_bytes: 0,
					processed_bytes: 0,
					context_tokens: 0,
					total_ms: 0,
					cache_hit: false,
					provider: preset.deepseekProvider,
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
						const result = yield* backend(options, preset);
						finish();
						return result;
					}
					const hasImage = messagesHaveImages(options.messages);
					const refs = hasImage ? collectImageRefs(options.messages) : [];
					rec.image_count = refs.length;
					rec.input_bytes = imageBytes(refs);
					rec.context_tokens = estimateMessageTokens(options.messages);
					if (!hasImage) {
						const result = yield* backend(options, preset);
						finish();
						return result;
					}
					const visionInfo = await resolveVisionInfo(preset.visionProvider, preset.visionModel, options.signal);
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
						try {
							const rewritten = buildWholeTurnRequest(options, visionInfo, preset);
							rec.provider = preset.visionProvider;
							const result = yield* stream(rewritten);
							finish();
							return result;
						} catch (error) {
							log('vision bridge: 整轮路由失败，降级到证据路径: ' + (error?.message ?? String(error)));
							rec.route = 'evidence';
						}
					}
					const evidence = await buildEvidence(refs, {
						signal: options.signal,
						sessionId: options.sessionId,
						ownerText: lastUserText(options.messages)
					}, preset);
					rec.ocr_ms = evidence.ocrMs;
					rec.vision_ms = evidence.visionMs;
					rec.provider = evidence.provider || preset.deepseekProvider;
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
					const result = yield* backend({ ...options, messages }, preset);
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
		const llm = getLlm();
		if (!llm || typeof llm.registerAdapter !== 'function') throw new Error('llm service unavailable for router registration');
		const adapter = createRouterAdapter();
		const handle = llm.registerAdapter([config.routerProvider], adapter);
		let directory;
		if (caps.registerConfigurableProviders) {
			try {
				directory = llm.registerConfigurableProviders([{
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
		presetFor,
		defaultPreset,
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
			if (!config.localOcr) return null;
			return runOcr(config, data, ref, { signal: opts.signal, region });
		},
		/** ROI-first description: crop → OCR → (only if needed) ROI vision. */
		async describeRegion(data, ref, region, opts = {}) {
			const ocr = await runOcr(config, data, ref, { signal: opts.signal, region });
			if (ocr !== null && ocr.charCount >= config.ocrMinChars) {
				return { source: 'ocr', text: renderOcrCaption(ocr) };
			}
			const preset = runtime.defaultPreset ?? runtime.presetFor?.(config.routerModel);
			const vcfg = preset
				? { ...config, visionProvider: preset.visionProvider, visionModel: preset.visionModel }
				: config;
			try {
				const out = await runtime.prepareVisionRef(ref, { signal: opts.signal, region });
				if (out === null) return { source: 'failed', text: renderFailureCaption('vision unavailable') };
				const entry = await captionImage({
					config: vcfg,
					stream: runtime.stream,
					ref: out.ref,
					ownerText: opts.ownerText ?? '',
					signal: opts.signal,
					sessionId: opts.sessionId,
					resolveVisionInfo: runtime.resolveVisionInfo,
					log: runtime.log
				});
				return { source: 'vision', text: renderCaption(vcfg, entry.text, 'vision') };
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
			warn('DSH llm / attachments 服务启动时均不可用，将按需重试（dsh web 继续正常运行）');
		}
		if (!caps.llm) warn('DSH llm 服务启动时不可用，将按需重试（attachments 仍可用于本地 OCR）');
		const runtime = createRuntime(ctx, rawConfig, caps);
		deprecatedPatchNotice(runtime.log);
		legacyConfigNotes(runtime.config, runtime.log);
		if (runtime.config.mode === 'off') {
			runtime.log('mode=off：插件已禁用，dsh web 正常运行');
			return;
		}
		if (runtime.config.mode === 'auto' || runtime.config.mode === 'native') {
			const register = () => {
				try {
					runtime.registerRouter();
					runtime.log('已注册 image-capable 虚拟 provider: ' + runtime.config.routerProvider + ' / ' + runtime.config.routerModel
						+ '（mode=' + runtime.config.mode + '）');
					return true;
				} catch (error) {
					warn('注册 vision-router 暂不可用，稍后重试: ' + (error?.message ?? String(error)));
					return false;
				}
			};
			let registered = register();
			if (!registered) {
				// llm 服务可能晚于插件加载：轮询重试注册（20s 上限）
				let tries = 0;
				const timer = setInterval(() => {
					tries++;
					if (register()) clearInterval(timer);
					else if (tries >= 40) clearInterval(timer);
				}, 500);
				if (typeof timer.unref === 'function') timer.unref();
			}
		}
		try {
			if (typeof ctx.on === 'function') {
				ctx.on('llm/stream', createLegacyBridgeHandler(runtime.config, runtime), { global: true });
				runtime.log('legacy caption bridge 已注册（mode=' + runtime.config.mode + '）');
			} else {
				runtime.log('legacy caption bridge skipped: ctx.on unavailable');
			}
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