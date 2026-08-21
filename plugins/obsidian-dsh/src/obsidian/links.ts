// Vault-path linkification: turn path-ish tokens in assistant text into
// Obsidian wikilinks / internal links. Pure and unit-tested.
export interface Segment {
  code: boolean;
  text: string;
}

export function splitFenced(markdown: string): Segment[] {
  const segments: Segment[] = [];
  const fence = /^```[^\n]*$/gm;
  let last = 0;
  let inCode = false;
  let match: RegExpExecArray | null;
  while ((match = fence.exec(markdown)) !== null) {
    segments.push({ code: inCode, text: markdown.slice(last, match.index) });
    segments.push({ code: inCode, text: match[0] });
    inCode = !inCode;
    last = match.index + match[0].length;
  }
  segments.push({ code: inCode, text: markdown.slice(last) });
  return segments;
}

const TRAILING_PUNCTUATION = /[.,;:!?)\]}"'\u3002\uff0c\uff1b\uff1a\uff01\uff1f\u3001\uff09\u300d\u300f\uff09]+$/u;
const VAULT_PATH_RE = /(?<!\[\[)(?<!\(\()([^\s"'\[\]()<>（）「」『』《》【】、，。；：！？]+?\.[A-Za-z0-9]{1,10}(?:#[\w-]+)?)/g;

export function normalizeVaultPath(raw: string): string {
  let value = raw.trim();
  while (value.startsWith("./")) value = value.slice(2);
  return value.replace(/\\/g, "/");
}

export function vaultRelativePath(raw: string, vaultBase: string | null): string | null {
  const normalized = normalizeVaultPath(raw);
  if (/^[A-Za-z]:\//.test(normalized)) {
    if (!vaultBase) return null;
    const base = normalizeVaultPath(vaultBase).replace(/\/$/, "").toLowerCase();
    if (!normalized.toLowerCase().startsWith(base + "/")) return null;
    return normalized.slice(base.length + 1);
  }
  if (normalized.startsWith("../") || normalized.startsWith("/")) return null;
  return normalized;
}

export function splitAnchor(raw: string): { path: string; anchor: string | null } {
  const match = /^([^#]+)(?:#([\w-]+))?$/.exec(raw);
  if (!match) return { path: raw, anchor: null };
  return { path: match[1], anchor: match[2] ?? null };
}

export function linkifyText(text: string, exists: (path: string) => boolean, vaultBase: string | null = null): string {
  return text.replace(VAULT_PATH_RE, (match) => {
    const trimmed = match.replace(TRAILING_PUNCTUATION, "");
    if (!trimmed) return match;
    const { path: rawPath, anchor } = splitAnchor(trimmed);
    const path = vaultRelativePath(rawPath, vaultBase);
    if (!path || !exists(path)) return match;
    const isMarkdown = /\.md$/i.test(path);
    if (isMarkdown) return anchor ? `[[${path}#${anchor}]]` : `[[${path}]]`;
    return `[${path}](obsidian-dsh-file://${encodeURIComponent(path)})`;
  });
}

export function linkifyVaultPaths(
  markdown: string,
  exists: (path: string) => boolean,
  vaultBase: string | null = null,
): string {
  return splitFenced(markdown)
    .map((segment) => (segment.code ? segment.text : linkifyText(segment.text, exists, vaultBase)))
    .join("");
}
