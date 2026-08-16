# GitHub Math Smoke

Inline:

Einstein relation: $E=mc^2$.

**式 (1)**

```math
E=mc^2
```

**式 (2)**

```math
v_{\mathrm{A}0}
=
\frac{B_0}
{\sqrt{\mu_0\rho_0}}.
```

**式 (3)**

```math
R(\tau)
=
\left|
\frac{\mathrm d\Delta\psi_{OX}}
{\mathrm d\tau}
\right|.
```

**式 (4)**

```math
f_{\mathrm{III}}(t)
=
f_0
\exp\left(
-\frac{\beta ct}
{2H\times10^6}
\right).
```

## 中文 + inline math

电子等离子体频率为 $f_{\mathrm{pe}}$，德拜长度为 $\lambda_D$。

## Table + inline math

| Quantity | Symbol | Formula |
|---|---|---|
| Energy | $E$ | $E=mc^2$ |
| Plasma frequency | $f_{pe}$ | $\omega_{pe}/2\pi$ |

## Python code

```python
price = "$10"
print(price)
print(os.environ.get("HOME"))
```

## bash $HOME

```bash
echo $HOME
```

## 货币

转义后的美元金额 \$10 不应被当作数学分隔符。

## Matrix

**式 (5)**

```math
A =
\begin{pmatrix}
a & b \\
c & d
\end{pmatrix}
```

## Integral

**式 (6)**

```math
\int_{-\infty}^{+\infty}
e^{-x^2}\,dx
=
\sqrt{\pi}
```

## Derivative

**式 (7)**

```math
\frac{\partial f}{\partial x}
=
\lim_{h \to 0}
\frac{f(x+h)-f(x)}{h}
```

## Subscript / superscript

**式 (8)**

```math
x_{i,j}^{2} + y^{n+1} = z_{k}^{m-1}
```
