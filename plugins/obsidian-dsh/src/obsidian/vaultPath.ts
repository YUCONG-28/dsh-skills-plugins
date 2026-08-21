import { FileSystemAdapter, type App } from "obsidian";

export function getVaultPath(app: App): string {
  const adapter = app.vault.adapter;
  if (adapter instanceof FileSystemAdapter) {
    const base = (adapter as unknown as { getBasePath?: () => string }).getBasePath?.();
    if (base) return base;
  }
  return app.vault.getName();
}
