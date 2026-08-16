---
name: study-review
description: "Use when analyzing course, lecture, training, workshop, certification, or study-material folders to extract, synthesize, deduplicate, and organize knowledge into structured study notes, formula sheets, code references, quick reviews, and optional exam-focused materials. Triggers: 总结课程文件夹/整理这些PPT/学习资料总结/复习这门课/生成复习资料/考试重点/知识体系/讲座分析/课程总结/考点整理."
whenToUse: "用户要求总结课程、讲座、培训、Summer School、Workshop、Certification、大学课程、在线课程、科研教程或自学资料；要求整理这些学习资料、分析 lecture、总结 PPT 知识点、整理考试重点、把材料形成知识体系；或以 full / exam / quick / lecture / concept 模式分析学习材料时使用。"
metadata:
  version: "1.0"
  category: study-assistant
---

# study-review — 通用课程资料解析与考试复习系统

适用场景：课程 / 讲座 / 培训 / Summer School / Workshop / Certification / 大学课程 / 在线课程 / 科研教程 / 技术培训 / 考试复习 / 自学资料。

**本 Skill 不针对任何特定学校、课程或考试，可跨项目、跨学科使用。** 不要在其中写死任何机构、专业、课程或考试信息；一切以扫描到的实际材料为准。

## 铁律（Critical Rules）

1. **DO NOT MODIFY SOURCE MATERIALS**。绝不修改、重命名、移动任何原始资料。所有输出只写入被分析目录下的 `_study_review/`（用户明确要求修改原始资料时除外）。
2. **先 Map 后分析**。任何模式的第一步都是递归扫描目录并建立 Material Map，禁止跳过扫描直接开始总结。
3. **知识结构优先**。最终笔记按 Course → Chapter → Topic → Concept 组织，禁止按文件顺序堆叠 Slide-by-Slide Summary。
4. **图片型 Slide 必须视觉分析**。文字少的页面不得判定"本页无重要内容"；无法可靠判读时标注 `[Visual requires manual review]`，不得编造。
5. **幻觉控制**。区分 Source Content 与「补充理解」（Supplementary explanation）；不确定信息用「待确认」；公式模糊用 `[Formula needs verification]`。
6. **去重**。重复定义/公式/示例/代码合并为一个条目并保留全部来源；不同角度的内容不删除，合并为更完整解释。
7. **来源追溯**。重要知识点保留来源：`Lecture03.pptx — Slide 18` / `Statistics.pdf — Page 23` / `exercise.ipynb — Code Cell 7` / `analysis.py — correlation section` / `notes.md — Data Cleaning`。
8. **不静默忽略**。每个文件要么被处理，要么在 `00_material_map.md` 中记录忽略/失败原因。

## 主工作流（10 步）

1. **Inventory** — 递归扫描目录（含所有子目录），收集文件名/类型/大小/路径。
2. **Classify** — 角色分类：Primary / Practice / Supporting / Duplicate（识别重复版本，不重复总结）。
3. **Extract** — 逐文件提取内容（PPT 按 slide、PDF 按 page、Notebook 按 cell、代码按 section）；大目录用 Map-Reduce。
4. **Analyze** — Slide/章节级分析（这是中间产物，不直接作为最终笔记输出）。
5. **Synthesize** — 跨文件知识融合：同一概念的多来源合并为一个完整条目。
6. **Deduplicate** — 去重 Pass：合并重复定义/公式/示例/代码。
7. **Reconstruct** — 知识重构：Course → Chapter → Topic → Concept → Definition / Principle / Formula / Example / Application。
8. **Prioritize** — 优先级分析（Exam 模式必做：⭐⭐⭐/⭐⭐/⭐，依据课程材料证据而非模型领域知识）。
9. **Generate** — 按模式生成输出文件（见下）。
10. **Validate** — 质量检查（Coverage / Traceability / Accuracy / Consistency / Deduplication / Formula / Code / Visual / Source / Hallucination）与 Final Self-Audit。

## 模式路由（Study Modes）

| 模式 | 触发方式 | 输出范围 |
|---|---|---|
| `full`（默认） | 用户未指定模式 | 00–09 + per_source/ |
| `exam` | "我要考试 / exam mode / 复习考试 / 考点 / 考试重点" | full 全部 + 10、11、12 |
| `quick` | "quick mode / 快速复习 / 快速总结" | 精简输出（以 09 为核心，配合 03/04/05/06） |
| `lecture` | "只总结 Lecture 3 / 这个 PPT / 这一章 / 指定 PDF" | 指定 Lecture/Chapter 的专注笔记 + 对应 per_source |
| `concept` | "分析 correlation / 某个主题的知识点" | 主题深挖笔记（跨文件聚合该主题全部材料） |

