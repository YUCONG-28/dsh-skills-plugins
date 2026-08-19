# dsh-vision-bridge

DeepSeek Harness 视觉桥接插件（v0.3 双档位重构版）。

**产品体验保持不变**：DeepSeek 仍是主模型，视觉模型按需代理。模型选择里提供两个
**image-capable 虚拟模型**：

- `vision-router / deepseek-v4-flash-vision`（默认，快/省）
- `vision-router / deepseek-v4-pro-vision`（强/稳）

选中任意一个后，官方图像准入直接通过（声明 `inputModalities: [text, image]`），图片轮次自动走
OCR/结构化证据，强视觉任务才整轮交给 Qwen VL；纯文本轮次由对应档位的 DeepSeek 处理。

## 硬性保证

- **不修改任何 DSH node_modules 文件**（P0）。
- **不依赖 `bin/apply-vision-patch.sh`**——该脚本已废弃，默认 NO-OP，绝不自动运行（P1）。
- **不静态导入 `@deepseek-ai/dsh-llm` 等 DSH 包**——适配器为 duck-typed，DSH API 变化时插件只降级对应功能，`dsh web` 永远正常启动（P5）。
- 所有 DSH API 耦合集中在 `adapters/dsh.js`（P2）。
- Schema 全部使用 `@deepseek-ai/schemastery`，无旧式 JSON-Schema union（P6）。

## 新旧架构

```text
旧架构 (v0.1)：
  用户选 DeepSeek（纯文本）
  ├─ 上传图片 → host-apiproxy 准入检查按模型能力拒绝
  │    └─ 必须手工运行 apply-vision-patch.sh 修改 dsh-host-apiproxy 源码
  ├─ agent/request 整轮路由 → Qwen VL（改会话模型，回路由靠 turn 号）
  └─ llm/stream 描述兜底（BlockAssembler 依赖 dsh-llm 内部 API）

新架构 (v0.3)：
  用户选 vision-router / deepseek-v4-flash-vision 或 deepseek-v4-pro-vision（inputModalities 含 image）
  ├─ 官方准入直接通过（无需任何 patch）
  ├─ adapter.stream 内部路由：
  │    ├─ 无图        → DeepSeek 直连
  │    ├─ 新图        → L1/L2 cache → 本地 OCR →（文字密集即注入）
  │    │                  → 远程视觉（batch + fallback chain + timeout）
  │    ├─ 强视觉任务  → 整轮 Qwen VL（上下文预算内）
  │    └─ 历史图      → 缓存 structured evidence，零重复付费
  └─ ctx.visionBridge 服务（Computer Use：ROI OCR 优先，不默认整屏 Vision）
```

## 快速开始

1. 安装插件（`pnpm add file:.../plugins/dsh-vision-bridge`），postinstall 会自动用 `swiftc -O`
   编译 OCR 工具到 `~/.dsh/vision-bridge-ocr`（失败也不阻断，回退 swift 解释执行）。
2. 在 profile 的 `cordis.patch.yml` 中启用：

```yaml
- insert:
    - id: vision-bridge
      name: dsh-vision-bridge
      config:
        mode: auto            # 默认；native/caption 为 legacy 模式
        defaultTier: flash    # 默认 flash；可选 pro
        visionProvider: qwen
        visionModel: qwen-vl-max          # Pro 档视觉引擎
        flashVisionModel: qwen3-vl-flash  # Flash 档视觉引擎
        deepseekProvider: deepseek-official
        deepseekModel: deepseek-v4-pro
        flashDeepseekModel: deepseek-v4-flash
```

3. 在设置 → Models 中选择 `vision-router / deepseek-v4-flash-vision`（默认）
   或 `vision-router / deepseek-v4-pro-vision`。无需运行任何 patch 脚本。

