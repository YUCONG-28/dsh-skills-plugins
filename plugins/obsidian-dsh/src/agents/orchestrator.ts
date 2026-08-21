// Orchestrated-mode prompt assembly. The actual decomposition/parallel/review
// runs inside DSH's agent loop via the subagent/workflow tools; this module only
// prepares the user goal and records which official primitives to use.
export const ORCHESTRATION_SYSTEM_HINT = [
  "You are the DeepSeek Pro orchestrator.",
  "1. Break the request into small independent tasks.",
  "2. Dispatch each task in parallel to DeepSeek Flash subagents using the official subagent/workflow tools.",
  "3. Review every result, fix or re-dispatch failures.",
  "4. Integrate the results into one final answer (and apply changes only when the user asked for them).",
].join("\n");

export interface OrchestrationPlan {
  mode: "orchestrated";
  goal: string;
  strategy: string;
}

export function buildOrchestratedPrompt(goal: string): string {
  const trimmed = goal.trim();
  return `任务：${trimmed}\n\n${ORCHESTRATION_SYSTEM_HINT}`;
}

export function buildDirectPrompt(goal: string): string {
  return goal;
}
