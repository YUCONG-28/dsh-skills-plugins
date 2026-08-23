# PPT Analysis — 逐 Slide 提取、图片型 Slide 视觉分析、覆盖检查

本文件是 PPT/PPTX 处理（工作流第 3–4 步 Extract / Analyze 的 PPT 部分）的详细规则。PPT 是学习材料中最常见的主材料，**不能只提取文字**。

## 1. 提取（Extract）内容清单

对每个 `.pptx` 用 `scripts/extract_ooxml.py` 提取，逐 Slide 至少识别：

- Slide title（标题）
- 正文与 Bullet points（项目符号层级）
- 公式（OMML 数学对象 → 文本近似；符号可能失真，见 §6）
- 表格（转为 markdown 表格，保留表头）
- 图片（记录 `[图片: 路径]` 与所属 Slide 映射）
- 图注 / caption
- 流程图、架构图、示意图（通常为图片或矢量组合 → 视觉分析）
- 代码块（保留原样）
- 坐标轴、曲线、箭头关系（图表 → 视觉分析或原生图表标记）
- Speaker Notes（老师口头强调点，重要内容来源，绝不能漏）
- 章节关系（Section/Part 分隔页、目录页、总结页）

`.pdf` 版幻灯片用 `scripts/extract_pdf.py`（`--render-dpi 150` 同时渲染页面供视觉分析）。

## 2. Slide-Level Analysis（中间产物，不是最终笔记）

内部可建立每页分析，格式建议：

```text
Slide 3 — 条件概率与贝叶斯定理
  类型: 概念 + 公式
  要点: P(A|B) 定义；与 P(A∩B) 的关系
  公式: P(A|B) = P(A∩B)/P(B)  [公式: OMML 近似，需核对]
  图表: 文氏图（视觉）
  Notes: 老师强调"先验/后验"术语
```

**最终学习笔记不得变成 Slide 1 Summary / Slide 2 Summary… 的堆叠**——必须在 knowledge-synthesis.md 的步骤中重构为知识结构。

## 3. 图片型 Slide（图像为主页面）

### 3.1 判定

该 Slide **文字很少（约 <100 字符）但包含大量图/示意图/流程图/科学图像/统计图/架构图**时，判定为图片型 Slide。

**禁止**结论："本页无重要内容"。

### 3.2 视觉分析流程

1. **获取图像**（按优先级）：
   a. 本机有 LibreOffice：`soffice --headless --convert-to pdf deck.pptx` → `scripts/extract_pdf.py --render-dpi 150` 渲染整页；
   b. 否则用 `scripts/extract_ooxml.py --media <dir>` 抽取嵌入媒体（`media_map.json` 给出 media→Slide 映射），对应该页的图片用 `read_image` 查看；
   c. 若该页图形是矢量形状组合（非嵌入图片），无法抽取 → 标记 `[Visual requires manual review]`。
2. **用 `read_image` 工具分析每张图**（DeepSeek 主模型内置多模态直接分析；输出含描述/OCR/版面/不确定性）。提取目标：
   - 图中变量与单位
   - 横轴/纵轴含义、刻度
   - 趋势（上升/下降/峰值/平台期）、比较关系（组间差异）
   - 箭头与流程方向、组成部分、层级关系
   - 因果关系、物理/统计意义
   - 老师可能想表达的核心结论（结合页面标题与上下文推断，并标注为推断）
3. **无法可靠判读**（图像过小/模糊/复杂）→ 写 `[Visual requires manual review]`，并说明需要人工确认什么。**不得编造图中内容。**
4. 视觉分析结果记录为该 Slide 的「视觉分析」小节，随来源进入知识融合。

### 3.3 表格型/图表型 Slide

- 表格：直接用提取的 markdown 表格，不重新视觉分析（除非单元格为图片）。
- 原生图表对象：标注 `[图表: 原生图表对象]`；数值上可能只有图表 XML 的缓存数据（extract_ooxml.py 的文本层没有时，可解压 `ppt/charts/chartN.xml` 读取 `<c:numCache>` 数值——必要时做，不要过度）。

## 4. PPT 专项覆盖检查（Validate 阶段必做）

- 是否只分析了前几页？（封面、目录、正文、总结、附录都可能承载知识）
- 是否遗漏图片型 Slide？（见 §3）
- 是否遗漏表格？（含隐藏页上的表格）
- 是否遗漏 Speaker Notes？（每个 slide 的 notes 都要看）
- 是否遗漏 Appendix / References / 隐藏页？（extract_ooxml.py 会标记隐藏页与页数统计）
- 是否遗漏总结页（Summary / Key Takeaways）？——总结页是 Exam 优先级的重要证据。

## 5. 大 PPT 的处理方法

- 页数 >80 或单文件文本 >1.5 万 token：提取到 `.cache/` 后**分批读取**（每批 10–20 页），逐批写 `.cache/slides_summaries/<file>.md`，再合并小结（Map-Reduce）。禁止一次性读完全部页面。
- 对超长 Notes 同样分批摘要，保留关键引用（Slide 号）。

## 6. 公式处理

- OMML 数学对象提取的是文本近似：`z=(x-μ)/σ` 这类可直读；但上下标、分数、根号可能失真。
- 公式必须**对照渲染图/原文核对符号、上下标、分母、指数**（图片型页面用视觉分析核对）。
- 无法确认 → `[Formula needs verification]`，保留近似表达式与所在 Slide 引用，**不得猜测补全**。
