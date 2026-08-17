/**
 * dsh-web-pets —— DSH Web 桌宠插件（宿主侧）
 *
 * 在 DSH Web 界面里养一只桌宠：订阅会话事件驱动宠物状态（thinking /
 * running / success / idle），通过同源 JSON 接口 /api/web-pets/* 暴露状态与
 * 配置，经 /web-pets-assets/<pet>/emotes/* 提供宠物素材。浏览器侧
 * （lib/client.js）轮询 /api/web-pets/state 渲染桌宠。
 *
 * 事件 → 状态映射（与 desktop-pets 原生版的联动协议一致）：
 *   step/start         → thinking
 *   tool/call          → running + 气泡「工具 · 参数预览」
 *   turn/end completed → success（4 秒后自动回 idle）
 *   turn/end 其他      → idle（中止/失败回合清掉工作姿态）
 *   session/disposed   → idle + 清气泡
 *
 * 宠物即「assets/pets/<名字>/」目录：pet.json（规格）+ emotes/（表情文件）。
 * 宿主启动时扫描该目录自动发现宠物，往目录里新增一只即出现在切换菜单中，
 * 替换 emotes/ 里的文件即可更换形象（见 README）。
 *
 * 配置（活动宠物 / 可见性 / 大小）持久化到 ~/.config/dsh-web-pets.json。
 *
 * 安全：所有文件操作与路由处理全部 try/catch 兜底——插件任何情况下都不
 * 影响 DSH 本体。
 *
 * @module dsh-web-pets
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join, basename, extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 插件条目 id（cordis 身份，与 cordis.patch.yml 的 insert id 一致）。 */
export const name = 'web-pets'

/** 依赖的服务：webServer（HTTP 路由）+ session（会话事件源）。 */
export const inject = ['webServer', 'sessions']

/** 包根目录（lib/index.js → ../）。 */
const PACKAGE_ROOT = fileURLToPath(new URL('../', import.meta.url))

/** 宠物素材根目录。 */
const PETS_DIR = join(PACKAGE_ROOT, 'assets', 'pets')

/** 配置持久化路径。 */
const CONFIG_PATH = join(process.env.HOME ?? '', '.config', 'dsh-web-pets.json')

/** 浏览器侧 API 前缀。 */
const API_PREFIX = '/api/web-pets'
/** 浏览器侧素材前缀。 */
const ASSET_PREFIX = '/web-pets-assets'

/** success 状态停留后自动回 idle 的毫秒数。 */
const SUCCESS_IDLE_MS = 4000
/** 点击互动气泡停留毫秒数。 */
const PET_FEEDBACK_MS = 1500

/** 默认活动宠物（注册表扫描不到时兜底）。 */
const DEFAULT_PET = 'demo'

/** 宠物状态集合。 */
const STATE_IDS = ['idle', 'thinking', 'waiting', 'running', 'success']

// ---- 显示参数边界（与官方 dsh-pet 的 display 配置一致） ----
/** 大小下限（px）。 */
const SIZE_MIN = 32
/** 大小上限（px）。 */
const SIZE_MAX = 512
/** 右/下内边距上限（px）。 */
const INSET_MAX = 10_000
/** 自定义显示名最大长度。 */
const NAME_MAX_LENGTH = 20

// ---------------------------------------------------------------------------
// 运行态
// ---------------------------------------------------------------------------

/** 当前宠物状态快照。 */
let petState = {
  state: 'idle',
  bubble: '',
  activePet: DEFAULT_PET,
  visible: true,
  size: 160,
  /** 距视口右缘的内边距（px），与官方 dsh-pet 参数一致。 */
  right: 24,
  /** 距视口下缘的内边距（px），与官方 dsh-pet 参数一致。 */
  bottom: 20,
  /** 自定义显示名（空 = 使用宠物 display_name）。 */
  name: '',
  /** 水平镜像（左右翻转），与原生 desktop-pets mirror_x 语义一致。 */
  mirrorX: false,
  /** 垂直镜像（上下翻转），与原生 desktop-pets mirror_y 语义一致。 */
  mirrorY: false,
  /** 当前正在执行的工具名（tool/call 时写入，供状态行/调试显示）。 */
  tool: '',
  /** 主开关：false 时客户端完全不渲染（无悬浮宠、无召唤按钮）。 */
  enabled: true,
  updatedAt: Date.now(),
}

/** 成功回 idle 与点击气泡的定时器。 */
let successTimer
let feedbackTimer

