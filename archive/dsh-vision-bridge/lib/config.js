/**
 * Plugin configuration schema + legacy migration.
 *
 * P6: the schema is written exclusively with @deepseek-ai/schemastery — no
 * hand-rolled JSON-Schema unions anywhere.
 *
 * P9: the old key names (qwenProvider / qwenModel / maxTokens / ...) stay
 * readable; {@link normalizeLegacyConfig} maps them onto the new canonical
 * fields so existing cordis.yml files keep working unchanged.
 *
 * @module dsh-vision-bridge/config
 */
import z from '@deepseek-ai/schemastery';

/** Default strong-visual keywords that may route a turn whole to the vision model. */
export const DEFAULT_STRONG_VISUAL_KEYWORDS = [
	'chart', 'diagram', 'graph', 'plot', 'flowchart', 'architecture', 'map',
	'logo', 'ui', 'screenshot', 'photo', 'picture', 'image', 'poster', 'table',
	'ocr', 'transcribe', 'describe', '识别', '图', '表', '图表', '图片', '照片',
	'截图', '界面', '车牌', '表格', '流程', '架构', '图标', '海报'
];

/** Shared prompt/schema version markers (bump when prompts or evidence shape change). */
export const PROMPT_VERSION = 2;
export const SCHEMA_VERSION = 2;

/**
 * Legacy aliases still accepted: qwenProvider→visionProvider,
 * qwenModel→visionModel, maxTokens→captionMaxTokens.
 */
export const LEGACY_KEYS = {
	qwenProvider: 'visionProvider',
	qwenModel: 'visionModel',
	maxTokens: 'captionMaxTokens'
};

const mode = z.union([z.const('auto'), z.const('native'), z.const('caption'), z.const('off')]).default('auto');
const wholeTurn = z.union([z.const('auto'), z.const('never'), z.const('always')]).default('auto');
const captionFormat = z.union([z.const('structured'), z.const('prose')]).default('structured');
const telemetryMode = z.union([z.const('off'), z.const('log'), z.const('file')]).default('log');

const Config = z.object({
	/** Router mode: auto = evidence-first with conditional whole-turn; native = legacy whole-turn; caption = legacy text bridge; off = disable. */
	mode,
	/** Provider route of the virtual image-capable model. */
	routerProvider: z.string().default('vision-router'),
	/** Virtual model id exposed to the harness (declares text+image input). */
	routerModel: z.string().default('deepseek-v4-pro-vision'),
	/** Backend provider used for text rounds and evidence-injected rounds. */
	deepseekProvider: z.string().default('deepseek-official'),
	/** Backend DeepSeek model id. */
	deepseekModel: z.string().default('deepseek-v4-pro'),
	/** Primary vision provider (OpenAI-compatible, image-capable). */
	visionProvider: z.string().default('qwen'),
	/** Primary vision model id. */
	visionModel: z.string().default('qwen-vl-max'),
	/** Legacy alias of {@link visionProvider} (kept for backward compatibility). */
	qwenProvider: z.string().default('qwen'),
	/** Legacy alias of {@link visionModel}. */
	qwenModel: z.string().default('qwen-vl-max'),
	/** Virtual model id for the Flash tier. */
	flashRouterModel: z.string().default('deepseek-v4-flash-vision'),
	/** Backend DeepSeek model id for the Flash tier. */
	flashDeepseekModel: z.string().default('deepseek-v4-flash'),
	/** Primary vision model id for the Flash tier. */
	flashVisionModel: z.string().default('qwen3-vl-flash'),
	/** Which tier is listed first / used when no router model matches. */
	defaultTier: z.union([z.const('pro'), z.const('flash')]).default('flash'),
	/** Caption format used when evidence is injected as text. */
	captionFormat,
	/** structured mode: fail hard when the vision result is not evidence-shaped. */
	strictJson: z.boolean().default(true),
	/** Vision fallback chain, tried in order after the primary engine. */
	fallbackProviders: z.array(z.object({
		provider: z.string(),
		model: z.string()
	})).default([]),
	/** Vision caption max output tokens. */
	captionMaxTokens: z.number().step(1).min(1).max(65536).default(4096),
	/** Legacy alias of {@link captionMaxTokens}. */
	maxTokens: z.number().step(1).min(1).max(65536).default(4096),
	/** Vision caption sampling temperature. */
	temperature: z.number().min(0).max(2).default(0.2),
	/** Custom caption prompt (empty = built-in by captionFormat). */
	prompt: z.string().default(''),
	/** Whole-turn routing context budget ratio (0 = unlimited). */
	nativeContextRatio: z.number().min(0).max(1).default(0.8),
	/** Whole-turn policy: auto = strong-visual turns only; never = evidence-first always; always = every image turn. */
	wholeTurn,
	/** Local OCR first (Apple Vision, zero API cost). */
	localOcr: z.boolean().default(true),
	/** Local OCR is considered text-dense at this many characters (inclusive). */
	ocrMinChars: z.number().step(1).min(0).max(100000).default(40),
	/** Local OCR timeout in ms; 0 = none. */
	ocrTimeoutMs: z.number().step(1).min(0).max(600000).default(30000),
	/** Explicit OCR tool path; empty = auto (compiled binary then swift). */
	ocrScript: z.string().default(''),
	/** Memory cache (L1) entry cap. */
	cacheSize: z.number().step(1).min(0).default(256),
	/** Disk cache (L2) entry cap. */
	diskCacheSize: z.number().step(1).min(0).default(1024),
	/** Disk cache directory; empty = ~/.dsh/vision-bridge/cache. */
	cacheDir: z.string().default(''),
	/** Per-vision-call timeout in ms; 0 = none. */
	captionTimeoutMs: z.number().step(1).min(0).default(120000),
	/** Max edge for adaptive resize before a remote vision call; 0 = no resize. */
	resizeMaxDim: z.number().step(1).min(0).max(10000).default(1568),
	/** Keywords that mark a turn as a strong visual task (auto whole-turn). */
	strongVisualKeywords: z.array(z.string()).default(DEFAULT_STRONG_VISUAL_KEYWORDS),
	/** Structured performance telemetry mode. */
	telemetry: telemetryMode,
	/** Telemetry JSONL file; empty = ~/.dsh/vision-bridge-telemetry.jsonl. */
	telemetryFile: z.string().default(''),
	/** Prompt version marker for cache keys. */
	promptVersion: z.number().step(1).min(1).default(PROMPT_VERSION),
	/** Evidence schema version marker for cache keys. */
	schemaVersion: z.number().step(1).min(1).default(SCHEMA_VERSION)
});

