# obsidian-dsh

Native Obsidian integration for [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness). The plugin is a **thin client**: it reuses the local `dsh web` agent runtime and renders a native sidebar chat view inside Obsidian — no iframe, no reimplemented agent loop.

## Features

- **Native sidebar** (ItemView) with streaming chat, collapsible reasoning, tool cards, and Obsidian Markdown rendering (wikilinks work).
- **Session management**: list / create / switch / archive, with `cwd = vault` by default.
- **Model + reasoning effort switching** via `session.models` / `session.selectModel`.
- **Tool calls** rendered as expandable cards with risk badges.
- **Approval / question loop**: inline confirm UI answering DSH's `approval/requested` / `question/requested` frames through `POST /api/respond`.
- **Permission modes**: Read Only / Ask Before Write / Workspace Write / Full Access, mapped to DSH sandbox + approval presets.
- **Context**: Current Note, Selected Text, attached files (drag or command), budgeted injection.
- **External workspace**: pick a directory (e.g. a Git repo) as the session workspace.
- **Direct / Orchestrated**: Orchestrated uses DSH's own subagent/workflow primitives for Pro (decompose) → Flash (parallel) → Pro (review), with Pro/Flash model aliases.

## Architecture

```
src/
  harness/    DSH process management + /api RPC + WebSocket event streams
  agents/     Direct/Orchestrated semantics + Pro/Flash model aliases
  views/      native sidebar UI, event fold, session store, renderer
  obsidian/   vault path, context collection, path linkify
  approval/   approval/question queue, modals, permission policy
  settings/   plugin settings model + tab
  utils/      timers, spawn, dsh executable detection, port
companion/
  dsh-obsidian-tools/   optional DSH bundle: vault-native tools + permission
                        presets + orchestrated preset reference
```

## Build

```bash
npm install
npm run build     # produces main.js
npm test          # vitest unit + live contract smoke
npm run typecheck # tsc --noEmit
```

Copy `main.js`, `manifest.json`, `styles.css` into `<vault>/.obsidian/plugins/obsidian-dsh/` and enable the plugin.

## How it connects

- Unary: `POST /api/<method>` with the four-quadrant RPC envelope.
- Events: WebSocket downlinks `/api/events.mux` and `/api/events.host` (server → client only), with exponential-backoff reconnect.
- Answers: `POST /api/respond` for approvals/questions.

Obsidian's renderer `fetch`/WebSocket carry an `app://obsidian.md` Origin that DSH's browser-trust fence rejects, so the plugin uses `node:http` / `node:net` primitives (loopback, no Origin).

## Permission mapping

| Mode | sandbox | approval |
|---|---|---|
| Read Only | `read-only` | `never` |
| Ask Before Write | `read-only` | `ask` |
| Workspace Write | `workspace-write` | `ask` |
| Full Access | `danger-full-access` | `ask` |

The four presets are registered by the companion DSH bundle; the plugin writes the chosen `permission.defaultPreset` via `settings.mutate`.
