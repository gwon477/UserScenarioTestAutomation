import {
  ANALYSIS_STAGES,
  GENERATION_STEPS,
  generationStepStage,
  type ProjectRuntimeState,
} from "./state.js";
import { DOMAIN_EVENT_TYPES, type ScenarioForgeDomainEvent } from "./events.js";
import type { WorkDescriptor } from "./work.js";
import { GENERATION_ARTIFACT_TYPES, type ArtifactSubmission } from "./artifacts.js";

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; code: string };

const nonEmpty = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const validRevision = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0;
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

export function validateProjectRuntimeState(value: unknown): ValidationResult<ProjectRuntimeState> {
  if (!value || typeof value !== "object") return { ok: false, code: "INVALID_STATE" };
  const state = value as ProjectRuntimeState;
  if (![1, 2].includes(state.schemaVersion as number)) return { ok: false, code: "INVALID_SCHEMA_VERSION" };
  if (!validRevision(state.revision)) return { ok: false, code: "INVALID_REVISION" };
  if (state.projectId !== undefined && !nonEmpty(state.projectId)) return { ok: false, code: "EMPTY_PROJECT_ID" };
  if (!["unselected", "configuring", "ready", "error"].includes(state.projectStatus)) return { ok: false, code: "INVALID_PROJECT_STATUS" };
  if (!["unconfigured", "preparing", "ready", "recovering", "stopped", "error"].includes(state.runtimeStatus)) return { ok: false, code: "INVALID_RUNTIME_STATUS" };
  if (!["creating", "idle", "running", "retrying", "compacting", "cancelling", "settled", "failed", "recovering"].includes(state.sessionStatus)) return { ok: false, code: "INVALID_SESSION_STATUS" };
  if (state.activeStage !== undefined && !ANALYSIS_STAGES.includes(state.activeStage)) return { ok: false, code: "INVALID_ACTIVE_STAGE" };
  if (state.schemaVersion === 2 && state.generationSteps === undefined) return { ok: false, code: "MISSING_GENERATION_STEP_STATE" };
  if (state.generationSteps !== undefined) {
    if (!record(state.generationSteps)) return { ok: false, code: "MISSING_GENERATION_STEP_STATE" };
    const activeSteps: string[] = [];
    for (const [index, step] of GENERATION_STEPS.entries()) {
      const stepState = state.generationSteps[step];
      if (!record(stepState) || stepState.step !== step || !["pending", "preparing", "running", "validating", "repairable", "completed", "failed"].includes(stepState.status)) {
        return { ok: false, code: "INVALID_GENERATION_STEP_STATE" };
      }
      if (stepState.status !== "pending" && index > 0 && !GENERATION_STEPS.slice(0, index).every((predecessor) => state.generationSteps[predecessor].status === "completed")) {
        return { ok: false, code: "GENERATION_STEP_ORDER_VIOLATION" };
      }
      if (["preparing", "running", "validating", "repairable"].includes(stepState.status)) activeSteps.push(step);
      if (stepState.status === "completed") {
        if (!nonEmpty(stepState.receiptArtifactId)) return { ok: false, code: `${step.replaceAll("-", "_").toUpperCase()}_RECEIPT_NOT_PERSISTED` };
        const receipt = state.artifacts?.[stepState.receiptArtifactId];
        if (!receipt || receipt.status !== "persisted" || receipt.analysisRunId !== state.analysisRunId || receipt.generationStep !== step) {
          return { ok: false, code: `${step.replaceAll("-", "_").toUpperCase()}_RECEIPT_NOT_PERSISTED` };
        }
      }
    }
    if (activeSteps.length > 1) return { ok: false, code: "MULTIPLE_ACTIVE_GENERATION_STEPS" };
    if (state.activeStep !== undefined) {
      if (!GENERATION_STEPS.includes(state.activeStep) || !activeSteps.includes(state.activeStep)) return { ok: false, code: "INVALID_ACTIVE_GENERATION_STEP" };
      if (state.activeStage !== generationStepStage(state.activeStep)) return { ok: false, code: "ACTIVE_STEP_STAGE_MISMATCH" };
      const stepRole = state.generationSteps[state.activeStep].role;
      if (!state.activeRole || state.activeRole !== stepRole) return { ok: false, code: "ACTIVE_STEP_ROLE_MISMATCH" };
    } else if (activeSteps.length) {
      return { ok: false, code: "MISSING_ACTIVE_GENERATION_STEP" };
    }
  }
  if (!record(state.stages) || !record(state.artifactStatus)) return { ok: false, code: "MISSING_STAGE_STATE" };
  for (const stage of ANALYSIS_STAGES) {
    if (!["pending", "running", "validating", "completed", "failed"].includes(state.stages[stage])) {
      return { ok: false, code: "INVALID_STAGE_STATUS" };
    }
    if (!["absent", "generating", "validating", "verified", "persisted", "invalid"].includes(state.artifactStatus[stage])) {
      return { ok: false, code: "INVALID_ARTIFACT_STATUS" };
    }
    if (state.stages[stage] === "completed" && state.artifactStatus[stage] !== "persisted") {
      return { ok: false, code: `${stage.toUpperCase()}_ARTIFACT_NOT_PERSISTED` };
    }
  }
  if (!Number.isFinite(state.progress) || state.progress < 0 || state.progress > 100) {
    return { ok: false, code: "INVALID_PROGRESS" };
  }
  if (state.currentActivity !== undefined && !nonEmpty(state.currentActivity)) return { ok: false, code: "INVALID_CURRENT_ACTIVITY" };
  if (typeof state.recoverable !== "boolean" || !record(state.works) || !record(state.activities) || !record(state.artifacts) || !Array.isArray(state.tombstones) || !Array.isArray(state.appliedOperationIds) || state.appliedOperationIds.some((id) => !nonEmpty(id))) return { ok: false, code: "INVALID_STATE_COLLECTIONS" };
  for (const [workId, work] of Object.entries(state.works)) {
    const result = validateWorkDescriptor(work, state.projectId);
    if (!result.ok || result.value.workId !== workId) return { ok: false, code: "INVALID_STATE_WORK" };
  }
  for (const [activityId, value] of Object.entries(state.activities)) {
    const activity = value as ProjectRuntimeState["activities"][string];
    if (activity.activityId !== activityId || activity.projectId !== state.projectId || !state.works[activity.workId] || activity.sessionId !== state.works[activity.workId].sessionId || !["tool", "skill", "subagent", "validator"].includes(activity.kind) || !["queued", "running", "succeeded", "failed", "cancelled"].includes(activity.status) || !nonEmpty(activity.name)) return { ok: false, code: "INVALID_STATE_ACTIVITY" };
  }
  for (const [artifactId, value] of Object.entries(state.artifacts)) {
    const artifact = value as ProjectRuntimeState["artifacts"][string];
    const submission = validateArtifactSubmission(artifact);
    if (!submission.ok || artifact.artifactId !== artifactId || artifact.projectId !== state.projectId || !state.works[artifact.workId] || artifact.analysisRunId !== state.works[artifact.workId].analysisRunId || !["staged", "verified", "persisted", "invalid"].includes(artifact.status) || (artifact.status === "persisted" && !nonEmpty(artifact.finalPath))) return { ok: false, code: "INVALID_STATE_ARTIFACT" };
  }
  if (new Set(state.appliedOperationIds).size !== state.appliedOperationIds.length || state.tombstones.some((entry) => !nonEmpty(entry.entityId) || !["work", "draft-artifact"].includes(entry.entityType) || !nonEmpty(entry.deletedAt) || !nonEmpty(entry.reason))) return { ok: false, code: "INVALID_STATE_HISTORY" };
  return { ok: true, value: state };
}

