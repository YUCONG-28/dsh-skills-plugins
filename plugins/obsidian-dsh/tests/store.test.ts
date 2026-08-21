import { describe, expect, it } from "vitest";
import { SessionStore } from "../src/views/store";
import type { SessionEventRaw } from "../src/harness/types";

describe("SessionStore", () => {
  it("seeds history and folds live events", () => {
    const store = new SessionStore();
    const user: SessionEventRaw = { type: "user/message", seq: 1, surfaceOp: "append", data: { source: { kind: "user" }, message: { content: [{ type: "text", text: "hi" }] } } };
    store.seedHistory("s1", [{ event: user }]);
    expect(store.getView("s1")?.items).toHaveLength(1);
  });

  it("applies higher-seq-wins projections", () => {
    const store = new SessionStore();
    expect(store.applyProjection("s1", "title", "old", 1)).toBe(true);
    expect(store.applyProjection("s1", "title", "old-again", 1)).toBe(false);
    expect(store.applyProjection("s1", "title", "new", 2)).toBe(true);
    expect(store.getView("s1")?.title).toBe("new");
  });

  it("parses permissions projection", () => {
    const store = new SessionStore();
    store.applyProjection("s1", "permissions", { preset: "workspace-write", sandbox: "workspace-write", approval: "ask" }, 3);
    expect(store.getView("s1")?.permissions).toEqual({ preset: "workspace-write", sandbox: "workspace-write", approval: "ask" });
  });
});
