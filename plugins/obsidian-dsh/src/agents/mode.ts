export type AgentMode = "direct" | "orchestrated";

export const AGENT_MODES: { mode: AgentMode; label: string; description: string }[] = [
  { mode: "direct", label: "Direct", description: "直接与当前模型对话" },
  { mode: "orchestrated", label: "Orchestrated", description: "Pro 拆任务 → 多个 Flash 并行 → Pro Review" },
];
