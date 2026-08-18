# dsh-web-pets · DSH Web Pet Plugin

A pet that lives in the DeepSeek Harness browser UI and reacts to the real session state: thinking → thinking emote, tool calls → running emote + tool bubble, turn completion → celebration, 2 minutes idle → waiting.

Built-in pets: **demo** and **remiel** (雷米埃尔). All assets and code are original.

## Highlights

| Feature | Description |
|---|---|
| State emotes | `idle` / `thinking` / `waiting` (derived after 2 min idle) / `running` / `success` (auto back to idle after 4 s) |
| Session linkage | `step/start` → thinking; `tool/call` → running + tool-type bubble (command / file path / pattern / query…); `turn/end completed` → success; abort/fail/dispose → idle |
| Interaction | Click → petting bubble + random emote for 1.8 s; drag to move (auto-persisted, lockable) |
| Right-click menu | Switch pet / size ± / scale % / opacity / lock position / pause animation / reset position / mirror H·V / hide / settings |
| Settings panel | Sidebar tabs: Appearance (scale, opacity) / Behavior (lock, pause, hide, reset, DOM signals) / Update (auto-check, check, one-click update) / Feedback (GitHub Issues prefill) |
| Self-update | Host `/api/web-pets/check` (GitHub direct + proxy fallback); monorepo link installs can one-click `git pull` + `fix-web-profile.sh` (localhost-only, 120 s timeout) |
| dsh-pet parity | Same display params (size 32–512 px, right/bottom 0–10000 px, name ≤20 chars, mirror, show/hide, enabled) |
| Swappable pets | Pet = `assets/pets/<id>/pet.json` + `emotes/`; built-ins are inlined as data URIs into the client bundle (`scripts/generate-art.mjs`), custom pets are served via `/web-pets-assets/*` |
| DOM signals (optional) | Detect waiting cards → `waiting`, think blocks → `thinking`; off by default, degrades silently |
| Persistence | Host config in `~/.config/dsh-web-pets.json`; visual prefs (scale/opacity/lock/pause) in `localStorage` |

## Install

```bash
dsh plugin --profile web add link:/path/to/dsh-skills-plugins/plugins/dsh-web-pets
# or: file: dependency + insert row (id: web-pets) in the profile cordis.patch.yml
```

Then `pnpm install` and **restart `dsh web`**.

## Development & Build

```bash
cd plugins/dsh-web-pets
pnpm install
pnpm build   # generate art/version (scripts/generate-art.mjs) + tsdown build into lib/
pnpm test    # build + node:test unit tests (14 cases)
```

Source: `src/host/index.ts` + `src/client/index.ts`. Built artifacts `lib/index.js` and `lib/client.js` are committed — no build needed to install.

## Self-check

- `curl http://127.0.0.1:<port>/api/web-pets/state` → JSON state (includes `version`).
- `curl http://127.0.0.1:<port>/api/web-pets/info` → install mode + update command.
- `curl -I http://127.0.0.1:<port>/web-pets-assets/demo/emotes/demo_1.gif`.

## HTTP API

| Method | Path | Description |
|---|---|---|
| GET | `/api/web-pets/state` | State snapshot (state/bubble/activePet/pets/visible/size/domSignals/version) |
| GET | `/api/web-pets/info` | Install mode + version + update command |
| GET | `/api/web-pets/check` | Check GitHub for the newest version (localhost only) |
| POST | `/api/web-pets/update` | One-click update for monorepo link installs (localhost only, 120 s timeout) |
| POST | `/api/web-pets/set-enabled` | Enable / disable |
| POST | `/api/web-pets/set-pet` | Switch active pet |
| POST | `/api/web-pets/set-visible` | Show / hide |
| POST | `/api/web-pets/set-size` | Set size (32–512) |
| POST | `/api/web-pets/set-config` | Set size/position/name/mirror/domSignals |
| POST | `/api/web-pets/interact` | Petting interaction |
| GET | `/web-pets-assets/<pet>/emotes/<file>` | Custom pet assets (GIF/PNG/WebP, ETag) |

Write/update/check routes only accept requests with a local Host header (`127.0.0.1|localhost|[::1]`) as CSRF protection.

## License

MIT. All code and assets are original. See [CHANGELOG.md](CHANGELOG.md) and the Chinese [README.md](README.md).
