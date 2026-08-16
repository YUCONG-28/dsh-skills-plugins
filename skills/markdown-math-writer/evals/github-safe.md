# GitHub-safe 方言测试（target = github）

本文件只使用 GitHub-safe 方言：inline `$...$` + block ```math fence + Markdown 文本编号。
**0 个 `\tag`、0 个 `$$` block、0 个 aligned、0 个 equation 环境。**

## 1. 基础

Einstein 关系为 $E=mc^2$。

**式 (1)**

```math
E=mc^2
```

## 2. 分式

**式 (2)**

```math
v_{\mathrm{A}0}
=
\frac{B_0}{\sqrt{\mu_0\rho_0}}.
```

## 3. 归一化（用 `\mathbf` 而非 `\boldsymbol`）

**式 (3)**

```math
\mathbf{x}^{*}
=
\frac{\mathbf{x}}{L_0},
\qquad
\mathbf{v}^{*}
=
\frac{\mathbf{v}}{v_{\mathrm{A}0}}.
```

## 4. 中文 + inline math

电子等离子体频率为 $f_{\mathrm{pe}}$，德拜长度为 $\lambda_D$。

## 5. 表格 + inline math

| Quantity | Symbol | Formula |
|---|---|---|
| Energy | $E$ | $E=mc^2$ |
| Plasma frequency | $f_{pe}$ | $\omega_{pe}/2\pi$ |

## 6. Python 代码块（原样保留）

```python
price = "$10"
print(price)
print(os.environ.get("HOME"))
```

## 7. Shell 变量与货币

路径变量 $HOME 指向用户主目录。

inline code 写法：`$HOME`。

货币 \$10 是转义后的美元金额。

## 8. 矩阵（单独一个 math fence）

**式 (4)**

```math
A =
\begin{pmatrix}
a & b \\
c & d
\end{pmatrix}
```

## 9. 积分与导数

**式 (5)**

```math
\int_{-\infty}^{+\infty} e^{-x^2}\,dx
=
\sqrt{\pi}
```

**式 (6)**

```math
\frac{\mathrm d f_{\mathrm{III}}}{\mathrm d t}
=
-\frac{\beta c}{2H \times 10^6}
f_{\mathrm{III}}(t)
```

## 10. 上下标

**式 (7)**

```math
x_{i,j}^{2} + y^{n+1} = z_{k}^{m-1}
```

## 11. 推导拆分（一个逻辑等式一个块）

由磁场定义，

**式 (8)**

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

## 12. 禁止事项自检（以下写法本文件刻意避免）

- 无 `` \tag{...} ``（公式编号在 Markdown 正文）
- 无 `$$...$$` 独立公式
- 无 `\begin{aligned}` / `\begin{equation}` 环境
- 无 `\boldsymbol`（一律用 `\mathbf`）
- 无空 `_{}` / `^{}`
- 公式不放入普通 code fence
