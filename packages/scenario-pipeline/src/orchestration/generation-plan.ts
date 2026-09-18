import {
  GENERATION_STEPS,
  type GenerationPlan,
  type GenerationPlanStep,
  type GenerationStep,
  type ValidationIssue,
} from "@scenarioforge/contracts";
import { generationStepRegistry } from "./generation-step-registry.js";

const correctionSteps = new Set<GenerationStep>([
  "fact-catalog",
  "edge-ledger",
  "common-wiki",
  "business-catalog",
  "scenario-narration",
]);

const issue = (code: string, path: string, message: string): ValidationIssue => ({ code, path, message, severity: "error" });
const sameStrings = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((value, index) => value === right[index]);
const populatedStrings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.length > 0 && value.every((entry) => typeof entry === "string" && Boolean(entry.trim()));

export function generationPlanTemplate(identity: {
  projectId: string;
  analysisRunId: string;
  sourceSnapshotId: string;
}): GenerationPlan {
  return {
    schema_version: 1,
    project_id: identity.projectId,
    analysis_run_id: identity.analysisRunId,
    source_snapshot_id: identity.sourceSnapshotId,
    objective: "",
    steps: GENERATION_STEPS.map((step): GenerationPlanStep => {
      const policy = generationStepRegistry[step];
      return {
        step,
        role: policy.executor === "deterministic" ? "deterministic" : "author",
        input_artifact_types: [...policy.inputArtifactTypes],
        output_artifact_type: policy.outputArtifactType,
        objective: "",
        entry_checks: [],
        execution_actions: [],
        completion_checks: [],
        correction_mode: correctionSteps.has(step) ? "targeted-patch" : "none",
        context_strategy: policy.executor === "llm" ? "step-role-lane" : "none",
      };
    }),
  };
}

export function validateGenerationPlan(
  plan: GenerationPlan,
  expected?: { projectId: string; analysisRunId: string; sourceSnapshotId: string },
): { valid: boolean; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = [];
  if (!plan || typeof plan !== "object" || plan.schema_version !== 1 || !plan.project_id?.trim() || !plan.analysis_run_id?.trim()
    || !plan.source_snapshot_id?.trim() || typeof plan.objective !== "string" || !plan.objective.trim() || !Array.isArray(plan.steps)) {
    return { valid: false, issues: [issue("GENERATION_PLAN_SCHEMA_INVALID", "$", "The generation plan identity, objective, and steps are required.")] };
  }
  if (expected && (plan.project_id !== expected.projectId || plan.analysis_run_id !== expected.analysisRunId || plan.source_snapshot_id !== expected.sourceSnapshotId)) {
    issues.push(issue("GENERATION_PLAN_IDENTITY_MISMATCH", "$", "The plan cannot change backend-owned project, run, or snapshot identity."));
  }
  if (plan.steps.length !== GENERATION_STEPS.length || !sameStrings(plan.steps.map((entry) => entry?.step ?? ""), GENERATION_STEPS)) {
    issues.push(issue("GENERATION_PLAN_STEP_ORDER_INVALID", "steps", "The detailed plan must contain every canonical generation step in backend order."));
  }
  plan.steps.forEach((entry, index) => {
    const step = GENERATION_STEPS[index];
    if (!entry || !step) return;
    const policy = generationStepRegistry[step];
    const keys = Object.keys(entry).sort();
    const expectedKeys = ["step", "role", "input_artifact_types", "output_artifact_type", "objective", "entry_checks", "execution_actions", "completion_checks", "correction_mode", "context_strategy"].sort();
    if (!sameStrings(keys, expectedKeys)) issues.push(issue("GENERATION_PLAN_DETAIL_SCHEMA_INVALID", `steps.${index}`, "Detailed plan fields are fixed by the backend contract."));
    if (entry.step !== step) return;
    if (entry.role !== (policy.executor === "deterministic" ? "deterministic" : "author")) issues.push(issue("GENERATION_PLAN_ROLE_INVALID", `steps.${index}.role`, "The plan cannot change the backend-owned executor role."));
    if (!sameStrings(entry.input_artifact_types ?? [], policy.inputArtifactTypes)) issues.push(issue("GENERATION_PLAN_INPUTS_INVALID", `steps.${index}.input_artifact_types`, "The plan cannot change backend-owned artifact inputs."));
    if (entry.output_artifact_type !== policy.outputArtifactType) issues.push(issue("GENERATION_PLAN_OUTPUT_INVALID", `steps.${index}.output_artifact_type`, "The plan cannot change the backend-owned output artifact."));
    if (typeof entry.objective !== "string" || !entry.objective.trim()) issues.push(issue("GENERATION_PLAN_OBJECTIVE_INVALID", `steps.${index}.objective`, "Each work item must have exactly one non-empty objective."));
    for (const field of ["entry_checks", "execution_actions", "completion_checks"] as const) {
      if (!populatedStrings(entry[field])) issues.push(issue("GENERATION_PLAN_DETAIL_INVALID", `steps.${index}.${field}`, "Each fixed planning section requires at least one concrete item."));
    }
    const correctionMode = correctionSteps.has(step) ? "targeted-patch" : "none";
    if (entry.correction_mode !== correctionMode) issues.push(issue("GENERATION_PLAN_CORRECTION_MODE_INVALID", `steps.${index}.correction_mode`, "Correction mode is backend-owned."));
    const contextStrategy = policy.executor === "llm" ? "step-role-lane" : "none";
    if (entry.context_strategy !== contextStrategy) issues.push(issue("GENERATION_PLAN_CONTEXT_STRATEGY_INVALID", `steps.${index}.context_strategy`, "Context strategy is backend-owned."));
  });
  return { valid: issues.length === 0, issues };
}

export function validateGenerationPlanEntry(
  plan: GenerationPlan,
  step: GenerationStep,
  expected?: { projectId: string; analysisRunId: string; sourceSnapshotId: string },
): GenerationPlanStep {
  const validation = validateGenerationPlan(plan, expected);
  if (!validation.valid) throw new Error(validation.issues[0]!.code);
  const entry = plan.steps.find((candidate) => candidate.step === step);
  if (!entry) throw new Error(`GENERATION_PLAN_STEP_MISSING:${step}`);
  return entry;
}
