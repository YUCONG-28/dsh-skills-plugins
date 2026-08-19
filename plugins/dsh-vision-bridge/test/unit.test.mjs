import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Config, normalizeLegacyConfig, listPresets, resolvePreset, PROMPT_VERSION, SCHEMA_VERSION } from '../lib/config.js';
import { contentHasImage, messagesHaveImages, collectImageRefs, transformMessages, imageBytes } from '../lib/content.js';
import {
	isStructuredEvidence, extractStructuredJson, extractStructuredBatch,
	renderCaption, renderOcrCaption, effectivePrompt
} from '../evidence/structured.js';
import { decideRoute, estimateMessageTokens, isStrongVisual } from '../routing/policy.js';
import { createCache, cacheKeyParts } from '../cache/cache.js';
import { sanitizeTelemetry } from '../telemetry/telemetry.js';

const ref = (id, mediaType = 'image/png', bytes = 100) => ({
	attachmentId: id, mediaType, bytes, width: 100, height: 100
});
const imageBlock = (id) => ({ type: 'image', attachment: ref(id) });

test('Config: schemastery validation + defaults', () => {
	const cfg = Config({});
	assert.equal(cfg.mode, 'auto');
	assert.equal(cfg.routerProvider, 'vision-router');
	assert.equal(cfg.routerModel, 'deepseek-v4-pro-vision');
	assert.equal(cfg.deepseekProvider, 'deepseek-official');
	assert.equal(cfg.visionProvider, 'qwen');
	assert.equal(cfg.captionFormat, 'structured');
	assert.equal(cfg.cacheSize, 256);
	assert.equal(cfg.promptVersion, PROMPT_VERSION);
	assert.equal(cfg.schemaVersion, SCHEMA_VERSION);
	assert.throws(() => Config({ mode: 'bogus' }));
	assert.throws(() => Config({ cacheSize: -1 }));
});

test('Config: legacy keys migrate to canonical fields', () => {
	const cfg = Config({ qwenProvider: 'my-qwen', qwenModel: 'qwen3.7-flash', maxTokens: 8192, mode: 'native' });
	const norm = normalizeLegacyConfig(cfg);
	assert.equal(norm.visionProvider, 'my-qwen');
	assert.equal(norm.visionModel, 'qwen3.7-flash');
	assert.equal(norm.captionMaxTokens, 8192);
	const cfg2 = normalizeLegacyConfig(Config({ visionProvider: 'explicit', qwenProvider: 'legacy' }));
	assert.equal(cfg2.visionProvider, 'explicit');
	assert.equal(cfg2.qwenProvider, 'explicit');
});

test('Config: pro/flash presets expose both router models', () => {
	const cfg = Config({});
	const presets = listPresets(cfg);
	assert.equal(presets.length, 2);
	assert.equal(presets[0].id, 'flash'); // defaultTier=flash is listed first
	assert.equal(presets[0].routerModel, 'deepseek-v4-flash-vision');
	assert.equal(presets[0].deepseekModel, 'deepseek-v4-flash');
	assert.equal(presets[0].visionModel, 'qwen3-vl-flash');
	assert.equal(resolvePreset(cfg, 'deepseek-v4-pro-vision').id, 'pro');
	assert.equal(resolvePreset(cfg, 'deepseek-v4-flash-vision').id, 'flash');
	assert.equal(resolvePreset(cfg, 'unknown').id, 'flash');
});

test('content helpers walk nested tool results', () => {
	const nested = [{ type: 'tool-result', toolCallId: 't1', content: [imageBlock('a1')] }];
	assert.equal(contentHasImage(nested), true);
	const messages = [
		{ role: 'user', content: [{ type: 'text', text: 'hi' }] },
		{ role: 'user', content: [imageBlock('a1'), imageBlock('a2')] },
		{ role: 'tool', content: nested }
	];
	assert.equal(messagesHaveImages(messages), true);
	const refs = collectImageRefs(messages);
	assert.equal(refs.length, 2); // deduped by attachmentId
	assert.equal(imageBytes(refs), 200);
});

test('transformMessages replaces images with text', async () => {
	const messages = [{ role: 'user', content: [imageBlock('a1'), { type: 'text', text: 'x' }] }];
	const out = await transformMessages(messages, async (r) => ({ type: 'text', text: 'EVIDENCE:' + r.attachmentId }));
	assert.equal(out[0].content[0].type, 'text');
	assert.equal(out[0].content[0].text, 'EVIDENCE:a1');
	assert.equal(messagesHaveImages(out), false);
});

