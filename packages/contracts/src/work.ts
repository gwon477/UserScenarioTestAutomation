import type { AnalysisStage, GenerationStep, GenerationWorkRole } from "./state.js";
import type { ArtifactSubmission, GenerationArtifactType } from "./artifacts.js";
import type { VerifiableActivity } from "./activities.js";

export type LegacyGenerationHarnessWorkKind =
  | "analysis.source-map"
  | "analysis.fact-extract"
  | "analysis.wiki-compose"
  | "analysis.scenario-compose";
export type GenerationStepWorkKind =
  | "analysis.source-scan"
  | "analysis.fact-catalog"
  | "analysis.edge-ledger"
  | "analysis.fact-assemble"
  | "analysis.workflow-skeleton"
  | "analysis.common-wiki"
  | "analysis.business-catalog"
  | "analysis.scenario-skeleton"
  | "analysis.scenario-narration"
  | "analysis.coverage-manifest";
export type GenerationControlWorkKind = "analysis.generation-plan";
export type GenerationHarnessWorkKind = LegacyGenerationHarnessWorkKind | GenerationStepWorkKind | GenerationControlWorkKind;
export type ScenarioQueryWorkKind = "scenario.answer";
export type ExecutionPlanningWorkKind = "test.plan";
export type HarnessWorkKind = GenerationHarnessWorkKind | ScenarioQueryWorkKind | ExecutionPlanningWorkKind;
export type LlmFunctionId = Exclude<HarnessWorkKind, "analysis.source-map">;
export type WorkStatus = "pending" | "running" | "settled" | "failed" | "cancelled";

export type WorkDescriptor = {
  schemaVersion: 1;
  projectId: string;
  analysisRunId: string;
  sourceSnapshotId?: string;
  sessionId: string;
  workId: string;
  parentWorkId?: string;
  kind: HarnessWorkKind;
  stage?: AnalysisStage;
  generationStep?: GenerationStep;
  role?: GenerationWorkRole;
  outputArtifactType?: GenerationArtifactType;
  /** Exactly one bounded result this work is responsible for producing. */
  objective?: string;
  /** Backend-validated detailed plan fields consumed by this one generation step. */
  stepPlan?: {
    entryChecks: string[];
    executionActions: string[];
    completionChecks: string[];
    correctionMode: "none" | "targeted-patch";
    contextStrategy: "none" | "isolated-session" | "step-role-lane";
  };
  inputArtifacts?: Array<{ artifactId: string; analysisRunId: string; contentHash: string }>;
  attemptId: string;
  expectedRevision: number;
  inputIds: string[];
  stagingPath: string;
  status: WorkStatus;
  createdAt: string;
  updatedAt: string;
  progress: number;
  partitionProgress?: WorkPartitionProgress;
  completionRequested: boolean;
  error?: DomainError;
};

export type ChildWorkDescriptor = Omit<WorkDescriptor, "parentWorkId"> & { parentWorkId: string };
export type WorkPartitionProgress = {
  generationStep: GenerationStep;
  role: GenerationWorkRole;
  completed: number;
  failed: number;
  currentPartition: string;
};
export type WorkProgressPatch = { workId: string; progress: number; currentActivity?: string; partitionProgress?: WorkPartitionProgress };
export type DomainError = {
  code: string;
  category: "provider" | "schema" | "permission" | "path" | "id" | "runtime";
  message: string;
  retryable: boolean;
};

export type WorkStateMutation =
  | { op: "add-child"; descriptor: ChildWorkDescriptor }
  | { op: "update-progress"; patch: WorkProgressPatch }
  | { op: "record-activity"; activity: VerifiableActivity }
  | { op: "submit-artifacts"; artifacts: ArtifactSubmission[] }
  | { op: "tombstone-draft"; artifactId: string; reason: string }
  | { op: "release-checkpointed-artifacts"; artifactIds: string[] }
  | { op: "release-checkpointed-work" }
  | { op: "report-failure"; error: DomainError }
  | { op: "request-completion" };

export type WorkMutationCommand = {
  projectId: string;
  sessionId: string;
  workId: string;
  operationId: string;
  expectedRevision: number;
  mutation: WorkStateMutation;
};

export type WorkContext = {
  projectId: string;
  sessionId: string;
  workId: string;
  revision: number;
  contextToken: string;
  descriptor: WorkDescriptor;
  allowedActions: string[];
};