const generationStepByWorkKind = {
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
} as const;
const workKinds = ["analysis.generation-plan", "analysis.source-map", "analysis.fact-extract", "analysis.wiki-compose", "analysis.scenario-compose", ...Object.keys(generationStepByWorkKind), "scenario.answer", "test.plan"];

export function validateWorkDescriptor(value: unknown, projectId?: string): ValidationResult<WorkDescriptor> {
  if (!value || typeof value !== "object") return { ok: false, code: "INVALID_WORK" };
  const work = value as WorkDescriptor;
  if (work.schemaVersion !== 1) return { ok: false, code: "INVALID_SCHEMA_VERSION" };
  for (const field of ["projectId", "analysisRunId", "sessionId", "workId", "attemptId", "stagingPath"] as const) {
    if (!nonEmpty(work[field])) return { ok: false, code: `EMPTY_${field.replace(/[A-Z]/g, (c) => `_${c}`).toUpperCase()}` };
  }
  if (projectId && work.projectId !== projectId) return { ok: false, code: "PROJECT_ID_MISMATCH" };
  if (!workKinds.includes(work.kind)) return { ok: false, code: "INVALID_WORK_KIND" };
  if (!["pending", "running", "settled", "failed", "cancelled"].includes(work.status)) return { ok: false, code: "INVALID_WORK_STATUS" };
  if (work.stage !== undefined && !ANALYSIS_STAGES.includes(work.stage)) return { ok: false, code: "INVALID_WORK_STAGE" };
  const generationStage = ({ "analysis.source-map": "src", "analysis.fact-extract": "fact", "analysis.wiki-compose": "wiki", "analysis.scenario-compose": "scenario" } as Record<string, string>)[work.kind];
  if (generationStage && work.stage !== generationStage) return { ok: false, code: "WORK_STAGE_KIND_MISMATCH" };
  const generationStep = generationStepByWorkKind[work.kind as keyof typeof generationStepByWorkKind];
  if (generationStep) {
    if (work.generationStep !== generationStep || work.stage !== generationStepStage(generationStep)) return { ok: false, code: "WORK_STEP_KIND_MISMATCH" };
    if (!work.role || !["deterministic", "author", "reviewer", "repair"].includes(work.role) || !work.outputArtifactType) return { ok: false, code: "INVALID_WORK_STEP_ENVELOPE" };
  } else if (work.generationStep !== undefined && (!GENERATION_STEPS.includes(work.generationStep) || !work.role || !work.outputArtifactType)) {
    return { ok: false, code: "INVALID_WORK_STEP_ENVELOPE" };
  }
  if (work.stagingPath !== `.scenarioforge/staging/${work.workId}`) return { ok: false, code: "INVALID_STAGING_PATH" };
  if (!validRevision(work.expectedRevision)) return { ok: false, code: "INVALID_REVISION" };
  if (!Number.isFinite(work.progress) || work.progress < 0 || work.progress > 100) return { ok: false, code: "INVALID_PROGRESS" };
  if (work.partitionProgress !== undefined) {
    const partition = work.partitionProgress;
    if (!GENERATION_STEPS.includes(partition.generationStep)
      || !["author", "reviewer", "repair"].includes(partition.role)
      || !Number.isSafeInteger(partition.completed)
      || partition.completed < 0
      || !Number.isSafeInteger(partition.failed)
      || partition.failed < 0
      || !nonEmpty(partition.currentPartition)) return { ok: false, code: "INVALID_WORK_PARTITION_PROGRESS" };
  }
  if (!Array.isArray(work.inputIds) || work.inputIds.some((id) => !nonEmpty(id)) || typeof work.completionRequested !== "boolean" || !nonEmpty(work.createdAt) || !nonEmpty(work.updatedAt) || work.parentWorkId === work.workId) return { ok: false, code: "INVALID_WORK_ENVELOPE" };
  if (work.inputArtifacts !== undefined && (!Array.isArray(work.inputArtifacts) || work.inputArtifacts.some((input) => !nonEmpty(input.artifactId) || !nonEmpty(input.analysisRunId) || !/^[a-f0-9]{64}$/.test(input.contentHash)))) {
    return { ok: false, code: "INVALID_WORK_INPUT_RECEIPTS" };
  }
  return { ok: true, value: work };
}

