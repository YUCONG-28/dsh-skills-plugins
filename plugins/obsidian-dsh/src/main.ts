import { FileSystemAdapter, Notice, Plugin, WorkspaceLeaf } from 'obsidian';
import { DshServerManager } from './harness/server';
import { ObsidianDshSettingTab } from './settings/settingsTab';
import { DEFAULT_SETTINGS, type ObsidianDshSettings, type ViewPlacement } from './settings/types';
import { ObsidianDshView, VIEW_TYPE_DSH } from './views/chatView';
import { getActiveNoteContext, getActiveSelection, readFileBudgeted } from './obsidian/context';
import { getVaultPath } from './obsidian/vaultPath';

export default class ObsidianDshPlugin extends Plugin {
  settings: ObsidianDshSettings = { ...DEFAULT_SETTINGS };
  server: DshServerManager = new DshServerManager(() => this.settings);
  private pluginData: Record<string, unknown> = {};

  async onload(): Promise<void> {
    try {
      this.pluginData = ((await this.loadData()) ?? {}) as Record<string, unknown>;
      this.settings = Object.assign({}, DEFAULT_SETTINGS, this.pluginData.settings ?? {});
      this.pluginData.loadedAt = Date.now();
      delete this.pluginData.loadError;
      await this.saveData(this.pluginData);

      this.addSettingTab(new ObsidianDshSettingTab(this.app, this));
      this.registerView(VIEW_TYPE_DSH, (leaf: WorkspaceLeaf) => new ObsidianDshView(leaf, this));

      this.addRibbonIcon('bot', '打开 DeepSeek Harness', () => void this.activateView());
      this.addCommand({ id: 'open-sidebar', name: '打开 DeepSeek Harness 侧栏', callback: () => void this.activateView() });
      this.addCommand({ id: 'send-selection', name: '发送选区到 DeepSeek Harness', callback: () => void this.sendSelection() });
      this.addCommand({ id: 'send-note', name: '发送当前笔记到 DeepSeek Harness', callback: () => void this.sendNote() });
      this.addCommand({ id: 'choose-workspace', name: '选择外部工作区（Git 仓库）', callback: () => void this.chooseWorkspace() });
      this.addCommand({ id: 'open-browser', name: '在浏览器打开 DSH', callback: () => void this.openBrowser() });
      this.addCommand({ id: 'restart-server', name: '重启 DSH 服务', callback: () => void this.restartServer() });

      if (this.settings.autoStart) void this.server.ensure(getVaultPath(this.app)).catch((e) => this.recordError(String(e)));
      if (this.settings.openOnStartup) {
        this.app.workspace.onLayoutReady(() => {
          void this.activateView().catch((e) => this.recordError(String(e)));
        });
      }
    } catch (error) {
      await this.recordError(error instanceof Error ? error.stack ?? error.message : String(error));
    }
  }

  private async recordError(message: string): Promise<void> {
    this.pluginData.loadError = message;
    try {
      await this.saveData(this.pluginData);
    } catch {
      // last-resort: never throw from the error path itself
    }
  }

  onunload(): void {
    this.server.dispose();
  }

  async saveSettings(): Promise<void> {
    this.pluginData.settings = this.settings;
    await this.saveData(this.pluginData);
  }

  getVaultPath(): string { return getVaultPath(this.app); }

  async activateView(): Promise<ObsidianDshView | null> {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(VIEW_TYPE_DSH)[0] ?? null;
    if (!leaf) leaf = this.getLeafForPlacement(this.settings.viewPlacement);
    if (!leaf) return null;
    await leaf.setViewState({ type: VIEW_TYPE_DSH, active: true });
    await workspace.revealLeaf(leaf);
    const view = leaf.view instanceof ObsidianDshView ? leaf.view : null;
    if (view) await view.ensureLoaded();
    return view;
  }

  private getLeafForPlacement(placement: ViewPlacement): WorkspaceLeaf | null {
    const { workspace } = this.app;
    switch (placement) {
      case 'tab': return workspace.getLeaf(true);
      case 'left-sidebar': return workspace.getLeftLeaf(false);
      case 'right-sidebar': return workspace.getRightLeaf(false);
      case 'window': return workspace.getLeaf('window');
      default: return workspace.getRightLeaf(false);
    }
  }

  private async sendSelection(): Promise<void> {
    const selection = getActiveSelection(this.app);
    const context = getActiveNoteContext(this.app);
    if (!selection) { new Notice('obsidian-dsh：当前笔记没有选中文本'); return; }
    const view = await this.activateView();
    view?.setNoteContext(context.path ?? '', selection);
    view?.insertContext(selection);
  }

  private async sendNote(): Promise<void> {
    const context = getActiveNoteContext(this.app);
    if (!context.path) { new Notice('obsidian-dsh：没有打开的笔记'); return; }
    const file = this.app.vault.getAbstractFileByPath(context.path);
    if (!file) return;
    const content = await this.app.vault.cachedRead(file as never);
    const view = await this.activateView();
    view?.attachFile(context.path, content);
    view?.insertContext(context.path);
  }

  private async chooseWorkspace(): Promise<void> {
    const view = await this.activateView();
    await view?.chooseExternalWorkspace();
  }

  private async openBrowser(): Promise<void> {
    const url = await this.server.ensure(getVaultPath(this.app));
    if (!url) { new Notice('obsidian-dsh：DSH 服务未就绪'); return; }
    window.open(url, '_blank');
  }

  private async restartServer(): Promise<void> {
    const url = await this.server.restart(getVaultPath(this.app));
    new Notice(url ? `obsidian-dsh：已重启，${url}` : 'obsidian-dsh：重启失败');
  }
}
