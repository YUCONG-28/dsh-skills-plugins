#!/usr/bin/env node
/**
 * validate_math.mjs v3 — Markdown 数学公式校验器（markdown-math-writer Skill，target-specific）
 *
 * 六层验证（A–F），全部通过才 PASS：
 *   A. Markdown 结构（AST：code / inline code / table / list / blockquote 边界）
 *   B. 数学 delimiter（$ / $$ 成对、inline/display 区分、转义、shell 变量、货币）
 *   C. LaTeX 语法（brace/bracket 平衡、空组、连续上下标、\frac 参数数、环境栈、
 *      \left/\right 配对、孤立二元运算符、\tag 位置）
 *   D. KaTeX（throwOnError 逐节点 + 全文档渲染）
 *   E. MathJax（mathjax-full tex2svg 逐节点，Node 本地 API）
 *   F. GitHub 兼容 lint（\(...\)、math fence、display math 在 table/list/blockquote、
 *      空行分隔、中文 \text{}、\boldsymbol 等）
 *
 * 输出分级（Renderer: MARKDOWN / LATEX / KATEX / MATHJAX / GITHUB-COMPAT）：
 *
 *   FAIL
 *   File: README.md
 *   Line: 137
 *   Column: 1
 *   Renderer: MATHJAX
 *   Formula: \frac{x_{i}}{y}}
 *   Error: Extra close brace or missing open brace
 *
 * 用法：
 *   node validate_math.mjs [--json] [--no-katex] [--no-mathjax] [--target github|mpe|generic] <file.md> [...]
 *
 * target=github（默认，GitHub-safe 模式）硬性 FAIL：
 *   $$ block、\tag、\begin{aligned/align/equation/gather/split、空 _{}/^{}、
 *   普通 fence 中的真实公式、未闭合 math fence、brace mismatch
 *   warning：\boldsymbol、复杂嵌套、超长单公式
 * target=mpe / generic：$$ block、aligned、\tag（须在 \end 之后）均允许。
 *
 * 说明：本地 KaTeX/MathJax PASS 只代表语法正确；
 * 不声称 "GitHub rendering verified"，仅输出 GITHUB-SAFE STRUCTURE: PASS。
 *
 * 依赖只安装在本 Skill 的 scripts/node_modules，不污染全局环境。
 */

import { readFile } from "node:fs/promises";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkRehype from "remark-rehype";
import rehypeKatex from "rehype-katex";
import rehypeStringify from "rehype-stringify";

/* ------------------------------------------------------------------ */
/* KaTeX / MathJax 可选加载：缺失时对应层降级为 skipped                    */
/* ------------------------------------------------------------------ */
let katex = null;
try {
  const mod = await import("katex");
  katex = mod.default ?? mod;
} catch {
  katex = null;
}

let mjConvert = null; // (formula, display) => html 字符串；解析失败抛错
try {
  const { mathjax } = await import("mathjax-full/js/mathjax.js");
  const { TeX } = await import("mathjax-full/js/input/tex.js");
  const { SVG } = await import("mathjax-full/js/output/svg.js");
  const { liteAdaptor } = await import("mathjax-full/js/adaptors/liteAdaptor.js");
  const { RegisterHTMLHandler } = await import("mathjax-full/js/handlers/html.js");
  const { AllPackages } = await import("mathjax-full/js/input/tex/AllPackages.js");
  const adaptor = liteAdaptor();
  RegisterHTMLHandler(adaptor);
  const tex = new TeX({ packages: AllPackages });
  const svg = new SVG({ fontCache: "local" });
  const html = mathjax.document("", { InputJax: tex, OutputJax: svg });
  mjConvert = (formula, display) => adaptor.outerHTML(html.convert(formula, { display }));
} catch {
  mjConvert = null;
}

const RENDERER = { MARKDOWN: "MARKDOWN", LATEX: "LATEX", KATEX: "KATEX", MATHJAX: "MATHJAX", GITHUB: "GITHUB-COMPAT" };

