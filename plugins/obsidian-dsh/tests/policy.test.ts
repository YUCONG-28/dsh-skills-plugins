import { describe, expect, it } from "vitest";
import { classifyTool, permissionSpec, PERMISSION_MODES } from "../src/approval/policy";

describe("permission policy", () => {
  it("maps the four requested modes to DSH sandbox/approval knobs", () => {
    expect(permissionSpec("read-only")).toMatchObject({ sandbox: "read-only", approval: "never" });
    expect(permissionSpec("ask-before-write")).toMatchObject({ sandbox: "read-only", approval: "ask" });
    expect(permissionSpec("workspace-write")).toMatchObject({ sandbox: "workspace-write", approval: "ask" });
    expect(permissionSpec("danger-full-access")).toMatchObject({ sandbox: "danger-full-access", approval: "ask" });
    expect(PERMISSION_MODES).toHaveLength(4);
  });

  it("classifies dangerous tools", () => {
    expect(classifyTool("delete_file")).toMatchObject({ level: "danger" });
    expect(classifyTool("bash").level).toBe("danger");
    expect(classifyTool("git", "git push origin main").level).toBe("danger");
    expect(classifyTool("edit").level).toBe("warning");
    expect(classifyTool("read").level).toBe("normal");
  });
});
