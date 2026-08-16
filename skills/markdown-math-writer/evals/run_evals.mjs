#!/usr/bin/env node
/**
 * run_evals.mjs — markdown-math-writer 测试集运行器
 *
 * 用法：
 *   node run_evals.mjs [--json] [evals.json]
 *
 * 对 evals.json 中每个用例运行 validate_math.mjs 的核心校验：
 *   expect: "pass" → 校验器必须无 error
 *   expect: "fail" → 校验器必须至少报 1 个 error
 * 全部符合则输出 PASS 并 exit 0；否则输出 FAIL 并 exit 1。
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { validateSource } from "../scripts/validate_math.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const json = args.includes("--json");
const evalsPath = args.filter((a) => !a.startsWith("--"))[0] ?? join(here, "evals.json");

let cases;
try {
  cases = JSON.parse(await readFile(evalsPath, "utf8"));
} catch (e) {
  console.error(`无法读取测试集 ${evalsPath}: ${e.message}`);
  process.exit(2);
}
if (!Array.isArray(cases)) {
  console.error("evals.json 必须是一个数组");
  process.exit(2);
}

const results = [];
for (const c of cases) {
  let markdown = c.markdown;
  if (c.file !== undefined) {
    try {
      markdown = await readFile(join(here, c.file), "utf8");
    } catch (e) {
      console.error(`无法读取用例文件 ${c.file}: ${e.message}`);
      process.exit(2);
    }
  }
  if (typeof markdown !== "string") {
    console.error(`用例 ${c.id} 缺少 markdown 或 file 字段`);
    process.exit(2);
  }
  const target = c.target ?? "github";
  const r = await validateSource(markdown, { filename: c.id ?? c.name, useKatex: true, useMathjax: true, target });
  const gotPass = r.errors.length === 0;
  const expectedPass = c.expect === "pass";
  /* GitHub-safe 硬性计数断言（对应目标为 github 且含数学时） */
  const hardCountsOk =
    !expectedPass ||
    target !== "github" ||
    r.stats.inlineMath + r.stats.displayMath + r.stats.mathFences === 0 ||
    (r.stats.tagsFound === 0 && r.stats.displayDollarBlocks === 0 && r.stats.alignedEnvs === 0 &&
     r.stats.eqEnvs === 0 && r.stats.unclosedMathFences === 0 && r.stats.normalFenceWithMath === 0);
  const mathjaxSanity =
    r.stats.inlineMath + r.stats.displayMath + r.stats.mathFences > 0
      ? r.stats.mathjaxChecked > 0 || r.stats.mathjaxErrors > 0 || r.stats.emptyMath === r.stats.inlineMath + r.stats.displayMath + r.stats.mathFences
      : true;
  const ok = gotPass === expectedPass && mathjaxSanity && hardCountsOk;
  results.push({
    id: c.id,
    name: c.name,
    expect: c.expect,
    ok,
    errors: r.errors.map((e) => `${e.line}: ${e.error}`),
    warnings: r.warnings.map((e) => `${e.line}: ${e.error}`),
  });
}

if (json) {
  console.log(JSON.stringify({ evals: results, pass: results.every((r) => r.ok) }, null, 2));
  process.exit(results.every((r) => r.ok) ? 0 : 1);
}

let failed = 0;
for (const r of results) {
  const mark = r.ok ? "PASS" : "FAIL";
  if (!r.ok) failed++;
  console.log(`[${mark}] ${r.id ?? "?"} — ${r.name} (expect ${r.expect})`);
  for (const e of r.errors) console.log(`        error: ${e}`);
  for (const w of r.warnings) console.log(`        warning: ${w}`);
}
const total = results.length;
console.log(`\n${total - failed}/${total} evals passed`);
if (failed > 0) {
  console.log(`FAIL  (${failed} failed)`);
  process.exit(1);
}
console.log("PASS");
process.exit(0);
