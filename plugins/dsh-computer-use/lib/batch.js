/**
 * dsh-computer-use —— computer_batch 批量执行（Phase 3）
 *
 * 将 3~10 个确定性动作（click/type/press/scroll/wait/open/focus/set_value）
 * 合并为一次执行、一次验证：模型给出完整动作计划后，宿主依次执行，
 * 中间无 LLM 往返，全部完成后一次重观察返回新鲜状态 + diff。
 *
 * 安全：批量动作中任一敏感动作（type、带 command/control 的 press、
 * perform_action）→ 整个 batch 需要一次性 confirmationToken
 * （computer_confirm 签发，binding action='computer_batch'）；
 * 任一动作失败立即停止，返回已执行数与失败点。
 *
 * @module dsh-computer-use/batch
 */

/** 创建批量执行器（依赖由宿主注入，便于测试）。 */
export function createBatchExecutor(deps) {
	const {
		runHelper,
		ComputerUseError,
		requireObservation,
		ensureControl,
		requireConfirmation,
		resolveElementRef,
		reobserve,
		diffObservations,
		appIdentity,
		config,
		PACKAGE_ROOT,
	} = deps

	const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

	/** 敏感动作判定（batch 级别：任一敏感 → 整个 batch 需确认）。 */
	function batchIsSensitive(actions) {
		return actions.some((a) => {
			if (a.action === 'type') return true
			if (a.action === 'perform_action') return true
			if (a.action === 'press') {
				const mods = Array.isArray(a.modifiers) ? a.modifiers : []
				return mods.some((m) => ['command', 'cmd', 'control', 'ctrl'].includes(String(m).toLowerCase()))
			}
			return false
		})
	}

	/** 键盘/指针是否先激活目标（配置策略）。 */
	const keyboardActivate = () => (config.interaction?.keyboardPolicy ?? 'preserve') === 'activate'
	const focusActivate = () => (config.interaction?.focusPolicy ?? 'preserve') === 'activate'

	/** open 动作后重新解析目标 pid（应用名匹配）。 */
	async function resolvePidFor(appName) {
		try {
			const data = await runHelper('apps', {}, { pluginRoot: PACKAGE_ROOT, config, timeoutMs: 10_000 })
			const target = String(appName).toLowerCase()
			for (const app of data.apps ?? []) {
				if (target === String(app.name ?? '').toLowerCase()) return app.pid
			}
			// 模糊匹配兜底
			for (const app of data.apps ?? []) {
				if (target && String(app.name ?? '').toLowerCase().includes(target)) return app.pid
			}
		} catch { /* 忽略 */ }
		return null
	}

	/** 执行单个批量动作（不捕获异常——失败由上层记录）。observation 为 batch 起始快照，用于解析 handle。 */
	async function executeBatchAction(exec, act, pid, observation) {
		const helperOpts = {
			pluginRoot: PACKAGE_ROOT,
			config,
			timeoutMs: config.actionTimeoutMs ?? 30_000,
			signal: exec.signal,
		}
		switch (act.action) {
			case 'wait': {
				await sleep(Math.max(0, Math.min(act.ms ?? 300, 30_000)))
				return
			}
			case 'open': {
				const { execFile } = await import('node:child_process')
				const target = act.target ?? act.app
				const openArgs = act.url ? ['-g', act.url] : ['-g', '-a', target]
				await new Promise((resolve, reject) => {
					execFile('open', openArgs, (error) => (error ? reject(error) : resolve()))
				})
				await sleep(800)
				return
			}
			case 'click': {
				const ref = resolveElementRef(observation, { handle: act.handle, index: act.index })
				const args = { pid }
				if (ref) { args.path = ref.path; args.role = ref.role; args.title = ref.title }
				args.prefer = act.prefer ?? 'semantic'
				args.allowCoordinateFallback = act.allowCoordinateFallback === true
				if (focusActivate()) args.activate = true
				if (typeof act.x === 'number') args.x = act.x
				if (typeof act.y === 'number') args.y = act.y
				await runHelper('click', args, helperOpts)
				return
			}
			case 'focus': {
				const ref = resolveElementRef(observation, { handle: act.handle, index: act.index })
				if (!ref) throw new ComputerUseError('COMPUTER_TARGET_STALE', 'focus 需要 handle 或 index')
				await runHelper('click', { pid, path: ref.path, prefer: 'coordinate', activate: true }, helperOpts)
				return
			}
			case 'type': {
				if (typeof act.text !== 'string' || act.text === '') {
					throw new ComputerUseError('COMPUTER_PROTOCOL', 'type 需要非空 text')
				}
				const args = { pid, text: act.text }
				if (keyboardActivate()) args.activate = true
				if (typeof act.handle === 'string' && act.handle !== '') {
					const ref = resolveElementRef(observation, { handle: act.handle })
					if (ref) args.path = ref.path
				}
				await runHelper('type-text', args, helperOpts)
				return
			}
			case 'press': {
				const args = { pid, key: act.key, modifiers: act.modifiers ?? [] }
				if (keyboardActivate()) args.activate = true
				await runHelper('press-key', args, helperOpts)
				return
			}
			case 'scroll': {
				const args = { pid, direction: act.direction, amount: act.amount ?? 3 }
				if (typeof act.x === 'number') args.x = act.x
				if (typeof act.y === 'number') args.y = act.y
				await runHelper('scroll', args, helperOpts)
				return
			}
			case 'set_value': {
				const ref = resolveElementRef(observation, { handle: act.handle, index: act.index })
				if (!ref) throw new ComputerUseError('COMPUTER_TARGET_STALE', 'set_value 需要 handle 或 index')
				await runHelper('set-value', { pid, path: ref.path, value: act.value, clear: act.clear === true }, helperOpts)
				return
			}
			default:
				throw new ComputerUseError('COMPUTER_BATCH_BAD_ACTION', `不支持的批量动作: ${act.action}`)
		}
	}

	/**
	 * 批量执行主入口。
	 * @returns { actionsTotal, actionsExecuted, failed, observation, diff, prevObservationId }。
	 */
	async function runBatch(exec, args) {
		const agentId = exec.agent?.id
		const observation = requireObservation(agentId, args.observationId)
		const bundleId = appIdentity(observation)
		await ensureControl(exec, bundleId, '批量执行界面动作')
		const actions = Array.isArray(args.actions) ? args.actions : []
		if (actions.length < 1 || actions.length > 10) {
			throw new ComputerUseError('COMPUTER_BATCH_SIZE', 'batch 需要 1~10 个动作')
		}
		if (batchIsSensitive(actions)) {
			requireConfirmation(exec, { confirmationToken: args.confirmationToken }, bundleId, observation, 'computer_batch', null)
		}

		let currentPid = observation.app?.pid
		let executed = 0
		let failed = null
		for (let i = 0; i < actions.length; i++) {
			const act = actions[i]
			if (exec.signal?.aborted) {
				failed = { actionIndex: i, actionType: act.action, error: 'cancelled', code: 'COMPUTER_ABORTED' }
				break
			}
			try {
				await executeBatchAction(exec, act, currentPid, observation)
				executed++
				if (act.action === 'open') {
					const target = act.target ?? act.app
					const newPid = await resolvePidFor(target)
					if (newPid !== null) currentPid = newPid
				}
			} catch (error) {
				failed = {
					actionIndex: i,
					actionType: act.action,
					error: error?.message ?? String(error),
					code: error?.code ?? 'unknown',
				}
				break
			}
		}

		// 一次验证：动作全部（或部分）完成后重观察
		const fresh = await reobserve(exec, { pid: currentPid }, false)
		const diff = diffObservations(observation, fresh)
		return {
			actionsTotal: actions.length,
			actionsExecuted: executed,
			failed,
			observation: fresh,
			diff,
			prevObservationId: observation.observationId,
		}
	}

	return { runBatch }
}
