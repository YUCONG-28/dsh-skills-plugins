#!/usr/bin/env node
/**
 * release-web-pets.mjs —— dsh-web-pets 一键发版脚本
 *
 * 用法：
 *   node scripts/release-web-pets.mjs [patch|minor|major] [--dry-run] [--notes "..." ]
 *
 * 流程：
 *   bump package.json 版本 → pnpm generate/build/test → 更新 CHANGELOG 与
 *   versions.lock.json → npm pack（dist/*.tgz + SHA256SUMS.txt）→
 *   git commit/tag web-pets-vX.Y.Z → gh release create（上传 tarball+SHA256）→
 *   git push origin main --follow-tags。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = fileURLToPath(new URL('..', import.meta.url))
const repoRoot = dirname(dirname(root))
const pkgPath = join(root, 'package.json')
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))

const bump = process.argv[2] || 'patch'
const dryRun = process.argv.includes('--dry-run')
const notesIndex = process.argv.indexOf('--notes')
const customNotes = notesIndex !== -1 && process.argv[notesIndex + 1] ? process.argv[notesIndex + 1] : ''

/** 简单语义化 bump：patch / minor / major。 */
function bumpVersion(v, type) {
  const [a = 0, b = 0, c = 0] = String(v).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0)
  if (type === 'major') return `${a + 1}.0.0`
  if (type === 'minor') return `${a}.${b + 1}.0`
  return `${a}.${b}.${c + 1}`
}

const next = bumpVersion(pkg.version, bump)
const tag = `web-pets-v${next}`
const tarball = `dsh-web-pets-${next}.tgz`

function run(cmd, args, cwd = root) {
  console.log(`$ ${cmd} ${args.join(' ')}`)
  if (dryRun) return { ok: true, stdout: '' }
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  if (r.error) throw r.error
  process.stdout.write(r.stdout || '')
  if (r.status !== 0) {
    process.stderr.write(r.stderr || '')
    throw new Error(`command failed: ${cmd} ${args.join(' ')}`)
  }
  return { ok: true, stdout: r.stdout || '' }
}

/** 自上一个 web-pets-v 前缀 tag 到 HEAD 的提交标题，作为默认 release notes。 */
function gitLogSincePrevTag() {
  const r = spawnSync('git', ['tag', '--sort=-creatordate'], { cwd: repoRoot, encoding: 'utf8' })
  const tags = (r.stdout || '').split('\n').filter((t) => t.startsWith('web-pets-v'))
  const prev = tags[0]
  if (!prev) return ''
  const log = spawnSync('git', ['log', '--pretty=format:- %s', `${prev}..HEAD`, '--', 'plugins/dsh-web-pets'], { cwd: repoRoot, encoding: 'utf8' })
  return log.stdout || ''
}

// 1) bump package.json
pkg.version = next
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
console.log(`[1/7] package.json -> ${next}`)

// 2) 生成版本文件 + 构建 + 测试
run('pnpm', ['generate'])
run('pnpm', ['build'])
run('pnpm', ['test'])

// 3) CHANGELOG（写入时先插入一个待填写的小节，若已存在同版本小节则跳过）
const changelogPath = join(root, 'CHANGELOG.md')
if (existsSync(changelogPath)) {
  const cl = readFileSync(changelogPath, 'utf8')
  if (!cl.includes(`## v${next}`)) {
    const date = new Date().toISOString().slice(0, 10)
    const section = `## v${next} (${date})\n\n- 见下方历史条目；本次 release notes：\n${customNotes ? customNotes : gitLogSincePrevTag() || '- 发布 v' + next}\n\n`
    writeFileSync(changelogPath, cl.replace(/^# Changelog\n/, `# Changelog\n\n${section}`))
  }
  console.log('[3/7] CHANGELOG updated')
}

// 4) versions.lock.json
const lockPath = join(repoRoot, 'versions.lock.json')
if (existsSync(lockPath)) {
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'))
  lock.updatedAt = new Date().toISOString().slice(0, 10)
  if (lock.ownPlugins) lock.ownPlugins['dsh-web-pets'] = next
  writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n')
  console.log('[4/7] versions.lock.json updated')
}

// 5) npm pack + SHA256
mkdirSync(join(root, 'dist'), { recursive: true })
run('npm', ['pack', '--pack-destination', 'dist'])
const tarPath = join(root, 'dist', tarball)
const sha = run('shasum', ['-a', '256', tarPath]).stdout.split(/\s+/)[0]
writeFileSync(join(root, 'dist', 'SHA256SUMS.txt'), `${sha}  ${tarball}\n`)
console.log('[5/7] tarball + SHA256SUMS.txt')

// 6) git commit + tag + push（tag 推送后由 .github/workflows/release.yml 创建 Release）
const notes = customNotes || gitLogSincePrevTag() || `dsh-web-pets v${next}`
run('git', ['add', 'plugins/dsh-web-pets', 'versions.lock.json'], repoRoot)
run('git', ['commit', '-m', `release(dsh-web-pets): v${next}`], repoRoot)
run('git', ['tag', '-a', tag, '-m', `dsh-web-pets v${next}`], repoRoot)
run('git', ['push', 'origin', 'main', '--follow-tags'], repoRoot)
console.log('[6/7] committed + tagged + pushed')

// 7) Release 由 CI 创建（release.yml），本地产物保留在 dist/
console.log('[7/7] 已触发 release.yml（GitHub Release / npm publish）')
console.log(`Done: ${tag}`)
