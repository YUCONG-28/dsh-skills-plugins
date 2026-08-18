import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const libDir = join(here, '..', 'lib')

test('client bundle：__ModuleLoader__ 包装完整', () => {
  const src = readFileSync(join(libDir, 'client.js'), 'utf8')
  assert.ok(src.startsWith('window.__ModuleLoader__.load({'))
  assert.ok(src.includes('id: "dsh-web-pets"'))
  assert.ok(src.includes('return module.exports;'))
  assert.ok(src.trimEnd().endsWith('});'))
  assert.ok(src.includes('exports.apply = apply'))
})

test('client bundle：内置宠物素材以 data URI 内联', () => {
  const src = readFileSync(join(libDir, 'client.js'), 'utf8')
  assert.ok(src.includes('data:image/gif;base64,'))
})

test('client bundle：react / react-dom/client 保持外部依赖（不打包）', () => {
  const src = readFileSync(join(libDir, 'client.js'), 'utf8')
  assert.ok(src.includes('require("react")'))
  assert.ok(src.includes('require("react-dom/client")'))
})

test('client bundle：不含宿主 node 内置模块引用', () => {
  const src = readFileSync(join(libDir, 'client.js'), 'utf8')
  assert.ok(!src.includes("require('node:fs')"))
  assert.ok(!src.includes("require('node:path')"))
})

test('host bundle：ESM 且含测试钩子', () => {
  const src = readFileSync(join(libDir, 'index.js'), 'utf8')
  assert.ok(src.includes('export {'))
})
