import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { FactBundle } from "@scenarioforge/contracts";
import { EvidenceGrantService, ScenarioGenerationHarness, type GenerationExecutor } from "@scenarioforge/scenario-pipeline";
import { validateExecutionCommand } from "../../apps/desktop/src/main/application/test-execution-command";
import { loadTestExecutions } from "../../apps/desktop/src/main/application/test-execution-view";
import { loadExecutionPlan } from "../../apps/desktop/src/main/application/test-requirements-view";
import { buildStepEvidence, executeBatch, ExecutionWriter, ReviewStore, TestCoordinator, createFrameCoordinateSpace, type StepOutcome, type VisionStepEnvelope } from "@scenarioforge/test-runtime";
import { loadScenarioView } from "../../apps/desktop/src/main/application/scenario-view";
import { loadTestExecutionRequirements } from "../../apps/desktop/src/main/application/test-requirements-view";

/* 실행 요청 폼의 요구사항이 실제 파이프라인이 남긴 정본 artifact 에서만
 * 도출되는지 확인한다. 손으로 만든 journal 로는 검증할 수 없는 경계다. */

function executor(projectRoot: string): GenerationExecutor {
  return {
    async extractFacts({ snapshot, work }) {
      const page = snapshot.files.find((file) => file.path === "src/App.tsx")!;
      const element = snapshot.interactions[0];
      const grant = await new EvidenceGrantService(projectRoot).create(snapshot, work.workId, [
        { source_id: page.source_id, start_line: 1, end_line: 1 },
      ]);
      const evidence = grant.evidence[0];
      const common = { project_id: snapshot.project_id, analysis_run_id: snapshot.analysis_run_id, source_snapshot_id: snapshot.source_snapshot_id };
      return {
        schema_version: 2,
        ...common,
        screens: [
          {
            schema_version: 3,
            ...common,
            screen_id: "SCR-checkout",
            route: "/checkout",
            title: "Checkout",
            entry_guards: [],
            elements: [
              {
                id: element.element_id,
                type: "button",
                label: "Submit order",
                interaction: { action_kind: "click", surface_kind: "web", target_candidates: element.target_candidates },
                evidence: [evidence],
              },
            ],
            apis: [],
            feedback: [
              { id: "FB-checkout-success", kind: "toast", text: "Order complete", assertion: { kind: "visible-text", expected_shape: "Order complete" }, evidence: [evidence] },
            ],
            displays: [],
            status: "verified",
          },
          { schema_version: 3, ...common, screen_id: "SCR-complete", route: "/complete", title: "Complete", entry_guards: [], elements: [], apis: [], feedback: [], displays: [], status: "verified" },
        ],
        edges: [
          {
            schema_version: 2,
            ...common,
            edge_id: "E-0001",
            kind: "normal",
            from: "SCR-checkout",
            on: element.element_id,
            guard: "PRED-cart.ready=true",
            to: "SCR-complete",
            feedback: ["FB-checkout-success"],
            evidence: [evidence],
            status: "verified",
          },
        ],
        predicates: [{ schema_version: 2, ...common, pred_id: "PRED-cart.ready", values: ["true", "false"], source: "code", evidence: [evidence] }],
      } satisfies FactBundle;
    },
    async composeWiki({ skeleton }) {
      return { schema_version: 1, workflow_updates: skeleton.workflows.map((workflow) => ({ workflow_ref: workflow.workflow, goal: "Place an order" })) };
    },
    async composeScenarios({ draft }) {
      return draft;
    },
    async review() {
      return { pass: true, issueCodes: [] };
    },
  };
}

