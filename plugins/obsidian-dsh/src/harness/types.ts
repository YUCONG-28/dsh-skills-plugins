// Wire contract for the local dsh web /api surface. Deliberately defensive:
// unknown fields are tolerated, missing fields fall back; the plugin must keep
// working (or fail loudly with a useful message) when DSH changes its contract.
// Pure module — no Obsidian imports, safe for Node tests.

export type RpcId = string;
export type SessionId = string;
export type ApprovalId = string;

export interface WireEnvelope {
  type: "client-request" | "server-response" | "client-response" | "server-request";
  rpcId: string;
  method?: string;
  payload?: unknown;
  result?: RpcResult<unknown>;
}

export interface RpcError {
  code?: string;
  message?: string;
  details?: unknown;
}

export type RpcResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: RpcError };

export type WireResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

export interface SessionSummaryRaw {
  sessionId: string;
  updatedAt?: number;
  running?: boolean;
  blank?: boolean;
  cwd?: string;
  agentPreset?: string;
  parentSessionId?: string;
  origin?: "subagent" | string;
  projections?: { asOfSeq?: number; values?: Record<string, unknown> };
}

export interface SessionSummary extends SessionSummaryRaw {
  title: string | null;
}

export interface SessionEventRaw {
  type: string;
  seq: number;
  time?: number;
  data?: Record<string, unknown>;
  surfaceOp?: string;
}

export interface MuxFrameRaw {
  rpcId: string;
  payload: {
    type: string;
    sessionId?: string;
    event?: SessionEventRaw;
    view?: unknown;
    lastSeq?: number;
    approvalId?: string;
    toolName?: string;
    callId?: string;
    reason?: string;
    outcome?: string;
    questions?: AskUserQuestionItem[];
    questionRpcId?: string;
    items?: unknown[];
    jobs?: unknown[];
    key?: string;
    value?: unknown;
    seq?: number;
    error?: RpcError;
    [key: string]: unknown;
  };
}

export interface HostFrameRaw {
  rpcId: string;
  payload: {
    type: string;
    sessionId?: string;
    running?: boolean;
    blank?: boolean;
    parentSessionId?: string;
    origin?: "subagent" | string;
    cwd?: string;
    agentPreset?: string;
    message?: string;
    workspace?: unknown;
    workspaceId?: string;
    workspaceIds?: string[];
    archivedSessionIds?: string[];
    [key: string]: unknown;
  };
}

export interface ModelEffort {
  id: string;
  name: string;
  description?: string;
}

export interface ModelReasoning {
  efforts: ModelEffort[];
  defaultEffort?: string;
}

export interface ModelCatalogModel {
  id: string;
  name: string;
  description?: string;
  reasoning?: ModelReasoning;
}

export interface ModelProviderGroup {
  id: string;
  name: string;
  models: ModelCatalogModel[];
}

export interface ModelSelection {
  provider: string;
  model: string;
  reasoningEffort?: string;
}

export interface SessionModels {
  current: ModelSelection;
  routable: boolean;
  groups: ModelProviderGroup[];
  failures: { id: string; name: string; message: string }[];
}

export interface HistoryEntry {
  event: SessionEventRaw;
  view?: unknown;
}

export interface PromptContentPart {
  type: "text";
  text: string;
}

export interface AgentPresetSummary {
  id: string;
  isDefault?: boolean;
  name?: string | null;
  broken?: string;
}

export interface AskUserQuestionOption {
  label: string;
  description?: string;
}

export interface AskUserQuestionItem {
  id: string;
  question: string;
  header?: string;
  options?: AskUserQuestionOption[];
  multiSelect?: boolean;
}

export interface ApprovalResponsePayload {
  sessionId: string;
  approvalId: string;
  outcome: "allowed-once" | "rejected";
}

export interface QuestionResponsePayload {
  sessionId: string;
  answer: { answers: { id: string; selected: string[]; custom?: string }[] };
}

/** Extract text from a message-ish content-block payload. */
export function extractMessageText(data: unknown): string {
  if (!data || typeof data !== "object") return "";
  const record = data as Record<string, unknown>;
  const message = (record.message ?? record) as Record<string, unknown>;
  const content = message.content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => {
      if (block && typeof block === "object" && (block as Record<string, unknown>).type === "text") {
        const text = (block as Record<string, unknown>).text;
        return typeof text === "string" ? text : "";
      }
      return "";
    })
    .join("");
}

/** Normalise a raw session summary into the view-facing shape. */
export function summarizeSession(raw: SessionSummaryRaw): SessionSummary {
  const values = raw.projections?.values ?? {};
  const title = typeof values.title === "string" && values.title.length > 0 ? values.title : null;
  return { ...raw, title };
}
