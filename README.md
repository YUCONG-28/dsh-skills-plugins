# dsh-skills-plugins

个人 DeepSeek Harness（DSH）Skill 与插件集合 · Personal collection of DSH skills and plugins.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## 发现性（Discoverability）

本仓库按 DeepSeek Harness 官方生态约定打标：

- **GitHub Topics**：`dsh-plugin`（[官方要求](https://github.com/deepseek-ai/deepseek-harness)）、`deepseek-harness`、`dsh`、`agent-skills`
- **可发现性**：三个插件均声明 `dsh.bundle` manifest，可通过 `dsh plugin add` 标准安装（详见各插件 README）
- **收录状态**：已准备 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 投稿文件（见 [docs/awesome-submission/](docs/awesome-submission/)），收录确认后启用上方 badge
- **插件市场**：可关注 [dsh-market](https://github.com/dsh-market/dsh-market)（聚合列表内插件的一键安装/升级市场）

## 目录结构

```text
dsh-skills-plugins/
├── skills/                    # DSH 用户级 Skills（放入 ~/.dsh/skills/ 自动发现）
│   ├── study-review/          # 通用课程资料解析、知识融合、学习笔记与考试复习系统（v1.0）
│   └── markdown-math-writer/  # 按目标渲染器正确书写 Markdown LaTeX 公式（GitHub/mpe/generic，v3.0）
├── plugins/                   # DSH 插件
│   ├── dsh-vision-bridge/     # 视觉路由 + 描述兜底：纯文本主模型也能看图（含本地 OCR）
│   ├── dsh-web-pets/          # Web 桌宠：浏览器内随会话状态换表情的桌宠（可替换形象）
│   └── dsh-computer-use/      # Computer Use：macOS 桌面观察与操作（类似 Codex Computer Use）
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

### 插件：dsh-vision-bridge

```bash
# 方式一：以本地路径安装到 DSH profile
dsh plugin --profile web add file:$(pwd)/plugins/dsh-vision-bridge

# 方式二：复制到任意目录后手动安装
cp -R plugins/dsh-vision-bridge ~/dsh-vision-bridge
# 然后在 profile 的 package.json dependencies 中加入:
#   "dsh-vision-bridge": "file:~/dsh-vision-bridge"
# 并执行 pnpm install
```

安装后**必须**运行视觉准入补丁（dsh 重装或 `dsh plugin add` 触发 pnpm 重链后需重跑）：

```bash
bash plugins/dsh-vision-bridge/bin/apply-vision-patch.sh
```

在 `cordis.patch.yml` 中启用插件并配置视觉模型（示例见插件 README）。

主要能力：含图轮次自动路由到 Qwen VL 原生识别、下一轮自动回到主模型（native 模式）；文字密集图片（截图/文档）先用 macOS Vision **本地 OCR**（零 API 成本、字符级精确）；识别失败自动降级备用引擎；运行参数可用 `~/.dsh/vision-bridge.json` **热配置**（免重启）。详见 [`plugins/dsh-vision-bridge/README.md`](plugins/dsh-vision-bridge/README.md)。

### 插件：dsh-web-pets（Web 桌宠）

```bash
# 方式一：dsh plugin add link:…（自动处理 cordis.patch.yml）
dsh plugin --profile web add link:$(pwd)/plugins/dsh-web-pets

# 方式二：file: 依赖 + 手工在 profile 的 cordis.patch.yml 加 insert 行（id: web-pets）
```

安装后重启 `dsh web`。**并入 dsh-web-ui 的宠物入口**：先装 dsh-web-ui（含鲸鱼宠物 dsh-pet）再装本插件，设置 → Web UI 插件 → 宠物区域出现「宠物选择」卡片，可在鲸鱼娘（上游）/ 豆豆 / 雷米埃尔 / 自定义宠物间切换，**任意时刻只显示一只宠物**；仅装本插件时则是一只独立悬浮宠（右下角）+ 右键菜单（缩放/透明度/锁定/暂停/重置/镜像/切换/隐藏）+ **设置面板**（外观 / 行为 / 更新 / 反馈四栏）。替换/新增宠物形象：往 `plugins/dsh-web-pets/assets/pets/<名字>/` 放 `pet.json` + `emotes/` 即可（详见插件 README）。

**开发与构建**（v0.2.0 起为 TS + tsdown 工程，产物 `lib/` 已提交，安装无需构建）：

```bash
cd plugins/dsh-web-pets
pnpm install        # 安装 tsdown 等 devDependencies
pnpm build          # 重新生成素材 data-URI（scripts/generate-art.mjs）+ tsdown 构建 lib/
pnpm test           # 构建 + node:test 单元测试
```

**自更新闭环**（monorepo link 安装形态）：设置面板「更新」栏可自动检查 GitHub 新版本，发现新版本后一键执行 `git pull --ff-only` + `bash fix-web-profile.sh`（仅接受本机请求，带 120s 超时）。

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
- `dsh-vision-bridge`：本地 OCR 依赖 macOS 自带 Vision（`swift` + `scripts/ocr.swift`），不可用时自动降级到视觉引擎，不影响主流程；
- `dsh-web-pets`：遵循 dsh 官方客户端插件形态（`dsh.client` 声明 + `__ModuleLoader__` bundle），可在任意包含 dsh-web-ui 客户端壳的 profile 中安装。

## 维护 / 开发

- 本仓库是**规范源（canonical）**：本机 DSH 环境的 `dsh-vision-bridge`、`dsh-desktop-pets`（桌面联动）与 `dsh-web-pets` 均通过 `file:` 依赖指向仓库内路径。
- 修改插件：直接改本仓库 `plugins/<name>/`，然后在 profile 目录（`~/.dsh/profiles/web`）执行 `pnpm install` 刷新安装副本（提示 "Already up to date" 时先删除 `node_modules/<name>` 再装），重启 dsh web 生效。
- **硬链接提醒**：`dsh-web-pets` 与 `dsh-vision-bridge` 的 `node_modules` 安装副本是源码的**硬链接**。用编辑器原地编辑源码会保留硬链接（副本自动同步），但若编辑器**替换**文件（写新 inode），旧硬链接仍指向旧内容 → 重启后运行的是旧代码。改完源码后跑一次 `bash fix-web-profile.sh`（幂等，同步三个插件副本并校验一致性），或执行 `pnpm install` 重链，再重启 dsh web。
- 新增 Skill：复制到 `skills/<name>/`（含 `SKILL.md`）提交即可；本地安装 `cp -R skills/<name> ~/.dsh/skills/`（DSH 自动发现，无需重启）。
- 修改 `skills/markdown-math-writer/scripts/` 下脚本：同步更新 `package-lock.json` 并在本地 `npm install` 验证（`node_modules` 不入库）。
- 本机实际安装状态与一致性核对见 [SUMMARY.md](SUMMARY.md)。
- **升级兼容**：升级前对照 [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md)（上游 API 面矩阵）与 [docs/UPGRADE_RUNBOOK.md](docs/UPGRADE_RUNBOOK.md)（流程/回滚），版本基线记录在 [versions.lock.json](versions.lock.json)。
- 注意：`plugins/dsh-vision-bridge` 的打包范围由 `package.json` 的 `files` 字段决定（当前为 `lib` / `README.md` / `scripts` / `bin` / `cordis.patch.yml`）；`plugins/dsh-web-pets` 的打包范围同理（`lib` / `assets` / `src` / `scripts` / `cordis.patch.yml` / `CHANGELOG.md` / `README.md` / `README.en.md` / `LICENSE`）。

## Awesome List 投稿文案

以下为提交 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 用的一句话描述与分类（en / zh 双语文案，投稿 YAML 见 [docs/awesome-submission/](docs/awesome-submission/)）：

| 插件 | 分类 | 一句话描述（en） | 一句话描述（zh） |
| --- | --- | --- | --- |
| `dsh-computer-use` | `tools` | macOS desktop control for agents: observe Accessibility trees and screenshots, click/type/key/scroll with per-app grants and one-time confirmations. | macOS 桌面操控：观察辅助功能树与截图，点击/输入/按键/滚动，带按应用授权与一次性确认。 |
| `dsh-vision-bridge` | `vision` | Vision router for text-only models: Qwen VL captioning on image turns with local macOS Vision OCR fallback. | 视觉路由：纯文本主模型含图轮次自动交给 Qwen VL 识别，附本地 OCR 兜底。 |


> 注：`markdown-math-writer` / `study-review` 为纯 SKILL.md 目录（复制到 `~/.dsh/skills/` 使用），暂不满足 awesome 列表「可 `dsh plugin add` 安装」门槛；如需收录可后续打包为 bundle 插件。

## 第三方插件（仅引用，不复制代码）

本机环境还使用了以下第三方 DSH 插件，版权归其作者所有：

| 插件 | 许可 | 上游 |
|---|---|---|
| `@linxin666/dsh-web-ui-all` 0.2.0（含 dsh-ssh / dsh-task-board / dsh-aionui-panel / dsh-git-graph / dsh-pet / dsh-skins / dsh-remote-web-ui / dsh-tool-describe-image / dsh-liangshen / dsh-client-ui-skill-explorer / dsh-better-sidebar；0.2.0 起移除 dsh-live-stats） | Apache-2.0 | https://github.com/zhu1090093659/dsh-web-ui |

## 许可

MIT License。本仓库所有代码与素材均为作者自有。详见 [LICENSE](LICENSE)（仓库根）、`plugins/dsh-vision-bridge/LICENSE`、`plugins/dsh-web-pets/LICENSE` 与 `projects/desktop-pets/LICENSE`。