async function completedRun(): Promise<{ projectRoot: string; analysisRunId: string; scenarioIds: string[] }> {
  const projectRoot = await mkdtemp(join(tmpdir(), "scenarioforge-requirements-e2e-"));
  await mkdir(join(projectRoot, "src"));
  await writeFile(
    join(projectRoot, "src", "App.tsx"),
    `export function App(){return <><Route path="/checkout"/><Route path="/complete"/><button data-testid="submit-order">Submit order</button></>}\n`,
    "utf8",
  );
  const harness = new ScenarioGenerationHarness({
    projectRoot,
    projectId: "PRJ-fixture",
    runtimeVersion: "1.0.0",
    protocolVersion: "1",
    executor: executor(projectRoot),
  });
  const result = await harness.run();
  return {
    projectRoot,
    analysisRunId: result.analysisRunId,
    scenarioIds: result.scenarios.scenarios.map((scenario) => scenario.scenario_id),
  };
}

describe("test execution requirements from a canonical run", () => {
  it("derives requirements from the registered scenario and fact artifacts", async () => {
    const { projectRoot, analysisRunId, scenarioIds } = await completedRun();

    const requirements = await loadTestExecutionRequirements(projectRoot, analysisRunId, [scenarioIds[0]!]);

    expect(requirements.runId).toBe(analysisRunId);
    expect(requirements.scenarios).toHaveLength(1);
    expect(requirements.scenarios[0]?.scenarioId).toBe(scenarioIds[0]);
    // click step 하나이므로 입력 값을 요구하지 않고 바로 실행 가능해야 한다.
    expect(requirements.dataBindings).toEqual([]);
    expect(requirements.scenarios[0]).toMatchObject({ state: "ready", blockers: [] });
    expect(requirements.hasDestructiveStep).toBe(false);
  }, 60_000);

  it("rejects a scenario id that the run never produced", async () => {
    const { projectRoot, analysisRunId } = await completedRun();

    await expect(loadTestExecutionRequirements(projectRoot, analysisRunId, ["SCN-not-in-run"])).rejects.toThrow(
      "SCENARIO_SELECTION_NOT_IN_RUN",
    );
  }, 60_000);

  it("fails closed when the scenario artifact on disk no longer matches its registered hash", async () => {
    const { projectRoot, analysisRunId, scenarioIds } = await completedRun();
    const scenarioPath = join(projectRoot, ".scenarioforge", "runs", analysisRunId, "scenario-set.json");
    const tampered = JSON.parse(await readFile(scenarioPath, "utf8")) as { scenarios: unknown[] };
    tampered.scenarios = [];
    await writeFile(scenarioPath, `${JSON.stringify(tampered, null, 2)}\n`, "utf8");

    await expect(loadTestExecutionRequirements(projectRoot, analysisRunId, [scenarioIds[0]!])).rejects.toThrow(
      "SCENARIO_ARTIFACT_HASH_MISMATCH",
    );
  }, 60_000);

  it("fails closed when the fact artifact on disk no longer matches its registered hash", async () => {
    const { projectRoot, analysisRunId, scenarioIds } = await completedRun();
    const factPath = join(projectRoot, ".scenarioforge", "runs", analysisRunId, "facts", `FACT-${analysisRunId}.json`);
    const tampered = JSON.parse(await readFile(factPath, "utf8")) as { screens: unknown[] };
    tampered.screens = [];
    await writeFile(factPath, `${JSON.stringify(tampered, null, 2)}\n`, "utf8");

    await expect(loadTestExecutionRequirements(projectRoot, analysisRunId, [scenarioIds[0]!])).rejects.toThrow(
      "FACT_ARTIFACT_HASH_MISMATCH",
    );
  }, 60_000);
});

describe("scenario view from a canonical run", () => {
  it("projects the registered scenario set for the results screen", async () => {
    const { projectRoot, analysisRunId, scenarioIds } = await completedRun();

    const view = await loadScenarioView(projectRoot, analysisRunId);

    expect(view.runId).toBe(analysisRunId);
    expect(view.groups.flatMap((group) => group.scenarios).map((scenario) => scenario.id)).toEqual(scenarioIds);
  }, 60_000);
});

