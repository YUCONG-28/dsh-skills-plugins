---
name: markdown-math-writer
description: "Use when creating, editing, organizing, completing, or rewriting Markdown/.md files — READMEs, course notes, research notes, math/physics documents, formula derivations, lab reports — to write LaTeX math correctly per TARGET renderer. Target routing: README/GitHub/repository docs → github-safe mode: inline single-dollar math, math-fence blocks, equation numbers as Markdown text, no tag command, no aligned, no boldsymbol; Markdown Preview Enhanced notes → mpe mode: double-dollar blocks, aligned and tag allowed; otherwise generic. Triggers: 创建Markdown/修改.md/README/GitHub README公式/学习笔记/科研笔记/数学文档/公式推导/LaTeX公式修复/Markdown Preview Enhanced文档/公式竖排错乱/Extra close brace."
whenToUse: "用户要求创建、修改、整理、补全或重写 Markdown/.md 文件（README、课程笔记、科研笔记、数学/物理文档、公式推导、实验报告、学习资料总结），要求修复/检查 Markdown 中的 LaTeX 公式（含 GitHub README 中公式竖排错乱、下标上标错位、Extra close brace or missing open brace、原始美元符号被直接显示等问题），或要求生成 GitHub / Markdown Preview Enhanced / MathJax / KaTeX / Obsidian 兼容文档时使用。只要输出文件名是 README(.md) 或目标平台是 GitHub，就自动进入 github-safe 模式。若文档没有数学内容，不强制添加公式。"
metadata:
  version: "3.0"
  category: markdown-writing
---

# markdown-math-writer v3 — target-specific Markdown 数学写作

**设计哲学（v3）**：不再试图用一套 block syntax 同时兼容所有渲染器。按目标选择方言：
"本地 renderer 能解析" ≠ "GitHub README 能正确显示"。validator 只报告语法与结构正确，
**不声称** GitHub 页面渲染已验证。

## Changelog v3

- target-specific rendering：`github` / `mpe` / `generic`，默认 `github`
- GitHub-safe 模式：block math 用 ```math fence（不再默认生成 `$$...$$`）
- GitHub 模式禁止 `\tag`：公式编号移到 Markdown 正文（**式 (2.1)**）
- GitHub 模式默认禁止 `aligned`：一个逻辑等式一个 math block
- GitHub 模式默认用 `\mathbf` 代替 `\boldsymbol`
- 公式修复策略：**REGENERATE 整个公式节点**，废弃 brace 级 regex patch
- 复杂度限制：>400 字符 / brace 嵌套 >5 / 多环境 → 拆分或 NEEDS_REGENERATION
- validator 输出改为 `GITHUB-SAFE STRUCTURE: PASS`，不再输出 `GITHUB RENDER: PASS`
- 新增 `scripts/github_safe_math.mjs` 格式化器；`render_html.mjs` 支持渲染 math fence

## 目标路由（Target Routing）

| 用户意图 | target | inline | block | 编号 | 环境 |
|---|---|---|---|---|---|
| README / GitHub / 仓库文档 / README.md | **github**（默认） | `$...$` | ```math fence | Markdown 文本 `**式 (N)**` | 禁止 aligned/equation/align/gather/split |
| "Markdown Preview Enhanced 笔记/文档" | **mpe** | `$...$` | `$$...$$` | `\tag{}`（在 `\end` 之后） | aligned 允许 |
| 其他/未指明且非 README | **generic** | `$...$` | `$$...$$` | 可选 | aligned 允许 |

只要用户提到 README / GitHub / GitHub repository / 仓库文档 / README.md，自动选择 github-safe 模式。

## GitHub-safe 方言（target = github）

```markdown
行内：电子等离子体频率为 $f_{\mathrm{pe}}$。

编号：**式 (8.14)**

```math
f_{\mathrm{pe}}
=
8980\sqrt{n_e}.
```
```

**硬性规则（validator 在 --target github 下 FAIL）**：

