/**
 * dsh-computer-use —— helper 进程客户端
 *
 * 负责 spawn bin/cu-helper（或回退 swift 解释 scripts/cu-helper.swift），
 * 通过 stdin 传 JSON 参数、stdout 收 JSON 结果；硬超时 + fail-closed：
 * 协议错误、超时、退出码异常一律返回结构化 COMPUTER_* 错误，绝不猜测。
 *
 * @module dsh-computer-use/helper
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

/** helper 协议错误（带 code）。 */
export class ComputerUseError extends Error {
	constructor(code, message, options) {
		super(message)
		this.name = 'ComputerUseError'
		this.code = code
		if (options?.cause !== undefined) this.cause = options.cause
	}
}

/** 插件包根目录（lib/helper.js → ../）。 */
const PACKAGE_ROOT = dirname(fileURLToPath(import.meta.url)) + '/..'

/**
 * 解析 helper 可执行方式：优先编译二进制 bin/cu-helper，否则 swift 解释源码。
 * @param pluginRoot - 插件根目录（默认包根）。
 * @param config - 插件配置（helper.path / helper.allowSourceBuild）。
 * @returns { command, args, kind }。
 */
export function resolveHelperCommand(pluginRoot = PACKAGE_ROOT, config = {}) {
	if (typeof config?.helper?.path === 'string' && config.helper.path.trim() !== '') {
		return { command: config.helper.path.trim(), args: [], kind: 'custom' }
	}
	const binary = join(pluginRoot, 'bin', 'cu-helper')
	if (existsSync(binary)) {
		return { command: binary, args: [], kind: 'binary' }
	}
	const source = join(pluginRoot, 'scripts', 'cu-helper.swift')
	if (existsSync(source)) {
		return { command: 'swift', args: [source], kind: 'source' }
	}
	throw new ComputerUseError(
		'COMPUTER_HELPER_MISSING',
		'找不到 cu-helper（编译二进制或源码均缺失）。请运行 scripts/build-helper.sh 编译，或检查插件安装完整性。',
	)
}

/**
 * 运行一次 helper 命令。
 * @param command - helper 子命令（ping/tcc-status/apps/observe/...）。
 * @param args - JSON 参数对象（写入 stdin）。
 * @param options - { pluginRoot, config, timeoutMs, signal }。
 * @returns 解析后的结果对象（helper 的 {"ok": true, ...} 或抛 ComputerUseError）。
 */
export function runHelper(command, args = {}, options = {}) {
	const { command: exe, args: exeArgs, kind } = resolveHelperCommand(
		options.pluginRoot,
		options.config,
	)
	const timeoutMs = options.timeoutMs ?? 30_000
	return new Promise((resolve, reject) => {
		let child
		try {
			child = spawn(exe, [...exeArgs, command], {
				stdio: ['pipe', 'pipe', 'pipe'],
			})
		} catch (error) {
			reject(new ComputerUseError('COMPUTER_HELPER_SPAWN_FAILED', `无法启动 helper（${exe}）: ${error?.message ?? error}`, { cause: error }))
			return
		}
		const timer = setTimeout(() => {
			child.kill('SIGKILL')
			reject(new ComputerUseError(
				'COMPUTER_TIMEOUT',
				`helper 命令 ${command} 超时（${timeoutMs}ms，kind=${kind}）；应用可能无响应，请稍后重试`,
			))
		}, timeoutMs)

		let stdout = ''
		let stderr = ''
		child.stdout.on('data', (chunk) => { stdout += chunk })
		child.stderr.on('data', (chunk) => { stderr += chunk })

		const settle = (fn) => {
			clearTimeout(timer)
			fn()
		}

		child.on('error', (error) => {
			settle(() => reject(new ComputerUseError('COMPUTER_HELPER_SPAWN_FAILED', `helper 进程错误: ${error?.message ?? error}`, { cause: error })))
		})
		child.on('close', (code) => {
			settle(() => {
				if (code !== 0) {
					reject(new ComputerUseError(
						'COMPUTER_HELPER_EXIT',
						`helper 命令 ${command} 非零退出（code=${code}）: ${stderr.trim().slice(0, 500) || '(无 stderr)'}`,
					))
					return
				}
				let parsed
				try {
					parsed = JSON.parse(stdout)
				} catch {
					reject(new ComputerUseError('COMPUTER_PROTOCOL', `helper 返回了无法解析的输出: ${stdout.slice(0, 300)}`))
					return
				}
				if (parsed !== null && typeof parsed === 'object' && parsed.error !== undefined) {
					const err = parsed.error
					reject(new ComputerUseError(
						typeof err?.code === 'string' ? err.code : 'COMPUTER_UNKNOWN',
						typeof err?.message === 'string' ? err.message : 'helper 返回未知错误',
					))
					return
				}
				resolve(parsed ?? {})
			})
		})

		// 写入 JSON 参数（stdin 关闭后 helper 开始执行）
		try {
			child.stdin.write(JSON.stringify(args ?? {}))
			child.stdin.end()
		} catch (error) {
			settle(() => reject(new ComputerUseError('COMPUTER_PROTOCOL', `写入 helper 参数失败: ${error?.message ?? error}`)))
		}

		// 取消信号：中止时杀掉 helper
		if (options.signal !== undefined) {
			if (options.signal.aborted) {
				child.kill('SIGKILL')
				settle(() => reject(new ComputerUseError('COMPUTER_ABORTED', '动作已取消')))
				return
			}
			options.signal.addEventListener('abort', () => {
				child.kill('SIGKILL')
			}, { once: true })
		}
	})
}