describe("execution command through the coordinator", () => {
  async function queueOne() {
    const { projectRoot, analysisRunId, scenarioIds } = await completedRun();
    const source = await loadExecutionPlan(projectRoot, analysisRunId, [scenarioIds[0]!], []);
    const request = {
      scenarioIds: [scenarioIds[0]!],
      targetUrl: "https://staging.example.com",
      dataBindings: {},
      maskElementRefs: [],
      destructiveAllowed: false,
    };
    expect(validateExecutionCommand({ requirements: source.requirements, request })).toBeNull();

    const queued = await new TestCoordinator().createExecution({
      projectRoot,
      runId: analysisRunId,
      projectId: "PRJ-fixture",
      operationId: "OP-e2e-1",
      sourceSnapshotId: source.sourceSnapshotId,
      scenarioArtifactHash: source.scenarioArtifactHash,
      factArtifactHash: source.factArtifactHash,
      target: { kind: "web", entryUrl: request.targetUrl, maskElementRefs: [], destructiveAllowed: false },
      dataBindingKeys: [],
      plans: source.plans,
      createdAt: "2026-09-07T00:00:00.000Z",
    });
    return { projectRoot, analysisRunId, scenarioIds, queued };
  }

  it("queues a batch under the run tests subtree without touching generation artifacts", async () => {
    const { projectRoot, analysisRunId, queued } = await queueOne();

    const batchManifest = JSON.parse(
      await readFile(
        join(projectRoot, ".scenarioforge", "runs", analysisRunId, "tests", queued.executionId, "batches", queued.batchId, "batch-manifest.json"),
        "utf8",
      ),
    );
    expect(batchManifest).toMatchObject({ planningStatus: "QUEUED", runtimeStatus: "QUEUED", ordinal: 1 });

    // 생성 트랙의 정본은 그대로여야 한다.
    const view = await loadScenarioView(projectRoot, analysisRunId);
    expect(view.runId).toBe(analysisRunId);
  }, 60_000);

  it("projects the queued execution for the test center with human readable steps", async () => {
    const { projectRoot, analysisRunId, scenarioIds, queued } = await queueOne();

    const executions = await loadTestExecutions(projectRoot, analysisRunId);

    expect(executions).toHaveLength(1);
    expect(executions[0]).toMatchObject({
      executionId: queued.executionId,
      scenarioRunId: analysisRunId,
      targetUrl: "https://staging.example.com",
      status: "queued",
    });
    expect(executions[0]?.cases[0]?.scenarioId).toBe(scenarioIds[0]);
    const step = executions[0]?.cases[0]?.steps[0];
    expect(step?.status).toBe("queued");
    // 사람이 읽는 동작·기대 결과는 정본 시나리오에서 온다. 참조 문자열이 아니다.
    expect(step?.action).not.toBe("");
    expect(step?.action).not.toMatch(/^E-/);
  }, 60_000);

  it("returns the same batch when the same operation id is replayed", async () => {
    const { projectRoot, analysisRunId, scenarioIds } = await completedRun();
    const source = await loadExecutionPlan(projectRoot, analysisRunId, [scenarioIds[0]!], []);
    const coordinator = new TestCoordinator();
    const command = {
      projectRoot,
      runId: analysisRunId,
      projectId: "PRJ-fixture",
      operationId: "OP-replay",
      sourceSnapshotId: source.sourceSnapshotId,
      scenarioArtifactHash: source.scenarioArtifactHash,
      factArtifactHash: source.factArtifactHash,
      target: { kind: "web" as const, entryUrl: "https://staging.example.com", maskElementRefs: [], destructiveAllowed: false },
      dataBindingKeys: [],
      plans: source.plans,
      createdAt: "2026-09-07T00:00:00.000Z",
    };

    const first = await coordinator.createExecution(command);
    const second = await coordinator.createExecution(command);

    expect(second.executionId).toBe(first.executionId);
    expect(await loadTestExecutions(projectRoot, analysisRunId)).toHaveLength(1);
  }, 60_000);
});

