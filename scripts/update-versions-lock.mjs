#!/usr/bin/env node
/**
 * update-versions-lock.mjs — 从仓库插件 + profile node_modules 重写 versions.lock.json
 *
 * - ownPlugins：始终从仓库各插件 package.json 更新（需要 --repo）；
 * - verified：需要 --profile <dir>，按现有 key 集合从 profile node_modules 刷新版本；
 * - dshCore：需要 dsh 可执行（dsh --version）。
 * 保留字段：profile / note / removedSincePrevious；updatedAt 更新为今天。
 *
 * 用法：node scripts/update-versions-lock.mjs [--repo <path>] [--profile <dir>] [--write]
 * 默认 --dry-run 只打印将写入的内容；--write 才落盘。
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO = resolve(HERE, '..');

function parseArgs(argv) {
  const args = { repo: DEFAULT_REPO, profile: null, write: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--repo') args.repo = resolve(argv[++i] ?? '');
    else if (a === '--profile') args.profile = resolve(argv[++i] ?? '');
    else if (a === '--write') args.write = true;
    else if (a === '-h' || a === '--help') {
      console.log('usage: node scripts/update-versions-lock.mjs [--repo <path>] [--profile <dir>] [--write]');
      process.exit(0);
    }
  }
  return args;
}

function ownPluginPkgPath(name) {
  return name === 'dsh-desktop-pets'
    ? 'projects/desktop-pets/integration/dsh-plugin/package.json'
    : join('plugins', name, 'package.json');
}

function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

function installedVersion(profileDir, pkg) {
  const direct = readJson(join(profileDir, 'node_modules', ...pkg.split('/'), 'package.json'));
  if (direct?.version) return direct.version;
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
const old = readJson(lockPath) ?? {};
const next = { ...old };

// ownPlugins（始终）
const ownPlugins = {};
for (const name of Object.keys(old.ownPlugins ?? {})) {
  const pkg = readJson(join(args.repo, ownPluginPkgPath(name)));
  if (pkg?.version) ownPlugins[name] = pkg.version;
  else console.warn(`警告: 找不到插件 package.json: ${name}`);
}
next.ownPlugins = ownPlugins;

// verified（需 profile）
if (args.profile) {
  if (!existsSync(join(args.profile, 'package.json'))) {
    console.error(`错误: profile 目录无效: ${args.profile}`);
    process.exit(2);
  }
  const verified = {};
  for (const [pkg, _v] of Object.entries(old.verified ?? {})) {
    const actual = installedVersion(args.profile, pkg);
    if (actual === null) {
      console.warn(`警告: profile 中未找到 ${pkg}，保留旧版本 ${_v}`);
      verified[pkg] = _v;
    } else {
      verified[pkg] = actual;
    }
  }
  next.verified = verified;
  try {
    next.dshCore = execFileSync('dsh', ['--version'], { encoding: 'utf8' }).trim();
  } catch {
    console.warn('警告: dsh 不可用，dshCore 保持不变');
  }
}

next.updatedAt = new Date().toISOString().slice(0, 10);

const out = JSON.stringify(next, null, 2) + '\n';
if (args.write) {
  writeFileSync(lockPath, out);
  console.log(`已写入 ${lockPath}`);
} else {
  console.log('[dry-run] 将写入的内容：');
  console.log(out);
}
