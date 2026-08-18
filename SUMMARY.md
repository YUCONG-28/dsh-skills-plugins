# dsh-skills-plugins — 本地 Skill 与 Plugin 总览（SUMMARY）

> 本文档汇总本机（macOS，dsh web profile）实际安装的 skills 与 plugins 及其与仓库的关系。
> 更新日期：2026-08-17

## 一、Skills（`~/.dsh/skills/` 直接放置，非独立 git 仓库）

| Skill | 版本 | 用途 | 仓库位置 | 状态 |
| --- | --- | --- | --- | --- |
| `study-review` | 1.0 | 课程/资料整理：提炼结构化学习笔记、公式速查、考点梳理 | `skills/study-review/` | 仓库与本地一致 |
| `markdown-math-writer` | 3.0 | 按目标渲染器（GitHub / MPE / 通用）正确书写 Markdown LaTeX 公式 | `skills/markdown-math-writer/` | 仓库与本地一致 |

## 二、Plugins（web profile 实际启用）

web profile `~/.dsh/profiles/web/package.json` 依赖（`file:` 引用本仓库路径）：

| 插件 | 仓库位置 | 安装副本 | 说明 |
| --- | --- | --- | --- |
| `dsh-vision-bridge` | `plugins/dsh-vision-bridge/` | `~/.dsh/profiles/web/node_modules/dsh-vision-bridge` | 自动视觉路由 + 结构化转述 + 本地 OCR（macOS Vision）+ 故障转移；md5 与安装副本一致 |
| `dsh-web-pets` | `plugins/dsh-web-pets/` | `~/.dsh/profiles/web/node_modules/dsh-web-pets` | Web 桌宠（浏览器内随会话状态换表情），service 依赖 `sessions` |
| `dsh-computer-use` | `plugins/dsh-computer-use/` | `~/.dsh/profiles/web/node_modules/dsh-computer-use` | Computer Use：macOS 桌面观察与操作（11 个 computer_* 工具 + computer-use Skill + Swift 原生 helper）；需要辅助功能/屏幕录制权限 |
| `dsh-desktop-pets` | `projects/desktop-pets/integration/dsh-plugin` | `~/.dsh/profiles/web/node_modules/dsh-desktop-pets` | macOS 桌面宠物插件（DSH 会话事件 → 桌宠状态通道） |
| `@linxin666/dsh-web-ui-all` | 第三方 npm | `~/.dsh/profiles/web/node_modules/@linxin666/dsh-web-ui-all` | Web UI 全家桶（含 pet 界面入口），非本仓库维护 |

## 三、启用与同步机制

- **Skills**：复制到 `~/.dsh/skills/<name>/` 即被 dsh 识别；本仓库为唯一源，改动后需同步复制。
- **Plugins**：`~/.dsh/profiles/web/package.json` 用 `file:` 依赖指向本仓库路径（pnpm 安装为硬链接/链接）；**整文件替换会断开硬链接**，改源码后需 `cp` 同步到 `~/.dsh/profiles/web/node_modules/<pkg>/` 并重启 dsh web。
- **vision-bridge 额外注意**：
  - `bin/apply-vision-patch.sh` 放宽 dsh-host-apiproxy 图像准入（作用于实际运行的安装副本：homebrew 全局或 npx 缓存）；dsh 重装或 `dsh plugin add` 触发 pnpm 重链后**必须重跑**。
  - `scripts/ocr.swift` 随插件部署；可用 `swiftc -O ... -o ~/.dsh/vision-bridge-ocr` 预编译加速。
  - 运行参数可热配置（`~/.dsh/vision-bridge.json`，免重启）。

## 四、当前状态

- git：`main` 分支，与 `origin/main`（github.com/YUCONG-28/dsh-skills-plugins）同步，无未推送提交。
- 本次变更：新增 `dsh-computer-use` 插件（阶段 1 核心：Swift helper + 11 个工具 + 安全模型 + Skill），本机 web profile 已启用（file: 依赖 + cordis.patch.yml insert）；`bin/cu-helper` 为本地编译产物（gitignore，架构相关）。