describe("batch execution results reach the test center projection", () => {
  it("writes case results and step evidence, then projects real verdicts", async () => {
    const { projectRoot, analysisRunId, scenarioIds } = await completedRun();
    const source = await loadExecutionPlan(projectRoot, analysisRunId, [scenarioIds[0]!], []);
    const queued = await new TestCoordinator().createExecution({
      projectRoot,
      runId: analysisRunId,
      projectId: "PRJ-fixture",
      operationId: "OP-execute",
      sourceSnapshotId: source.sourceSnapshotId,
      scenarioArtifactHash: source.scenarioArtifactHash,
      factArtifactHash: source.factArtifactHash,
      target: { kind: "web", entryUrl: "https://staging.example.com", maskElementRefs: [], destructiveAllowed: false },
      dataBindingKeys: [],
      plans: source.plans,
      createdAt: "2026-09-07T00:00:00.000Z",
    });

    const writer = new ExecutionWriter(projectRoot, analysisRunId, queued.executionId);
    const space = createFrameCoordinateSpace({ width: 1440, height: 900 });
    const outcome = (envelope: VisionStepEnvelope): StepOutcome => ({
      status: "inconclusive",
      verdict: "INCONCLUSIVE",
      attempts: [],
      frames: [],
      reason: { code: "TARGET_NOT_FOUND", detail: envelope.target.visibleLabel },
    });

    const result = await executeBatch({
      executionId: queued.executionId,
      batchId: queued.batchId,
      cases: source.plans,
      screens: source.facts.screens,
      ports: {
        runStep: async (envelope) => outcome(envelope),
        buildEvidence: ({ envelope, outcome: stepOutcome }) => buildStepEvidence({ envelope, outcome: stepOutcome, space }),
        writeStepEvidence: (input) => writer.writeStepEvidence(input),
        writeCaseResult: (record) => writer.writeCaseResult(record),
        writeBatchResult: (record) => writer.writeBatchResult(record),
        now: () => "2026-09-07T00:01:00.000Z",
      },
    });

    expect(result.runtimeStatus).toBe("COMPLETED");
    expect(result.cases[0]?.verdict).toBe("INCONCLUSIVE");

    const executions = await loadTestExecutions(projectRoot, analysisRunId);
    const projected = executions.find((execution) => execution.executionId === queued.executionId);

    expect(projected?.status).toBe("inconclusive");
    expect(projected?.cases[0]?.status).toBe("inconclusive");
    // 사유가 화면까지 전달돼야 사용자가 조치할 수 있다.
    expect(projected?.cases[0]?.steps[0]?.diagnostics?.reason).toEqual({
      code: "TARGET_NOT_FOUND",
      detail: expect.any(String),
    });
    expect(projected?.evidenceBytes).toBeGreaterThan(0);
  }, 60_000);

  it("keeps execution artifacts inside the run tests subtree", async () => {
    const { projectRoot, analysisRunId, scenarioIds } = await completedRun();
    const source = await loadExecutionPlan(projectRoot, analysisRunId, [scenarioIds[0]!], []);
    const queued = await new TestCoordinator().createExecution({
      projectRoot,
      runId: analysisRunId,
      projectId: "PRJ-fixture",
      operationId: "OP-scope",
      sourceSnapshotId: source.sourceSnapshotId,
      scenarioArtifactHash: source.scenarioArtifactHash,
      factArtifactHash: source.factArtifactHash,
      target: { kind: "web", entryUrl: "https://staging.example.com", maskElementRefs: [], destructiveAllowed: false },
      dataBindingKeys: [],
      plans: source.plans,
      createdAt: "2026-09-07T00:00:00.000Z",
    });

    const writer = new ExecutionWriter(projectRoot, analysisRunId, queued.executionId);
    const path = await writer.writeStepEvidence({
      scenarioId: "../../escape",
      stepId: "SCN-1#1",
      record: { schemaVersion: 1 } as never,
    });

    expect(path).not.toContain("..");
    // 생성 정본은 그대로여야 한다.
    await expect(loadScenarioView(projectRoot, analysisRunId)).resolves.toBeDefined();
  }, 60_000);
});

