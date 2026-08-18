/**
 * generate-art.mjs —— 把内置宠物（demo/remiel）的 GIF 内联为 data URI，
 * 并生成当前版本号，供客户端 bundle 自包含使用。
 *
 * 产物：
 *   src/client/art.generated.ts     PET_ART: Record<petId, Record<state, dataUri>>
 *   src/client/version.generated.ts PET_VERSION: string
 *
 * 用法：pnpm generate（替换 assets/pets/<id>/emotes/ 素材后执行，再 pnpm build）
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const petsDir = resolve(root, 'assets', 'pets')
const artOut = resolve(root, 'src', 'client', 'art.generated.ts')
const versionOut = resolve(root, 'src', 'client', 'version.generated.ts')

const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
const version = typeof pkg.version === 'string' ? pkg.version : '0.0.1'
writeFileSync(
  versionOut,
  [
    '/**',
    ' * Generated current version (from package.json). Do not edit by hand.',
    ' */',
    `export const PET_VERSION = ${JSON.stringify(version)}`,
    '',
  ].join('\n'),
)
console.log(`version.generated.ts written (${version})`)

/** 读取某个状态对应的素材文件并转 data URI（缺文件则跳过该状态）。 */
function emoteDataUri(petDir, state, file) {
  try {
    const path = join(petDir, 'emotes', file)
    if (!existsSync(path)) return null
    const bytes = readFileSync(path)
    const ext = file.split('.').pop().toLowerCase()
    const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/gif'
    return `data:${mime};base64,${bytes.toString('base64')}`
  } catch {
    return null
  }
}

const lines = [
  '/**',
  ' * Generated pet assets (data URIs). Run `pnpm generate` after replacing any source GIF.',
  ' */',
  'export const PET_ART: Record<string, Record<string, string>> = {',
]
let petCount = 0
let stateCount = 0
const dirs = readdirSync(petsDir, { withFileTypes: true })
for (const d of dirs) {
  if (!d.isDirectory()) continue
  const petDir = join(petsDir, d.name)
  const specPath = join(petDir, 'pet.json')
  if (!existsSync(specPath)) continue
  let spec = null
  try {
    spec = JSON.parse(readFileSync(specPath, 'utf8'))
  } catch {
    continue
  }
  const emotes = spec && typeof spec.emotes === 'object' ? spec.emotes : {}
  const states = Object.keys(emotes)
  if (states.length === 0) continue
  lines.push(`  ${JSON.stringify(d.name)}: {`)
  for (const state of states) {
    const file = emotes[state]
    if (typeof file !== 'string' || file === '') continue
    const uri = emoteDataUri(petDir, state, file)
    if (uri) {
      lines.push(`    ${JSON.stringify(state)}: ${JSON.stringify(uri)},`)
      stateCount++
    }
  }
  lines.push('  },')
  petCount++
}
lines.push('}')
writeFileSync(artOut, lines.join('\n') + '\n')
console.log(`art.generated.ts written (${petCount} pets, ${stateCount} states)`)
