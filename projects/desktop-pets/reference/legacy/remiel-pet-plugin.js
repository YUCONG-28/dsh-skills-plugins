import { writeFileSync } from "node:fs"
import { spawn } from "node:child_process"

const STATE_FILE = "/tmp/remiel-pet.state"
const BUBBLE_FILE = "/tmp/remiel-pet.bubble"
const PET_PY = "/Users/yucong/remiel-pet/remiel-pet-desktop.py"
const PET_PYTHON = "/Users/yucong/remiel-pet/.venv/bin/python3"

// 自检标记: 插件被 opencode 加载时写入，用于确认联动已生效
try {
  writeFileSync(
    "/tmp/remiel-pet-plugin.loaded",
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

export default async function RemielPetPlugin({ client, directory }) {
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