/* 文本中出现即警告的 LaTeX 命令（数学模式外误用检测） */
const LATEX_COMMANDS = new Set([
  "alpha", "beta", "gamma", "delta", "epsilon", "varepsilon", "zeta", "eta",
  "theta", "vartheta", "lambda", "mu", "nu", "xi", "pi", "rho", "sigma",
  "tau", "phi", "varphi", "chi", "psi", "omega", "Gamma", "Delta", "Theta",
  "Lambda", "Xi", "Pi", "Sigma", "Phi", "Psi", "Omega",
  "frac", "dfrac", "tfrac", "sqrt", "sum", "prod", "int", "iint", "iiint",
  "oint", "lim", "limsup", "liminf", "partial", "nabla", "mathbf", "boldsymbol",
  "mathrm", "mathbb", "mathcal", "mathit", "text", "mbox",
  "operatorname", "left", "right", "big", "Big", "bigg", "Bigg", "begin", "end",
  "pmatrix", "bmatrix", "matrix", "vmatrix", "cases", "aligned", "split",
  "gathered", "quad", "qquad", "times", "cdot", "pm", "mp", "div", "circ",
  "ast", "infty", "vec", "hat", "bar", "tilde", "dot", "ddot", "overline",
  "underline", "approx", "neq", "ne", "leq", "le", "geq", "ge", "ll", "gg",
  "equiv", "propto", "sim", "simeq", "cong", "to", "rightarrow", "leftarrow",
  "Rightarrow", "Leftarrow", "Leftrightarrow", "mapsto", "langle", "rangle",
  "lvert", "rvert", "lVert", "rVert", "tag", "notin", "subset", "subseteq",
  "supset", "supseteq", "cup", "cap", "emptyset", "varnothing", "cdots",
  "ldots", "vdots", "ddots", "sin", "cos", "tan", "cot", "sec", "csc",
  "arcsin", "arccos", "arctan", "sinh", "cosh", "tanh", "ln", "log", "exp",
  "max", "min", "sup", "inf", "det", "dim", "ker", "rank", "Re", "Im", "arg",
]);

/* ------------------------------------------------------------------ */
/* 工具函数                                                              */
/* ------------------------------------------------------------------ */
function makeLineIndex(src) {
  const starts = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === "\n") starts.push(i + 1);
  const lineOf = (offset) => {
    let lo = 0, hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid; else hi = mid - 1;
    }
    return lo + 1;
  };
  const colOf = (offset) => offset - starts[lineOf(offset) - 1] + 1;
  return { lineOf, colOf };
}

const CJK = /[\u3400-\u9fff\uf900-\ufaff]/;

/** 数学内容的花括号最大嵌套深度 */
function maxBraceDepthOf(content) {
  let depth = 0, max = 0, esc = false;
  for (const ch of content) {
    if (esc) { esc = false; continue; }
    if (ch === "\\") { esc = true; continue; }
    if (ch === "{") { depth++; if (depth > max) max = depth; }
    else if (ch === "}") { depth = Math.max(0, depth - 1); }
  }
  return max;
}

/**
 * 解析一个"组 {…} 或单字符参数"。返回 {ok, text, end, empty}。
 */
function parseGroupOrChar(content, start) {
  let i = start;
  while (i < content.length && /\s/.test(content[i])) i++;
  if (content[i] === "{") {
    let depth = 0, j = i;
    for (; j < content.length; j++) {
      if (content[j] === "\\") { j++; continue; }
      if (content[j] === "{") depth++;
      else if (content[j] === "}") { depth--; if (depth === 0) break; }
    }
    if (depth !== 0) return { ok: false, error: "未闭合的 { 组", end: j + 1 };
    const inner = content.slice(i + 1, j);
    return { ok: true, text: inner, empty: inner.trim() === "", end: j + 1 };
  }
  if (content[i] === undefined) return { ok: false, error: "缺少参数", end: i };
  if (content[i] === "\\") return { ok: false, error: "参数缺失（参数不能以 \\ 开头）", end: i + 1 };
  return { ok: true, text: content[i], empty: false, end: i + 1 };
}

/**
 * C 层：LaTeX 结构 lint（返回 [{renderer, error}]）
 * 捕获：brace 不平衡、空 _{}/^{}、连续上下标、\frac/\sqrt 参数数、
 *       \left/\right 配对、环境栈、孤立二元运算符、\tag 位置、中文 \text{}。
 */
