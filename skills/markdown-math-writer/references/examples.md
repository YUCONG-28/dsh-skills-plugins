# examples.md — 各学科 Markdown 公式示例（v2）

本文件提供可直接复用的公式写法范例，覆盖常见学科。所有示例均通过 `scripts/validate_math.mjs` 的 KaTeX + MathJax 双重校验。

> **REFERENCE EXAMPLE = OUTPUT FORMAT**：本文件的公式就是最终输出格式，可直接复制到用户文档。
> 本文件不使用教学性 fenced code block 包裹公式；SKILL.md/references 中若有教学 fence，仅用于展示源码，创建用户 Markdown 时禁止复制。

## 1. 数学（基础）

质能关系（行内）：Einstein's relation is $E=mc^2$。

动能（display）：

$$
E_k = \frac{1}{2}mv^2
$$

高斯积分：

$$
\int_{-\infty}^{+\infty} e^{-x^2}\,dx = \sqrt{\pi}
$$

分段函数：

$$
f(x) =
\begin{cases}
1, & x > 0, \\
0, & x = 0, \\
-1, & x < 0.
\end{cases}
$$

矩阵：

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

泰勒展开：

$$
f(x) = \sum_{n=0}^{\infty} \frac{f^{(n)}(a)}{n!}(x-a)^n
$$

## 2. 经典力学

牛顿第二定律：

$$
\mathbf{F} = m\mathbf{a}
$$

拉格朗日方程：

$$
\frac{d}{dt}\left(\frac{\partial L}{\partial \dot{q}_i}\right) - \frac{\partial L}{\partial q_i} = 0
$$

简谐运动：

$$
x(t) = A\cos(\omega t + \varphi)
$$

其中 $A$ 为振幅，$\omega$ 为角频率，$\varphi$ 为初相。

## 3. 电磁学

Maxwell 方程组（aligned 多行）：

$$
\begin{aligned}
\nabla \cdot \mathbf{E} &= \frac{\rho}{\varepsilon_0}, \\
\nabla \cdot \mathbf{B} &= 0, \\
\nabla \times \mathbf{E} &= -\frac{\partial \mathbf{B}}{\partial t}, \\
\nabla \times \mathbf{B} &= \mu_0 \mathbf{J} + \mu_0 \varepsilon_0 \frac{\partial \mathbf{E}}{\partial t}.
\end{aligned}
$$

其中 $\mathbf{E}$ 为电场，$\mathbf{B}$ 为磁场，$\rho$ 为电荷密度，$\mathbf{J}$ 为电流密度。

安培-麦克斯韦旋度方程：

$$
\nabla \times \mathbf{B}
=
\mu_0\mathbf{J}
+
\mu_0\varepsilon_0
\frac{\partial\mathbf{E}}{\partial t}.
$$

## 4. 量子力学

薛定谔方程：

$$
i\hbar \frac{\partial}{\partial t}\Psi(\mathbf{r}, t) = \hat{H}\Psi(\mathbf{r}, t)
$$

一维无限深势阱能级：

$$
E_n = \frac{n^2\pi^2\hbar^2}{2mL^2}, \qquad n = 1, 2, 3, \dots
$$

对易关系：

$$
[\hat{x}, \hat{p}] = i\hbar
$$

## 5. 等离子体物理

电子等离子体频率为 $f_{pe}$：

$$
\omega_{pe} = \sqrt{\frac{n_e e^2}{\varepsilon_0 m_e}}
$$

德拜长度：

$$
\lambda_D = \sqrt{\frac{\varepsilon_0 k_B T_e}{n_e e^2}}
$$

## 6. 数据分析 / 统计

均值与方差：

$$
\bar{x} = \frac{1}{n}\sum_{i=1}^{n} x_i,
\qquad
s^2 = \frac{1}{n-1}\sum_{i=1}^{n}(x_i - \bar{x})^2
$$

正态分布密度：

$$
f(x) = \frac{1}{\sigma\sqrt{2\pi}}\exp\left(-\frac{(x-\mu)^2}{2\sigma^2}\right)
$$

线性回归：

$$
\hat{y} = \beta_0 + \beta_1 x
$$

## 7. 代码与数学共存的正确写法

```python
# 代码块中的 $ 是字面量，不会被当作数学
price = "$10"
print(price, os.environ.get("HOME"))
```

inline code 写法：`` `$HOME` ``。

文本中的 shell 变量 $HOME 单独出现时不是数学。

货币 \$10 是转义后的美元金额。

## 8. 表格与公式

| Quantity | Symbol | Formula |
|---|---|---|
| Energy | $E$ | $E=mc^2$ |
| Plasma frequency | $f_{pe}$ | $\omega_{pe}/2\pi$ |
| Debye length | $\lambda_D$ | $\sqrt{\varepsilon_0 k_B T_e / (n_e e^2)}$ |

复杂公式放在表格下方单独展示：

$$
\omega_{pe} = \sqrt{\frac{n_e e^2}{\varepsilon_0 m_e}}
$$

## 9. GitHub-safe 示例（target = github，v3 默认）

以下为 GitHub README 推荐写法：block math 一律 math fence，编号为 Markdown 文本，无 `\tag`，无 aligned，向量用 `\mathbf`。

归一化：

**式 (3.3)**

```math
\mathbf{x}^{*}
=
\frac{\mathbf{x}}{L_0},
\qquad
\mathbf{v}^{*}
=
\frac{\mathbf{v}}{v_{A0}},
\qquad
\mathbf{B}^{*}
=
\frac{\mathbf{B}}{B_0}.
```

Spike topping 判据：

**式 (2.1)**

```math
\frac{f_k - f_{\mathrm{III}}(t_k)}{W_{\mathrm{onset}}},
\qquad
\left| f_k - f_{\mathrm{III}}(t_k) \right| \le W_{\mathrm{onset}}
```

长推导拆分（一个逻辑等式一个块）：

**式 (8.17)**

```math
f_{\mathrm{III}}(h)
=
8980\sqrt{
n_0\exp\left(-\frac{h}{H}\right)
}.
```

化简：

```math
f_{\mathrm{III}}(h)
=
8980\sqrt{n_0}
\exp\left(-\frac{h}{2H}\right).
```

## 10. MPE 目标示例（target = mpe）

MPE/笔记场景保留 `$$...$$` + aligned + `\tag`（`\end` 之后）：

```markdown
$$
\begin{aligned}
\nabla \cdot \mathbf{E}
&=
\frac{\rho}{\varepsilon_0}, \\
\nabla \cdot \mathbf{B}
&=
0.
\end{aligned}
\tag{7.1}
$$
```
