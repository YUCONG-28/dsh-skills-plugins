// Permission preset mapping + dangerous-operation classification. DSH
// enforces sandbox/approval; this module supplies the user-facing labels and
// the companion preset names the plugin writes through settings.mutate.
export type PermissionMode = "read-only" | "ask-before-write" | "workspace-write" | "danger-full-access";

export interface PermissionSpec {
  mode: PermissionMode;
  preset: string;
  sandbox: "read-only" | "workspace-write" | "danger-full-access";
  approval: "ask" | "never";
  label: string;
  description: string;
}

export const PERMISSION_MODES: PermissionSpec[] = [
  {
    mode: "read-only",
    preset: "read-only",
    sandbox: "read-only",
    approval: "never",
    label: "Read Only",
    description: "完全只读：任何写入都被确定性拒绝，不弹窗。",
  },
  {
    mode: "ask-before-write",
    preset: "ask-before-write",
    sandbox: "read-only",
    approval: "ask",
    label: "Ask Before Write",
    description: "读取自动放行；任何写入/危险操作触发一次性询问。",
  },
  {
    mode: "workspace-write",
    preset: "workspace-write",
    sandbox: "workspace-write",
    approval: "ask",
    label: "Workspace Write",
    description: "工作区内写入自动放行；越界或危险操作仍询问。",
  },
  {
    mode: "danger-full-access",
    preset: "danger-full-access",
    sandbox: "danger-full-access",
    approval: "ask",
    label: "Full Access",
    description: "全量能力，但删除/Shell/Push 等危险操作仍须确认。",
  },
];

export function permissionSpec(mode: PermissionMode): PermissionSpec {
  return PERMISSION_MODES.find((p) => p.mode === mode) ?? PERMISSION_MODES[2];
}

export type RiskLevel = "danger" | "warning" | "normal";

export interface ToolRisk {
  level: RiskLevel;
  label: string;
}

const DANGEROUS_TOOLS = new Set(["delete", "delete_file", "delete_file_or_dir", "trash", "shell", "bash", "terminal", "pwsh", "git"]);
const DANGEROUS_ARG_HINTS = ["push", "force", "hard reset", "clean -fd", "rm -rf", "drop database"];

export function classifyTool(toolName: string, args?: string): ToolRisk {
  const name = toolName.toLowerCase();
  const argText = (args ?? "").toLowerCase();
  const dangerousByHint = DANGEROUS_ARG_HINTS.some((hint) => argText.includes(hint));
  const isWrite = /(write|edit|create|move|rename|remove|delete|trash|append|patch|apply)/.test(name);
  if (DANGEROUS_TOOLS.has(name) || dangerousByHint) {
    return { level: "danger", label: "需确认" };
  }
  if (isWrite) {
    return { level: "warning", label: "写操作" };
  }
  return { level: "normal", label: "常规" };
}
