# Quality Control — 十项质检与 Final Self-Audit

Validate 步骤（工作流第 10 步）执行以下检查，在最终回复中报告检查结果。检查在输出**全部生成之后**进行。

## 1. 十项质检

| # | 检查项 | 内容 |
|---|---|---|
| 1 | **Coverage** | 扫描数 = 处理数 + 跳过数 + 失败数（00 中可核对）；每个文件有明确去向 |
| 2 | **Traceability** | 重要知识点（定义/公式/易错点/考点）带来源引用；格式符合 knowledge-synthesis.md §5 |
| 3 | **Accuracy** | 事实、数字、代码与来源一致；无编造内容 |
| 4 | **Consistency** | 术语全文统一（中英文术语、公式写法）；01 的树与 02/03 的章节一致；09 与 03/04/05 一致 |
| 5 | **Deduplication** | 无重复定义/公式/示例/代码条目；公式表无重复主条目 |
| 6 | **Formula correctness** | 符号/上下标/分母/指数/单位/变量定义已核对；无法确认的标 `[Formula needs verification]` |
| 7 | **Code correctness** | 代码保持原始语义；无"优化"偏离课程目标；疑似课程错误标 `Potential issue in source` |
| 8 | **Visual coverage** | 图片型 Slide 全部有视觉分析记录或 `[Visual requires manual review]` 标注；无"本页无重要内容"式跳过 |
| 9 | **Source coverage** | 每个 Primary/Practice 文件的内容都体现在笔记中；per_source 与 02 可互查 |
| 10 | **Hallucination control** | Source Content 与「补充理解」分离；无 unsupported claim；不确定处有「待确认」/`[Formula needs verification]`/`[Visual requires manual review]` |

## 2. Coverage Check（计数核对）

```text
扫描文件数: N
处理文件数: M（Primary: p / Practice: q / Supporting: r）
跳过文件数: K（原因: 重复版本/待转换/用户指定排除…）
失败文件数: F（原因: 损坏/加密/解析错误…）
```

- 某文件无法处理 → 00 中**明确记录原因**，不得静默忽略。
- 计数不一致 → 视为未通过，修正后重新生成 00。

## 3. PPT Coverage 专项

- 是否只分析了 PPT 前几页？（对照 extract_ooxml.py 的总页数统计）
- 是否遗漏图片型 Slide？（对照每页图片/媒体映射）
- 是否遗漏表格、Speaker Notes、Appendix、隐藏页、总结页？

## 4. Formula Check

- 逐公式核对：符号、上下标、分母、指数、单位、变量定义。
- 存在不确定性 → 回到来源（渲染图/原文页）确认；仍无法确认 → `[Formula needs verification]`，**不得用模型知识"补全"**。

## 5. Code Check

- 代码与来源一致、保持原始语义；不为了"优化"改变课程代码的教学目标。
- 发现课程代码本身可能有错误 → 标 `Potential issue in source` 并解释，保留原样。

## 6. Final Self-Audit（十问）

完成后逐条自问并记录结果：

1. 是否遗漏主要知识？（对照 01 的树逐章检查）
2. 是否有重复？（概念/公式/示例交叉检查）
3. 是否能够快速找到知识来源？（08 双向索引可用）
4. 是否存在 unsupported claim？（每个断言能指出来源或标为补充理解）
5. Quick Review 是否真的简洁？（10–20 分钟可浏览）
6. Formula Sheet 是否完整？（覆盖所有重点公式）
7. Code Cheatsheet 是否可直接复习？（Task→Code→Explanation 结构完整）
8. Master Notes 是否按知识体系组织而非文件结构？
9. Exam Focus 是否有来源依据？（每条 ⭐⭐⭐ 有证据列表）
10. 未修改任何原始材料？（全部输出在 `_study_review/` 内）

## 7. 质检报告格式

最终回复末尾附：

```text
## 质检报告
- Coverage: 扫描 N / 处理 M / 跳过 K / 失败 F ✅/❌（原因）
- Traceability ✅
- ……
- Self-Audit: 通过 / 未通过（列出未通过项）
```
