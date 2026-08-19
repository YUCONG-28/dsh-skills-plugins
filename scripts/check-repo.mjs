#!/usr/bin/env node
/**
 * check-repo.mjs —— 仓库级一致性校验（CI repository job）
 *
 * 校验项：
 *   1. versions.lock.json 可解析，ownPlugins 与插件 package.json 版本一致
 *   2. 每个插件的 dsh.bundle.patch 存在且 insert id 非空
 *   3. 禁止 node_modules 补丁：'[vision-bridge:relaxed]' 只能出现在
 *      plugins/dsh-vision-bridge/bin/apply-vision-patch.sh（该脚本自身）
 *   4. 根文档不得要求运行已废弃补丁：README / SUMMARY / docs 关键文档
 *      不得包含 'apply-vision-patch'
 *   5. 全部 shell 脚本可被 bash -n 解析（交给 self-test.sh，此处跳过）
 *
 * 用法：node scripts/check-repo.mjs [--repo <path>] [--json]
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO = resolve(HERE, '..');

function parseArgs(argv) {
  const args = { repo: DEFAULT_REPO, json: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--repo') args.repo = resolve(argv[++i] ?? '');
    else if (argv[i] === '--json') args.json = true;
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const repo = args.repo;
const problems = [];
const ok = [];

function readJson(p) { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } }
function read(p) { try { return readFileSync(p, 'utf8'); } catch { return null; } }

// 1. versions.lock ownPlugins
const lock = readJson(join(repo, 'versions.lock.json'));
if (!lock?.ownPlugins) {
  problems.push('versions.lock.json 缺失或 ownPlugins 字段无效');
} else {
  const map = {
    'dsh-computer-use': 'plugins/dsh-computer-use/package.json',
    'dsh-vision-bridge': 'plugins/dsh-vision-bridge/package.json',
    'dsh-web-pets': 'plugins/dsh-web-pets/package.json',
    'dsh-desktop-pets': 'projects/desktop-pets/integration/dsh-plugin/package.json',
  };
  for (const [name, rel] of Object.entries(map)) {
    const pkg = readJson(join(repo, rel));
    if (!pkg?.version) { problems.push(`${name}: 找不到 package.json`); continue; }
    if (pkg.version !== lock.ownPlugins[name]) {
      problems.push(`versions.lock ownPlugins ${name}: lock=${lock.ownPlugins[name]} pkg=${pkg.version}`);
    } else {
      ok.push(`versions.lock ownPlugins ${name} ${pkg.version}`);
    }
  }
}

// 2. cordis manifest validation
const pluginDirs = readdirSync(join(repo, 'plugins')).filter(d => {
  try { return statSync(join(repo, 'plugins', d)).isDirectory(); } catch { return false; }
});
for (const dir of pluginDirs) {
  const pkg = readJson(join(repo, 'plugins', dir, 'package.json'));
  if (!pkg) continue;
  const patchRel = pkg?.dsh?.bundle?.patch;
  if (!patchRel) { ok.push(`${dir}: 无 dsh.bundle.patch（跳过）`); continue; }
  const patchPath = join(repo, 'plugins', dir, patchRel);
  const patch = read(patchPath);
  if (patch === null) { problems.push(`${dir}: dsh.bundle.patch 不存在 ${patchRel}`); continue; }
  if (!/^\s*-\s*insert:/m.test(patch)) { ok.push(`${dir}: patch 无 insert 列表（合法，仅 config 覆盖）`); continue; }
  const ids = [...patch.matchAll(/^\s*-\s+id:\s*([\w.-]+)/gm)].map(m => m[1]);
  if (ids.length === 0) {
    problems.push(`${dir}: patch 含 insert 但未解析到 id 行（${patchRel}）`);
  } else {
    ok.push(`${dir}: cordis patch 解析到 ${ids.length} 个 insert id（${ids.join(', ')}）`);
  }
}

// 3. forbidden node_modules patch detection
const MARKER = '[vision-bridge:relaxed]';
const ALLOWED_PATCH_FILE = join(repo, 'plugins/dsh-vision-bridge/bin/apply-vision-patch.sh');
function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.git' || entry === '.pnpm-store' ||
        entry === '.dsh-test' || entry === '.dsh-canary' || entry === '.test-tmp' ||
        entry === '.backup-web-profile-' || entry.startsWith('_')) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/.(js|mjs|ts|sh|md|json|yml|yaml|py)$/.test(entry)) out.push(full);
  }
  return out;
}
let markerHits = 0;
try {
  for (const f of walk(repo)) {
    if (f === ALLOWED_PATCH_FILE || f === join(repo, 'scripts', 'check-repo.mjs')) continue;
    const text = read(f);
    if (text && text.includes(MARKER)) {
      problems.push(`禁止的 node_modules 补丁标记出现在非废弃脚本文件: ${f.replace(repo + '/', '')}`);
      markerHits++;
    }
  }
} catch (e) {
  problems.push('扫描仓库失败: ' + e.message);
}
if (markerHits === 0) ok.push('无 node_modules 补丁标记（[vision-bridge:relaxed] 仅存在于废弃脚本自身）');

// 4. 根文档不得要求运行已废弃补丁
const docFiles = [
  'README.md', 'SUMMARY.md',
  'docs/COMPATIBILITY.md', 'docs/UPGRADE_RUNBOOK.md', 'docs/UPGRADE_CHECKLIST.md',
];
for (const rel of docFiles) {
  const text = read(join(repo, rel)) ?? '';
  if (text.includes('apply-vision-patch')) {
    problems.push(`根文档仍引用已废弃补丁: ${rel}（应只说明“不再需要”）`);
  } else {
    ok.push(`${rel}: 无 apply-vision-patch 引用`);
  }
}

if (args.json) {
  console.log(JSON.stringify({ ok: problems.length === 0, problems, checks: ok }, null, 2));
} else {
  for (const line of ok) console.log('  OK    ' + line);
  for (const line of problems) console.log('  FAIL  ' + line);
}
if (problems.length) {
  console.error(`\ncheck-repo: ${problems.length} 个问题`);
  process.exit(1);
}
console.log('\ncheck-repo: PASS');