# desktop-pets 多桌宠库使用说明（macOS 原生版）

> 版本：desktop-pets 多桌宠库 · macOS 原生版（AppKit / PyObjC）；本文档以 remiel（雷米埃尔）为例
> 运行环境：Python 3.9 + pyobjc + Pillow（桌宠库目录内的 `.venv` 虚拟环境）
> 适用系统：macOS（桌面版为原生窗口，无 XWayland / GTK 依赖）

desktop-pets 是一个「多桌宠」桌面库：一个通用引擎（AppKit / PyObjC）驱动任意多只桌宠，每只桌宠只是「表情素材 + `pet_spec.json` + 8 行薄壳」的目录。目前内置两只：remiel（雷米埃尔）与 demo（豆豆，表情由本仓库程序生成）。本文档以 remiel 为例，其余桌宠的操作方式完全一致，只是把 `remiel` 换成对应桌宠名。

---

## 一、功能总览

整套桌宠库由四部分组成：

| 部分 | 说明 |
|---|---|
| 通用引擎 | `core/pet_engine.py`，透明无边框、置顶的小窗口，默认停靠屏幕右下角。根据状态通道轮换 5 个 GIF 表情，头顶弹出气泡。所有桌宠共用同一份引擎 |
| 桌宠目录 | `pets/<名称>/`，一只桌宠一个目录：`pet.py`（薄壳）、`pet_spec.json`（规格）、`emotes/`（表情）、`pet.html`（网页版）、`.pet-config.json`（用户设定） |
| 菜单栏图标 | 桌宠启动后，顶部菜单栏出现对应的小图标（18 像素）。点击可查看当前状态、打开网页版桌宠、退出宠物 |
| 网页版电子宠物 | `pets/<名称>/pet.html`，用浏览器打开，是独立的电子宠物玩法（喂食、跳舞、睡觉、洗澡）。与桌面版互不干扰，可以同时开着 |

**工作方式**：每只桌宠是独立进程，自己会显示待机表情。它通过 `/tmp` 下的状态通道感知 opencode 的状态：opencode 干活时往通道文件写 `thinking` / `running` 等值，桌宠每 300 毫秒轮询一次，按状态换表情、按气泡文件弹气泡。每只桌宠的通道由它自己的 `pet_spec.json` 定义（remiel = `/tmp/remiel-pet.state`、`/tmp/remiel-pet.bubble`；demo = `/tmp/demo-pet.state`、`/tmp/demo-pet.bubble`），互不串扰。

**目录可移动**：桌宠库整体可以移动、改名。petctl 通过自身路径自动推导库根目录，引擎通过桌宠目录定位表情和配置，都不依赖绝对路径。只有一处写死了绝对路径需要手工跟着改：LaunchAgent 里的 petctl 路径（见第八节）。

---

## 二、启动 / 停止 / 状态命令

桌宠库自带管理脚本 `scripts/petctl.sh`，支持六个子命令。下面统一用 `<库根>/scripts/petctl.sh` 形式（本仓库规范路径：`projects/desktop-pets/`，即 dsh-skills-plugins 仓库内目录），实际路径以你的桌宠库目录为准。

### 通用用法

```bash
<库根>/scripts/petctl.sh [pet] {start|stop|status|enable|disable|run}
```

- `pet` 为桌宠名（remiel / demo），**可省略**：省略时作用于「活动桌宠」（`~/.config/opencode/desktop-pets.json` 的 `active` 字段，当前为 remiel）
- `start` / `stop` / `status` / `run` 需要（或缺省）桌宠名；`enable` / `disable` 管的是 LaunchAgent，与具体桌宠无关
- `run` 是**前台运行**：exec 直接运行桌宠（不后台），供 LaunchAgent 使用——桌宠成为 launchd 作业主进程，作业存活即桌宠存活

### 启动

```bash
<库根>/scripts/petctl.sh remiel start
```

