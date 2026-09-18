import { readFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { VisionStepEnvelope } from "../types.js";
import { batchRoot, executionRoot, testsRoot, assertWithinExecutionTree } from "./execution-paths.js";
import { TestCoordinator, type CreateExecutionInput } from "./test-coordinator.js";

const RUN_ID = "RUN-coord-01";

const envelope = (stepId: string): VisionStepEnvelope => ({
  stepId,
  actionRef: "E-1",
  assertionRefs: ["SCR-2"],
  intent: { kind: "press" },
  allowedActions: ["click"],
  target: {
    descriptorId: `VTD-${stepId}`,
    elementRef: "EL-1",
    visibleLabel: "로그인",
    controlKind: "button",
    surfaceHint: "/login",
    verificationCandidates: [],
    labelUniqueOnSurface: true,
    ambiguityRisk: "medium",
  },
  budget: { maxModelCalls: 3, maxScreenshots: 4, timeoutMs: 30_000 },
  riskClass: "reversible-write",
});

let projectRoot: string;
const coordinator = new TestCoordinator();

function input(overrides: Partial<CreateExecutionInput> = {}): CreateExecutionInput {
  return {
    projectRoot,
    runId: RUN_ID,
    projectId: "P-1",
    operationId: "OP-1",
    sourceSnapshotId: "SS-1",
    scenarioArtifactHash: "hash-scenario",
    factArtifactHash: "hash-fact",
    target: { kind: "web", entryUrl: "https://staging.example.com", maskElementRefs: ["EL-PW"], destructiveAllowed: false },
    dataBindingKeys: [{ bindingKey: "EL-PW", secret: true }],
    plans: [{ scenarioId: "SCN-1", title: "로그인", envelopes: [envelope("SCN-1#1")] }],
    createdAt: "2026-09-07T00:00:00.000Z",
    ...overrides,
  };
}

const readBatchFile = async (executionId: string, batchId: string, name: string) =>
  JSON.parse(await readFile(join(batchRoot(projectRoot, RUN_ID, executionId, batchId), name), "utf8"));

beforeEach(async () => {
  projectRoot = await mkdtemp(join(tmpdir(), "scenarioforge-coordinator-"));
});

afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
});

describe("test coordinator create execution", () => {
  it("owns the execution and batch identity", async () => {
    const queued = await coordinator.createExecution(input());

    expect(queued.executionId).toMatch(/^EXEC-/);
    expect(queued.batchId).toBe("batch-001");
    expect(queued.ordinal).toBe(1);
  });

  it("writes the immutable batch artifacts the plan gate needs", async () => {
    const queued = await coordinator.createExecution(input());

    const snapshot = await readBatchFile(queued.executionId, queued.batchId, "scenario-snapshot.json");
    const profile = await readBatchFile(queued.executionId, queued.batchId, "execution-target-profile.json");
    const plan = await readBatchFile(queued.executionId, queued.batchId, "runner-plan.json");
    const manifest = await readBatchFile(queued.executionId, queued.batchId, "batch-manifest.json");

    expect(snapshot).toMatchObject({
      analysisRunId: RUN_ID,
      sourceSnapshotId: "SS-1",
      scenarioArtifactHash: "hash-scenario",
      factArtifactHash: "hash-fact",
      scenarios: [{ scenarioId: "SCN-1", stepIds: ["SCN-1#1"] }],
    });
    expect(profile).toMatchObject({ kind: "web", entryUrl: "https://staging.example.com", maskElementRefs: ["EL-PW"] });
    expect(plan.cases[0].steps[0].stepId).toBe("SCN-1#1");
    expect(manifest).toMatchObject({
      planningStatus: "QUEUED",
      runtimeStatus: "QUEUED",
      scenarioSnapshotHash: queued.scenarioSnapshotHash,
      runnerPlanHash: queued.runnerPlanHash,
    });
  });

  it("records binding keys without any value", async () => {
    const queued = await coordinator.createExecution(input());

    const bindings = await readBatchFile(queued.executionId, queued.batchId, "data-binding-manifest.json");

    expect(bindings).toEqual({ schemaVersion: 1, bindings: [{ bindingKey: "EL-PW", secret: true }] });
    const raw = await readFile(join(batchRoot(projectRoot, RUN_ID, queued.executionId, queued.batchId), "data-binding-manifest.json"), "utf8");
    expect(raw).not.toContain("password");
  });

  it("writes the execution manifest listing its batches", async () => {
    const queued = await coordinator.createExecution(input());

    const manifest = JSON.parse(
      await readFile(join(executionRoot(projectRoot, RUN_ID, queued.executionId), "manifest.json"), "utf8"),
    );

    expect(manifest).toMatchObject({
      executionId: queued.executionId,
      analysisRunId: RUN_ID,
      batches: [{ batchId: "batch-001", ordinal: 1, requestKind: "initial", scenarioIds: ["SCN-1"] }],
    });
  });

  it("returns the same batch for a repeated operation id with the same payload", async () => {
    const first = await coordinator.createExecution(input());
    const second = await coordinator.createExecution(input());

    expect(second).toEqual(first);
  });

  it("rejects a reused operation id carrying a different payload", async () => {
    await coordinator.createExecution(input());

    await expect(
      coordinator.createExecution(input({ target: { kind: "web", entryUrl: "https://other.example.com", maskElementRefs: [], destructiveAllowed: false } })),
    ).rejects.toThrow("OPERATION_ID_REUSED_WITH_DIFFERENT_PAYLOAD");
  });

  it("makes a separate execution for a different operation id", async () => {
    const first = await coordinator.createExecution(input());
    const second = await coordinator.createExecution(input({ operationId: "OP-2" }));

    expect(second.executionId).not.toBe(first.executionId);
  });

  it("refuses a plan with no case or no step", async () => {
    await expect(coordinator.createExecution(input({ plans: [] }))).rejects.toThrow("EXECUTION_PLAN_EMPTY");
    await expect(
      coordinator.createExecution(input({ plans: [{ scenarioId: "SCN-1", title: "로그인", envelopes: [] }] })),
    ).rejects.toThrow("EXECUTION_PLAN_STEP_EMPTY");
  });

  it("writes only inside the run tests subtree", async () => {
    const queued = await coordinator.createExecution(input());

    expect(executionRoot(projectRoot, RUN_ID, queued.executionId)).toContain(join(".scenarioforge", "runs", RUN_ID, "tests"));
    expect(() => assertWithinExecutionTree(projectRoot, RUN_ID, join(testsRoot(projectRoot, RUN_ID), "..", "manifest.json"))).toThrow(
      "EXECUTION_PATH_ESCAPE",
    );
  });

  it("rejects an unsafe identifier instead of building a path from it", async () => {
    await expect(coordinator.createExecution(input({ runId: "../escape" }))).rejects.toThrow("RUN_ID_INVALID");
  });
});

