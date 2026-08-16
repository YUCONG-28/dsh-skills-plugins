# desktop-pets · 多桌宠桌面库（macOS 原生）

一套通用引擎（AppKit / PyObjC）驱动任意多只桌面宠物：桌宠即「表情素材 + `pet_spec.json` + 8 行薄壳」，新增桌宠零引擎改动。桌宠与 AI 编码助手实时联动（**opencode 与 DeepSeek Harness 双通道**）：助手工作时桌宠自动切换表情、弹出气泡。

> 本目录是 desktop-pets 项目在 dsh-skills-plugins 仓库中的规范位置（`projects/desktop-pets/`）。配套的 DSH Web 桌宠插件见仓库 [`plugins/dsh-web-pets/`](../../plugins/dsh-web-pets/)（在浏览器内显示桌宠，与 macOS 原生版共用同一套宠物素材协议）。

现内置两只桌宠：

| 桌宠 | 名称 | 表情来源 |
|---|---|---|
| remiel | 雷米埃尔 | 本仓库自有素材 |
| demo | 豆豆 | 本仓库 `scripts/generate_demo_emotes.py` 程序生成 |

## 功能总览

| 功能 | 说明 |
|---|---|
| 状态动画 | 助手状态 → 桌宠表情：`idle` 待机、`thinking` 思考、`waiting` 等待（3 号表情）、`running` 干活、`success` 庆祝（4 秒后回 idle）；超时自动回退 |
| 头顶气泡 | 助手工具调用/完成以气泡呈现（`run`/`done`/`finish`/`think`），矩形/云朵两种形状，槽位浮动动画 |
| 摸头互动 | 点击桌宠 → 气泡反馈 + 亲密度 +1（10s 冷却） |
| 喂食 | 右键菜单「喂食」→ 消耗 1 条小鱼干 + 亲密度 +5（30s 冷却） |
| 小鱼干经济 | 库存上限 20：工作每 3 回合 +1 条、每 30 分钟 +1 条；不足提示「多陪小家伙工作一会儿」 |
| 亲密度成长 | 每完成一个回合 +1；4 级：初识 → 伙伴 → 挚友 → 羁绊（100 分封顶） |
| 自定义命名 | 右键「改名…」→ 1–20 字符，持久化，菜单栏同步显示 |
| 隐藏/召唤 | 右键「隐藏宠物」；菜单栏图标「显示宠物」随时召回 |
| 状态栏图标 | 菜单栏显示当前状态与亲密度（等级 · 分数 · 小鱼干库存），可打开网页版、退出 |

## 联动原理

助手端插件读取 `~/.config/desktop-pets.json`（**优先**）或 `~/.config/opencode/desktop-pets.json`（回退，`root` + `active`），再读活动桌宠的 `pet_spec.json` 拿到状态通道；把助手事件翻译成状态与气泡写入通道（remiel = `/tmp/remiel-pet.state`、`/tmp/remiel-pet.bubble`；demo 同理）。桌宠每 300ms 轮询一次，按状态换表情、按气泡文件弹气泡。

**两个联动插件共用同一通道协议，引擎零改动消费任一来源：**

| 事件 | 状态 | 气泡 |
|---|---|---|
| `step/start` / opencode 收到用户消息 | thinking | 💭 思考中… |
| `tool/call` / 工具执行前 | running | 🛠 工具 · 参数预览 |
| `turn/end`（completed）/ 会话空闲 | success | 🎉 完成！ |
| `turn/end`（中止/失败） | idle | — |
| 会话销毁 | idle | 清空 |

- **opencode 联动**：复制 `integration/desktop-pets-plugin.js` 到 `~/.config/opencode/`，在 `opencode.jsonc` 的 `plugin` 数组加入 `"./desktop-pets-plugin.js"`，重启 opencode。
- **DeepSeek Harness 联动**：运行 `integration/dsh-plugin/install.sh`（写入 `~/.dsh/profiles/web/` 依赖与 cordis patch），重启 `dsh web`；插件订阅 `session/event`，自检标记 `/tmp/desktop-pets-dsh.loaded`。

## 目录结构

| 路径 | 说明 |
|---|---|
| `core/pet_engine.py` | 通用引擎（macOS 原生 AppKit / PyObjC，全部桌宠共用） |
| `core/pet_profile.py` | 互动账本纯逻辑：亲密度 / 小鱼干经济 / 原子持久化 |
| `pets/<名称>/` | 桌宠目录：`pet.py`（8 行薄壳）+ `pet_spec.json`（规格）+ `emotes/`（表情 GIF）+ `pet.html`（网页版）+ `.pet-config.json`（显示设定）+ `.pet-profile.json`（互动账本，自动生成） |
| `scripts/petctl.sh` | 多桌宠管理脚本（start / stop / status / enable / disable / run） |
| `scripts/generate_demo_emotes.py` | demo 表情程序生成器（PIL，可重复运行） |
| `integration/` | opencode 插件、DSH 联动插件（`dsh-plugin/`）、LaunchAgent |
| `tests/` | 单元测试（`core/pet_profile.py`，unittest） |
| `docs/` | 使用说明（macOS）+ 添加新桌宠指南 |
| `reference/` | 历史归档：旧 Linux / Claude Code 配置包（`说明书.md` / `install.sh` / `claude-config/`）与旧版单宠插件（`legacy/`） |

## 快速开始（macOS）

1. **依赖**（Python 3.9 + pyobjc + Pillow）：
   ```bash
   /usr/bin/python3 -m venv .venv
   .venv/bin/pip install "pyobjc-framework-Cocoa==11.0" "Pillow==11.3.0"
   ```
2. **启动**：
   ```bash
   scripts/petctl.sh remiel start
   ```
3. **联动**：按上文接入 opencode 或 DSH 插件其一即可。
4. **登录自启**：复制 `integration/com.desktop-pets.plist` 到 `~/Library/LaunchAgents/`，然后：
   ```bash
   scripts/petctl.sh enable
   ```
   （LaunchAgent 以 `petctl.sh run` 前台模式拉起桌宠，桌宠即 launchd 作业主进程，登录自启后持续存活）

## 测试

```bash
.venv/bin/python3 -m unittest discover tests
```

覆盖：亲密度冷却/封顶/等级边界、小鱼干惰性结算（锚点首写与死锁回归）、消耗、持久化往返与坏文件容错。

## 切换 / 添加桌宠

- **切换**：改 `~/.config/desktop-pets.json`（或 opencode 版）的 `active` 字段后重启桌宠（`petctl.sh <旧名> stop` → 改 `active` → `petctl.sh start`）。
- **添加**：新建一个桌宠目录即可，零引擎改动。完整步骤见 [`docs/添加新桌宠.md`](docs/添加新桌宠.md)。
- **详细用法**：见 [`docs/使用说明-macos.md`](docs/使用说明-macos.md)（以 remiel 为例）。

## 硬编码说明

仅一处写死了绝对路径：LaunchAgent `com.desktop-pets.plist` 里的 petctl 路径（opencode 插件 `desktop-pets-plugin.js` 的 `root` 缺省值也已指向本仓库规范路径，但以 `~/.config/desktop-pets.json` 配置为准）。`petctl.sh` 通过自身路径自动推导库根目录，引擎通过桌宠目录定位素材，DSH 插件从自身位置推导仓库根，均无硬编码。搬家后改上述一处即可（详见使用说明第八节）。

## 许可

MIT License。本仓库所有代码与素材均为作者自有（demo 表情由 `scripts/generate_demo_emotes.py` 程序生成）。
