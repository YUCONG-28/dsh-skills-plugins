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

- **右键桌宠** → 菜单：切换宠物（内置 demo / remiel）、缩小 / 放大、隐藏宠物。
- **隐藏后**：右下角出现 🐾 召唤按钮，点击召回。
- **点击桌宠**：摸头互动气泡。
- 会话开始工作后桌宠会自动进入对应状态表情。

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
