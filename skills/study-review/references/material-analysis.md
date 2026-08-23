# Material Analysis — 扫描、分类、材料地图、大目录策略、增量更新

本文件是 SKILL.md 工作流第 1–2 步（Inventory / Classify）及大目录/增量场景的详细规则。

## 1. Inventory — 递归扫描

### 1.1 扫描规则

- **递归**所有子目录（Lecture01/、Week02/、exercises/、solutions/、data/…），禁止只处理根目录文件。
- **排除**：`_study_review/`（本 Skill 输出目录，绝不重复扫描自身）、`.git/`、隐藏目录（`.` 开头；用户明确要求时才包含）。
- 符号链接：跟随（但记录真实路径，避免同一文件被重复计入）。
- 对每个文件收集：相对路径、文件名、扩展名、大小（字节）、mtime、所属目录。

### 1.2 支持的格式

| 类别 | 格式 | 处理方式 |
|---|---|---|
| 幻灯片 | `.pptx` | `scripts/extract_ooxml.py`（主路径） |
| 幻灯片 | `.ppt`（旧版二进制） | 有 LibreOffice 时 `soffice --headless --convert-to pptx`；否则记录「待转换」，不得假装解析 |
| 文档 | `.pdf` | `scripts/extract_pdf.py`（gs 文本 + 可渲染页面） |
| 文档 | `.md` / `.txt` | 直接读取 |
| 文档 | `.docx` | `scripts/extract_ooxml.py` 或 `textutil -convert txt` |
| 文档 | `.doc` | `textutil -convert txt`（macOS 原生） |
| 表格 | `.csv` | 直接读取（大文件先采样行/列结构） |
| 表格 | `.xlsx` | `scripts/extract_ooxml.py`（含 sharedStrings 与公式标记） |
| 表格 | `.xls` | 有 LibreOffice 时转换；否则记录「待转换」 |
| 笔记本 | `.ipynb` | python3 stdlib json：按 cell 提取（markdown/code/输出摘要），标记 Code Cell N |
| 代码 | `.py` / `.r` / `.m` / `.sql` / `.js` / `.cpp` 等 | 直接读取，按 section/函数切分 |
| 图像 | `.png` / `.jpg` / `.jpeg` / `.gif` / `.webp` / `.bmp` | `read_image` 视觉分析（DeepSeek 主模型内置多模态直接分析） |
| 矢量 | `.svg` | 先读 XML 文本（文本/结构可提取），图形部分按图像处理 |
| 网页 | `.html` / `.htm` | `textutil -convert txt` 或直接读 |

### 1.3 命名启发（用于 Lecture/Chapter 归组，仅启发不强制）

- 前缀/路径关键词：`Lecture`、`Lec`、`Chapter`、`Ch`、`Week`、`Session`、`Module`、`Unit`、`Part`、`Tutorial`、`Exercise`、`HW`、`Homework`、`Assignment`、`Lab`、`Exam`、`Midterm`、`Final`、`Notes`、`Reading`、`Slides`、`Solution`、`Data`。
- 目录名通常是 Lecture 的天然分组；文件内的章节标题用于二级归组。

## 2. Classify — 自动区分材料角色

| 角色 | 典型例子 | 处理强度 |
|---|---|---|
| **Primary Source**（主材料） | Lecture slides、教材、讲义、老师正式 PDF、大纲 | 逐页/逐节完整提取 |
| **Practice Source**（练习材料） | Exercise、Homework、Notebook、Example code、Lab | 提取题型、用到的方法、易错点、答案要点 |
| **Supporting Source**（支撑材料） | dataset、reference、appendix、supplementary、README | 提取与知识相关的部分；数据文件记录结构说明 |
| **Duplicate / Version** | `Lecture01.pdf` vs `Lecture01_final.pdf` vs `Lecture01_v2.pdf`、`(1)`、`copy` | 版本组只分析一次 |

### 2.1 Duplicate 识别规则