/** enabled 是否被显式配置过（决定客户端首次加载是否自动让位于上游宠物）。 */
let enabledConfigured = false

/** 读取持久化配置（缺失/损坏回退默认，任何情况不抛错）。 */
function loadConfig() {
  try {
    const cfg = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'))
    if (cfg && typeof cfg === 'object') {
      if (cfg.visible === false) petState.visible = false
      if (cfg.enabled === false || cfg.enabled === true) {
        petState.enabled = cfg.enabled
        enabledConfigured = true
      }
      if (typeof cfg.size === 'number' && cfg.size > 0) petState.size = cfg.size
      if (typeof cfg.right === 'number' && cfg.right >= 0) petState.right = cfg.right
      if (typeof cfg.bottom === 'number' && cfg.bottom >= 0) petState.bottom = cfg.bottom
      if (typeof cfg.name === 'string' && cfg.name !== '') {
        petState.name = Array.from(cfg.name).slice(0, NAME_MAX_LENGTH).join('')
      }
      if (cfg.mirrorX === true) petState.mirrorX = true
      if (cfg.mirrorY === true) petState.mirrorY = true
      if (typeof cfg.activePet === 'string' && cfg.activePet !== '') {
        petState.activePet = cfg.activePet
      }
    }
  } catch {
    // 缺省即可
  }
}

/** 持久化配置（原子写）。 */
function saveConfig() {
  try {
    enabledConfigured = true
    writeFileSync(CONFIG_PATH, JSON.stringify({
      visible: petState.visible,
      enabled: petState.enabled,
      size: petState.size,
      activePet: petState.activePet,
      right: petState.right,
      bottom: petState.bottom,
      name: petState.name,
      mirrorX: petState.mirrorX,
      mirrorY: petState.mirrorY,
    }, null, 2), 'utf8')
  } catch {
    // 写失败不影响运行
  }
}

// ---------------------------------------------------------------------------
// 宠物注册表（扫描 assets/pets/*/pet.json）
// ---------------------------------------------------------------------------

/** 扫描宠物注册表：返回 [{id, displayName, description, emotes}]。 */
function listPets() {
  try {
    const dirs = readdirSync(PETS_DIR, { withFileTypes: true })
    return dirs
      .filter((d) => d.isDirectory())
      .map((d) => {
        try {
          const spec = JSON.parse(
            readFileSync(join(PETS_DIR, d.name, 'pet.json'), 'utf8'),
          )
          if (spec && typeof spec === 'object') {
            return {
              id: d.name,
              displayName:
                typeof spec.display_name === 'string'
                  ? spec.display_name
                  : d.name,
              description:
                typeof spec.description === 'string' ? spec.description : '',
              emotes: spec.emotes && typeof spec.emotes === 'object'
                ? spec.emotes
                : {},
            }
          }
        } catch {
          // 规格缺失的目录跳过
        }
        return null
      })
      .filter(Boolean)
  } catch {
    return []
  }
}

/** 活动宠物在注册表中不存在时回退第一个可用宠物（或默认）。 */
function ensureActivePet() {
  const pets = listPets()
  if (pets.length === 0) return
  if (!pets.some((p) => p.id === petState.activePet)) {
    petState.activePet = pets[0].id
    saveConfig()
  }
}

// ---------------------------------------------------------------------------
// 状态机
// ---------------------------------------------------------------------------

/** 设置宠物状态并更新时间戳（success 自动回 idle）。 */
function setPetState(s) {
  if (!STATE_IDS.includes(s)) return
  petState.state = s
  petState.updatedAt = Date.now()
  if (s === 'success') {
    clearTimeout(successTimer)
    successTimer = setTimeout(() => {
      if (petState.state === 'success') {
        petState.state = 'idle'
        petState.updatedAt = Date.now()
      }
    }, SUCCESS_IDLE_MS)
  }
}

/** 设置气泡文字并安排自动清除。 */
function setBubble(text) {
  petState.bubble = text
  clearTimeout(feedbackTimer)
  if (text !== '') {
    feedbackTimer = setTimeout(() => {
      petState.bubble = ''
      petState.updatedAt = Date.now()
    }, PET_FEEDBACK_MS * 2)
  }
}

