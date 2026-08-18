/**
 * dsh-computer-use —— apply 冒烟测试（mock cordis ctx）
 * 验证：11 个工具全部注册、系统通告注册、Skill 注册、路由注册、disposer 可调用。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { apply, Config } from '../lib/index.js'

const EXPECTED_TOOLS = [
	'computer_list_apps',
	'computer_observe',
	'computer_click',
	'computer_set_value',
	'computer_type_text',
	'computer_press_key',
	'computer_scroll',
	'computer_drag',
	'computer_perform_action',
	'computer_wait',
	'computer_confirm',
]

function makeCtx() {
	const registered = { tools: [], sections: [], routes: [], skills: [] }
	const ctx = {
		tools: {
			register: (tool) => {
				registered.tools.push(tool.name)
				return () => {}
			},
		},
		systemPrompt: {
			section: (entry) => {
				registered.sections.push(entry)
				return () => {}
			},
		},
		webServer: {
			register: (route) => {
				registered.routes.push(route)
				return () => {}
			},
		},
		attachments: {},
		skill: {
			register: (skill) => {
				registered.skills.push(skill)
				return () => {}
			},
		},
		on: () => () => {},
		effect: (fn) => {
			const result = fn()
			return () => (typeof result === 'function' ? result() : undefined)
		},
		get: () => undefined,
		logger: { warn: () => {}, info: () => {}, debug: () => {} },
	}
	return { ctx, registered }
}

test('apply 注册全部 11 个 computer_* 工具', () => {
	const { ctx, registered } = makeCtx()
	const dispose = apply(ctx, {})
	assert.deepEqual([...registered.tools].sort(), [...EXPECTED_TOOLS].sort())
	assert.equal(registered.tools.length, 11)
	assert.equal(typeof dispose, 'function')
	dispose()
})

test('apply 注册系统通告与 Skill 与诊断路由', () => {
	const { ctx, registered } = makeCtx()
	apply(ctx, {})
	assert.equal(registered.sections.length, 1)
	assert.equal(registered.sections[0].name, 'plugin:dsh-computer-use')
	assert.ok(registered.sections[0].text.includes('computer_observe'))
	assert.equal(registered.skills.length, 1)
	assert.equal(registered.skills[0].name, 'computer-use')
	assert.ok(registered.skills[0].content.includes('先 observe 再动作'))
	assert.equal(registered.routes.length, 1)
	assert.equal(registered.routes[0].path, '/api/computer-use/status')
})

test('announceToAgent=false 时不注册通告', () => {
	const { ctx, registered } = makeCtx()
	apply(ctx, { announceToAgent: false })
	assert.equal(registered.sections.length, 0)
})

test('Config schema 解析默认配置（cordis 用 ~standard.validate 填充默认值）', () => {
	// 与 cordis resolveConfig(runtime, config) 的行为一致
	const result = Config['~standard'].validate({})
	assert.equal(result.issues, undefined)
	const config = result.value
	assert.equal(config.enabled, true)
	assert.equal(config.announceToAgent, true)
	assert.equal(config.observationTtlMs, 0)
	assert.equal(config.actionTimeoutMs, 30000)
	assert.equal(config.interaction.focusPolicy, 'preserve')
	assert.equal(config.interaction.pointerInputPolicy, 'targeted')
	assert.equal(config.allowAllApps, false)
	assert.deepEqual(config.grants, [])
})
