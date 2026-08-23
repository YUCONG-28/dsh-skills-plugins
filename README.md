# dsh-skills-plugins

个人 DeepSeek Harness（DSH）Skill 与插件集合 · Personal collection of DSH skills and plugins.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## 发现性（Discoverability）

本仓库按 DeepSeek Harness 官方生态约定打标：

- **GitHub Topics**：`dsh-plugin`（[官方要求](https://github.com/deepseek-ai/deepseek-harness)）、`deepseek-harness`、`dsh`、`agent-skills`
- **可发现性**：活动插件均声明 `dsh.bundle` manifest，可通过 `dsh plugin add` 标准安装（详见各插件 README）；已归档插件见 `archive/`。
- **收录状态**：已准备 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 投稿文件（见 [docs/awesome-submission/](docs/awesome-submission/)），收录确认后启用上方 badge
- **插件市场**：可关注 [dsh-market](https://github.com/dsh-market/dsh-market)（聚合列表内插件的一键安装/升级市场）

## 目录结构

```text
dsh-skills-plugins/
├── skills/                    # DSH 用户级 Skills（放入 ~/.dsh/skills/ 自动发现）
│   ├── study-review/          # 通用课程资料解析、知识融合、学习笔记与考试复习系统（v1.0）
│   └── markdown-math-writer/  # 按目标渲染器正确书写 Markdown LaTeX 公式（GitHub/mpe/generic，v3.0）
├── plugins/                   # DSH 插件
│   ├── dsh-web-pets/          # Web 桌宠：浏览器内随会话状态换表情的桌宠（可替换形象）
│   ├── dsh-computer-use/      # Computer Use：macOS 桌面观察与操作（类似 Codex Computer Use）
│   └── obsidian-dsh/          # Obsidian 原生 DSH 客户端：侧栏聊天、流式、工具/审批、Pro-Flash 编排
├── archive/                   # 已归档插件
│   └── dsh-vision-bridge/     # 视觉路由 + 本地 OCR（v0.3 双档位）——DeepSeek 已内置多模态后归档
└── projects/                  # 独立项目（规范源）
    └── desktop-pets/          # macOS 原生多桌宠桌面库（AppKit/PyObjC，desktop-pets 原仓库内容）
```

## Skills 一览

| Skill | 版本 | 用途 |
| --- | --- | --- |
| `study-review` | 1.0 | 课程/资料整理：提炼结构化学习笔记、公式速查、考点梳理（full / exam / quick / lecture / concept 五模式） |
| `markdown-math-writer` | 3.0 | 按目标渲染器（GitHub / Markdown Preview Enhanced / 通用）正确书写 Markdown LaTeX 公式，内置验证器与格式化器 |

## 安装方法

### Skill：study-review

```bash
# 方式一：复制（推荐，独立副本）
cp -R skills/study-review ~/.dsh/skills/

# 方式二：符号链接（保持与仓库同步）
ln -s "$(pwd)/skills/study-review" ~/.dsh/skills/study-review
```

安装后无需重启：DSH 的 skill watcher 会自动发现，新会话中模型可见 `study-review` 并可调用。

### Skill：markdown-math-writer

```bash
# 方式一：复制（推荐，独立副本）
cp -R skills/markdown-math-writer ~/.dsh/skills/

# 方式二：符号链接（保持与仓库同步）
ln -s "$(pwd)/skills/markdown-math-writer" ~/.dsh/skills/markdown-math-writer
```

首次使用其验证/格式化脚本（`validate_math.mjs` / `github_safe_math.mjs` / `render_html.mjs`）前，在 `scripts/` 目录安装依赖（`package-lock.json` 已入库，`node_modules` 不入库）：

```bash
cd ~/.dsh/skills/markdown-math-writer/scripts && npm install
```

安装后无需重启：DSH 的 skill watcher 会自动发现，新会话中模型可见 `markdown-math-writer` 并可调用（目标是 README / GitHub 仓库文档时自动进入 github-safe 方言）。

### Archive：dsh-vision-bridge（已归档）

> DeepSeek V4 Flash 已内置多模态，视觉分析默认由主模型直接完成，本插件已归档（移至 [`archive/dsh-vision-bridge/`](archive/dsh-vision-bridge/)），不再安装/维护。历史实现（image-capable 虚拟 provider `vision-router`、本地 macOS Vision OCR、Qwen VL 兜底、结构化证据缓存）见归档目录 README。

### 插件：dsh-web-pets（Web 桌宠）

```bash
# 方式一：npm 安装（推荐，快速使用）
dsh plugin --profile web add dsh-web-pets

# 方式二：GitHub Release tarball（离线/兜底）
dsh plugin --profile web add file:/path/to/dsh-web-pets-<版本>.tgz

# 方式三：monorepo link:（开发/源码）
dsh plugin --profile web add link:$(pwd)/plugins/dsh-web-pets
```

安装后重启 `dsh web`。**并入 dsh-web-ui 的宠物入口**：先装 dsh-web-ui（含鲸鱼宠物 dsh-pet）再装本插件，设置 → Web UI 插件 → 宠物区域出现「宠物选择」卡片，可在鲸鱼娘（上游）/ 豆豆 / 雷米埃尔 / 自定义宠物间切换，**任意时刻只显示一只宠物**；仅装本插件时则是一只独立悬浮宠（右下角）+ 右键菜单（缩放/透明度/锁定/暂停/重置/镜像/切换/隐藏）+ **设置面板**（外观 / 行为 / 更新 / 反馈四栏）。替换/新增宠物形象：往 `plugins/dsh-web-pets/assets/pets/<名字>/` 放 `pet.json` + `emotes/` 即可（详见插件 README）。

**开发与构建**（v0.2.0 起为 TS + tsdown 工程，产物 `lib/` 已提交，安装无需构建）：

```bash
cd plugins/dsh-web-pets
pnpm install        # 安装 tsdown 等 devDependencies
pnpm build          # 重新生成素材 data-URI（scripts/generate-art.mjs）+ tsdown 构建 lib/
pnpm test           # 构建 + node:test 单元测试
pnpm release -- patch|minor|major   # 一键发版（bump→test→pack→tag→Release→push）
```

**更新闭环**：设置面板「更新」栏自动检查 GitHub Release（按 `web-pets-v*` 前缀过滤），发现新版本后按安装形态更新——npm 形态 `pnpm update`；link 形态 `git pull --ff-only` + `bash fix-web-profile.sh`；tarball 形态仅提示到 Release 下载（不自动更新）。CI：push/PR 跑 `ci.yml`，推送 `web-pets-v*` tag 跑 `release.yml`（build/test/npm pack+npm publish+GitHub Release）。

### 插件：dsh-computer-use（Computer Use）

```bash
# 1. 安装插件（file: 依赖 + cordis.patch.yml insert，本机已装）
dsh plugin --profile web add file:$(pwd)/plugins/dsh-computer-use

# 2. 编译原生 helper + 自检 + 打印 TCC 权限指引
bash plugins/dsh-computer-use/scripts/install.sh
```

安装后重启 `dsh web`，新会话中加载 Skill：`/computer-use`。需要 macOS「辅助功能」权限（必需）与「屏幕录制」权限（截图用），授权对象是运行 dsh 的宿主进程。

主要能力：Agent 可列出应用（`computer_list_apps`）、观察 Accessibility 树与截图（`computer_observe`）、点击/输入/按键/滚动/拖拽（`computer_click` 等），采用「先观察再动作、动作后新鲜状态验证」循环；带完整安全模型（按应用 read/control 授权、敏感动作一次性确认、陈旧 observation 拒绝、目标进程定向输入、不移动系统光标）。设计参考 [@anionex/dsh-computer-use](https://github.com/Anionex/dsh-computer-use) 与 Codex Computer Use。详见 [`plugins/dsh-computer-use/README.md`](plugins/dsh-computer-use/README.md)。

### 项目：desktop-pets（macOS 原生多桌宠）

`projects/desktop-pets/` 是原 desktop-pets 仓库的规范位置（macOS 原生桌宠引擎 + opencode/DSH 双联动插件）。快速开始：

```bash
cd projects/desktop-pets
/usr/bin/python3 -m venv .venv
.venv/bin/pip install "pyobjc-framework-Cocoa==11.0" "Pillow==11.3.0"
scripts/petctl.sh remiel start          # 启动桌宠
```

与 DSH 联动：运行 `projects/desktop-pets/integration/dsh-plugin/install.sh` 后重启 `dsh web`。详见 [`projects/desktop-pets/README.md`](projects/desktop-pets/README.md)。

### 兼容性

`SKILL.md` 采用 agent-skills 通用格式，兼容 Claude Code / Codex 等生态：

- `study-review`：解析脚本仅依赖 Python 标准库与 Ghostscript（`gs`），跨 macOS / Linux 可用；
- `markdown-math-writer`：验证/格式化脚本为 Node.js（`validate_math.mjs` / `github_safe_math.mjs` / `render_html.mjs`，依赖见 `scripts/package.json`），跨平台可用；
- `dsh-web-pets`：遵循 dsh 官方客户端插件形态（`dsh.client` 声明 + `__ModuleLoader__` bundle），可在任意包含 dsh-web-ui 客户端壳的 profile 中安装。
- 视觉分析：默认由 DeepSeek 内置多模态直接处理（含 Computer Use 截图），无需额外视觉插件。

## 维护 / 开发

- 本仓库是**规范源（canonical）**：本机 DSH 环境的 `dsh-desktop-pets`（桌面联动）、`dsh-web-pets` 与 `dsh-computer-use` 均通过 `file:` 依赖指向仓库内路径；`dsh-vision-bridge` 已归档（见 `archive/`）。
- 修改插件：直接改本仓库 `plugins/<name>/`，然后在 profile 目录（`~/.dsh/profiles/web`）执行 `pnpm install` 刷新安装副本（提示 "Already up to date" 时先删除 `node_modules/<name>` 再装），重启 dsh web 生效。
- **硬链接提醒**：`dsh-web-pets` 等 `file:` 插件安装副本是源码的**硬链接**。用编辑器原地编辑源码会保留硬链接（副本自动同步），但若编辑器**替换**文件（写新 inode），旧硬链接仍指向旧内容 → 重启后运行的是旧代码。改完源码后跑一次 `bash fix-web-profile.sh`（幂等，同步活动插件副本并校验一致性），或执行 `pnpm install` 重链，再重启 dsh web。
- 新增 Skill：复制到 `skills/<name>/`（含 `SKILL.md`）提交即可；本地安装 `cp -R skills/<name> ~/.dsh/skills/`（DSH 自动发现，无需重启）。
- 修改 `skills/markdown-math-writer/scripts/` 下脚本：同步更新 `package-lock.json` 并在本地 `npm install` 验证（`node_modules` 不入库）。
- 本机实际安装状态与一致性核对见 [SUMMARY.md](SUMMARY.md)。
- **升级兼容**：升级前对照 [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md)（上游 API 面矩阵）与 [docs/UPGRADE_RUNBOOK.md](docs/UPGRADE_RUNBOOK.md)（事务式流程），版本基线记录在 [versions.lock.json](versions.lock.json)（CI 自动校验，防漂移）。
- **事务式升级 / 快速回滚**：推荐用 [scripts/dsh-safe-upgrade.sh](scripts/dsh-safe-upgrade.sh)（preflight → LKG snapshot → 全插件测试 → 隔离 DSH_HOME canary → apply → health-check → promote / 失败自动回滚）；升级前也可单独执行 [scripts/dsh-snapshot.sh](scripts/dsh-snapshot.sh)，崩溃后用 [scripts/dsh-rollback.sh](scripts/dsh-rollback.sh) latest 一键回滚（含 pnpm-lock.yaml / git SHA / DSH core 版本 / 插件版本 / 安装形态）。健康检查见 [scripts/dsh-healthcheck.sh](scripts/dsh-healthcheck.sh)。
- 注意：`plugins/dsh-web-pets` 与 `plugins/dsh-computer-use` 的打包范围由各自 `package.json` 的 `files` 字段决定；已归档的 `archive/dsh-vision-bridge` 仅作历史存档，不再打包发布。

### 插件：obsidian-dsh（Obsidian 原生 DSH 客户端）

> 与上面三个 DSH profile 插件不同，本插件运行在 Obsidian 桌面端，作为本地 dsh web 的薄客户端（复用官方 /api 契约，不自建 agent runtime）。

```bash
# 构建
cd plugins/obsidian-dsh && npm install && npm run build
# 安装到 vault
cp plugins/obsidian-dsh/main.js plugins/obsidian-dsh/manifest.json plugins/obsidian-dsh/styles.css <vault>/.obsidian/plugins/obsidian-dsh/
```

- 原生侧边栏（非 iframe）：流式聊天、思考折叠、tool 卡片、审批/提问确认、四档权限（Read Only / Ask Before Write / Workspace Write / Full Access）。
- 上下文：当前笔记 / 选中文本 / 拖拽文件 / 外部 Git 仓库 workspace，注入带字节预算截断。
- Agent 模式：Direct（单模型）或 Orchestrated（Pro 拆任务 -> 多个 Flash 并行 -> Pro Review，复用 DSH 自带 subagent/workflow 原语）。
- 传输：Node http + 自研 RFC6455 WebSocket（loopback、无 Origin，过 DSH 浏览器信任围栏）；事件走 /api/events.mux + /api/events.host，重连自动重同步。
- 测试：npm test（27 例，含真实 dsh web 契约冒烟）。
- 可选伴侣 bundle：plugins/obsidian-dsh/companion/dsh-obsidian-tools/（vault 原生 obsidian_* 工具 + 四档权限 preset + orchestrated preset 参考）。
- 详见 plugins/obsidian-dsh/README.md。

## Awesome List 投稿文案

以下为提交 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 用的一句话描述与分类（en / zh 双语文案，投稿 YAML 见 [docs/awesome-submission/](docs/awesome-submission/)）：

| 插件 | 分类 | 一句话描述（en） | 一句话描述（zh） |
| --- | --- | --- | --- |
| `dsh-computer-use` | `tools` | macOS desktop control for agents: observe Accessibility trees and screenshots, click/type/key/scroll with per-app grants and one-time confirmations. | macOS 桌面操控：观察辅助功能树与截图，点击/输入/按键/滚动，带按应用授权与一次性确认。 |

> `dsh-vision-bridge` 已归档（`archive/`），不再参与 Awesome List 投稿。


> 注：`markdown-math-writer` / `study-review` 为纯 SKILL.md 目录（复制到 `~/.dsh/skills/` 使用），暂不满足 awesome 列表「可 `dsh plugin add` 安装」门槛；如需收录可后续打包为 bundle 插件。

## 第三方插件（仅引用，不复制代码）

本机环境还使用了以下第三方 DSH 插件，版权归其作者所有：

| 插件 | 许可 | 上游 |
|---|---|---|
| `@linxin666/dsh-web-ui-all` 0.2.0（含 dsh-ssh / dsh-task-board / dsh-aionui-panel / dsh-git-graph / dsh-pet / dsh-skins / dsh-remote-web-ui / dsh-tool-describe-image / dsh-liangshen / dsh-client-ui-skill-explorer / dsh-better-sidebar；0.2.0 起移除 dsh-live-stats） | Apache-2.0 | https://github.com/zhu1090093659/dsh-web-ui |

## 许可

MIT License。本仓库所有代码与素材均为作者自有。详见 [LICENSE](LICENSE)（仓库根）、`plugins/dsh-web-pets/LICENSE`、`plugins/dsh-computer-use/LICENSE`、`archive/dsh-vision-bridge/LICENSE` 与 `projects/desktop-pets/LICENSE`。