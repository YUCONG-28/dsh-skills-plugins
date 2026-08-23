# awesome-dsh-plugin 投稿文件（待提交）

> 依据 [awesome-dsh-plugin/contributing.md](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md) 准备。
> 状态：**未提交**。活动插件均已声明 `dsh.bundle` manifest（见仓库根 README），满足收录门槛；仓库已打 `dsh-plugin` topic。

## 文件说明

| 文件 | 对应插件 | 分类 |
| --- | --- | --- |
| `YUCONG-28__dsh-skills-plugins--plugins-dsh-computer-use.yml` | dsh-computer-use（monorepo 子目录） | `tools` |

> `dsh-vision-bridge` 已归档（`archive/dsh-vision-bridge/`），其投稿 YAML 移入归档目录，不再参与投稿。

## 提交步骤

```bash
# 1. fork awesome-dsh-plugin 并 clone
# 2. 把上述 1 个 YAML 放入 data/plugins/
# 3. 重新生成 README（上游规则：勿手改 README）
npm ci
node scripts/generate-readme.mjs
# 4. 提交并开 PR（PR 只允许动自己新增的条目）
```

## 未收录项说明

- `markdown-math-writer` / `study-review`：纯 SKILL.md 目录（复制到 `~/.dsh/skills/` 使用），不满足「可 `dsh plugin add` 安装」门槛；如后续打包为 bundle 插件可再提交（分类 `skill` / `docs`）。
- `dsh-desktop-pets`：依赖 macOS 桌面宠物引擎（AppKit），收录价值有限；如需收录可单独提交（分类 `fun`）。

## 描述文案（与 README 保持一致）

- dsh-computer-use（tools）：macOS desktop control for agents: observe Accessibility trees and screenshots, then click, type, key and scroll with per-app grants and one-time confirmations.