function lintLatex(content) {
  const problems = [];
  const push = (error) => problems.push({ renderer: RENDERER.LATEX, error });
  const pushWarning = (error) => problems.push({ renderer: RENDERER.LATEX, error, warning: true });

  /* --- 环境栈：\begin{X} / \end{X} 成对且名称匹配、允许嵌套 --- */
  const envRe = /\\begin\{([^}]*)\}|\\end\{([^}]*)\}/g;
  const envStack = [];
  let m;
  while ((m = envRe.exec(content))) {
    if (m[1] !== undefined) envStack.push({ name: m[1], index: m.index });
    else {
      const top = envStack.pop();
      if (!top) { push(`多余 \\end{${m[2]}}（没有对应的 \\begin）`); continue; }
      if (top.name !== m[2]) push(`环境嵌套错误：\\begin{${top.name}} 被 \\end{${m[2]}} 关闭`);
    }
  }
  if (envStack.length > 0) {
    push(`未闭合环境：\\begin{${envStack[envStack.length - 1].name}} 缺少对应的 \\end`);
  }

  /* --- 空的下标/上标组与连续上下标 --- */
  for (const re of [/_\{[\s\\]*\}/g, /\^\{[\s\\]*\}/g]) {
    while ((m = re.exec(content))) {
      push(`空的上/下标组 "${m[0]}"；禁止生成空 _{}/^{}，x^{*}_{} 应写为 x^{*}`);
    }
  }
  for (const re of [/_\{\{/g, /\^\{\{/g]) {
    while ((m = re.exec(content))) {
      push(`上/下标后出现双重花括号 "${m[0]}"（嵌套花括号错误，如 x_{{i} / x^{{2}）`);
    }
  }
  const consecRe = /(\^|_)\{[^}]*\}\s*\1|(\^|_)[^{}\s]\2/g;
  while ((m = consecRe.exec(content))) {
    push(`连续上标/下标 "${m[0]}"；一次只能有一个上标或下标（x^{2}^{3} / x_1_2 均为错误）`);
  }

  /* --- \frac / \dfrac / \tfrac：必须恰好两个非空参数 --- */
  for (const cmd of ["\\frac", "\\dfrac", "\\tfrac"]) {
    let idx = 0;
    while ((idx = content.indexOf(cmd, idx)) !== -1) {
      let pos = idx + cmd.length;
      const a1 = parseGroupOrChar(content, pos);
      if (!a1.ok) { push(`${cmd} 第一个参数错误：${a1.error}`); break; }
      if (a1.empty) { push(`${cmd} 第一个参数为空 {}`); break; }
      const a2 = parseGroupOrChar(content, a1.end);
      if (!a2.ok) { push(`${cmd} 第二个参数错误：${a2.error}`); break; }
      if (a2.empty) { push(`${cmd} 第二个参数为空 {}`); break; }
      idx = a2.end;
    }
  }

  /* --- \sqrt：可选 [n]，必须有一个参数 --- */
  {
    let idx = 0;
    while ((idx = content.indexOf("\\sqrt", idx)) !== -1) {
      let pos = idx + 5;
      if (content[pos] === "[") {
        const close = content.indexOf("]", pos);
        if (close === -1) { push("\\sqrt 的 [n] 未闭合"); break; }
        pos = close + 1;
      }
      const a = parseGroupOrChar(content, pos);
      if (!a.ok) { push(`\\sqrt 参数错误：${a.error}`); break; }
      if (a.empty) { push("\\sqrt 参数为空 {}"); break; }
      idx = a.end;
    }
  }

  /* --- \left / \right 配对计数 --- */
  {
    const lefts = (content.match(/\\left(?![a-zA-Z])/g) ?? []).length;
    const rights = (content.match(/\\right(?![a-zA-Z])/g) ?? []).length;
    if (lefts !== rights) push(`\\left(${lefts}) 与 \\right(${rights}) 数量不匹配`);
  }

  /* --- 孤立二元运算符 + 转义空格（丢项模式：- \ ；单个 \ 后接空格/行尾；双 \\ 换行符除外） --- */
  {
    const orphanRe = /[=+\-*/](?:[ \t]*)\\(?:[ \t\n]|$)/g;
    while ((m = orphanRe.exec(content))) {
      push(`孤立二元运算符 "${m[0]}"（二元运算符后接孤立反斜杠/转义空格，疑似丢项；如 "- \\" 应改为 "-\\exp(...)"）`);
    }
  }

  /* --- \tag 不允许出现在任何 \begin...\end 环境内部 --- */
  {
    const envRe2 = /\\begin\{[^}]*\}|\\end\{[^}]*\}|\\tag(?![a-zA-Z])/g;
    let mm, depth = 0, tagInside = false;
    while ((mm = envRe2.exec(content))) {
      if (mm[0].startsWith("\\begin")) depth++;
      else if (mm[0].startsWith("\\end")) depth--;
      else if (depth > 0) { tagInside = true; break; }
    }
    if (tagInside) push("\\tag 不允许出现在 \\begin{aligned} 等环境内部（KaTeX/GitHub 报 'tag not allowed in aligned environment'）；移到 \\end{...} 之后");
  }

  /* --- 括号平衡：( ) [ ]——转义感知栈式配对；半开区间 [a,b) / (a,b] 合法；
         \\[6pt] 的 [ ] 是 \\ 可选参数，不受影响 --- */
  {
    const s = content.replace(/\\text\{[^}]*\}/g, "");
    const stack = [];
    let pendingEsc = false;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (ch === "\\") { pendingEsc = !pendingEsc; continue; }
      if (pendingEsc) { pendingEsc = false; continue; }
      if (ch === "(" || ch === "[") stack.push(ch);
      else if (ch === ")" || ch === "]") {
        if (stack.length === 0) {
          push(`多余的闭合括号 "${ch}"（Extra close brace 类错误）`);
          continue;
        }
        const top = stack.pop();
        const okPair = (top === "(" && ch === ")") || (top === "[" && ch === "]");
        const interval = (top === "[" && ch === ")") || (top === "(" && ch === "]"); // [a,b) / (a,b]
        if (!okPair && !interval) push(`括号类型不匹配：${top} 与 ${ch}`);
      }
    }
    if (stack.length > 0) push(`未闭合的括号：${stack.join("")} 缺少对应的闭合括号`);
  }

  /* --- 花括号平衡（排除转义 \{ \}） --- */
  {
    const s = content.replace(/\\([{}])/g, "");
    let depth = 0, bad = -1;
    for (let i = 0; i < s.length; i++) {
      if (s[i] === "{") depth++;
      else if (s[i] === "}") {
        depth--;
        if (depth < 0) { bad = i; break; }
      }
    }
    if (depth !== 0) {
      push(`花括号不平衡（${bad >= 0 ? `多余的 } 在位置 ${bad}` : "缺少 }"}）；这是 'Extra close brace or missing open brace' 类错误`);
    }
  }

  /* --- 中文出现在 \text{} 内（GitHub/Obsidian 缺字风险，warning 级） --- */
  {
    const tRe = /\\text\{([^}]*)\}/g;
    while ((m = tRe.exec(content))) {
      if (CJK.test(m[1])) {
        problems.push({ renderer: RENDERER.GITHUB, error: "公式 \\text{} 内包含中文（GitHub/Obsidian 可能缺字或乱码）；建议把中文移到正文中", warning: true });
      }
    }
  }

  return problems;
}

