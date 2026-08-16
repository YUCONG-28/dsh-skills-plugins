# Generic 方言测试（target = generic）

本文件使用通用方言：inline `$...$` + block `$$...$$`（与 MPE 相同，但作为无特定目标时的默认）。

## 1. 基础

Einstein 关系为 $E=mc^2$。

$$
E_k = \frac{1}{2}mv^2
$$

## 2. 多行公式（generic 允许 aligned）

$$
\begin{aligned}
F_x &= ma_x, \\
F_y &= ma_y.
\end{aligned}
$$

## 3. 中文 + inline math

电子等离子体频率为 $f_{\mathrm{pe}}$。

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

## 7. 矩阵、积分、上下标

$$
A =
\begin{pmatrix}
a & b \\
c & d
\end{pmatrix},
\qquad
\int_0^1 x^2\,dx = \frac{1}{3},
\qquad
x_{i,j}^{2}
$$
