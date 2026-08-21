import { describe, expect, it } from "vitest";
import { budgetText, composePrompt, formatContextBlock } from "../src/obsidian/contextPure";

describe("context budgeting", () => {
  it("does not truncate under budget", () => {
    expect(budgetText("abc", 100)).toEqual({ text: "abc", truncated: false });
  });

  it("truncates by bytes, not code units", () => {
    const result = budgetText("你好世界", 7);
    expect(result.truncated).toBe(true);
    expect(Buffer.byteLength(result.text, "utf8")).toBeLessThanOrEqual(7);
  });

  it("formats a truncated file block", () => {
    const block = formatContextBlock("Note.md", "x".repeat(100), 10);
    expect(block).toContain("## 文件: Note.md");
    expect(block).toContain("已截断");
  });

  it("composes prompt with note, selection and files", () => {
    const prompt = composePrompt(
      "do the thing",
      { notePath: "A.md", selection: "sel", files: [{ path: "B.md", content: "content" }] },
      1000,
    );
    expect(prompt).toContain("当前笔记: A.md");
    expect(prompt).toContain("## 文件: B.md");
    expect(prompt).toContain("选中文本");
    expect(prompt.endsWith("do the thing")).toBe(true);
  });
});
