import { describe, expect, it } from "vitest";
import { createInitialProjectRuntimeState } from "@scenarioforge/contracts";
import { summarizeGenerationCheckpoint } from "./generation-checkpoint";

describe("generation checkpoint summary", () => {
  it("continues the next fine-grained step while its coarse stage remains running", () => {
    const state = createInitialProjectRuntimeState("PRJ-1");
    state.analysisRunId = "RUN-1";
    state.sessionStatus = "idle";
    state.runtimeStatus = "ready";
    state.projectStatus = "ready";
    state.recoverable = true;
    state.progress = 20;
    state.generationSteps["source-scan"].status = "completed";
    state.generationSteps["fact-catalog"].status = "completed";
    state.stages.src = "completed";
    state.stages.fact = "running";

    expect(summarizeGenerationCheckpoint(state)).toEqual({
      analysisRunId: "RUN-1",
      progress: 20,
      nextStage: "fact",
      nextStep: "edge-ledger",
      canContinue: true,
      completed: false,
    });
  });
});
