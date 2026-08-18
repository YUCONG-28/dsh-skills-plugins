import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { name, Config, apply } from '../lib/index.js';


const here = dirname(fileURLToPath(import.meta.url));
const FAKE_OCR = join(here, 'fixtures', 'fake-ocr.sh');
const MISSING_OCR = join(here, 'fixtures', 'does-not-exist-tool.sh');

const EVIDENCE_JSON = JSON.stringify({
	summary: '图里有一只猫',
	ocr: { full_text: 'CAT', lines: [{ text: 'CAT' }] },
	layout: { regions: [{ type: 'image', reading_order: 1, text: '猫' }] },
	semantics: { scene: 'cat', entities: [] },
	uncertainty: []
});
const BATCH_JSON = JSON.stringify([
	{ index: 0, summary: 'first' },
	{ index: 1, summary: 'second' }
]);

/** Build a mock DSH context (llm + attachments + logger + events). */
function makeMockCtx(opts = {}) {
	const backendCalls = [];
	const visionCalls = [];
	const fallbackCalls = [];
	const readCalls = [];
	const listeners = new Map();
	const provided = {};
	let adapterStore;
	let directoryStore;
	let storedCounter = 0;
	const stored = new Map();
	const logs = { info: [], warn: [], error: [], debug: [] };
	const logger = {
		info: (m) => logs.info.push(m),
		warn: (m) => logs.warn.push(m),
		error: (m) => logs.error.push(m),
		debug: (m) => logs.debug.push(m)
	};

	async function* backendStream(request) {
		backendCalls.push(request);
		yield { type: 'text-delta', index: 0, text: 'hello from deepseek' };
		yield { type: 'finish', reason: { kind: 'stop' } };
	}

	async function* visionStream(request) {
		visionCalls.push(request);
		if (opts.hangVision) {
			// Keep the event loop alive with a ref'd timer while the plugin's own
			// captionTimeoutMs (AbortSignal.timeout) is expected to abort first.
			await new Promise((_, reject) => {
				const timer = setTimeout(() => reject(new Error('hang fallback timer')), 100);
				request.signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('aborted by plugin timeout')); }, { once: true });
			});
			return;
		}
		if (opts.visionThrows) throw new Error('vision provider API failure');
		const content = request.messages?.[0]?.content ?? [];
		const imageCount = content.filter((b) => b?.type === 'image').length;
		const payload = imageCount > 1 ? BATCH_JSON : EVIDENCE_JSON;
		yield { type: 'text-delta', index: 0, text: payload };
		yield { type: 'finish', reason: { kind: 'stop' } };
	}

	async function* fallbackStream(request) {
		fallbackCalls.push(request);
		yield { type: 'text-delta', index: 0, text: EVIDENCE_JSON };
		yield { type: 'finish', reason: { kind: 'stop' } };
	}

	const llm = {
		stream: (request) => {
			if (request.provider === 'deepseek-official') return backendStream(request);
			if (request.provider === 'qwen') return visionStream(request);
			if (request.provider === 'fallback-provider') return fallbackStream(request);
			throw new Error('NO_ADAPTER: ' + request.provider + '/' + request.model);
		},
		registerAdapter: (providers, adapter) => { adapterStore = { providers, adapter }; return () => { adapterStore = void 0; }; },
		registerConfigurableProviders: (entries) => { directoryStore = entries; return () => { directoryStore = void 0; }; },
		resolveModelInfo: async (provider, model) => {
			if (provider === 'deepseek-official') {
				return { provider, id: model, name: 'DS', inputModalities: ['text'], context: { contextWindow: 128000 }, reasoning: { efforts: [{ id: 'off' }, { id: 'high' }] }, defaultMaxTokens: 8192 };
			}
			if (provider === 'qwen' || provider === 'fallback-provider') {
				return { provider, id: model, name: model, inputModalities: ['text', 'image'], context: { contextWindow: 131072 }, reasoning: { efforts: [{ id: 'off' }] } };
			}
			throw new Error('UNKNOWN_MODEL ' + provider + '/' + model);
		},
		listProviders: () => adapterStore ? [{ id: adapterStore.providers[0], name: 'DeepSeek + Vision Bridge' }] : []
	};

	const attachments = {
		readImage: async (ref) => { readCalls.push(String(ref.attachmentId)); return { ref, data: stored.get(String(ref.attachmentId)) ?? new Uint8Array([1, 2, 3]) }; },
		saveImage: async ({ data, mediaType }) => {
			const id = 'stored-' + (++storedCounter);
			const ref = { attachmentId: id, mediaType, bytes: data.length, width: 100, height: 100 };
			stored.set(id, data);
			return ref;
		}
	};

	const ctx = {
		get: (name) => (name === 'llm' ? llm : name === 'attachments' ? attachments : void 0),
		logger,
		on: (event, fn, opts2) => { const list = listeners.get(event) ?? []; list.push(fn); listeners.set(event, list); return () => { /* noop */ }; },
		provide: (name2, value) => { provided[name2] = value; }
	};
	return { ctx, backendCalls, visionCalls, fallbackCalls, readCalls, listeners, provided, logs, get adapterStore() { return adapterStore; }, get directoryStore() { return directoryStore; } };
}

