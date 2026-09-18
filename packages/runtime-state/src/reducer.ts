import { randomUUID } from "node:crypto";
import type {
  AnalysisStage,
  DomainError,
  GenerationArtifactType,
  GenerationStep,
  GenerationStepState,
  GenerationWorkRole,
  ProjectRuntimeState,
  ScenarioForgeDomainEvent,
  WorkDescriptor,
  WorkStateMutation,
} from "@scenarioforge/contracts";
import {
  ANALYSIS_STAGES,
  GENERATION_STEPS,
  createInitialGenerationSteps,
  generationStepStage,
  getNextGenerationStep,
  validateArtifactSubmission,
  validateWorkDescriptor,
} from "@scenarioforge/contracts";

export type StateCommand =
  | { type: "project.ready"; projectId: string; operationId: string; expectedRevision: number }
  | { type: "analysis.start"; projectId: string; operationId: string; expectedRevision: number; analysisRunId: string; sourceSnapshotId: string; sessionId: string }
  | { type: "analysis.recover"; projectId: string; operationId: string; expectedRevision: number }
  | { type: "analysis.stage.start"; projectId: string; operationId: string; expectedRevision: number; stage: import("@scenarioforge/contracts").AnalysisStage }
  | { type: "work.register"; projectId: string; operationId: string; expectedRevision: number; descriptor: WorkDescriptor }
  | { type: "work.begin"; projectId: string; workId: string; operationId: string; expectedRevision: number }
  | { type: "work.mutate"; projectId: string; sessionId: string; workId: string; operationId: string; expectedRevision: number; mutation: WorkStateMutation }
  | { type: "work.settle"; projectId: string; workId: string; operationId: string; expectedRevision: number }
  | { type: "artifact.persist"; projectId: string; artifactId: string; finalPath: string; operationId: string; expectedRevision: number }
  | { type: "analysis.stage.fail"; projectId: string; stage: import("@scenarioforge/contracts").AnalysisStage; error: { category: string; message: string }; operationId: string; expectedRevision: number }
  | { type: "analysis.stage.complete"; projectId: string; stage: import("@scenarioforge/contracts").AnalysisStage; operationId: string; expectedRevision: number }
  | { type: "analysis.step.start"; projectId: string; step: GenerationStep; role: GenerationWorkRole; operationId: string; expectedRevision: number }
  | { type: "analysis.step.role"; projectId: string; step: GenerationStep; role: GenerationWorkRole; operationId: string; expectedRevision: number }
  | { type: "analysis.step.fail"; projectId: string; step: GenerationStep; error: { category: string; code?: string; message: string }; operationId: string; expectedRevision: number }
  | { type: "analysis.step.complete"; projectId: string; step: GenerationStep; receiptArtifactId: string; contextManifestArtifactId?: string; operationId: string; expectedRevision: number };

export type StateCommit = {
  state: ProjectRuntimeState;
  event: ScenarioForgeDomainEvent;
};

export class StateInvariantError extends Error {
  constructor(public readonly code: string, message = code) {
    super(message);
    this.name = "StateInvariantError";
  }
}

const generationArtifactStage: Partial<Record<GenerationArtifactType, AnalysisStage>> = {
  "generation-plan": "src",
  src: "src",
  fact: "fact",
  wiki: "wiki",
  scenario: "scenario",
  "source-snapshot": "src",
  "fact-catalog": "fact",
  "edge-ledger": "fact",
  "fact-bundle": "fact",
  "workflow-skeleton": "wiki",
  "wiki-bundle": "wiki",
  "business-catalog": "wiki",
  "scenario-skeleton": "scenario",
  "scenario-set": "scenario",
  "coverage-manifest": "scenario",
};

function deriveCompatibilityStages(
  steps: Record<GenerationStep, GenerationStepState>,
): Pick<ProjectRuntimeState, "stages" | "progress"> {
  const stages = Object.fromEntries(ANALYSIS_STAGES.map((stage) => {
    const members = GENERATION_STEPS.filter((step) => generationStepStage(step) === stage).map((step) => steps[step]);
    if (members.every((member) => member.status === "completed")) return [stage, "completed"];
    if (members.some((member) => member.status === "failed")) return [stage, "failed"];
    if (members.some((member) => member.status !== "pending")) return [stage, "running"];
    return [stage, "pending"];
  })) as ProjectRuntimeState["stages"];
  const completed = GENERATION_STEPS.filter((step) => steps[step].status === "completed").length;
  return { stages, progress: Math.round((completed / GENERATION_STEPS.length) * 100) };
}

