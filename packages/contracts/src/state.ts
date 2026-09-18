export const ANALYSIS_STAGES = ["src", "fact", "wiki", "scenario"] as const;

export const GENERATION_STEPS = [
  "source-scan",
  "fact-catalog",
  "edge-ledger",
  "assembled-fact",
  "reachable-workflow-skeleton",
  "common-wiki",
  "business-catalog",
  "scenario-skeleton",
  "scenario-narration",
  "coverage-manifest",
] as const;

export type AnalysisStage = (typeof ANALYSIS_STAGES)[number];
export type GenerationStep = (typeof GENERATION_STEPS)[number];
export type GenerationWorkRole = "deterministic" | "author" | "reviewer" | "repair";
export type GenerationStepStatus = "pending" | "preparing" | "running" | "validating" | "repairable" | "completed" | "failed";
export type GenerationStepState = {
  step: GenerationStep;
  status: GenerationStepStatus;
  role?: GenerationWorkRole;
  workId?: string;
  receiptArtifactId?: string;
  contextManifestArtifactId?: string;
  error?: { category: string; code?: string; message: string };
};
export type ProjectLifecycleStatus = "unselected" | "configuring" | "ready" | "error";
export type RuntimeStatus =
  | "unconfigured"
  | "preparing"
  | "ready"
  | "recovering"
  | "stopped"
  | "error";
export type AgentWorkStatus =
  | "creating"
  | "idle"
  | "running"
  | "retrying"
  | "compacting"
  | "cancelling"
  | "settled"
  | "failed"
  | "recovering";
export type AnalysisStageStatus = "pending" | "running" | "validating" | "completed" | "failed";
export type ArtifactStatus = "absent" | "generating" | "validating" | "verified" | "persisted" | "invalid";

export type StateTombstone = {
  entityId: string;
  entityType: "work" | "draft-artifact";
  deletedAt: string;
  reason: string;
};

export type ProjectRuntimeState = {
  schemaVersion: 2;
  projectId?: string;
  revision: number;
  projectStatus: ProjectLifecycleStatus;
  runtimeStatus: RuntimeStatus;
  sessionStatus: AgentWorkStatus;
  sessionId?: string;
  analysisRunId?: string;
  sourceSnapshotId?: string;
  activeStage?: AnalysisStage;
  activeStep?: GenerationStep;
  activeRole?: GenerationWorkRole;
  generationSteps: Record<GenerationStep, GenerationStepState>;
  stages: Record<AnalysisStage, AnalysisStageStatus>;
  artifactStatus: Record<AnalysisStage, ArtifactStatus>;
  progress: number;
  currentActivity?: string;
  recoverable: boolean;
  lastCheckpointId?: string;
  lastError?: { category: string; message: string };
  works: Record<string, import("./work.js").WorkDescriptor>;
  activities: Record<string, import("./activities.js").VerifiableActivity>;
  artifacts: Record<string, import("./artifacts.js").ArtifactRecord>;
  tombstones: StateTombstone[];
  appliedOperationIds: string[];
};

const stageByGenerationStep: Record<GenerationStep, AnalysisStage> = {
  "source-scan": "src",
  "fact-catalog": "fact",
  "edge-ledger": "fact",
  "assembled-fact": "fact",
  "reachable-workflow-skeleton": "wiki",
  "common-wiki": "wiki",
  "business-catalog": "wiki",
  "scenario-skeleton": "scenario",
  "scenario-narration": "scenario",
  "coverage-manifest": "scenario",
};

export function generationStepStage(step: GenerationStep): AnalysisStage {
  return stageByGenerationStep[step];
}

export function createInitialGenerationSteps(): Record<GenerationStep, GenerationStepState> {
  return Object.fromEntries(
    GENERATION_STEPS.map((step) => [step, { step, status: "pending" as const }]),
  ) as Record<GenerationStep, GenerationStepState>;
}

export function getNextGenerationStep(
  steps: Record<GenerationStep, GenerationStepState>,
): GenerationStep | undefined {
  for (const [index, step] of GENERATION_STEPS.entries()) {
    const state = steps[step];
    if (state.status === "completed") continue;
    if (index === 0 || GENERATION_STEPS.slice(0, index).every((predecessor) => steps[predecessor].status === "completed")) {
      return step;
    }
    return undefined;
  }
  return undefined;
}

export function createInitialProjectRuntimeState(projectId?: string): ProjectRuntimeState {
  return {
    schemaVersion: 2,
    projectId,
    revision: 0,
    projectStatus: projectId ? "configuring" : "unselected",
    runtimeStatus: "unconfigured",
    sessionStatus: "creating",
    generationSteps: createInitialGenerationSteps(),
    stages: { src: "pending", fact: "pending", wiki: "pending", scenario: "pending" },
    artifactStatus: { src: "absent", fact: "absent", wiki: "absent", scenario: "absent" },
    progress: 0,
    recoverable: false,
    works: {},
    activities: {},
    artifacts: {},
    tombstones: [],
    appliedOperationIds: [],
  };
}