首次启动输出：

```
[pet] remiel 启动中（后台运行，日志: /Users/yucong/Documents/Deepseek Harness/dsh-skills-plugins/projects/desktop-pets/pets/remiel/pet.log）
[pet] remiel 启动成功（PID 12345）
```

桌宠已在运行时输出（不会重复拉起）：

```
[pet] remiel 已在运行（PID 12345 ），无需重复启动
```

启动失败时输出：

```
[pet] remiel 未检测到进程（可能被单实例锁拦截或启动失败，见 /Users/yucong/Documents/Deepseek Harness/dsh-skills-plugins/projects/desktop-pets/pets/remiel/pet.log）
```

### 停止

```bash
<库根>/scripts/petctl.sh remiel stop
```

```
[pet] remiel 已发送停止信号
```

本来就没在运行时：

```
[pet] remiel 未运行，无需停止
```

### 查看状态

```bash
<库根>/scripts/petctl.sh remiel status
```

运行中（退出码 0）：

```
[pet] remiel 运行中:
  12345 /usr/bin/python3 /Users/yucong/Documents/Deepseek Harness/dsh-skills-plugins/projects/desktop-pets/pets/remiel/pet.py
```

未运行（退出码 1）：

```
[pet] remiel 未运行
```

> petctl 按进程命令行里的 `pets/<pet>/pet.py` 匹配，无论桌宠是用哪种方式启动的（nohup 后台、LaunchAgent、opencode 插件拉起）都能识别。

### 手动前台运行（调试用）

```bash
<库根>/.venv/bin/python3 <库根>/pets/remiel/pet.py
```

前台跑会直接打印日志到终端，便于看报错。桌宠出现后按 `Q` 或 `Esc`（需要先点一下窗口）即可退出，`Ctrl+C` 也可以。

---

## 三、开机自启

macOS 用 launchd 管理登录启动项，桌宠库的开机自启就是一个 LaunchAgent：

- 配置文件：`~/Library/LaunchAgents/com.desktop-pets.plist`
- 启动命令：`ProgramArguments` 指向 `<库根>/scripts/petctl.sh run`（前台运行活动桌宠，桌宠即 launchd 作业主进程）
- 关键设置：`RunAtLoad = true`，登录进桌面时自动运行一次
- 关键设置：`KeepAlive = false`，**不强制保活**。意思是 launchd 只在登录时启动一次；之后你用菜单或命令退出桌宠，它不会自己再爬起来。想让它回来，手动 `start` 即可

### 启用开机自启

```bash
<库根>/scripts/petctl.sh enable
```

```
[pet] 已启用开机自启（LaunchAgent: /Users/yucong/Library/LaunchAgents/com.desktop-pets.plist）
```

内部执行的是 `launchctl load -w ~/Library/LaunchAgents/com.desktop-pets.plist`。`-w` 会同时写入启用标记，效果等同于在「系统设置 → 通用 → 登录项」里勾选。

### 停用开机自启

```bash
<库根>/scripts/petctl.sh disable
```

```
[pet] 已取消开机自启
```

内部执行 `launchctl unload -w`。停用只影响下次登录，当前正在跑的桌宠不会被打断。

> 不想开机自启也没关系：不执行 `enable`，平时要用时手动 `start` 即可。opencode 插件也会在开会话时自动把活动桌宠拉起来。

### 自启日志

LaunchAgent 的标准输出和错误都指向桌宠库根目录的 `petctl.log`（petctl 的运行输出）。各桌宠自身日志写在 `pets/<名称>/pet.log`。排查时分两步看：先看 `petctl.log` 确认 petctl 有没有被拉起，再看对应桌宠的 `pet.log` 找启动报错。

---

## 四、交互操作

以下以 remiel 的默认档位为例；每只桌宠的具体范围由它的 `pet_spec.json` 里 `defaults` 决定（demo 为 80 到 240px）。

