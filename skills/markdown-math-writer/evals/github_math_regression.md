# GitHub Math Regression Test

用于回归验证 markdown-math-writer 的 GitHub 兼容性（`$$...$$` + `$...$` + ```math fence）。

## 1. Inline

质能关系为 $E=mc^2$。

## 2. Fraction

$$
v_A =
\frac{B_0}{\sqrt{\mu_0\rho_0}}
$$

## 3. Normalization (boldsymbol)

$$
\boldsymbol{x}^{*}
=
\frac{\boldsymbol{x}}{L_0}
$$

## 4. Time normalization

$$
\tau
=
\frac{t}{t_{A0}}
$$

## 5. Velocity normalization

$$
\boldsymbol{v}^{*}
=
\frac{\boldsymbol{v}}{v_{A0}}
$$

## 6. Magnetic field normalization

$$
\boldsymbol{B}^{*}
=
\frac{\boldsymbol{B}}{B_0}
$$

## 7. Maxwell aligned

$$
\begin{aligned}
\nabla \cdot \mathbf{E}
&=
\frac{\rho}{\varepsilon_0}, \\
\nabla \cdot \mathbf{B}
&=
0.
\end{aligned}
$$

## 8. Complex condition

$$
\left| f_k - f_{\mathrm{III}}(t_k) \right|
\le
W_{\mathrm{onset}}
$$

## 9. Matrix

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

## 10. Integral

$$
\int_{-\infty}^{+\infty} e^{-x^2}\,dx
=
\sqrt{\pi}
$$

## 11. Multiple subscripts/superscripts

$$
x_{i,j}^{2} + y^{n+1} = z_{k}^{m-1}, \qquad
f_{\mathrm{III}}(t_k) = f_0 \exp\left(-\frac{\beta c t_k}{2H \times 10^6}\right)
$$

## 12. 中文正文 + inline math

电子等离子体频率为 $f_{pe}$，德拜长度为 $\lambda_D$，Alfvén 速度为 $v_A = B_0/\sqrt{\mu_0\rho_0}$。

## 13. Markdown table + inline math

| Quantity | Symbol | Formula |
|---|---|---|
| Energy | $E$ | $E=mc^2$ |
| Plasma frequency | $f_{pe}$ | $\omega_{pe}/2\pi$ |

## 14. Python code block

```python
price = "$10"
print(price)
print(os.environ.get("HOME"))
```

## 15. Shell 变量

路径变量 $HOME 指向用户主目录。

inline code 写法：`$HOME`；转义写法：\$HOME。

## 16. 货币

转义后的美元金额 \$10 不应被当作数学分隔符；未转义的裸美元金额会被校验器要求使用转义写法（如 \$10）。

## GitHub math fence fallback（仅 GitHub 目标）

当双美元分隔符（\$\$）形式与 Markdown 块解析冲突时，允许 GitHub 专用 fallback：

```math
\omega_{pe} = \sqrt{\frac{n_e e^2}{\varepsilon_0 m_e}}
```