- 模式匹配：`_final`、`_v2`、`_v3`、`_new`、`_updated`、`_copy`、`(1)`、` copy`、`-final` 等后缀差异；或文件名主体相同且大小接近。
- 同一版本组：**选择最新修改的一个作为主版本**，其余标记为 duplicate，不重复总结；在 `00_material_map.md` 记录合并决定（选哪个、为什么）。
- 若两个"重复"文件大小差异显著（>20%）→ 可能不是重复，各自分析并在 00 中说明。
- **内容级去重**（不同文件讲同一概念）不属于本步，属于 knowledge-synthesis.md 的 Deduplication Pass。

## 3. Material Map（00_material_map.md 草案字段）

每个文件一行/一节，至少包含：

```text
文件名 | 类型 | 大小 | 所属目录 | 可能对应 Lecture/Chapter | 内容类型 | 角色 | 需视觉分析? | 重复版本? | 处理决定
```

示例：

```text
Lecture01/slides.pptx  → 角色: Primary   → 内容: Lecture 讲义 → 对应: Lecture 1
Lecture01/exercise.ipynb → 角色: Practice → 内容: 练习 Notebook → 对应: Lecture 1
Lecture01/data.csv      → 角色: Supporting → 内容: 数据集 → 对应: Lecture 1
Lecture03/slides_final.pdf → 角色: Duplicate（主版本: slides.pdf）→ 只分析一次
```

## 4. 大目录策略（8-Pass Map-Reduce）

目录 ≥15 个文件，或任一文件提取后超过约 1.5 万 token 时启用；禁止一次性全部塞入上下文（避免后面的文件覆盖前面的记忆）。

```text
Pass 1  Inventory         扫描全部文件 → manifest 初稿（.cache/inventory.json）
Pass 2  Per-file extraction  逐个文件提取（scripts 输出重定向到 .cache/extracted/）
Pass 3  Per-section synthesis 每个文件生成独立小结（.cache/summaries/<file>.md）
Pass 4  Cross-file synthesis  按概念/章节聚合跨文件内容（.cache/synthesis/）
Pass 5  Deduplication     合并重复定义/公式/示例/代码
Pass 6  Knowledge reconstruction 构建 Course→Chapter→Topic→Concept 树
Pass 7  Priority analysis  Exam 模式下的 ⭐ 分级（依据见 exam-analysis.md）
Pass 8  Final output       生成 00–12 + per_source
```

- 每个 Pass 的产物写入 `_study_review/.cache/`；已完成的 Pass 不重跑。
- 文件多时优先用 per-source 批量处理；模型上下文紧张时逐批读取 .cache 小结而非原始文件。
- 无法处理的文件（损坏/加密/格式未知）在 Pass 1 即标记，Pass 8 在 00 中汇总，**不静默忽略**。

## 5. 增量更新（Incremental Update）

`_study_review/.cache/manifest.json`：

```json
{
  "generatedAt": "2026-08-16T12:00:00+08:00",
  "mode": "full",
  "files": {
    "Lecture01/slides.pptx": { "sha256": "...", "mtime": 1755..., "size": 12345, "role": "Primary" }
  }
}
```

更新流程：

1. 重新扫描目录，与 manifest 比对 sha256/mtime/size。
2. 新增或修改的文件 → 重新提取 + 分析（只处理这些文件）。
3. 删除的文件 → 从知识体系中移除其贡献（在 00 中记录）。
4. 将新知识合并进现有结构 → 重新做 Deduplication Pass → 更新受影响的最终笔记（02/03/04/05/06/07/08/09 及 per_source 中受影响条目）。
5. 更新 manifest 与 00_material_map.md 的统计。

## 6. 缓存约定（.cache/）

- 缓存文件名规范：`<lecture>_slides.md`、`<file>_summary.md`、`slides_summaries/<file>.md`、`concepts.md`、`source_map.md`、`inventory.json`、`manifest.json`。
- **缓存不是最终笔记**；最终输出必须从缓存中综合提炼，而不是把缓存文件改名交付。
- 大目录分析结束后可保留缓存（支持增量更新）；是否清理由用户决定。
