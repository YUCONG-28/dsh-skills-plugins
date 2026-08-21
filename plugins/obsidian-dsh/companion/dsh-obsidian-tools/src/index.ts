// dsh-obsidian-tools — vault-native tools for DeepSeek Harness.
// Reference implementation (companion to the Obsidian plugin). Build with DSH
// peer deps available: `pnpm add -D @deepseek-ai/cordis @deepseek-ai/dsh-tools @deepseek-ai/schemastery`.
import { defineTool } from '@deepseek-ai/dsh-tools';
import { Context, z } from '@deepseek-ai/cordis';
import { FsAccess } from './fs-access.js';
import { resolveVaultRoot } from './vault-path.js';

export const name = 'dsh-obsidian-tools';
export const inject = ['tools'];

export interface Config { vaultPath?: string; excludeDirs?: string[] }
export const Config: z<Config> = z.object({
  vaultPath: z.string(),
  excludeDirs: z.array(z.string()).default(['.obsidian', '.git', '.trash']),
});

export async function apply(ctx: Context, config: Config): Promise<void> {
  const vaultRoot = resolveVaultRoot(config.vaultPath);
  const access = new FsAccess(vaultRoot, config.excludeDirs);

  ctx.tools.register(defineTool({
    name: 'obsidian_list',
    description: '列出 vault 内的 Markdown 笔记路径',
    inputSchema: { type: 'object', properties: { subdir: { type: 'string' }, limit: { type: 'number' } } },
    async execute(args) { return { ok: true, value: await access.list(args?.subdir, args?.limit ?? 100) }; },
  }));

  ctx.tools.register(defineTool({
    name: 'obsidian_read',
    description: '读取一篇笔记（正文 + frontmatter）',
    inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    async execute(args) { return { ok: true, value: await access.read(args.path) }; },
  }));

  ctx.tools.register(defineTool({
    name: 'obsidian_write',
    description: '新建或覆盖一篇笔记（原子写）',
    inputSchema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
    async execute(args) { await access.write(args.path, args.content); return { ok: true, value: { path: args.path } }; },
  }));

  ctx.tools.register(defineTool({
    name: 'obsidian_append',
    description: '向笔记末尾追加内容',
    inputSchema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
    async execute(args) { await access.append(args.path, args.content); return { ok: true, value: { path: args.path } }; },
  }));

  ctx.tools.register(defineTool({
    name: 'obsidian_delete',
    description: '把笔记移入 .trash/（可逆，绝不永久删除）',
    inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    async execute(args) { return { ok: true, value: await access.delete(args.path) }; },
  }));
}