const makeRef = (id) => ({ attachmentId: id, mediaType: 'image/png', bytes: 2048, width: 100, height: 100 });
const imageMsg = (id, text = '普通图片') => ({
	role: 'user',
	content: [{ type: 'text', text }, { type: 'image', attachment: makeRef(id) }]
});

function baseConfig(extra = {}) {
	return {
		mode: 'auto',
		routerProvider: 'vision-router',
		routerModel: 'deepseek-v4-pro-vision',
		deepseekProvider: 'deepseek-official',
		deepseekModel: 'deepseek-v4-pro',
		visionProvider: 'qwen',
		visionModel: 'qwen-vl-max',
		captionFormat: 'structured',
		strictJson: true,
		fallbackProviders: [],
		localOcr: true,
		ocrMinChars: 10,
		ocrScript: FAKE_OCR,
		cacheSize: 64,
		diskCacheSize: 32,
		cacheDir: mkdtempSync(join(tmpdir(), 'vb-apply-')),
		captionTimeoutMs: 2000,
		resizeMaxDim: 0,
		telemetry: 'off',
		strongVisualKeywords: ['图表'],
		wholeTurn: 'auto',
		nativeContextRatio: 0.8,
		...extra
	};
}

const texts = (content) => (content ?? []).filter((b) => b?.type === 'text').map((b) => b.text).join('\n');

async function consume(adapter, options) {
	const out = [];
	for await (const chunk of adapter.stream(options)) out.push(chunk);
	return out;
}

test('exports shape + fail-soft on unsupported DSH', () => {
	assert.equal(name, 'vision-bridge');
	assert.equal(typeof Config, 'function');
	assert.equal(typeof apply, 'function');
	const m = makeMockCtx();
	// unsupported: no llm, no attachments
	const bareCtx = { logger: m.ctx.logger, get: () => void 0, on: () => () => {}, provide: () => {} };
	assert.doesNotThrow(() => apply(bareCtx, baseConfig()));
	assert.ok(m.logs.warn.some((w) => w.includes('vision bridge disabled')));
});

test('apply registers image-capable vision-router adapter', async () => {
	const m = makeMockCtx();
	const cfg = baseConfig();
	apply(m.ctx, cfg);
	assert.ok(m.adapterStore !== void 0);
	assert.deepEqual(m.adapterStore.providers, ['vision-router']);
	const adapter = m.adapterStore.adapter;
	const models = await adapter.listModels('vision-router');
	assert.deepEqual(models[0].inputModalities, ['text', 'image']);
	const info = await adapter.resolveModel('vision-router', 'deepseek-v4-pro-vision');
	assert.deepEqual(info.inputModalities, ['text', 'image']);
	assert.equal(info.context.contextWindow, 128000);
	assert.ok(m.directoryStore !== void 0);
	assert.equal(m.provided.visionBridge.priority.join('>'), 'dom>accessibility>keyboard>local-ocr>roi-vision>full-vision');
	assert.ok(m.listeners.has('llm/stream'));
	rmSync(cfg.cacheDir, { recursive: true, force: true });
});

test('text request passes through to DeepSeek backend', async () => {
	const m = makeMockCtx();
	apply(m.ctx, baseConfig());
	const adapter = m.adapterStore.adapter;
	const options = { provider: 'vision-router', model: 'deepseek-v4-pro-vision', messages: [{ role: 'user', content: [{ type: 'text', text: '你好' }] }], signal: void 0 };
	const chunks = await consume(adapter, options);
	assert.equal(m.backendCalls.length, 1);
	assert.equal(m.backendCalls[0].provider, 'deepseek-official');
	assert.ok(chunks.some((c) => c.type === 'text-delta'));
	assert.equal(m.visionCalls.length, 0);
});

