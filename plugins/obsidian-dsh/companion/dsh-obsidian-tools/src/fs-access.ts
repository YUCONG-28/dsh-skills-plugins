import * as fs from 'fs/promises';
import * as path from 'path';
import { guardPath } from './vault-path.js';

export class FsAccess {
  constructor(private readonly root: string, private readonly excludeDirs: string[]) {}

  async list(subdir = '', limit = 100): Promise<string[]> {
    const base = guardPath(this.root, subdir);
    const out: string[] = [];
    await this.walk(base, out, limit);
    return out.map((p) => path.relative(this.root, p).split(path.sep).join('/'));
  }

  private async walk(dir: string, out: string[], limit: number): Promise<void> {
    if (out.length >= limit) return;
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (out.length >= limit) return;
      if (entry.name.startsWith('.') || this.excludeDirs.includes(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await this.walk(full, out, limit);
      else if (entry.isFile() && entry.name.endsWith('.md')) out.push(full);
    }
  }

  async read(rel: string): Promise<{ path: string; content: string }> {
    const full = guardPath(this.root, rel);
    return { path: rel, content: await fs.readFile(full, 'utf8') };
  }

  async write(rel: string, content: string): Promise<void> {
    const full = guardPath(this.root, rel);
    await this.atomicWrite(full, content);
  }

  async append(rel: string, content: string): Promise<void> {
    const full = guardPath(this.root, rel);
    const current = await fs.readFile(full, 'utf8').catch(() => '');
    await this.atomicWrite(full, current + content);
  }

  async delete(rel: string): Promise<{ trashedTo: string }> {
    const full = guardPath(this.root, rel);
    const trash = path.join(this.root, '.trash');
    await fs.mkdir(trash, { recursive: true });
    const name = path.basename(rel);
    let target = path.join(trash, name);
    if (await exists(target)) target = path.join(trash, `${name}.${Date.now()}`);
    await fs.rename(full, target);
    return { trashedTo: path.relative(this.root, target) };
  }

  private async atomicWrite(full: string, content: string): Promise<void> {
    await fs.mkdir(path.dirname(full), { recursive: true });
    const tmp = `${full}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmp, content, 'utf8');
    await fs.rename(tmp, full);
  }
}

async function exists(p: string): Promise<boolean> {
  try { await fs.access(p); return true; } catch { return false; }
}
