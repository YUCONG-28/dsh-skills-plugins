# dsh-skills-plugins

个人 DeepSeek Harness（DSH）Skill 与插件集合 · Personal collection of DSH skills and plugins.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## 目录结构

```text
dsh-skills-plugins/
├── skills/                    # DSH 用户级 Skills（放入 ~/.dsh/skills/ 自动发现）
│   └── study-review/          # 通用课程资料解析、知识融合、学习笔记与考试复习系统
└── plugins/                   # DSH 插件
    └── dsh-vision-bridge/     # 视觉路由 + 描述兜底：纯文本主模型也能看图
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

### 兼容性

`SKILL.md` 采用 agent-skills 通用格式，兼容 Claude Code / Codex 等生态；`study-review` 的解析脚本仅依赖 Python 标准库与 Ghostscript（`gs`），跨 macOS / Linux 可用。

## 维护 / 开发

- 本仓库是**规范源（canonical）**：本机 DSH 环境的 `dsh-vision-bridge` 已通过 `file:` 依赖指向 `plugins/dsh-vision-bridge`。
- 修改插件：直接改本仓库 `plugins/dsh-vision-bridge/`，然后在 profile 目录（`~/.dsh/profiles/web`）执行 `pnpm install` 刷新安装副本（提示 "Already up to date" 时先删除 `node_modules/dsh-vision-bridge` 再装），重启 dsh web 生效。
- 新增 Skill：复制到 `skills/<name>/`（含 `SKILL.md`）提交即可；本地安装 `cp -R skills/<name> ~/.dsh/skills/`（DSH 自动发现，无需重启）。
- 注意：`plugins/dsh-vision-bridge` 的打包范围由 `package.json` 的 `files` 字段决定（当前为 `lib` / `README.md` / `scripts` / `bin`）。

## 第三方插件（仅引用，不复制代码）

本机环境还使用了以下第三方 DSH 插件，版权归其作者所有：

| 插件 | 许可 | 上游 |
|---|---|---|
| `@linxin666/dsh-web-ui-all`（含 dsh-ssh / dsh-task-board / dsh-aionui-panel） | Apache-2.0 | https://github.com/zhu1090093659/dsh-web-ui |

## 许可

MIT License。详见 [LICENSE](LICENSE)（仓库根）与 `plugins/dsh-vision-bridge/LICENSE`。