test('image request: OCR-first, evidence injected, no vision call', async () => {
	const m = makeMockCtx();
	const cfg = baseConfig();
	apply(m.ctx, cfg);
	const adapter = m.adapterStore.adapter;
	const options = { provider: 'vision-router', model: 'deepseek-v4-pro-vision', messages: [imageMsg('img-1')], signal: void 0 };
	await consume(adapter, options);
	assert.equal(m.visionCalls.length, 0);
	assert.equal(m.backendCalls.length, 1);
	const sent = m.backendCalls[0].messages[0].content;
	assert.ok(!sent.some((b) => b.type === 'image'));
	assert.match(texts(sent), /本地 OCR/);
	assert.equal(m.readCalls.length, 1);
});

test('cache hit: same attachment does not re-run OCR or vision', async () => {
	const m = makeMockCtx();
	const cfg = baseConfig({ visionModel: 'qwen-vl-max' });
	apply(m.ctx, cfg);
	const adapter = m.adapterStore.adapter;
	const options = { provider: 'vision-router', model: 'deepseek-v4-pro-vision', messages: [imageMsg('img-cache')], signal: void 0 };
	await consume(adapter, options);
	const readsAfterFirst = m.readCalls.length;
	await consume(adapter, { ...options, messages: [imageMsg('img-cache')] });
	assert.equal(m.readCalls.length, readsAfterFirst, 'second call must not read image bytes again');
	assert.equal(m.visionCalls.length, 0);
});

test('strong visual task routes whole turn to vision model', async () => {
	const m = makeMockCtx();
	apply(m.ctx, baseConfig());
	const adapter = m.adapterStore.adapter;
	const options = { provider: 'vision-router', model: 'deepseek-v4-pro-vision', messages: [imageMsg('img-strong', '帮我看看这张图表的数据')], signal: void 0, system: '你是一个助手' };
	await consume(adapter, options);
	const msg = options.messages[0];
	const vi = await m.ctx.get('llm').resolveModelInfo('qwen', 'qwen-vl-max');
	assert.equal(m.visionCalls.length, 1);
	assert.equal(m.backendCalls.length, 0);
	// system merged into first user message for pi-ai compat
	assert.equal(m.visionCalls[0].provider, 'qwen');
	assert.ok(m.visionCalls[0].messages[0].content[0].type === 'text');
});

test('vision fallback chain: primary fails -> fallback provider used', async () => {
	const m = makeMockCtx({ visionThrows: true });
	const cfg = baseConfig({
		ocrMinChars: 100000,
		fallbackProviders: [{ provider: 'fallback-provider', model: 'fallback-model' }]
	});
	apply(m.ctx, cfg);
	const adapter = m.adapterStore.adapter;
	await consume(adapter, { provider: 'vision-router', model: 'deepseek-v4-pro-vision', messages: [imageMsg('img-fb')], signal: void 0 });
	assert.ok(m.fallbackCalls.length >= 1);
	assert.equal(m.backendCalls.length, 1);
	assert.match(texts(m.backendCalls[0].messages[0].content), /本地 OCR|图像内容/);
});

test('vision timeout: hanging primary aborts -> fallback succeeds', async () => {
	const m = makeMockCtx({ hangVision: true });
	const cfg = baseConfig({
		ocrMinChars: 100000,
		captionTimeoutMs: 30,
		fallbackProviders: [{ provider: 'fallback-provider', model: 'fallback-model' }]
	});
	apply(m.ctx, cfg);
	const adapter = m.adapterStore.adapter;
	await consume(adapter, { provider: 'vision-router', model: 'deepseek-v4-pro-vision', messages: [imageMsg('img-timeout')], signal: void 0 });
	assert.ok(m.fallbackCalls.length >= 1, 'fallback should have been used after timeout');
	assert.equal(m.backendCalls.length, 1);
});