未指定目录时默认使用当前工作目录。

## 输出结构（全部写入 `<被分析目录>/_study_review/`）

```
00_material_map.md        材料地图（扫描/分类/处理记录）
01_overview.md            知识结构总览（树状）
02_master_notes.md        完整笔记（按知识结构组织，非文件结构）
03_key_concepts.md        关键定义 / 核心原理 / 核心区别
04_formula_sheet.md       公式表（Formula/Variables/Meaning/Conditions/Units/Interpretation/Source）
05_code_cheatsheet.md     代码速查（Task → Code → Explanation）
06_common_mistakes.md     易错点（Wrong → Why → Correct）
07_concept_links.md       概念依赖关系（知识图谱式）
08_source_index.md        Concept → Source 与 Source → Concept 双向索引
09_quick_review.md        10–20 分钟快速复习
10_exam_focus.md          [仅 exam] 考试重点（⭐⭐⭐/⭐⭐/⭐）
11_possible_questions.md  [仅 exam] 潜在考题（含依据）
12_mock_exam.md           [仅 exam] 模拟题 + Answer Key
per_source/               每个来源文件的独立总结（按原课程顺序查找用）
.cache/                   中间缓存（file/slide summaries、manifest.json，非最终笔记）
```

各文件详细规格见 `references/output-template.md`。

## 阶段参考（Reference Map — 执行到对应阶段先读）

| 阶段 | 先读 | 内容 |
|---|---|---|
| Inventory / Classify / 大目录 / 增量更新 | `references/material-analysis.md` | 扫描规则、角色分类、8-pass 大目录策略、manifest 增量更新 |
| Extract（PPT/PPTX/图片型 Slide） | `references/ppt-analysis.md` | 逐 Slide 提取清单、视觉分析流程、PPT 覆盖检查 |
| Analyze / Synthesize / Deduplicate / Reconstruct | `references/knowledge-synthesis.md` | 知识点字段、跨文件融合、去重、公式/代码/图表处理、概念链接 |
| Prioritize（Exam 模式） | `references/exam-analysis.md` | 优先级证据标准、潜在考题、模拟题 |
| Generate | `references/output-template.md` | 00–12 各文件模板与中英文规范 |
| Validate | `references/quality-control.md` | 十项质检、Final Self-Audit 清单 |

## 脚本（scripts/）

| 脚本 | 用途 | 回退 |
|---|---|---|
| `scripts/extract_ooxml.py <file> [--out FILE] [--media DIR]` | pptx/docx/xlsx 文本、结构、表格、公式近似、Speaker Notes、嵌入媒体清单与抽取；纯 Python stdlib，零第三方依赖 | 无需回退 |
| `scripts/extract_pdf.py <file> [--out FILE] [--render-dpi N] [--pages A-B]` | 用 Ghostscript（`gs`）提取 PDF 文本（逐页分隔）与逐页渲染 PNG 供视觉分析 | gs 缺失时脚本报错并给出备选（如 `brew install poppler`；doc/docx 可用 `textutil`）；仍不可行则标注「待确认」 |

用法示例（输出重定向到缓存，避免污染会话上下文）：

```bash
mkdir -p _study_review/.cache
python3 scripts/extract_ooxml.py "Course/Lecture01/slides.pptx" \
  --out _study_review/.cache/lecture01_slides.md \
  --media _study_review/.cache/lecture01_media
python3 scripts/extract_pdf.py "Course/Lecture02/slides.pdf" \
  --out _study_review/.cache/lecture02_slides.md --render-dpi 150
```

## 大规模资料与增量更新

- 目录 ≥15 个文件、或单个文件提取内容过大时，禁止一次性全部塞入上下文。按 8-pass 策略分阶段处理：Inventory → Per-file extraction → Per-section synthesis → Cross-file synthesis → Deduplication → Knowledge reconstruction → Priority analysis → Final output。中间结果（file summaries / slide summaries / extracted concepts / source mappings）写入 `_study_review/.cache/`，避免"后面的文件覆盖前面的记忆"。
- 若目标目录已存在 `_study_review/`：读取 `.cache/manifest.json`（记录每文件 sha256/mtime），**只重新分析新增或修改的文件**，更新知识体系 → 重新去重 → 更新最终笔记（Incremental Update），不重扫未变化的材料。

## 语言规范

- 默认：**中文解释 + 英文专业术语**（如：标准差（Standard Deviation）、相关系数（Correlation Coefficient））；公式保持标准数学表达；代码保持原语言。
- 课程材料主要为英文时仍默认中文解释 + 英文术语；用户明确要求英文 → 全英文输出；要求「中英双语」→ 双语输出。