describe("test coordinator enqueue, retry and cancel", () => {
  const secondPlan = { scenarioId: "SCN-2", title: "결제", envelopes: [envelope("SCN-2#1")] };

  async function firstExecution() {
    const queued = await coordinator.createExecution(input());
    return queued;
  }

  it("appends a new immutable batch without touching the first one", async () => {
    const first = await firstExecution();
    const before = await readBatchFile(first.executionId, first.batchId, "runner-plan.json");

    const second = await coordinator.enqueueScenarios({
      ...input({ operationId: "OP-2", plans: [secondPlan] }),
      executionId: first.executionId,
      targetProfileHash: first.targetProfileHash,
    });

    expect(second).toMatchObject({ executionId: first.executionId, batchId: "batch-002", ordinal: 2 });
    expect(await readBatchFile(first.executionId, first.batchId, "runner-plan.json")).toEqual(before);
    const manifest = JSON.parse(
      await readFile(join(executionRoot(projectRoot, RUN_ID, first.executionId), "manifest.json"), "utf8"),
    );
    expect(manifest.batches.map((batch: { batchId: string }) => batch.batchId)).toEqual(["batch-001", "batch-002"]);
  });

  it("refuses a different target profile in the same execution", async () => {
    const first = await firstExecution();

    await expect(
      coordinator.enqueueScenarios({
        ...input({ operationId: "OP-2", plans: [secondPlan] }),
        executionId: first.executionId,
        targetProfileHash: "other-hash",
      }),
    ).rejects.toThrow("TARGET_PROFILE_MISMATCH");
  });

  it("refuses to enqueue a scenario the execution already carries", async () => {
    const first = await firstExecution();

    await expect(
      coordinator.enqueueScenarios({
        ...input({ operationId: "OP-2" }),
        executionId: first.executionId,
        targetProfileHash: first.targetProfileHash,
      }),
    ).rejects.toThrow("SCENARIO_ALREADY_IN_EXECUTION");
  });

  it("refuses to enqueue into a settled execution", async () => {
    const first = await firstExecution();
    const directory = executionRoot(projectRoot, RUN_ID, first.executionId);
    await writeFile(join(directory, "execution-result.json"), "{}\n", "utf8");

    await expect(
      coordinator.enqueueScenarios({
        ...input({ operationId: "OP-2", plans: [secondPlan] }),
        executionId: first.executionId,
        targetProfileHash: first.targetProfileHash,
      }),
    ).rejects.toThrow("EXECUTION_ALREADY_SETTLED");
  });

  it("refuses to enqueue into an execution that does not exist", async () => {
    await expect(
      coordinator.enqueueScenarios({
        ...input({ operationId: "OP-2", plans: [secondPlan] }),
        executionId: "EXEC-missing",
        targetProfileHash: "hash",
      }),
    ).rejects.toThrow("EXECUTION_NOT_FOUND");
  });

  it("makes a new execution for a retry and links the source", async () => {
    const first = await firstExecution();

    const retried = await coordinator.retryCases({
      ...input({ operationId: "OP-retry" }),
      retryOfExecutionId: first.executionId,
    });

    expect(retried.executionId).not.toBe(first.executionId);
    const manifest = JSON.parse(
      await readFile(join(executionRoot(projectRoot, RUN_ID, retried.executionId), "manifest.json"), "utf8"),
    );
    expect(manifest.retryOfExecutionId).toBe(first.executionId);
    // 원본 실행의 batch 는 그대로 남는다.
    expect(await readBatchFile(first.executionId, first.batchId, "batch-manifest.json")).toMatchObject({ ordinal: 1 });
  });

  it("records a durable cancel request without deleting anything", async () => {
    const first = await firstExecution();

    expect(await coordinator.isCancelRequested(projectRoot, RUN_ID, first.executionId)).toBe(false);
    await coordinator.cancelExecution({
      projectRoot,
      runId: RUN_ID,
      executionId: first.executionId,
      requestedAt: "2026-09-07T00:05:00.000Z",
    });

    expect(await coordinator.isCancelRequested(projectRoot, RUN_ID, first.executionId)).toBe(true);
    expect(await readBatchFile(first.executionId, first.batchId, "batch-manifest.json")).toMatchObject({ ordinal: 1 });
  });

  it("refuses to cancel an execution that does not exist", async () => {
    await expect(
      coordinator.cancelExecution({ projectRoot, runId: RUN_ID, executionId: "EXEC-missing", requestedAt: "now" }),
    ).rejects.toThrow("EXECUTION_NOT_FOUND");
  });
});
