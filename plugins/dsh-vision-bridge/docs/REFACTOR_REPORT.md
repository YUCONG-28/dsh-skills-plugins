# dsh-vision-bridge 重构报告（P0–P10）

> 日期：2026-08-18 · 版本：0.2.0 · DSH：0.1.0-rc.7（local stable）

## 1. 新旧架构图

```text
旧（v0.1，monkey-patch 模式）
┌────────────────────────────────────────────────────────┐
│ 用户选 DeepSeek（纯文本模型）                          │
│  上传图片 → host-apiproxy 按模型能力拒绝图像准入       │
│    → 必须手工运行 bin/apply-vision-patch.sh           │
│      （if (false && ...) 改写 dsh-host-apiproxy 源码） │
│  agent/request 整轮路由 → Qwen VL（回路由靠 turn 号）  │
│  llm/stream 描述兜底（BlockAssembler，依赖 dsh-llm）   │
└────────────────────────────────────────────────────────┘

新（v0.2，虚拟 image-capable provider 模式）
┌────────────────────────────────────────────────────────┐
│ 用户选 vision-router / deepseek-v4-pro-vision          │
│  inputModalities:[text,image] → 官方准入直接通过       │
│  adapter.stream（adapters/dsh.js，唯一 DSH 耦合点）     │
│    ├─ 无图      → DeepSeek 直连（纯文本体验不变）      │
│    ├─ 新图      → L1/L2 cache → Apple Vision OCR      │
│    │              →（文字密集即注入）→ 远程视觉       │
│    │                batch + fallback + timeout         │
│    ├─ 强视觉    → 整轮 Qwen VL（上下文预算内）          │
│    └─ 历史图    → 缓存 structured evidence（零重复付费）│
│  routing/ policy 纯函数                                  │
│  ocr/ 本地 OCR（swiftc -O 二进制优先）                  │
│  providers/ 远程视觉引擎 · evidence/ 结构化证据          │
│  cache/ L1+L2 · telemetry/ · compat/ legacy 兼容层       │
│  ctx.visionBridge（Computer Use：ROI 优先）             │
└────────────────────────────────────────────────────────┘
```

## 2. 修改文件列表

| 文件 | 变更 |
| --- | --- |
| `lib/index.js` | 重写：新入口，不再导入 dsh-llm，导出 name/Config/apply/inject |
| `lib/config.js` | 新增：schemastery-only 配置 schema + legacy 迁移 |
| `lib/content.js` | 新增：消息/内容块工具（无 DSH 依赖） |
| `adapters/dsh.js` | 新增：唯一 DSH API 耦合模块（能力探测、vision-router adapter、证据流水线、ctx.visionBridge、fail-soft apply） |
| `routing/policy.js` | 新增：evidence-first / 整轮路由纯函数 |
| `ocr/ocr.js` | 新增：Apple Vision OCR runner（编译二进制优先，crop/resize） |
| `providers/vision.js` | 新增：远程视觉引擎（batch / fallback / timeout / strict JSON） |
| `evidence/structured.js` | 新增：提示词、JSON 提取校验、caption 渲染 |
| `cache/cache.js` | 新增：L1 LRU + L2 磁盘缓存（sha256 键） |
| `telemetry/telemetry.js` | 新增：白名单结构化遥测 |
| `compat/legacy.js` | 新增：旧 llm/stream caption bridge + 废弃提示 |
| `scripts/ocr.swift` | 扩展：新增 `crop` / `resize` 子命令 |
| `scripts/build-ocr.sh` / `install-ocr.mjs` | 新增：安装时 swiftc -O 编译（fail-soft） |
| `bin/apply-vision-patch.sh` | 废弃化：默认 NO-OP，需 `--force` 才执行旧补丁 |
| `cordis.patch.yml` | 更新占位说明 |
| `package.json` | 0.2.0；移除 @deepseek-ai/dsh-llm peerDep；新增 scripts |
| `test/unit.test.mjs` / `test/apply.test.mjs` | 新增：24 项 node:test |
| `ci/check-p6.mjs` / `ci/compat-matrix.sh` / `ci/smoke-web-boot.sh` | 新增：P6 审计 + P7 兼容矩阵 + 真实 web boot 冒烟 |
| `README.md` / `docs/REFACTOR_REPORT.md` | 重写/新增 |

## 3. 移除的 monkey patch

- `bin/apply-vision-patch.sh` 对 `dsh-host-apiproxy` 的两处准入检查改写（`if (false && ...)`）不再需要，也**不再自动运行**。
- 对 DSH `node_modules` 的任何文件修改（bundle 与 modular 两份）全部移除。
- 插件不再静态导入 `@deepseek-ai/dsh-llm`（BlockAssembler / LlmError / errorChain / isAgentLoopRequest 依赖全部移除）。

