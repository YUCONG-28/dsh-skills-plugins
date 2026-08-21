// Pro/Flash model aliases and the Orchestrated agent preset. Real provider/model
// ids are resolved from the live catalog; these are user-editable aliases.
import type { ModelProviderGroup } from "../harness/types";

export interface OrchestrationConfig {
  proProvider: string;
  proModel: string;
  proEffort?: string;
  flashProvider: string;
  flashModel: string;
  flashEffort?: string;
  orchestratedPreset: string;
}

export const DEFAULT_ORCHESTRATION: OrchestrationConfig = {
  proProvider: "deepseek-official",
  proModel: "deepseek-v4-pro",
  proEffort: "high",
  flashProvider: "deepseek-official",
  flashModel: "deepseek-v4-flash",
  flashEffort: undefined,
  orchestratedPreset: "dsh-obsidian-orchestrated",
};

export function findModel(groups: ModelProviderGroup[], provider: string, model: string): boolean {
  const group = groups.find((g) => g.id === provider);
  if (!group) return false;
  return group.models.some((m) => m.id === model);
}

/** Build the model selection key (provider/model) used by the UI. */
export function modelKey(provider: string, model: string): string {
  return `${provider}/${model}`;
}
