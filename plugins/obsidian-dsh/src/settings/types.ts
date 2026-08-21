import type { AgentMode } from "../agents/mode";
import type { PermissionMode } from "../approval/policy";

export type ViewPlacement = "right-sidebar" | "left-sidebar" | "tab" | "window";
export type Lifecycle = "leave-running" | "stop-on-exit";

export interface ObsidianDshSettings {
  dshExecutable: string;
  fixedPort: number;
  lifecycle: Lifecycle;
  viewPlacement: ViewPlacement;
  autoStart: boolean;
  openOnStartup: boolean;
  agentMode: AgentMode;
  permissionMode: PermissionMode;
  contextMaxNoteBytes: number;
  mentionMaxChars: number;
  historyPageSize: number;
  proProvider: string;
  proModel: string;
  proEffort?: string;
  flashProvider: string;
  flashModel: string;
  flashEffort?: string;
  orchestratedPreset: string;
}

export const DEFAULT_SETTINGS: ObsidianDshSettings = {
  dshExecutable: "",
  fixedPort: 3080,
  lifecycle: "leave-running",
  viewPlacement: "right-sidebar",
  autoStart: true,
  openOnStartup: false,
  agentMode: "direct",
  permissionMode: "workspace-write",
  contextMaxNoteBytes: 20000,
  mentionMaxChars: 8000,
  historyPageSize: 50,
  proProvider: "deepseek-official",
  proModel: "deepseek-v4-pro",
  proEffort: "high",
  flashProvider: "deepseek-official",
  flashModel: "deepseek-v4-flash",
  flashEffort: undefined,
  orchestratedPreset: "dsh-obsidian-orchestrated",
};
