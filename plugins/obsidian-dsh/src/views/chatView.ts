import { ItemView, Notice, WorkspaceLeaf } from 'obsidian';
import type ObsidianDshPlugin from '../main';
import { DshApiClient } from '../harness/client';
import { EventStream, type StreamState } from '../harness/events';
import type { MuxFrameRaw, HostFrameRaw, SessionModels } from '../harness/types';
import { SessionStore } from './store';
import { createNotice, createToolCard, markdownForRender, renderMarkdown } from './renderer';
import { ApprovalCenter } from '../approval/center';
import { ApprovalModal, QuestionModal } from '../approval/modal';
import { classifyTool, PERMISSION_MODES, permissionSpec } from '../approval/policy';
import { AGENT_MODES, type AgentMode } from '../agents/mode';
import { buildDirectPrompt, buildOrchestratedPrompt } from '../agents/orchestrator';
import { composePrompt, getActiveNoteContext, getActiveSelection, type CollectedContext } from '../obsidian/context';

export const VIEW_TYPE_DSH = 'obsidian-dsh-view';

const RENDER_BATCH_MS = 60;

export class ObsidianDshView extends ItemView {
  private hostEl: HTMLElement | null = null;
  private headerSelect: HTMLSelectElement | null = null;
  private modeSelect: HTMLSelectElement | null = null;
  private modelSelect: HTMLSelectElement | null = null;
  private effortSelect: HTMLSelectElement | null = null;
  private permissionSelect: HTMLSelectElement | null = null;
  private statusDot: HTMLElement | null = null;
  private statusLabel: HTMLElement | null = null;
  private messagesEl: HTMLElement | null = null;
  private approvalsEl: HTMLElement | null = null;
  private composerEl: HTMLTextAreaElement | null = null;
  private chipsEl: HTMLElement | null = null;

  private api: DshApiClient | null = null;
  private apiUrl: string | null = null;
  private mux: EventStream | null = null;
  private hostStream: EventStream | null = null;
  private store = new SessionStore();
  private center: ApprovalCenter | null = null;

  private sessions: { sessionId: string; title: string | null; cwd?: string }[] = [];
  private sessionId: string | null = null;
  private workspacePath: string | null = null;
  private modelCatalog: SessionModels | null = null;
  private renderTimer: ReturnType<typeof setTimeout> | null = null;
  private unsubscribeServer: (() => void) | null = null;
  private unsubscribeStore: (() => void) | null = null;
  private unsubscribeCenter: (() => void) | null = null;
  private noteContext: { path: string; selection: string | null } | null = null;
  private attachedFiles: { path: string; content: string }[] = [];
  private presetIds: string[] | null = null;

  constructor(leaf: WorkspaceLeaf, private readonly plugin: ObsidianDshPlugin) {
    super(leaf);
  }

  getViewType(): string { return VIEW_TYPE_DSH; }
  getDisplayText(): string { return 'DeepSeek Harness'; }
  getIcon(): string { return 'bot'; }

  async onOpen(): Promise<void> {
    this.hostEl = this.contentEl.createDiv({ cls: 'odsh-host' });
    this.buildHeader();
    this.buildToolbar();
    this.messagesEl = this.hostEl.createDiv({ cls: 'odsh-messages' });
    this.approvalsEl = this.hostEl.createDiv({ cls: 'odsh-approvals' });
    this.buildComposer();

    this.unsubscribeServer = this.plugin.server.onChange(() => this.renderStatus());
    this.unsubscribeStore = this.store.onChange(() => this.scheduleRender());
    this.renderStatus();
    void this.ensureLoaded();
  }

  async onClose(): Promise<void> {
    this.unsubscribeServer?.();
    this.unsubscribeStore?.();
    this.unsubscribeCenter?.();
    if (this.renderTimer) clearTimeout(this.renderTimer);
    this.mux?.stop();
    this.hostStream?.stop();
  }

