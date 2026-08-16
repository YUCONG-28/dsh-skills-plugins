#!/usr/bin/env node
/**
 * github_safe_math.mjs — GitHub-safe Markdown 数学格式化器（markdown-math-writer v3）
 *
 * 职责（只做安全的机械转换，绝不 regex 改写数学语义）：
 *   1. display math $$...$$ → GitHub math fence ```math ... ```
 *   2. \tag{...} 移除，编号转成 Markdown 文本（**式 (N)** 置于 fence 前）
 *   3. \boldsymbol → \mathbf（词法级安全替换，物理含义不变）
 *   4. 单行 aligned（无换行 \\）→ 去除 aligned 包装为普通公式
 *   5. 多行 aligned / cases 多行 / 超长公式（>400 字符） / 深度嵌套（>5 层 brace）
 *      → 标记 NEEDS_REGENERATION，交由 Agent 根据上下文重新生成，不做危险拆分
 *   6. inline math、普通 code fence、inline code、$HOME、\$10 一律不动
 *
 * 用法：
 *   node github_safe_math.mjs <输入.md> <输出.md>
 *   node github_safe_math.mjs --report <输入.md> <输出.md>   # 额外输出 JSON 报告
 *   node github_safe_math.mjs --stdout <输入.md>              # 转换结果直接输出
 */

import { readFile, writeFile } from "node:fs/promises";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

/* ------------------------------------------------------------------ */
/* 工具                                                                 */
/* ------------------------------------------------------------------ */
function maxBraceDepth(content) {
  let depth = 0, max = 0, esc = false;
  for (const ch of content) {
    if (esc) { esc = false; continue; }
    if (ch === "\\") { esc = true; continue; }
    if (ch === "{") { depth++; if (depth > max) max = depth; }
    else if (ch === "}") { depth = Math.max(0, depth - 1); }
  }
  return max;
}

/** 是否含多行 aligned（含 \\ 换行）；单行 aligned 可安全去掉包装 */
function analyzeDisplay(content) {
  const hasTag = /\\tag(?![a-zA-Z])/.test(content);
  const tagMatch = content.match(/\\tag\{([^}]*)\}/);
  const tagNumber = tagMatch ? tagMatch[1].trim() : null;
  const hasAligned = /\\begin\{aligned\}/.test(content);
  const hasMultiRow = /\\\\/.test(content.replace(/\\tag\{[^}]*\}/g, ""));
  const envs = (content.match(/\\begin\{[^}]*\}/g) ?? []).map((s) => s.slice(7, -1));
  const tooLong = content.length > 400;
  const tooDeep = maxBraceDepth(content) > 5;
  const multiEnv = envs.length > 1;
  return { hasTag, tagNumber, hasAligned, hasMultiRow, envs, tooLong, tooDeep, multiEnv };
}

/** 去掉 aligned 单层包装（仅限 \begin{aligned}...\end{aligned} 恰好一对、无嵌套、无 \\ 换行） */
function unwrapAligned(content) {
  if (!/\\begin\{aligned\}/.test(content)) return content;
  const envRe = /\\begin\{([^}]*)\}|\\end\{([^}]*)\}/g;
  const stack = [];
  let m, firstBegin = -1, lastEnd = -1;
  while ((m = envRe.exec(content))) {
    if (m[1] !== undefined) { stack.push(m[1]); if (firstBegin === -1 && m[1] === "aligned") firstBegin = m.index; }
    else {
      if (m[2] === "aligned" && stack[stack.length - 1] === "aligned") lastEnd = m.index;
      stack.pop();
    }
  }
  if (firstBegin === -1 || lastEnd === -1 || firstBegin > lastEnd) return content;
  const envStart = content.lastIndexOf("\\begin{aligned}", firstBegin);
  const envEnd = content.indexOf("\\end{aligned}", lastEnd);
  if (envStart === -1 || envEnd === -1) return content;
  const inner = content.slice(envStart + "\\begin{aligned}".length, envEnd);
  // 仅当内部没有 \begin（无嵌套）且没有 \\ 换行时安全展开
  if (/\\begin\{/.test(inner) || /\\\\/.test(inner)) return content;
  // aligned 的对齐符 & 不是数学运算符，去除不影响语义（单行 aligned 场景）
  const cleaned = inner.replace(/&/g, "").trim();
  return content.slice(0, envStart) + cleaned + content.slice(envEnd + "\\end{aligned}".length);
}

/* ------------------------------------------------------------------ */
/* 主转换                                                                */
/* ------------------------------------------------------------------ */

/**
 * @param {string} src Markdown 源码
 * @returns {{ md: string, report: object }}
 */
