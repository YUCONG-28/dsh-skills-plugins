/**
 * dsh-computer-use —— 纯函数单测（node --test）
 * 覆盖 observations.js（observation 模型/TTL/引用/差异）与 grants.js
 * （read/control 租约、拒绝、一次性 confirmation token）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
	createObservation,
	isStale,
	elementByRef,
	diffObservations,
	renderDiff,
	renderTreeText,
	computeFingerprint,
	needsVision,
} from '../lib/observations.js'
import {
	createGrantStore,
	hasLease,
	grantLease,
	recordDenial,
	clearAgent,
	issueConfirmation,
	consumeConfirmation,
} from '../lib/grants.js'

// ---------------------------------------------------------------------------
// observations
// ---------------------------------------------------------------------------

const SAMPLE_APP = { pid: 42128, bundleId: 'com.apple.Safari', name: 'Safari' }
const SAMPLE_ELEMENTS = [
	{ path: '0', role: 'AXButton', title: '关闭', actions: ['AXPress'] },
	{ path: '0.1', role: 'AXTextField', title: '搜索', value: 'hello' },
]
const SAMPLE_WINDOWS = [
	{ axIndex: 0, title: '未命名', frame: { x: 0, y: 0, width: 800, height: 600 } },
]

test('createObservation 应用 TTL 并渲染 treeText', () => {
	const now = 1_000_000
	const obs = createObservation({ app: SAMPLE_APP, windows: SAMPLE_WINDOWS, elements: SAMPLE_ELEMENTS, ttlMs: 5000, screenshot: null }, now)
	assert.equal(obs.observedAt, now)
	assert.equal(obs.expiresAt, now + 5000)
	assert.ok(obs.observationId.startsWith('obs-'))
	assert.ok(obs.treeText.includes('Safari'))
	assert.ok(obs.treeText.includes('[0] AXButton "关闭"'))
	assert.ok(obs.treeText.includes('(clickable)'))
	assert.ok(obs.treeText.includes('[0.1] AXTextField "搜索" value="hello"'))
})

test('createObservation ttl=0 永不过期；isStale 判定正确', () => {
	const now = 1_000_000
	const forever = createObservation({ app: SAMPLE_APP, windows: [], elements: [], ttlMs: 0 }, now)
	const short = createObservation({ app: SAMPLE_APP, windows: [], elements: [], ttlMs: 1000 }, now)
	assert.equal(isStale(forever, now + 99999999), false)
	assert.equal(isStale(short, now + 1001), true)
	assert.equal(isStale(short, now + 999), false)
	assert.equal(isStale(null), true)
})

test('elementByRef 支持 index 与 handle（path）', () => {
	const obs = createObservation({ app: SAMPLE_APP, windows: [], elements: SAMPLE_ELEMENTS, ttlMs: 0 })
	assert.equal(elementByRef(obs, 0).path, '0')
	assert.equal(elementByRef(obs, '0.1').role, 'AXTextField')
	assert.equal(elementByRef(obs, 99), null)
	assert.equal(elementByRef(obs, 'nope'), null)
	assert.equal(elementByRef(obs, undefined), null)
})

test('diffObservations 正确报告 added/removed/changed', () => {
	const before = createObservation({ app: SAMPLE_APP, windows: [], elements: SAMPLE_ELEMENTS, ttlMs: 0 })
	const after = createObservation({
		app: SAMPLE_APP,
		windows: [],
		elements: [
			{ path: '0', role: 'AXButton', title: '关闭', actions: ['AXPress'] },
			{ path: '0.1', role: 'AXTextField', title: '搜索', value: 'world' },
			{ path: '2', role: 'AXButton', title: '新增' },
		],
		ttlMs: 0,
	})
	const diff = diffObservations(before, after)
	assert.deepEqual(diff.added.map((e) => e.path), ['2'])
	assert.deepEqual(diff.removed.map((e) => e.path), [])
	assert.equal(diff.changed.length, 1)
	assert.equal(diff.changed[0].path, '0.1')
	assert.equal(diff.changed[0].field, 'value')
	assert.equal(diff.changed[0].oldValue, 'hello')
	assert.equal(diff.changed[0].newValue, 'world')
	const text = renderDiff(diff)
	assert.ok(text.includes('+ [2]'))
	assert.ok(text.includes('value "hello" → "world"'))
})

test('maxNodesReached 渲染截断提示', () => {
	const obs = createObservation({ app: SAMPLE_APP, windows: [], elements: SAMPLE_ELEMENTS, ttlMs: 0, nodeCount: 2, maxNodesReached: true })
	assert.ok(renderTreeText(obs).includes('超出 maxNodes 上限'))
})

// ---------------------------------------------------------------------------
// grants
// ---------------------------------------------------------------------------

test('read/control 租约：授予、TTL 过期、拒绝后最终', () => {
	const store = createGrantStore()
	const now = 1_000_000
	assert.equal(hasLease(store, { agentId: 'a1', bundleId: 'com.x', scope: 'read', now }), false)
	grantLease(store, { agentId: 'a1', bundleId: 'com.x', scope: 'read', ttlMs: 0, now })
	assert.equal(hasLease(store, { agentId: 'a1', bundleId: 'com.x', scope: 'read', now: now + 9999999 }), true)
	assert.equal(hasLease(store, { agentId: 'a1', bundleId: 'com.x', scope: 'control', now }), false)
	grantLease(store, { agentId: 'a1', bundleId: 'com.x', scope: 'control', ttlMs: 1000, now })
	assert.equal(hasLease(store, { agentId: 'a1', bundleId: 'com.x', scope: 'control', now: now + 1001 }), false)
	assert.equal(hasLease(store, { agentId: 'a1', bundleId: 'com.x', scope: 'control', now: now + 500 }), true)
	recordDenial(store, { agentId: 'a1', bundleId: 'com.x', scope: 'control', now })
	assert.equal(hasLease(store, { agentId: 'a1', bundleId: 'com.x', scope: 'control', now }), false)
	assert.equal(hasLease(store, { agentId: 'a1', bundleId: 'com.x', scope: 'read', now }), true)
	clearAgent(store, 'a1')
	assert.equal(hasLease(store, { agentId: 'a1', bundleId: 'com.x', scope: 'read', now }), false)
})

test('confirmation token：一次性、TTL、绑定校验', () => {
	const store = createGrantStore()
	const now = 1_000_000
	const token = issueConfirmation(store, {
		agentId: 'a1', bundleId: 'com.x', observationId: 'obs-1', path: '0.3', action: 'computer_type_text',
		ttlMs: 1000, now,
	})
	assert.equal(typeof token, 'string')
	// 绑定匹配 → 成功且一次性
	let r = consumeConfirmation(store, { token, agentId: 'a1', bundleId: 'com.x', observationId: 'obs-1', path: '0.3', action: 'computer_type_text', now })
	assert.equal(r.ok, true)
	r = consumeConfirmation(store, { token, agentId: 'a1', bundleId: 'com.x', observationId: 'obs-1', path: '0.3', action: 'computer_type_text', now })
	assert.equal(r.ok, false)
	assert.equal(r.error.code, 'COMPUTER_CONFIRMATION_INVALID')

	// 绑定不匹配 → 失败并删除
	const token2 = issueConfirmation(store, { agentId: 'a1', bundleId: 'com.x', observationId: 'obs-1', path: '0.3', action: 'computer_type_text', ttlMs: 1000, now })
	r = consumeConfirmation(store, { token: token2, agentId: 'a1', bundleId: 'com.x', observationId: 'obs-2', path: '0.3', action: 'computer_type_text', now })
	assert.equal(r.ok, false)
	assert.equal(r.error.code, 'COMPUTER_CONFIRMATION_BINDING')

	// TTL 过期
	const token3 = issueConfirmation(store, { agentId: 'a1', bundleId: 'com.x', observationId: 'obs-1', path: null, action: null, ttlMs: 1000, now })
	r = consumeConfirmation(store, { token: token3, agentId: 'a1', bundleId: 'com.x', observationId: 'obs-1', now: now + 2000 })
	assert.equal(r.ok, false)
	assert.equal(r.error.code, 'COMPUTER_CONFIRMATION_EXPIRED')

	// agent 不匹配
	const token4 = issueConfirmation(store, { agentId: 'a1', bundleId: 'com.x', observationId: 'obs-1', path: null, action: null, ttlMs: 1000, now })
	r = consumeConfirmation(store, { token: token4, agentId: 'a2', bundleId: 'com.x', observationId: 'obs-1', now })
	assert.equal(r.ok, false)
	assert.equal(r.error.code, 'COMPUTER_CONFIRMATION_BINDING')
})

test('clearAgent 清理该 agent 的 token', () => {
	const store = createGrantStore()
	const token = issueConfirmation(store, { agentId: 'a1', bundleId: 'com.x', observationId: 'obs-1', ttlMs: 1000 })
	clearAgent(store, 'a1')
	const r = consumeConfirmation(store, { token, agentId: 'a1', bundleId: 'com.x', observationId: 'obs-1' })
	assert.equal(r.ok, false)
})

// ---------------------------------------------------------------------------
// state fingerprint（Phase 4）
// ---------------------------------------------------------------------------

test('computeFingerprint：坐标变化不改变指纹，文本变化改变', () => {
	const base = createObservation({ app: SAMPLE_APP, windows: SAMPLE_WINDOWS, elements: SAMPLE_ELEMENTS, ttlMs: 0 })
	const moved = createObservation({
		app: SAMPLE_APP, windows: SAMPLE_WINDOWS,
		elements: SAMPLE_ELEMENTS.map((el) => ({ ...el, frame: { x: 999, y: 999 } })),
		ttlMs: 0,
	})
	const textChanged = createObservation({
		app: SAMPLE_APP, windows: SAMPLE_WINDOWS,
		elements: SAMPLE_ELEMENTS.map((el, i) => (i === 1 ? { ...el, value: 'world' } : el)),
		ttlMs: 0,
	})
	const f1 = computeFingerprint(base)
	const f2 = computeFingerprint(moved)
	const f3 = computeFingerprint(textChanged)
	assert.equal(f1.axTreeHash, f2.axTreeHash)
	assert.notEqual(f1.axTreeHash, f3.axTreeHash)
})

test('needsVision：稳定状态不需要截图，文本变化需要', () => {
	const base = createObservation({ app: SAMPLE_APP, windows: SAMPLE_WINDOWS, elements: SAMPLE_ELEMENTS, ttlMs: 0 })
	const same = createObservation({ app: SAMPLE_APP, windows: SAMPLE_WINDOWS, elements: SAMPLE_ELEMENTS, ttlMs: 0 })
	assert.equal(needsVision(computeFingerprint(base), computeFingerprint(same)).needsVision, false)
	const changed = createObservation({
		app: SAMPLE_APP, windows: SAMPLE_WINDOWS,
		elements: SAMPLE_ELEMENTS.map((el, i) => (i === 1 ? { ...el, value: 'completely different' } : el)),
		ttlMs: 0,
	})
	assert.equal(needsVision(computeFingerprint(base), computeFingerprint(changed)).needsVision, true)
})