test('missing OCR tool: falls through to remote vision', async () => {
	const m = makeMockCtx();
	const cfg = baseConfig({ ocrScript: MISSING_OCR, ocrMinChars: 100000 });
	apply(m.ctx, cfg);
	const adapter = m.adapterStore.adapter;
	await consume(adapter, { provider: 'vision-router', model: 'deepseek-v4-pro-vision', messages: [imageMsg('img-no-ocr')], signal: void 0 });
	assert.ok(m.visionCalls.length >= 1);
	assert.equal(m.backendCalls.length, 1);
});

test('missing backend provider: error propagates but plugin stays loaded', async () => {
	const m = makeMockCtx();
	const cfg = baseConfig({ deepseekProvider: 'not-registered' });
	apply(m.ctx, cfg);
	assert.ok(m.adapterStore !== void 0);
	const adapter = m.adapterStore.adapter;
	await assert.rejects(consume(adapter, { provider: 'vision-router', model: 'deepseek-v4-pro-vision', messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }], signal: void 0 }), /NO_ADAPTER/);
});

test('invalid config rejected by schemastery', () => {
	assert.throws(() => Config({ mode: 'nope' }));
	assert.throws(() => Config({ cacheSize: 'many' }));
});


test('in-flight dedup: concurrent same-image requests share one vision call', async () => {
	const m = makeMockCtx();
	const cfg = baseConfig({ ocrMinChars: 100000 });
	apply(m.ctx, cfg);
	const adapter = m.adapterStore.adapter;
	const options = { provider: 'vision-router', model: 'deepseek-v4-pro-vision', messages: [imageMsg('img-dedup')], signal: void 0 };
	await Promise.all([consume(adapter, options), consume(adapter, { ...options, messages: [imageMsg('img-dedup')] })]);
	assert.equal(m.visionCalls.length, 1, 'remote vision must be paid exactly once for the same new image');
	assert.equal(m.backendCalls.length, 2);
});


test('ctx.visionBridge: ROI-first local OCR + describeRegion (P4)', async () => {
	const m = makeMockCtx();
	apply(m.ctx, baseConfig());
	const vb = m.provided.visionBridge;
	assert.ok(vb);
	const data = new Uint8Array([1, 2, 3]);
	const ref = { attachmentId: 'roi1', mediaType: 'image/png', bytes: 3, width: 10, height: 10 };
	const region = { x: 0, y: 0, w: 5, h: 5 };
	const ocr = await vb.ocrRegion(data, ref, region);
	assert.ok(ocr !== null);
	assert.match(ocr.text, /余额/);
	const described = await vb.describeRegion(data, ref, region);
	assert.equal(described.source, 'ocr');
	assert.match(described.text, /本地 OCR/);
});


test('telemetry: file mode records structured perf fields without secrets (P8)', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'vb-tel-'));
	const file = join(dir, 'tel.jsonl');
	try {
		const m = makeMockCtx();
		const cfg = baseConfig({ telemetry: 'file', telemetryFile: file });
		apply(m.ctx, cfg);
		const adapter = m.adapterStore.adapter;
		await consume(adapter, { provider: 'vision-router', model: 'deepseek-v4-pro-vision', messages: [{ role: 'user', content: [{ type: 'text', text: '你好' }] }], signal: void 0 });
		await consume(adapter, { provider: 'vision-router', model: 'deepseek-v4-pro-vision', messages: [imageMsg('tel-img')], signal: void 0 });
		const lines = readFileSync(file, 'utf8').trim().split('\n').filter(Boolean);
		assert.ok(lines.length >= 2);
		const records = lines.map((l) => JSON.parse(l));
		assert.ok(records.some((r) => r.route === 'backend'));
		assert.ok(records.some((r) => r.route === 'evidence'));
		for (const rec of records) {
			assert.equal(typeof rec.total_ms, 'number');
			assert.equal(rec.apiKey, undefined);
			assert.equal(rec.image_text, undefined);
			assert.equal(typeof rec.ts, 'string');
		}
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('API failure: vision stream error -> fail-soft placeholder, backend still runs', async () => {
	const m = makeMockCtx({ visionThrows: true });
	const cfg = baseConfig({ ocrMinChars: 100000, fallbackProviders: [] });
	apply(m.ctx, cfg);
	const adapter = m.adapterStore.adapter;
	await consume(adapter, { provider: 'vision-router', model: 'deepseek-v4-pro-vision', messages: [imageMsg('img-api-fail')], signal: void 0 });
	assert.equal(m.backendCalls.length, 1);
	assert.match(texts(m.backendCalls[0].messages[0].content), /图像内容/);
});