# Changelog

## v0.2.3 (2026-08-18)

- release workflow 幂等化：重复发布/重跑时若 Release 已存在则跳过创建，仅补跑 npm publish。
- release workflow 支持 workflow_dispatch 手动触发（可指定版本号重发）。
- 版本与测试同步至 0.2.3。

## v0.2.2 (2026-08-18)

- 发布体系：npm 包（`dsh-web-pets`）、GitHub Release（tarball + SHA256）、CI/CD（ci.yml / release.yml）。
- 更新检查改为按 `web-pets-v*` 前缀过滤 Release（携带 release notes），避免 monorepo 其它插件干扰。
- `/api/web-pets/update` 识别 link / npm / tarball 三种安装形态：link 走 git pull + fix 脚本、npm 走 pnpm update、tarball 仅提示到 Release 下载。
- 一键发版脚本 `pnpm release -- patch|minor|major`。

## v0.2.1 (2026-08-18)

- 修复：react-dom 被重复打包导致的客户端崩溃风险（`neverBundle` 增加 `react-dom`，`react-dom/client` 改用 namespace import）。
- 修复：`fix-web-profile.sh` 现在会同步 `package.json`，自更新后版本号正确刷新，不再误报「有可用更新」。

## v0.2.0 (2026-08-18)

### 工程化（Phase 1）
- 引入 TS + tsdown 构建：源码迁移至 `src/host/index.ts` 与 `src/client/index.ts`，产物 `lib/index.js`（宿主 ESM）+ `lib/client.js`（客户端 CJS bundle，`__ModuleLoader__` 形态）提交入库，安装无需构建。
- 新增 `scripts/generate-art.mjs`：内置宠物（demo/remiel）素材内联为 data URI（`src/client/art.generated.ts`），并从 package.json 生成版本号（`version.generated.ts`）。
- 新增 `pnpm build` / `pnpm test`（node:test 单元测试 14 例）。

### 宿主增强（Phase 2）
- 宠物注册表 mtime 缓存，`/api/web-pets/state` 不再每次同步读盘。
- 写路由 / 更新 / 检查路由增加本机 Host 校验（`127.0.0.1|localhost|[::1]`，CSRF 防护）。
- `waiting` 状态真正生效：idle 持续 2 分钟派生；`turn/end` 非 completed 同时清空气泡。
- 素材路由支持 PNG/WebP/JPEG MIME 与 ETag（条件请求 304）。
- 新增 `GET /api/web-pets/info`、`GET /api/web-pets/check`、`POST /api/web-pets/update`（monorepo link 形态：`git pull --ff-only` + `fix-web-profile.sh`，120s 超时，输出截断）。
- 新增 `domSignals` 配置（默认关闭，DOM 增强信号开关）。

### 客户端增强（Phase 3）
- 渲染去抖：状态/偏好/反馈未变化时不重建 React 树。
- 右键菜单新增：百分比缩放 / 透明度 / 锁定位置 / 暂停动画（canvas 冻结帧）/ 重置位置 / 打开设置面板。
- 新增设置面板（左右分栏）：外观（缩放/透明度）、行为（锁定/暂停/隐藏/重置/DOM 信号）、更新（自动检查/一键更新）、反馈（GitHub Issues 预填）。
- 点击互动：随机表情 1.8s（参考 dsh-pet-remielle），保留摸头气泡。
- 视觉偏好（scale/opacity/locked/paused）持久化到 `localStorage`。
- DOM 增强信号（默认关闭）：等待卡片 → waiting、think 块细分 → thinking。

### 文档与发布（Phase 5）
- 新增 `CHANGELOG.md`、`README.en.md`；README 补充构建/自更新/设置面板说明。
- 移除 awesome-dsh-plugin 投稿相关（该插件不再加入 awesome 列表）。
- `SUMMARY.md`、`versions.lock.json`、根 README 同步 v0.2.0。

## v0.1.0 (2026-08-16)

- 首个版本：Web 桌宠，随会话状态换表情（thinking/running/success/idle），内置 demo/remiel。
- 并入 dsh-web-ui 宠物入口（单宠物切换器，与上游鲸鱼互斥）。
- 调整参数与官方 dsh-pet 一致（大小/位置/名称/镜像/显示隐藏），拖拽持久化。
- 支持自定义宠物（`assets/pets/<id>/` 协议同源 desktop-pets）。
