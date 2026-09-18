import { describe, expect, it } from "vitest";
import type { GenerationStageResult } from "@scenarioforge/scenario-pipeline";
import { summarizeGenerationStageResult } from "./generation-stage-summary";

const result = (step: GenerationStageResult["step"], artifact: GenerationStageResult["artifact"]): GenerationStageResult => ({
  analysisRunId: "RUN-1",
  stage: step === "source-scan" ? "src" : step === "fact-catalog" || step === "edge-ledger" || step === "assembled-fact" ? "fact" : step === "reachable-workflow-skeleton" || step === "common-wiki" || step === "business-catalog" ? "wiki" : "scenario",
  step,
  artifact,
  finalRevision: 1,
});

describe("generation stage summary", () => {
  it("summarizes a fine-grained FACT catalog without assuming an edges collection", () => {
    expect(summarizeGenerationStageResult(result("fact-catalog", {
      schema_version: 1,
      project_id: "PRJ-1",
      analysis_run_id: "RUN-1",
      source_snapshot_id: "SNAP-1",
      screens: [{}, {}],
      predicates: [{}, {}, {}],
    } as GenerationStageResult["artifact"]))).toEqual({
      completed: false,
      progress: 20,
      factCount: 5,
      wikiPages: 0,
      scenarios: 0,
    });
  });

  it("uses the exact ten-step progress and only completes at coverage", () => {
    expect(summarizeGenerationStageResult(result("business-catalog", {
      schema_version: 1,
      project_id: "PRJ-1",
      analysis_run_id: "RUN-1",
      source_snapshot_id: "SNAP-1",
      classifications: [{}],
    } as GenerationStageResult["artifact"]))).toEqual({ completed: false, progress: 70, factCount: 0, wikiPages: 0, scenarios: 0 });
    expect(summarizeGenerationStageResult(result("coverage-manifest", {
      schema_version: 1,
      project_id: "PRJ-1",
      analysis_run_id: "RUN-1",
      source_snapshot_id: "SNAP-1",
      coverage: { total_edges: 1, covered_edges: 1, uncovered_edge_ids: [], coverage_percent: 100, assumed_predicates: [] },
      artifact_ids: [],
    } as GenerationStageResult["artifact"]))).toEqual({ completed: true, progress: 100, factCount: 0, wikiPages: 0, scenarios: 0 });
  });
});
