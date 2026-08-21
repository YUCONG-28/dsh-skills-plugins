import { describe, expect, it } from "vitest";
import { buildDirectPrompt, buildOrchestratedPrompt } from "../src/agents/orchestrator";

describe("orchestrator prompts", () => {
  it("builds direct prompt verbatim", () => {
    expect(buildDirectPrompt("hello")).toBe("hello");
  });

  it("builds orchestrated prompt with pro strategy", () => {
    const prompt = buildOrchestratedPrompt("ship feature");
    expect(prompt).toContain("任务：ship feature");
    expect(prompt).toContain("DeepSeek Pro orchestrator");
    expect(prompt).toContain("Flash subagents");
  });
});
