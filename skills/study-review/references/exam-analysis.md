# Exam Analysis — Exam 模式：优先级估计、潜在考题、模拟题

本文件是 Exam 模式（10_exam_focus / 11_possible_questions / 12_mock_exam）的详细规则。

## 1. 定位

用户说「我要考试 / exam mode / 复习考试 / 考点 / 考试重点」时切换 Exam 模式：在 full 输出（00–09 + per_source）之外增加 10、11、12 三个文件。即使材料没有明确考试信息，也按课程材料的**内容强调**推断，但必须标注推断依据。

## 2. 优先级估计（Exam Focus：⭐⭐⭐ / ⭐⭐ / ⭐）

### 2.1 证据标准（Evidence-based，禁止仅凭模型领域知识）

根据以下课程材料证据打分：

| 证据 | 说明 |
|---|---|
| 多次重复出现 | 同一概念出现在 ≥2 个独立材料中（如 Lecture + Exercise） |
| Lecture title 强调 | 出现在标题/副标题/章节名中 |
| Summary slide 出现 | 出现在总结页/Key Takeaways |
| 公式单独介绍 | 有专门 slide/page 单独讲该公式 |
| Exercise 出现 | 练习/作业中出现 |
| Homework 出现 | 作业题中出现 |
| Notebook 实际实现 | Notebook 中有真实实现/运行结果 |
| 不同材料重复出现 | 讲义 + 练习 + Notebook 三处以上 |
| 老师提供具体案例 | 材料中有老师展开讲解的案例 |

### 2.2 定级

```text
⭐⭐⭐ Must Know   — 满足 ≥3 条强证据，或材料显式写"必须掌握/重点"
⭐⭐ Important    — 满足 2 条证据
⭐  Supporting   — 支撑性内容（背景、扩展、附录）
```

- 每条 ⭐⭐⭐ 条目后列出**证据列表**（哪几个来源、什么表现）。
- 材料无证据但确属该学科基础概念时，可以给出 ⭐ 并注明「基于学科常识（补充理解）」。

### 2.3 措辞规范

- 使用：`Likely based on course emphasis` / `根据课程材料推测` / `证据: Lecture03.pptx — Slide 18 + exercise.ipynb — Code Cell 5`。
- **禁止**写"老师一定会考"「必考题」之类绝对化断言，除非原始材料明确说明。

## 3. 潜在考题（11_possible_questions.md）

### 3.1 题型分类

```text
Definition       定义题（What is X?）
Explanation      解释题（Why / How does it work?）
Calculation      计算题（给定数值计算）
Coding           编码题（实现/写出代码）
Comparison       对比题（A 与 B 的区别）
Interpretation   解读题（解释结果/图表含义）
Application      应用题（新场景应用）
```

### 3.2 数量与质量

- 课程较小时：**10–20 题**；课程较大时：**20–50 题**。
- **不要为了凑数量制造低质量题目**；数量不足时如实说明。

### 3.3 条目格式

```text
Q: 什么是 loc 与 iloc 的区别？（Comparison）
依据: 材料中两者语义对比多次出现 + exercise 中易错点（Likely based on course emphasis）
答案要点: df.loc 按标签、df.iloc 按位置……
```

每题包含：题目、类型、**为什么判断为潜在重点**（引用证据）、答案要点（可选，避免与 12 重复时只给要点）。

## 4. 模拟题（12_mock_exam.md）

- 根据课程内容决定题型比例（概念 : 计算 : 代码 : 解读 : 应用），尽量贴近材料的练习风格。
- 结构：

```text
# Mock Exam
## Part A — 概念题（5 题，每题 4 分）……
## Part B — 计算题（3 题）……
## Part C — 代码题（2 题）……
## Part D — 解读/应用题（2 题）……
# Answer Key
## Part A ……
```

- 文件**后半部分**提供 Answer Key，答案尽量引用材料来源（`依据: Lecture05.pptx — Slide 12`）。
- 模拟题必须全部能从材料中找到依据或由材料内容直接推出；超出材料范围的题标注（拓展题）。

## 5. Exam 模式的质量检查

- 每个 ⭐⭐⭐ 条目是否有证据列表？
- 每个潜在考题是否标注类型与依据？
- 模拟题答案是否可追溯到材料？
- 是否出现"老师一定会考"类绝对化表述？（应改为依据式表述）
