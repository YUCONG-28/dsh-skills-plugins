# dsh-computer-use

**DSH Computer Use** —— 为 DeepSeek Harness 提供类似 Codex Computer Use 的 macOS 桌面操控能力：Agent 可以观察并操作桌面应用（列表、Accessibility 树观察、点击、输入、按键、滚动、拖拽），采用「先观察再动作、动作后返回新鲜状态验证」的循环。

设计参考 [@anionex/dsh-computer-use](https://github.com/Anionex/dsh-computer-use)（accessibility-first、stale-observation 保护、按应用授权、一次性确认）与 [Codex Computer Use](https://github.com/thatjuan/agent-skills/blob/main/skills/engineering/codex-computer-use/SKILL.md)（观察→动作→截图验证循环）。

## 能力

| 工具 | 用途 |
|---|---|
| `computer_list_apps` | 列出运行中的 GUI 应用（名称/bundleId/pid/前台） |
| `computer_observe` | 新鲜 Accessibility 树 + 可选截图 artifact（元素带 `[path]` 索引与 handle） |
| `computer_click` | 点击元素（AXPress 语义优先，可窗口内坐标 fallback） |
| `computer_set_value` | 设置/清空可编辑值（不经剪贴板） |
| `computer_type_text` | 输入文本（**敏感**，需一次性确认） |
| `computer_press_key` | 有限词表按键 + modifiers（带 command/control 为**敏感**） |
| `computer_scroll` | 定向滚动 up/down/left/right |
| `computer_drag` | 窗口内两点拖拽（**敏感**，需确认） |
| `computer_perform_action` | 执行元素声明的 accessibility action（**敏感**，需确认） |
| `computer_wait` | 轮询 text/role/title 条件直至满足或超时 |
| `computer_confirm` | 为敏感动作签发一次性 confirmationToken |
| `computer_batch` | 批量执行 1~10 个确定性动作（Phase 3：一次执行一次验证，减少 LLM 往返） |

## 安全模型

- **TCC 权限**：观察/操作需要「辅助功能」；截图需要「屏幕录制」。权限缺失返回可操作的 `COMPUTER_PERMISSION_REQUIRED` / `COMPUTER_SCREEN_RECORDING_REQUIRED`，插件只引导授权、绝不程序化授权。
- **按应用授权**：read（观察）/ control（控制）租约按 bundle-id 分开；无预授权时走 DSH approval（用户批准）；拒绝后 session 内保持最终。
- **敏感动作一次性确认**：输入文本/拖拽/执行 action/带 command 修饰的按键必须先用 `computer_confirm` 签发 token（短 TTL、一次性、绑定应用与 observation）。
- **陈旧状态拒绝**：动作必须引用未过期的 `observationId`；元素变化后返回 `COMPUTER_TARGET_STALE`，绝不猜测。
- **不干扰用户**：默认不移动系统光标、不做全局 HID 注入；输入定向投递目标 pid（`CGEvent.postToPid`）；`pointerInputPolicy: deny` 可禁用坐标 fallback/滚动/拖拽。
- **提示注入防护**：观察到的 UI 文本只是数据（Skill 与系统通告双重声明）。
- **fail-closed**：helper 协议错误/超时/非零退出一律返回结构化错误，插件任何异常不影响 DSH 本体。

## 安装

```bash
# 1. 安装插件（file: 依赖 + cordis.patch.yml insert）
dsh plugin --profile web add file:/Users/yucong/Documents/Deepseek Harness/dsh-skills-plugins/plugins/dsh-computer-use

# 2. 编译原生 helper + 自检 + 打印 TCC 指引
bash plugins/dsh-computer-use/scripts/install.sh

# 3. 按指引在 系统设置 → 隐私与安全性 授权「辅助功能」（必需）与「屏幕录制」（截图用）
#    授权对象是运行 dsh 的宿主进程（终端应用或 dsh 宿主）

# 4. 重启 dsh web，新建会话，加载 Skill
#    /computer-use
```

### 手动安装（不通过 dsh plugin）

在 `~/.dsh/profiles/web/package.json` 的 dependencies 中加入：

```json
"dsh-computer-use": "file:/Users/yucong/Documents/Deepseek Harness/dsh-skills-plugins/plugins/dsh-computer-use"
```

然后在 `~/.dsh/profiles/web/cordis.patch.yml` 加入：

```yaml
- insert:
    - id: computer-use
      name: dsh-computer-use
```

再执行 `cd ~/.dsh/profiles/web && pnpm install && bash <插件路径>/scripts/install.sh`。

## 配置（cordis.patch.yml 的 computer-use: config）

| 字段 | 默认 | 说明 |
|---|---|---|
| `enabled` | `true` | 总开关 |
| `announceToAgent` | `true` | 是否向模型通告本插件 |
| `observationTtlMs` | `0` | observation 允许复用的生命周期（0=不过期，上限 24h） |
| `confirmationTtlMs` | `60000` | 一次性确认 token 生命周期 |
| `actionTimeoutMs` | `30000` | helper 单次调用硬超时 |
| `settleMs` | `250` | 动作后重观察前的延迟 |
| `maxNodes` / `maxDepth` | `300` / `24` | Accessibility 树遍历上限 |
| `screenshot.artifactRoot` | `computer-use` | workspace 内截图目录 |
| `interaction.focusPolicy` | `preserve` | `preserve`（默认不激活目标）\| `activate` |
| `interaction.keyboardPolicy` | `preserve` | 键盘是否先激活目标应用 |
| `interaction.pointerInputPolicy` | `targeted` | `targeted`（定向指针）\| `deny`（禁用坐标/滚动/拖拽） |
| `helper.path` | `''` | 显式外部 helper 可执行路径 |
| `allowAllApps` | `false` | 向所有应用授予 read/control |
| `grants` | `[]` | 精确 bundle-id 授权：`[{bundleId, read, control}]` |

## 使用示例

1. 加载 Skill：`/computer-use`
2. 列出应用：`computer_list_apps`
3. 观察：`computer_observe({ pid: 42128, screenshot: true })`
4. 点击：`computer_click({ observationId: "obs-...", handle: "0.3.7" })`
5. 输入（敏感）：`computer_confirm({ observationId, handle, action: "computer_type_text", reason: "在搜索框输入关键词" })` → 用返回的 token 执行 `computer_type_text`
6. 验证：读动作返回的 diff 与新 observation；必要时截图交给视觉模型

## 限制

- 仅 macOS（本机 macOS 14+；Windows/Linux provider 未实现）。
- 自定义 canvas、游戏、强化输入 surface 可能拒绝目标进程输入——优先语义 Accessibility 动作。
- 观察是离散快照，不提供实时桌面流。
- 浏览器任务应继续使用浏览器自动化（DOM/CDP 状态更窄更精确）。
- 截图可能包含其他敏感数据，请按敏感数据对待。

## 开发

- 手写 ESM，无构建步骤；原生 helper 为 Swift 单文件（`scripts/cu-helper.swift`）。
- 修改 helper 后：`bash scripts/build-helper.sh` 重新编译。
- 纯逻辑（observation 模型、授权）在 `lib/observations.js` / `lib/grants.js`，可单测。
- 冒烟：`bash scripts/smoke.sh`（helper 层无需权限；`--e2e` 需要辅助功能授权，真实操作 TextEdit 验证 observe/click/set-value/type-text 链路）。
- 测试发现的平台细节：
  - **键盘输入的三个前提**（缺一不可，helper 已自动处理）：
    1. **ASCII 输入法**：拼音/五笔/日文/韩文等非 ASCII 输入法会拦截合成键盘事件（进入候选窗）——检测到冲突返回 `COMPUTER_INPUT_METHOD_CONFLICT`，提示切到 ABC/English 或改用 `computer_set_value`（语义写入不受输入法影响，可写中文）；
    2. **目标控件有 first responder**：activate 应用 ≠ 焦点在目标控件——`activate` 模式会先**全局鼠标点击元素中心**建立 first responder，再输入（真实模拟用户点击输入框再打字）；`preserve` 模式仅尽力 AX 聚焦；
    3. **字符间隔**：全局键盘逐字符 12ms 间隔（`postTextGlobal`），否则应用 run loop 消化不及丢字符。
  - **激活与全局输入**：`keyboardPolicy: activate` / `focusPolicy: activate` 时使用全局事件（`CGEventPost`，会移动系统光标、抢焦点，可靠）；`preserve` 用定向投递（`postToPid`，不干扰但后台应用可能丢字符）。`postToPid` 对已激活应用无效。
  - **command 组合键**（Cmd+N/Cmd+O/Cmd+W 等）需要 HID 事件源 + keyDown 后 30ms 间隔才被识别。
  - JSON 数字在 Swift 中统一经 `NSNumber` 读取（`jsonDouble`/`jsonInt`），避免 `as! Double` 崩溃。
  - macOS 15+ 截图走 `screencapture` CLI（`CGWindowListCreateImage` 已废弃）。

## 配置补充说明

- `interaction.keyboardPolicy`：
  - `preserve`（默认）：不激活目标应用，键盘事件定向投递（`postToPid`）——**不干扰用户，但后台应用可能丢字符**，适合只读/低交互场景；
  - `activate`：键盘输入前激活目标应用，确认其为前台后用全局键盘（`CGEventPost`，逐字符 12ms 间隔）——**可靠但会短暂抢焦点**，适合真实输入任务。
- 语义输入优先：文本类输入建议优先 `computer_set_value`（AX value 整值写入，不受输入法/焦点影响，可写中文）；键盘输入（`computer_type_text`）用于需要真实按键语义的场景，且应提供 `handle` 让插件先点击聚焦目标控件，并确保系统输入法为 ASCII（ABC/English）。

## 许可

MIT © 2026。详见 [LICENSE](LICENSE)。
