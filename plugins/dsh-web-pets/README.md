# dsh-web-pets · DSH Web 桌宠插件

在 DeepSeek Harness 的 Web 界面（[dsh-web-ui](https://github.com/zhu1090093659/dsh-web-ui) 生态）里养一只桌宠：它悬浮在页面右下角，跟随 DSH 会话的真实工作状态换表情、弹气泡——思考时挠头、干活时卖力、完成时庆祝。

内置两只宠物：**demo（豆豆）** 与 **remiel（雷米埃尔）**。所有素材与代码为作者自有。

> 本插件是 [desktop-pets 项目](../projects/desktop-pets/)（macOS 原生多桌宠库）的 Web 版兄弟：共用同一套「宠物 = 素材目录 + 规格 JSON」的协议与事件→状态映射。原生版把状态写进 `/tmp/<pet>.state` 通道文件，Web 版把状态放在内存里经 `/api/web-pets/*` 暴露给浏览器——事件来源与映射完全一致。

## 特性

| 功能 | 说明 |
|---|---|
| 状态表情 | `idle` 待机 / `thinking` 思考 / `waiting` 等待 / `running` 干活 / `success` 庆祝（4 秒后自动回待机） |
| 会话联动 | `step/start` → thinking；`tool/call` → running + 气泡「🛠 工具 · 参数预览」；`turn/end` 完成 → success + 「🎉 完成！」；中止/失败/会话销毁 → idle |
| 点击互动 | 点击桌宠 → 「❤️ 摸头 +1」气泡 |
| 右键菜单 | 切换宠物 / 缩小 / 放大 / 隐藏宠物 |
| 可替换形象 | 宠物 = `assets/pets/<名字>/pet.json` + `emotes/` 文件夹；改文件即换形象，加目录即加新宠物（自动出现在切换菜单） |
| 配置持久化 | 活动宠物 / 可见性 / 大小存于 `~/.config/dsh-web-pets.json` |

## 安装

插件遵循 dsh 官方插件形态（`package.json` 的 `dsh.bundle.patch` / `dsh.client` 声明 + `cordis.patch.yml`），两种安装方式任选：

### 方式一：`dsh plugin add link:…`（推荐）

```bash
dsh plugin --profile web add link:/path/to/dsh-skills-plugins/plugins/dsh-web-pets
```

`cordis.patch.yml` 会自动把插件行插入 profile 的插件名单（`id: web-pets`）。

### 方式二：`file:` 依赖 + 手工补丁

在 profile 目录（如 `~/.dsh/profiles/web`）的 `package.json` 加入：

```json
"dependencies": {
  "dsh-web-pets": "file:/path/to/dsh-skills-plugins/plugins/dsh-web-pets"
}
```

并在该 profile 的 `cordis.patch.yml` 追加：

```yaml
- insert:
    - id: web-pets
      name: 'dsh-web-pets'
```

然后 `pnpm install`，**重启 `dsh web`**。刷新页面后右下角出现桌宠（浏览器侧 800ms 轮询 `/api/web-pets/state`）。

### 自检

- 插件加载后 `curl http://127.0.0.1:<port>/api/web-pets/state` 应返回 JSON 状态。
- 素材可达：`curl -I http://127.0.0.1:<port>/web-pets-assets/demo/emotes/demo_1.gif`。

## 使用

### 并入 dsh-web-ui 的 pet 界面（单宠物切换器）

本插件**并入 dsh-web-ui 的宠物入口**，而不是独立的第二个 webpet：先安装 dsh-web-ui（`@linxin666/dsh-web-ui-all`，内置鲸鱼宠物 dsh-pet），再安装本插件后，**设置 → Web UI 插件 → 宠物**区域会出现本插件的「**宠物选择**」卡片（与上游鲸鱼卡片同一槽位 `web-ui.plugin.item`，紧随其后）。卡片内：

- **宠物切换**：列出 `鲸鱼娘（上游 dsh-pet）`、`豆豆（demo）`、`雷米埃尔（remiel）` 以及你添加的自定义宠物，点击即切换——**任意时刻只显示一只宠物**：
  - 选我们的宠物 → 自动关闭上游鲸鱼（写 dsh-pet 的 `pet` 设置命名空间 `enabled=false`），我们的宠物在右下角显示；
  - 选鲸鱼 → 本插件 `enabled=false`（**完全不渲染**，连召唤按钮都不出现），鲸鱼由上游插件正常显示；
- **大小**：− / ＋ 调节（40–480px，作用于我们的宠物）；
- **显示 / 隐藏**：开关我们的宠物（隐藏后右下角保留 🐾 召唤按钮）；
- 底部状态行：当前显示哪只宠物 + 表情状态/气泡。
- **首次加载防双宠**：若检测到上游鲸鱼活跃且本插件 `enabled` 从未被显式配置，会自动隐藏本插件宠物（持久化），安装后默认仍显示鲸鱼，由你在 pet 界面切换。

卡片**自包含**：我们的宠物状态直接读写 `/api/web-pets/*`；对上游鲸鱼的启停经 `pet` 设置命名空间（`webUiSettings`/`settingsScope` 绑定器——`'pet'` 在 dsh-web-ui 家族桥接白名单内，可写 `enabled`），**不 fork、不复制、不修改上游代码**。rc.6 官方 settings 白名单硬编码、第三方 namespace 不可写，因此我们自己的配置不走命名空间。

> 若只想用我们的宠物、彻底不要鲸鱼，也可在 profile 的 `cordis.patch.yml` 加 `- disable: pet`；反之 `- disable: web-pets` 可只留鲸鱼。

### 悬浮桌宠（我们的宠物被选中时）

- **右键桌宠** → 菜单：切换宠物（内置 demo / remiel）、缩小 / 放大、隐藏宠物。
- **隐藏后**：右下角出现 🐾 召唤按钮，点击召回。
- **点击桌宠**：摸头互动气泡。
- 会话开始工作后桌宠会自动进入对应状态表情。
- 当上游鲸鱼被选中时，本插件悬浮层完全不渲染。

### 兼容性契约（上游 dsh-web-ui 更新时保持兼容）

本插件只依赖以下**稳定公开接口**；任一项在上游更新后变化，对应功能降级、其余照常工作：

| 依赖接口 | 用途 | 上游变化时的降级 |
|---|---|---|
| `web-ui.plugin.item` 槽位（dsh-web-ui 设置组声明） | 宠物选择器卡片展示 | 卡片不显示；悬浮宠 + 右键菜单照常 |
| `pet` 设置命名空间 + `webUiSettings`/`settingsScope` 绑定器 | 切换鲸鱼 `enabled` | 无法切换鲸鱼 → 鲸鱼选项隐藏并提示；我们的宠物照常 |
| `/api/pet/state`（dsh-pet 路由） | 探测鲸鱼是否活跃 | 探测失败 → 鲸鱼选项隐藏 |
| dsh 官方 `dsh.client` 机制 + `__ModuleLoader__` bundle 形态 | 插件装载 | 随 dsh 生态演进，按官方形态适配 |

本插件单装（无 dsh-web-ui）也可独立工作：右下角一只悬浮宠 + 右键菜单 + 自有设置卡片（若装有设置组）。

## 替换 / 添加宠物形象

宠物 = 一个目录，零代码改动：

```text
plugins/dsh-web-pets/assets/pets/
├── demo/                       # 宠物 id = 目录名
│   ├── pet.json                # 规格：显示名 + 表情文件名映射
│   └── emotes/
│       ├── demo_1.gif          # idle
│       ├── demo_2.gif          # thinking
│       ├── demo_3.gif          # waiting
│       ├── demo_4.gif          # running
│       └── demo_5.gif          # success
└── remiel/                     # 另一只内置宠物，结构同上
```

`pet.json` 格式：

```json
{
  "name": "demo",
  "display_name": "豆豆",
  "description": "程序生成的演示桌宠",
  "emotes": {
    "idle": "demo_1.gif",
    "thinking": "demo_2.gif",
    "waiting": "demo_3.gif",
    "running": "demo_4.gif",
    "success": "demo_5.gif"
  }
}
```

- **换形象**：直接替换 `emotes/` 里对应状态的文件（保持文件名，或改 `pet.json` 的 `emotes` 映射指向新文件），刷新页面即生效（GIF/PNG/WebP 均可，推荐 GIF 动图）。
- **加宠物**：新建 `assets/pets/<你的宠物名>/` 目录，放入 `pet.json` + `emotes/`（5 个状态文件），重启 `dsh web` 后出现在右键切换菜单。也可复用 macOS 原生版 desktop-pets 的 `pets/<名称>/` 素材（协议同源）。
- **删宠物**：删除目录即可。

## 事件 → 状态对照

| 事件 | 状态 | 气泡 |
|---|---|---|
| `step/start` | thinking | — |
| `tool/call` | running | 🛠 工具 · 参数预览 |
| `turn/end`（completed） | success（4s 后回 idle） | 🎉 完成！ |
| `turn/end`（中止/失败） | idle | — |
| `session/disposed` | idle | 清空 |

## HTTP 接口（宿主侧）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/web-pets/state` | 状态快照（state / bubble / activePet / pets / visible / size） |
| POST | `/api/web-pets/set-pet` `{id}` | 切换活动宠物 |
| POST | `/api/web-pets/set-visible` `{visible}` | 显示 / 隐藏 |
| POST | `/api/web-pets/set-size` `{size}` | 设置大小（40–480） |
| POST | `/api/web-pets/interact` | 摸头互动 |
| GET | `/web-pets-assets/<pet>/emotes/<file>` | 宠物素材（GIF 等） |

## 兼容性

- 宿主侧：`@deepseek-ai/dsh-session`（会话事件）+ `@deepseek-ai/dsh-host-webserver`（HTTP 路由）。
- 浏览器侧：手写客户端 bundle（`__ModuleLoader__.load` 形态），仅依赖 `react` / `react-dom`，无构建步骤；随 dsh 官方 `dsh.client` 机制自动挂载。

## 许可

MIT License。本插件所有代码与素材均为作者自有。