### 移动窗口

在宠物身上按住鼠标左键拖动，松手即停在原地。位置会记进配置文件，下次启动自动恢复。

### 缩放

- 鼠标滚轮：向上滚放大，向下滚缩小
- 键盘 `+` / `-`：同样生效
- 范围：95 到 305 像素（remiel），超出边界不动
- 每次缩放约 1.15 倍，窗口右下角保持锚定
- 三种方式等效：滚轮、键盘 `+` / `-`、右键菜单「大小」子菜单都能缩放

### 旋转与镜像

右键菜单 →「姿态」子菜单：

| 选项 | 效果 |
|---|---|
| 旋转 0° / 90° / 180° / 270° | 把宠物转个方向 |
| 水平镜像 开 / 关 | 左右翻转 |
| 垂直镜像 开 / 关 | 上下翻转 |

### 互动系统（摸头 / 喂食 / 亲密度 / 改名 / 隐藏）

桌面版内置互动玩法（摸头 / 喂食 / 亲密度成长 / 改名 / 隐藏），账本自动保存在 `pets/<名称>/.pet-profile.json`，无需手动编辑：

| 互动 | 操作 | 效果 |
|---|---|---|
| 摸头 | 在宠物身上**点击**（原地快速点一下，拖动仍是移动窗口） | 亲密度 +1，气泡反馈（10s 冷却） |
| 喂食 | 右键 →「互动 → 喂食」 | 消耗 1 条小鱼干，亲密度 +5（30s 冷却） |
| 亲密度 | 右键 →「互动」（顶部信息行） | 4 级成长：初识 → 伙伴 → 挚友 → 羁绊（100 分封顶） |
| 改名 | 右键 →「互动 → 改名…」 | 弹窗输入 1–20 字符，重启保留 |
| 隐藏/召唤 | 右键 →「互动 → 隐藏宠物」；菜单栏图标 →「显示宠物」 | 隐藏后窗口消失，随时召回 |

**小鱼干怎么来**：工作每完成 3 个回合 +1 条、每 30 分钟 +1 条（库存上限 20）。库存不足时喂食会提示「没有小鱼干了，多陪小家伙工作一会儿吧～」。亲密度升级时桌宠会弹气泡庆祝。

### 右键菜单（全部子项）

在宠物上点右键弹出菜单，所有改动即时生效并自动存盘：

| 菜单项 | 可选值 | 说明 |
|---|---|---|
| 气泡数量（当前 N） | 1 / 2 / 3 / 4 / 5 / 6 / 8 / 10 条 | 最多同时显示多少条气泡 |
| 大小（当前 N px） | 95 / 120 / 150 / 190 / 240 / 305 px，另有「放大」「缩小」 | 直接设档或微调，范围 95 到 305 px |
| 气泡停留（当前 X 秒） | 3 / 5 / 8 / 12 / 20 秒 | 单条气泡停留多久，到期淡出 |
| 气泡位置（当前） | 右上 / 左上 | 气泡堆在宠物头顶哪一侧 |
| 气泡间距（当前 X px） | 0 / 2 / 4 / 6 / 8 / 12 px | 相邻气泡的垂直间距 |
| 气泡样式（当前 字号 · 边框） | 见子菜单 | 形状 / 边框 / 文字 / 背景全套样式 |
| 姿态（旋转X° · 水平… · 垂直…） | 见子菜单 | 旋转与镜像 |
| 互动（摸头 = 点击宠物） | 见子菜单 | 亲密度信息 / 喂食 / 改名 / 隐藏 |
| 退出宠物 | 立即退出 | 等同按 Q |

「气泡样式」子菜单再分一层：

- **气泡形状**：圆角矩形 / 云朵
- **边框宽度**：0 / 1 / 2 / 3 / 4 / 5 px（0 表示无边框）
- **边框颜色**：弹出系统取色面板
- **文字字号**：10 / 12 / 14 / 16 / 18 px
- **文字颜色**：系统取色面板
- **背景颜色**：系统取色面板
- **背景不透明度**：60% / 70% / 80% / 90% / 100%

