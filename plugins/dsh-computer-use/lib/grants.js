/**
 * dsh-computer-use —— 授权模型（纯函数，便于测试）
 *
 * 两个安全机制：
 * 1. 按 bundle-id 的 read / control 租约：
 *    - read   ：允许观察应用（Accessibility 树 / 截图），session 级；
 *    - control：允许向应用发送输入，带 TTL（默认 5 分钟，近似 turn 级）。
 *    授权来源：插件配置 grants / allowAllApps（预授权），或 DSH approval 服务
 *    （用户交互批准）。用户拒绝后记入 denials，session 内保持最终。
 * 2. 敏感动作的一次性 confirmation token：
 *    - 高影响动作（type-text、drag、perform-action、带 command 修饰的按键）
 *      执行前必须 computer_confirm 签发 token；
 *    - token 短 TTL、只能用一次、绑定 (bundleId, observationId, path, action)；
 *    - 元素重绑定（observation 变化）会使 token 失效。
 *
 * 所有函数纯内存、无副作用，方便单测。
 *
 * @module dsh-computer-use/grants
 */

import { randomBytes } from 'node:crypto'

/** 默认 control 租约 TTL（毫秒）。 */
export const DEFAULT_CONTROL_TTL_MS = 5 * 60 * 1000
/** 默认 confirmation token TTL（毫秒）。 */
export const DEFAULT_CONFIRM_TTL_MS = 60 * 1000

/** 新建授权存储（纯内存）。 */
export function createGrantStore() {
	return {
		// key: `${agentId}|${bundleId}` -> { scope, grantedAt, expiresAt }
		grants: new Map(),
		// key: `${agentId}|${bundleId}` -> { scope, deniedAt }
		denials: new Map(),
		// key: token -> confirmation 记录
		confirmations: new Map(),
	}
}

function grantKey(agentId, bundleId, scope) {
	return `${agentId}|${bundleId}|${scope}`
}

/**
 * 检查租约：read 或 control 是否已授予且未过期（或未拒绝）。
 * read 与 control 独立存储（各自作用域），互不覆盖。
 * @param store - 授权存储。
 * @param req - { agentId, bundleId, scope, now? }。
 * @returns true | false。
 */
export function hasLease(store, req) {
	const now = req.now ?? Date.now()
	const key = grantKey(req.agentId, req.bundleId, req.scope)
	const denial = store.denials.get(key)
	if (denial !== undefined && denial.scope === req.scope) return false
	const grant = store.grants.get(key)
	if (grant === undefined || grant.scope !== req.scope) return false
	if (grant.expiresAt > 0 && now > grant.expiresAt) return false
	return true
}

/**
 * 授予租约（幂等：已有效授权则刷新 TTL；同 scope 的拒绝记录会清除）。
 * @returns 本次授予的租约记录。
 */
export function grantLease(store, req) {
	const now = req.now ?? Date.now()
	const ttlMs = req.ttlMs ?? (req.scope === 'control' ? DEFAULT_CONTROL_TTL_MS : 0)
	const key = grantKey(req.agentId, req.bundleId, req.scope)
	store.denials.delete(key)
	const grant = {
		scope: req.scope,
		grantedAt: now,
		expiresAt: ttlMs > 0 ? now + ttlMs : 0,
	}
	store.grants.set(key, grant)
	return grant
}

/**
 * 记录用户拒绝（session 内保持最终）。只拒绝指定 scope；
 * read 拒绝不连带撤销已授予的 control（控制仍以 control 自身租约为准）。
 * @returns 拒绝记录。
 */
export function recordDenial(store, req) {
	const key = grantKey(req.agentId, req.bundleId, req.scope)
	const denial = { scope: req.scope, deniedAt: req.now ?? Date.now() }
	store.denials.set(key, denial)
	store.grants.delete(key)
	return denial
}

