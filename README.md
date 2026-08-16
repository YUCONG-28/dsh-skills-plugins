# dsh-skills-plugins

个人 DeepSeek Harness（DSH）Skill 与插件集合 · Personal collection of DSH skills and plugins.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## 目录结构

```text
dsh-skills-plugins/
├── skills/                    # DSH 用户级 Skills（放入 ~/.dsh/skills/ 自动发现）
│   └── study-review/          # 通用课程资料解析、知识融合、学习笔记与考试复习系统
├── plugins/                   # DSH 插件
│   ├── dsh-vision-bridge/     # 视觉路由 + 描述兜底：纯文本主模型也能看图
│   └── dsh-web-pets/          # Web 桌宠：浏览器内随会话状态换表情的桌宠（可替换形象）
└── projects/                  # 独立项目（规范源）
    └── desktop-pets/          # macOS 原生多桌宠桌面库（AppKit/PyObjC，desktop-pets 原仓库内容）
```

## 安装方法

### Skill：study-review

```bash
# 方式一：复制（推荐，独立副本）
cp -R skills/study-review ~/.dsh/skills/

# 方式二：符号链接（保持与仓库同步）
ln -s "$(pwd)/skills/study-review" ~/.dsh/skills/study-review
```

安装后无需重启：DSH 的 skill watcher 会自动发现，新会话中模型可见 `study-review` 并可调用。

### 插件：dsh-vision-bridge

```bash
# 方式一：以本地路径安装到 DSH profile
dsh plugin add file:$(pwd)/plugins/dsh-vision-bridge

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

### 插件：dsh-web-pets（Web 桌宠）

```bash
# 方式一：dsh plugin add link:…（自动处理 cordis.patch.yml）
dsh plugin --profile web add link:$(pwd)/plugins/dsh-web-pets

# 方式二：file: 依赖 + 手工在 profile 的 cordis.patch.yml 加 insert 行（id: web-pets）
```

安装后重启 `dsh web`。**并入 dsh-web-ui 的宠物入口**：先装 dsh-web-ui（含鲸鱼宠物 dsh-pet）再装本插件，设置 → Web UI 插件 → 宠物区域出现「宠物选择」卡片，可在鲸鱼娘（上游）/ 豆豆 / 雷米埃尔 / 自定义宠物间切换，**任意时刻只显示一只宠物**；仅装本插件时则是一只独立悬浮宠（右下角）+ 右键菜单切换/调大小/隐藏。替换/新增宠物形象：往 `plugins/dsh-web-pets/assets/pets/<名字>/` 放 `pet.json` + `emotes/` 即可（详见插件 README）。

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

`SKILL.md` 采用 agent-skills 通用格式，兼容 Claude Code / Codex 等生态；`study-review` 的解析脚本仅依赖 Python 标准库与 Ghostscript（`gs`），跨 macOS / Linux 可用。`dsh-web-pets` 遵循 dsh 官方客户端插件形态（`dsh.client` 声明 + `__ModuleLoader__` bundle），可在任意包含 dsh-web-ui 客户端壳的 profile 中安装。

## 维护 / 开发

- 本仓库是**规范源（canonical）**：本机 DSH 环境的 `dsh-vision-bridge`、`dsh-desktop-pets`（桌面联动）与 `dsh-web-pets` 均通过 `file:` 依赖指向仓库内路径。
- 修改插件：直接改本仓库 `plugins/<name>/`，然后在 profile 目录（`~/.dsh/profiles/web`）执行 `pnpm install` 刷新安装副本（提示 "Already up to date" 时先删除 `node_modules/<name>` 再装），重启 dsh web 生效。
- **硬链接提醒**：`dsh-web-pets` 与 `dsh-vision-bridge` 的 `node_modules` 安装副本是源码的**硬链接**。用编辑器原地编辑源码会保留硬链接（副本自动同步），但若编辑器**替换**文件（写新 inode），旧硬链接仍指向旧内容 → 重启后运行的是旧代码。改完源码后跑一次 `bash fix-web-profile.sh`（幂等，同步三个插件副本并校验一致性），或执行 `pnpm install` 重链，再重启 dsh web。
- 新增 Skill：复制到 `skills/<name>/`（含 `SKILL.md`）提交即可；本地安装 `cp -R skills/<name> ~/.dsh/skills/`（DSH 自动发现，无需重启）。
- 注意：`plugins/dsh-vision-bridge` 的打包范围由 `package.json` 的 `files` 字段决定（当前为 `lib` / `README.md` / `scripts` / `bin`）；`plugins/dsh-web-pets` 的打包范围同理（`lib` / `assets` / `cordis.patch.yml` / `README.md` / `LICENSE`）。

## 第三方插件（仅引用，不复制代码）

本机环境还使用了以下第三方 DSH 插件，版权归其作者所有：

| 插件 | 许可 | 上游 |
|---|---|---|
| `@linxin666/dsh-web-ui-all`（含 dsh-ssh / dsh-task-board / dsh-aionui-panel） | Apache-2.0 | https://github.com/zhu1090093659/dsh-web-ui |

## 许可

MIT License。本仓库所有代码与素材均为作者自有。详见 [LICENSE](LICENSE)（仓库根）、`plugins/dsh-vision-bridge/LICENSE`、`plugins/dsh-web-pets/LICENSE` 与 `projects/desktop-pets/LICENSE`。
