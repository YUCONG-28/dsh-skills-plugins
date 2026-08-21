// Pure context budgeting/formatting — no Obsidian imports, unit-testable.
export interface CollectedContext {
  notePath: string | null;
  selection: string | null;
  files: { path: string; content: string }[];
}

export function budgetText(text: string, maxBytes: number): { text: string; truncated: boolean } {
  if (Buffer.byteLength(text, "utf8") <= maxBytes) return { text, truncated: false };
  let end = 0;
  while (end < text.length && Buffer.byteLength(text.slice(0, end + 1), "utf8") <= maxBytes) end += 1;
  return { text: text.slice(0, end), truncated: true };
}

export function formatContextBlock(path: string, content: string, maxBytes: number): string {
  const { text, truncated } = budgetText(content, maxBytes);
  const head = "## 文件: " + path;
  if (truncated) {
    return head + "\n\n" + text + "\n\n（内容超过 " + maxBytes + " 字节已截断，请按需读取该文件）";
  }
  return head + "\n\n" + text;
}

export function composePrompt(basePrompt: string, ctx: CollectedContext, maxNoteBytes = 20000): string {
  const parts: string[] = [];
  const fence = String.fromCharCode(96) + String.fromCharCode(96) + String.fromCharCode(96);
  if (ctx.notePath) parts.push("当前笔记: " + ctx.notePath);
  for (const file of ctx.files) parts.push(formatContextBlock(file.path, file.content, maxNoteBytes));
  if (ctx.selection) {
    parts.push("选中文本（来自 " + (ctx.notePath ?? "当前笔记") + "）:\n" + fence + "\n" + budgetText(ctx.selection, maxNoteBytes).text + "\n" + fence);
  }
  if (parts.length === 0) return basePrompt;
  return parts.join("\n\n") + "\n\n" + basePrompt;
}