function assertCommand(state: ProjectRuntimeState, command: StateCommand): void {
  if (state.projectId !== command.projectId) throw new StateInvariantError("PROJECT_ID_MISMATCH");
  if (state.revision !== command.expectedRevision) throw new StateInvariantError("STALE_REVISION");
  if (state.appliedOperationIds.includes(command.operationId)) throw new StateInvariantError("OPERATION_ALREADY_APPLIED");
}

function assertNewWorkObjective(work: WorkDescriptor): void {
  if ((work.kind === "analysis.generation-plan" || work.generationStep) && !work.objective?.trim()) {
    throw new StateInvariantError("WORK_OBJECTIVE_REQUIRED");
  }
}

function applyMutation(state: ProjectRuntimeState, workId: string, mutation: WorkStateMutation, now: string): ProjectRuntimeState {
  const work = state.works[workId];
  if (!work) throw new StateInvariantError("WORK_NOT_FOUND");
  const works = { ...state.works };
  const activities = { ...state.activities };
  const artifacts = { ...state.artifacts };
  const tombstones = [...state.tombstones];
  let currentActivity = state.currentActivity;

  switch (mutation.op) {
    case "add-child":
      if (mutation.descriptor.parentWorkId !== workId) throw new StateInvariantError("WORK_SCOPE_VIOLATION");
      if (!validateWorkDescriptor(mutation.descriptor, state.projectId).ok || mutation.descriptor.sessionId !== work.sessionId || mutation.descriptor.analysisRunId !== work.analysisRunId) throw new StateInvariantError("INVALID_CHILD_WORK");
      assertNewWorkObjective(mutation.descriptor);
      if (works[mutation.descriptor.workId]) throw new StateInvariantError("WORK_ALREADY_EXISTS");
      works[mutation.descriptor.workId] = mutation.descriptor;
      break;
    case "update-progress":
      if (mutation.patch.workId !== workId) throw new StateInvariantError("WORK_SCOPE_VIOLATION");
      if (!Number.isFinite(mutation.patch.progress) || mutation.patch.progress < 0 || mutation.patch.progress > 100) throw new StateInvariantError("INVALID_PROGRESS");
      if (mutation.patch.currentActivity !== undefined && !mutation.patch.currentActivity.trim()) throw new StateInvariantError("INVALID_CURRENT_ACTIVITY");
      if (mutation.patch.partitionProgress !== undefined) {
        const partition = mutation.patch.partitionProgress;
        if (!GENERATION_STEPS.includes(partition.generationStep)
          || !["author", "reviewer", "repair"].includes(partition.role)
          || !Number.isSafeInteger(partition.completed)
          || partition.completed < 0
          || !Number.isSafeInteger(partition.failed)
          || partition.failed < 0
          || !partition.currentPartition.trim()) throw new StateInvariantError("INVALID_WORK_PARTITION_PROGRESS");
      }
      currentActivity = mutation.patch.currentActivity ?? currentActivity;
      works[workId] = {
        ...work,
        progress: mutation.patch.progress,
        ...(mutation.patch.partitionProgress ? { partitionProgress: mutation.patch.partitionProgress } : {}),
        updatedAt: now,
      };
      break;
    case "record-activity":
      if (mutation.activity.workId !== workId) throw new StateInvariantError("WORK_SCOPE_VIOLATION");
      if (mutation.activity.projectId !== state.projectId || mutation.activity.sessionId !== work.sessionId) throw new StateInvariantError("ACTIVITY_SCOPE_VIOLATION");
      if (activities[mutation.activity.activityId] && ["succeeded", "failed", "cancelled"].includes(activities[mutation.activity.activityId].status)) throw new StateInvariantError("TERMINAL_ACTIVITY_IMMUTABLE");
      activities[mutation.activity.activityId] = mutation.activity;
      break;
    case "submit-artifacts":
      for (const submission of mutation.artifacts) {
        if (!validateArtifactSubmission(submission).ok) throw new StateInvariantError("INVALID_ARTIFACT_SUBMISSION");
        const expectedPrefix = `.scenarioforge/staging/${workId}/`;
        if (!submission.stagingPath.startsWith(expectedPrefix) || submission.stagingPath.includes("..") || !/^[a-f0-9]{64}$/.test(submission.contentHash)) throw new StateInvariantError("ARTIFACT_STAGING_SCOPE_VIOLATION");
        const existing = artifacts[submission.artifactId];
        if (existing?.status === "persisted") throw new StateInvariantError("PERSISTED_ARTIFACT_IMMUTABLE");
        if (work.generationStep && submission.generationStep !== work.generationStep) throw new StateInvariantError("ARTIFACT_STEP_SCOPE_VIOLATION");
        artifacts[submission.artifactId] = {
          ...submission,
          projectId: state.projectId!,
          analysisRunId: work.analysisRunId,
          sourceSnapshotId: work.sourceSnapshotId ?? "pending-source-snapshot",
          workId,
          status: "staged",
          createdAt: now,
        };
      }
      break;
    case "tombstone-draft": {
      const artifact = artifacts[mutation.artifactId];
      if (!artifact) throw new StateInvariantError("ARTIFACT_NOT_FOUND");
      if (artifact.workId !== workId) throw new StateInvariantError("WORK_SCOPE_VIOLATION");
      if (artifact.status === "persisted") throw new StateInvariantError("PERSISTED_ARTIFACT_IMMUTABLE");
      delete artifacts[mutation.artifactId];
      tombstones.push({ entityId: mutation.artifactId, entityType: "draft-artifact", deletedAt: now, reason: mutation.reason });
      break;
    }
    case "release-checkpointed-artifacts": {
      if (!mutation.artifactIds.length || new Set(mutation.artifactIds).size !== mutation.artifactIds.length) throw new StateInvariantError("INVALID_CHECKPOINTED_ARTIFACT_RELEASE");
      for (const artifactId of mutation.artifactIds) {
        const artifact = artifacts[artifactId];
        if (!artifact || artifact.workId !== workId || artifact.status !== "staged") throw new StateInvariantError("CHECKPOINTED_ARTIFACT_RELEASE_SCOPE_VIOLATION");
        delete artifacts[artifactId];
      }
      break;
    }
    case "release-checkpointed-work": {
      if (!work.parentWorkId) throw new StateInvariantError("CHECKPOINTED_ROOT_WORK_RELEASE_FORBIDDEN");
      if (Object.values(artifacts).some((artifact) => artifact.workId === workId)) throw new StateInvariantError("CHECKPOINTED_WORK_ARTIFACTS_NOT_RELEASED");
      if (Object.values(activities).some((activity) => activity.workId === workId && ["queued", "running"].includes(activity.status))) {
        throw new StateInvariantError("CHECKPOINTED_WORK_ACTIVITY_ACTIVE");
      }
      for (const [activityId, activity] of Object.entries(activities)) {
        if (activity.workId === workId) delete activities[activityId];
      }
      delete works[workId];
      break;
    }
    case "report-failure":
      if (!mutation.error.code.trim() || !mutation.error.message.trim() || typeof mutation.error.retryable !== "boolean") throw new StateInvariantError("INVALID_DOMAIN_ERROR");
      works[workId] = { ...work, status: "failed", error: mutation.error, updatedAt: now };
      break;
    case "request-completion":
      works[workId] = { ...work, completionRequested: true, updatedAt: now };
      break;
  }
  return { ...state, works, activities, artifacts, tombstones, currentActivity };
}

