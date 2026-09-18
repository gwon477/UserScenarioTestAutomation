import type { AnalysisStage, GenerationStep } from "./state.js";

export const GENERATION_ARTIFACT_TYPES = [
  "generation-plan",
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
  "context-manifest",
  "semantic-verdict",
  "validation-report",
] as const;

export type GenerationArtifactType = AnalysisStage | (typeof GENERATION_ARTIFACT_TYPES)[number];

export type ArtifactSubmission = {
  artifactId: string;
  artifactType: GenerationArtifactType;
  generationStep?: GenerationStep;
  stagingPath: string;
  relatedIds: string[];
  contentHash: string;
  supersedesArtifactId?: string;
};

export type ArtifactRecord = ArtifactSubmission & {
  projectId: string;
  analysisRunId: string;
  sourceSnapshotId: string;
  workId: string;
  status: "staged" | "verified" | "persisted" | "invalid";
  finalPath?: string;
  createdAt: string;
};

export type ValidationIssue = {
  code: string;
  severity: "error" | "warning";
  path: string;
  message: string;
};

export type CompletionDecision =
  | { ok: true; completedRevision?: number }
  | { ok: false; unmetGates: string[]; issues?: ValidationIssue[] };