### 菜单栏图标

桌宠启动后，屏幕顶部菜单栏右侧出现一个小图标。点击弹出菜单：

| 菜单项 | 作用 |
|---|---|
| 状态: idle（灰色不可点） | 实时显示当前状态值（idle / thinking / waiting / running / success） |
| 亲密度: N/100 · 等级 · 小鱼干 M（灰色不可点） | 实时显示互动账本 |
| 打开网页版桌宠 | 用默认浏览器打开 `pets/remiel/pet.html` |
| 显示宠物 | 隐藏后用它召唤回桌面 |
| 退出宠物 | 立即退出桌面版 |

### 退出方式汇总

| 方式 | 操作 |
|---|---|
| 键盘 | 窗口聚焦时按 `Q` 或 `Esc` |
| 右键菜单 | 右键 →「退出宠物」 |
| 菜单栏 | 菜单栏图标 →「退出宠物」 |
| 命令 | `<库根>/scripts/petctl.sh remiel stop` 或 `pkill -f pets/remiel/pet.py` |

> 桌宠是无边框窗口，默认不抢键盘焦点。按 `Q` / `Esc` 之前先用鼠标点一下宠物，让它获得焦点，按键才有效。嫌麻烦就直接用右键菜单或菜单栏退出。

---

## 五、与 opencode 联动

### 原理

opencode 端跑一个插件 `~/.config/opencode/desktop-pets-plugin.js`（在 `opencode.jsonc` 的 `plugin` 数组里注册）。插件被加载时读取 `~/.config/opencode/desktop-pets.json`，取 `root`（桌宠库根目录）和 `active`（活动桌宠），再读 `pets/<active>/pet_spec.json` 拿到状态通道，把 opencode 的事件翻译成状态和气泡，写到通道文件：

| 文件 | 内容 | 作用 |
|---|---|---|
| `<state_file>` | `idle` / `thinking` / `running` / `success` | 驱动表情切换 |
| `<bubble_file>` | 气泡文本（每次写入追加一条） | 驱动头顶气泡 |

`state_file` / `bubble_file` 由活动桌宠的 `pet_spec.json` 决定：remiel 是 `/tmp/remiel-pet.state`、`/tmp/remiel-pet.bubble`；demo 是 `/tmp/demo-pet.state`、`/tmp/demo-pet.bubble`。想换一只桌宠接收 opencode 信号，改 `desktop-pets.json` 的 `active` 字段后重启桌宠即可（见第八节）。

桌宠每 300 毫秒轮询一次通道文件，文件有变化就换表情、弹气泡。两个文件都在 `/tmp`（临时目录），重启电脑后会被系统清空，属正常现象。

### 事件 → 状态对照

| opencode 事件 | 写入状态 | 气泡 |
|---|---|---|
| `session.created`（开会话） | `idle`，并清空气泡文件，顺带启动活动桌宠 | 无 |
| `chat.message`（你发消息） | `thinking` | `think\|` |
| `tool.execute.before`（调工具前） | `running` | `run\|工具名\|命令或文件` |
| `tool.execute.after`（工具执行完） | 不变 | `done\|工具名\|退出码` |
| `session.idle`（会话结束） | `success` | `finish\|` |

插件里的所有读写都包了容错：文件写失败、桌宠启动失败都不会影响 opencode 本身。插件重复拉起桌宠也没关系，桌宠有单实例锁，多开的那个会自己安静退出。

### 状态 → 表情对照表

remiel 的状态与表情对应如下（各桌宠由自己的 `pet_spec.json` 定义，demo 的映射相同，对应 `demo_1..5.gif`）：