export function reduceState(state: ProjectRuntimeState, command: StateCommand, now = new Date().toISOString()): StateCommit {
  assertCommand(state, command);
  let next = state;
  let eventType: ScenarioForgeDomainEvent["eventType"] = "work.updated";
  if (command.type === "project.ready") {
    next = { ...state, projectStatus: "ready", runtimeStatus: "ready", sessionStatus: "idle" };
    eventType = "project.runtime.updated";
  } else if (command.type === "analysis.start") {
    next = {
      ...state,
      analysisRunId: command.analysisRunId,
      sourceSnapshotId: command.sourceSnapshotId,
      sessionId: command.sessionId,
      runtimeStatus: "ready",
      sessionStatus: "idle",
      activeStage: undefined,
      activeStep: undefined,
      activeRole: undefined,
      currentActivity: undefined,
      generationSteps: createInitialGenerationSteps(),
      stages: { src: "pending", fact: "pending", wiki: "pending", scenario: "pending" },
      artifactStatus: { src: "absent", fact: "absent", wiki: "absent", scenario: "absent" },
      progress: 0,
      recoverable: true,
      lastError: undefined,
    };
    eventType = "analysis.session.updated";
  } else if (command.type === "analysis.recover") {
    /* 리터럴이 넓어지면 DomainError 의 category 유니온과 맞지 않는다.
     * 선언에서 형을 고정해 호출부마다 단언하지 않는다. */
    const interruptedWorkError: DomainError = {
      code: "RECOVERY_INTERRUPTED_WORK",
      category: "runtime",
      message: "The analysis process ended before work completion.",
      retryable: true,
    };
    const works: Record<string, WorkDescriptor> = Object.fromEntries(
      Object.entries(state.works).map(([workId, work]): [string, WorkDescriptor] => [
        workId,
        work.analysisRunId === state.analysisRunId
          && work.sessionId === state.sessionId
          && ["pending", "running"].includes(work.status)
          ? { ...work, status: "failed", error: interruptedWorkError, updatedAt: now }
          : work,
      ]),
    );
    const activeStep = state.activeStep;
    const interruptedStep = activeStep
      && ["running", "validating", "repairable"].includes(state.generationSteps[activeStep].status);
    const generationSteps = interruptedStep ? {
      ...state.generationSteps,
      [activeStep]: {
        ...state.generationSteps[activeStep],
        status: "failed" as const,
        error: {
          category: "runtime",
          code: "RECOVERY_INTERRUPTED_STEP",
          message: "The analysis process ended before step completion.",
        },
      },
    } : state.generationSteps;
    const compatibility = deriveCompatibilityStages(generationSteps);
    next = {
      ...state,
      ...compatibility,
      works,
      generationSteps,
      activeStep: undefined,
      activeRole: undefined,
      currentActivity: undefined,
      runtimeStatus: "recovering",
      sessionStatus: "recovering",
      recoverable: true,
      ...(interruptedStep ? {
        lastError: { category: "runtime", message: "The analysis process ended before step completion." },
        artifactStatus: { ...state.artifactStatus, [generationStepStage(activeStep)]: "invalid" as const },
      } : {}),
    };
    eventType = "analysis.session.updated";
  } else if (command.type === "analysis.stage.start") {
    const order = ["src", "fact", "wiki", "scenario"] as const;
    const index = order.indexOf(command.stage);
    if (index > 0 && state.stages[order[index - 1]] !== "completed") throw new StateInvariantError("ANALYSIS_STAGE_ORDER_VIOLATION");
    if (state.stages[command.stage] === "completed") throw new StateInvariantError("COMPLETED_STAGE_IMMUTABLE");
    if (!["pending", "failed"].includes(state.stages[command.stage])) throw new StateInvariantError("ANALYSIS_STAGE_ALREADY_ACTIVE");
    next = { ...state, runtimeStatus: "ready", activeStage: command.stage, currentActivity: undefined, sessionStatus: "running", stages: { ...state.stages, [command.stage]: "running" }, artifactStatus: { ...state.artifactStatus, [command.stage]: "generating" }, lastError: undefined };
    eventType = "analysis.stage.started";
  } else if (command.type === "analysis.step.start") {
    const nextStep = getNextGenerationStep(state.generationSteps);
    if (nextStep !== command.step) throw new StateInvariantError("GENERATION_STEP_ORDER_VIOLATION");
    const current = state.generationSteps[command.step];
    if (!["pending", "failed"].includes(current.status)) throw new StateInvariantError("GENERATION_STEP_ALREADY_ACTIVE");
    const stepState: GenerationStepState = { step: command.step, status: "running", role: command.role };
    next = {
      ...state,
      activeStage: generationStepStage(command.step),
      activeStep: command.step,
      activeRole: command.role,
      currentActivity: undefined,
      runtimeStatus: "ready",
      sessionStatus: "running",
      generationSteps: { ...state.generationSteps, [command.step]: stepState },
      stages: { ...state.stages, [generationStepStage(command.step)]: "running" },
      artifactStatus: { ...state.artifactStatus, [generationStepStage(command.step)]: "generating" },
      lastError: undefined,
    };
    eventType = "analysis.step.started";
  } else if (command.type === "analysis.step.role") {
    if (state.activeStep !== command.step || state.generationSteps[command.step].status !== "running") throw new StateInvariantError("GENERATION_STEP_NOT_ACTIVE");
    next = {
      ...state,
      activeRole: command.role,
      sessionStatus: "running",
      generationSteps: {
        ...state.generationSteps,
        [command.step]: { ...state.generationSteps[command.step], role: command.role },
      },
    };
    eventType = "analysis.session.updated";
  } else if (command.type === "work.register") {
    if (!validateWorkDescriptor(command.descriptor, command.projectId).ok) throw new StateInvariantError("INVALID_WORK_DESCRIPTOR");
    assertNewWorkObjective(command.descriptor);
    if (state.analysisRunId && command.descriptor.analysisRunId !== state.analysisRunId) throw new StateInvariantError("ANALYSIS_RUN_SCOPE_VIOLATION");
    if (state.sessionId && command.descriptor.sessionId !== state.sessionId) throw new StateInvariantError("SESSION_SCOPE_VIOLATION");
    if (state.sourceSnapshotId && command.descriptor.sourceSnapshotId !== state.sourceSnapshotId) throw new StateInvariantError("SOURCE_SNAPSHOT_SCOPE_VIOLATION");
    if (state.activeStage && command.descriptor.stage !== state.activeStage) throw new StateInvariantError("STAGE_SCOPE_VIOLATION");
    if (state.activeStep && command.descriptor.generationStep !== state.activeStep) throw new StateInvariantError("GENERATION_STEP_SCOPE_VIOLATION");
    if (state.activeRole && command.descriptor.role !== state.activeRole) throw new StateInvariantError("GENERATION_ROLE_SCOPE_VIOLATION");
    if (state.works[command.descriptor.workId]) throw new StateInvariantError("WORK_ALREADY_EXISTS");
    next = { ...state, works: { ...state.works, [command.descriptor.workId]: command.descriptor } };
  } else if (command.type === "work.begin") {
    const work = state.works[command.workId];
    if (!work) throw new StateInvariantError("WORK_NOT_FOUND");
    if (!["pending", "running"].includes(work.status)) throw new StateInvariantError("WORK_NOT_BEGINNABLE");
    for (const input of work.inputArtifacts ?? []) {
      const receipt = state.artifacts[input.artifactId];
      if (!receipt || receipt.status !== "persisted" || receipt.analysisRunId !== work.analysisRunId || input.analysisRunId !== work.analysisRunId || receipt.contentHash !== input.contentHash) {
        throw new StateInvariantError("WORK_INPUT_RECEIPT_MISMATCH");
      }
    }
    next = { ...state, works: { ...state.works, [command.workId]: { ...work, status: "running", updatedAt: now } } };
  } else if (command.type === "work.mutate") {
    const work = state.works[command.workId];
    if (!work || command.sessionId !== work.sessionId) throw new StateInvariantError("WORK_SCOPE_VIOLATION");
    if (work.status !== "running") throw new StateInvariantError("WORK_NOT_RUNNING");
    next = applyMutation(state, command.workId, command.mutation, now);
  } else if (command.type === "work.settle") {
    const work = state.works[command.workId];
    if (!work) throw new StateInvariantError("WORK_NOT_FOUND");
    if (work.status !== "running") throw new StateInvariantError("WORK_NOT_RUNNING");
    next = { ...state, sessionStatus: "settled", works: { ...state.works, [command.workId]: { ...work, status: "settled", updatedAt: now } } };
  } else if (command.type === "artifact.persist") {
    const artifact = state.artifacts[command.artifactId];
    if (!artifact) throw new StateInvariantError("ARTIFACT_NOT_FOUND");
    if (artifact.status === "persisted") throw new StateInvariantError("PERSISTED_ARTIFACT_IMMUTABLE");
    const artifactStage = generationArtifactStage[artifact.artifactType] ?? (artifact.generationStep ? generationStepStage(artifact.generationStep) : undefined);
    next = {
      ...state,
      artifacts: { ...state.artifacts, [command.artifactId]: { ...artifact, status: "persisted", finalPath: command.finalPath } },
      artifactStatus: artifactStage ? { ...state.artifactStatus, [artifactStage]: "persisted" } : state.artifactStatus,
    };
    eventType = "analysis.artifact.persisted";
  } else if (command.type === "analysis.step.fail") {
    if (state.activeStep !== command.step || !["running", "validating", "repairable"].includes(state.generationSteps[command.step].status)) throw new StateInvariantError("GENERATION_STEP_NOT_ACTIVE");
    const generationSteps = {
      ...state.generationSteps,
      [command.step]: { ...state.generationSteps[command.step], status: "failed" as const, error: command.error },
    };
    const compatibility = deriveCompatibilityStages(generationSteps);
    next = {
      ...state,
      ...compatibility,
      generationSteps,
      activeStep: undefined,
      activeRole: undefined,
      currentActivity: undefined,
      sessionStatus: "failed",
      recoverable: true,
      lastError: { category: command.error.category, message: command.error.message },
      artifactStatus: { ...state.artifactStatus, [generationStepStage(command.step)]: "invalid" },
    };
    eventType = "analysis.step.failed";
  } else if (command.type === "analysis.step.complete") {
    if (state.activeStep !== command.step || !["running", "validating"].includes(state.generationSteps[command.step].status)) throw new StateInvariantError("GENERATION_STEP_NOT_ACTIVE");
    const receipt = state.artifacts[command.receiptArtifactId];
    if (!receipt || receipt.status !== "persisted" || receipt.analysisRunId !== state.analysisRunId || receipt.generationStep !== command.step) {
      throw new StateInvariantError("GENERATION_STEP_RECEIPT_NOT_PERSISTED");
    }
    const producingWork = state.works[receipt.workId];
    if (!producingWork || producingWork.status !== "settled" || producingWork.generationStep !== command.step) {
      throw new StateInvariantError("GENERATION_STEP_WORK_NOT_SETTLED");
    }
    const contextManifest = command.contextManifestArtifactId ? state.artifacts[command.contextManifestArtifactId] : undefined;
    if (command.contextManifestArtifactId && (!contextManifest || contextManifest.status !== "persisted" || contextManifest.analysisRunId !== state.analysisRunId || contextManifest.generationStep !== command.step || contextManifest.artifactType !== "context-manifest")) {
      throw new StateInvariantError("GENERATION_CONTEXT_MANIFEST_NOT_PERSISTED");
    }
    const generationSteps = {
      ...state.generationSteps,
      [command.step]: {
        ...state.generationSteps[command.step],
        status: "completed" as const,
        receiptArtifactId: command.receiptArtifactId,
        ...(command.contextManifestArtifactId ? { contextManifestArtifactId: command.contextManifestArtifactId } : {}),
      },
    };
    const compatibility = deriveCompatibilityStages(generationSteps);
    next = {
      ...state,
      ...compatibility,
      activeStage: undefined,
      activeStep: undefined,
      activeRole: undefined,
      currentActivity: undefined,
      sessionStatus: "idle",
      generationSteps,
      recoverable: command.step !== "coverage-manifest",
    };
    eventType = "analysis.step.completed";
  } else if (command.type === "analysis.stage.fail") {
    if (state.activeStage !== command.stage || state.stages[command.stage] === "completed") throw new StateInvariantError("ANALYSIS_STAGE_NOT_ACTIVE");
    next = { ...state, sessionStatus: "failed", stages: { ...state.stages, [command.stage]: "failed" }, artifactStatus: { ...state.artifactStatus, [command.stage]: "invalid" }, recoverable: true, lastError: command.error };
    eventType = "analysis.stage.failed";
  } else if (command.type === "analysis.stage.complete") {
    if (state.activeStage !== command.stage || state.stages[command.stage] === "completed") throw new StateInvariantError("ANALYSIS_STAGE_NOT_ACTIVE");
    if (state.artifactStatus[command.stage] !== "persisted") throw new StateInvariantError("STAGE_ARTIFACT_NOT_PERSISTED");
    const order = ["src", "fact", "wiki", "scenario"] as const;
    const completed = order.filter((stage) => stage === command.stage || state.stages[stage] === "completed").length;
    next = { ...state, activeStage: undefined, sessionStatus: "idle", stages: { ...state.stages, [command.stage]: "completed" }, progress: completed * 25, recoverable: command.stage !== "scenario" };
    eventType = "analysis.stage.completed";
  }

  const revision = state.revision + 1;
  next = { ...next, revision, appliedOperationIds: [...state.appliedOperationIds, command.operationId] };
  return {
    state: next,
    event: {
      schemaVersion: 1,
      eventId: randomUUID(),
      eventType,
      projectId: command.projectId,
      revision,
      occurredAt: now,
      sessionId: next.sessionId,
      analysisRunId: next.analysisRunId,
      workId: command.type === "work.register" ? command.descriptor.workId : "workId" in command ? command.workId : undefined,
      payload: { commandType: command.type },
    },
  };
}
