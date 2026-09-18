import {
  createInitialGenerationSteps,
  type AnalysisStage,
  type GenerationStep,
  type ProjectRuntimeState,
} from "@scenarioforge/contracts";
import { JournalRepository } from "./journal-repository.js";

type LegacyProjectRuntimeState = Omit<ProjectRuntimeState, "schemaVersion" | "generationSteps"> & {
  schemaVersion: 1;
  generationSteps?: never;
};

const firstStepByStage: Record<AnalysisStage, GenerationStep> = {
  src: "source-scan",
  fact: "fact-catalog",
  wiki: "reachable-workflow-skeleton",
  scenario: "scenario-skeleton",
};

export function migrateProjectRuntimeState(state: ProjectRuntimeState | LegacyProjectRuntimeState): ProjectRuntimeState {
  if (state.schemaVersion === 2) return state;

  const generationSteps = createInitialGenerationSteps();
  const artifacts = structuredClone(state.artifacts) as ProjectRuntimeState["artifacts"];
  const persistedForStage = (stage: AnalysisStage) => Object.values(artifacts)
    .filter((artifact) => artifact.analysisRunId === state.analysisRunId && artifact.status === "persisted" && artifact.artifactType === stage)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];

  const sourceArtifact = persistedForStage("src");
  if (state.stages.src === "completed" && sourceArtifact) {
    artifacts[sourceArtifact.artifactId] = { ...sourceArtifact, generationStep: "source-scan" };
    generationSteps["source-scan"] = {
      step: "source-scan",
      status: "completed",
      role: "deterministic",
      receiptArtifactId: sourceArtifact.artifactId,
    };
  } else if (["running", "validating", "failed"].includes(state.stages.src)) {
    generationSteps["source-scan"] = {
      step: "source-scan",
      status: "failed",
      role: "deterministic",
      error: { category: "migration", code: "LEGACY_STEP_RECOVERY_REQUIRED", message: "Legacy source step must be resumed explicitly." },
    };
  }

  const firstIncompleteStage = (["fact", "wiki", "scenario"] as const).find((stage) => state.stages[stage] !== "pending");
  if (firstIncompleteStage && generationSteps["source-scan"].status === "completed") {
    const step = firstStepByStage[firstIncompleteStage];
    generationSteps[step] = {
      step,
      status: "failed",
      error: {
        category: "migration",
        code: "LEGACY_FINE_GRAINED_RECEIPTS_MISSING",
        message: `Legacy ${firstIncompleteStage} state has no independently verified step receipts.`,
      },
    };
  }

  const failedStep = Object.values(generationSteps).find((step) => step.status === "failed");
  return {
    ...state,
    schemaVersion: 2,
    activeStage: failedStep ? undefined : state.activeStage,
    activeStep: undefined,
    activeRole: undefined,
    generationSteps,
    stages: {
      src: generationSteps["source-scan"].status === "completed" ? "completed" : generationSteps["source-scan"].status === "failed" ? "failed" : "pending",
      fact: generationSteps["fact-catalog"].status === "failed" ? "failed" : "pending",
      wiki: generationSteps["reachable-workflow-skeleton"].status === "failed" ? "failed" : "pending",
      scenario: generationSteps["scenario-skeleton"].status === "failed" ? "failed" : "pending",
    },
    progress: generationSteps["source-scan"].status === "completed" ? 10 : 0,
    recoverable: Boolean(state.analysisRunId),
    lastError: failedStep?.error ? { category: failedStep.error.category, message: failedStep.error.message } : state.lastError,
    artifacts,
  };
}

export async function recoverProjectState(repository: JournalRepository, fallback: ProjectRuntimeState): Promise<ProjectRuntimeState> {
  const recovered = (await repository.recoverLatest())?.state;
  return recovered ? migrateProjectRuntimeState(recovered) : fallback;
}
