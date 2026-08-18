/**
 * Legacy compatibility layer (P5/P9).
 *
 * - Keeps the old llm/stream caption bridge alive for direct text-only model
 *   selections (historical images, compaction, sessions created before the
 *   router model was adopted).
 * - Deprecates bin/apply-vision-patch.sh: it is never required and never
 *   auto-run; only used as an explicit legacy fallback.
 *
 * @module dsh-vision-bridge/compat
 */
import { messagesHaveImages } from '../lib/content.js';

/**
 * Register the legacy llm/stream caption bridge. All DSH coupling is via the
 * injected runtime (see adapters/dsh.js); this module touches no DSH API
 * directly.
 */
export function legacyCaptionBridge(ctx, config, runtime) {
	if (typeof ctx.on !== 'function' || !runtime.capabilities.stream) {
		runtime.log('legacy caption bridge skipped: llm/stream waterfall unavailable');
		return;
	}
	ctx.on('llm/stream', async function* (options, next) {
		try {
			if (config.mode === 'off') return yield* next();
			if (runtime.isInternal(options)) return yield* next();
			if (options.provider === config.routerProvider) return yield* next();
			if (!messagesHaveImages(options.messages)) return yield* next();
			if (await runtime.modelAcceptsImage(options.provider, options.model, options.signal)) {
				return yield* next();
			}
			const messages = await runtime.evidenceMessages(options.messages, {
				signal: options.signal,
				sessionId: options.sessionId
			});
			runtime.log('legacy caption bridge: 已将历史图像转为证据文本，继续由 '
				+ options.provider + '/' + options.model + ' 处理');
			return yield* runtime.stream({ ...options, messages });
		} catch (error) {
			runtime.log('legacy caption bridge 处理失败，放行原请求: ' + (error?.message ?? String(error)));
			return yield* next();
		}
	}, { global: true });
	runtime.log('legacy caption bridge 已注册（mode=' + config.mode + '）');
}

/** Emit a one-time deprecation notice for the old patch script. */
export function deprecatedPatchNotice(log) {
	log('注意: bin/apply-vision-patch.sh 已废弃且不再是运行前置条件。新架构通过 image-capable 虚拟 provider '
		+ '（vision-router/deepseek-v4-pro-vision）让官方图像准入直接通过，无需修改 DSH node_modules。'
		+ '该脚本仅保留为显式 legacy 兜底，默认关闭，绝不会自动运行。');
}

/** Probe legacy config shape for warnings (old mode names etc.). */
export function legacyConfigNotes(config, log) {
	if (config.mode === 'native') {
		log('检测到旧配置 mode=native（整轮路由 Qwen VL）。为获得最优延迟与成本，建议改用默认 mode=auto，'
			+ '并在模型选择中选用 vision-router / ' + config.routerModel + '（虚拟 image-capable 模型）。');
	}
}
