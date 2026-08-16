import { readFileSync, writeFileSync } from "node:fs"
import { spawn } from "node:child_process"

// ---------------------------------------------------------------------------
// 配置读取: 优先 ~/.config/desktop-pets.json，回退 ~/.config/opencode/desktop-pets.json
//  {"root": "<库根>", "active": "remiel"}
// 失败时回退默认值（本仓库规范路径），保证插件任何情况下都不影响 opencode。
// ---------------------------------------------------------------------------
let ROOT = "/Users/yucong/Documents/Deepseek Harness/dsh-skills-plugins/projects/desktop-pets"
let ACTIVE = "remiel"

const CONFIG_CANDIDATES = [
  process.env.HOME + "/.config/desktop-pets.json",
  process.env.HOME + "/.config/opencode/desktop-pets.json",
]
for (const path of CONFIG_CANDIDATES) {
  try {
    const cfg = JSON.parse(readFileSync(path, "utf8"))
    if (typeof cfg?.root === "string" && cfg.root !== "") ROOT = cfg.root
    if (typeof cfg?.active === "string" && cfg.active !== "") ACTIVE = cfg.active
    break
  } catch {
    // 继续尝试下一个候选
  }
}

// 桌宠 spec: pets/<active>/pet_spec.json 决定 state/bubble 通道等
// spec 读取失败时回退到活动桌宠的默认通道（ACTIVE=remiel 时与原 /tmp/remiel-pet.* 一致）
let STATE_FILE = "/tmp/" + ACTIVE + "-pet.state"
let BUBBLE_FILE = "/tmp/" + ACTIVE + "-pet.bubble"

try {
  const spec = JSON.parse(
    readFileSync(ROOT + "/pets/" + ACTIVE + "/pet_spec.json", "utf8"),
  )
  if (typeof spec?.state_file === "string" && spec.state_file !== "") {
    STATE_FILE = spec.state_file
  }
  if (typeof spec?.bubble_file === "string" && spec.bubble_file !== "") {
    BUBBLE_FILE = spec.bubble_file
  }
} catch {
  // spec 缺失/损坏 → 使用默认通道
}

const PET_PY = ROOT + "/pets/" + ACTIVE + "/pet.py"
const PET_PYTHON = ROOT + "/.venv/bin/python3"

// 自检标记: 插件被 opencode 加载时写入，用于确认联动已生效
try {
  writeFileSync(
    "/tmp/desktop-pets-plugin.loaded",
    "loaded at " + new Date().toISOString(),
    "utf8",
  )
} catch {
  // 写入失败不影响 opencode
}

function writeState(s) {
  try {
    writeFileSync(STATE_FILE, String(s), "utf8")
  } catch {
    // Never let filesystem failures affect opencode.
  }
}

function writeBubble(s) {
  try {
    writeFileSync(BUBBLE_FILE, String(s), "utf8")
  } catch {
    // Never let filesystem failures affect opencode.
  }
}

function clearBubble() {
  try {
    writeFileSync(BUBBLE_FILE, "", "utf8")
  } catch {
    // Never let filesystem failures affect opencode.
  }
}

function truncate90(s) {
  const cleaned = String(s)
    .replace(/[\n\r]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  return Array.from(cleaned).slice(0, 90).join("")
}

function launchPet() {
  try {
    const child = spawn(PET_PYTHON, [PET_PY], {
      detached: true,
      stdio: "ignore",
    })
    child.on("error", () => {
      // spawn 异步失败（如 venv 缺失）绝不能崩溃 opencode 宿主
    })
    child.unref()
  } catch {
    // The pet holds a single-instance lock, so a duplicate spawn
    // exits quietly on its own; nothing to recover here.
  }
}

function firstStringArg(args) {
  const arg = args?.filePath ?? args?.pattern
  if (typeof arg === "string" && arg !== "") return arg
  for (const value of Object.values(args ?? {})) {
    if (typeof value === "string") return value
  }
  return ""
}

export default async function DesktopPetsPlugin({ client, directory }) {
  return {
    event: async ({ event }) => {
      try {
        if (event?.type === "session.created") {
          writeState("idle")
          clearBubble()
          launchPet()
        } else if (event?.type === "session.idle") {
          writeState("success")
          writeBubble("finish|")
        }
      } catch {
        // Silent failure: the plugin must never break opencode.
      }
    },

    "chat.message": async (input, output) => {
      try {
        if (output?.message?.role === "user") {
          writeState("thinking")
          writeBubble("think|")
        }
      } catch {
        // Silent failure.
      }
    },

    "tool.execute.before": async (input, output) => {
      try {
        let detail = ""
        if (input?.tool === "bash") {
          detail = output?.args?.command ?? ""
        } else {
          detail = firstStringArg(output?.args)
        }
        writeState("running")
        writeBubble("run|" + input?.tool + "|" + truncate90(detail))
      } catch {
        // Silent failure.
      }
    },

    "tool.execute.after": async (input, output) => {
      try {
        const code =
          output?.metadata?.exitCode ?? output?.metadata?.exit_code ?? "ok"
        writeBubble("done|" + input?.tool + "|" + String(code))
      } catch {
        // Silent failure.
      }
    },
  }
}
