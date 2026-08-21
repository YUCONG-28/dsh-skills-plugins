import { describe, expect, it } from "vitest";
import { EMPTY_FOLD, foldEvent, foldEvents, type FoldState } from "../src/views/eventFold";
import type { SessionEventRaw } from "../src/harness/types";

function ev(type: string, seq: number, data: Record<string, unknown> = {}, surfaceOp = "append"): SessionEventRaw {
  return { type, seq, data, surfaceOp };
}

describe("eventFold", () => {
  it("streams text and reasoning deltas into one assistant item", () => {
    let state: FoldState = EMPTY_FOLD;
    state = foldEvent(state, ev("assistant/chunk", 1, { chunk: { type: "text-delta", text: "Hel" } }));
    state = foldEvent(state, ev("assistant/chunk", 2, { chunk: { type: "text-delta", text: "lo" } }));
    state = foldEvent(state, ev("assistant/chunk", 3, { chunk: { type: "reasoning-delta", text: "think" } }));
    expect(state.items).toHaveLength(1);
    expect(state.items[0].kind).toBe("assistant");
    if (state.items[0].kind === "assistant") {
      expect(state.items[0].parts.map((p) => p.text)).toEqual(["Hel", "lo", "think"]);
      expect(state.items[0].done).toBe(false);
    }
    expect(state.streamingSeq).toBe(3);
  });

  it("final assistant message wins over streamed deltas", () => {
    let state = foldEvent(EMPTY_FOLD, ev("assistant/chunk", 1, { chunk: { type: "text-delta", text: "partial" } }));
    state = foldEvent(state, ev("assistant/message", 2, { message: { content: [{ type: "text", text: "final" }] } }));
    const item = state.items[0];
    expect(item.kind).toBe("assistant");
    if (item.kind === "assistant") {
      expect(item.done).toBe(true);
      expect(item.parts).toEqual([{ part: "text", text: "final" }]);
    }
  });

  it("pairs tool result to tool call by callId", () => {
    let state = foldEvent(EMPTY_FOLD, ev("tool/call", 1, { toolName: "bash", callId: "c1", input: { command: "ls" } }));
    state = foldEvent(state, ev("tool/result", 2, { callId: "c1", result: "ok" }));
    const item = state.items[0];
    expect(item.kind).toBe("tool");
    if (item.kind === "tool") {
      expect(item.done).toBe(true);
      expect(item.result).toBe("ok");
      expect(item.args).toContain("ls");
    }
  });

  it("folds user message and ignores non-user context injections", () => {
    const state = foldEvents([
      ev("user/message", 1, { source: { kind: "user" }, message: { content: [{ type: "text", text: "hi" }] } }),
      ev("user/message", 2, { source: { kind: "context" }, message: { content: [{ type: "text", text: "hidden" }] } }),
    ]);
    expect(state.items).toHaveLength(1);
    expect(state.items[0]).toMatchObject({ kind: "user", text: "hi" });
  });

  it("emits notice on blocked turn end", () => {
    const state = foldEvent(EMPTY_FOLD, ev("turn/end", 1, { reason: { kind: "blocked" } }));
    expect(state.items[0]).toMatchObject({ kind: "notice", text: "⛔ 回合被阻止" });
  });
});
