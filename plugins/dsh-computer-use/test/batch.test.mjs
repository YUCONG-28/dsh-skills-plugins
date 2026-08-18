/**
 * dsh-computer-use —— computer_batch 批量执行单测（mock deps）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createBatchExecutor } from '../lib/batch.js'
import { ComputerUseError } from '../lib/helper.js'

const OBS = {
	observationId: 'obs-1',
	app: { pid: 100, bundleId: 'com.apple.TextEdit', name: 'TextEdit' },
	elements: [
		{ path: '0', role: 'AXTextArea' },
		{ path: '0.1', role: 'AXButton', title: 'Save' },
	],
}

function makeDeps(overrides = {}) {
	const calls = []
	const deps = {
		runHelper: async (command, args) => {
			calls.push({ command, args })
			return { ok: true }
		},
		_runHelperWrapper: async (command, args, inner) => {
			calls.push({ command, args })
			return inner ? inner(command, args) : { ok: true }
		},
		ComputerUseError,
		requireObservation: () => OBS,
		ensureControl: async () => {},
		requireConfirmation: () => { deps.confirmed = (deps.confirmed ?? 0) + 1 },
		resolveElementRef: (obs, ref) => {
			if (typeof ref.handle === 'string') return { path: ref.handle, role: 'AXButton', title: '' }
			if (typeof ref.index === 'number') return obs.elements[ref.index] ?? null
			return null
		},
		reobserve: async () => ({ observationId: 'obs-2', app: OBS.app, elements: OBS.elements, treeText: '' }),
		diffObservations: () => ({ added: [], removed: [], changed: [] }),
		appIdentity: (obs) => obs.app.bundleId,
		config: { interaction: { keyboardPolicy: 'preserve', focusPolicy: 'preserve' }, actionTimeoutMs: 5000 },
		PACKAGE_ROOT: '/tmp',
		...overrides,
	}
	deps.calls = calls
	// 让 overrides 的 runHelper 也记录调用
	if (overrides.runHelper) {
		const inner = overrides.runHelper
		deps.runHelper = async (command, args) => {
			calls.push({ command, args })
			return inner(command, args)
		}
	}
	return deps
}

const exec = { agent: { id: 'a1' }, callId: 'c1', signal: undefined }

test('批量 3 动作全部执行，helper 调用顺序正确', async () => {
	const deps = makeDeps()
	const { runBatch } = createBatchExecutor(deps)
	const r = await runBatch(exec, {
		observationId: 'obs-1',
		actions: [
			{ action: 'click', handle: '0.1' },
			{ action: 'type', text: 'hello' },
			{ action: 'press', key: 'return' },
		],
	})
	assert.equal(r.actionsTotal, 3)
	assert.equal(r.actionsExecuted, 3)
	assert.equal(r.failed, null)
	assert.deepEqual(deps.calls.map((c) => c.command), ['click', 'type-text', 'press-key'])
	// 含 type（敏感）→ 需要确认
	assert.equal(deps.confirmed, 1)
	// 一次验证：reobserve 一次
	assert.equal(r.observation.observationId, 'obs-2')
})

test('无敏感动作时不需要确认', async () => {
	const deps = makeDeps()
	const { runBatch } = createBatchExecutor(deps)
	await runBatch(exec, {
		observationId: 'obs-1',
		actions: [
			{ action: 'click', handle: '0.1' },
			{ action: 'scroll', direction: 'down', amount: 2 },
			{ action: 'wait', ms: 10 },
		],
	})
	assert.equal(deps.confirmed, undefined)
})

test('带 command 的 press 视为敏感', async () => {
	const deps = makeDeps()
	const { runBatch } = createBatchExecutor(deps)
	await runBatch(exec, {
		observationId: 'obs-1',
		actions: [{ action: 'press', key: 'n', modifiers: ['command'] }],
	})
	assert.equal(deps.confirmed, 1)
})

test('第 2 个动作失败 → 停止并返回失败点', async () => {
	const deps = makeDeps({
		runHelper: async (command) => {
			if (command === 'type-text') throw new ComputerUseError('COMPUTER_INPUT_METHOD_CONFLICT', '输入法冲突')
			return { ok: true }
		},
	})
	const { runBatch } = createBatchExecutor(deps)
	const r = await runBatch(exec, {
		observationId: 'obs-1',
		actions: [
			{ action: 'click', handle: '0.1' },
			{ action: 'type', text: 'x' },
			{ action: 'press', key: 'return' },
		],
	})
	assert.equal(r.actionsExecuted, 1)
	assert.equal(r.failed.actionIndex, 1)
	assert.equal(r.failed.actionType, 'type')
	assert.ok(r.failed.error.includes('输入法冲突'))
	// 失败后不再执行后续动作
	assert.equal(deps.calls.length, 2) // click + type-text(失败)
})

test('动作数量校验：0 或 11 个报错', async () => {
	const deps = makeDeps()
	const { runBatch } = createBatchExecutor(deps)
	await assert.rejects(
		runBatch(exec, { observationId: 'obs-1', actions: [] }),
		(e) => e.code === 'COMPUTER_BATCH_SIZE',
	)
	await assert.rejects(
		runBatch(exec, { observationId: 'obs-1', actions: Array(11).fill({ action: 'wait', ms: 1 }) }),
		(e) => e.code === 'COMPUTER_BATCH_SIZE',
	)
})

test('不支持的批量动作报错', async () => {
	const deps = makeDeps()
	const { runBatch } = createBatchExecutor(deps)
	const r = await runBatch(exec, {
		observationId: 'obs-1',
		actions: [{ action: 'hack', handle: 'x' }],
	})
	assert.equal(r.failed.actionType, 'hack')
	assert.equal(r.failed.code, 'COMPUTER_BATCH_BAD_ACTION')
})
