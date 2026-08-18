# 全量测试报告（TEST_REPORT）

> 日期：2026-08-18 · 范围：dsh-skills-plugins 仓库全部内容（skills / plugins / projects）
> 环境：macOS，dsh web profile（@linxin666/dsh-web-ui-all 0.2.0）

## 结论

**全部可自动化测试通过**；发现 3 个问题（2 个已修复，1 个需用户执行）。

## 一、静态检查（全部通过）

- package.json ×4 解析 ✅；YAML ×16 ✅（含 docs/awesome-submission）
- JS/MJS 语法 ✅（18 个文件，node --check）
- Shell 语法 ✅（11 个脚本，bash -n）
- Python 语法 ✅（AST 全量校验；py_compile 因沙箱缓存写入限制改用 ast）
- Swift 编译 ✅（ocr.swift / cu-helper.swift，swiftc -typecheck）
- npm pack --dry-run ✅（4 个插件打包完整，files 字段覆盖正确）

## 二、Skills

| 组件 | 测试 | 结果 |
| --- | --- | --- |
| markdown-math-writer | evals 40 用例（github/mpe 校验规则） | ✅ 40/40 PASS |
| markdown-math-writer | github_safe_math.mjs 格式化器 | ✅ 正常运行（--stdout） |
| markdown-math-writer | render_html.mjs katex 渲染 | ✅ katex-error=0 |
| study-review | extract_pdf.py（gs 生成真实文本 PDF） | ✅ 正确提取文本 |
| study-review | extract_ooxml.py（最小 docx） | ✅ 正确提取文本 |

## 三、插件

| 组件 | 测试 | 结果 |
| --- | --- | --- |
| dsh-computer-use | test/unit.test.mjs | ✅ 10/10 |
| dsh-computer-use | test/batch.test.mjs | ✅ 6/6 |
| dsh-computer-use | test/apply-smoke.mjs（mock ctx 注册 11 工具+Skill+路由） | ✅ 4/4（修复后） |
| dsh-computer-use | python 测试 ×9（memory/skills/training/trainer/router/state/computer） | ✅ 全部 PASS |
| dsh-computer-use | bin/cu-helper 直接调用：ping / apps / tcc-status | ✅ ok=true；辅助功能+屏幕录制已授权 |
| dsh-vision-bridge | node --test（unit + adapter 集成） | ✅ 24/24（v0.2 重构：image-capable vision-router、OCR-first、cache L1+L2、fallback、timeout、fail-soft） |
| dsh-vision-bridge | P6 静态审计（schemastery-only schema、无内部 @deepseek-ai 导入） | ✅ |
| dsh-vision-bridge | apply-vision-patch.sh | ✅ 已废弃默认 NO-OP，不再需要（v0.2 虚拟模型通过官方准入） |
| dsh-vision-bridge | 真实 dsh web 启动冒烟（P7，临时端口） | ✅ boot OK（本地 rc.7） |
| dsh-web-pets | assets pet.json ×2 + emotes ×10 | ✅ 完整 |
| dsh-web-pets | lib export 形状（apply/inject/name/_internals） | ✅ |
| dsh-desktop-pets | lib export 形状 + pet_engine import（pyobjc） | ✅ |
| dsh-desktop-pets | petctl.sh 生命周期 start→status→stop | ✅ 启动（PID 99846）→ 运行 → 停止，pet.log 无错误 |

## 四、兼容性

- check-profile-patches.sh：profile 引用的 web-ui-* id 均在 bundle 中、无重复 insert ✅
- 版本一致性：@linxin666/* 全部 0.2.0、dsh-better-sidebar 0.13.0、pnpm-lock.yaml 无 0.1.20 残留 ✅
- GUI 实测（Safari Accessibility 树）：侧边栏「技能中心/SSH/任务看板」、会话头「梁神模式」均正常 ✅
- npm pack 备注：dsh-computer-use 打包不含 memory/training/computer 等自学习 python 模块（本地 file: 安装不受影响；若未来发布 npm 需扩充 files 并排除运行产物）

## 五、问题与处理

| # | 问题 | 状态 |
| --- | --- | --- |
| 1 | computer_observe 未截图时返回 screenshot:null，违反输出 schema（工具必然报错） | ✅ 已修复（省略 null 字段；schema 保持 object 以兼容 dsh-tools），apply-smoke 4/4 验证 |
| 2 | ocr.swift rewrite() 未使用变量 orientation 编译告警 | ✅ 已修复（`_`），重编译零告警 |
| 3 | dsh-host-apiproxy 图像准入补丁失效（vision-bridge 依赖） | ✅ 已解决：v0.2 引入 image-capable 虚拟 provider，无需任何 node_modules 补丁 |

## 六、用户待执行（终端）

```bash
cd ~/.dsh/profiles/web && pnpm install
bash /Users/yucong/Documents/Deepseek\ Harness/dsh-skills-plugins/fix-web-profile.sh
# vision-bridge v0.2 起不再需要 apply-vision-patch.sh（已废弃、默认 NO-OP）
# 请改用虚拟模型：设置 → Models 选择 vision-router / deepseek-v4-pro-vision
# 重启 dsh web 后 computer_observe 修复生效
```

## 七、未自动测试项（需人工/不适合自动化）

- benchmarks/run_benchmark.py：会真实操控桌面应用（打开 App/输入），未自动执行
- dsh-web-pets 浏览器侧渲染（宠物卡片/悬浮宠）：需浏览器人工确认
- study-review 五种提示词模式：属模型行为，脚本层已覆盖