  private vaultPath(): string { return this.plugin.getVaultPath(); }

  async ensureLoaded(): Promise<string | null> {
    const url = await this.plugin.server.ensure(this.workspacePath ?? this.vaultPath());
    if (!url) { this.renderStatus(); return null; }
    if (url !== this.apiUrl) {
      this.disconnectStreams();
      this.apiUrl = url;
      this.api = new DshApiClient(url);
      this.center = new ApprovalCenter(this.api);
      this.unsubscribeCenter?.();
      this.unsubscribeCenter = this.center.onChange(() => this.scheduleRender());
      this.connectStreams();
      await this.reloadSessions();
      void this.reloadToolbar();
    }
    this.renderStatus();
    return url;
  }

  private disconnectStreams(): void {
    this.mux?.stop();
    this.hostStream?.stop();
    this.mux = null;
    this.hostStream = null;
  }

  private connectStreams(): void {
    if (!this.apiUrl) return;
    this.mux = new EventStream(this.apiUrl, '/api/events.mux', {
      onFrame: (rpcId, payload) => this.handleMux(rpcId, payload as MuxFrameRaw['payload']),
      onState: (state) => {
        if (state === 'connected') void this.resyncAfterReconnect();
      },
    });
    this.hostStream = new EventStream(this.apiUrl, '/api/events.host', {
      onFrame: (_rpcId, payload) => this.handleHost(payload as HostFrameRaw['payload']),
      onState: () => {},
    });
    this.mux.start();
    this.hostStream.start();
  }

  private handleMux(rpcId: string, payload: MuxFrameRaw['payload']): void {
    if (payload.type === 'approval/requested' || payload.type === 'approval/resolved' || payload.type === 'question/requested' || payload.type === 'question/resolved') {
      this.center?.ingest(rpcId, payload);
      return;
    }
    try {
      this.store.applyMux(rpcId, payload);
    } catch {
      // never let a single bad frame break the stream
    }
    if (payload.type === 'session/event' && payload.sessionId === this.sessionId) this.scheduleRender();
  }

  private handleHost(payload: HostFrameRaw['payload']): void {
    if (payload.type === 'host/session-status' && payload.sessionId) {
      this.store.setRunning(payload.sessionId, payload.running === true);
    }
    if (payload.type === 'host/session-added' || payload.type === 'host/session-removed') {
      void this.reloadSessions();
    }
  }

  private async resyncAfterReconnect(): Promise<void> {
    if (!this.sessionId || !this.api) return;
    const result = await this.api.history(this.sessionId, this.plugin.settings.historyPageSize);
    if (!result.error && result.events.length) {
      this.store.dropView(this.sessionId);
      this.store.seedHistory(this.sessionId, result.events);
      this.scheduleRender();
    }
  }

  private buildHeader(): void {
    if (!this.hostEl) return;
    const bar = this.hostEl.createDiv({ cls: 'odsh-header' });
    this.statusDot = bar.createSpan({ cls: 'odsh-dot' });
    this.statusLabel = bar.createSpan({ cls: 'odsh-status', text: '未运行' });
    this.headerSelect = bar.createEl('select', { cls: 'dropdown odsh-session-select' });
    this.headerSelect.addEventListener('change', () => void this.selectSession(this.headerSelect?.value ?? null));
    const newBtn = bar.createEl('button', { cls: 'odsh-iconbtn', text: '＋' });
    newBtn.setAttribute('aria-label', '新会话');
    newBtn.addEventListener('click', () => void this.newSession());
    const archiveBtn = bar.createEl('button', { cls: 'odsh-iconbtn', text: '🗄' });
    archiveBtn.setAttribute('aria-label', '归档当前会话');
    archiveBtn.addEventListener('click', () => void this.archiveCurrent());
  }