/* shell 变量判定：$ 后跟 ≥2 个全大写/下划线字符且不含数字，且后接非 "="、非小写 */
function looksLikeShellVar(src, idx) {
  const m = /^[A-Z_][A-Z0-9_]*/.exec(src.slice(idx + 1));
  if (!m) return false;
  const name = m[0];
  if (name.length < 2 || /\d/.test(name)) return false;
  const rest = src.slice(idx + 1 + name.length);
  if (/^\s*=/.test(rest)) return false;
  if (/^[a-z0-9_$]/.test(rest)) return false;
  return true;
}

/* ------------------------------------------------------------------ */
/* 主校验入口                                                            */
/* ------------------------------------------------------------------ */

/**
 * @param {string} src Markdown 源码
 * @param {object} [opts]
 * @param {string} [opts.filename]
 * @param {boolean} [opts.useKatex]
 * @param {boolean} [opts.useMathjax]
 * @param {"github"|"mpe"} [opts.target] 默认 "github"
 */
export async function validateSource(src, opts = {}) {
  const filename = opts.filename ?? "<input>";
  const target = opts.target ?? "github";
  if (!["github", "mpe", "generic"].includes(target)) throw new Error(`未知 target: ${target}`);
  const useKatex = opts.useKatex !== false && katex !== null;
  const useMathjax = opts.useMathjax !== false && mjConvert !== null;
  const errors = [];
  const warnings = [];
  const stats = {
    target,
    inlineMath: 0,
    displayMath: 0,
    codeFences: 0,
    inlineCode: 0,
    tables: 0,
    mathFences: 0,
    katexChecked: 0,
    katexErrors: 0,
    mathjaxChecked: 0,
    mathjaxErrors: 0,
    emptyMath: 0,
    tagsFound: 0,
    displayDollarBlocks: 0,
    alignedEnvs: 0,
    eqEnvs: 0,
    unclosedMathFences: 0,
    normalFenceWithMath: 0,
    complexWarnings: 0,
    boldsymbolWarnings: 0,
    katexRenderTest: useKatex ? "pending" : "skipped",
  };

  const { lineOf, colOf } = makeLineIndex(src);
  const sliceAt = (node) =>
    node?.position?.start?.offset !== undefined && node?.position?.end?.offset !== undefined
      ? src.slice(node.position.start.offset, node.position.end.offset)
      : "";

  const addIssue = (severity, line, column, renderer, formula, error) => {
    const it = { file: filename, line, column, renderer, formula, error };
    (severity === "error" ? errors : warnings).push(it);
  };
  const addError = (line, column, renderer, formula, error) => addIssue("error", line, column, renderer, formula, error);
  const addWarning = (line, column, renderer, formula, error) => addIssue("warning", line, column, renderer, formula, error);

  let tree;
  try {
    tree = unified().use(remarkParse).use(remarkGfm).use(remarkMath).parse(src);
  } catch (e) {
    addError(1, 1, RENDERER.MARKDOWN, "", `Markdown 解析失败: ${e.message}`);
    return { ok: false, errors, warnings, stats };
  }

  /* ---------- 遍历 AST ---------- */
  const ancestors = [];
  const masks = [];

  const checkEngines = (line, column, content, display, formula) => {
    if (useKatex) {
      try {
        katex.renderToString(content, { throwOnError: true, displayMode: display, strict: "ignore" });
        stats.katexChecked++;
      } catch (e) {
        stats.katexErrors++;
        addError(line, column, RENDERER.KATEX, formula, `KaTeX parse error: ${e.message}`);
      }
    }
    if (useMathjax) {
      try {
        mjConvert(content, display);
        stats.mathjaxChecked++;
      } catch (e) {
        stats.mathjaxErrors++;
        addError(line, column, RENDERER.MATHJAX, formula, `MathJax: ${e.message}`);
      }
    }
  };

  (function walk(node) {
    switch (node.type) {
      case "code": {
        stats.codeFences++;
        masks.push([node.position.start.offset, node.position.end.offset]);
        const lang = (node.lang ?? "").toLowerCase();
        const fenceContent = node.value ?? "";
        if (!["math", "latex", "tex"].includes(lang) && (/^\s*\$\$/m.test(fenceContent) || /\\begin\{/.test(fenceContent))) {
          stats.normalFenceWithMath++;
          const sev = target === "github" ? "error" : "warning";
          addIssue(sev, node.position.start.line, node.position.start.column, RENDERER.GITHUB,
            fenceContent.trim().slice(0, 60),
            `普通 code fence（\`\`\`${lang}）中包含疑似真实公式（$$ 或 \\begin{/\\frac{）；真正要渲染的公式必须放 math fence（\`\`\`math）或 $$...$$，不能放普通代码块`);
        }
        if (["math", "latex", "tex"].includes(lang)) {
          stats.mathFences++;
          const line = node.position.start.line;
          const column = node.position.start.column;
          const content = node.value ?? "";
          const formula = content.length > 60 ? content.slice(0, 60) + "…" : content;
          /* 未闭合检查：节点原始区间内、开 fence 行之后必须存在 ``` 闭合行 */
          const raw = sliceAt(node);
          const restLines = raw.split("\n").slice(1);
          const closed = restLines.some((l) => /^\s*```/.test(l));
          if (!closed) {
            stats.unclosedMathFences++;
            addError(line, column, RENDERER.GITHUB, formula, `math fence（\`\`\`${lang}）未闭合`);
          }
          if (content.trim() === "") {
            stats.emptyMath++;
            addError(line, column, RENDERER.GITHUB, formula, "空的 math fence（```math 内没有公式）");
          } else {
            for (const p of lintLatex(content)) addIssue(p.warning ? "warning" : "error", line, column, p.renderer, formula, p.error);
            checkEngines(line, column, content, true, formula);
          }
          if (target !== "github") {
            addWarning(line, column, RENDERER.GITHUB, formula, `math fence（\`\`\`${lang}）是 GitHub 方言；MPE/Obsidian 可能不渲染，该 target 下建议用 $$...$$`);
          }
        }
        break;
      }
      case "inlineCode":
        stats.inlineCode++;
        masks.push([node.position.start.offset, node.position.end.offset]);
        break;
      case "inlineMath": {
        stats.inlineMath++;
        const line = node.position.start.line;
        const column = node.position.start.column;
        const content = node.value ?? "";
        const raw = sliceAt(node);
        const formula = content.length > 60 ? content.slice(0, 60) + "…" : content;
        const inTable = ancestors.some((a) => a.type === "tableCell");
        const rawTrimmed = raw.trimEnd();
        const openRun = (rawTrimmed.match(/^\$+/) ?? [""])[0].length;
        const closeRun = (rawTrimmed.match(/\$+$/) ?? [""])[0].length;

        if (!rawTrimmed.endsWith("$")) {
          addError(line, column, RENDERER.MARKDOWN, formula, `未闭合的行内 $ 分隔符（或 $ 误配到了 inline code/文本上）`);
        } else if (openRun !== closeRun) {
          addError(line, column, RENDERER.MARKDOWN, formula, `行内数学分隔符不匹配（开 $${openRun} 个 / 闭 $${closeRun} 个）`);
        } else if (openRun >= 2 && inTable) {
          addError(line, column, RENDERER.GITHUB, formula, `表格 cell 内禁止块级 $$...$$；请改为单 $...$ 或移到表格下方`);
        } else if (openRun >= 2) {
          addWarning(line, column, RENDERER.MARKDOWN, formula, `行内数学使用了 $$；行内公式请用单 $...$`);
        }
        if (raw.includes("\n")) {
          addError(line, column, RENDERER.MARKDOWN, formula, `行内公式跨多行（可能是单 $ 独占行的 display math 写法）；请用 $$...$$`);
        }
        if (content.includes("`")) {
          addError(line, column, RENDERER.MARKDOWN, formula, `$ 边界穿越了 inline code（未闭合 $ 或 shell 变量误入数学）；shell 变量请用 \`$HOME\` 包裹`);
        }
        if (content.trimEnd().endsWith("\\")) {
          addError(line, column, RENDERER.MARKDOWN, formula, `行内公式以反斜杠结尾：闭合的 $ 被转义（\\$），公式边界被破坏（常见于 $HOME 与 \\$10 同行）；shell 变量请用 \`$NAME\` 包裹，货币请写 \\$10`);
        }
        if (content.trim() === "") {
          stats.emptyMath++;
          addError(line, column, RENDERER.MARKDOWN, formula, "空行内公式 $…$");
        } else if (content.includes("$$")) {
          addError(line, column, RENDERER.MARKDOWN, formula, "行内公式内容含 $$");
        } else if (content.startsWith("$") || content.endsWith("$")) {
          addError(line, column, RENDERER.MARKDOWN, formula, "行内公式内容以 $ 开头/结尾（嵌套分隔符）");
        } else if (/^[A-Z_][A-Z0-9_]{1,}$/.test(content.trim()) && !/\d/.test(content.trim())) {
          addWarning(line, column, RENDERER.MARKDOWN, formula, "行内公式内容疑似 shell 变量（如 $HOME）；shell 变量请写成 `$HOME` 或转义 \\$");
        }
        if (content.trim() !== "") {
          for (const p of lintLatex(content)) addIssue(p.warning ? "warning" : "error", line, column, p.renderer, formula, p.error);
          checkEngines(line, column, content, false, formula);
        }
        masks.push([node.position.start.offset, node.position.end.offset]);
        break;
      }
      case "math": {
        stats.displayMath++;
        const line = node.position.start.line;
        const column = node.position.start.column;
        const content = node.value ?? "";
        const raw = sliceAt(node);
        const formula = content.length > 60 ? content.slice(0, 60) + "…" : content;
        const inTable = ancestors.some((a) => a.type === "tableCell");
        const inList = ancestors.some((a) => a.type === "listItem");
        const inQuote = ancestors.some((a) => a.type === "blockquote");
        const rawTrimmed = raw.trimEnd();

        if (!rawTrimmed.endsWith("$$")) {
          addError(line, column, RENDERER.MARKDOWN, formula, `未闭合的 $$ 分隔符（display math 必须以 $$ 结束）`);
        }
        if (target === "github") {
          stats.displayDollarBlocks++;
          addError(line, column, RENDERER.GITHUB, formula,
            `GitHub-safe 模式禁止 $$...$$ 块；独立公式必须用 math fence（\`\`\`math ... \`\`\`）`);
        }
        if (inTable) {
          addError(line, column, RENDERER.GITHUB, formula, `表格 cell 内禁止块级 $$...$$；请移到表格下方单独展示`);
        }
        if (inList || inQuote) {
          const sev = target === "github" ? "error" : "warning";
          addIssue(sev, line, column, RENDERER.GITHUB, formula,
            `display math 位于 ${inList ? "列表项" : "blockquote 引用块"}内，GitHub 无法可靠渲染（block boundary 冲突）；请移出到正文独立段落`);
        }
        if (content.trim() === "") {
          stats.emptyMath++;
          addError(line, column, RENDERER.MARKDOWN, formula, "空 display math $$…$$");
        } else if (content.includes("$$")) {
          addError(line, column, RENDERER.MARKDOWN, formula, "display math 内容含 $$（嵌套分隔符）");
        }
        if (content.trimEnd().endsWith("\\")) {
          addError(line, column, RENDERER.LATEX, formula, "display math 以孤立反斜杠结尾（\\\\ 换行符丢失了一个反斜杠）");
        }
        if (content.trim() !== "") {
          if (target === "github") {
            if (/\\tag(?![a-zA-Z])/.test(content)) {
              stats.tagsFound++;
              addError(line, column, RENDERER.GITHUB, formula,
                `GitHub-safe 模式禁止 \\tag{...}（公式编号移到 Markdown 正文，如 **式 (2.1)**）`);
            }
            const banned = content.match(/\\begin\{(aligned|align|align\*|equation|equation\*|gather|gather\*|split)\}/g) ?? [];
            if (banned.length > 0) {
              for (const b of banned) {
                if (b.includes("aligned") || b.includes("split") || b.includes("gather")) stats.alignedEnvs++;
                else stats.eqEnvs++;
                addError(line, column, RENDERER.GITHUB, formula,
                  `GitHub-safe 模式默认禁止 ${b}；长推导拆成多个简单 math fence，一个逻辑等式一个块`);
              }
            }
            if (/\\boldsymbol(?![a-zA-Z])/.test(content)) {
              stats.boldsymbolWarnings++;
              addWarning(line, column, RENDERER.GITHUB, formula,
                `GitHub-safe 模式建议用 \\mathbf 代替 \\boldsymbol（更保守、跨渲染器稳定；物理含义等价）`);
            }
            if (content.length > 400) {
              stats.complexWarnings++;
              addWarning(line, column, RENDERER.GITHUB, formula, `单公式过长（${content.length} 字符 > 400）；建议拆分为多个公式`);
            }
            if (maxBraceDepthOf(content) > 5) {
              stats.complexWarnings++;
              addWarning(line, column, RENDERER.GITHUB, formula, `花括号嵌套深度 > 5；建议拆分为多个公式`);
            }
          }
          for (const p of lintLatex(content)) addIssue(p.warning ? "warning" : "error", line, column, p.renderer, formula, p.error);
          checkEngines(line, column, content, true, formula);
        }
        masks.push([node.position.start.offset, node.position.end.offset]);

        /* GitHub 结构：上文未空行分隔 / 块内空行 */
        const lines = src.split("\n");
        const prev = lines[line - 2];
        if (line >= 2 && prev !== undefined && prev.trim() !== "" && !/^#{1,6}\s/.test(prev)) {
          addWarning(line, column, RENDERER.GITHUB, formula, "display math 与上文未用空行分隔（block boundary 建议空行）");
        }
        for (let i = line; i < node.position.end.line - 1; i++) {
          if (lines[i - 1]?.trim() === "") {
            addWarning(line, column, RENDERER.GITHUB, formula, "display math 内部含空行（部分渲染器会截断公式）");
            break;
          }
        }
        break;
      }
      case "table":
        stats.tables++;
        break;
      default:
        break;
    }
    if (node.children) {
      ancestors.push(node);
      for (const child of node.children) walk(child);
      ancestors.pop();
    }
  })(tree);

  /* ---------- 原始扫描（掩码排除 code / inline code / math 节点） ---------- */
  masks.sort((a, b) => a[0] - b[0]);
  let maskIdx = 0;
  let i = 0;
  const reportAt = (offset, renderer, error, sev = "error") => {
    addIssue(sev, lineOf(offset), colOf(offset), renderer,
      (src.split("\n")[lineOf(offset) - 1] ?? "").trim().slice(0, 60), error);
  };

  while (i < src.length) {
    while (maskIdx < masks.length && masks[maskIdx][1] <= i) maskIdx++;
    if (maskIdx < masks.length && masks[maskIdx][0] <= i) {
      i = masks[maskIdx][1];
      continue;
    }
    const ch = src[i];
    if (ch === "$") {
      let bs = 0;
      for (let j = i - 1; j >= 0 && src[j] === "\\"; j--) bs++;
      if (bs % 2 === 1) { i++; continue; }
      let run = 1;
      while (i + run < src.length && src[i + run] === "$") run++;
      const rest = src.slice(i + run);
      if (run >= 2) {
        reportAt(i, RENDERER.MARKDOWN, "未闭合的 $$ 分隔符（display math 必须以 $$ 成对闭合）");
      } else if (looksLikeShellVar(src, i)) {
        /* $HOME 等 shell 变量：不算数学，放行 */
      } else if (/^\d/.test(rest)) {
        reportAt(i, RENDERER.MARKDOWN, "未转义的货币/数字 $（如 $10）；货币请写成 \\$10");
      } else {
        reportAt(i, RENDERER.MARKDOWN, "未闭合的 $ 数学分隔符（或文本中的 $ 变量未转义）；数学请闭合 $…$，shell 变量请写成 `$NAME`");
      }
      i += run;
      continue;
    }
    if (ch === "\\") {
      const next = src[i + 1];
      if (next === "(" || next === ")" || next === "[" || next === "]") {
        const sev = target === "github" ? "error" : "warning";
        reportAt(i, RENDERER.GITHUB, `非默认分隔符 \\${next}：GitHub/MPE/Obsidian 均不渲染 \\(...\\) / \\[...\\]；请使用 $...$（行内）或 $$...$$（独立公式）`, sev);
        i += 2;
        continue;
      }
      if (next && /[a-zA-Z]/.test(next)) {
        const m = /^[a-zA-Z]+/.exec(src.slice(i + 1));
        if (m && LATEX_COMMANDS.has(m[0])) {
          reportAt(i, RENDERER.MARKDOWN, `普通文本中出现了 LaTeX 命令 \\${m[0]}（缺少数学分隔符 $...$ ？）`, "warning");
          i += 1 + m[0].length;
          continue;
        }
      }
    }
    i++;
  }

  /* ---------- 全文档 KaTeX 渲染测试 ---------- */
  if (useKatex && stats.displayMath + stats.inlineMath > 0) {
    try {
      await unified()
        .use(remarkParse)
        .use(remarkGfm)
        .use(remarkMath)
        .use(remarkRehype)
        .use(rehypeKatex, { throwOnError: true, strict: "ignore" })
        .use(rehypeStringify)
        .process(src);
      stats.katexRenderTest = "ok";
    } catch (e) {
      stats.katexRenderTest = "failed";
      addError(1, 1, RENDERER.KATEX, "", `整篇文档 KaTeX 渲染失败: ${e.message}`);
    }
  } else if (!useKatex) {
    stats.katexRenderTest = "skipped";
  } else {
    stats.katexRenderTest = "ok";
  }

  const ok = errors.length === 0;
  return { ok, errors, warnings, stats };
}

