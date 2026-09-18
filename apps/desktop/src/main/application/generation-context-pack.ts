import { createHash } from "node:crypto";
import type { GenerationWorkRole, WorkDescriptor } from "@scenarioforge/contracts";
import { generationStepRegistry } from "@scenarioforge/scenario-pipeline";

export type GenerationContextManifest = Readonly<{
  schemaVersion: 2;
  generationStep: WorkDescriptor["generationStep"];
  role: GenerationWorkRole;
  cacheKey: string;
  contextBytes: number;
  estimatedTokens: number;
  payloadHash: string;
  inputArtifactIds: string[];
  optimizationStrategy: "step-role-lane-compaction";
  sessionDisposition: "disposed-at-step-end";
}>;

export type GenerationContextPack = Readonly<{
  serialized: string;
  manifest: GenerationContextManifest;
}>;

/**
 * Produces stable JSON for provider-visible context. Object keys are sorted at
 * every depth, while array order remains semantically significant.
 */
export function canonicalJson(value: unknown): string {
  const serialized = JSON.stringify(value, (_key, item: unknown) => {
    if (item === null || typeof item !== "object" || Array.isArray(item)) return item;
    return Object.fromEntries(Object.entries(item).sort(([left], [right]) => left.localeCompare(right)));
  });
  if (serialized === undefined) throw new Error("GENERATION_CONTEXT_SERIALIZATION_FAILED");
  return serialized;
}

export function buildGenerationContextPack(input: {
  work: WorkDescriptor;
  role: GenerationWorkRole;
  payload: unknown;
}): GenerationContextPack {
  const step = input.work.generationStep;
  const budgetBytes = step ? generationStepRegistry[step].contextBudgetBytes : 480_000;
  const inputArtifacts = [...(input.work.inputArtifacts ?? [])]
    .sort((left, right) => left.artifactId.localeCompare(right.artifactId));
  const serialized = canonicalJson({
    payload: input.payload,
    scoped_work: {
      analysis_run_id: input.work.analysisRunId,
      generation_step: step,
      input_artifacts: inputArtifacts.map(({ artifactId, analysisRunId, contentHash }) => ({
        analysis_run_id: analysisRunId,
        artifact_id: artifactId,
        content_hash: contentHash,
      })),
      output_artifact_type: input.work.outputArtifactType,
      step_plan: input.work.stepPlan,
      project_id: input.work.projectId,
      role: input.role,
      source_snapshot_id: input.work.sourceSnapshotId,
      work_id: input.work.workId,
      work_kind: input.work.kind,
    },
  });
  const contextBytes = Buffer.byteLength(serialized, "utf8");
  if (budgetBytes <= 0 || contextBytes > budgetBytes) {
    throw new Error(`GENERATION_CONTEXT_BYTE_BUDGET_EXCEEDED:${step ?? input.work.kind}`);
  }
  const estimatedTokens = Math.ceil(contextBytes / 4);

  return {
    serialized,
    manifest: {
      schemaVersion: 2,
      generationStep: step,
      role: input.role,
      cacheKey: `scenarioforge:${step ?? input.work.kind}:${input.role}:v2`,
      contextBytes,
      estimatedTokens,
      payloadHash: createHash("sha256").update(serialized).digest("hex"),
      inputArtifactIds: inputArtifacts.map(({ artifactId }) => artifactId),
      optimizationStrategy: "step-role-lane-compaction",
      sessionDisposition: "disposed-at-step-end",
    },
  };
}
