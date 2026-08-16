# Output Template — 00~12 输出文件规格、per_source、中英文规范

所有输出写入被分析目录下的 `_study_review/`。每个文件以标题 + 元信息开头：

```markdown
# <文件名标题>
> 生成时间: <ISO 时间> | 模式: full/exam/quick/lecture/concept | 材料目录: <相对路径>
> 覆盖: 扫描 N 个文件，处理 M 个，跳过 K 个（原因见 00），失败 F 个
```

---

## 00_material_map.md — 材料地图

记录：扫描文件数 / 处理文件数 / 跳过文件数 / 失败文件数（**Coverage Check 依据**）。

```markdown
# Material Map
## 统计
- 扫描: N | 处理: M | 跳过: K（原因见下）| 失败: F

## 材料清单（按 Lecture 分组）
| 文件 | 类型 | 大小 | 角色 | 内容类型 | 需视觉分析 | 处理决定 |

## Primary Sources
## Practice Sources
## Supporting Sources
## Duplicates（版本组与合并决定）
## 忽略/失败及原因
| 文件 | 原因 | 建议 |
```

## 01_overview.md — 知识结构总览

整门课的知识树（不含细节）：

```text
Data Analytics
├── NumPy
├── Pandas
│   ├── DataFrame
│   ├── Indexing
│   └── Missing Values
├── Statistics
│   ├── Mean
│   ├── Variance
│   └── Correlation
└── Visualization
    ├── Histogram
    └── Scatter Plot
```

每个节点标注主要来源（`[L01]` 等缩写，图例列在文件头）。

## 02_master_notes.md — 完整笔记

- **按知识结构组织**（Course→Chapter→Topic→Concept），不是文件结构。
- 每个知识点按 knowledge-synthesis.md 的字段（What/Why/How/When + 可选字段）展开，带来源引用。
- 长度与材料规模相称；这是复习的主文档。

## 03_key_concepts.md — 关键概念

只保留：**关键定义 / 核心原理 / 核心区别**。每条 1–5 行 + 来源。示例：

```text
- **DataFrame**：Pandas 的二维表格结构，行+列索引（labels）[L01 — Slide 4]
- **loc vs iloc**：loc 按标签、iloc 按位置 [L03 — Slide 9]
```

## 04_formula_sheet.md — 公式表

每公式一个条目（markdown 表格或分节），列：

```text
Formula | Variables | Meaning | Conditions | Units | Interpretation | Source
```

- 公式去重：同一公式多来源只留一个主条目，Source 列列出全部来源。
- 模糊公式带 `[Formula needs verification]`。
- 附带：公式编号（F1、F2…），09_quick_review 与 12_mock_exam 可引用编号。

## 05_code_cheatsheet.md — 代码速查

按 **Task → Code → Explanation** 组织：

```markdown
## 检查缺失值
```python
df.isnull().sum()
```
Returns the number of missing values in each column.（每列缺失值计数）
来源: exercise.ipynb — Code Cell 2
```

- 只收录核心 API / 必须掌握的语句 / 典型例子 / 易错代码。
- 保持课程原语义；疑似课程代码错误 → `Potential issue in source`。

## 06_common_mistakes.md — 易错点

统一 **Wrong → Why → Correct** 格式（见 knowledge-synthesis.md §7.1），每条带来源。

## 07_concept_links.md — 概念链接

按章节分组的依赖链（ASCII 或 mermaid），如：

```text
Data → Cleaning → Transformation → Analysis → Visualization
Mean → Variance → Standard Deviation → Standardization
```

## 08_source_index.md — 双向索引

```markdown
## Concept → Source
| 概念 | 来源 |
## Source → Concept
| 来源 | 概念（页码/Slide/Cell） |
```

用于"这个知识点出自哪里"与"这个文件讲了什么"双向查询。

## 09_quick_review.md — 快速复习

目标：**10–20 分钟浏览**。只包括：

- 核心定义（10–20 条）
- 核心公式（04 的主公式，带编号）
- 核心代码（05 的最重要条目）
- 关键区别（如 loc/iloc）
- 易错点（Top 5–10）
- 每节标注对应详细文件链接（02/03/04/05）

**必须真的简洁**——一页纸能扫完的结构，不允许变成第二个 master notes。

## 10_exam_focus.md — 考试重点（仅 Exam 模式）

```markdown
# Exam Focus
## ⭐⭐⭐ Must Know
- 概念/公式/代码 …（证据: 来源列表）
## ⭐⭐ Important
## ⭐ Supporting
```

见 exam-analysis.md 的证据标准；每条 ⭐⭐⭐ 必须有证据列表。

## 11_possible_questions.md — 潜在考题（仅 Exam 模式）

见 exam-analysis.md §3：题型分类、数量（10–20 / 20–50）、每题带「依据」。

## 12_mock_exam.md — 模拟题（仅 Exam 模式）

见 exam-analysis.md §4：按课程内容定题型比例，后半部分 Answer Key（答案带材料来源）。

---

## per_source/ — 来源级总结

- 命名：`<lecture/chapter>_<文件基名>.md`，如 `lecture01_slides.md`、`lecture03_exercise01.md`、`week02_notes.md`。
- 每个文件一节：该文件讲了什么、关键知识点（带页/Slide/Cell 引用）、练习答案要点、该文件的独特贡献。
- 用途：**Master Notes 按知识结构复习；per_source 按原始课程顺序查找**。
- 版本组文件只生成一份（00 中说明）。

## .cache/ — 中间缓存（非最终笔记）

- `.cache/extracted/`（脚本提取原文）、`.cache/summaries/`（per-file 小结）、`.cache/slides_summaries/`、`.cache/synthesis/`（概念分桶）、`.cache/manifest.json`（增量更新）、`.cache/media_map.json`。
- 交付时说明缓存保留是为了增量更新；用户不需要时可删除。

---

## 中英文规范

- 默认：**中文解释 + 英文专业术语**（首次出现给括号英文）：标准差（Standard Deviation）、相关系数（Correlation Coefficient）、DataFrame、loc/iloc 等。
- 公式保持标准数学表达（LaTeX 或 Unicode 均可，全文统一）；代码保持原语言。
- 课程材料主要为英文 → 仍默认中文解释 + 英文术语；用户要求英文 → 全英文；要求中英双语 → 关键概念双语并列。
- 文件标题、目录结构命名固定为英文（00_material_map.md 等），内容语言随规范。