/* ------------------------------------------------------------------ */
/* CLI                                                                 */
/* ------------------------------------------------------------------ */
function usage() {
  return "用法: node validate_math.mjs [--json] [--no-katex] [--no-mathjax] [--target github|mpe|generic] <file.md> [...]";
}

function printIssue(it) {
  console.log([
    `File: ${it.file}`,
    `Line: ${it.line}`,
    `Column: ${it.column}`,
    `Renderer: ${it.renderer}`,
    `Formula: ${it.formula || "(none)"}`,
    `Error: ${it.error}`,
  ].join("\n"));
}

export async function main(argv) {
  const flags = { json: false, useKatex: katex !== null, useMathjax: mjConvert !== null, target: "github" };
  const files = [];
  let expectTarget = false;
  for (const a of argv) {
    if (a === "--json") flags.json = true;
    else if (a === "--no-katex") flags.useKatex = false;
    else if (a === "--no-mathjax") flags.useMathjax = false;
    else if (a === "--target") expectTarget = true;
    else if (expectTarget) { flags.target = a; expectTarget = false; }
    else if (a === "github" || a === "mpe") flags.target = a;
    else if (a === "--help" || a === "-h") { console.log(usage()); return 0; }
    else files.push(a);
  }
  if (files.length === 0) {
    console.error(usage());
    return 2;
  }
  const all = [];
  for (const f of files) {
    let src;
    try {
      src = await readFile(f, "utf8");
    } catch (e) {
      console.error(`[error] 无法读取 ${f}: ${e.message}`);
      return 2;
    }
    all.push(await validateSource(src, { filename: f, useKatex: flags.useKatex, useMathjax: flags.useMathjax, target: flags.target }));
  }

  if (flags.json) {
    console.log(JSON.stringify(all, null, 2));
    return all.every((r) => r.ok) ? 0 : 1;
  }

  let printed = 0;
  for (const r of all) {
    for (const it of r.errors) { printIssue(it); console.log(""); printed++; }
  }
  if (printed === 0) {
    for (const r of all) {
      for (const it of r.warnings) { printIssue(it); console.log(""); }
    }
  }

  const totalErrors = all.reduce((n, r) => n + r.errors.length, 0);
  const totalWarnings = all.reduce((n, r) => n + r.warnings.length, 0);
  if (totalErrors === 0) {
    const statsLine = all.map((r) =>
      `target=${r.stats.target} inline=${r.stats.inlineMath} display=${r.stats.displayMath} ` +
      `katex=${r.stats.katexChecked} mathjax=${r.stats.mathjaxChecked} ` +
      `katexRender=${r.stats.katexRenderTest} fences=${r.stats.mathFences} ` +
      `tags=${r.stats.tagsFound} dollarBlocks=${r.stats.displayDollarBlocks} aligned=${r.stats.alignedEnvs} eqEnv=${r.stats.eqEnvs} ` +
      `unclosedFence=${r.stats.unclosedMathFences} fenceWithMath=${r.stats.normalFenceWithMath}`
    ).join("; ");
    if (flags.target === "github") {
      console.log(`GITHUB-SAFE STRUCTURE: PASS  (${statsLine}; warnings=${totalWarnings})`);
    } else {
      console.log(`PASS  (${statsLine}; warnings=${totalWarnings})`);
    }
    return 0;
  }
  console.log(`FAIL  (${totalErrors} errors, ${totalWarnings} warnings)`);
  return 1;
}

if (process.argv[1] && process.argv[1].endsWith("validate_math.mjs")) {
  process.exit(await main(process.argv.slice(2)));
}
