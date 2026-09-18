import {
  GENERATION_STEPS,
  type AnalysisStage,
  type GenerationArtifactType,
  type GenerationStep,
  type GenerationStepWorkKind,
} from "@scenarioforge/contracts";

export type GenerationStepPolicy = Readonly<{
  step: GenerationStep;
  stage: AnalysisStage;
  workKind: GenerationStepWorkKind;
  executor: "deterministic" | "llm";
  inputArtifactTypes: readonly GenerationArtifactType[];
  outputArtifactType: GenerationArtifactType;
  contextBudgetBytes: number;
  evidenceBudgetBytes: number;
  review: "none" | "independent";
  maxRepairs: number;
  partitionBy: "project" | "screen" | "journey-action" | "knowledge-page" | "business-classification";
}>;

const policy = (value: GenerationStepPolicy): GenerationStepPolicy => Object.freeze(value);

export const generationStepRegistry: Readonly<Record<GenerationStep, GenerationStepPolicy>> = Object.freeze({
  "source-scan": policy({ step: "source-scan", stage: "src", workKind: "analysis.source-scan", executor: "deterministic", inputArtifactTypes: [], outputArtifactType: "source-snapshot", contextBudgetBytes: 0, evidenceBudgetBytes: 0, review: "none", maxRepairs: 0, partitionBy: "project" }),
  "fact-catalog": policy({ step: "fact-catalog", stage: "fact", workKind: "analysis.fact-catalog", executor: "llm", inputArtifactTypes: ["source-snapshot"], outputArtifactType: "fact-catalog", contextBudgetBytes: 112_000, evidenceBudgetBytes: 400_000, review: "independent", maxRepairs: 6, partitionBy: "screen" }),
  "edge-ledger": policy({ step: "edge-ledger", stage: "fact", workKind: "analysis.edge-ledger", executor: "llm", inputArtifactTypes: ["source-snapshot", "fact-catalog"], outputArtifactType: "edge-ledger", contextBudgetBytes: 120_000, evidenceBudgetBytes: 400_000, review: "independent", maxRepairs: 6, partitionBy: "journey-action" }),
  "assembled-fact": policy({ step: "assembled-fact", stage: "fact", workKind: "analysis.fact-assemble", executor: "deterministic", inputArtifactTypes: ["fact-catalog", "edge-ledger"], outputArtifactType: "fact-bundle", contextBudgetBytes: 0, evidenceBudgetBytes: 0, review: "none", maxRepairs: 0, partitionBy: "project" }),
  "reachable-workflow-skeleton": policy({ step: "reachable-workflow-skeleton", stage: "wiki", workKind: "analysis.workflow-skeleton", executor: "deterministic", inputArtifactTypes: ["fact-bundle"], outputArtifactType: "workflow-skeleton", contextBudgetBytes: 0, evidenceBudgetBytes: 0, review: "none", maxRepairs: 0, partitionBy: "project" }),
  "common-wiki": policy({ step: "common-wiki", stage: "wiki", workKind: "analysis.common-wiki", executor: "llm", inputArtifactTypes: ["source-snapshot", "fact-bundle", "workflow-skeleton"], outputArtifactType: "wiki-bundle", contextBudgetBytes: 72_000, evidenceBudgetBytes: 0, review: "independent", maxRepairs: 1, partitionBy: "project" }),
  "business-catalog": policy({ step: "business-catalog", stage: "wiki", workKind: "analysis.business-catalog", executor: "llm", inputArtifactTypes: ["workflow-skeleton", "wiki-bundle"], outputArtifactType: "business-catalog", contextBudgetBytes: 48_000, evidenceBudgetBytes: 0, review: "independent", maxRepairs: 1, partitionBy: "project" }),
  "scenario-skeleton": policy({ step: "scenario-skeleton", stage: "scenario", workKind: "analysis.scenario-skeleton", executor: "deterministic", inputArtifactTypes: ["fact-bundle", "workflow-skeleton", "wiki-bundle", "business-catalog"], outputArtifactType: "scenario-skeleton", contextBudgetBytes: 0, evidenceBudgetBytes: 0, review: "none", maxRepairs: 0, partitionBy: "project" }),
  "scenario-narration": policy({ step: "scenario-narration", stage: "scenario", workKind: "analysis.scenario-narration", executor: "llm", inputArtifactTypes: ["source-snapshot", "fact-bundle", "wiki-bundle", "business-catalog", "scenario-skeleton"], outputArtifactType: "scenario-set", contextBudgetBytes: 72_000, evidenceBudgetBytes: 0, review: "independent", maxRepairs: 1, partitionBy: "project" }),
  "coverage-manifest": policy({ step: "coverage-manifest", stage: "scenario", workKind: "analysis.coverage-manifest", executor: "deterministic", inputArtifactTypes: ["fact-bundle", "scenario-set"], outputArtifactType: "coverage-manifest", contextBudgetBytes: 0, evidenceBudgetBytes: 0, review: "none", maxRepairs: 0, partitionBy: "project" }),
});

export function validateGenerationStepRegistry(): { ok: boolean; issues: string[] } {
  const issues: string[] = [];
  const outputOwners = new Map<GenerationArtifactType, GenerationStep>();
  for (const [index, step] of GENERATION_STEPS.entries()) {
    const entry = generationStepRegistry[step];
    if (!entry || entry.step !== step) issues.push(`REGISTRY_STEP_MISSING:${step}`);
    if (entry.executor === "deterministic" && (entry.contextBudgetBytes !== 0 || entry.review !== "none")) issues.push(`DETERMINISTIC_POLICY_INVALID:${step}`);
    if (entry.executor === "llm" && (entry.contextBudgetBytes <= 0 || entry.review !== "independent")) issues.push(`LLM_POLICY_INVALID:${step}`);
    if (!Number.isSafeInteger(entry.evidenceBudgetBytes) || entry.evidenceBudgetBytes < 0) issues.push(`EVIDENCE_BUDGET_INVALID:${step}`);
    for (const inputType of entry.inputArtifactTypes) {
      const owner = outputOwners.get(inputType);
      if (!owner || GENERATION_STEPS.indexOf(owner) >= index) issues.push(`INPUT_PREDECESSOR_INVALID:${step}:${inputType}`);
    }
    if (outputOwners.has(entry.outputArtifactType)) issues.push(`OUTPUT_OWNER_DUPLICATE:${entry.outputArtifactType}`);
    outputOwners.set(entry.outputArtifactType, step);
  }
  return { ok: issues.length === 0, issues };
}