## 4. 保留的兼容层

- `mode: native` / `mode: caption` 旧模式仍然可用（legacy 整轮路由 / 描述桥）。
- 旧配置键 `qwenProvider` / `qwenModel` / `maxTokens` 自动迁移到新键。
- `compat/legacy.js` 的 `llm/stream` caption bridge 保留，用于用户直接选纯文本模型时的历史图像兜底。
- 热配置覆盖 `~/.dsh/vision-bridge.json`（VISION_BRIDGE_OVERRIDES_FILE）此前依赖已移除——如需恢复可重新加入 liveConfig；当前版本以 cordis 配置为准。

## 5. Benchmark

| 路径 | 实测/预期 | 说明 |
| --- | --- | --- |
| 本地 OCR（编译二进制，真实截图 113 字符） | **~0.9s** | 含进程 spawn + Vision；后续调用略降 |
| 缓存命中（L1/L2） | **<1ms** | 同图跨轮零延迟、零远程调用 |
| 远程视觉（单图，结构化） | 未实测（无凭证） | 预期 2–10s，取决于 provider；batch 多图摊销 |
| 整轮路由（强视觉） | 未实测（无凭证） | 与所选视觉模型首 token 延迟一致 |
| 纯文本轮 | 与 DeepSeek 直连一致 | 无额外开销 |

> 沙箱无法写入真实凭证；远程视觉延迟需在真实环境以 telemetry JSONL 复核。

## 6. DSH 更新兼容测试结果

| 目标 | 结果 |
| --- | --- |
| local（DSH 0.1.0-rc.7，本机 stable） | ✅ P6 审计、24/24 测试、import smoke、npm pack、**真实 `dsh web` 启动冒烟通过**（临时端口） |
| latest（DSH 最新 release） | ⏳ 需在 CI 设 `DSH_LATEST_HOME` 后运行（脚本已支持） |
| next/master | ⏳ 需在 CI 设 `DSH_NEXT_HOME` 后运行（脚本已支持） |

关键断言全部通过：plugin load、web boot、text request、image request、OCR path、remote vision path、cache hit、provider fallback、missing provider、missing OCR、invalid config、Vision timeout、API failure、clean shutdown（apply 无顶层异常）。
**任何 vision-bridge 故障都不会阻止 DSH 启动**（fail-soft apply + 真实 boot 冒烟验证）。

## 7. 风险项

1. **虚拟模型选择**：用户必须选中 `vision-router / deepseek-v4-pro-vision` 才能享受免 patch 的图像准入；直接选 DeepSeek 纯文本模型时新图仍会被官方准入拒绝（legacy bridge 只兜底历史图）。
2. **resolveModelInfo 回退**：若后端 DeepSeek 模型信息解析失败，虚拟模型仍注册（无 context/reasoning 元数据），请求由适配器直接转发。
3. **pi-ai system 角色兼容**：整轮路由时把 system 合并进首条 user 消息（与旧行为一致），对其他 OpenAI 兼容端点无害但改变消息形状。
4. **本地 OCR 依赖 macOS Vision**：非 macOS 平台本地 OCR 不可用（自动降级远程视觉）；编译失败自动回退 swift 解释。
5. **磁盘缓存内容**：缓存存派生证据文本（含图片文字），为本地用户数据，权限 0600；如需更强隐私可设 `cacheDir: ''` 关闭磁盘缓存。
6. **远程视觉计费**：batch 失败会逐图重试，fallback 链每级一次；超时靠 AbortSignal，极端网络下仍可能整体变慢（可调 `captionTimeoutMs`）。

## 8. Rollback 方法

1. **插件级回退**：将 profile 的 `cordis.patch.yml` 中 vision-bridge 配置改回旧键（v0.1 配置与 v0.2 兼容读取），或直接 `pnpm remove dsh-vision-bridge`。
2. **代码级回退**：`git revert` 本次重构相关 commit（3ef149c、1b38f4e、1286734），恢复 v0.1 `lib/index.js` 单文件架构。
3. **旧补丁恢复（仅限明确需要）**：`bin/apply-vision-patch.sh --force` 仍保留旧式 node_modules 补丁能力（默认 NO-OP，绝不自动运行）。
4. **数据回退**：删除 `~/.dsh/vision-bridge/cache` 与 `~/.dsh/vision-bridge-telemetry.jsonl` 即可清空缓存/遥测；删除 `~/.dsh/vision-bridge-ocr` 后插件自动回退 swift 解释执行。