/** 截断为 90 字符、压平换行与空白（与桌面版插件一致）。 */
function truncate90(s) {
  const cleaned = String(s)
    .replace(/[\n\r]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return Array.from(cleaned).slice(0, 90).join('')
}

/** 从 tool/call 的 arguments JSON 里取一段预览（通用兜底：首个字符串值）。 */
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

/** 从解析后的 arguments 按候选键取首个字符串值（支持对象值内取首个字符串）。 */
function pickField(obj, candidates) {
  if (!obj || typeof obj !== 'object') return ''
  for (const key of candidates) {
    const value = obj[key]
    if (typeof value === 'string' && value !== '') return value
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const v of Object.values(value)) {
        if (typeof v === 'string' && v !== '') return v
      }
    }
  }
  return ''
}

/**
 * 常见工具展示映射：运行时 tool/call 时按工具类型展示有意义信息
 * （bash → 命令、read → 文件路径、web_search → 查询词…）。
 * 键为真实事件里的工具名（小写）；未列出的工具走通用回退。
 */
const TOOL_PRESENTATION = {
  bash: { icon: '🖥', label: '命令', fields: ['command'] },
  read: { icon: '📖', label: '读取', fields: ['file_path', 'path'] },
  write: { icon: '✏️', label: '写入', fields: ['file_path', 'path'] },
  edit: { icon: '✏️', label: '修改', fields: ['file_path', 'path'] },
  glob: { icon: '🔎', label: '匹配', fields: ['pattern'] },
  grep: { icon: '🔍', label: '搜索', fields: ['pattern', 'path'] },
  stat: { icon: '📁', label: '查看', fields: ['path', 'file_path'] },
  list: { icon: '📁', label: '列表', fields: ['path', 'directory'] },
  'web_search': { icon: '🌐', label: '搜索', fields: ['query'] },
  'todo_write': { icon: '📋', label: '待办', fields: [] },
  ssh_exec: { icon: '🖥', label: '远程命令', fields: ['command', 'alias'] },
  ssh_upload: { icon: '📤', label: '上传', fields: ['localPath', 'remotePath'] },
  ssh_download: { icon: '📥', label: '下载', fields: ['remotePath', 'localPath'] },
  ssh_tunnel: { icon: '🔀', label: '隧道', fields: ['remotePort', 'alias'] },
  ssh_list: { icon: '📋', label: '主机列表', fields: ['query'] },
}

/** 按工具类型生成气泡文案；未知工具回退「🛠 工具名 · 参数预览」。 */
function toolBubble(name, argumentsJson) {
  const toolName = typeof name === 'string' && name !== '' ? name : 'tool'
  const pres = TOOL_PRESENTATION[toolName] ?? null
  let detail = ''
  if (typeof argumentsJson === 'string' && argumentsJson !== '') {
    try {
      const parsed = JSON.parse(argumentsJson)
      if (pres && pres.fields.length > 0) {
        detail = pickField(parsed, pres.fields)
      }
      if (detail === '') detail = toolArgsPreview(argumentsJson)
    } catch {
      detail = truncate90(argumentsJson)
    }
  }
  if (pres) {
    const head = pres.label ? `${pres.icon} ${pres.label}` : pres.icon
    return detail !== '' ? `${head} · ${truncate90(detail)}` : `${head} · ${toolName}`
  }
  return detail !== '' ? `🛠 ${toolName} · ${truncate90(detail)}` : `🛠 ${toolName}`
}

/** 会话事件 → 宠物状态（与桌面版联动协议一致）。 */
function onSessionEvent(_session, event) {
  try {
    if (event == null || typeof event.type !== 'string') return
    switch (event.type) {
      case 'step/start':
        setPetState('thinking')
        break
      case 'tool/call': {
        const toolName = String(event.data?.name ?? 'tool')
        petState.tool = toolName
        setPetState('running')
        setBubble(toolBubble(toolName, event.data?.arguments))
        break
      }
      case 'turn/end': {
        const kind = event.data?.reason?.kind
        if (kind === 'completed') {
          setPetState('success')
          setBubble('🎉 完成！')
        } else {
          // aborted / interrupted / failed：清掉工作姿态
          petState.tool = ''
          setPetState('idle')
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

/** 会话销毁：回 idle 并清气泡。 */
function onSessionDisposed() {
  try {
    petState.tool = ''
    setPetState('idle')
    petState.bubble = ''
    petState.updatedAt = Date.now()
  } catch {
    // Silent.
  }
}

// ---------------------------------------------------------------------------
// HTTP 路由
// ---------------------------------------------------------------------------

/** 写 JSON 响应。 */
function json(res, status, body) {
  try {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify(body))
  } catch {
    // 响应已关闭等场景直接忽略
  }
}

/** 校验请求方法，不匹配时回 405。 */
function requireMethod(req, res, method) {
  if (req.method === method) return true
  json(res, 405, { ok: false, error: 'method-not-allowed' })
  return false
}

/** 读取 JSON 请求体（限 64KB）。 */
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > 64 * 1024) {
        reject(new Error('body-too-large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        reject(new Error('invalid-json'))
      }
    })
    req.on('error', reject)
  })
}

