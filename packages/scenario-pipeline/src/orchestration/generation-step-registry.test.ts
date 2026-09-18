import { describe, expect, it } from "vitest";
import { GENERATION_STEPS } from "@scenarioforge/contracts";
import { generationStepRegistry, validateGenerationStepRegistry } from "./generation-step-registry.js";

describe("generation step registry", () => {
  it("declares the fixed artifact chain in canonical order", () => {
    expect(Object.keys(generationStepRegistry)).toEqual(GENERATION_STEPS);
    expect(GENERATION_STEPS.map((step) => generationStepRegistry[step].outputArtifactType)).toEqual([
      "source-snapshot",
      "fact-catalog",
      "edge-ledger",
      "fact-bundle",
      "workflow-skeleton",
      "wiki-bundle",
      "business-catalog",
      "scenario-skeleton",
      "scenario-set",
      "coverage-manifest",
    ]);
    expect(validateGenerationStepRegistry()).toEqual({ ok: true, issues: [] });
  });

  it("keeps deterministic compilers model-free and semantic steps bounded", () => {
    const deterministic = Object.values(generationStepRegistry).filter((policy) => policy.executor === "deterministic");
    expect(deterministic.map((policy) => policy.step)).toEqual([
      "source-scan",
      "assembled-fact",
      "reachable-workflow-skeleton",
      "scenario-skeleton",
      "coverage-manifest",
    ]);
    expect(deterministic.every((policy) => policy.contextBudgetBytes === 0 && policy.review === "none")).toBe(true);
    expect(Object.values(generationStepRegistry).filter((policy) => policy.executor === "llm").every((policy) => policy.contextBudgetBytes > 0 && policy.review === "independent")).toBe(true);
    expect(Object.values(generationStepRegistry).every((policy) => !("contextBudgetTokens" in policy))).toBe(true);
    expect(generationStepRegistry["fact-catalog"].evidenceBudgetBytes).toBe(400_000);
    expect(generationStepRegistry["edge-ledger"].evidenceBudgetBytes).toBe(400_000);
  });

  it("declares only partition strategies implemented by the active executor", () => {
    expect(generationStepRegistry["fact-catalog"].partitionBy).toBe("screen");
    expect(generationStepRegistry["edge-ledger"].partitionBy).toBe("journey-action");
    expect(generationStepRegistry["common-wiki"].partitionBy).toBe("project");
    expect(generationStepRegistry["business-catalog"].partitionBy).toBe("project");
    expect(generationStepRegistry["scenario-narration"].partitionBy).toBe("project");
  });
});
