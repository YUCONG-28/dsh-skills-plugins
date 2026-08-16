# Knowledge Synthesis — 知识重构、跨文件融合、去重、公式/代码/图表、概念链接

本文件是工作流第 5–7 步（Synthesize / Deduplicate / Reconstruct）的详细规则，是本 Skill 的核心方法论。

## 1. 知识重构（Knowledge Reconstruction）

Slide-Level / 章节级分析只是中间结果。最终笔记必须按知识结构组织：

```text
Course
 └── Chapter
      └── Topic
           └── Concept
                ├── Definition
                ├── Principle
                ├── Formula
                ├── Example
                └── Application
```

而不是：

```text
文件1 → 文件2 → 文件3   ❌
```

- 章节划分优先采用材料自带的 Lecture/Chapter 结构（目录页、分节页），再按概念语义细分为 Topic。
- 同一概念出现在多个 Lecture 中时，归入其首次/最完整出现的章节，其他位置用链接（见 §8 Concept Links）。

## 2. 核心知识点的字段

对每个核心知识点尝试回答 **What? Why? How? When?**，并按需提取：

```text
Definition      定义
Purpose         目的
Mechanism       机制/原理
Formula         公式
Variables       变量及其含义
Assumptions     假设
Conditions      适用条件
Interpretation  解释（如何理解结果）
Example         例子
Application     应用
Difference      与相近概念的区别
Limitation      局限
Pitfall         易错点
```

**不要强迫每个知识点都有全部字段**——只保留有实际意义的内容；没有依据的字段不写。

## 3. 跨文件知识融合（Cross-File Fusion）——最重要的能力

### 3.1 案例

材料：`Lecture01.pptx`（Correlation 概念）、`Lecture03.pdf`（Pearson correlation）、`exercise.ipynb`（`df.corr()`）、`exercise_solution.py`（相关例子）。

**不要写四遍。** 合并为：

```text
Correlation（相关）
├── Definition          定义…… [Lecture01.pptx — Slide 5]
├── Pearson correlation  公式与解释…… [Lecture03.pdf — Page 23]
├── Interpretation      取值范围、含义…… [Lecture03.pdf — Page 24]
├── Pandas implementation  df.corr()…… [exercise.ipynb — Code Cell 7]
├── Example              …… [exercise_solution.py — correlation section]
└── Common mistakes      …… [exercise.ipynb — Code Cell 9]
```

规则：

- **同一概念的所有来源合并为一个条目**，每个来源保留引用。
- 不同来源提供**不同角度**时（如定义 vs 实现 vs 易错点）→ 合并为更完整的解释，不删除。
- 来源**冲突**（同一概念两种说法不一致）→ 并陈两方，分别标注来源，标注「待确认」或说明差异，不得私自二选一。

### 3.2 融合判定

提取时先按概念分组（cross-file concept buckets），再对每个 bucket 写合成条目。概念分桶在 `.cache/synthesis/` 完成。

## 4. 去重 Pass（Deduplication）

识别并合并：

- 重复定义（多份材料讲同一个定义）
- 重复公式（同一定义式在不同 Lecture/Exercise/Notebook 出现）
- 重复示例 / 重复代码
- 不同 PPT 中的相同概念

合并规则：

1. 内容实质相同 → 保留**一个主条目**，注明全部来源（`Sources:` 列表）。
2. 内容不同角度 → 不删，合并为更完整条目。
3. 内容冲突 → 并陈 + 标注（见 §3.1）。
4. 去重后检查是否还能回答「每个来源的独特贡献是什么」；无法回答时说明该来源无新增内容（在 per_source 中保留一行说明即可）。

## 5. Source Traceability（来源追溯）

| 来源类型 | 引用格式 |
|---|---|
| PPT/PPTX | `Lecture03.pptx — Slide 18` |
| PDF | `Statistics.pdf — Page 23` |
| Notebook | `exercise.ipynb — Code Cell 7` |
| Python/代码 | `analysis.py — correlation section` |
| Markdown | `notes.md — Data Cleaning` |
| 图片/图注 | `Lecture01.pptx — Slide 5 图`（或 `media/fig2.png`） |
| Speaker Notes | `Lecture02.pptx — Slide 10 Notes` |

重要知识点（定义、公式、易错点、考点）必须带来源；一般背景可省略。

## 6. 公式抽取（Formula Extraction）

每个重要公式不只是写表达式，还要（如果材料中存在/可推断并标注）：

```text
公式:  z = (x − μ) / σ
变量:  x = 观测值, μ = 总体均值, σ = 总体标准差
用途:  标准化，使不同量纲数据可比
何时用: 需要跨分布比较/进入正态分布表时
解释:  z 表示 x 距均值多少个标准差
条件:  要求 μ、σ 已知（总体参数）
单位:  z 无量纲
来源:  Lecture03.pptx — Slide 18
```

- 公式去重：同一公式出现于 Lecture + Exercise + Notebook → Formula Sheet 只留一个主条目，注明多个来源。
- 公式核对：符号、上下标、分母、指数必须对照原页；无法确认 → `[Formula needs verification]`。

## 7. 代码分析（Code Analysis）

对 Python/NumPy/Pandas/Matplotlib/SciPy/MATLAB/R/SQL 等代码材料：

- **不机械复制全部代码**。识别：
  - 核心 API 与核心 pattern（如 `df.groupby().agg()` 组合）
  - 必须掌握的语句（高频出现、考试可能要求手写）
  - 典型例子（老师给的示例）
  - 容易出错的代码（→ 06_common_mistakes.md）
- 代码保持**原始语义**，不要"优化"成与课程不同的写法；发现课程代码疑似有错时标记 `Potential issue in source` 并解释，不改写原语义。

### 7.1 Wrong vs Correct

练习/材料中的常见错误整理为统一格式：

```text
Wrong:
    df[i]
Why:
    df[i] 在列索引与位置索引语义上不明确——按列名取列时可行，但按行位置取行会与标签索引混淆
Correct:
    df.iloc[i]   （按位置取行）
    df.loc[label]（按标签取行）
```

**必须解释语义为什么不同**，而不是只给正确代码。

## 8. 图表与数据分析（Charts & Data Analysis）

课程中出现 scatter plot / histogram / line plot / bar chart / box plot / heatmap 等时，提取：

```text
图表用途（该图回答什么问题）
横轴 / 纵轴（变量与单位）
变量关系
主要趋势（+ 关键数值点）
如何解释
什么时候使用这种图
```

## 9. Concept Links（概念链接/知识依赖）

识别知识之间的依赖关系，形成知识图谱式结构：

```text
Mean（均值）
  ↓
Variance（方差）
  ↓
Standard Deviation（标准差）
  ↓
Standardization（标准化）
```

或：

```text
DataFrame
  ↓
Indexing
  ↓
Filtering
  ↓
Cleaning
  ↓
Analysis
```

- 输出到 `07_concept_links.md`：用 ASCII 依赖链或 mermaid 图，按章节分组。
- 链接必须是材料支持的（概念 A 的定义/实现依赖概念 B），不要凭空造依赖。

## 10. 幻觉控制（Hallucination Control）

- 明确区分 **Source Content**（材料中的内容）与 **Supplementary explanation**（为帮助理解加入的材料外知识）。
- 材料外补充必须标记：
  ```text
  （补充理解：…）
  ```
  或 `Supplementary explanation: …`，**不能让用户误以为老师 PPT 里说过**。
- 无法确认的信息 → 「待确认」；公式模糊 → `[Formula needs verification]`；图片无法解释 → `[Visual requires manual review]`。