  private buildToolbar(): void {
    if (!this.hostEl) return;
    const toolbar = this.hostEl.createDiv({ cls: 'odsh-toolbar' });

    this.modeSelect = toolbar.createEl('select', { cls: 'dropdown odsh-toolbar-select' });
    for (const mode of AGENT_MODES) this.modeSelect.createEl('option', { text: mode.label, value: mode.mode });
    this.modeSelect.value = this.plugin.settings.agentMode;
    this.modeSelect.addEventListener('change', () => {
      this.plugin.settings.agentMode = this.modeSelect?.value as AgentMode;
      void this.plugin.saveSettings();
    });

    this.modelSelect = toolbar.createEl('select', { cls: 'dropdown odsh-toolbar-select' });
    this.modelSelect.addEventListener('change', () => void this.applyModelSelection());
    this.effortSelect = toolbar.createEl('select', { cls: 'dropdown odsh-toolbar-select' });
    this.effortSelect.addEventListener('change', () => void this.applyModelSelection());

    this.permissionSelect = toolbar.createEl('select', { cls: 'dropdown odsh-toolbar-select' });
    for (const spec of PERMISSION_MODES) this.permissionSelect.createEl('option', { text: spec.label, value: spec.mode });
    this.permissionSelect.value = this.plugin.settings.permissionMode;
    this.permissionSelect.addEventListener('change', () => void this.applyPermission());
  }