export { Config };

/** Map legacy keys onto canonical fields; returns a new config object. */
export function normalizeLegacyConfig(config) {
	const out = { ...config };
	// Canonical wins; legacy aliases are synced so both spellings stay consistent.
	const explicitVisionProvider = config.visionProvider !== void 0 && config.visionProvider !== 'qwen';
	const explicitVisionModel = config.visionModel !== void 0 && config.visionModel !== 'qwen-vl-max';
	const explicitCaptionMaxTokens = config.captionMaxTokens !== void 0 && config.captionMaxTokens !== 4096;
	if (explicitVisionProvider) out.qwenProvider = out.visionProvider;
	else if (out.qwenProvider !== void 0) out.visionProvider = out.qwenProvider;
	if (explicitVisionModel) out.qwenModel = out.visionModel;
	else if (out.qwenModel !== void 0) out.visionModel = out.qwenModel;
	if (explicitCaptionMaxTokens) out.maxTokens = out.captionMaxTokens;
	else if (out.maxTokens !== void 0) out.captionMaxTokens = out.maxTokens;
	return out;
}

/** Build one tier preset from a normalized config. */
function buildPreset(config, tier) {
	if (tier === 'flash') {
		return {
			id: 'flash',
			routerModel: config.flashRouterModel ?? 'deepseek-v4-flash-vision',
			deepseekProvider: config.deepseekProvider,
			deepseekModel: config.flashDeepseekModel ?? 'deepseek-v4-flash',
			visionProvider: config.visionProvider,
			visionModel: config.flashVisionModel ?? 'qwen3-vl-flash',
			name: 'DeepSeek V4 Flash (Vision Bridge)',
			description: 'DeepSeek V4 Flash 文本 + 按需视觉代理（OCR/结构化证据优先，整轮路由仅用于强视觉任务）'
		};
	}
	return {
		id: 'pro',
		routerModel: config.routerModel ?? 'deepseek-v4-pro-vision',
		deepseekProvider: config.deepseekProvider,
		deepseekModel: config.deepseekModel ?? 'deepseek-v4-pro',
		visionProvider: config.visionProvider,
		visionModel: config.visionModel ?? 'qwen-vl-max',
		name: 'DeepSeek V4 Pro (Vision Bridge)',
		description: 'DeepSeek V4 Pro 文本 + 按需视觉代理（OCR/结构化证据优先，整轮路由仅用于强视觉任务）'
	};
}

/** Return both tiers in display order (default tier first). */
export function listPresets(config) {
	const pro = buildPreset(config, 'pro');
	const flash = buildPreset(config, 'flash');
	return config.defaultTier === 'flash' ? [flash, pro] : [pro, flash];
}

/** Resolve the preset for a selected router model; unknown models fall back to the default tier. */
export function resolvePreset(config, model) {
	const presets = listPresets(config);
	return presets.find((preset) => preset.routerModel === model) ?? presets[0];
}