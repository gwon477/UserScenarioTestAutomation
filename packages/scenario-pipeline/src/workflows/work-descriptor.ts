import { randomUUID } from "node:crypto";
import type {
  AnalysisStage,
  GenerationArtifactType,
  GenerationHarnessWorkKind,
  GenerationStep,
  GenerationWorkRole,
  WorkDescriptor,
} from "@scenarioforge/contracts";

const stageByKind: Record<GenerationHarnessWorkKind, AnalysisStage> = {
  "analysis.generation-plan": "src",
  "analysis.source-map": "src",
  "analysis.fact-extract": "fact",
  "analysis.wiki-compose": "wiki",
  "analysis.scenario-compose": "scenario",
  "analysis.source-scan": "src",
  "analysis.fact-catalog": "fact",
  "analysis.edge-ledger": "fact",
  "analysis.fact-assemble": "fact",
  "analysis.workflow-skeleton": "wiki",
  "analysis.common-wiki": "wiki",
  "analysis.business-catalog": "wiki",
  "analysis.scenario-skeleton": "scenario",
  "analysis.scenario-narration": "scenario",
  "analysis.coverage-manifest": "scenario",
};

const stepByKind: Partial<Record<GenerationHarnessWorkKind, GenerationStep>> = {
  "analysis.source-scan": "source-scan",
  "analysis.fact-catalog": "fact-catalog",
  "analysis.edge-ledger": "edge-ledger",
  "analysis.fact-assemble": "assembled-fact",
  "analysis.workflow-skeleton": "reachable-workflow-skeleton",
  "analysis.common-wiki": "common-wiki",
  "analysis.business-catalog": "business-catalog",
  "analysis.scenario-skeleton": "scenario-skeleton",
  "analysis.scenario-narration": "scenario-narration",
  "analysis.coverage-manifest": "coverage-manifest",
};

const artifactTypeByStep: Record<GenerationStep, GenerationArtifactType> = {
  "source-scan": "source-snapshot",
  "fact-catalog": "fact-catalog",
  "edge-ledger": "edge-ledger",
  "assembled-fact": "fact-bundle",
  "reachable-workflow-skeleton": "workflow-skeleton",
  "common-wiki": "wiki-bundle",
  "business-catalog": "business-catalog",
  "scenario-skeleton": "scenario-skeleton",
  "scenario-narration": "scenario-set",
  "coverage-manifest": "coverage-manifest",
};

export type CreateGenerationWorkInput = {
  projectId: string;
  analysisRunId: string;
  sourceSnapshotId?: string;
  sessionId: string;
  workId?: string;
  parentWorkId?: string;
  kind: GenerationHarnessWorkKind;
  role?: GenerationWorkRole;
  generationStep?: GenerationStep;
  outputArtifactType?: GenerationArtifactType;
  objective?: string;
  stepPlan?: WorkDescriptor["stepPlan"];
  inputArtifacts?: WorkDescriptor["inputArtifacts"];
  attemptId?: string;
  expectedRevision: number;
  inputIds: string[];
  now?: string;
};

export function createGenerationWorkDescriptor(input: CreateGenerationWorkInput): Readonly<WorkDescriptor> {
  const workId = input.workId ?? randomUUID();
  const now = input.now ?? new Date().toISOString();
  const generationStep = input.generationStep ?? stepByKind[input.kind];
  const descriptor: WorkDescriptor = {
    schemaVersion: 1,
    projectId: input.projectId,
    analysisRunId: input.analysisRunId,
    sourceSnapshotId: input.sourceSnapshotId,
    sessionId: input.sessionId,
    workId,
    parentWorkId: input.parentWorkId,
    kind: input.kind,
    stage: stageByKind[input.kind],
    generationStep,
    role: input.role ?? (generationStep ? (["source-scan", "assembled-fact", "reachable-workflow-skeleton", "scenario-skeleton", "coverage-manifest"].includes(generationStep) ? "deterministic" : "author") : undefined),
    outputArtifactType: input.outputArtifactType ?? (generationStep ? artifactTypeByStep[generationStep] : undefined),
    objective: input.objective ?? (generationStep ? `Produce only the ${generationStep} artifact.` : undefined),
    stepPlan: input.stepPlan ? structuredClone(input.stepPlan) : undefined,
    inputArtifacts: input.inputArtifacts ? [...input.inputArtifacts].sort((left, right) => left.artifactId.localeCompare(right.artifactId)) : undefined,
    attemptId: input.attemptId ?? randomUUID(),
    expectedRevision: input.expectedRevision,
    inputIds: [...input.inputIds].sort(),
    stagingPath: `.scenarioforge/staging/${workId}`,
    status: "pending",
    createdAt: now,
    updatedAt: now,
    progress: 0,
    completionRequested: false,
  };
  return Object.freeze({ ...descriptor, inputIds: Object.freeze(descriptor.inputIds) as unknown as string[] });
}