describe("required bindings reach the test center", () => {
  it("exposes the binding keys a queued execution still needs, without values", async () => {
    const { projectRoot, analysisRunId, scenarioIds } = await completedRun();
    const source = await loadExecutionPlan(projectRoot, analysisRunId, [scenarioIds[0]!], ["EL-PW"]);
    const queued = await new TestCoordinator().createExecution({
      projectRoot,
      runId: analysisRunId,
      projectId: "PRJ-fixture",
      operationId: "OP-bindings",
      sourceSnapshotId: source.sourceSnapshotId,
      scenarioArtifactHash: source.scenarioArtifactHash,
      factArtifactHash: source.factArtifactHash,
      target: { kind: "web", entryUrl: "https://staging.example.com", maskElementRefs: [], destructiveAllowed: false },
      dataBindingKeys: [{ bindingKey: "EL-PW", secret: true }],
      plans: source.plans,
      createdAt: "2026-09-07T00:00:00.000Z",
    });

    const executions = await loadTestExecutions(projectRoot, analysisRunId);
    const projected = executions.find((execution) => execution.executionId === queued.executionId);

    expect(projected?.requiredBindings).toEqual([{ bindingKey: "EL-PW", secret: true }]);
    expect(JSON.stringify(projected)).not.toContain("test-only");
  }, 60_000);
});

describe("human review sits beside the evidence without changing the verdict", () => {
  it("records a review and leaves the execution result untouched", async () => {
    const { projectRoot, analysisRunId, scenarioIds } = await completedRun();
    const source = await loadExecutionPlan(projectRoot, analysisRunId, [scenarioIds[0]!], []);
    const queued = await new TestCoordinator().createExecution({
      projectRoot,
      runId: analysisRunId,
      projectId: "PRJ-fixture",
      operationId: "OP-review",
      sourceSnapshotId: source.sourceSnapshotId,
      scenarioArtifactHash: source.scenarioArtifactHash,
      factArtifactHash: source.factArtifactHash,
      target: { kind: "web", entryUrl: "https://staging.example.com", maskElementRefs: [], destructiveAllowed: false },
      dataBindingKeys: [],
      plans: source.plans,
      createdAt: "2026-09-07T00:00:00.000Z",
    });

    const writer = new ExecutionWriter(projectRoot, analysisRunId, queued.executionId);
    const space = createFrameCoordinateSpace({ width: 1440, height: 900 });
    const result = await executeBatch({
      executionId: queued.executionId,
      batchId: queued.batchId,
      cases: source.plans,
      screens: source.facts.screens,
      ports: {
        runStep: async (envelope) =>
          ({
            status: "inconclusive",
            verdict: "INCONCLUSIVE",
            attempts: [],
            frames: [],
            reason: { code: "TARGET_NOT_FOUND", detail: envelope.target.visibleLabel },
          }) satisfies StepOutcome,
        buildEvidence: ({ envelope, outcome }) => buildStepEvidence({ envelope, outcome, space }),
        writeStepEvidence: (input) => writer.writeStepEvidence(input),
        writeCaseResult: (record) => writer.writeCaseResult(record),
        writeBatchResult: (record) => writer.writeBatchResult(record),
        now: () => "2026-09-07T00:01:00.000Z",
      },
    });

    const scenarioId = result.cases[0]!.scenarioId;
    const stepId = result.cases[0]!.steps[0]!.stepId;
    const store = new ReviewStore(projectRoot, analysisRunId, queued.executionId);
    await store.append({
      scenarioId,
      stepId,
      decision: "오탐",
      causeTag: "라벨 화면 미표시",
      note: "라벨이 화면에 없어 모델이 찾을 수 없었다",
      author: "이수민",
      at: "2026-09-07T00:02:00.000Z",
    });

    expect(await store.list(scenarioId, stepId)).toHaveLength(1);

    // 검토는 판정을 바꾸지 않는다.
    const projected = (await loadTestExecutions(projectRoot, analysisRunId)).find(
      (execution) => execution.executionId === queued.executionId,
    );
    expect(projected?.cases[0]?.status).toBe("inconclusive");
    expect(projected?.cases[0]?.steps[0]?.diagnostics?.reason?.code).toBe("TARGET_NOT_FOUND");
  }, 60_000);
});