- 存在 block `$$...$$`（独立公式必须 ```math fence）
- 存在 `\tag{...}`
- 存在 `\begin{aligned}` / `\begin{align}` / `\begin{equation}` / `\begin{gather}` / `\begin{split}`
- 存在空 `_{}` / `^{}`
- 普通 markdown/text/code fence 中出现真实公式（`$$` 独占行或 `\begin{`）
- 存在未闭合 math fence
- 存在 brace mismatch

**warning**：`\boldsymbol`（建议 `\mathbf`）、复杂嵌套 `\left/\right`、brace 嵌套 >5、单公式 >400 字符。

**长推导拆分**（不要把所有推导塞进一个 aligned）：

```markdown
由磁场定义，

```math
B_x=-\frac{\partial\psi}{\partial y},
\qquad
B_y=\frac{\partial\psi}{\partial x}.
```

因此，

```math
\nabla\cdot\mathbf{B}
=
-\frac{\partial^2\psi}{\partial x\partial y}
+
\frac{\partial^2\psi}{\partial y\partial x}.
```

由于混合偏导可交换，

```math
\nabla\cdot\mathbf{B}=0.
```
```

**优先级**：simple expression > 多个独立 math blocks > 复杂 environment。

**矩阵**可以保留 `pmatrix`/`bmatrix`，但必须单独一个 math fence，不与其他公式混块。

**cases**：GitHub 实测稳定可保留；更推荐用 Markdown list 分区间描述（每区间一个公式）。

## MPE / Generic 方言（target = mpe / generic）

```markdown
行内：$E=mc^2$。

$$
E_k = \frac{1}{2}mv^2
\tag{1}
$$

$$
\begin{aligned}
F_x &= ma_x, \\
F_y &= ma_y.
\end{aligned}
\tag{2}
$$
```

注意：`\tag` 必须位于 `\end{...}` 之后；math fence 在 mpe/generic 目标下给出 warning（非 GitHub 方言）。

## 公式修复策略（v3 强制）

**发现 math node 错误 → 读取整个公式 → 理解数学语义 → 重新生成完整公式 → 替换整个 math node。**

- 禁止局部 patch：先拆 brace → 改中间 → 手工拼 brace（Extra close brace 的常见来源）
- 禁止 regex 改写数学意义；`github_safe_math.mjs` 只做机械安全转换（双美元块转 fence、去 \tag、\boldsymbol→\mathbf、单行 aligned 去包装）
- 复杂 node（多行 aligned、多环境、>400 字符、嵌套 >5）输出 **NEEDS_REGENERATION**，由 Agent 按上下文重新生成

## 复杂度限制

单公式 >400 字符、brace 嵌套 >5、含多个 environment → 不直接输出，拆成多个公式。
README 的目标是清晰和稳定，不是论文排版。

## 验证器与格式化器

```bash
# 六层校验（target 默认 github）
node ~/.dsh/skills/markdown-math-writer/scripts/validate_math.mjs --target github <文件.md>
node ~/.dsh/skills/markdown-math-writer/scripts/validate_math.mjs --target mpe <文件.md>
node ~/.dsh/skills/markdown-math-writer/scripts/validate_math.mjs --target generic <文件.md>

# GitHub-safe 格式化（$$→math fence、\tag→Markdown 编号、\boldsymbol→\mathbf）
node ~/.dsh/skills/markdown-math-writer/scripts/github_safe_math.mjs --report <输入.md> <输出.md>

# 实际渲染测试（KaTeX + MathJax 均真实执行，含 math fence）
node ~/.dsh/skills/markdown-math-writer/scripts/render_html.mjs --renderer both <文件.md>
```

validator 的职责边界：Markdown 结构 / math fence 配对 / inline math 配对 / LaTeX brace /
数学语法（KaTeX+MathJax）/ 普通 fence 不包公式 / 无 \tag / 无禁用 environment / 无双美元 block（github-safe）/ 无空上下标。
**不再输出 "GitHub rendering verified"**——只有 GITHUB-SAFE STRUCTURE: PASS。
若真的需要在 GitHub 页面观察成功，那一步只能由用户上传后确认。

## 强制工作流（13 步，v3 修订）

1. **Route**：按目标路由选择方言（README/GitHub → github-safe）。
2. **Generate**：按方言生成 Markdown；公式原子化书写；复杂度限制内。
3. **Write**：写入真实 `.md` 文件。
4. **Re-read**：重新读取磁盘文件，核对反斜杠、分隔符、braces、fence、代码边界。
5. **AST parse**：区分 text / inline math / math fence / code fence / inline code / table。
6. **Node extraction**：提取全部公式节点与 math fence。
7. **Brace/environment lint**：平衡、空组、连续上下标、参数数、环境栈、孤立运算符。
8. **KaTeX validation**：逐节点 throwOnError。
9. **MathJax validation**：mathjax-full 逐节点。
10. **Target lint**：按 target 检查方言硬性规则（github：双美元块、\tag、aligned、\boldsymbol、复杂度）。
11. **Render test**：render_html.mjs --renderer both（含 math fence）。
12. **Fix by regeneration**：错误公式整节点重新生成，重复 5–11。
13. **Only return after PASS**：`GITHUB-SAFE STRUCTURE: PASS`（github 目标）才交付。

## 测试与验证

- 测试集：`node ~/.dsh/skills/markdown-math-writer/evals/run_evals.mjs`（40 用例，三目标独立）
- 方言文件：`evals/github-safe.md` / `evals/mpe-safe.md` / `evals/generic-safe.md`（各自独立验证，不混用）
- GitHub 视觉 smoke：`evals/github_visual_smoke.md`
- 真实迁移回归：`README.github-safe-test.md`（solarphysics README 副本：
  183 个双美元块 → 187 个 math fence（含拆分）、183 \tag → Markdown 编号、166 display \boldsymbol + 46 inline → \mathbf、
  5 个多行 aligned 重新生成、44 个代码块零改动）
