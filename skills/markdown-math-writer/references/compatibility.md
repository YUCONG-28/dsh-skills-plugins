# compatibility.md — target-specific 方言兼容规则（v3）

本文件规定 markdown-math-writer v3 的方言策略。**核心原则：按 target 选择 block syntax，不追求跨渲染器 block 语法完全统一。** 共享的是数学内容（LaTeX 子集），不共享完全相同的 block syntax。

## 1. 方言总表（Target Dialects）

| 项目 | github（默认） | mpe | generic |
|---|---|---|---|
| inline | `$...$` | `$...$` | `$...$` |
| block | ```math fence | `$$...$$` | `$$...$$` |
| 公式编号 | Markdown 文本 `**式 (N)**` | `\tag{}`（`\end` 之后） | `\tag{}` 可选 |
| aligned | 禁止（默认） | 允许 | 允许 |
| align/equation/gather/split | 禁止 | 允许（须经引擎验证） | 允许 |
| `\boldsymbol` | 建议 `\mathbf`（warning） | 允许 | 允许 |
| math fence 使用 | 默认方言 | warning（非本方言） | warning（非本方言） |
| 空 `_{}`/`^{}` | FAIL | FAIL | FAIL |
| brace mismatch | FAIL | FAIL | FAIL |

## 2. GitHub target（P1）硬性规则

1. block math 一律 ```math fence；**禁止生成 `$$...$$` 独立公式**（GitHub 的 Markdown block parser 与 `$$` 边界问题多）。
2. ```math 是 GitHub 数学块，不是普通 code block；```text / ```markdown / ```python 是普通 code block，真实公式不得放入。
3. **禁止 `\tag{...}`**：编号是 Markdown 文本，不是 LaTeX 命令：
   ```markdown
   **式 (2.1)**

   ```math
   t_k \in \mathcal{W}_{\mathrm{onset}},
   \qquad
   \Delta f_k = f_k-f_{\mathrm{III}}(t_k)>0.
   ```
   ```
4. **禁止 `aligned` 作为默认输出**：一个逻辑等式一个 math block；长推导拆成多个块。
5. 默认用 `\mathbf` 不用 `\boldsymbol`（更保守、跨渲染器稳定；`\boldsymbol{\nabla}` 直接用 `\nabla`）。
6. 物理标签继续用 `\mathrm`：`f_{\mathrm{III}}`、`v_{\mathrm{A}0}`、`W_{\mathrm{onset}}`；保持 group 简单（不写 `v_{{\mathrm{A}0}}`）。
7. cases：实测稳定可保留；默认更推荐 Markdown list 分区间 + 每区间一个公式。
8. 矩阵保留 `pmatrix`/`bmatrix`，但必须单独一个 math fence。
9. 编号（Markdown 文本）与公式块分离，编号不在数学环境内。

## 3. MPE / Generic target

- block：`$$...$$` 独占行、前后空行；多行用 `aligned`；`\tag` 必须位于 `\end{...}` 之后（`\tag` 在 aligned 内部 → KaTeX/GitHub 报 'tag not allowed in aligned environment'）。
- `\boldsymbol` 允许；`\(...\)` 依然禁用（MPE/Obsidian 默认不渲染）。

## 4. 通用规则（全部 target）

1. inline `$...$` 紧贴内容（`$E=mc^2$`）；行内不用 `$$`；行内公式不跨行。
2. 只使用公共 LaTeX 子集：`\frac \sqrt \sum \int \lim \partial \nabla \mathbf \mathrm \text \left \right`、上下标、简单矩阵。
3. 文本中货币 `\$`；shell 变量 `$HOME` 保持原样或 inline code 包裹；code fence/inline code 中的 `$` 一律是字面量。
4. 禁止 `x_{}`、`x^{*}_{}`、`x^{2}^{3}`、`\frac{x}`、`\frac{x}{y}{z}`、孤立运算符 `- \ `。
5. 公式原子化生成；禁止字符串片段拼接；修复 = 整节点重新生成。

## 5. 验证口径（v3）

- 本地 KaTeX PASS + MathJax PASS + AST PASS 只说明**语法正确**。
- 不得报告 "GitHub rendering verified"，除非真的在 GitHub 页面观察成功。
- 本地输出：`GITHUB-SAFE STRUCTURE: PASS`。
- 渲染测试：`render_html.mjs --renderer both`（KaTeX 与 MathJax 均真实执行，含 math fence）。

## 6. 不支持语法的处理

1. 改写为公共子集等价形式（`\ce{H2O}` → `\mathrm{H_2O}`）。
2. 无法改写时标注并如实报告；禁止静默删除或假装通过。
3. 复杂公式（多行 aligned / >400 字符 / 嵌套 >5 / 多环境）→ NEEDS_REGENERATION，由 Agent 重新生成，不做危险 regex 拆分。
