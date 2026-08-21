// Rendering helpers: Obsidian MarkdownRenderer for assistant text and native
// DOM tool cards. chatView owns layout; this module owns leaf nodes.
import { MarkdownRenderer, type App, type Component } from 'obsidian';
import { linkifyVaultPaths } from '../obsidian/links';
import { classifyTool, type ToolRisk } from '../approval/policy';

export function markdownForRender(text: string, exists: (path: string) => boolean, vaultBase: string | null): string {
  return linkifyVaultPaths(text, exists, vaultBase);
}

export async function renderMarkdown(app: App, container: HTMLElement, markdown: string, sourcePath: string, component?: Component): Promise<void> {
  await MarkdownRenderer.render(app, markdown, container, sourcePath, component as Component);
}

export function createToolCard(
  container: HTMLElement,
  opts: { name: string; args: string; result: string | null; done: boolean; risk: ToolRisk },
): HTMLElement {
  const details = container.createEl('details', { cls: 'odsh-tool' });
  const summary = details.createEl('summary', { cls: 'odsh-tool-summary' });
  summary.createSpan({ cls: 'odsh-tool-status', text: opts.done ? '✓' : '…' });
  summary.createSpan({ cls: 'odsh-tool-name', text: opts.name });
  summary.createSpan({ cls: 'odsh-tool-risk odsh-tool-risk-' + opts.risk.level, text: opts.risk.label });
  if (opts.args) {
    const pre = details.createEl('pre', { cls: 'odsh-tool-args' });
    pre.setText(opts.args);
  }
  if (opts.result !== null) {
    const pre = details.createEl('pre', { cls: 'odsh-tool-result' });
    pre.setText(opts.result);
  }
  return details;
}

export function createNotice(container: HTMLElement, text: string): HTMLElement {
  return container.createEl('div', { cls: 'odsh-notice', text });
}
