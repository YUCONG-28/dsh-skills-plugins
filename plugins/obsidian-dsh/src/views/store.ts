// Session view-model store: folds live mux events and history pages into one
// per-session view, with higher-seq-wins projections. No Obsidian imports.
import { EMPTY_FOLD, foldEvent, type FoldState } from "./eventFold";
import type { HistoryEntry, MuxFrameRaw, SessionEventRaw } from "../harness/types";

interface ProjectionCell {
  value: unknown;
  seq: number;
}

export interface SessionView extends FoldState {
  sessionId: string;
  title: string | null;
  running: boolean;
  lastSeq: number;
  firstSeq: number;
  plan: { active: boolean; pending: boolean };
  permissions: { preset: string | null; sandbox: string | null; approval: string | null };
}

export function createSessionView(sessionId: string): SessionView {
  return {
    ...EMPTY_FOLD,
    sessionId,
    title: null,
    running: false,
    lastSeq: -1,
    firstSeq: -1,
    plan: { active: false, pending: false },
    permissions: { preset: null, sandbox: null, approval: null },
  };
}

export class SessionStore {
  private views = new Map<string, SessionView>();
  private projections = new Map<string, Map<string, ProjectionCell>>();
  private listeners = new Set<() => void>();

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  ensureView(sessionId: string): SessionView {
    let view = this.views.get(sessionId);
    if (!view) {
      view = createSessionView(sessionId);
      this.views.set(sessionId, view);
    }
    return view;
  }

  getView(sessionId: string): SessionView | undefined {
    return this.views.get(sessionId);
  }

  dropView(sessionId: string): void {
    this.views.delete(sessionId);
    this.projections.delete(sessionId);
  }

  applyProjection(sessionId: string, key: string, value: unknown, seq: number): boolean {
    const cells = this.projections.get(sessionId) ?? new Map<string, ProjectionCell>();
    const prev = cells.get(key);
    if (prev && prev.seq >= seq) return false;
    cells.set(key, { value, seq });
    this.projections.set(sessionId, cells);
    const view = this.ensureView(sessionId);

    if (key === "title") {
      if (typeof value === "string" && value.length > 0) {
        view.title = value;
        return true;
      }
      return false;
    }
    if (key === "plan") {
      if (value && typeof value === "object") {
        const plan = value as { active?: boolean; pending?: boolean };
        view.plan = { active: plan.active === true, pending: plan.pending === true };
        return true;
      }
      return false;
    }
    if (key === "permissions") {
      if (value && typeof value === "object") {
        const perm = value as { preset?: string | null; sandbox?: string | null; approval?: string | null };
        view.permissions = {
          preset: typeof perm.preset === "string" ? perm.preset : null,
          sandbox: typeof perm.sandbox === "string" ? perm.sandbox : null,
          approval: typeof perm.approval === "string" ? perm.approval : null,
        };
        return true;
      }
      return false;
    }
    return false;
  }

  applyMux(rpcId: string, frame: MuxFrameRaw["payload"]): void {
    switch (frame.type) {
      case "session/event": {
        if (!frame.sessionId || !frame.event) return;
        const view = this.views.get(frame.sessionId);
        if (!view) return;
        this.foldInto(view, frame.event);
        this.notify();
        break;
      }
      case "session/subscribed": {
        if (!frame.sessionId) return;
        const view = this.views.get(frame.sessionId);
        if (!view) return;
        let changed = false;
        if (typeof frame.lastSeq === "number" && frame.lastSeq > view.lastSeq) {
          view.lastSeq = frame.lastSeq;
          changed = true;
        }
        if (view.running) {
          view.running = false;
          changed = true;
        }
        if (changed) this.notify();
        break;
      }
      case "session/projection": {
        if (!frame.sessionId) return;
        if (this.applyProjection(frame.sessionId, String(frame.key ?? ""), frame.value, Number(frame.seq ?? -1))) {
          this.notify();
        }
        break;
      }
      default:
        break;
    }
  }

  private foldInto(view: SessionView, event: SessionEventRaw): void {
    const folded = foldEvent(view, event);
    view.items = folded.items;
    view.streamingSeq = folded.streamingSeq;
    if (event.seq > view.lastSeq) view.lastSeq = event.seq;
    if (view.firstSeq < 0 || event.seq < view.firstSeq) view.firstSeq = event.seq;
  }

  seedHistory(sessionId: string, entries: HistoryEntry[]): void {
    const view = this.ensureView(sessionId);
    for (const entry of entries) this.foldInto(view, entry.event);
    this.notify();
  }

  prependHistory(sessionId: string, entries: HistoryEntry[]): void {
    const current = this.views.get(sessionId);
    const rebuilt = createSessionView(sessionId);
    for (const entry of entries) {
      const folded = foldEvent(rebuilt, entry.event);
      rebuilt.items = folded.items;
      rebuilt.streamingSeq = folded.streamingSeq;
      if (entry.event.seq > rebuilt.lastSeq) rebuilt.lastSeq = entry.event.seq;
      if (rebuilt.firstSeq < 0 || entry.event.seq < rebuilt.firstSeq) rebuilt.firstSeq = entry.event.seq;
    }
    if (current) {
      rebuilt.items = [...rebuilt.items, ...current.items];
      if (current.lastSeq > rebuilt.lastSeq) rebuilt.lastSeq = current.lastSeq;
      if (current.running) rebuilt.running = true;
      rebuilt.title = current.title ?? rebuilt.title;
      rebuilt.plan = current.plan.active || current.plan.pending ? current.plan : rebuilt.plan;
      rebuilt.permissions = current.permissions;
    }
    this.views.set(sessionId, rebuilt);
    this.notify();
  }

  setRunning(sessionId: string, running: boolean): void {
    const view = this.views.get(sessionId);
    if (!view || view.running === running) return;
    view.running = running;
    this.notify();
  }
}
