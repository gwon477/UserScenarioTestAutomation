/* TestCoordinator. 실행 명령을 받아 immutable batch 를 만들고 대기열에 올린다.
 *
 * 소유하는 것: executionId, batchId, operationId 멱등성, batch 불변성.
 * 소유하지 않는 것: 시나리오 의미, canonical 생성 ID, adapter 선택.
 *
 * 계약은 docs/architecture/04-test-execution-harness-design.md §4 · §5 를 따른다.
 */

import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, open, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { VisionStepEnvelope } from "../types.js";
import { batchRoot, executionRoot, testsRoot } from "./execution-paths.js";

async function atomicWrite(path: string, content: string): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, content);
  const handle = await open(temporary, "r");
  await handle.sync();
  await handle.close();
  await rename(temporary, path);
}

const sha = (value: string): string => createHash("sha256").update(value).digest("hex");

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
const writeJson = async (path: string, value: unknown): Promise<string> => {
  const content = `${JSON.stringify(value, null, 2)}\n`;
  await atomicWrite(path, content);
  return sha(content);
};

export type ScenarioPlan = {
  scenarioId: string;
  title: string;
  envelopes: readonly VisionStepEnvelope[];
};

export type ExecutionTargetProfileInput = {
  kind: "web";
  entryUrl: string;
  maskElementRefs: readonly string[];
  destructiveAllowed: boolean;
};

export type DataBindingKeyRecord = {
  bindingKey: string;
  secret: boolean;
};

export type CreateExecutionInput = {
  projectRoot: string;
  runId: string;
  projectId: string;
  operationId: string;
  sourceSnapshotId: string;
  scenarioArtifactHash: string;
  factArtifactHash: string;
  target: ExecutionTargetProfileInput;
  /** key 와 secret 여부만. 원문 값은 절대 넘기지 않는다. */
  dataBindingKeys: readonly DataBindingKeyRecord[];
  plans: readonly ScenarioPlan[];
  createdAt: string;
};

export type EnqueueScenariosInput = Omit<CreateExecutionInput, "operationId"> & {
  operationId: string;
  executionId: string;
  /** 같은 execution 의 모든 batch 는 같은 target profile 을 쓴다. */
  targetProfileHash: string;
};

export type RetryCasesInput = CreateExecutionInput & {
  retryOfExecutionId: string;
};

export type QueuedBatch = {
  executionId: string;
  batchId: string;
  ordinal: number;
  scenarioSnapshotHash: string;
  targetProfileHash: string;
  runnerPlanHash: string;
};

type OperationLedger = {
  schemaVersion: 1;
  operations: Record<string, { payloadHash: string; executionId: string; batchId: string; ordinal: number }>;
};

type ExecutionManifest = {
  schemaVersion: 1;
  executionId: string;
  retryOfExecutionId?: string;
  projectId: string;
  analysisRunId: string;
  sourceSnapshotId: string;
  createdAt: string;
  targetProfileHash: string;
  batches: Array<{ batchId: string; ordinal: number; requestKind: "initial" | "enqueue" | "retry"; runnerPlanHash: string; scenarioIds: string[] }>;
};

function payloadHashOf(input: CreateExecutionInput): string {
  return sha(
    JSON.stringify({
      runId: input.runId,
      scenarioIds: input.plans.map((plan) => plan.scenarioId),
      target: input.target,
      dataBindingKeys: input.dataBindingKeys,
      scenarioArtifactHash: input.scenarioArtifactHash,
      factArtifactHash: input.factArtifactHash,
    }),
  );
}

async function readLedger(path: string): Promise<OperationLedger> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as OperationLedger;
    if (parsed.schemaVersion !== 1 || typeof parsed.operations !== "object") throw new Error("OPERATION_LEDGER_INVALID");
    return parsed;
  } catch (error) {
    if (error instanceof Error && error.message === "OPERATION_LEDGER_INVALID") throw error;
    return { schemaVersion: 1, operations: {} };
  }
}

