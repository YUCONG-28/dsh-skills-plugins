/**
 * dsh-computer-use —— observation 模型（纯函数，便于测试）
 *
 * observation 是「先观察再动作」协议的核心：每次 computer_observe 生成一份
 * 带 TTL 的快照，所有动作工具必须引用未过期的 observation 才能执行；
 * 动作后返回新鲜 observation 供模型校验。
 *
 * 结构：
 *   {
 *     observationId: 'obs-<rand>',
 *     observedAt, expiresAt,
 *     app: { pid, bundleId, name },
 *     windows: [{ axIndex, title?, frame?, minimized?, cgWindowId? }],
 *     elements: [{ path, role, title?, value?, description?, actions?, frame?, secure? }],
 *     treeText,            // 有界、带索引、模型可读的文本渲染
 *     nodeCount,           // 实际遍历节点数
 *     maxNodesReached,     // 是否达到遍历上限（树被截断）
 *     screenshot: { attachmentRef?, path?, width?, height?, bytes? } | null
 *   }
 *
 * 元素引用：index（elements 数组下标，observation-local）或 handle（=path，
 * 树路径，如 "0.3.7"）。二者都只是 observation-local 身份，不暴露任何
 * provider-native identifier。
 *
 * @module dsh-computer-use/observations
 */

/** 生成 observation id（带随机后缀）。 */
export function newObservationId() {
	return `obs-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/** 渲染单个元素为模型可见的短行。 */
export function renderElementLine(el) {
	const head = `[${el.path}] ${el.role}`
	const parts = [head]
	if (typeof el.title === 'string' && el.title !== '') parts.push(`"${el.title}"`)
	if (typeof el.value === 'string' && el.value !== '') parts.push(`value="${el.value}"`)
	if (Array.isArray(el.actions) && el.actions.includes('AXPress')) parts.push('(clickable)')
	return parts.join(' ')
}

/**
 * 渲染有界的模型可读树文本（窗口头 + 元素行，带 observation-local 索引行号）。
 * @param observation - observation 对象。
 * @returns 有界文本。
 */
export function renderTreeText(observation) {
	const lines = []
	const app = observation.app
	if (app) {
		const name = app.name || app.bundleId || String(app.pid)
		lines.push(`应用: ${name} (${app.bundleId || '?'}, pid ${app.pid})`)
	}
	for (const w of observation.windows ?? []) {
		const minimized = w.minimized === true ? ' [最小化]' : ''
		const title = typeof w.title === 'string' && w.title !== '' ? ` "${w.title}"` : ''
		const frame = w.frame
			? ` (${Math.round(w.frame.x)},${Math.round(w.frame.y)} ${Math.round(w.frame.width)}x${Math.round(w.frame.height)})`
			: ''
		lines.push(`窗口 [${w.axIndex}]:${title}${frame}${minimized}`)
	}
	for (const el of observation.elements ?? []) {
		lines.push(`  ${renderElementLine(el)}`)
	}
	if (observation.maxNodesReached === true) {
		lines.push(`[树超出 maxNodes 上限，仅显示前 ${observation.nodeCount} 个元素]`)
	}
	return lines.join('\n')
}

/**
 * 创建一份 observation（应用 TTL）。
 * @param input - { app, windows, elements, ttlMs, screenshot, nodeCount, maxNodesReached }。
 * @param now - 当前时间戳（默认 Date.now()）。
 * @returns 完整 observation 对象（含 observationId/observedAt/expiresAt/treeText）。
 */
export function createObservation(input, now = Date.now()) {
	const ttlMs = Number.isFinite(input.ttlMs) && input.ttlMs > 0 ? input.ttlMs : 0
	const observation = {
		observationId: newObservationId(),
		observedAt: now,
		expiresAt: ttlMs > 0 ? now + ttlMs : 0,
		app: input.app ?? null,
		windows: Array.isArray(input.windows) ? input.windows : [],
		elements: Array.isArray(input.elements) ? input.elements : [],
		nodeCount: input.nodeCount ?? (Array.isArray(input.elements) ? input.elements.length : 0),
		maxNodesReached: input.maxNodesReached === true,
		screenshot: input.screenshot ?? null,
	}
	observation.treeText = renderTreeText(observation)
	return observation
}

/** observation 是否已过期（ttl=0 表示永不过期）。 */
export function isStale(observation, now = Date.now()) {
	if (!observation || typeof observation.observationId !== 'string') return true
	if (observation.expiresAt > 0 && now > observation.expiresAt) return true
	return false
}

/**
 * 按引用取元素：index（数字）或 handle（=path 字符串）。
 * @param observation - observation 对象。
 * @param ref - number（elements 下标）或 string（path）。
 * @returns 元素对象或 null。
 */
export function elementByRef(observation, ref) {
	if (!observation || !Array.isArray(observation.elements)) return null
	if (typeof ref === 'number') {
		return observation.elements[ref] ?? null
	}
	if (typeof ref === 'string') {
		return observation.elements.find((el) => el.path === ref) ?? null
	}
	return null
}

/**
 * 计算两份 observation 的差异（按 path 对齐；只比较模型可见字段）。
 * @param prev - 旧 observation。
 * @param next - 新 observation。
 * @returns { added, removed, changed } —— changed 含 { path, role, title, field, oldValue, newValue }。
 */
export function diffObservations(prev, next) {
	const prevMap = new Map((prev?.elements ?? []).map((el) => [el.path, el]))
	const nextMap = new Map((next?.elements ?? []).map((el) => [el.path, el]))
	const added = []
	const removed = []
	const changed = []
	for (const [path, el] of nextMap) {
		if (!prevMap.has(path)) {
			added.push({ path, role: el.role, title: el.title ?? '' })
		}
	}
	for (const [path, el] of prevMap) {
		if (!nextMap.has(path)) {
			removed.push({ path, role: el.role, title: el.title ?? '' })
		}
	}
	for (const [path, el] of nextMap) {
		const old = prevMap.get(path)
		if (!old) continue
		for (const field of ['title', 'value', 'description']) {
			const ov = old[field] ?? ''
			const nv = el[field] ?? ''
			if (ov !== nv) {
				changed.push({ path, role: el.role, title: el.title ?? '', field, oldValue: ov, newValue: nv })
			}
		}
	}
	return { added, removed, changed }
}

/** 渲染差异为模型可读文本（空差异返回空串）。 */
export function renderDiff(diff) {
	const lines = []
	for (const item of diff.added) lines.push(`+ [${item.path}] ${item.role} ${item.title}`)
	for (const item of diff.removed) lines.push(`- [${item.path}] ${item.role} ${item.title}`)
	for (const item of diff.changed) lines.push(`~ [${item.path}] ${item.role} ${item.title}: ${item.field} "${item.oldValue}" → "${item.newValue}"`)
	return lines.join('\n')
}
