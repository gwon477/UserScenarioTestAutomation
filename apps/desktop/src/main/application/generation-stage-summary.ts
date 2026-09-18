import {
  GENERATION_STEPS,
  type FactBundle,
  type FactCatalog,
  type ScenarioSet,
  type ScenarioSkeleton,
  type WikiBundle,
} from "@scenarioforge/contracts";
import type { GenerationStageResult } from "@scenarioforge/scenario-pipeline";

export type GenerationStageSummary = {
  completed: boolean;
  progress: number;
  factCount: number;
  wikiPages: number;
  scenarios: number;
};

export function summarizeGenerationStageResult(result: GenerationStageResult): GenerationStageSummary {
  let factCount = 0;
  let wikiPages = 0;
  let scenarios = 0;

  if (result.step === "fact-catalog") {
    const catalog = result.artifact as FactCatalog;
    factCount = catalog.screens.length + catalog.predicates.length;
  } else if (result.step === "assembled-fact") {
    const facts = result.artifact as FactBundle;
    factCount = facts.screens.length + facts.edges.length + facts.predicates.length;
  } else if (result.step === "reachable-workflow-skeleton" || result.step === "common-wiki") {
    wikiPages = (result.artifact as WikiBundle).workflows.length;
  } else if (result.step === "scenario-skeleton") {
    scenarios = (result.artifact as ScenarioSkeleton).scenarios.length;
  } else if (result.step === "scenario-narration") {
    scenarios = (result.artifact as ScenarioSet).scenarios.length;
  }

  return {
    completed: result.step === "coverage-manifest",
    progress: (GENERATION_STEPS.indexOf(result.step) + 1) * 10,
    factCount,
    wikiPages,
    scenarios,
  };
}
