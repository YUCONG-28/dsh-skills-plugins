#!/usr/bin/env node
/**
 * check-versions.mjs — versions.lock.json 一致性校验（仓库侧 + 可选 profile 侧）
 *
 * 仓库侧（CI 必跑）：
 *   - versions.lock.json 可解析且结构完整；
 *   - ownPlugins 与各插件 package.json 版本一致（防止再次出现
 *     dsh-vision-bridge 0.1.0 vs 实际 0.3.3 之类的漂移）。
 *
 * profile 侧（本地 / dsh-safe-upgrade.sh preflight，--profile 指定）：
 *   - verified 第三方版本 vs ~/.dsh/profiles/<name>/node_modules/<pkg>/package.json；
 *   - dshCore vs 当前 dsh --version。
 *
 * 用法：
 *   node scripts/check-versions.mjs [--repo <path>] [--profile <dir>] [--json]
 *
 * 退出码：0=一致；1=存在漂移；2=参数/结构错误。
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO = resolve(HERE, '..');

function parseArgs(argv) {
  const args = { repo: DEFAULT_REPO, profile: null, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--repo') args.repo = resolve(argv[++i] ?? '');
    else if (a === '--profile') args.profile = resolve(argv[++i] ?? '');
    else if (a === '--json') args.json = true;
    else if (a === '--help' || a === '-h') {
      console.log('usage: node scripts/check-versions.mjs [--repo <path>] [--profile <dir>] [--json]');
      process.exit(0);
    }
  }
  return args;
}

/** 插件名 → 仓库内 package.json 相对路径（ownPlugins 专用映射）。 */
function ownPluginPkgPath(name) {
  return name === 'dsh-desktop-pets'
    ? 'projects/desktop-pets/integration/dsh-plugin/package.json'
    : join('plugins', name, 'package.json');
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    return null;
  }
}

/** 尝试在 profile node_modules 下定位包（含 .pnpm 兜底）。 */
function resolveInstalledVersion(profileDir, pkg) {
  const direct = join(profileDir, 'node_modules', ...pkg.split('/'));
  const p = readJson(join(direct, 'package.json'));
  if (p?.version) return p.version;
  // pnpm 布局兜底：.pnpm/<name>@<version>/node_modules/<name>/package.json
  const pnpmDir = join(profileDir, 'node_modules', '.pnpm');
  if (existsSync(pnpmDir)) {
    const base = pkg.split('/').pop();
    try {
      for (const entry of readdirSync(pnpmDir)) {
        if (entry.startsWith(base + '@')) {
          const v = readJson(join(pnpmDir, entry, 'node_modules', ...pkg.split('/'), 'package.json'));
          if (v?.version) return v.version;
        }
      }
    } catch { /* ignore */ }
  }
  return null;
}

const args = parseArgs(process.argv.slice(2));
const lockPath = join(args.repo, 'versions.lock.json');
const lock = readJson(lockPath);
const problems = [];
const ok = [];

if (!lock) {
  console.error(`错误: 无法解析 versions.lock.json（${lockPath}）`);
  process.exit(2);
}
for (const key of ['updatedAt', 'profile', 'verified', 'ownPlugins']) {
  if (!(key in lock)) {
    console.error(`错误: versions.lock.json 缺少字段 ${key}`);
    process.exit(2);
  }
}
if (typeof lock.ownPlugins !== 'object' || Array.isArray(lock.ownPlugins)) {
  console.error('错误: versions.lock.json ownPlugins 必须是对象');
  process.exit(2);
}

// ---- 仓库侧：ownPlugins ----
for (const [name, expected] of Object.entries(lock.ownPlugins)) {
  const pkg = readJson(join(args.repo, ownPluginPkgPath(name)));
  if (!pkg) {
    problems.push(`ownPlugins ${name}: 找不到 package.json（${ownPluginPkgPath(name)}）`);
    continue;
  }
  if (pkg.version !== expected) {
    problems.push(`ownPlugins ${name}: lock=${expected} actual=${pkg.version}`);
  } else {
    ok.push(`ownPlugins ${name} ${expected} OK`);
  }
}

// ---- profile 侧：verified 第三方 + dshCore ----
if (args.profile) {
  if (!existsSync(join(args.profile, 'package.json'))) {
    console.error(`错误: profile 目录不存在或缺少 package.json（${args.profile}）`);
    process.exit(2);
  }
  const { execFileSync } = await import('node:child_process');
  for (const [pkg, expected] of Object.entries(lock.verified)) {
    const actual = resolveInstalledVersion(args.profile, pkg);
    if (actual === null) {
      problems.push(`verified ${pkg}: profile 中未找到安装副本`);
    } else if (actual !== expected) {
      problems.push(`verified ${pkg}: lock=${expected} installed=${actual}`);
    } else {
      ok.push(`verified ${pkg} ${expected} OK`);
    }
  }
  if (lock.dshCore) {
    let actual = null;
    try {
      actual = execFileSync('dsh', ['--version'], { encoding: 'utf8' }).trim();
    } catch { /* dsh 不可用 */ }
    if (actual !== lock.dshCore) {
      problems.push(`dshCore: lock=${lock.dshCore} dsh=${actual ?? '(dsh 不可用)'}`);
    } else {
      ok.push(`dshCore ${actual} OK`);
    }
  }
}

if (args.json) {
  console.log(JSON.stringify({ ok: problems.length === 0, problems, checks: ok }, null, 2));
} else {
  for (const line of ok) console.log('  OK   ' + line);
  for (const line of problems) console.log('  DRIFT ' + line);
}

if (problems.length > 0) {
  console.error(`\nversions.lock.json 存在 ${problems.length} 处漂移；如需同步可运行 scripts/update-versions-lock.mjs`);
  process.exit(1);
}
console.log('\ncheck-versions: PASS（versions.lock.json 与仓库/profile 一致）');