/** 清空某 agent 的全部授权状态（session 销毁时调用）。 */
export function clearAgent(store, agentId) {
	for (const key of [...store.grants.keys()]) {
		if (key.startsWith(`${agentId}|`)) store.grants.delete(key)
	}
	for (const key of [...store.denials.keys()]) {
		if (key.startsWith(`${agentId}|`)) store.denials.delete(key)
	}
	for (const [token, record] of [...store.confirmations]) {
		if (record.agentId === agentId) store.confirmations.delete(token)
	}
}

// ---------------------------------------------------------------------------
// 一次性 confirmation token
// ---------------------------------------------------------------------------

/** 签发 confirmation token。绑定 (bundleId, observationId, path, action, agentId)。 */
export function issueConfirmation(store, req) {
	const now = req.now ?? Date.now()
	const ttlMs = req.ttlMs ?? DEFAULT_CONFIRM_TTL_MS
	const token = randomBytes(16).toString('hex')
	store.confirmations.set(token, {
		agentId: req.agentId,
		bundleId: req.bundleId,
		observationId: req.observationId,
		path: req.path ?? null,
		action: req.action ?? null,
		reason: req.reason ?? '',
		issuedAt: now,
		expiresAt: ttlMs > 0 ? now + ttlMs : 0,
		used: false,
	})
	return token
}

/**
 * 消费 confirmation token（一次性、TTL 内、全部绑定字段匹配才成功）。
 * @param store - 授权存储。
 * @param req - { token, agentId, bundleId, observationId, path?, action? }。
 * @returns { ok: true } 或 { ok: false, error: { code, message } }。
 */
export function consumeConfirmation(store, req) {
	const now = req.now ?? Date.now()
	const record = store.confirmations.get(req.token)
	if (record === undefined) {
		return { ok: false, error: { code: 'COMPUTER_CONFIRMATION_INVALID', message: 'confirmation token 不存在或已失效；请重新 computer_confirm' } }
	}
	if (record.used) {
		store.confirmations.delete(req.token)
		return { ok: false, error: { code: 'COMPUTER_CONFIRMATION_USED', message: 'confirmation token 已使用过（一次性）；请重新 computer_confirm' } }
	}
	if (record.expiresAt > 0 && now > record.expiresAt) {
		store.confirmations.delete(req.token)
		return { ok: false, error: { code: 'COMPUTER_CONFIRMATION_EXPIRED', message: 'confirmation token 已过期；请重新 computer_confirm' } }
	}
	if (record.agentId !== req.agentId) {
		return { ok: false, error: { code: 'COMPUTER_CONFIRMATION_BINDING', message: 'confirmation token 不属于当前 agent' } }
	}
	if (record.bundleId !== req.bundleId) {
		store.confirmations.delete(req.token)
		return { ok: false, error: { code: 'COMPUTER_CONFIRMATION_BINDING', message: '目标应用与 confirmation token 绑定不一致（应用已变化）；请重新 computer_confirm' } }
	}
	if (req.observationId !== undefined && record.observationId !== req.observationId) {
		store.confirmations.delete(req.token)
		return { ok: false, error: { code: 'COMPUTER_CONFIRMATION_BINDING', message: 'observation 与 confirmation token 绑定不一致（界面已变化）；请重新 computer_observe 并 computer_confirm' } }
	}
	if (req.path !== undefined && req.path !== null && record.path !== req.path) {
		store.confirmations.delete(req.token)
		return { ok: false, error: { code: 'COMPUTER_CONFIRMATION_BINDING', message: '目标元素与 confirmation token 绑定不一致；请重新 computer_confirm' } }
	}
	if (req.action !== undefined && req.action !== null && record.action !== req.action) {
		store.confirmations.delete(req.token)
		return { ok: false, error: { code: 'COMPUTER_CONFIRMATION_BINDING', message: '动作与 confirmation token 绑定不一致；请重新 computer_confirm' } }
	}
	record.used = true
	store.confirmations.delete(req.token)
	return { ok: true }
}
