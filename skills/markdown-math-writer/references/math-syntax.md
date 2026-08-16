# math-syntax.md — Markdown LaTeX 公式语法规范（v3，target-specific）

本文件是 markdown-math-writer v3 的公式语法权威参考。**先选 target，再选 block 方言**：

- `target=github`（README / GitHub / 默认）：block math 用 ```math fence
- `target=mpe` / `target=generic`：block math 用 `$$...$$`
- inline math 全部 target 均为 `$...$`

## 0. GitHub-safe 方言总则（target = github）

```markdown
**式 (8.14)**

```math
f_{\mathrm{pe}}
=
8980\sqrt{n_e}.
```
```

硬性规则（validator 在 --target github 下 FAIL）：

1. 独立公式必须 ```math fence，**禁止 `$$...$$` 块**；
2. **禁止 `\tag{...}`**，编号 = Markdown 文本 `**式 (N)**`；
3. **默认禁止 `\begin{aligned}`**、`\begin{align}`、`\begin{equation}`、`\begin{gather}`、`\begin{split}`；长推导拆成多个独立 math block，一个逻辑等式一个块；
4. 默认用 `\mathbf` 代替 `\boldsymbol`；`\boldsymbol{\nabla}` 直接用 `\nabla`；
5. `\mathrm` 物理标签保留：`f_{\mathrm{III}}`、`v_{\mathrm{A}0}`、`W_{\mathrm{onset}}`（group 保持简单）；
6. cases 实测稳定可保留；默认更推荐 Markdown list 分区间描述；
7. 矩阵保留但单独一个 math fence；
8. 单公式 >400 字符 / brace 嵌套 >5 / 多 environment → 拆分或 NEEDS_REGENERATION。

## 1. 分隔符（Delimiters）

| target | 行内 | 独立公式（block） | 编号 |
|---|---|---|---|
| github | `$...$` | ```math fence | Markdown 文本 `**式 (N)**` |
| mpe | `$...$` | `$$...$$` | `\tag{}`（`\end` 之后） |
| generic | `$...$` | `$$...$$` | 可选 |

**禁用**（全部 target）：`\(...\)` `\[...\]`（GitHub/MPE/Obsidian 均不渲染）。

**禁止**单 `$` 独占行包 display math：

```markdown
$
E = mc^2
$
```

github 目标写：

````markdown
```math
E = mc^2
```
````

mpe/generic 目标写：

```markdown
$$
E = mc^2
$$
```

## 2. 行内公式（Inline Math）

- 单个变量/符号：质量为 $m$、等离子体频率 $f_{pe}$、电子束速度 $v_b=\beta c$。
- 行内公式不跨行；多行方程必须用 display math。
- 行内公式内容不要用 `$$`。

## 3. 独立公式（Display Math）

```markdown
$$
E_k = \frac{1}{2}mv^2
$$
```

display math 前后必须有空行（完整 Markdown block boundary），不得与正文、列表 marker、blockquote marker 同处一行。

## 4. 多行公式（aligned）

**仅 mpe / generic 目标**；github 目标默认禁止 aligned（拆分见 §0）。

```markdown
$$
\begin{aligned}
F_x &= ma_x, \\
F_y &= ma_y.
\end{aligned}
\tag{1}
$$
```

**aligned 严格规则**：

- `\begin{aligned}` 与 `\end{aligned}` 必须成对、名称匹配、允许嵌套（用环境栈校验）；
- 最外层必须处于 display math（`$$...$$`），不允许 inline `$...$` 包 aligned；
- 每一行以 `\\` 结束（两个反斜杠；`\\[6pt]` 可选加距参数合法）；
- `&` 对齐符放在关系运算符前（`&= `）；
- **`\tag{}` 必须放在 `\end{...}` 之后**（`\begin{aligned}...\tag{1}\end{aligned}` 会触发 KaTeX/GitHub 的 'tag not allowed in aligned environment'）。

## 5. 分段函数（cases）

```markdown
$$
f(x) =
\begin{cases}
x^2, & x \ge 0, \\
-x^2, & x < 0.
\end{cases}
$$
```

## 6. 矩阵（matrix）

```markdown
$$
A =
\begin{pmatrix}
a & b \\
c & d
\end{pmatrix},
\qquad
B =
\begin{bmatrix}
1 & 0 \\
0 & 1
\end{bmatrix}
$$
```

`pmatrix`（圆括号）、`bmatrix`（方括号）、`matrix`（无括号）、`vmatrix`（竖线）。

## 7. 常用命令速查

- 分式：`\frac{a}{b}`、`\dfrac{a}{b}`（**必须恰好两个非空参数**）
- 根式：`\sqrt{x}`、`\sqrt[n]{x}`（必须有一个参数）
- 求和：`\sum_{i=1}^{n} x_i`；积分：`\int_a^b f(x)\,dx`；极限：`\lim_{x \to 0} \frac{\sin x}{x}`
- 偏导：`\frac{\partial f}{\partial x}`；梯度/旋度：`\nabla f`、`\nabla \times \mathbf{B}`
- 向量：`\mathbf{v}`、`\boldsymbol{x}^{*}`（两者均需 KaTeX + MathJax 实测通过）
- 希腊字母：`\alpha \beta \gamma \delta \epsilon \varepsilon \theta \lambda \mu \nu \pi \rho \sigma \tau \phi \varphi \omega \Gamma \Delta \Omega`
- 罗马体：`\mathrm{d}x`、`\mathrm{e}`、`\mathrm{III}`（正体物理标签下标）
- 文本：`\text{when } x > 0`（**不放中文**）
- 关系：`\le \ge \ne \approx \equiv \propto \sim \ll \gg`
- 运算符：`\times \cdot \pm \mp \div \circ \ast`
- 集合：`\in \notin \subset \subseteq \cup \cap \emptyset \infty`
- 箭头：`\to \rightarrow \leftarrow \Rightarrow \Leftrightarrow`
- 括号：`\left( ... \right)`、`\left[ ... \right]`、`\left| ... \right|`、`\lvert x \rvert`、`\langle \rangle`
- 上下标：`x_i`、`x^2`、`x_{i,j}`、`e^{i\pi}`（多字符必须用 `{}`；一次只能一个上标或下标）
- 间隔：`\,` `\;` `\quad` `\qquad`

## 8. 严格 bracket 规则（C 层校验）

**禁止**（validator 逐条检出）：

| 禁止写法 | 正确写法 |
|---|---|
| `x_{}` `x^{}` `x^{*}_{}` | `x^{*}`（空组一律禁止） |
| `x_{{i}` `x^{{2}` | `x_{i}` `x^{2}`（双重花括号嵌套错误） |
| `x_{i}}` `\frac{x_{i}}{y}}` | 去掉多余 `}`（Extra close brace 类） |
| `x^{2}^{3}` `x_1_2` | `x^{2}` / `x_{1,2}`（连续上下标） |
| `\frac{x}` `\frac{}{}` | `\frac{x}{y}`（两个非空参数） |
| `\sqrt` 无参数 | `\sqrt{x}` |
| `\left[ ...` 无 `\right]` | `\left[ ... \right]`（成对） |
| `- \ `（孤立运算符+转义空格） | `-\exp(...)`（丢项残迹，KaTeX 语法可通过） |
| `x^{n}^{2}` | `x^{n^{2}}`（如需嵌套幂） |

花括号、圆括号、方括号必须平衡；`\text{...}` 内容与转义 `\{ \}` `\( \)` 不参与计数；半开区间 `[a,b)`、`(a,b]` 是合法记号，不误报；`\\[6pt]` 的 `[ ]` 是 `\\` 可选参数，不误报。

## 9. 公式原子化生成

复杂公式**一次性生成完整表达式**，禁止把变量/下标/上标/分母/单位切成字符串片段拼接：

正确（原子化）：

```
\frac{f_k - f_{\mathrm{III}}(t_k)}{W_{\mathrm{onset}}}
```

禁止（片段拼接，brace 错位高发）：

```
\frac{
f_k
-
f_
...
}
```

## 10. 转义（Escape）

- 货币：`\$10`；文本中的 `%`：`\%`。
- `_ ^ & # { }` 在数学模式外需转义；数学模式内按 LaTeX 语义。
- 反斜杠命令（`\alpha`、`\frac`、`\nabla`、`\partial`、`\mathbf`、`\boldsymbol`、`\begin`、`\end`）在 `.md` 源文件、JSON、JS/Python 字符串中传输时保持单个反斜杠；写盘后重新读取磁盘文件核对。

