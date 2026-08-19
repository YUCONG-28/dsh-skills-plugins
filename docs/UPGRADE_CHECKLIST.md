# 升级回归清单（UPGRADE_CHECKLIST）

> 每次升级后按此清单回归；🔴 项必测。
> 最近一次：2026-08-19，dsh-web-ui-all 0.2.0 → 0.2.3（dsh core rc.7 基线）

## T1 基础冒烟（5 分钟）

- [x] Web GUI 正常加载、无控制台报错（本轮：HTTP 200，Safari 渲染正常）
- [ ] 新会话创建/切换、消息收发正常（WebSocket）
- [ ] 主题/皮肤不破（dark 主题 + `ui-skin-blue-fantasy`）

## T2 上游 0.2.0 变更点

- [x] Skill Explorer（新增）：侧边栏出现「技能中心」入口（本轮 Accessibility 树可见）
- [ ] Better Sidebar（新增）：默认行为正常；不习惯可在设置中禁用
- [ ] live-stats 移除确认：设置中无对应入口且无残留报错

## T3 自研插件耦合点（🔴 高风险）

| 插件 | 验证项 | 本轮结果 |
| --- | --- | --- |
| dsh-web-pets | 设置→Web UI 插件→宠物区出现「宠物选择」卡片；切换/互斥生效 | 待用户界面确认 |
| dsh-pet | 宠物显示/隐藏、`~/.dsh/pet.json` 与 settings.yaml pet 段读写 | 待用户界面确认 |
| dsh-liangshen | 预设选择器「梁神模式」仍在 | ✅ 会话头可见「梁神模式」 |
| describe-image | 含图轮次走 Qwen VL；override 仍生效 | 待确认 |
| dsh-ssh / 任务看板 | 侧边栏入口 | ✅ 侧边栏可见「SSH」「任务看板」 |
| dsh-computer-use | computer_* 工具注册可用 | ⚠️ 发现 bug：不截图时 `computer_observe` 输出 schema 校验失败（screenshot:null vs object），已修复源码，待同步+重启验证 |
| dsh-vision-bridge | 含图轮次路由 / 本地 OCR | 待确认 |

## T4 升级一致性检查

- [x] `scripts/check-profile-patches.sh`：profile 引用的 web-ui-* id 均在 bundle 中，无重复 insert
- [x] 无 0.1.20 残留（pnpm-lock.yaml 无 0.1.20 引用；@linxin666/* 全部 0.2.0，better-sidebar 0.13.0）
- [ ] `pnpm ls` 人工复核（本会话沙箱中 pnpm store sqlite 报错，用户终端可正常执行）

## 升级后待办（用户终端执行）

```bash
# 事务式升级（推荐）：snapshot → 测试 → canary → apply → 健康检查 → promote/自动回滚
bash /Users/yucong/Documents/Deepseek\ Harness/dsh-skills-plugins/scripts/dsh-safe-upgrade.sh --yes

# 手动同步（等价于 safe-upgrade 的 apply 阶段，供确认用）
cd ~/.dsh/profiles/web && pnpm install          # 刷新 file: 插件副本（含 computer_observe 修复）
bash /Users/yucong/Documents/Deepseek\ Harness/dsh-skills-plugins/fix-web-profile.sh
bash /Users/yucong/Documents/Deepseek\ Harness/dsh-skills-plugins/sync-skills.sh
# 注意：vision-bridge v0.3+ 无需任何 node_modules 补丁（旧式补丁脚本已废弃、默认 NO-OP）
# 重启 dsh web 后按上方未勾选项逐项确认
```