export class TestCoordinator {
  /* 최초 실행. 새 executionId 와 첫 batchId 를 만든다.
   * 같은 operationId 로 같은 payload 가 다시 오면 기존 결과를 돌려주고,
   * 같은 operationId 로 다른 payload 가 오면 거절한다. */
  async createExecution(input: CreateExecutionInput): Promise<QueuedBatch> {
    if (input.plans.length === 0) throw new Error("EXECUTION_PLAN_EMPTY");
    if (input.plans.some((plan) => plan.envelopes.length === 0)) throw new Error("EXECUTION_PLAN_STEP_EMPTY");
    if (!input.operationId.trim()) throw new Error("OPERATION_ID_REQUIRED");

    const root = testsRoot(input.projectRoot, input.runId);
    await mkdir(root, { recursive: true });
    const ledgerPath = join(root, "operations.json");
    const ledger = await readLedger(ledgerPath);
    const payloadHash = payloadHashOf(input);
    const recorded = ledger.operations[input.operationId];
    if (recorded) {
      if (recorded.payloadHash !== payloadHash) throw new Error("OPERATION_ID_REUSED_WITH_DIFFERENT_PAYLOAD");
      const existing = join(batchRoot(input.projectRoot, input.runId, recorded.executionId, recorded.batchId), "batch-manifest.json");
      const manifest = JSON.parse(await readFile(existing, "utf8")) as {
        scenarioSnapshotHash: string;
        targetProfileHash: string;
        runnerPlanHash: string;
      };
      return {
        executionId: recorded.executionId,
        batchId: recorded.batchId,
        ordinal: recorded.ordinal,
        scenarioSnapshotHash: manifest.scenarioSnapshotHash,
        targetProfileHash: manifest.targetProfileHash,
        runnerPlanHash: manifest.runnerPlanHash,
      };
    }

    const executionId = `EXEC-${randomUUID()}`;
    const batchId = "batch-001";
    const { scenarioSnapshotHash, targetProfileHash, runnerPlanHash } = await this.writeBatch({
      ...input,
      executionId,
      batchId,
      ordinal: 1,
      requestKind: "initial",
    });

    const manifest: ExecutionManifest = {
      schemaVersion: 1,
      executionId,
      projectId: input.projectId,
      analysisRunId: input.runId,
      sourceSnapshotId: input.sourceSnapshotId,
      createdAt: input.createdAt,
      targetProfileHash,
      batches: [{ batchId, ordinal: 1, requestKind: "initial", runnerPlanHash, scenarioIds: input.plans.map((plan) => plan.scenarioId) }],
    };
    await writeJson(join(executionRoot(input.projectRoot, input.runId, executionId), "manifest.json"), manifest);

    // 대기열 등록이 durable 하게 끝난 뒤에만 operation 을 기록한다.
    await writeJson(ledgerPath, {
      schemaVersion: 1,
      operations: { ...ledger.operations, [input.operationId]: { payloadHash, executionId, batchId, ordinal: 1 } },
    } satisfies OperationLedger);

    return { executionId, batchId, ordinal: 1, scenarioSnapshotHash, targetProfileHash, runnerPlanHash };
  }

