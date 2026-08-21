// Vault context collection (Obsidian side) re-exporting the pure budget/
// formatting helpers from contextPure.ts so tests never touch the obsidian package.
import { type App, MarkdownView, TFile } from "obsidian";
export { budgetText, composePrompt, formatContextBlock, type CollectedContext } from "./contextPure";

export interface NoteContext {
  path: string | null;
  title: string | null;
}

export function getActiveNoteContext(app: App): NoteContext {
  const file = app.workspace.getActiveFile();
  return { path: file?.path ?? null, title: file?.basename ?? null };
}

export function getActiveSelection(app: App): string | null {
  const view = app.workspace.getActiveViewOfType(MarkdownView);
  if (!view) return null;
  const selection = view.editor.getSelection();
  return selection && selection.trim().length > 0 ? selection : null;
}

export async function readFileBudgeted(app: App, path: string, maxBytes: number): Promise<string | null> {
  try {
    const file = app.vault.getAbstractFileByPath(path) as TFile;
    const content = await app.vault.cachedRead(file);
    return content;
  } catch {
    return null;
  }
}
