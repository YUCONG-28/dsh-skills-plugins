# 运行环境 artifact 迁移设计（P2：版本化 tarball / immutable artifact）

> 状态：**设计文档**（P2，未实现）。本仓库当前处于 P0/P1 已完成的状态：
> 事务式升级/回滚（snapshot → canary → health-check → rollback）已落地；
> 本文件描述把「`file:` + 手工 `cp node_modules`」迁移为「版本化 tarball / npm exact version」的路径。

## 现状

- 运行中的插件 = 仓库源码目录（`file:` 依赖 → pnpm 硬链接副本 → `fix-web-profile.sh` 同步）。
- 优点：改源码即生效，迭代快。
- 缺点：
  - 源码与运行环境耦合：任意源码改动都可能“污染”正在运行的环境；
  - `fix-web-profile.sh` 的 cp 同步是非不可变操作（v2 已改为 staging + 原子替换，但仍是副本同步）；
  - 回滚依赖 repo checkout + 重新同步，无法保证与“当时发布”的产物完全一致（源码可被后续 commit 改变）。

## 目标形态

```text
开发：   link:/repo/plugin          # 源码迭代，CI 把关
发布：   file:/artifacts/plugin-v0.3.3.tgz   # 不可变 artifact（sha256 记录在 manifest）
稳定：   npm:<plugin>@exact-version          # 或 npm exact version
```

- 运行中的插件是一个**不可变 artifact**：内容在打包那一刻冻结，源码怎么改都不污染生产环境。
- 每次发布 = 一个带 SHA256 的 tarball + 对应 LKG tag；回滚 = 换 artifact，不需要 checkout 源码。

## 迁移步骤（建议顺序）

1. **发布流水线**（CI release job 扩展）：
   - 对每个插件：`pnpm pack` / `npm pack` 生成 `<name>-<version>.tgz`；
   - 计算 SHA256 并写 `SHA256SUMS.txt`（web-pets 已有此模式，可复用）；
   - 产物发布到 GitHub Release（或私有 npm registry / 本地 artifacts 目录）。
2. **snapshot manifest 已就绪**：`dsh-snapshot.sh` 已在 `installShapes` 记录每个依赖的安装形态（file/link/npm/tarball），迁移时可直接对比。
3. **安装形态切换**：
   - 把 profile `package.json` 中 `file:/.../plugins/<name>` 改为 `file:/.../artifacts/<name>-<version>.tgz`（或 npm exact）；
   - 执行 `pnpm install --frozen-lockfile`（lockfile 会记录 tarball 的 integrity hash）；
   - `fix-web-profile.sh` 不再需要（或降级为仅校验）。
4. **回滚语义升级**：`dsh-rollback.sh` 的 `pnpm install --frozen-lockfile` 天然支持 tarball 依赖（lockfile 冻结），无需 checkout 源码即可回到任意 artifact 组合。
5. **发布节奏**：每次插件版本 bump 都产出一个 artifact + LKG tag；`safe-upgrade --profile-deps` 直接引用新 artifact 版本。

## 兼容与回退

- P2 迁移期间保留 `file:` 形态作为开发模式；`dsh-snapshot.sh` 的 `installShapes` 字段用于审计当前形态。
- 若 tarball 发布不可用（无网络/私有 registry），可退化为本地 artifacts 目录（`file:/path/to/artifacts/*.tgz`），仍是不可变文件。

## 完成标准

- 三个插件均能以 tarball 形态安装并跑通 `dsh-safe-upgrade.sh --dry-run`；
- 回滚到任意历史 artifact 组合不需要 `git checkout`；
- `fix-web-profile.sh` 仅作为开发模式的便利工具保留。