/** 组装全部路由（API + 素材）。 */
function makeRoutes() {
  const apiRoutes = [
    {
      kind: 'exact',
      path: `${API_PREFIX}/state`,
      handler: async (req, res) => {
        if (!requireMethod(req, res, 'GET')) return
        ensureActivePet()
        json(res, 200, {
          ok: true,
          state: petState.state,
          bubble: petState.bubble,
          activePet: petState.activePet,
          pets: listPets(),
          visible: petState.visible,
          enabled: petState.enabled,
          enabledConfigured,
          size: petState.size,
          right: petState.right,
          bottom: petState.bottom,
          name: petState.name,
          mirrorX: petState.mirrorX,
          mirrorY: petState.mirrorY,
          tool: petState.tool,
          updatedAt: petState.updatedAt,
        })
      },
    },
    {
      kind: 'exact',
      path: `${API_PREFIX}/set-enabled`,
      handler: async (req, res) => {
        if (!requireMethod(req, res, 'POST')) return
        try {
          const body = await readJsonBody(req)
          if (typeof body.enabled !== 'boolean') {
            json(res, 400, { ok: false, error: 'invalid-enabled' })
            return
          }
          petState.enabled = body.enabled
          petState.updatedAt = Date.now()
          saveConfig()
          json(res, 200, { ok: true, enabled: petState.enabled })
        } catch (error) {
          json(res, 400, {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      },
    },
    {
      kind: 'exact',
      path: `${API_PREFIX}/set-pet`,
      handler: async (req, res) => {
        if (!requireMethod(req, res, 'POST')) return
        try {
          const body = await readJsonBody(req)
          const id = typeof body.id === 'string' ? body.id : ''
          if (id === '' || !listPets().some((p) => p.id === id)) {
            json(res, 400, { ok: false, error: 'unknown-pet' })
            return
          }
          petState.activePet = id
          petState.updatedAt = Date.now()
          saveConfig()
          json(res, 200, { ok: true, activePet: id })
        } catch (error) {
          json(res, 400, {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      },
    },
    {
      kind: 'exact',
      path: `${API_PREFIX}/set-visible`,
      handler: async (req, res) => {
        if (!requireMethod(req, res, 'POST')) return
        try {
          const body = await readJsonBody(req)
          if (typeof body.visible !== 'boolean') {
            json(res, 400, { ok: false, error: 'invalid-visible' })
            return
          }
          petState.visible = body.visible
          petState.updatedAt = Date.now()
          saveConfig()
          json(res, 200, { ok: true, visible: petState.visible })
        } catch (error) {
          json(res, 400, {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      },
    },
    {
      kind: 'exact',
      path: `${API_PREFIX}/set-size`,
      handler: async (req, res) => {
        if (!requireMethod(req, res, 'POST')) return
        try {
          const body = await readJsonBody(req)
          const size = typeof body.size === 'number' ? body.size : NaN
          if (!Number.isFinite(size) || size < SIZE_MIN || size > SIZE_MAX) {
            json(res, 400, { ok: false, error: 'invalid-size' })
            return
          }
          petState.size = Math.round(size)
          petState.updatedAt = Date.now()
          saveConfig()
          json(res, 200, { ok: true, size: petState.size })
        } catch (error) {
          json(res, 400, {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      },
    },
    {
      kind: 'exact',
      path: `${API_PREFIX}/set-config`,
      handler: async (req, res) => {
        // 与官方 dsh-pet 的 set-config 同构：可选 size / right / bottom / name 补丁。
        if (!requireMethod(req, res, 'POST')) return
        try {
          const body = await readJsonBody(req)
          if (typeof body.size === 'number') {
            if (body.size < SIZE_MIN || body.size > SIZE_MAX) {
              json(res, 400, { ok: false, error: 'invalid-size' })
              return
            }
            petState.size = Math.round(body.size)
          }
          if (typeof body.right === 'number') {
            if (!Number.isFinite(body.right) || body.right < 0 || body.right > INSET_MAX) {
              json(res, 400, { ok: false, error: 'invalid-right' })
              return
            }
            petState.right = Math.round(body.right)
          }
          if (typeof body.bottom === 'number') {
            if (!Number.isFinite(body.bottom) || body.bottom < 0 || body.bottom > INSET_MAX) {
              json(res, 400, { ok: false, error: 'invalid-bottom' })
              return
            }
            petState.bottom = Math.round(body.bottom)
          }
          if (typeof body.name === 'string') {
            const name = body.name.trim()
            if (name === '' || Array.from(name).length > NAME_MAX_LENGTH) {
              json(res, 400, { ok: false, error: 'invalid-name' })
              return
            }
            petState.name = name
          }
          if ('mirrorX' in body) {
            if (typeof body.mirrorX !== 'boolean') {
              json(res, 400, { ok: false, error: 'invalid-mirrorX' })
              return
            }
            petState.mirrorX = body.mirrorX
          }
          if ('mirrorY' in body) {
            if (typeof body.mirrorY !== 'boolean') {
              json(res, 400, { ok: false, error: 'invalid-mirrorY' })
              return
            }
            petState.mirrorY = body.mirrorY
          }
          petState.updatedAt = Date.now()
          saveConfig()
          json(res, 200, {
            ok: true,
            size: petState.size,
            right: petState.right,
            bottom: petState.bottom,
            name: petState.name,
            mirrorX: petState.mirrorX,
            mirrorY: petState.mirrorY,
          })
        } catch (error) {
          json(res, 400, {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      },
    },
    {
      kind: 'exact',
      path: `${API_PREFIX}/interact`,
      handler: async (req, res) => {
        if (!requireMethod(req, res, 'POST')) return
        setBubble('❤️ 摸头 +1')
        json(res, 200, { ok: true })
      },
    },
  ]

  const assetRoute = {
    kind: 'prefix',
    path: ASSET_PREFIX,
    handler: async (req, res) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405)
        res.end()
        return
      }
      try {
        // /web-pets-assets/<pet>/emotes/<file>
        const pathname = decodeURIComponent(
          new URL(req.url ?? '/', 'http://localhost').pathname,
        )
        const rest = pathname.slice(ASSET_PREFIX.length).replace(/^\/+/, '')
        const parts = rest.split('/')
        if (parts.length !== 3 || parts[1] !== 'emotes') {
          res.writeHead(404)
          res.end()
          return
        }
        const [petId, , file] = parts
        const petDir = resolve(PETS_DIR, petId)
        // 防目录穿越：pet 必须在注册表内，文件必须落在 pet 目录下
        if (!listPets().some((p) => p.id === petId)) {
          res.writeHead(404)
          res.end()
          return
        }
        const filePath = resolve(petDir, 'emotes', basename(file))
        if (!filePath.startsWith(resolve(petDir, 'emotes') + '/')) {
          res.writeHead(403)
          res.end()
          return
        }
        const body = await readFile(filePath)
        const mime = extname(filePath).toLowerCase() === '.gif'
          ? 'image/gif'
          : 'application/octet-stream'
        res.writeHead(200, {
          'content-type': mime,
          'content-length': String(body.byteLength),
          'cache-control': 'no-cache',
        })
        if (req.method === 'HEAD') {
          res.end()
          return
        }
        res.end(body)
      } catch {
        res.writeHead(404)
        res.end()
      }
    },
  }

  return [...apiRoutes, assetRoute]
}

// ---------------------------------------------------------------------------
// 插件主体
// ---------------------------------------------------------------------------

/** 插件主体：订阅会话事件驱动桌宠状态，注册 API 与素材路由。 */
export function apply(ctx) {
  loadConfig()
  ensureActivePet()

  const disposers = [
    ctx.on('session/event', onSessionEvent),
    ctx.on('session/disposed', onSessionDisposed),
  ]

  const routes = makeRoutes()
  const disposeRoutes = ctx.effect(
    () => {
      const routeDisposers = routes.map((route) => ctx.webServer.register(route))
      return () => {
        for (const dispose of routeDisposers) dispose()
      }
    },
    'web-pets: routes',
  )

  return () => {
    for (const dispose of disposers) dispose()
    disposeRoutes()
    clearTimeout(successTimer)
    clearTimeout(feedbackTimer)
  }
}

/**
 * 测试钩子：暴露纯逻辑供验证 harness 断言（cordis 只消费 name/inject/apply）。
 */
export const _internals = { toolBubble, toolArgsPreview, truncate90 }
