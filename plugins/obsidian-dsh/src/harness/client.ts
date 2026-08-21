// Thin typed facade over the dsh web /api unary surface. Business logic
// stays in agents/views; this module only does envelopes and payload mapping.
import * as crypto from "crypto";
import { postJson } from "./transport";
import {
  extractMessageText,
  type AgentPresetSummary,
  type ApprovalResponsePayload,
  type HistoryEntry,
  type PromptContentPart,
  type QuestionResponsePayload,
  type RpcResult,
  type SessionModels,
  type SessionSummaryRaw,
  type WireEnvelope,
  type WireResult,
  summarizeSession,
} from "./types";

export type { WireResult };

export class DshApiClient {
  constructor(readonly baseUrl: string) {}

  private async unary<T>(method: string, payload: unknown, rpcId: string = crypto.randomUUID()): Promise<WireResult<T>> {
    const message: WireEnvelope = { type: "client-request", rpcId, method, payload };
    let result: { status: number; body: string };
    try {
      result = await postJson(this.baseUrl, `/api/${method}`, message);
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
    if (result.status < 200 || result.status >= 300) {
      return { ok: false, error: `HTTP ${result.status}` };
    }
    let full: WireEnvelope;
    try {
      full = JSON.parse(result.body) as WireEnvelope;
    } catch {
      return { ok: false, error: "响应不是合法 JSON" };
    }
    if (full.type !== "server-response" || full.rpcId !== rpcId) {
      return { ok: false, error: "响应信封不匹配" };
    }
    const envelope = full.result as RpcResult<unknown> | undefined;
    if (!envelope || envelope.ok !== true) {
      const err = envelope && envelope.ok === false ? envelope.error : undefined;
      return { ok: false, error: err?.message ?? "服务端错误" };
    }
    return { ok: true, value: envelope.value as T };
  }

  async hostDescribe(): Promise<WireResult<{
    version: string;
    cwd: string;
    provider?: string;
    model?: string;
    attachedSessions: number;
    home: string;
    canOpenPath: boolean;
  }>> {
    return this.unary("host.describe", {});
  }

  async hostPickDirectory(): Promise<string | null> {
    const result = await this.unary<{ path: string | null }>("host.pickDirectory", {});
    if (!result.ok) return null;
    return result.value?.path ?? null;
  }

  async listSessions(): Promise<{ sessions: ReturnType<typeof summarizeSession>[]; error?: string }> {
    const result = await this.unary<{ items?: SessionSummaryRaw[] }>("session.list", {});
    if (!result.ok) return { sessions: [], error: result.error };
    if (!result.value?.items) return { sessions: [] };
    return { sessions: result.value.items.map(summarizeSession) };
  }

  async createSession(payload: { cwd?: string; workspaceId?: string; agentPreset?: string } = {}): Promise<string | null> {
    const result = await this.unary<{ sessionId?: string; agentPreset?: string }>("session.create", payload);
    if (!result.ok || !result.value?.sessionId) return null;
    return result.value.sessionId;
  }

  async history(sessionId: string, maxMessages = 100, beforeSeq?: number): Promise<{
    events: HistoryEntry[];
    hasMore: boolean;
    projections?: Record<string, unknown>;
    error?: string;
  }> {
    const result = await this.unary<{ events?: HistoryEntry[]; hasMore?: boolean; projections?: { values?: Record<string, unknown> } }>(
      "session.history",
      { sessionId, maxMessages, ...(beforeSeq !== undefined ? { beforeSeq } : {}) },
    );
    if (!result.ok) return { events: [], hasMore: false, error: result.error };
    return {
      events: result.value?.events ?? [],
      hasMore: result.value?.hasMore ?? false,
      projections: result.value?.projections?.values,
    };
  }

  async prompt(sessionId: string, text: string, mode: "queue" | "steer" = "queue", rpcId?: string): Promise<WireResult<{ accepted: true }>> {
    const content: PromptContentPart[] = [{ type: "text", text }];
    return this.unary<{ accepted: true }>("session.prompt", { sessionId, mode, content }, rpcId);
  }

  async cancel(sessionId: string): Promise<WireResult<{ accepted: true }>> {
    return this.unary<{ accepted: true }>("session.cancel", { sessionId });
  }

  async rename(sessionId: string, title: string): Promise<WireResult<{ title: string; seq: number }>> {
    return this.unary("session.rename", { sessionId, title });
  }

  async sessionModels(sessionId: string): Promise<WireResult<SessionModels>> {
    const result = await this.unary<SessionModels>("session.models", { sessionId });
    if (!result.ok) return result;
    // Tolerate older/looser catalog shapes by ensuring arrays exist.
    const value = result.value as Partial<SessionModels> & Record<string, unknown>;
    return {
      ok: true,
      value: {
        current: value.current ?? { provider: "", model: "" },
        routable: value.routable !== false,
        groups: value.groups ?? [],
        failures: value.failures ?? [],
      },
    };
  }

  async selectModel(sessionId: string, provider: string, model: string, reasoningEffort?: string): Promise<boolean> {
    const result = await this.unary<unknown>("session.selectModel", {
      sessionId,
      provider,
      model,
      ...(reasoningEffort ? { reasoningEffort } : {}),
    });
    return result.ok === true;
  }

  async listAgentPresets(): Promise<AgentPresetSummary[]> {
    const result = await this.unary<{ presets?: AgentPresetSummary[] }>("agentPreset.list", {});
    if (!result.ok || !result.value?.presets) return [];
    return result.value.presets;
  }

  async selectAgentPreset(sessionId: string, agentPreset: string): Promise<boolean> {
    const result = await this.unary<unknown>("agentPreset.select", { sessionId, agentPreset });
    return result.ok === true;
  }

  async listWorkspaces(): Promise<{ items: { workspaceId: string; path: string; title: string; sessionIds: string[] }[]; archivedSessionIds: string[]; error?: string }> {
    const result = await this.unary<{ items?: { workspaceId: string; path: string; title: string; sessionIds: string[] }[]; archivedSessionIds?: string[] }>("workspace.list", {});
    if (!result.ok) return { items: [], archivedSessionIds: [], error: result.error };
    return { items: result.value?.items ?? [], archivedSessionIds: result.value?.archivedSessionIds ?? [] };
  }

  async createWorkspace(path: string): Promise<WireResult<{ workspaceId: string; created: boolean }>> {
    return this.unary("workspace.create", { path });
  }

  async archiveSession(sessionId: string): Promise<WireResult<{ archivedSessionIds: string[] }>> {
    return this.unary("workspace.archiveSession", { sessionId });
  }

  async settingsDescribe(): Promise<WireResult<{ namespaces?: { ns: string; value?: unknown; revision?: number }[] }>> {
    return this.unary("settings.describe", {});
  }

  async settingsMutate(ns: string, ops: { op: "set"; path: (string | number)[]; value: unknown }[]): Promise<boolean> {
    const result = await this.unary<unknown>("settings.mutate", { ns, ops });
    return result.ok === true;
  }

  async respond(rpcId: string, value: ApprovalResponsePayload | QuestionResponsePayload): Promise<{ accepted: boolean; reason?: string }> {
    const message: WireEnvelope = { type: "client-response", rpcId, result: { ok: true, value } };
    let result: { status: number; body: string };
    try {
      result = await postJson(this.baseUrl, "/api/respond", message, 15000);
    } catch (error) {
      return { accepted: false, reason: error instanceof Error ? error.message : String(error) };
    }
    if (result.status < 200 || result.status >= 300) return { accepted: false, reason: `HTTP ${result.status}` };
    try {
      const receipt = JSON.parse(result.body) as { accepted?: boolean; reason?: string };
      return { accepted: receipt.accepted === true, reason: receipt.reason };
    } catch {
      return { accepted: false, reason: "bad-response" };
    }
  }

  newPromptRpcId(): string {
    return crypto.randomUUID();
  }
}

export { extractMessageText };
