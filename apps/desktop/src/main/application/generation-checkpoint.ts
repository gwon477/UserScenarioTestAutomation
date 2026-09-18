import {
  generationStepStage,
  getNextGenerationStep,
  type ProjectRuntimeState,
} from "@scenarioforge/contracts";
import type { AnalysisStateSummary } from "../../shared/desktop-api";

export function summarizeGenerationCheckpoint(state: ProjectRuntimeState): AnalysisStateSummary | null {
  if (!state.analysisRunId) return null;
  const nextStep = getNextGenerationStep(state.generationSteps) ?? null;
  const nextStepStatus = nextStep ? state.generationSteps[nextStep].status : null;
  return {
    analysisRunId: state.analysisRunId,
    progress: state.progress,
    nextStage: nextStep ? generationStepStage(nextStep) : null,
    nextStep,
    canContinue: Boolean(nextStep && state.recoverable && (nextStepStatus === "pending" || nextStepStatus === "failed")),
    completed: state.generationSteps["coverage-manifest"].status === "completed",
  };
}
