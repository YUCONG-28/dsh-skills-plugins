import { describe, expect, it } from "vitest";
import { linkifyVaultPaths, normalizeVaultPath, splitFenced, vaultRelativePath } from "../src/obsidian/links";

const fence = String.fromCharCode(96);

describe("vault path linkify", () => {
  it("turns .md paths into wikilinks", () => {
    const out = linkifyVaultPaths("see Notes/Hello.md please", (p) => p === "Notes/Hello.md", null);
    expect(out).toContain("[[Notes/Hello.md]]");
  });

  it("turns non-md files into custom links", () => {
    const out = linkifyVaultPaths("open data.csv", (p) => p === "data.csv", null);
    expect(out).toContain("(obsidian-dsh-file://data.csv)");
  });

  it("leaves fenced code untouched", () => {
    const markdown = fence + fence + fence + "\nNotes/Hello.md\n" + fence + fence + fence;
    const out = linkifyVaultPaths(markdown, (p) => p === "Notes/Hello.md", null);
    expect(out).not.toContain("[[Notes/Hello.md]]");
  });

  it("rejects escaping paths", () => {
    expect(vaultRelativePath("../secret.md", null)).toBeNull();
    expect(vaultRelativePath("/etc/passwd", null)).toBeNull();
    expect(normalizeVaultPath("./Notes/Hello.md")).toBe("Notes/Hello.md");
  });

  it("splits fenced segments", () => {
    const markdown = "a\n" + fence + fence + fence + "\ncode\n" + fence + fence + fence + "\nb";
    const segments = splitFenced(markdown);
    expect(segments.map((s) => s.code)).toEqual([false, false, true, true, false]);
  });
});
