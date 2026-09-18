import { describe, expect, it } from "vitest";
import { GENERATION_STEPS, type GenerationPlan } from "@scenarioforge/contracts";
import { generationStepRegistry } from "./generation-step-registry.js";
import { generationPlanTemplate, validateGenerationPlan, validateGenerationPlanEntry } from "./generation-plan.js";

function validPlan(): GenerationPlan {
  const template = generationPlanTemplate({ projectId: "PRJ-1", analysisRunId: "RUN-1", sourceSnapshotId: "SNAP-1" });
  return {
    ...template,
    objective: "Produce one source-grounded and backend-verifiable scenario set.",
    steps: template.steps.map((step) => ({
      ...step,
      objective: `Complete only ${step.step}.`,
      entry_checks: ["Validate the exact input artifact receipts."],
      execution_actions: ["Produce only the declared output artifact."],
      completion_checks: ["Validate, hash, register, and persist the output receipt."],
    })),
  };
}

describe("generation plan contract", () => {
  it("requires one Luna-authored objective and fixed detailed fields for every canonical step", () => {
    const plan = validPlan();

    expect(plan.steps.map((step) => step.step)).toEqual(GENERATION_STEPS);
    expect(validateGenerationPlan(plan)).toEqual({ valid: true, issues: [] });
    for (const item of plan.steps) {
      const policy = generationStepRegistry[item.step];
      expect(item.input_artifact_types).toEqual(policy.inputArtifactTypes);
      expect(item.output_artifact_type).toBe(policy.outputArtifactType);
      expect(validateGenerationPlanEntry(plan, item.step)).toEqual(item);
    }
  });

  it("fails closed when a detailed plan changes backend-owned order or correction mode", () => {
    const reordered = validPlan();
    [reordered.steps[0], reordered.steps[1]] = [reordered.steps[1]!, reordered.steps[0]!];
    expect(validateGenerationPlan(reordered).issues.map((entry) => entry.code)).toContain("GENERATION_PLAN_STEP_ORDER_INVALID");

    const wrongMode = validPlan();
    wrongMode.steps.find((entry) => entry.step === "scenario-narration")!.correction_mode = "none";
    expect(validateGenerationPlan(wrongMode).issues.map((entry) => entry.code)).toContain("GENERATION_PLAN_CORRECTION_MODE_INVALID");
  });

  it("fails closed when a model changes backend-owned plan identity", () => {
    const plan = validPlan();
    const expected = { projectId: plan.project_id, analysisRunId: plan.analysis_run_id, sourceSnapshotId: plan.source_snapshot_id };

    expect(validateGenerationPlan({ ...plan, project_id: "PRJ-model" }, expected).issues.map((entry) => entry.code)).toContain("GENERATION_PLAN_IDENTITY_MISMATCH");
    expect(validateGenerationPlan({ ...plan, analysis_run_id: "RUN-model" }, expected).issues.map((entry) => entry.code)).toContain("GENERATION_PLAN_IDENTITY_MISMATCH");
    expect(validateGenerationPlan({ ...plan, source_snapshot_id: "SNAP-model" }, expected).issues.map((entry) => entry.code)).toContain("GENERATION_PLAN_IDENTITY_MISMATCH");
  });
});
