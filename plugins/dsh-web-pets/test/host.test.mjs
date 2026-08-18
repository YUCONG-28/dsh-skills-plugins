import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { name, inject, _internals } from '../lib/index.js'

const here = dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = dirname(here)

test('插件身份：name/inject/apply', () => {
  assert.equal(name, 'web-pets')
  assert.ok(inject.includes('webServer'))
  assert.ok(inject.includes('sessions'))
})

test('版本号与 package.json 一致（0.2.2）', () => {
  const pkg = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'))
  assert.equal(_internals.PKG_VERSION, pkg.version)
  assert.equal(_internals.PKG_VERSION, '0.2.2')
})

test('toolBubble：常见工具映射与通用回退', () => {
  const { toolBubble } = _internals
  assert.equal(toolBubble('bash', JSON.stringify({ command: 'ls -la' })), '🖥 命令 · ls -la')
  assert.equal(toolBubble('read', JSON.stringify({ file_path: 'src/index.ts' })), '📖 读取 · src/index.ts')
  assert.equal(toolBubble('web_search', JSON.stringify({ query: 'dsh plugin' })), '🌐 搜索 · dsh plugin')
  assert.equal(toolBubble('unknown_tool', JSON.stringify({ a: 'x' })), '🛠 unknown_tool · x')
  assert.equal(toolBubble('', '{}'), '🛠 tool')
})

test('truncate90：压平换行并截断 90 字符', () => {
  const { truncate90 } = _internals
  assert.equal(truncate90('a\nb\t c'), 'a b c')
  assert.equal(truncate90('x'.repeat(200)).length, 90)
})

test('semverGt：语义化版本比较', () => {
  const { semverGt } = _internals
  assert.equal(semverGt('0.3.0', '0.2.0'), true)
  assert.equal(semverGt('0.2.0', '0.2.0'), false)
  assert.equal(semverGt('0.2.1', '0.2.0'), true)
  assert.equal(semverGt('v0.3.0', '0.2.0'), true)
  assert.equal(semverGt('0.2.0', '0.3.0'), false)
})

test('localHostOk：仅接受本机 Host 头（CSRF 防护）', () => {
  const { localHostOk } = _internals
  assert.equal(localHostOk({ headers: { host: '127.0.0.1:3080' } }), true)
  assert.equal(localHostOk({ headers: { host: 'localhost:3080' } }), true)
  assert.equal(localHostOk({ headers: { host: '[::1]:3080' } }), true)
  assert.equal(localHostOk({ headers: { host: 'evil.com' } }), false)
  assert.equal(localHostOk({ headers: {} }), false)
})

test('宠物注册表：内置 demo/remiel 可发现', () => {
  const pets = _internals.listPets()
  const ids = pets.map((p) => p.id)
  assert.ok(ids.includes('demo'))
  assert.ok(ids.includes('remiel'))
  const remiel = pets.find((p) => p.id === 'remiel')
  assert.equal(remiel.displayName, '雷米埃尔')
  assert.ok(remiel.emotes.running)
})

test('安装形态：monorepo link（源码目录）', () => {
  const info = _internals.resolveInstall()
  assert.equal(info.mode, 'link')
  assert.ok(info.repoDir.endsWith('dsh-skills-plugins'))
})

test('effectiveState：初始为 idle（未超过 waiting 阈值）', () => {
  assert.equal(_internals.effectiveState(), 'idle')
})

test('resolveProfileInstall：registry 依赖 → npm', () => {
  const dir = mkTempProfile({ 'dsh-web-pets': '^0.2.0' })
  const info = _internals.resolveProfileInstall(dir)
  assert.equal(info.mode, 'npm')
})

test('resolveProfileInstall：file: 指向仓库 → link', () => {
  const dir = mkTempProfile({ 'dsh-web-pets': 'file:' + PACKAGE_ROOT })
  const info = _internals.resolveProfileInstall(dir)
  assert.equal(info.mode, 'link')
  assert.ok(info.repoDir.endsWith('dsh-skills-plugins'))
})

test('resolveProfileInstall：file: 指向仓库外 → tarball', () => {
  const dir = mkTempProfile({ 'dsh-web-pets': 'file:/tmp/not-a-repo' })
  const info = _internals.resolveProfileInstall(dir)
  assert.equal(info.mode, 'tarball')
})

function mkTempProfile(deps) {
  const dir = mkdtempSync(join(tmpdir(), 'dwp-profile-'))
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'test', dependencies: deps }))
  return dir
}