| 状态文件内容 | 显示表情 |
|---|---|
| `idle` | remiel_1.gif（待机） |
| `thinking` | remiel_2.gif（思考） |
| `running` | remiel_4.gif（运行） |
| `success` | remiel_5.gif（成功） |

（remiel_3.gif 是备用表情，未使用）

桌宠对状态还有两个自动回落设计，都属于正常行为：

- `success` 状态展示 4 秒后自动回到 `idle`（待机）
- `thinking` / `running` 状态若 30 秒没有新的气泡活动，自动回落到 `idle`

### 气泡内容格式

`<bubble_file>` 每行一条，格式为 `类型\|工具名\|详情`，桌宠解析后按类型渲染：

| 格式 | 含义 | 气泡显示 |
|---|---|---|
| `run\|Bash\|ls -la` | 正在执行工具 | 🛠 Bash · ls -la |
| `done\|Bash\|0` | 执行成功（退出码 0 / ok / 空都算成功） | ✅ Bash 完成 |
| `done\|Bash\|2` | 执行失败（退出码非 0） | ❌ Bash 完成 · exit 2 |
| `think\|` | 正在思考 | 💭 思考中… |
| `finish\|` | 会话结束 | 🎉 完成！ |
| 其他格式 | 桌宠不认识的格式 | 原样显示前 40 个字符 |

细节说明：

- 命令里的换行会被压成空格，整个详情截断到 90 个字符
- 气泡文字超过窗口宽度时，桌宠自动截断并加省略号
- `done` 后面的数字是工具的退出码；如果 opencode 这次没有提供退出码元数据，插件会回退写 `ok`（详见第七节）

### 注意：改配置要重启 opencode

插件文件或 `opencode.jsonc` 的任何改动，都要**完全退出 opencode 再重新打开**才生效。没重启前，opencode 加载的还是旧插件。

重启后想确认插件确实加载了，看自检标记文件：

```bash
ls -l /tmp/desktop-pets-plugin.loaded
```

这个文件是插件被 opencode 加载时自动写入的（内容为写入时刻的时间戳）。文件存在、且时间戳在本次 opencode 启动之后，说明插件已加载；不存在则说明插件没被加载。它写在 `/tmp` 临时目录，重启电脑后会被系统清空，消失属正常，只要 opencode 重新启动就会再写出来。

---

## 五·二、与 DeepSeek Harness（DSH）联动

桌面版桌宠同样可以跟随 DeepSeek Harness 的智能体会话实时换表情、弹气泡（opencode 与 DSH 可同时接入，共用同一套通道协议，互不冲突）。

### 安装

仓库内置 DSH 联动插件 `integration/dsh-plugin/`，一键写入 DSH web profile：

```bash
<库根>/integration/dsh-plugin/install.sh
```

脚本做两件事（与 vision-bridge 插件同款注册方式）：

1. 把 `dsh-desktop-pets` 以 `file:` 依赖写进 `~/.dsh/profiles/web/package.json`
2. 在 `~/.dsh/profiles/web/cordis.patch.yml` 追加 insert 条目

然后安装依赖并重启：

```bash
cd ~/.dsh/profiles/web && pnpm install
# 重启 dsh web
```

### 原理

插件订阅 DSH 的 `session/event`，把会话事件翻译成桌宠状态与气泡：

| DSH 事件 | 状态 | 气泡 |
|---|---|---|
| `step/start`（模型开始思考） | thinking | 💭 思考中… |
| `tool/call`（工具调用） | running | 🛠 工具 · 参数预览 |
| `turn/end`（completed，回合完成） | success | 🎉 完成！ |
| `turn/end`（aborted / interrupted / failed） | idle | — |
| `session/disposed`（会话销毁） | idle | 清空气泡 |

配置读取与 opencode 插件一致：优先 `~/.config/desktop-pets.json`，回退 `~/.config/opencode/desktop-pets.json`（`root` + `active`）。**每次事件实时解析配置**，切换活动桌宠无需重启 DSH。仓库根缺省从插件自身位置推导，无硬编码。