export function validateDomainEvent(value: unknown, projectId?: string): ValidationResult<ScenarioForgeDomainEvent> {
  if (!value || typeof value !== "object") return { ok: false, code: "INVALID_EVENT" };
  const event = value as ScenarioForgeDomainEvent;
  if (event.schemaVersion !== 1) return { ok: false, code: "INVALID_SCHEMA_VERSION" };
  if (!nonEmpty(event.eventId) || !nonEmpty(event.projectId) || !nonEmpty(event.occurredAt)) return { ok: false, code: "INVALID_EVENT_ENVELOPE" };
  if (projectId && event.projectId !== projectId) return { ok: false, code: "PROJECT_ID_MISMATCH" };
  if (!validRevision(event.revision)) return { ok: false, code: "INVALID_REVISION" };
  if (!DOMAIN_EVENT_TYPES.includes(event.eventType)) return { ok: false, code: "INVALID_EVENT_TYPE" };
  if (!record(event.payload)) return { ok: false, code: "INVALID_EVENT_PAYLOAD" };
  return { ok: true, value: event };
}

export function validateArtifactSubmission(value: unknown): ValidationResult<ArtifactSubmission> {
  if (!value || typeof value !== "object") return { ok: false, code: "INVALID_ARTIFACT_SUBMISSION" };
  const artifact = value as ArtifactSubmission;
  if (!nonEmpty(artifact.artifactId) || !nonEmpty(artifact.stagingPath) || !nonEmpty(artifact.contentHash)) {
    return { ok: false, code: "INVALID_ARTIFACT_SUBMISSION" };
  }
  if (!ANALYSIS_STAGES.includes(artifact.artifactType as (typeof ANALYSIS_STAGES)[number]) && !GENERATION_ARTIFACT_TYPES.includes(artifact.artifactType as (typeof GENERATION_ARTIFACT_TYPES)[number])) return { ok: false, code: "INVALID_ARTIFACT_TYPE" };
  if (artifact.generationStep !== undefined && !GENERATION_STEPS.includes(artifact.generationStep)) return { ok: false, code: "INVALID_ARTIFACT_GENERATION_STEP" };
  if (artifact.stagingPath.startsWith("/") || artifact.stagingPath.includes("..") || !/^[a-f0-9]{64}$/.test(artifact.contentHash)) return { ok: false, code: "INVALID_ARTIFACT_PROVENANCE" };
  if (!Array.isArray(artifact.relatedIds) || artifact.relatedIds.some((id) => !nonEmpty(id))) return { ok: false, code: "INVALID_RELATED_IDS" };
  return { ok: true, value: artifact };
}