## 11. 代码与数学边界

- fence/inline code 中的 `$` 是字面量：`$HOME`、`` `$HOME` ``、Python 字符串 `"$10"`——校验器经 AST 隔离，不触碰。
- 需要渲染的公式禁止放入普通 code fence（```text/```markdown）；GitHub 例外只有 ```math``` fence。

## 12. Markdown Table 边界

- 表格 cell 只允许 `$...$` inline math：

  ```markdown
  | Quantity | Formula |
  |---|---|
  | Energy | $E=mc^2$ |
  ```

- cell 内禁止 `$$...$$`；复杂公式移到表格下方单独展示。

## 13. 公式编号（v3）

- **github 目标：编号 = Markdown 文本，禁止 `\tag`**：

  ```markdown
  **式 (3.1)**

  ```math
  v_A =
  \frac{B_0}{\sqrt{\mu_0\rho_0}}
  ```
  ```

- mpe/generic 目标：`\tag{}` 可用，但必须位于 `\end{...}` 之后；不假定 `\begin{equation}` 存在。

## 14. 非法/易错写法清单

| 错误写法 | 问题 | 正确写法 |
|---|---|---|
| `$ E = mc^2 $`（`$` 内留空格） | 部分渲染器无法识别 | `$E = mc^2$` |
| 单 `$` 独占行包 display | 非标准 | `$$E = mc^2$$` |
| `$E = mc^2`（未闭合） | 渲染为文本 | `$E = mc^2$` |
| `$$E = mc^2$`（`$$` 配单 `$`） | 未闭合 | `$$E = mc^2$$` |
| `\$10` 写错为 `$10` | 货币被误判 | `\$10` |
| `\frac{1}{2`（缺 `}`） | Extra close brace 类 | `\frac{1}{2}` |
| `\begin{aligned}...` 缺 `\end{aligned}` | 未闭合环境 | 补 `\end{aligned}` |
| `\tag` 在 aligned 内部 | KaTeX/GitHub 报错 | 移到 `\end{aligned}` 后 |
| table cell 内 `$$x$$` | 不渲染 | 移出表格 |
| 列表项/引用块内 `$$x$$` | GitHub 错乱 | 移出到正文 |
| 公式放入 ```text/```markdown | 只显示源码 | `$$...$$` 或 ```math``` |