  private buildComposer(): void {
    if (!this.hostEl) return;
    this.chipsEl = this.hostEl.createDiv({ cls: 'odsh-chips' });
    const row = this.hostEl.createDiv({ cls: 'odsh-composer' });
    this.composerEl = row.createEl('textarea', { cls: 'odsh-textarea' });
    this.composerEl.placeholder = '输入指令，Enter 发送，Shift+Enter 换行';
    this.composerEl.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        void this.sendPrompt();
      }
    });
    const send = row.createEl('button', { cls: 'odsh-send', text: '发送' });
    send.addEventListener('click', () => void this.sendPrompt());
  }

  private async reloadSessions(): Promise<void> {
    if (!this.api) return;
    const result = await this.api.listSessions();
    if (result.error) { this.renderStatus(); return; }
    const base = (this.workspacePath ?? this.vaultPath()).replace(/[\\/]+$/, '').toLowerCase();
    this.sessions = result.sessions
      .filter((s) => !s.origin || s.origin !== 'subagent')
      .filter((s) => !s.cwd || s.cwd.toLowerCase() === base || s.cwd.toLowerCase().startsWith(base + '/') || s.cwd.toLowerCase().startsWith(base + '\\'))
      .map((s) => ({ sessionId: s.sessionId, title: s.title, cwd: s.cwd }));
    this.renderSessions();
    if (!this.sessionId && this.sessions.length) void this.selectSession(this.sessions[0].sessionId);
  }

  private renderSessions(): void {
    if (!this.headerSelect) return;
    this.headerSelect.empty();
    this.headerSelect.createEl('option', { text: '选择会话…', value: '' });
    for (const session of this.sessions) {
      this.headerSelect.createEl('option', { text: session.title ?? session.sessionId.slice(0, 8), value: session.sessionId });
    }
    if (this.sessionId) this.headerSelect.value = this.sessionId;
  }

  private async selectSession(sessionId: string | null): Promise<void> {
    if (!this.api || !sessionId) return;
    this.sessionId = sessionId;
    this.renderSessions();
    const result = await this.api.history(sessionId, this.plugin.settings.historyPageSize);
    this.store.dropView(sessionId);
    this.store.seedHistory(sessionId, result.events);
    if (result.projections) {
      for (const [key, value] of Object.entries(result.projections)) this.store.applyProjection(sessionId, key, value, Number.MAX_SAFE_INTEGER);
    }
    void this.refreshModelCatalog();
    this.scheduleRender();
  }

  private async newSession(): Promise<void> {
    if (!this.api) { await this.ensureLoaded(); if (!this.api) return; }
    const cwd = this.workspacePath ?? this.vaultPath();
    let agentPreset: string | undefined;
    if (this.plugin.settings.agentMode === 'orchestrated') {
      agentPreset = await this.presetAvailable(this.plugin.settings.orchestratedPreset)
        ? this.plugin.settings.orchestratedPreset
        : undefined;
    }
    const sessionId = await this.api.createSession({ cwd, agentPreset });
    if (!sessionId) { new Notice('obsidian-dsh：创建会话失败'); return; }
    if (this.plugin.settings.agentMode === 'orchestrated') await this.applyProModel(sessionId);
    await this.reloadSessions();
    await this.selectSession(sessionId);
  }

  private async presetAvailable(id: string): Promise<boolean> {
    if (this.presetIds === null) {
      const presets = await this.api?.listAgentPresets() ?? [];
      this.presetIds = presets.map((p) => p.id);
    }
    return (this.presetIds ?? []).includes(id);
  }

  private async applyProModel(sessionId: string): Promise<void> {
    if (!this.api) return;
    const s = this.plugin.settings;
    await this.api.selectModel(sessionId, s.proProvider, s.proModel, s.proEffort).catch(() => undefined);
  }

  private async archiveCurrent(): Promise<void> {
    if (!this.api || !this.sessionId) return;
    await this.api.archiveSession(this.sessionId);
    this.sessionId = null;
    await this.reloadSessions();
  }

  private async reloadToolbar(): Promise<void> {
    if (!this.api) return;
    void this.refreshModelCatalog();
  }

  private async refreshModelCatalog(): Promise<void> {
    if (!this.api || !this.sessionId) return;
    const result = await this.api.sessionModels(this.sessionId);
    if (!result.ok) return;
    this.modelCatalog = result.value ? result.value : null;
    this.renderModelCatalog();
  }

  private renderModelCatalog(): void {
    if (!this.modelSelect || !this.effortSelect || !this.modelCatalog) return;
    this.modelSelect.empty();
    for (const group of this.modelCatalog.groups) {
      for (const model of group.models) {
        this.modelSelect.createEl('option', { text: `${group.name ?? group.id} · ${model.name ?? model.id}`, value: `${group.id}/${model.id}` });
      }
    }
    const current = `${this.modelCatalog.current.provider}/${this.modelCatalog.current.model}`;
    this.modelSelect.value = current;
    this.renderEfforts(current);
  }

  private renderEfforts(key: string): void {
    if (!this.effortSelect || !this.modelCatalog) return;
    this.effortSelect.empty();
    const [provider, model] = key.split('/');
    const group = this.modelCatalog.groups.find((g) => g.id === provider);
    const info = group?.models.find((m) => m.id === model);
    const efforts = info?.reasoning?.efforts ?? [];
    this.effortSelect.createEl('option', { text: '默认 effort', value: '' });
    for (const effort of efforts) this.effortSelect.createEl('option', { text: effort.name, value: effort.id });
    this.effortSelect.value = this.modelCatalog.current.reasoningEffort ?? '';
  }

  private async applyModelSelection(): Promise<void> {
    if (!this.api || !this.sessionId || !this.modelSelect) return;
    const [provider, model] = this.modelSelect.value.split('/');
    if (!provider || !model) return;
    const effort = this.effortSelect?.value || undefined;
    await this.api.selectModel(this.sessionId, provider, model, effort);
  }

  private async applyPermission(): Promise<void> {
    if (!this.api || !this.permissionSelect) return;
    const mode = this.permissionSelect.value as Parameters<typeof permissionSpec>[0];
    const spec = permissionSpec(mode);
    this.plugin.settings.permissionMode = mode;
    await this.plugin.saveSettings();
    await this.api.settingsMutate('permission', [{ op: 'set', path: ['defaultPreset'], value: spec.preset }]);
  }

  async chooseExternalWorkspace(): Promise<void> {
    if (!this.api) { await this.ensureLoaded(); if (!this.api) return; }
    const path = await this.api.hostPickDirectory();
    if (!path) return;
    this.workspacePath = path;
    this.sessionId = null;
    await this.reloadSessions();
    new Notice(`obsidian-dsh：工作区已切换到 ${path}`);
  }

  insertContext(text: string): void {
    if (!this.composerEl) return;
    const current = this.composerEl.value;
    this.composerEl.value = current ? `${current}\n${text}` : text;
    this.composerEl.focus();
  }

  setNoteContext(path: string, selection: string | null): void {
    this.noteContext = { path, selection };
    this.renderChips();
  }

  attachFile(path: string, content: string): void {
    this.attachedFiles = [...this.attachedFiles.filter((f) => f.path !== path), { path, content }];
    this.renderChips();
  }

  private renderChips(): void {
    if (!this.chipsEl) return;
    this.chipsEl.empty();
    if (this.noteContext) {
      const chip = this.chipsEl.createSpan({ cls: 'odsh-chip', text: `📄 ${this.noteContext.path}` });
      const x = chip.createSpan({ text: ' ✕', cls: 'odsh-chip-x' });
      x.addEventListener('click', () => { this.noteContext = null; this.renderChips(); });
    }
    for (const file of this.attachedFiles) {
      const chip = this.chipsEl.createSpan({ cls: 'odsh-chip', text: `📎 ${file.path}` });
      const x = chip.createSpan({ text: ' ✕', cls: 'odsh-chip-x' });
      x.addEventListener('click', () => { this.attachedFiles = this.attachedFiles.filter((f) => f.path !== file.path); this.renderChips(); });
    }
  }

  private async sendPrompt(): Promise<void> {
    if (!this.composerEl || !this.api) return;
    const text = this.composerEl.value.trim();
    if (!text) return;
    if (!this.sessionId) { await this.newSession(); if (!this.sessionId) return; }
    const collected: CollectedContext = {
      notePath: this.noteContext?.path ?? null,
      selection: this.noteContext?.selection ?? null,
      files: this.attachedFiles,
    };
    const mode = this.plugin.settings.agentMode;
    if (mode === 'orchestrated') await this.applyProModel(this.sessionId);
    const base = mode === 'orchestrated' ? buildOrchestratedPrompt(text) : buildDirectPrompt(text);
    const prompt = composePrompt(base, collected, this.plugin.settings.contextMaxNoteBytes);
    this.composerEl.value = '';
    this.noteContext = null;
    this.attachedFiles = [];
    this.renderChips();
    const rpcId = this.api.newPromptRpcId();
    const result = await this.api.prompt(this.sessionId, prompt, 'queue', rpcId);
    if (!result.ok) {
      const message = (result as { error?: string }).error ?? '发送失败';
      new Notice('obsidian-dsh：' + message);
    }
  }

  private scheduleRender(): void {
    if (this.renderTimer) return;
    this.renderTimer = setTimeout(() => {
      this.renderTimer = null;
      this.renderMessages();
      this.renderApprovals();
    }, RENDER_BATCH_MS);
  }

  private renderMessages(): void {
    if (!this.messagesEl || !this.sessionId) return;
    const view = this.store.getView(this.sessionId);
    this.messagesEl.empty();
    if (!view || view.items.length === 0) {
      this.messagesEl.createDiv({ cls: 'odsh-welcome', text: '会话为空。输入指令开始，或从命令面板发送当前笔记/选区。' });
      return;
    }
    const vaultBase = this.vaultPath();
    for (const item of view.items) this.renderItem(item, vaultBase);
    if (view.streamingSeq !== null) this.messagesEl.createDiv({ cls: 'odsh-streaming', text: '正在回答…' });
  }

  private renderItem(item: import('./eventFold').ChatItem, vaultBase: string): void {
    if (!this.messagesEl || !this.app) return;
    switch (item.kind) {
      case 'user': {
        const wrap = this.messagesEl.createDiv({ cls: 'odsh-msg odsh-msg-user' });
        wrap.createDiv({ cls: 'odsh-bubble', text: item.text });
        break;
      }
      case 'assistant': {
        const wrap = this.messagesEl.createDiv({ cls: 'odsh-msg odsh-msg-assistant' });
        const text = item.parts.filter((p) => p.part === 'text').map((p) => p.text).join('');
        const reasoning = item.parts.filter((p) => p.part === 'reasoning').map((p) => p.text).join('');
        if (reasoning) {
          const details = wrap.createEl('details', { cls: 'odsh-reasoning' });
          details.createEl('summary', { text: '思考过程' });
          details.createEl('pre', { text: reasoning });
        }
        if (!item.done) {
          wrap.createDiv({ cls: 'odsh-markdown odsh-markdown-streaming', text: text });
        } else {
          const md = wrap.createDiv({ cls: 'odsh-markdown' });
          const linked = markdownForRender(text, (p) => this.plugin.app.vault.getAbstractFileByPath(p) !== null, vaultBase);
          void renderMarkdown(this.plugin.app, md, linked, '', this).then(() => this.upgradeFileLinks(md));
        }
        break;
      }
      case 'tool': {
        const wrap = this.messagesEl.createDiv({ cls: 'odsh-msg odsh-msg-tool' });
        createToolCard(wrap, { name: item.name, args: item.args, result: item.result, done: item.done, risk: classifyTool(item.name, item.args) });
        break;
      }
      case 'notice':
        createNotice(this.messagesEl, item.text);
        break;
    }
  }

  private upgradeFileLinks(container: HTMLElement): void {
    container.querySelectorAll<HTMLAnchorElement>('a[href^="obsidian-dsh-file://"]').forEach((a) => {
      const path = decodeURIComponent(a.getAttribute('href')?.slice('obsidian-dsh-file://'.length) ?? '');
      a.addEventListener('click', (event) => {
        event.preventDefault();
        const file = this.plugin.app.vault.getAbstractFileByPath(path);
        if (file) void this.plugin.app.workspace.getLeaf(false).openFile(file as never);
      });
    });
  }

  private renderApprovals(): void {
    if (!this.approvalsEl || !this.center) return;
    this.approvalsEl.empty();
    for (const pending of this.center.pendingApprovals) {
      const row = this.approvalsEl.createDiv({ cls: 'odsh-approval' });
      row.createSpan({ cls: 'odsh-approval-tool', text: pending.toolName });
      if (pending.reason) row.createSpan({ cls: 'odsh-approval-reason', text: pending.reason });
      const allow = row.createEl('button', { text: '允许一次', cls: 'odsh-approve' });
      allow.addEventListener('click', () => void this.center?.decideApproval(pending, 'allowed-once'));
      const reject = row.createEl('button', { text: '拒绝', cls: 'odsh-reject' });
      reject.addEventListener('click', () => void this.center?.decideApproval(pending, 'rejected'));
    }
    for (const pending of this.center.pendingQuestions) {
      const row = this.approvalsEl.createDiv({ cls: 'odsh-approval odsh-question' });
      row.createSpan({ text: pending.questions.map((q) => q.question).join(' · ') });
      const answer = row.createEl('button', { text: '回答', cls: 'odsh-approve' });
      answer.addEventListener('click', () => new QuestionModal(this.plugin.app, this.center!, pending).open());
    }
  }

  private renderStatus(): void {
    if (!this.statusDot || !this.statusLabel) return;
    const snapshot = this.plugin.server.getSnapshot();
    this.statusDot.className = 'odsh-dot odsh-state-' + snapshot.state;
    const labels: Record<string, string> = { stopped: '未运行', starting: '启动中…', running: '运行中', error: '错误' };
    this.statusLabel.setText(labels[snapshot.state] ?? snapshot.state);
  }
}
