#!/usr/bin/env node
/**
 * render_html.mjs v2 — 实际 HTML 渲染测试（markdown-math-writer Skill）
 *
 * 支持真实执行两个渲染器并生成 HTML：
 *   --renderer katex     remark-math → remark-rehype → rehype-katex（与 MPE/KaTeX 一致）
 *   --renderer mathjax   mathjax-full tex2svg，逐公式生成 SVG（与 MathJax 一致）
 *   --renderer both      默认：两者都渲染
 *
 * 后置检查（任一失败 exit 1）：
 *   - 渲染器 parse error 文本（katex-error / MathJax error）
 *   - 输出 HTML 中残留 raw $$ / raw LaTeX（$$、\frac{ 等明文泄漏）
 *   - 公式节点数：katex span / mathjax svg 数量与输入 AST 公式数一致
 *
 * 用法：
 *   node render_html.mjs [--renderer katex|mathjax|both] <file.md>
 *   node render_html.mjs --renderer both README.md > out.html
 */

import { readFile } from "node:fs/promises";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkRehype from "remark-rehype";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import rehypeStringify from "rehype-stringify";

/* ---------- MathJax（mathjax-full，Node 官方 API） ---------- */
let mjConvert = null;
try {
  const { mathjax } = await import("mathjax-full/js/mathjax.js");
  const { TeX } = await import("mathjax-full/js/input/tex.js");
  const { SVG } = await import("mathjax-full/js/output/svg.js");
  const { liteAdaptor } = await import("mathjax-full/js/adaptors/liteAdaptor.js");
  const { RegisterHTMLHandler } = await import("mathjax-full/js/handlers/html.js");
  const { AllPackages } = await import("mathjax-full/js/input/tex/AllPackages.js");
  const adaptor = liteAdaptor();
  RegisterHTMLHandler(adaptor);
  const html = mathjax.document("", {
    InputJax: new TeX({ packages: AllPackages }),
    OutputJax: new SVG({ fontCache: "local" }),
  });
  mjConvert = (formula, display) => adaptor.outerHTML(html.convert(formula, { display }));
} catch {
  mjConvert = null;
}

const args = process.argv.slice(2);
let renderer = "both";
const files = [];
for (const a of args) {
  if (a === "--renderer") { /* next arg */ }
  else if (a === "katex" || a === "mathjax" || a === "both") renderer = a;
  else if (a === "--help" || a === "-h") {
    console.log("用法: node render_html.mjs [--renderer katex|mathjax|both] <file.md>");
    process.exit(0);
  } else files.push(a);
}
if (files.length === 0) {
  console.error("用法: node render_html.mjs [--renderer katex|mathjax|both] <file.md>");
  process.exit(2);
}

const src = await readFile(files[0], "utf8");
let failures = 0;

/* math fence（```math/```latex/```tex）→ math 节点，使两个渲染器都实际渲染它们 */
const fenceToMath = () => (tree) => {
  (function walk(n) {
    if (n.type === "code" && ["math", "latex", "tex"].includes((n.lang ?? "").toLowerCase())) {
      n.type = "math";
      n.value = n.value ?? "";
      // 与 remark-math 对 $$ 块的标记一致，rehype-katex 才会渲染
      n.data = { hName: "code", hProperties: { className: ["language-math", "math-display"] } };
      delete n.lang;
    }
    for (const c of n.children ?? []) walk(c);
  })(tree);
};

/* ---------- 统计输入中的公式节点数 ---------- */
const tree0 = unified().use(remarkParse).use(remarkGfm).use(remarkMath).parse(src);
let mathCount = 0, inlineCount = 0, displayCount = 0;
(function walk(n) {
  if (n.type === "inlineMath") { mathCount++; inlineCount++; }
  else if (n.type === "math" || (n.type === "code" && ["math", "latex", "tex"].includes((n.lang ?? "").toLowerCase()))) { mathCount++; displayCount++; }
  for (const c of n.children ?? []) walk(c);
})(tree0);

const out = [`<!-- render_html.mjs renderer=${renderer} -->`];