  /* 실행 중 시나리오 추가. 기존 snapshot 과 plan 을 바꾸지 않고 새 immutable
   * batch 를 뒤에 append 한다. 같은 target profile 만 허용한다. */
  async enqueueScenarios(input: EnqueueScenariosInput): Promise<QueuedBatch> {
    if (input.plans.length === 0) throw new Error("EXECUTION_PLAN_EMPTY");
    if (input.plans.some((plan) => plan.envelopes.length === 0)) throw new Error("EXECUTION_PLAN_STEP_EMPTY");
    if (!input.operationId.trim()) throw new Error("OPERATION_ID_REQUIRED");

    const directory = executionRoot(input.projectRoot, input.runId, input.executionId);
    let manifest: ExecutionManifest;
    try {
      manifest = JSON.parse(await readFile(join(directory, "manifest.json"), "utf8")) as ExecutionManifest;
    } catch {
      throw new Error("EXECUTION_NOT_FOUND");
    }
    if (manifest.targetProfileHash !== input.targetProfileHash) throw new Error("TARGET_PROFILE_MISMATCH");
    // 결과가 확정된 execution 에는 추가할 수 없다. 새 실행으로 만들어야 한다.
    if (await exists(join(directory, "execution-result.json"))) throw new Error("EXECUTION_ALREADY_SETTLED");
    const already = new Set(manifest.batches.flatMap((batch) => batch.scenarioIds));
    const duplicate = input.plans.map((plan) => plan.scenarioId).filter((scenarioId) => already.has(scenarioId));
    if (duplicate.length > 0) throw new Error("SCENARIO_ALREADY_IN_EXECUTION");

    const ledgerPath = join(testsRoot(input.projectRoot, input.runId), "operations.json");
    const ledger = await readLedger(ledgerPath);
    const payloadHash = payloadHashOf(input);
    const recorded = ledger.operations[input.operationId];
    if (recorded) {
      if (recorded.payloadHash !== payloadHash) throw new Error("OPERATION_ID_REUSED_WITH_DIFFERENT_PAYLOAD");
      return this.readQueuedBatch(input.projectRoot, input.runId, recorded);
    }

    const ordinal = manifest.batches.length + 1;
    const batchId = `batch-${String(ordinal).padStart(3, "0")}`;
    const written = await this.writeBatch({ ...input, executionId: input.executionId, batchId, ordinal, requestKind: "enqueue" });

    await writeJson(join(directory, "manifest.json"), {
      ...manifest,
      batches: [
        ...manifest.batches,
        { batchId, ordinal, requestKind: "enqueue", runnerPlanHash: written.runnerPlanHash, scenarioIds: input.plans.map((plan) => plan.scenarioId) },
      ],
    } satisfies ExecutionManifest);

    await writeJson(ledgerPath, {
      schemaVersion: 1,
      operations: { ...ledger.operations, [input.operationId]: { payloadHash, executionId: input.executionId, batchId, ordinal } },
    } satisfies OperationLedger);

    return { executionId: input.executionId, batchId, ordinal, ...written };
  }

  /* 재실행. 언제나 새 execution 을 만들고 원본을 참조로 남긴다.
   * 기존 실행의 결과와 증적은 덮어쓰지 않는다. */
  async retryCases(input: RetryCasesInput): Promise<QueuedBatch> {
    const queued = await this.createExecution(input);
    const path = join(executionRoot(input.projectRoot, input.runId, queued.executionId), "manifest.json");
    const manifest = JSON.parse(await readFile(path, "utf8")) as ExecutionManifest;
    if (manifest.retryOfExecutionId === undefined) {
      await writeJson(path, { ...manifest, retryOfExecutionId: input.retryOfExecutionId } satisfies ExecutionManifest);
    }
    return queued;
  }

  /* 사용자 중단. 실행 트리에 중단 요청을 durable 하게 남긴다.
   * 이미 저장된 결과와 증적은 지우지 않는다. */
  async cancelExecution(input: { projectRoot: string; runId: string; executionId: string; requestedAt: string }): Promise<void> {
    const directory = executionRoot(input.projectRoot, input.runId, input.executionId);
    if (!(await exists(join(directory, "manifest.json")))) throw new Error("EXECUTION_NOT_FOUND");
    await writeJson(join(directory, "cancel-request.json"), {
      schemaVersion: 1,
      executionId: input.executionId,
      requestedAt: input.requestedAt,
    });
  }

  async isCancelRequested(projectRoot: string, runId: string, executionId: string): Promise<boolean> {
    return exists(join(executionRoot(projectRoot, runId, executionId), "cancel-request.json"));
  }

