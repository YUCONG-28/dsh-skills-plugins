# 兼容性矩阵（COMPATIBILITY）

> 记录本仓库每个插件/skill 依赖的**上游 API 面**与风险等级，供升级前对照。
> 更新日期：2026-08-18（dsh-web-ui-all 0.2.0 验证基线）
> 配套文档：[UPGRADE_RUNBOOK.md](UPGRADE_RUNBOOK.md) · [versions.lock.json](../versions.lock.json) · [UPGRADE_CHECKLIST.md](UPGRADE_CHECKLIST.md)

## 风险等级约定

- 🔴 高：上游改动会直接破坏功能，升级必须回归
- 🟡 中：上游改动可能导致静默失效/降级，需要人工确认
- 🟢 低：仅有间接依赖，升级大概率无影响

## 一、本库插件 → 上游 API 面

| 插件 | 依赖的上游 API 面 | 上游包 | 风险 |
| --- | --- | --- | --- |
| `dsh-web-pets` | `web-ui.plugin.item` 槽位（dsh-web-ui 宠物入口的宠物选择卡片） | `@linxin666/dsh-pet` / `@linxin666/dsh-web-ui-all` | 🔴 |
| `dsh-web-pets` | dsh-pet 的 `pet` 设置命名空间（`enabled` 写开关），经 `webUiSettings`/`settingsScope` 绑定器 | `@linxin666/dsh-pet` | 🔴 |
| `dsh-web-pets` | dsh-pet 显示参数（size / right / bottom / name，同名同界） | `@linxin666/dsh-pet` | 🟡 |
| `dsh-web-pets` | 客户端 DOM 增强信号（`[data-cordis-approve]` / `[data-question-key]` / `[data-plan-review-key]` / `[data-chat-flow-kind]`）——默认关闭 | dsh-web-ui 客户端 DOM（非契约接口） | 🟡（缺省关闭，探测失败静默降级） |
| `dsh-web-pets` | GitHub REST API（releases/tags 自更新检查，带直连 + pinned + 本地代理回退） | api.github.com（外部） | 🟢 |
| `dsh-web-pets` | `@deepseek-ai/dsh-host-webserver` 路由注册（新增 /info /check /update，Host 本地校验） | DSH 核心 | 🟢 |
| `dsh-vision-bridge` | pi-ai provider 声明（qwen：apiKeyEnv / baseURL / models / thinkingFormat） | `@deepseek-ai/dsh-llm`（settings.yaml `llm-pi-ai`） | 🟡 |
| `dsh-vision-bridge` | DashScope 兼容端点角色限制（systemPrompt→首条 user 消息的 developer-role 兼容处理） | DashScope API（外部） | 🟡 |
| `dsh-vision-bridge` | dsh-host-apiproxy 图像准入（`bin/apply-vision-patch.sh` 放宽） | `@deepseek-ai/dsh-host-apiproxy` | 🔴（dsh 重装后必须重跑补丁） |
| `dsh-computer-use` | `@deepseek-ai/dsh-tools` 工具注册协议 + macOS Accessibility/TCC 权限模型 | DSH 核心 / macOS | 🟡 |
| `dsh-desktop-pets` | `@deepseek-ai/dsh-session` 服务名 `sessions`（复数） | DSH 核心 | 🟡 |
| describe-image override | profile 级 id 定向覆盖 `web-ui-describe-image` 的 config（baseURL/apiStyle/model/apiKeyEnv/maxOutputTokens/timeoutMs/interceptImageSend） | `@linxin666/dsh-web-ui-all` | 🔴（上游改 id 或 config 形状则静默失效） |
| `dsh-liangshen` 预设 | `~/.dsh/.agent-presets/liangshen` 由 `@linxin666/dsh-liangshen` 插件维护 | `@linxin666/dsh-liangshen` | 🟡（升级自动更新，需验证 persona 仍在） |

## 二、Skills 依赖面

| Skill | 依赖 | 风险 |
| --- | --- | --- |
| `markdown-math-writer` | 运行时仅 Node.js（scripts/ 自带依赖），无 DSH 运行时 API | 🟢 |
| `study-review` | Python 标准库 + Ghostscript（`gs`），无 DSH 运行时 API | 🟢 |

## 三、上游版本基线（2026-08-18）

| 包 | 验证版本 | 说明 |
| --- | --- | --- |
| `@linxin666/dsh-web-ui-all` | 0.2.0 | 聚合包；0.2.0 新增 skill-explorer / better-sidebar，**移除 live-stats** |
| `@deepseek-ai/dsh-base` / `@deepseek-ai/dsh-web-app` | profile bundles（随 dsh 版本） | 见 `~/.dsh/profiles/web/package.json` |

## 四、升级前必查清单（摘要）

1. 读上游 release notes：[zhu1090093659/dsh-web-ui](https://github.com/zhu1090093659/dsh-web-ui/releases)
2. 对照上表 🔴 项逐一回归（见 [UPGRADE_CHECKLIST.md](UPGRADE_CHECKLIST.md)）
3. 检查 bundle patch 与 profile patch 合并后 insert 是否重复/缺失
4. 完整流程见 [UPGRADE_RUNBOOK.md](UPGRADE_RUNBOOK.md)
