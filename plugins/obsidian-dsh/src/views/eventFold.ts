// Pure fold from DSH SessionEvent stream -> flat display items. Live mux
// frames and history replay share this exact path so the UI never has two
// renderings of the same event.
import { extractMessageText, type SessionEventRaw } from "../harness/types";

export type AssistantPart = { part: "text" | "reasoning"; text: string };

export type ChatItem =
  | { kind: "user"; text: string; seq: number }
  | { kind: "assistant"; parts: AssistantPart[]; done: boolean; seq: number }
  | { kind: "tool"; name: string; args: string; result: string | null; done: boolean; seq: number; callId: string | null }
  | { kind: "notice"; text: string; seq: number };

export interface FoldState {
  items: ChatItem[];
  streamingSeq: number | null;
}

export const EMPTY_FOLD: FoldState = { items: [], streamingSeq: null };

function cloneItems(state: FoldState): ChatItem[] {
  return state.items.map((item) => (item.kind === "assistant" ? { ...item, parts: [...item.parts] } : { ...item }));
}

function pushPart(items: ChatItem[], seq: number, part: AssistantPart["part"], text: string): void {
  const last = items[items.length - 1];
  if (last?.kind === "assistant" && !last.done) {
    last.parts.push({ part, text });
    last.seq = seq;
    return;
  }
  items.push({ kind: "assistant", parts: [{ part, text }], done: false, seq });
}

function closeStreamingAssistant(items: ChatItem[]): void {
  const last = items[items.length - 1];
  if (last?.kind === "assistant" && !last.done) {
    items[items.length - 1] = { ...last, done: true };
  }
}

function replaceAssistantText(items: ChatItem[], seq: number, text: string): void {
  const last = items[items.length - 1];
  if (last?.kind === "assistant" && !last.done) {
    last.parts = text ? [{ part: "text", text }] : [];
    last.done = true;
    last.seq = seq;
    return;
  }
  if (text) items.push({ kind: "assistant", parts: [{ part: "text", text }], done: true, seq });
}

function isAppendSurface(event: SessionEventRaw): boolean {
  return event.surfaceOp === "append";
}

function stringifyInput(input: unknown): string {
  try {
    return JSON.stringify(input, null, 2) ?? "{}";
  } catch {
    return String(input);
  }
}

export function foldEvent(state: FoldState, event: SessionEventRaw): FoldState {
  const items = cloneItems(state);
  let streamingSeq = state.streamingSeq;
  switch (event.type) {
    case "user/message": {
      if (!isAppendSurface(event)) break;
      const source = ((event.data ?? {}) as Record<string, unknown>).source as Record<string, unknown> | undefined;
      if (source?.kind !== "user") break;
      const text = extractMessageText(event.data).trim();
      if (text) items.push({ kind: "user", text, seq: event.seq });
      break;
    }
    case "assistant/chunk": {
      const data = (event.data ?? {}) as Record<string, unknown>;
      const chunk = (data.chunk ?? {}) as Record<string, unknown>;
      const delta = typeof chunk.text === "string" ? chunk.text : "";
      if (chunk.type === "reasoning-delta" && delta) {
        pushPart(items, event.seq, "reasoning", delta);
        streamingSeq = event.seq;
      } else if (chunk.type === "text-delta" && delta) {
        pushPart(items, event.seq, "text", delta);
        streamingSeq = event.seq;
      }
      break;
    }
    case "assistant/message": {
      if (!isAppendSurface(event)) break;
      replaceAssistantText(items, event.seq, extractMessageText(event.data).trim());
      streamingSeq = null;
      break;
    }
    case "tool/call": {
      const data = (event.data ?? {}) as Record<string, unknown>;
      const name = data.toolName ?? data.name;
      if (typeof name !== "string") break;
      items.push({
        kind: "tool",
        name,
        args: stringifyInput(data.input ?? data.args ?? {}),
        result: null,
        done: false,
        seq: event.seq,
        callId: typeof data.callId === "string" ? data.callId : null,
      });
      break;
    }
    case "tool/result": {
      if (!isAppendSurface(event)) break;
      const data = (event.data ?? {}) as Record<string, unknown>;
      const resultText = typeof data.result === "string" ? data.result : stringifyInput(data.result ?? data);
      const callId = typeof data.callId === "string" ? data.callId : null;
      let matched = false;
      for (let i = items.length - 1; i >= 0; i--) {
        const item = items[i];
        if (item.kind !== "tool" || item.done) continue;
        if (callId !== null && item.callId !== null && item.callId !== callId) continue;
        items[i] = { ...item, result: resultText, done: true, seq: event.seq };
        matched = true;
        break;
      }
      if (!matched) {
        items.push({ kind: "tool", name: "tool", args: "", result: resultText, done: true, seq: event.seq, callId });
      }
      break;
    }
    case "turn/start": {
      streamingSeq = null;
      break;
    }
    case "turn/end": {
      closeStreamingAssistant(items);
      const data = (event.data ?? {}) as Record<string, unknown>;
      const reason = (data.reason ?? {}) as Record<string, unknown>;
      if (reason.kind === "error") {
        items.push({ kind: "notice", text: `⚠ ${typeof reason.message === "string" ? reason.message : "回合出错"}`, seq: event.seq });
      } else if (reason.kind === "notice" && typeof reason.message === "string") {
        items.push({ kind: "notice", text: reason.message, seq: event.seq });
      } else if (reason.kind === "aborted" || reason.kind === "interrupted") {
        items.push({ kind: "notice", text: "⏹ 回答已中断", seq: event.seq });
      } else if (reason.kind === "blocked") {
        items.push({ kind: "notice", text: "⛔ 回合被阻止", seq: event.seq });
      } else if (reason.kind === "max-tokens") {
        items.push({ kind: "notice", text: "⏹ 输出已达上限", seq: event.seq });
      }
      streamingSeq = null;
      break;
    }
    default:
      break;
  }
  return { items, streamingSeq };
}

export function foldEvents(events: SessionEventRaw[]): FoldState {
  return events.reduce(foldEvent, EMPTY_FOLD);
}