  /* batch artifact 5종을 쓴다. 이미 queue 에 들어간 batch 는 수정하지 않는다.
   * 새 batch 는 언제나 새 디렉터리에 쓴다. */
  private async writeBatch(input: {
    projectRoot: string;
    runId: string;
    executionId: string;
    batchId: string;
    ordinal: number;
    requestKind: "initial" | "enqueue" | "retry";
    sourceSnapshotId: string;
    scenarioArtifactHash: string;
    factArtifactHash: string;
    target: ExecutionTargetProfileInput;
    dataBindingKeys: readonly DataBindingKeyRecord[];
    plans: readonly ScenarioPlan[];
  }): Promise<{ scenarioSnapshotHash: string; targetProfileHash: string; runnerPlanHash: string }> {
    const directory = batchRoot(input.projectRoot, input.runId, input.executionId, input.batchId);
    if (await exists(join(directory, "batch-manifest.json"))) throw new Error("BATCH_ALREADY_EXISTS");
    await mkdir(directory, { recursive: true });

    const scenarioSnapshotHash = await writeJson(join(directory, "scenario-snapshot.json"), {
      schemaVersion: 1,
      analysisRunId: input.runId,
      sourceSnapshotId: input.sourceSnapshotId,
      scenarioArtifactHash: input.scenarioArtifactHash,
      factArtifactHash: input.factArtifactHash,
      scenarios: input.plans.map((plan) => ({
        scenarioId: plan.scenarioId,
        title: plan.title,
        stepIds: plan.envelopes.map((envelope) => envelope.stepId),
      })),
    });

    const targetProfileHash = await writeJson(join(directory, "execution-target-profile.json"), {
      schemaVersion: 1,
      kind: input.target.kind,
      entryUrl: input.target.entryUrl,
      maskElementRefs: [...input.target.maskElementRefs],
      destructiveAllowed: input.target.destructiveAllowed,
    });

    // key 와 secret 여부만 기록한다. 원문 값은 이 파일에 존재하지 않는다.
    await writeJson(join(directory, "data-binding-manifest.json"), {
      schemaVersion: 1,
      bindings: input.dataBindingKeys.map((entry) => ({ bindingKey: entry.bindingKey, secret: entry.secret })),
    });

    const runnerPlanHash = await writeJson(join(directory, "runner-plan.json"), {
      schemaVersion: 1,
      scenarioSnapshotHash,
      targetProfileHash,
      cases: input.plans.map((plan) => ({ scenarioId: plan.scenarioId, title: plan.title, steps: plan.envelopes })),
    });

    await writeJson(join(directory, "batch-manifest.json"), {
      schemaVersion: 1,
      batchId: input.batchId,
      executionId: input.executionId,
      ordinal: input.ordinal,
      requestKind: input.requestKind,
      scenarioSnapshotHash,
      targetProfileHash,
      runnerPlanHash,
      scenarioIds: input.plans.map((plan) => plan.scenarioId),
      planningStatus: "QUEUED",
      runtimeStatus: "QUEUED",
    });

    return { scenarioSnapshotHash, targetProfileHash, runnerPlanHash };
  }

  private async readQueuedBatch(
    projectRoot: string,
    runId: string,
    recorded: { executionId: string; batchId: string; ordinal: number },
  ): Promise<QueuedBatch> {
    const manifest = JSON.parse(
      await readFile(join(batchRoot(projectRoot, runId, recorded.executionId, recorded.batchId), "batch-manifest.json"), "utf8"),
    ) as { scenarioSnapshotHash: string; targetProfileHash: string; runnerPlanHash: string };
    return {
      executionId: recorded.executionId,
      batchId: recorded.batchId,
      ordinal: recorded.ordinal,
      scenarioSnapshotHash: manifest.scenarioSnapshotHash,
      targetProfileHash: manifest.targetProfileHash,
      runnerPlanHash: manifest.runnerPlanHash,
    };
  }
}
