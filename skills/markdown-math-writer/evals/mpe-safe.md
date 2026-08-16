# MPE 方言测试（target = mpe）

本文件使用 Markdown Preview Enhanced 方言：inline `$...$` + block `$$...$$` + `\tag`（位于环境外）。

## 1. 基础

Einstein 关系为 $E=mc^2$。

$$
E_k = \frac{1}{2}mv^2
\tag{1}
$$

## 2. aligned 多行（MPE/KaTeX 支持）

$$
\begin{aligned}
\nabla \cdot \mathbf{E}
&=
\frac{\rho}{\varepsilon_0}, \\
\nabla \cdot \mathbf{B}
&=
0.
\end{aligned}
\tag{2}
$$

## 3. 中文 + inline math

电子等离子体频率为 $f_{\mathrm{pe}}$，德拜长度为 $\lambda_D$。

## 4. 表格 + inline math

| Quantity | Formula |
|---|---|
| Energy | $E=mc^2$ |
| Plasma frequency | $f_{pe}$ |

## 5. Python 代码块

```python
price = "$10"
print(os.environ.get("HOME"))
```

## 6. 货币与 shell 变量

货币 \$10；路径变量 $HOME 指向用户主目录。

## 7. 矩阵与积分

$$
A =
\begin{pmatrix}
a & b \\
c & d
\end{pmatrix}
$$

$$
\int_{-\infty}^{+\infty} e^{-x^2}\,dx = \sqrt{\pi}
$$