describe("enqueue and retry against a canonical run", () => {
  async function firstExecution() {
    const { projectRoot, analysisRunId, scenarioIds } = await completedRun();
    const source = await loadExecutionPlan(projectRoot, analysisRunId, [scenarioIds[0]!], []);
    const coordinator = new TestCoordinator();
    const queued = await coordinator.createExecution({
      projectRoot,
      runId: analysisRunId,
      projectId: "PRJ-fixture",
      operationId: "OP-first",
      sourceSnapshotId: source.sourceSnapshotId,
      scenarioArtifactHash: source.scenarioArtifactHash,
      factArtifactHash: source.factArtifactHash,
      target: { kind: "web", entryUrl: "https://staging.example.com", maskElementRefs: [], destructiveAllowed: false },
      dataBindingKeys: [],
      plans: source.plans,
      createdAt: "2026-09-07T00:00:00.000Z",
    });
    return { projectRoot, analysisRunId, scenarioIds, source, coordinator, queued };
  }

  it("refuses to enqueue a scenario the execution already carries", async () => {
    const { projectRoot, analysisRunId, source, coordinator, queued } = await firstExecution();

    await expect(
      coordinator.enqueueScenarios({
        projectRoot,
        runId: analysisRunId,
        projectId: "PRJ-fixture",
        operationId: "OP-enqueue",
        executionId: queued.executionId,
        targetProfileHash: queued.targetProfileHash,
        sourceSnapshotId: source.sourceSnapshotId,
        scenarioArtifactHash: source.scenarioArtifactHash,
        factArtifactHash: source.factArtifactHash,
        target: { kind: "web", entryUrl: "https://staging.example.com", maskElementRefs: [], destructiveAllowed: false },
        dataBindingKeys: [],
        plans: source.plans,
        createdAt: "2026-09-07T00:01:00.000Z",
      }),
    ).rejects.toThrow("SCENARIO_ALREADY_IN_EXECUTION");
  }, 60_000);

  it("makes a retry a separate execution and leaves the first one intact", async () => {
    const { projectRoot, analysisRunId, source, coordinator, queued } = await firstExecution();

    const retried = await coordinator.retryCases({
      projectRoot,
      runId: analysisRunId,
      projectId: "PRJ-fixture",
      operationId: "OP-retry",
      sourceSnapshotId: source.sourceSnapshotId,
      scenarioArtifactHash: source.scenarioArtifactHash,
      factArtifactHash: source.factArtifactHash,
      target: { kind: "web", entryUrl: "https://staging.example.com", maskElementRefs: [], destructiveAllowed: false },
      dataBindingKeys: [],
      plans: source.plans,
      createdAt: "2026-09-07T00:02:00.000Z",
      retryOfExecutionId: queued.executionId,
    });

    expect(retried.executionId).not.toBe(queued.executionId);
    const executions = await loadTestExecutions(projectRoot, analysisRunId);
    expect(executions.map((execution) => execution.executionId).sort()).toEqual(
      [queued.executionId, retried.executionId].sort(),
    );
  }, 60_000);
});
