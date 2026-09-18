import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createInitialProjectRuntimeState, validateProjectRuntimeState, type ProjectRuntimeState, type WorkDescriptor, type WorkStateMutation } from "@scenarioforge/contracts";
import { JournalRepository, migrateProjectRuntimeState, reduceState, RuntimeStateCoordinator, WORK_STATE_HEADINGS, WorkStateService, renderWorkStateMarkdown } from "./index.js";

function descriptor(revision = 0): WorkDescriptor {
  return {
    schemaVersion: 1,
    projectId: "project-1",
    analysisRunId: "run-1",
    sourceSnapshotId: "SRC-SNAPSHOT-1",
    sessionId: "session-1",
    workId: "work-1",
    kind: "analysis.fact-extract",
    stage: "fact",
    attemptId: "attempt-1",
    expectedRevision: revision,
    inputIds: ["SRC-MOD-1"],
    stagingPath: ".scenarioforge/staging/work-1",
    status: "pending",
    createdAt: "2026-08-26T00:00:00.000Z",
    updatedAt: "2026-08-26T00:00:00.000Z",
    progress: 0,
    completionRequested: false,
  };
}

describe("runtime state ledger", () => {
  it("creates exactly one next revision and one domain event", () => {
    const state = { ...createInitialProjectRuntimeState("project-1"), revision: 7, works: { "work-1": descriptor(7) } };
    const result = reduceState(state, { type: "work.begin", projectId: "project-1", workId: "work-1", operationId: "operation-1", expectedRevision: 7 });
    expect(result.state.revision).toBe(8);
    expect(result.event.revision).toBe(8);
    expect(Array.isArray(result.event)).toBe(false);
  });

  it("requires a fresh context token before begin and persists a hash-valid commit", async () => {
    const root = await mkdtemp(join(tmpdir(), "scenarioforge-state-"));
    const initial = createInitialProjectRuntimeState("project-1");
    const repository = new JournalRepository(root);
    await repository.initialize(initial);
    const coordinator = new RuntimeStateCoordinator(initial, repository);
    const service = new WorkStateService(coordinator);
    await service.register(descriptor(), "register-1");
    await expect(service.begin({ projectId: "project-1", workId: "work-1", operationId: "begin-bad", expectedRevision: 1, contextToken: "" })).rejects.toMatchObject({ code: "CONTEXT_REQUIRED" });
    const context = await service.getContext("project-1", "work-1");
    await service.begin({ projectId: "project-1", workId: "work-1", operationId: "begin-1", expectedRevision: context.revision, contextToken: context.contextToken });
    expect((await repository.recoverLatest())?.revision).toBe(2);
    expect(await readFile(join(root, ".scenarioforge/state/WORK_STATE.md"), "utf8")).toContain("## Current Assignment");
  });

  it("releases checkpointed staged artifacts without growing the tombstone aggregate", () => {
    const work = { ...descriptor(), status: "running" as const };
    const artifact = (artifactId: string) => ({
      artifactId,
      artifactType: "fact" as const,
      stagingPath: `.scenarioforge/staging/${work.workId}/${artifactId}.json`,
      relatedIds: [],
      contentHash: "a".repeat(64),
      projectId: work.projectId,
      analysisRunId: work.analysisRunId,
      sourceSnapshotId: work.sourceSnapshotId!,
      workId: work.workId,
      status: "staged" as const,
      createdAt: "2026-09-10T00:00:00.000Z",
    });
    const state = {
      ...createInitialProjectRuntimeState(work.projectId),
      works: { [work.workId]: work },
      artifacts: { partition: artifact("partition"), context: artifact("context") },
    };

    const released = reduceState(state, {
      type: "work.mutate",
      projectId: work.projectId,
      sessionId: work.sessionId,
      workId: work.workId,
      operationId: "release",
      expectedRevision: 0,
      mutation: { op: "release-checkpointed-artifacts", artifactIds: ["partition", "context"] },
    }).state;

    expect(released.artifacts).toEqual({});
    expect(released.tombstones).toEqual([]);
  });

  it("persists only compact partition counts and the current partition in work state", () => {
    const work = { ...descriptor(), status: "running" as const };
    const state = { ...createInitialProjectRuntimeState(work.projectId), works: { [work.workId]: work } };
    const mutation = {
      op: "update-progress",
      patch: {
        workId: work.workId,
        progress: 50,
        currentActivity: "fact-catalog:author:S2",
        partitionProgress: { generationStep: "fact-catalog", role: "author", completed: 1, failed: 0, currentPartition: "S2" },
      },
    } as unknown as WorkStateMutation;

    const updated = reduceState(state, {
      type: "work.mutate",
      projectId: work.projectId,
      sessionId: work.sessionId,
      workId: work.workId,
      operationId: "partition-progress",
      expectedRevision: 0,
      mutation,
    }).state;

    expect(updated.currentActivity).toBe("fact-catalog:author:S2");
    expect(updated.works[work.workId]).toMatchObject({
      progress: 50,
      partitionProgress: { generationStep: "fact-catalog", role: "author", completed: 1, failed: 0, currentPartition: "S2" },
    });
    expect(validateProjectRuntimeState(updated).ok).toBe(true);
  });

  it("compacts a checkpointed child work after all of its artifacts are released", () => {
    const root = { ...descriptor(), workId: "root", stagingPath: ".scenarioforge/staging/root", status: "running" as const };
    const child = { ...descriptor(), workId: "child", parentWorkId: root.workId, stagingPath: ".scenarioforge/staging/child", status: "running" as const };
    const state = {
      ...createInitialProjectRuntimeState(root.projectId),
      works: { [root.workId]: root, [child.workId]: child },
    };

    const compacted = reduceState(state, {
      type: "work.mutate",
      projectId: child.projectId,
      sessionId: child.sessionId,
      workId: child.workId,
      operationId: "compact-child",
      expectedRevision: 0,
      mutation: { op: "release-checkpointed-work" },
    }).state;

    expect(compacted.works).toEqual({ [root.workId]: root });
    expect(compacted.tombstones).toEqual([]);
    expect(validateProjectRuntimeState(compacted).ok).toBe(true);
    expect(() => reduceState({ ...state, works: { [root.workId]: root } }, {
      type: "work.mutate",
      projectId: root.projectId,
      sessionId: root.sessionId,
      workId: root.workId,
      operationId: "compact-root",
      expectedRevision: 0,
      mutation: { op: "release-checkpointed-work" },
    })).toThrow("CHECKPOINTED_ROOT_WORK_RELEASE_FORBIDDEN");
    const stagedArtifact = {
      artifactId: "partition",
      artifactType: "fact" as const,
      stagingPath: ".scenarioforge/staging/child/partition.json",
      relatedIds: [],
      contentHash: "a".repeat(64),
      projectId: child.projectId,
      analysisRunId: child.analysisRunId,
      sourceSnapshotId: child.sourceSnapshotId!,
      workId: child.workId,
      status: "staged" as const,
      createdAt: "2026-09-10T00:00:00.000Z",
    };
    expect(() => reduceState({ ...state, artifacts: { [stagedArtifact.artifactId]: stagedArtifact } }, {
      type: "work.mutate",
      projectId: child.projectId,
      sessionId: child.sessionId,
      workId: child.workId,
      operationId: "compact-with-artifact",
      expectedRevision: 0,
      mutation: { op: "release-checkpointed-work" },
    })).toThrow("CHECKPOINTED_WORK_ARTIFACTS_NOT_RELEASED");
  });

  it("persists checkpointed child compaction through the work-state service", async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), "scenarioforge-checkpoint-work-compaction-"));
    const rootWork = { ...descriptor(), workId: "root", stagingPath: ".scenarioforge/staging/root", status: "running" as const };
    const childWork = { ...descriptor(), workId: "child", parentWorkId: rootWork.workId, stagingPath: ".scenarioforge/staging/child", status: "running" as const };
    const artifact = {
      artifactId: "partition",
      artifactType: "fact" as const,
      stagingPath: ".scenarioforge/staging/child/partition.json",
      relatedIds: [],
      contentHash: "a".repeat(64),
      projectId: childWork.projectId,
      analysisRunId: childWork.analysisRunId,
      sourceSnapshotId: childWork.sourceSnapshotId!,
      workId: childWork.workId,
      status: "staged" as const,
      createdAt: "2026-09-10T00:00:00.000Z",
    };
    const initial = {
      ...createInitialProjectRuntimeState(rootWork.projectId),
      works: { [rootWork.workId]: rootWork, [childWork.workId]: childWork },
      artifacts: { [artifact.artifactId]: artifact },
    };
    const repository = new JournalRepository(stateRoot);
    await repository.initialize(initial);
    const service = new WorkStateService(new RuntimeStateCoordinator(initial, repository));

    await service.releaseCheckpointedArtifacts({ projectId: childWork.projectId, workId: childWork.workId, expectedRevision: 0, artifactIds: [artifact.artifactId] });
    await service.releaseCheckpointedWork({ projectId: childWork.projectId, workId: childWork.workId, expectedRevision: 1 });

    const recovered = await repository.recoverLatest();
    expect(recovered?.state.works).toEqual({ [rootWork.workId]: rootWork });
    expect(recovered?.state.artifacts).toEqual({});
    expect(recovered?.revision).toBe(2);
  });

  it("persists compact partition progress through the work-state service and journal", async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), "scenarioforge-partition-progress-"));
    const work = { ...descriptor(), status: "running" as const };
    const initial = { ...createInitialProjectRuntimeState(work.projectId), works: { [work.workId]: work } };
    const repository = new JournalRepository(stateRoot);
    await repository.initialize(initial);
    const service = new WorkStateService(new RuntimeStateCoordinator(initial, repository));

    await service.mutate({
      projectId: work.projectId,
      sessionId: work.sessionId,
      workId: work.workId,
      operationId: "partition-progress",
      expectedRevision: 0,
      mutation: {
        op: "update-progress",
        patch: {
          workId: work.workId,
          progress: 25,
          currentActivity: "fact-catalog:author:S1",
          partitionProgress: { generationStep: "fact-catalog", role: "author", completed: 1, failed: 0, currentPartition: "S1" },
        },
      },
    });

    const recovered = await repository.recoverLatest();
    expect(recovered?.state.currentActivity).toBe("fact-catalog:author:S1");
    expect(recovered?.state.works[work.workId]?.partitionProgress).toEqual({ generationStep: "fact-catalog", role: "author", completed: 1, failed: 0, currentPartition: "S1" });
    expect(recovered?.revision).toBe(1);
  });

  it("makes interrupted step work retryable during recovery", () => {
    const rootWork = {
      ...descriptor(),
      analysisRunId: "run-current",
      sessionId: "session-current",
      generationStep: "fact-catalog" as const,
      role: "author" as const,
      status: "running" as const,
    };
    const reviewerWork = {
      ...rootWork,
      workId: "reviewer-work",
      parentWorkId: rootWork.workId,
      role: "reviewer" as const,
    };
    const historicalWork = {
      ...rootWork,
      workId: "historical-work",
      analysisRunId: "run-historical",
      sessionId: "session-historical",
    };
    const state = {
      ...createInitialProjectRuntimeState(rootWork.projectId),
      analysisRunId: rootWork.analysisRunId,
      sourceSnapshotId: rootWork.sourceSnapshotId,
      sessionId: rootWork.sessionId,
      activeStage: "fact" as const,
      activeStep: "fact-catalog" as const,
      activeRole: "reviewer" as const,
      currentActivity: "fact-catalog:reviewer:S2",
      runtimeStatus: "ready" as const,
      sessionStatus: "running" as const,
      stages: { src: "completed" as const, fact: "running" as const, wiki: "pending" as const, scenario: "pending" as const },
      artifactStatus: { src: "persisted" as const, fact: "generating" as const, wiki: "absent" as const, scenario: "absent" as const },
      generationSteps: {
        ...createInitialProjectRuntimeState(rootWork.projectId).generationSteps,
        "source-scan": { step: "source-scan" as const, status: "completed" as const, role: "deterministic" as const, receiptArtifactId: "SNAP-test" },
        "fact-catalog": { step: "fact-catalog" as const, status: "running" as const, role: "reviewer" as const },
      },
      works: {
        [rootWork.workId]: rootWork,
        [reviewerWork.workId]: reviewerWork,
        [historicalWork.workId]: historicalWork,
      },
    };

    const recovered = reduceState(state, {
      type: "analysis.recover",
      projectId: rootWork.projectId,
      operationId: "recover",
      expectedRevision: 0,
    }).state;

    expect(recovered.generationSteps["fact-catalog"]).toMatchObject({ status: "failed", error: { code: "RECOVERY_INTERRUPTED_STEP" } });
    expect(recovered.currentActivity).toBeUndefined();
    expect(recovered.works[rootWork.workId]).toMatchObject({ status: "failed", error: { code: "RECOVERY_INTERRUPTED_WORK", retryable: true } });
    expect(recovered.works[reviewerWork.workId]).toMatchObject({ status: "failed", error: { code: "RECOVERY_INTERRUPTED_WORK", retryable: true } });
    expect(recovered.works[historicalWork.workId]?.status).toBe("running");
    expect(recovered).toMatchObject({
      activeStage: "fact",
      activeStep: undefined,
      activeRole: undefined,
      runtimeStatus: "recovering",
      sessionStatus: "recovering",
      stages: { fact: "failed" },
      artifactStatus: { fact: "invalid" },
    });
  });

  it("renders every protocol heading in a stable order", () => {
    const markdown = renderWorkStateMarkdown(createInitialProjectRuntimeState("project-1"));
    const positions = WORK_STATE_HEADINGS.map((heading) => markdown.indexOf(`## ${heading}`));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it("renders the running work scoped to the current run, session, and active stage", () => {
    const historicalWork = {
      ...descriptor(),
      workId: "historical-work",
      analysisRunId: "run-historical",
      sessionId: "session-historical",
      sourceSnapshotId: "SNAP-historical",
      inputIds: ["SNAP-historical"],
      status: "running" as const,
    };
    const wrongSessionWork = {
      ...descriptor(),
      workId: "wrong-session-work",
      analysisRunId: "run-current",
      sessionId: "session-historical",
      sourceSnapshotId: "SNAP-wrong-session",
      inputIds: ["SNAP-wrong-session"],
      status: "running" as const,
    };
    const wrongStageWork = {
      ...descriptor(),
      workId: "wrong-stage-work",
      analysisRunId: "run-current",
      sessionId: "session-current",
      sourceSnapshotId: "SNAP-wrong-stage",
      inputIds: ["SNAP-wrong-stage"],
      kind: "analysis.wiki-compose" as const,
      stage: "wiki" as const,
      status: "running" as const,
    };
    const currentWork = {
      ...descriptor(),
      workId: "current-work",
      analysisRunId: "run-current",
      sessionId: "session-current",
      sourceSnapshotId: "SNAP-current",
      inputIds: ["SNAP-current"],
      status: "running" as const,
    };
    const state = {
      ...createInitialProjectRuntimeState("project-1"),
      analysisRunId: "run-current",
      sessionId: "session-current",
      sourceSnapshotId: "SNAP-current",
      activeStage: "fact" as const,
      currentActivity: "fact-catalog:author:S2",
      works: {
        [historicalWork.workId]: historicalWork,
        [wrongSessionWork.workId]: wrongSessionWork,
        [wrongStageWork.workId]: wrongStageWork,
        [currentWork.workId]: currentWork,
      },
    };

    const markdown = renderWorkStateMarkdown(state);

    expect(markdown).toContain("- workId: current-work");
    expect(markdown).toContain("- activity: fact-catalog:author:S2");
    expect(markdown).toContain("- SNAP-current");
    expect(markdown).not.toContain("historical-work");
    expect(markdown).not.toContain("SNAP-historical");
    expect(markdown).not.toContain("wrong-session-work");
    expect(markdown).not.toContain("wrong-stage-work");
  });

  it("does not fall back to a historical running work before current-stage work is registered", () => {
    const historicalWork = {
      ...descriptor(),
      workId: "historical-work",
      analysisRunId: "run-historical",
      sessionId: "session-historical",
      status: "running" as const,
    };
    const state = {
      ...createInitialProjectRuntimeState("project-1"),
      analysisRunId: "run-current",
      sessionId: "session-current",
      sourceSnapshotId: "SNAP-current",
      activeStage: "fact" as const,
      works: { [historicalWork.workId]: historicalWork },
    };

    const markdown = renderWorkStateMarkdown(state);

    expect(markdown).toContain("- workId: none");
    expect(markdown).toContain("- stage: fact");
    expect(markdown).not.toContain("historical-work");
  });

  it("rejects a work descriptor outside the active analysis run", () => {
    const state = { ...createInitialProjectRuntimeState("project-1"), analysisRunId: "run-current", sessionId: "session-1", sourceSnapshotId: "SRC-SNAPSHOT-1", activeStage: "fact" as const };
    expect(() => reduceState(state, { type: "work.register", projectId: "project-1", operationId: "register-outside", expectedRevision: 0, descriptor: descriptor() })).toThrowError("ANALYSIS_RUN_SCOPE_VIOLATION");
  });

  it("rejects starting a generation step before its predecessor completes", () => {
    const state = {
      ...createInitialProjectRuntimeState("project-1"),
      analysisRunId: "run-1",
      sessionId: "session-1",
      sourceSnapshotId: "SRC-SNAPSHOT-1",
    };

    expect(() => reduceState(state, {
      type: "analysis.step.start",
      projectId: "project-1",
      operationId: "start-fact-catalog",
      expectedRevision: 0,
      step: "fact-catalog",
      role: "author",
    })).toThrowError("GENERATION_STEP_ORDER_VIOLATION");
  });

  it("requires a persisted receipt before completing a generation step", () => {
    const initial = {
      ...createInitialProjectRuntimeState("project-1"),
      analysisRunId: "run-1",
      sessionId: "session-1",
      sourceSnapshotId: "SRC-SNAPSHOT-1",
    };
    const running = reduceState(initial, {
      type: "analysis.step.start",
      projectId: "project-1",
      operationId: "start-source",
      expectedRevision: 0,
      step: "source-scan",
      role: "deterministic",
    }).state;

    expect(() => reduceState(running, {
      type: "analysis.step.complete",
      projectId: "project-1",
      operationId: "complete-source",
      expectedRevision: 1,
      step: "source-scan",
      receiptArtifactId: "SRC-missing",
    })).toThrowError("GENERATION_STEP_RECEIPT_NOT_PERSISTED");
  });

  it("switches the active fine-step role before registering reviewer work", () => {
    const initial = createInitialProjectRuntimeState("project-1");
    initial.analysisRunId = "run-1";
    initial.sessionId = "session-1";
    initial.sourceSnapshotId = "SRC-SNAPSHOT-1";
    initial.generationSteps["source-scan"] = { step: "source-scan", status: "completed", receiptArtifactId: "SRC-SNAPSHOT-1" };
    const author = reduceState(initial, { type: "analysis.step.start", projectId: "project-1", operationId: "start-catalog", expectedRevision: 0, step: "fact-catalog", role: "author" }).state;
    const reviewer = reduceState(author, { type: "analysis.step.role", projectId: "project-1", operationId: "review-catalog", expectedRevision: 1, step: "fact-catalog", role: "reviewer" }).state;
    const reviewWork = {
      ...descriptor(2),
      workId: "review-work",
      stagingPath: ".scenarioforge/staging/review-work",
      parentWorkId: "author-work",
      kind: "analysis.fact-catalog" as const,
      generationStep: "fact-catalog" as const,
      role: "reviewer" as const,
      outputArtifactType: "semantic-verdict" as const,
      objective: "Review only the FACT catalog semantics.",
      inputIds: [],
      inputArtifacts: [],
    };
    const registered = reduceState(reviewer, { type: "work.register", projectId: "project-1", operationId: "register-review", expectedRevision: 2, descriptor: reviewWork }).state;

    expect(registered.activeRole).toBe("reviewer");
    expect(registered.generationSteps["fact-catalog"].role).toBe("reviewer");
    expect(registered.works["review-work"].parentWorkId).toBe("author-work");
  });

  it("renders the latest running work for the current run, session, step, and role", () => {
    const earlier = {
      ...descriptor(),
      workId: "work-earlier",
      generationStep: "fact-catalog" as const,
      role: "author" as const,
      outputArtifactType: "fact-catalog" as const,
      status: "running" as const,
      updatedAt: "2026-08-26T00:00:00.000Z",
    };
    const latest = {
      ...earlier,
      workId: "work-latest",
      updatedAt: "2026-08-26T00:00:01.000Z",
    };
    const wrongRole = {
      ...latest,
      workId: "work-reviewer",
      role: "reviewer" as const,
      updatedAt: "2026-08-26T00:00:02.000Z",
    };
    const state = {
      ...createInitialProjectRuntimeState("project-1"),
      analysisRunId: "run-1",
      sessionId: "session-1",
      sourceSnapshotId: "SRC-SNAPSHOT-1",
      activeStage: "fact" as const,
      activeStep: "fact-catalog" as const,
      activeRole: "author" as const,
      generationSteps: {
        ...createInitialProjectRuntimeState("project-1").generationSteps,
        "fact-catalog": {
          step: "fact-catalog" as const,
          status: "running" as const,
          role: "author" as const,
        },
      },
      works: {
        [earlier.workId]: earlier,
        [latest.workId]: latest,
        [wrongRole.workId]: wrongRole,
      },
    };

    const markdown = renderWorkStateMarkdown(state);

    expect(markdown).toContain("- workId: work-latest");
    expect(markdown).toContain("- step: fact-catalog");
    expect(markdown).toContain("- role: author");
    expect(markdown).not.toContain("work-earlier");
    expect(markdown).not.toContain("work-reviewer");
  });

  it("persists one source receipt before deriving compatibility progress and the next step", () => {
    let state: ProjectRuntimeState = {
      ...createInitialProjectRuntimeState("project-1"),
      analysisRunId: "run-1",
      sessionId: "session-1",
      sourceSnapshotId: "SRC-SNAPSHOT-1",
    };
    state = reduceState(state, {
      type: "analysis.step.start",
      projectId: "project-1",
      operationId: "step-start",
      expectedRevision: 0,
      step: "source-scan",
      role: "deterministic",
    }).state;
    const work: WorkDescriptor = {
      schemaVersion: 1,
      projectId: "project-1",
      analysisRunId: "run-1",
      sourceSnapshotId: "SRC-SNAPSHOT-1",
      sessionId: "session-1",
      workId: "work-source",
      kind: "analysis.source-scan",
      stage: "src",
      generationStep: "source-scan",
      role: "deterministic",
      outputArtifactType: "source-snapshot",
      objective: "Produce only the source snapshot.",
      inputArtifacts: [],
      attemptId: "attempt-source",
      expectedRevision: 1,
      inputIds: [],
      stagingPath: ".scenarioforge/staging/work-source",
      status: "pending",
      createdAt: "2026-08-26T00:00:00.000Z",
      updatedAt: "2026-08-26T00:00:00.000Z",
      progress: 0,
      completionRequested: false,
    };
    state = reduceState(state, { type: "work.register", projectId: "project-1", operationId: "register", expectedRevision: 1, descriptor: work }).state;
    state = reduceState(state, { type: "work.begin", projectId: "project-1", workId: work.workId, operationId: "begin", expectedRevision: 2 }).state;
    state = reduceState(state, {
      type: "work.mutate",
      projectId: "project-1",
      sessionId: "session-1",
      workId: work.workId,
      operationId: "submit",
      expectedRevision: 3,
      mutation: {
        op: "submit-artifacts",
        artifacts: [{
          artifactId: "SRC-1",
          artifactType: "source-snapshot",
          generationStep: "source-scan",
          stagingPath: ".scenarioforge/staging/work-source/SRC-1.json",
          relatedIds: [],
          contentHash: "a".repeat(64),
        }],
      },
    }).state;
    state = reduceState(state, { type: "artifact.persist", projectId: "project-1", artifactId: "SRC-1", finalPath: ".scenarioforge/runs/run-1/src/SRC-1.json", operationId: "persist", expectedRevision: 4 }).state;
    state = reduceState(state, { type: "work.settle", projectId: "project-1", workId: work.workId, operationId: "settle", expectedRevision: 5 }).state;
    state = reduceState(state, { type: "analysis.step.complete", projectId: "project-1", step: "source-scan", receiptArtifactId: "SRC-1", operationId: "complete", expectedRevision: 6 }).state;

    expect(state.generationSteps["source-scan"]).toMatchObject({ status: "completed", receiptArtifactId: "SRC-1" });
    expect(state.stages.src).toBe("completed");
    expect(state.progress).toBe(10);
    expect(state.activeStep).toBeUndefined();
  });

  it("migrates a legacy failed run without treating coarse downstream artifacts as fine-grained receipts", () => {
    const { generationSteps: _generationSteps, ...base } = createInitialProjectRuntimeState("project-1");
    const sourceWork = {
      ...descriptor(),
      workId: "work-source",
      kind: "analysis.source-map" as const,
      stage: "src" as const,
      stagingPath: ".scenarioforge/staging/work-source",
      status: "settled" as const,
    };
    const legacy = {
      ...base,
      schemaVersion: 1 as const,
      analysisRunId: "run-1",
      sessionId: "session-1",
      sourceSnapshotId: "SRC-SNAPSHOT-1",
      activeStage: "fact" as const,
      stages: { src: "completed", fact: "failed", wiki: "pending", scenario: "pending" } as const,
      artifactStatus: { src: "persisted", fact: "invalid", wiki: "absent", scenario: "absent" } as const,
      works: { [sourceWork.workId]: sourceWork },
      artifacts: {
        "SRC-legacy": {
          artifactId: "SRC-legacy",
          artifactType: "src" as const,
          stagingPath: ".scenarioforge/staging/work-source/SRC-legacy.json",
          relatedIds: [],
          contentHash: "b".repeat(64),
          projectId: "project-1",
          analysisRunId: "run-1",
          sourceSnapshotId: "SRC-SNAPSHOT-1",
          workId: sourceWork.workId,
          status: "persisted" as const,
          finalPath: ".scenarioforge/runs/run-1/src/SRC-legacy.json",
          createdAt: "2026-08-26T00:00:00.000Z",
        },
      },
    };

    const migrated = migrateProjectRuntimeState(legacy);

    expect(migrated.schemaVersion).toBe(2);
    expect(migrated.generationSteps["source-scan"]).toMatchObject({ status: "completed", receiptArtifactId: "SRC-legacy" });
    expect(migrated.generationSteps["fact-catalog"]).toMatchObject({ status: "failed", error: { code: "LEGACY_FINE_GRAINED_RECEIPTS_MISSING" } });
    expect(migrated.generationSteps["edge-ledger"].status).toBe("pending");
    expect(validateProjectRuntimeState(migrated)).toEqual({ ok: true, value: migrated });
  });
});