test('structured evidence: parse/extract/render', () => {
	const json = JSON.stringify({ summary: 's', ocr: { full_text: 'hello' }, uncertainty: [] });
	assert.equal(isStructuredEvidence(json), true);
	assert.equal(extractStructuredJson('prefix ' + json + ' suffix'), json);
	assert.equal(extractStructuredJson('{"summary":"x"}'), '{"summary":"x"}');
	assert.equal(extractStructuredJson('not json'), null);
	const batch = JSON.stringify([{ index: 0, summary: 'a' }, { index: 1, summary: 'b' }]);
	const parsed = extractStructuredBatch('```json\n' + batch + '\n```');
	assert.equal(parsed.length, 2);
	const cfg = Config({ captionFormat: 'structured', visionModel: 'qwen-vl-max' });
	const caption = renderCaption(cfg, json, 'vision');
	assert.match(caption, /概要：s/);
	assert.match(caption, /【文字】/);
	assert.match(caption, /hello/);
	const ocrCaption = renderOcrCaption({ text: 'line1\nline2' });
	assert.match(ocrCaption, /本地 OCR/);
	assert.match(ocrCaption, /line1/);
});

test('effectivePrompt: batch prompt for >1 images', () => {
	const cfg = Config({ captionFormat: 'structured' });
	const p = effectivePrompt(cfg, 3);
	assert.ok(p.includes('3'));
	assert.ok(!p.includes('{count}'));
});

test('routing policy: evidence-first default, whole-turn only for strong visual', () => {
	const messages = [{ role: 'user', content: [{ type: 'text', text: '帮我看看这张图表' }, imageBlock('a')] }];
	const strong = decideRoute({
		mode: 'auto', wholeTurn: 'auto', hasImage: true, messages,
		visionAcceptsImage: true, contextWindow: 131072, ratio: 0.8,
		keywords: ['图表', 'chart']
	});
	assert.equal(strong, 'vision-whole-turn');
	const plain = decideRoute({
		mode: 'auto', wholeTurn: 'auto', hasImage: true,
		messages: [{ role: 'user', content: [{ type: 'text', text: '你好' }, imageBlock('a')] }],
		visionAcceptsImage: true, contextWindow: 131072, ratio: 0.8, keywords: ['图表']
	});
	assert.equal(plain, 'evidence');
	const native = decideRoute({
		mode: 'native', wholeTurn: 'auto', hasImage: true, messages,
		visionAcceptsImage: true, contextWindow: 131072, ratio: 0.8, keywords: []
	});
	assert.equal(native, 'vision-whole-turn');
	const noVision = decideRoute({
		mode: 'auto', wholeTurn: 'auto', hasImage: true, messages,
		visionAcceptsImage: false, contextWindow: 131072, ratio: 0.8, keywords: ['图表']
	});
	assert.equal(noVision, 'evidence');
	assert.equal(decideRoute({ mode: 'auto', wholeTurn: 'auto', hasImage: false, messages: [], visionAcceptsImage: true, contextWindow: 1, ratio: 0.8, keywords: [] }), 'backend');
	assert.equal(isStrongVisual([{ role: 'user', content: [{ type: 'text', text: '截图识别' }] }], ['截图']), true);
});

test('cache: L1 + L2 + key parts', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'vb-cache-'));
	try {
		const key = cacheKeyParts({ attachmentId: 'img-1', model: 'qwen-vl-max', promptVersion: 2, schemaVersion: 2, kind: 'vision' });
		const cache = createCache({ memorySize: 4, diskDir: dir, diskSize: 16 });
		assert.equal(cache.get(key), undefined);
		cache.set(key, { source: 'vision', text: 'ev' });
		assert.equal(cache.get(key).text, 'ev');
		assert.ok(readdirSync(dir).some((f) => f.endsWith('.json')));
		assert.equal(cache.stats.hits, 1);
		assert.equal(cache.stats.misses, 1);
		const ocrKey = cacheKeyParts({ attachmentId: 'img-1', model: 'qwen-vl-max', promptVersion: 2, schemaVersion: 2, kind: 'ocr' });
		assert.notEqual(ocrKey, key);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('telemetry: whitelist keeps secrets out', () => {
	const raw = {
		route: 'evidence', ocr_ms: 12, vision_ms: 300, cache_hit: false,
		provider: 'qwen', fallback_count: 1, input_bytes: 100, processed_bytes: 50,
		context_tokens: 900, total_ms: 400, apiKey: 'sk-secret', image_text: 'sensitive'
	};
	const sanitized = sanitizeTelemetry(raw);
	assert.equal(sanitized.apiKey, undefined);
	assert.equal(sanitized.image_text, undefined);
	assert.equal(sanitized.route, 'evidence');
	assert.equal(sanitized.ocr_ms, 12);
	assert.ok(typeof sanitized.ts === 'string');
});