export async function githubSafeConvert(src) {
  const report = {
    displayMathTotal: 0,
    convertedToFence: 0,
    tagsRemoved: 0,
    tagsConvertedToMarkdown: [],
    alignedUnwrapped: 0,
    needsRegeneration: [],
    boldsymbolConverted: 0,
    inlineMath: 0,
    codeBlocksUntouched: 0,
    displayDollarLeft: 0,
  };
  const lines = src.split("\n");

  const tree = unified().use(remarkParse).use(remarkGfm).use(remarkMath).parse(src);
  const mathNodes = [];
  (function walk(n) {
    if (n.type === "inlineMath") report.inlineMath++;
    else if (n.type === "math") mathNodes.push(n);
    else if (n.type === "code") report.codeBlocksUntouched++;
    for (const c of n.children ?? []) walk(c);
  })(tree);
  report.displayMathTotal = mathNodes.length;

  /* inline oldsymbol → \mathbf（词法安全；按位置从后往前替换） */
  const inlineReplacements = [];
  (function walk(n) {
    if (n.type === "inlineMath") {
      const v = n.value ?? "";
      if (/\\boldsymbol(?![a-zA-Z])/.test(v)) {
        const c = (v.match(/\\boldsymbol(?![a-zA-Z])/g) ?? []).length;
        report.boldsymbolConverted += c;
        const start = n.position.start.offset;
        const end = n.position.end.offset;
        const raw = src.slice(start, end);
        const newRaw = raw.replace(/\\boldsymbol(?![a-zA-Z])/g, "\\mathbf");
        inlineReplacements.push({ start, end, text: newRaw });
      }
    }
    for (const c of n.children ?? []) walk(c);
  })(tree);

  /* 收集 math 节点位置（含 $$ 分隔符），从后往前替换 */
  const replacements = []; // { start, end, text }
  for (const node of mathNodes) {
    const start = node.position.start.offset;
    const end = node.position.end.offset;
    let content = node.value ?? "";

    /* \boldsymbol → \mathbf（词法安全） */
    const before = content;
    content = content.replace(/\\boldsymbol(?![a-zA-Z])/g, "\\mathbf");
    if (content !== before) report.boldsymbolConverted += (before.match(/\\boldsymbol(?![a-zA-Z])/g) ?? []).length;

    const { tagNumber, hasAligned, hasMultiRow, envs, tooLong, tooDeep, multiEnv } = analyzeDisplay(content);

    /* 移除 \tag{...} */
    let tagText = "";
    if (tagNumber !== null) {
      content = content.replace(/\\tag\{[^}]*\}/g, "").trim();
      report.tagsRemoved++;
      tagText = `**式 (${tagNumber})**\n\n`;
      report.tagsConvertedToMarkdown.push(tagNumber);
    }

    /* 单行 aligned → 去包装 */
    if (hasAligned && !hasMultiRow && envs.length === 1) {
      const unwrapped = unwrapAligned(content);
      if (unwrapped !== content) {
        content = unwrapped;
        report.alignedUnwrapped++;
      }
    }

    const needsRegen =
      (hasAligned && hasMultiRow) || multiEnv || tooLong || tooDeep ||
      envs.some((e) => !["aligned", "cases", "pmatrix", "bmatrix", "matrix", "vmatrix", "smallmatrix", "gathered", "split", "array"].includes(e));

    if (needsRegen) {
      const line = node.position.start.line;
      report.needsRegeneration.push({
        line,
        tag: tagNumber,
        reason: [
          hasAligned && hasMultiRow ? "aligned 多行" : "",
          multiEnv ? `多环境(${envs.join(",")})` : "",
          tooLong ? "超长(>400字符)" : "",
          tooDeep ? "嵌套过深(>5)" : "",
          envs.some((e) => !["aligned", "cases", "pmatrix", "bmatrix", "matrix", "vmatrix", "smallmatrix", "gathered", "split", "array"].includes(e)) ? `不兼容环境(${envs.filter((e) => !["aligned", "cases", "pmatrix", "bmatrix", "matrix", "vmatrix", "smallmatrix", "gathered", "split", "array"].includes(e)).join(",")})` : "",
        ].filter(Boolean).join("; "),
        formula: content.length > 120 ? content.slice(0, 120) + "…" : content,
      });
      /* 不自动改写：保留原内容转 fence（内容未变，仅换容器；Agent 后续重新生成） */
    }

    /* 内容清理：尾部孤立 '.' 前空格规范化（不改变数学意义） */
    content = content.trim();

    let fenceText = `${tagText}\`\`\`math\n${content}\n\`\`\`\n\n`;
    report.convertedToFence++;
    replacements.push({ start, end, text: fenceText });
  }

  /* 从后往前应用替换（inline 与 display 各自从后往前，避免偏移错位） */
  let out = src;
  const all = [...replacements, ...inlineReplacements].sort((a, b) => b.start - a.start);
  for (const r of all) {
    out = out.slice(0, r.start) + r.text + out.slice(r.end);
  }
  report.displayDollarLeft = (out.match(/(^|\n)\s*\$\$/g) ?? []).length;

  return { md: out, report };
}

/* ------------------------------------------------------------------ */
/* CLI                                                                 */
/* ------------------------------------------------------------------ */
const args = process.argv.slice(2);
const flags = { report: false, stdout: false };
const files = [];
for (const a of args) {
  if (a === "--report") flags.report = true;
  else if (a === "--stdout") flags.stdout = true;
  else if (a === "--help" || a === "-h") { console.log("用法: node github_safe_math.mjs [--report] [--stdout] <输入.md> [输出.md]"); process.exit(0); }
  else files.push(a);
}
if (files.length === 0 || (files.length === 1 && !flags.stdout)) {
  console.error("用法: node github_safe_math.mjs [--report] [--stdout] <输入.md> [输出.md]");
  process.exit(2);
}

const input = files[0];
const src = await readFile(input, "utf8");
const { md, report } = await githubSafeConvert(src);

if (flags.stdout || files.length === 1) {
  process.stdout.write(md);
} else {
  await writeFile(files[1], md);
  console.log(`转换完成: ${input} → ${files[1]}`);
}

if (flags.report) {
  console.log(JSON.stringify(report, null, 2));
}
