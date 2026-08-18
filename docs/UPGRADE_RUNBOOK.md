# 升级手册（UPGRADE_RUNBOOK）

> 本仓库插件/上游 npm 插件升级的标准流程与回滚方法。
> 更新日期：2026-08-18

## 0. 原则

- 升级前**必须备份**：`~/.dsh/settings.yaml`、`~/.dsh/cordis.patch.yml`、`~/.dsh/profiles/web/{package.json,cordis.patch.yml}`
- 升级一律**显式版本 bump**（`pnpm up <pkg>@<version>`），不裸跑 `pnpm up --latest` 跨多版本
- 升级后按 [UPGRADE_CHECKLIST.md](UPGRADE_CHECKLIST.md) 回归，🔴 项必测

## 1. 备份

```bash
TS=$(date +%Y%m%d-%H%M%S)
cp ~/.dsh/settings.yaml ~/.dsh/settings.yaml.bak-$TS
cp ~/.dsh/cordis.patch.yml ~/.dsh/cordis.patch.yml.bak-$TS
cp ~/.dsh/profiles/web/cordis.patch.yml ~/.dsh/profiles/web/cordis.patch.yml.bak-$TS
cp ~/.dsh/profiles/web/package.json ~/.dsh/profiles/web/package.json.bak-$TS
echo 备份完成：$TS
```

## 2. 升级上游 npm 插件（如 dsh-web-ui-all）

```bash
cd ~/.dsh/profiles/web
# 先看最新版本与依赖差异
pnpm view @linxin666/dsh-web-ui-all version
pnpm view @linxin666/dsh-web-ui-all@latest dependencies
# 显式升级
pnpm install @linxin666/dsh-web-ui-all@<新版本>
pnpm ls @linxin666/dsh-web-ui-all   # 确认无旧版残留
```

## 3. 升级本仓库 file: 插件

```bash
cd /Users/yucong/Documents/Deepseek Harness/dsh-skills-plugins
git pull --rebase            # 先更新源码（有本地改动先 stash/commit）
# 刷新安装副本（file: 依赖）
cd ~/.dsh/profiles/web
pnpm install
# 若提示 Already up to date（pnpm 认为 file: 依赖未变）：
rm -rf node_modules/<插件名> && pnpm install
```

## 4. 重跑插件后置脚本（按需）

```bash
bash /Users/yucong/Documents/Deepseek Harness/dsh-skills-plugins/fix-web-profile.sh          # 同步 file: 插件副本（幂等）
bash /Users/yucong/Documents/Deepseek Harness/dsh-skills-plugins/plugins/dsh-vision-bridge/bin/apply-vision-patch.sh   # 视觉准入补丁（dsh 重装/重链后必须）
bash /Users/yucong/Documents/Deepseek Harness/dsh-skills-plugins/plugins/dsh-computer-use/scripts/install.sh           # computer-use 原生 helper 编译+自检
```

## 5. 回归与重启

1. 重启 `dsh web`，新开一个会话
2. 按 [UPGRADE_CHECKLIST.md](UPGRADE_CHECKLIST.md) 的 T1–T4 回归
3. 确认无控制台报错、无重复 insert

## 6. 回滚

```bash
# npm 插件：退回旧版本
cd ~/.dsh/profiles/web
pnpm install @linxin666/dsh-web-ui-all@<旧版本>
# 配置类回滚：恢复备份
cp ~/.dsh/settings.yaml.bak-$TS ~/.dsh/settings.yaml
cp ~/.dsh/cordis.patch.yml.bak-$TS ~/.dsh/cordis.patch.yml
cp ~/.dsh/profiles/web/cordis.patch.yml.bak-$TS ~/.dsh/profiles/web/cordis.patch.yml
cp ~/.dsh/profiles/web/package.json.bak-$TS ~/.dsh/profiles/web/package.json
# 重启 dsh web，确认回到升级前状态
```

## 7. 升级后更新基线记录

- 更新 [versions.lock.json](../versions.lock.json) 中验证过的版本组合
- 更新 [SUMMARY.md](../SUMMARY.md) 的安装状态