### 自检

```bash
ls -l /tmp/desktop-pets-dsh.loaded   # 插件被 DSH 加载时写入
tail -f <库根>/pets/remiel/pet.log   # 看桌宠状态切换日志
```

### 卸载

```bash
# 从 cordis.patch.yml 删除 dsh-desktop-pets insert 段，从 package.json 删除依赖，然后：
cd ~/.dsh/profiles/web && pnpm install
```

---

## 六、本地独立运行说明

桌宠是独立应用，**不依赖 opencode / DSH 也能正常运行**。助手会话只是「驱动它变表情」的外部信号源。

- 不开任何助手：桌宠自己显示待机表情，正常缩放、拖动、玩耍
- 开着 opencode 或 DSH：桌宠跟着会话进度换表情、弹气泡
- 助手崩溃或插件被删：桌宠保持当前表情继续待机，不受影响

想验证桌宠本身没问题，可以完全不管 opencode，直接 `start` 看它出现即可。

---

## 七、故障排查

| 现象 | 排查步骤 |
|---|---|
| 桌宠不出现 | ① `<库根>/scripts/petctl.sh remiel status` 看进程在不在；<br>② 打开 `<库根>/pets/remiel/pet.log` 看启动报错；<br>③ 手动前台运行 `<库根>/.venv/bin/python3 <库根>/pets/remiel/pet.py`，直接看终端输出；<br>④ `ImportError: No module named objc` 之类说明 venv 没建好或路径不对，检查 `.venv` 是否存在 |
| 桌宠启动了但状态不变 | ① `cat /tmp/remiel-pet.state` 看当前状态值；<br>② 手动测试：`echo idle > /tmp/remiel-pet.state`，看桌宠是否切回待机表情；<br>③ 确认插件已注册进 `opencode.jsonc` 且 opencode 已重启（第五节的注意事项）；<br>④ 检查自检标记：`ls -l /tmp/desktop-pets-plugin.loaded` 是否存在、时间是否在 opencode 启动之后；不存在说明插件没加载，先重启 opencode |
| 气泡不更新 | ① `cat /tmp/remiel-pet.bubble` 看内容在不在；<br>② 手动写入：`echo "run\|Bash\|测试" > /tmp/remiel-pet.bubble`，观察是否弹泡；<br>③ 气泡数量上限（默认 5 条）已满时，最旧的气泡会先淡出腾位置，属正常 |
| 中文气泡乱码 | macOS 自带 PingFang 中文字体，正常情况不需要处理。出现乱码先重启桌宠试试；仍异常的话检查系统字体是否完整（系统设置 → 字体） |
| 窗口跑出屏幕 | 删除桌宠目录下的 `pets/remiel/.pet-config.json` 后重启桌宠。文件里存的是旧屏幕的坐标，删掉后程序会以屏幕右下角为锚点重新放置 |
| 按 Q / Esc 没反应 | 无边框窗口需要先点一下宠物获得键盘焦点，按键才有效。应急就用右键菜单「退出宠物」或菜单栏图标退出 |
| 退出码显示 ok 而不是数字 | opencode 的 `tool.execute.after` 事件只在部分工具上提供退出码元数据，拿不到时插件回退写 `ok`。这是正常设计，不是 bug：桌宠把 `ok` 当成功处理，显示 ✅ |
| 桌宠开着但 opencode 信号没反应 | 确认 `desktop-pets.json` 的 `active` 字段与你看的那只桌宠一致；切换后必须重启该桌宠（见第八节） |

---

## 八、配置文件说明

### `pets/<名称>/.pet-config.json`

桌宠目录下的隐藏文件，保存该桌宠窗口和气泡的全部设置。右键菜单改什么它就存什么，无需手动编辑；删掉它相当于恢复出厂（位置、样式全部回到默认值，下次启动重建）。