/* ---------- KaTeX 渲染 ---------- */
if (renderer === "both" || renderer === "katex") {
  const file = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath)
    .use(fenceToMath)
    .use(remarkRehype)
    .use(rehypeKatex, { throwOnError: true, strict: "ignore" })
    .use(rehypeStringify)
    .process(src);
  const html = file.toString();
  const spans = (html.match(/class="katex"/g) ?? []).length;
  const displays = (html.match(/class="katex-display"/g) ?? []).length;
  const errors = (html.match(/katex-error/g) ?? []).length;
  const rawDd = (html.match(/\$\$/g) ?? []).length;
  // 排除 <annotation>（KaTeX 的 MathML 原文标注，正常存在）后的 raw LaTeX 泄漏检查
  const noAnnotation = html.replace(/<annotation[^>]*>[\s\S]*?<\/annotation>/g, "");
  const rawFrac = (noAnnotation.match(/\\frac\{/g) ?? []).length;
  const rawCmd = (noAnnotation.match(/\\(begin|end|mathbf|boldsymbol)\{/g) ?? []).length;
  console.log(`[katex]   spans=${spans} (inline+display), katex-display=${displays}, input formulas=${mathCount}`);
  console.log(`[katex]   katex-error elements=${errors}, raw \$\$ in html=${rawDd}, raw \\frac in html=${rawFrac}`);
  if (errors > 0 || rawDd > 0 || rawFrac > 0 || rawCmd > 0) {
    console.error("[katex] FAIL: 渲染错误或 raw LaTeX 泄漏");
    failures++;
  } else {
    console.log("[katex] OK");
  }
  out.push("<!-- ===== KATEX RENDER ===== -->", html);
}

/* ---------- MathJax 渲染 ---------- */
if (renderer === "both" || renderer === "mathjax") {
  if (!mjConvert) {
    console.error("[mathjax] FAIL: mathjax-full 不可用");
    failures++;
  } else {
    /* 逐公式转换为 SVG，注入 raw 节点 → rehype-raw → HTML */
    const seen = { inline: 0, display: 0, errors: 0 };
    const inject = () => (tree) => {
      (function walk(n) {
        if (n.type === "inlineMath" || n.type === "math") {
          const display = n.type === "math";
          try {
            const svg = mjConvert(n.value, display);
            seen[display ? "display" : "inline"]++;
            n.type = "raw";
            n.value = `<span class="mathjax${display ? " mathjax-display" : ""}">${svg}</span>`;
            delete n.children;
            delete n.data; // 清除 remark-math 的 hName/hProperties，避免被当作 code 渲染
          } catch (e) {
            seen.errors++;
            n.type = "raw";
            n.value = `<span class="mathjax-error">MathJax error: ${e.message}</span>`;
            delete n.children;
            delete n.data;
          }
        }
        for (const c of n.children ?? []) walk(c);
      })(tree);
    };
    const file = await unified()
      .use(remarkParse)
      .use(remarkGfm)
      .use(remarkMath)
      .use(fenceToMath)
      .use(inject)
      .use(remarkRehype)
      .use(rehypeRaw)
      .use(rehypeStringify)
      .process(src);
    const html = file.toString();
    const svgs = (html.match(/class="mathjax(?:\s|")/g) ?? []).length;
    const errEls = (html.match(/mathjax-error/g) ?? []).length;
    const rawDd = (html.match(/\$\$/g) ?? []).length;
    const noAnnotation = html.replace(/<annotation[^>]*>[\s\S]*?<\/annotation>/g, "");
    const rawFrac = (noAnnotation.match(/\\frac\{/g) ?? []).length;
    const rawCmd = (noAnnotation.match(/\\(begin|end|mathbf|boldsymbol)\{/g) ?? []).length;
    console.log(`[mathjax] svg spans=${svgs} (expected ${mathCount}), converted inline=${seen.inline} display=${seen.display} errors=${seen.errors}`);
    console.log(`[mathjax] error elements=${errEls}, raw \$\$ in html=${rawDd}, raw \\frac in html=${rawFrac}`);
    if (errEls > 0 || seen.errors > 0 || svgs !== mathCount || rawDd > 0 || rawFrac > 0 || rawCmd > 0) {
      console.error("[mathjax] FAIL: 渲染错误或公式缺失或 raw LaTeX 泄漏");
      failures++;
    } else {
      console.log("[mathjax] OK");
    }
    out.push("<!-- ===== MATHJAX RENDER ===== -->", html);
  }
}

console.log(out.join("\n").slice(0, 500) + (out.join("\n").length > 500 ? "\n...[HTML 截断，完整输出见 stdout 文件]" : ""));
process.exit(failures > 0 ? 1 : 0);
