import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export function resolveVaultRoot(explicit: string): string {
  if (explicit && explicit.trim()) return path.resolve(explicit.trim());
  const home = os.homedir();
  const candidates = [
    path.join(home, 'Library', 'Application Support', 'obsidian', 'obsidian.json'),
    path.join(process.env.APPDATA ?? '', 'obsidian', 'obsidian.json'),
    path.join(home, '.config', 'obsidian', 'obsidian.json'),
  ];
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(fs.readFileSync(candidate, 'utf8')) as Record<string, { path: string; open?: boolean }>;
      const open = Object.values(parsed).find((v) => v.open);
      if (open) return open.path;
      const first = Object.values(parsed)[0];
      if (first) return first.path;
    } catch { /* next */ }
  }
  throw new Error('obsidian vault root not found');
}

export function guardPath(root: string, rel: string): string {
  if (!rel || rel.includes('\\0')) throw new Error('invalid path');
  const resolved = path.resolve(root, rel);
  const realRoot = fs.realpathSync(root);
  const realResolved = fs.realpathSync(resolved);
  if (realResolved !== realRoot && !realResolved.startsWith(realRoot + path.sep)) {
    throw new Error('path escapes vault root');
  }
  return resolved;
}