| 字段 | 含义 | 默认值 |
|---|---|---|
| `width` | 宠物显示宽度（px） | 190 |
| `x` / `y` | 窗口位置（屏幕坐标），`-1` 表示未记录，按右下角锚点放置 | -1 / -1 |
| `bubbles` | 同时显示的气泡数量，范围 1 到 10 | 5 |
| `lifetime` | 气泡停留秒数，范围 2 到 120 | 6 |
| `angle` | 旋转角度（0 / 90 / 180 / 270） | 0 |
| `mirror_x` / `mirror_y` | 水平 / 垂直镜像 | false |
| `side` | 气泡位置（`right` 右上 / `left` 左上） | right |
| `bubble_border_w` | 边框宽度 px，范围 0 到 5，0 表示无边框 | 0 |
| `bubble_border_color` | 边框颜色，`#RRGGBB` 格式 | #c9b8d0 |
| `bubble_font_size` | 文字字号 px，范围 10 到 18 | 12 |
| `bubble_text_color` | 文字颜色 | #3a2b3f |
| `bubble_bg_color` | 气泡背景颜色 | #ffffff |
| `bubble_bg_alpha` | 背景不透明度（%），范围 60 到 100 | 92 |
| `bubble_gap` | 气泡垂直间距 px，范围 0 到 12 | 2 |
| `bubble_shape` | 气泡形状（`rect` 圆角矩形 / `cloud` 云朵） | rect |

> 每只桌宠的默认值可被它的 `pet_spec.json` 覆盖（demo 的宽度默认 120、气泡 3、停留 5 秒、位置 left、云朵样式），表里是 remiel 的默认值。字段 schema 全库统一为上述 17 项。

所有设定（大小、位置、气泡全套样式）都是**改动即时自动保存**，之后无论重启桌宠、重开 opencode 还是重启电脑，都会自动恢复，无需重新设置。

位置保存还有个细节：存的是上次退出时的坐标，如果之后屏幕情况有变（比如换了显示器、调了分辨率）导致窗口略微越出屏幕，启动时会自动把窗口拉回屏幕内，而不是把位置丢掉；只有窗口比屏幕还大、或配置文件损坏时，才回退到默认位置。

### `.pet-profile.json`（互动账本，自动生成）

桌宠目录下的互动账本文件（`pets/<名称>/.pet-profile.json`），保存摸头 / 喂食 / 亲密度 / 小鱼干 / 自定义名字，由引擎自动读写，**无需手动编辑**：

```json
{
  "name": "小雷",
  "affinity": {"points": 33, "last_pet_at": 0, "last_feed_at": 0, "pets": 3, "feeds": 2, "turns": 7},
  "treats": {"treats": 4, "last_treat_grant_at": 0, "turns_at_last_treat_grant": 6}
}
```

- `affinity.points`：亲密度（0–100，4 级成长）
- `affinity.pets` / `feeds` / `turns`：摸头 / 喂食 / 回合完成次数（终身）
- `treats.treats`：小鱼干库存（上限 20）
- 删掉这个文件 = 重置互动账本（名字、亲密度、库存全部归零），下次启动自动重建；显示配置不受影响

### `.pet.lock`（单实例锁）

桌宠目录下的锁文件（`pets/<名称>/.pet.lock`）。程序启动时会尝试对它加排它锁，如果加不上说明已经有实例在跑，新进程会**静默退出**（不弹任何错误）。

这带来的常见现象：重复执行 `start`、opencode 每次开会话都拉起一次桌宠，但你永远只看到一只桌宠。这不是 bug，是锁在工作。每只桌宠各有一把自己的锁，互不影响。

### `pet.log`（日志）

桌宠目录下的日志文件（`pets/<名称>/pet.log`）。两种启动方式都往这里写：

- `petctl.sh <名称> start`（nohup 后台启动）输出到这里
- LaunchAgent 自启（`petctl.sh run` 前台运行活动桌宠）输出到这里

