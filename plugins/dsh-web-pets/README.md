# dsh-web-pets · DSH Web 桌宠插件

在 DeepSeek Harness 的 Web 界面（[dsh-web-ui](https://github.com/zhu1090093659/dsh-web-ui) 生态）里养一只桌宠：它悬浮在页面右下角，跟随 DSH 会话的真实工作状态换表情、弹气泡——思考时挠头、干活时卖力、完成时庆祝、空闲久了发呆。

内置两只宠物：**demo（豆豆）** 与 **remiel（雷米埃尔）**。所有素材与代码为作者自有。

> 本插件是 [desktop-pets 项目](../projects/desktop-pets/)（macOS 原生多桌宠库）的 Web 版兄弟：共用同一套「宠物 = 素材目录 + 规格 JSON」的协议与事件→状态映射。原生版把状态写进 `/tmp/<pet>.state` 通道文件，Web 版把状态放在内存里经 `/api/web-pets/*` 暴露给浏览器——事件来源与映射完全一致。

## 特性

| 功能 | 说明 |
|---|---|
| 状态表情 | `idle` 待机 / `thinking` 思考 / `waiting` 等待（idle 超过 2 分钟派生）/ `running` 干活 / `success` 庆祝（4 秒后自动回待机） |
| 会话联动 | `step/start` → thinking；`tool/call` → running + **按工具类型的气泡**；`turn/end` 完成 → success + 「🎉 完成！」；中止/失败/会话销毁 → idle（并清气泡） |
| 工具信息适配 | 运行中真实出现的 `bash`、`read`、`write`、`glob`、`grep`、`web_search`、`ssh_*` 等工具，气泡按类型展示**命令 / 文件路径 / 模式 / 查询词**等关键信息；未知工具回退「🛠 工具名 · 参数预览」 |
| 点击互动 | 点击桌宠 → 「❤️ 摸头 +1」气泡 + **随机换一个表情 1.8 秒** |
| 右键菜单 | 切换宠物 / 缩小 / 放大 / **百分比缩放** / **透明度** / **锁定位置** / **暂停动画** / 重置位置 / 水平·垂直镜像 / 隐藏宠物 / **打开设置面板** |
| 设置面板 | 左右分栏（外观 / 行为 / 更新 / 反馈）：缩放与透明度滑杆、锁定/暂停/隐藏开关、**自动检查更新**与一键更新、GitHub Issues 反馈入口 |
| 自更新闭环 | 宿主 `/api/web-pets/check` 直连 GitHub（带代理回退），monorepo link 安装下可一键执行 `git pull` + `fix-web-profile.sh`（仅本机请求、120s 超时） |
| 调整参数与官方一致 | **大小（32–512px）/ 位置右·下（0–10000px）/ 自定义名称（≤20 字符）/ 水平·垂直镜像 / 显示隐藏 / 启用**——与官方 dsh-pet 的显示参数同名同界；卡片内 −/+ 调整，悬浮宠可**拖拽**移动（自动持久化位置，锁定后不可拖） |
| 可替换形象 | 宠物 = `assets/pets/<名字>/pet.json` + `emotes/` 文件夹；改文件即换形象，加目录即加新宠物（自动出现在切换菜单）；**内置宠物素材以 data URI 内联进客户端 bundle**（`scripts/generate-art.mjs` 生成），自定义宠物走 `/web-pets-assets/*` 磁盘路由 |
| DOM 增强信号（可选） | 设置面板「行为」可开启：检测等待卡片（`[data-cordis-approve]` 等）→ `waiting`，think 块细分 → `thinking`；默认关闭，检测不到即静默降级 |
| 配置持久化 | 活动宠物 / 启用 / 可见性 / 大小 / 位置 / 名称 / 镜像 / DOM 信号存于 `~/.config/dsh-web-pets.json`；缩放/透明度/锁定/暂停等视觉偏好存浏览器 `localStorage` |

## 安装

插件遵循 dsh 官方插件形态（`package.json` 的 `dsh.bundle.patch` / `dsh.client` 声明 + `cordis.patch.yml`），以下安装方式任选：

### 方式一：npm 安装（推荐，快速使用）

```bash
dsh plugin --profile web add dsh-web-pets
# 或：在 profile 的 package.json 加依赖后 pnpm install
```

安装后重启 `dsh web`。更新可用设置面板「更新」一键 `pnpm update`。

### 方式二：GitHub Release tarball（离线/兜底）

从 [Releases](https://github.com/YUCONG-28/dsh-skills-plugins/releases) 下载 `dsh-web-pets-<版本>.tgz` 与 `SHA256SUMS.txt`，校验后：

```bash
dsh plugin --profile web add file:/path/to/dsh-web-pets-<版本>.tgz
```

> tarball 安装形态**只提示新版本、不自动更新**，请到 Release 下载新 tarball 重新安装。

### 方式三：monorepo `link:` 安装（开发/源码）

```bash
dsh plugin --profile web add link:/path/to/dsh-skills-plugins/plugins/dsh-web-pets
```

`cordis.patch.yml` 会自动把插件行插入 profile 的插件名单（`id: web-pets`）。link 形态可在设置面板一键 `git pull` + `fix-web-profile.sh`。

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

## 开发与构建

```bash
cd plugins/dsh-web-pets
pnpm install        # 安装 devDependencies（tsdown 等）
pnpm build          # 生成素材/版本（scripts/generate-art.mjs）+ tsdown 构建 lib/
pnpm test           # 构建 + node:test 单元测试（14 例）
```

- 源码：`src/host/index.ts`（宿主路由/状态机/自更新）+ `src/client/index.ts`（浏览器侧，含设置面板与更新 UI）。
- 产物 `lib/index.js`（宿主 ESM）与 `lib/client.js`（客户端 bundle，`__ModuleLoader__` 形态）**已提交**，安装无需构建。
- 替换素材后执行 `pnpm build` 重新内联（`src/client/art.generated.ts` 自动生成）。

### 自检

- 插件加载后 `curl http://127.0.0.1:<port>/api/web-pets/state` 应返回 JSON 状态（含 `version`）。
- `curl http://127.0.0.1:<port>/api/web-pets/info` 返回安装形态与更新命令。
- 素材可达：`curl -I http://127.0.0.1:<port>/web-pets-assets/demo/emotes/demo_1.gif`。

## 发布

- 维护者一键发版：`cd plugins/dsh-web-pets && pnpm release -- patch|minor|major`（执行 `scripts/release-web-pets.mjs`：bump → build → test → npm pack + SHA256 → git commit/tag → GitHub Release → push）。
- CI：`.github/workflows/ci.yml`（push/PR 自动 build+test）；`.github/workflows/release.yml`（推送 `web-pets-v*` tag 时自动构建、测试、打 tarball+SHA256、发布 npm、创建 GitHub Release）。
- 更新检查：`/api/web-pets/check` 按 `web-pets-v*` 前缀过滤本插件 Release（携带 release notes），避免 monorepo 其它插件干扰。

## 使用

### 并入 dsh-web-ui 的 pet 界面（单宠物切换器）

本插件**并入 dsh-web-ui 的宠物入口**，而不是独立的第二个 webpet：先安装 dsh-web-ui（`@linxin666/dsh-web-ui-all`，内置鲸鱼宠物 dsh-pet），再安装本插件后，**设置 → Web UI 插件 → 宠物**区域会出现本插件的「**宠物选择**」卡片（与上游鲸鱼卡片同一槽位 `web-ui.plugin.item`，紧随其后）。卡片内：

- **宠物切换**：列出 `鲸鱼娘（上游 dsh-pet）`、`豆豆（demo）`、`雷米埃尔（remiel）` 以及你添加的自定义宠物，点击即切换——**任意时刻只显示一只宠物**；
- **调整参数与官方 dsh-pet 一致**：大小 / 位置 / 名称 / 镜像 / 显示隐藏；
- 底部状态行：当前显示哪只宠物 + 表情状态/气泡；
- **首次加载防双宠**：若检测到上游鲸鱼活跃且本插件 `enabled` 从未被显式配置，会自动隐藏本插件宠物（持久化）。

卡片**自包含**：我们的宠物状态直接读写 `/api/web-pets/*`；对上游鲸鱼的启停经 `pet` 设置命名空间（`webUiSettings`/`settingsScope` 绑定器），**不 fork、不复制、不修改上游代码**。

> 若只想用我们的宠物、彻底不要鲸鱼，也可在 profile 的 `cordis.patch.yml` 加 `- disable: pet`；反之 `- disable: web-pets` 可只留鲸鱼。

### 悬浮桌宠（我们的宠物被选中时）

- **拖拽移动**：按住桌宠拖动即可换位置（锁定时不可拖，松手自动持久化 right/bottom）。
- **右键桌宠** → 菜单：切换宠物、缩小/放大、**百分比缩放 / 透明度 / 锁定位置 / 暂停动画 / 重置位置**、↔ 水平镜像 / ↕ 垂直镜像、隐藏宠物、**打开设置面板**。
- **设置面板**：外观（缩放 50–200%、透明度 30–100%）、行为（锁定/暂停/隐藏/重置位置、DOM 增强信号开关）、更新（自动检查、当前版本、检查/一键更新）、反馈（GitHub Issues 预填）。
- **隐藏后**：右下角出现 🐾 召唤按钮，点击召回。
- **点击桌宠**：摸头互动气泡 + 随机表情。
- 会话开始工作后桌宠会自动进入对应状态表情。
- 当上游鲸鱼被选中时，本插件悬浮层完全不渲染。

### 兼容性契约（上游 dsh-web-ui 更新时保持兼容）

本插件只依赖以下**稳定公开接口**；任一项在上游更新后变化，对应功能降级、其余照常工作：

| 依赖接口 | 用途 | 上游变化时的降级 |
|---|---|---|
| `web-ui.plugin.item` 槽位（dsh-web-ui 设置组声明） | 宠物选择器卡片展示 | 卡片不显示；悬浮宠 + 右键菜单 + 设置面板照常 |
| `pet` 设置命名空间 + `webUiSettings`/`settingsScope` 绑定器 | 切换鲸鱼 `enabled` | 无法切换鲸鱼 → 鲸鱼选项隐藏并提示；我们的宠物照常 |
| `/api/pet/state`（dsh-pet 路由） | 探测鲸鱼是否活跃 | 探测失败 → 鲸鱼选项隐藏 |
| dsh 官方 `dsh.client` 机制 + `__ModuleLoader__` bundle 形态 | 插件装载 | 随 dsh 生态演进，按官方形态适配 |

本插件单装（无 dsh-web-ui）也可独立工作：右下角一只悬浮宠 + 右键菜单 + 设置面板。

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

- **换形象**：直接替换 `emotes/` 里对应状态的文件（保持文件名，或改 `pet.json` 的 `emotes` 映射指向新文件），内置宠物需执行 `pnpm build` 重新内联；自定义宠物刷新页面即生效（GIF/PNG/WebP 均可，推荐 GIF 动图）。
- **加宠物**：新建 `assets/pets/<你的宠物名>/` 目录，放入 `pet.json` + `emotes/`（5 个状态文件），重启 `dsh web` 后出现在右键切换菜单。也可复用 macOS 原生版 desktop-pets 的 `pets/<名称>/` 素材（协议同源）。
- **删宠物**：删除目录即可。

## 事件 → 状态对照

| 事件 | 状态 | 气泡 |
|---|---|---|
| `step/start` | thinking | — |
| `tool/call` | running | 🛠 工具 · 参数预览 |
| `turn/end`（completed） | success（4s 后回 idle） | 🎉 完成！ |
| `turn/end`（中止/失败） | idle | 清空 |
| `session/disposed` | idle | 清空 |
| idle 持续 2 分钟 | waiting（派生） | — |

## HTTP 接口（宿主侧）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/web-pets/state` | 状态快照（state / bubble / activePet / pets / visible / size / domSignals / version） |
| GET | `/api/web-pets/info` | 安装形态 + 版本 + 更新命令预览 |
| GET | `/api/web-pets/check` | 检查 GitHub 最新版本（直连 + pinned + 代理回退；仅本机请求） |
| POST | `/api/web-pets/update` | 一键更新（git pull + fix-web-profile.sh；仅 link 安装、仅本机请求、120s 超时） |
| POST | `/api/web-pets/set-enabled` | 启用 / 禁用 |
| POST | `/api/web-pets/set-pet` | 切换活动宠物 |
| POST | `/api/web-pets/set-visible` | 显示 / 隐藏 |
| POST | `/api/web-pets/set-size` | 设置大小（32–512） |
| POST | `/api/web-pets/set-config` | 设置大小/位置/名称/镜像/domSignals |
| POST | `/api/web-pets/interact` | 摸头互动 |
| GET | `/web-pets-assets/<pet>/emotes/<file>` | 自定义宠物素材（GIF/PNG/WebP，带 ETag） |

> 写路由与更新/检查路由均校验请求 Host 必须为 `127.0.0.1|localhost|[::1]`（CSRF 防护）。

## 兼容性

- 宿主侧：`@deepseek-ai/dsh-session`（会话事件）+ `@deepseek-ai/dsh-host-webserver`（HTTP 路由）。
- 浏览器侧：TS 源码经 tsdown 构建为 `__ModuleLoader__.load` 形态的 CJS bundle，仅外部依赖 `react` / `react-dom/client`（经宿主模块加载器提供）；内置宠物素材 data-URI 内联，自定义宠物走同源素材路由。

## 许可

MIT License。本插件所有代码与素材均为作者自有。变更记录见 [CHANGELOG.md](CHANGELOG.md)，英文说明见 [README.en.md](README.en.md)。
