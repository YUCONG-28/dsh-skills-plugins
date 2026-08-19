# 升级手册（UPGRADE_RUNBOOK）

> 本仓库插件/上游 npm 插件/dsh core 升级的**事务式标准流程**与崩溃恢复方法。
> 更新日期：2026-08-19

## 0. 原则

- **只允许两种入口升级**：
  1. 事务式：`bash scripts/dsh-safe-upgrade.sh`（推荐，自动 snapshot → canary → 测试 → promote / 回滚）；
  2. 手动（不推荐，仅当自动化不可用）：按下方「附录 A」逐步操作，且必须先 `bash scripts/dsh-snapshot.sh`。
- 升级一律**显式版本 bump**（`pnpm up <pkg>@<version>`），不裸跑 `pnpm up --latest` 跨多版本。
- 升级后按 [UPGRADE_CHECKLIST.md](UPGRADE_CHECKLIST.md) 回归，🔴 项必测。
- 版本基线记录在 [versions.lock.json](../versions.lock.json)，由 `scripts/check-versions.mjs` 在 CI 自动校验，防止漂移。

## 1. 事务式升级（推荐）

```bash
cd /Users/yucong/Documents/Deepseek Harness/dsh-skills-plugins

# 只升级 profile 依赖（如 web-ui-all）
bash scripts/dsh-safe-upgrade.sh --profile-deps "@linxin666/dsh-web-ui-all@0.2.3" --yes

# 同时升级 dsh core 到 next（0.1.0-rc.8）
bash scripts/dsh-safe-upgrade.sh --dsh-target next --yes

# 先拉取仓库 origin/main 再升级（要求工作区干净）
bash scripts/dsh-safe-upgrade.sh --repo-update --dsh-target next --yes

# 只做预检（snapshot + 全插件测试 + 隔离 canary，不改任何生产状态）
bash scripts/dsh-safe-upgrade.sh --dry-run
```

流程：

```text
preflight
    ↓
创建 LKG snapshot（scripts/dsh-snapshot.sh）
    ↓
记录 git SHA + dsh 版本 + package/pnpm-lock 版本
    ↓
全插件自动化测试（scripts/run-plugin-tests.sh）
    ↓
隔离 DSH_HOME canary（.dsh-canary，不碰 ~/.dsh）
    ↓
apply（--dsh-target / --profile-deps / --repo-update）
    ↓
canary 重跑（新状态）
    ↓          ↓
  PASS       FAIL
    ↓          ↓
 promote   automatic rollback
（重启+健康检查）  （dsh-rollback.sh latest）
```

> 升级成功后会创建 LKG git tag：`lkg-<时间>-<dsh版本>`（`--no-tag` 关闭）。
> 成功后可用 `--update-lock` 自动刷新 versions.lock.json 并提交。

## 2. 崩溃恢复：一键回滚

```bash
cd /Users/yucong/Documents/Deepseek Harness/dsh-skills-plugins
bash scripts/dsh-rollback.sh latest --yes
```

自动完成：

```text
校验快照 manifest + 文件 sha256
    ↓
备份当前（损坏）状态到 ~/.dsh/rollback/_broken-*/
    ↓
停止当前 dsh web
    ↓
恢复 settings / cordis patches / package.json / pnpm-lock.yaml
    ↓
checkout 快照记录的 repo commit（工作区脏需 --force）
    ↓
pnpm install --frozen-lockfile
    ↓
fix-web-profile.sh + sync-skills.sh 重同步自研插件/技能
    ↓
冒烟 → 重启 → dsh-healthcheck.sh
```

也可指定历史快照：`bash scripts/dsh-rollback.sh 20260819-191500 --yes`。
快照目录：`~/.dsh/rollback/`（`latest` 符号链接指向最近一份，默认保留 8 份）。

## 3. 快照与健康检查

```bash
# 升级前手动创建 LKG 快照（safe-upgrade 会自动做，这里给手动流程用）
bash scripts/dsh-snapshot.sh

# 健康检查（崩溃保险丝）：进程 / HTTP / __DSH_BOOT__ / 插件加载 / 无 fatal / session
bash scripts/dsh-healthcheck.sh --url http://127.0.0.1:3080
```

## 4. 升级后置脚本（按需）

```bash
bash fix-web-profile.sh          # 同步 file: 插件副本（幂等；v2：staging + 原子替换）
bash sync-skills.sh              # 同步 skills/ 到 ~/.dsh/skills/
bash scripts/check-profile-patches.sh   # 校验 profile patch 与 bundle patch 一致性
```

> 注意：vision-bridge v0.3+ 不需要任何 DSH node_modules 补丁（image-capable 虚拟 provider 通过官方准入）；
> 旧式补丁脚本已废弃、默认 NO-OP，升级流程**不再包含**该步骤。

## 5. 回归与重启

1. 重启 `dsh web`（safe-upgrade 的 `--yes` 会代为重启），新开一个会话
2. 按 [UPGRADE_CHECKLIST.md](UPGRADE_CHECKLIST.md) 的 T1–T4 回归
3. 确认无控制台报错、无重复 insert

## 6. 升级后更新基线记录

- `scripts/dsh-safe-upgrade.sh --update-lock` 自动刷新 [versions.lock.json](../versions.lock.json)
- 更新 [SUMMARY.md](../SUMMARY.md) 的安装状态

## 附录 A：手动升级/回滚（fallback）

### 手动升级

```bash
TS=$(date +%Y%m%d-%H%M%S)
bash /Users/yucong/Documents/Deepseek\ Harness/dsh-skills-plugins/scripts/dsh-snapshot.sh --label manual-$TS
cd ~/.dsh/profiles/web
pnpm install @linxin666/dsh-web-ui-all@<新版本>
bash /Users/yucong/Documents/Deepseek\ Harness/dsh-skills-plugins/fix-web-profile.sh
# 重启 dsh web 并回归
```

### 手动回滚

```bash
# 找到最近的快照
ls ~/.dsh/rollback/
# 恢复（以最新为例）
bash /Users/yucong/Documents/Deepseek\ Harness/dsh-skills-plugins/scripts/dsh-rollback.sh latest --yes
```

### 传统备份方式（最底层 fallback）

```bash
TS=$(date +%Y%m%d-%H%M%S)
cp ~/.dsh/settings.yaml ~/.dsh/settings.yaml.bak-$TS
cp ~/.dsh/cordis.patch.yml ~/.dsh/cordis.patch.yml.bak-$TS
cp ~/.dsh/profiles/web/cordis.patch.yml ~/.dsh/profiles/web/cordis.patch.yml.bak-$TS
cp ~/.dsh/profiles/web/package.json ~/.dsh/profiles/web/package.json.bak-$TS
cp ~/.dsh/profiles/web/pnpm-lock.yaml ~/.dsh/profiles/web/pnpm-lock.yaml.bak-$TS
# 出问题时恢复以上文件，再 cd ~/.dsh/profiles/web && pnpm install --frozen-lockfile，重启 dsh web
```

## 7. 故障排查

- 回滚提示「快照文件损坏」：sha256 校验失败，不要强改，换更早的快照。
- 回滚提示「工作区有未提交改动」：先 commit/stash，或加 `--force`（脚本会先 stash）。
- `pnpm install --frozen-lockfile` 失败：网络/镜像问题，重试；当前状态已备份在 `~/.dsh/rollback/_broken-*/`。
- 健康检查报「多个实例」：用 `--pid` 指定要检查的实例。