日志里有 `[pet] 启动 ...`、`[pet] 状态 -> thinking 表情2`、`[pet] 气泡+1 (1/5): ...` 这样的行，排查问题时先看它。

### 活动桌宠配置（`~/.config/desktop-pets.json` 优先，`~/.config/opencode/desktop-pets.json` 回退）

```json
{"root": "/Users/yucong/Documents/Deepseek Harness/dsh-skills-plugins/projects/desktop-pets", "active": "remiel"}
```

- `root`：桌宠库根目录
- `active`：活动桌宠名（缺省 remiel）

opencode 插件、DSH 插件与 petctl 都以它为准决定「当前哪只桌宠」。**切换桌宠 = 改 `active` 字段 + 重启桌宠**：先 `petctl.sh <旧名> stop` 停掉当前桌宠，改 `active`，再 `petctl.sh start`（不指定名字，会启动新的活动桌宠）。opencode 下次开会话时，插件也会自动拉起新的活动桌宠；DSH 插件每次事件实时读取配置，无需重启 DSH。

### 目录搬家的联动位置

整个桌宠库目录可以移动、改名，petctl 和引擎都能自动推导自身位置，不需要改脚本。只有一处写死了绝对路径，搬家后要同步改：

1. `~/Library/LaunchAgents/com.desktop-pets.plist` 里的 petctl 路径（改完重新 `enable`）

> petctl 启动时通过自身脚本位置自动推导库根目录，引擎通过桌宠目录定位表情与配置，这两者搬家后无需任何改动。opencode 插件与 DSH 插件（`integration/dsh-plugin`）都从自身位置推导仓库根，无硬编码。`desktop-pets.json` 存在时插件与 petctl 都优先读它，缺省值只在文件缺失或损坏时兜底。

---

## 九、卸载

想彻底移除桌宠，按顺序执行：

```bash
# 1. 停用开机自启（从 launchd 移除）
<库根>/scripts/petctl.sh disable

# 2. 停止桌宠进程（有几只停几只）
<库根>/scripts/petctl.sh remiel stop
# 或直接: pkill -f pets/remiel/pet.py

# 3. 删除 opencode 联动插件
rm ~/.config/opencode/desktop-pets-plugin.js

# 4. 从 opencode.jsonc 的 plugin 数组删掉 "./desktop-pets-plugin.js" 这一行
#    建议先备份:
cp ~/.config/opencode/opencode.jsonc ~/.config/opencode/opencode.jsonc.bak

# 5. 删除活动桌宠配置
rm ~/.config/opencode/desktop-pets.json

# 6. 删除桌宠库目录（含 venv、配置、日志）
rm -rf ~/desktop-pets
```

可选清理：

- 残留的 `/tmp/remiel-pet.state`、`/tmp/remiel-pet.bubble` 等状态通道文件是临时文件，系统重启自动清空，也可以手动 `rm` 掉
- LaunchAgent 配置 `~/Library/LaunchAgents/com.desktop-pets.plist` 在执行 `disable` 后已从 launchd 卸载，删除与否均可

**恢复备份**：安装和修改时做过自动备份，需要还原时：

- `opencode.jsonc` 的备份在 `~/.config/opencode/opencode.jsonc.bak.*`（每次改动前自动留档），把备份改回原名 `opencode.jsonc` 即可整体还原配置（含桌宠插件注册行）
- 桌宠库备份在 U 盘原包 `Claude配置与桌宠包/`（不含本机路径，是通用副本）

---

## 附录：网页版桌宠快速上手

```bash
open <库根>/pets/remiel/pet.html
# demo 桌宠: open <库根>/pets/demo/pet.html
```

在浏览器里打开的电子宠物支持喂食、跳舞、睡觉、洗澡等玩法，纯娱乐向，和桌面版共用一套表情资源但互不干扰，可以同时开着玩。