## 配置（节选）

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `mode` | `auto` | `auto` 证据优先 / `native` legacy 整轮路由 / `caption` legacy 描述桥 / `off` 禁用 |
| `routerProvider` | `vision-router` | 虚拟 image-capable provider |
| `routerModel` | `deepseek-v4-pro-vision` | Pro 档虚拟模型 id |
| `flashRouterModel` | `deepseek-v4-flash-vision` | Flash 档虚拟模型 id |
| `defaultTier` | `flash` | 默认档位：`flash` / `pro` |
| `deepseekProvider` / `deepseekModel` | `deepseek-official` / `deepseek-v4-pro` | Pro 档后端主模型 |
| `flashDeepseekModel` | `deepseek-v4-flash` | Flash 档后端主模型 |
| `visionProvider` / `visionModel` | `qwen` / `qwen-vl-max` | Pro 档视觉引擎（旧键 `qwenProvider`/`qwenModel` 自动迁移） |
| `flashVisionModel` | `qwen3-vl-flash` | Flash 档视觉引擎 |
| `fallbackProviders` | `[]` | 视觉 fallback 链 |
| `localOcr` / `ocrMinChars` | `true` / `40` | 本地 OCR 优先，达到字符数即跳过远程视觉 |
| `cacheSize` / `diskCacheSize` | `256` / `1024` | L1 内存 / L2 磁盘缓存条数 |
| `captionTimeoutMs` | `120000` | 单次远程视觉超时（0=不限） |
| `resizeMaxDim` | `1568` | 远程视觉前自适应缩放长边（0=不缩放） |
| `wholeTurn` | `auto` | 整轮路由策略：auto=强视觉才整轮 / never / always |
| `strongVisualKeywords` | 内置中英文列表 | 强视觉关键词 |
| `telemetry` / `telemetryFile` | `log` / `~/.dsh/vision-bridge-telemetry.jsonl` | 结构化性能遥测（file/log/off） |
| `captionFormat` / `strictJson` | `structured` / `true` | 结构化证据与严格 JSON |

旧键 `qwenProvider` / `qwenModel` / `maxTokens` 仍可直接使用，自动映射到新键（P9）。

## 路由策略（P1/P3.12）

每次请求：无图 → DeepSeek；有图 → 缓存命中直接复用；否则本地 OCR 先行（文字密集截图零 API 成本）；
OCR 不足 → 远程视觉（多图 batch、fallback 链、超时中止）；强视觉任务（关键词命中且上下文在预算内）
才整轮路由到 Qwen VL。历史图片始终优先使用缓存的 structured evidence，同一图片不会重复支付远程调用。

## Computer Use（P4）

插件提供 `ctx.visionBridge` 服务，Computer Use 应按以下顺序（已在服务中声明 `priority`）：

```text
DOM/CDP → Accessibility → keyboard → local OCR → ROI Vision → full-screen Vision
```

- `visionBridge.ocrRegion(data, ref, region)`：先裁 ROI 再本地 OCR；
- `visionBridge.describeRegion(data, ref, region)`：ROI OCR 不足时才裁剪/缩放后走 ROI 视觉；
- 绝不默认每个动作都整屏截图 + Vision。

## 缓存（P3.6/P3.7）

缓存键 = `attachmentId + visionModel + promptVersion + schemaVersion + kind`（sha256）。
L1 内存 LRU + L2 磁盘 JSON（`~/.dsh/vision-bridge/cache`，0600）；同图并发请求共享 in-flight 构建，
远程视觉每图至多付费一次。缓存只存派生证据文本，不存原始图像字节。

## 遥测（P8）

JSONL 记录：`route, ocr_ms, vision_ms, cache_hit, provider, fallback_count, input_bytes, processed_bytes, context_tokens, total_ms`。
白名单字段，绝不记录 API key 或图片内容。

## 兼容性（P5/P7）

- 能力探测（feature detection）而非版本号判断；任何可选能力缺失只 WARN + 禁用对应功能。
- `ci/compat-matrix.sh`：local/latest/next 三目标跑 P6 审计、31 项 node:test、import smoke、npm pack、
  以及真实 `dsh web` 启动冒烟（`.dsh-test` profile，临时端口，不碰 `~/.dsh`）。

## 测试

```bash
cd plugins/dsh-vision-bridge
node --test test/unit.test.mjs test/apply.test.mjs   # 31 项
node ci/check-p6.mjs .                                # P6 静态审计
WEB_BOOT=1 bash ci/compat-matrix.sh                  # 全矩阵（含真实 web boot）
```

## 许可

MIT © 2026。