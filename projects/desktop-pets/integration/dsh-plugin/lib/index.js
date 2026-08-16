/**
 * dsh-desktop-pets
 *
 * DSH → desktop-pets 联动插件：把 DSH 会话事件翻译成桌宠的 state/bubble 通道，
 * 让 macOS 桌面宠物（desktop-pets 仓库）跟随 DSH 智能体的真实工作状态换表情、弹气泡。
 *
 * 事件映射（与 opencode 版 integration/desktop-pets-plugin.js 同一通道协议）：
 *   step/start        → thinking
 *   tool/call         → running + 气泡 run|<tool>|<args 预览>
 *   turn/end completed → success + 气泡 finish|
 *   turn/end 其他      → idle（中止/失败回合清掉工作姿态）
 *   session/disposed  → idle + 清气泡
 * 首次收到事件自动拉起活动桌宠（spawn 后台进程，引擎单实例锁兜底重复拉起）。
 *
 * 配置：优先 ~/.config/desktop-pets.json，回退 ~/.config/opencode/desktop-pets.json
 *   {"root": "<库根>", "active": "remiel"}   （<库根> = dsh-skills-plugins/projects/desktop-pets）
 * root 缺省从本文件位置推导仓库根（file: 链接安装保留真实路径），无需硬编码。
 *
 * 安全：所有文件操作与 spawn 全部 try/catch 静默——插件任何情况下都不影响 DSH。
 *
 * @module dsh-desktop-pets
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

/** 插件条目 id（cordis.yml 中的 id）。 */
export const name = 'desktop-pets'

/** 依赖的服务：dsh-session（session/event 事件源）。 */
export const inject = ['session']

/** 配置文件候选路径（按优先级）。 */
const CONFIG_CANDIDATES = [
  join(process.env.HOME ?? '', '.config', 'desktop-pets.json'),
  join(process.env.HOME ?? '', '.config', 'opencode', 'desktop-pets.json'),
]

// 仓库根缺省：lib/index.js → ../.. = integration/dsh-plugin → ../../.. = 仓库根
const FALLBACK_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

/** 读取活动桌宠配置；缺失/损坏回退默认。返回 {root, active} */
function loadPetConfig() {
  for (const path of CONFIG_CANDIDATES) {
    try {
      const cfg = JSON.parse(readFileSync(path, 'utf8'))
      if (typeof cfg === 'object' && cfg !== null) {
        return {
          root: typeof cfg.root === 'string' && cfg.root !== '' ? cfg.root : FALLBACK_ROOT,
          active: typeof cfg.active === 'string' && cfg.active !== '' ? cfg.active : 'remiel',
        }
      }
    } catch {
      // 继续尝试下一个候选
    }
  }
  return { root: FALLBACK_ROOT, active: 'remiel' }
}

/** 每次事件都实时解析配置，切换活动桌宠无需重启 DSH。 */
function resolveChannels() {
  const { root, active } = loadPetConfig()
  let stateFile = `/tmp/${active}-pet.state`
  let bubbleFile = `/tmp/${active}-pet.bubble`
  try {
    const spec = JSON.parse(readFileSync(join(root, 'pets', active, 'pet_spec.json'), 'utf8'))
    if (typeof spec?.state_file === 'string' && spec.state_file !== '') stateFile = spec.state_file
    if (typeof spec?.bubble_file === 'string' && spec.bubble_file !== '') bubbleFile = spec.bubble_file
  } catch {
    // spec 缺失 → 默认通道
  }
  return {
    petPy: join(root, 'pets', active, 'pet.py'),
    python: join(root, '.venv', 'bin', 'python3'),
    stateFile,
    bubbleFile,
  }
}

function writeFile(path, content) {
  try {
    writeFileSync(path, content, 'utf8')
  } catch {
    // Never let filesystem failures affect DSH.
  }
}

function writeState(state) {
  writeFile(resolveChannels().stateFile, String(state))
}

function writeBubble(bubble) {
  writeFile(resolveChannels().bubbleFile, String(bubble))
}

function clearBubble() {
  writeFile(resolveChannels().bubbleFile, '')
}

/** 截断为 90 字符、压平换行与空白（与 opencode 插件一致）。 */
function truncate90(s) {
  const cleaned = String(s)
    .replace(/[\n\r]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return Array.from(cleaned).slice(0, 90).join('')
}

/** 从 tool/call 的 arguments JSON 字符串里取一段预览（首个字符串值或原样截断）。 */
function toolArgsPreview(argumentsJson) {
  if (typeof argumentsJson !== 'string' || argumentsJson === '') return ''
  try {
    const parsed = JSON.parse(argumentsJson)
    if (typeof parsed === 'string' && parsed !== '') return parsed
    if (typeof parsed === 'object' && parsed !== null) {
      for (const value of Object.values(parsed)) {
        if (typeof value === 'string' && value !== '') return value
      }
    }
    return ''
  } catch {
    return truncate90(argumentsJson)
  }
}

let petSpawned = false

/** 首次事件自动拉起活动桌宠（引擎单实例锁兜底重复 spawn）。 */
function launchPet() {
  if (petSpawned) return
  petSpawned = true
  const { petPy, python } = resolveChannels()
  try {
    const child = spawn(python, [petPy], { detached: true, stdio: 'ignore' })
    child.on('error', () => { /* spawn 失败（如 venv 缺失）绝不能影响 DSH */ })
    child.unref()
  } catch {
    // Silent.
  }
}

/**
 * 插件主体：订阅 session/event 与 session/disposed，驱动桌宠状态。
 * @param ctx - cordis 上下文（含 session 服务）。
 */
export function apply(ctx) {
  // 自检标记：插件被 DSH 加载时写入，用于确认联动已生效
  try {
    writeFileSync('/tmp/desktop-pets-dsh.loaded',
      `loaded at ${new Date().toISOString()}`, 'utf8')
  } catch {
    // 写入失败不影响 DSH
  }

  const onEvent = (session, event) => {
    try {
      if (event == null || typeof event.type !== 'string') return
      switch (event.type) {
        case 'turn/start':
          launchPet()
          break
        case 'step/start':
          launchPet()
          writeState('thinking')
          break
        case 'tool/call': {
          launchPet()
          writeState('running')
          const detail = toolArgsPreview(event.data?.arguments)
          writeBubble(`run|${String(event.data?.name ?? 'tool')}|${truncate90(detail)}`)
          break
        }
        case 'turn/end': {
          const kind = event.data?.reason?.kind
          if (kind === 'completed') {
            writeState('success')
            writeBubble('finish|')
          } else {
            // aborted / interrupted / failed：清掉工作姿态
            writeState('idle')
          }
          break
        }
        default:
          break
      }
    } catch {
      // Silent failure: the plugin must never break DSH.
    }
  }

  const onDisposed = () => {
    try {
      writeState('idle')
      clearBubble()
    } catch {
      // Silent.
    }
  }

  const disposers = [
    ctx.on('session/event', onEvent),
    ctx.on('session/disposed', onDisposed),
  ]
  return () => { for (const dispose of disposers) dispose() }
}
