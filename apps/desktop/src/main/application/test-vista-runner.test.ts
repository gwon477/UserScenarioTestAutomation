import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FactScreen } from "@scenarioforge/contracts";
import { executionRoot, type FrameCapture, type VisionStepEnvelope } from "@scenarioforge/test-runtime";
import { runQueuedBatch, type VisionModels, type VisionSurface } from "./test-vista-runner";

const RUN_ID = "RUN-vista-01";
const EXECUTION_ID = "EXEC-vista-01";
const identity = { project_id: "P-1", analysis_run_id: RUN_ID, source_snapshot_id: "SS-1" } as const;

const destination: FactScreen = {
  ...identity,
  schema_version: 3,
  screen_id: "SCR-HOME",
  route: "/home",
  title: "대시보드",
  entry_guards: [],
  elements: [],
  apis: [],
  feedback: [],
  displays: [],
  status: "verified",
};

const envelope = (stepId: string, valueRef?: string): VisionStepEnvelope => ({
  stepId,
  actionRef: "E-1",
  assertionRefs: ["SCR-HOME"],
  intent: valueRef ? { kind: "fill", valueRef } : { kind: "press" },
  allowedActions: valueRef ? ["type"] : ["click"],
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
  ...(valueRef ? { valueRef } : {}),
  budget: { maxModelCalls: 3, maxScreenshots: 4, timeoutMs: 30_000 },
  riskClass: "reversible-write",
});

const capture: FrameCapture = { pngBase64: Buffer.from("frame").toString("base64"), size: { width: 1440, height: 900 } };

function surfaceStub(options: { maskApplied?: boolean } = {}) {
  const log = { clicks: [] as unknown[], typed: [] as unknown[], captures: 0 };
  const surface: VisionSurface = {
    async capture() {
      log.captures += 1;
      return { capture, maskApplied: options.maskApplied ?? true };
    },
    async click(point) {
      log.clicks.push(point);
    },
    async type(point, value) {
      log.typed.push({ point, value });
    },
    async resize(frame, space) {
      return { pngBase64: frame.pngBase64, size: space.modelSize };
    },
  };
  return { surface, log };
}

function modelStub(options: { found?: boolean; observed?: string[][] } = {}) {
  const observations = options.observed ?? [["대시보드"], ["대시보드"]];
  let observed = 0;
  const models: VisionModels = {
    async propose({ envelope: target }) {
      if (options.found === false) return null;
      return {
        stepId: target.stepId,
        action: target.allowedActions[0]!,
        point: { x: 615, y: 482 },
        observedLabel: target.target.visibleLabel,
        confidence: 0.99,
      };
    },
    async observe() {
      const texts = observations[Math.min(observed, observations.length - 1)] ?? [];
      observed += 1;
      return { texts };
    },
  };
  return models;
}

let projectRoot: string;

beforeEach(async () => {
  projectRoot = await mkdtemp(join(tmpdir(), "scenarioforge-vista-"));
});

afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
});

const base = (overrides: Partial<Parameters<typeof runQueuedBatch>[0]> = {}) => ({
  projectRoot,
  runId: RUN_ID,
  executionId: EXECUTION_ID,
  batchId: "batch-001",
  cases: [{ scenarioId: "SCN-1", title: "로그인", envelopes: [envelope("SCN-1#1")] }],
  screens: [destination],
  values: {},
  maskedRegions: [{ elementRef: "EL-PW", label: "패스워드" }],
  viewport: { width: 1440, height: 900 },
  now: () => "2026-09-07T00:00:00.000Z",
  ...overrides,
});

describe("test vista runner", () => {
  it("clicks the converted capture point and records the verdict", async () => {
    const { surface, log } = surfaceStub();

    const result = await runQueuedBatch(base({ surface, models: modelStub() }) as never);

    expect(result.runtimeStatus).toBe("COMPLETED");
    expect(result.cases[0]?.verdict).toBe("PASSED");
    // 모델 좌표 615,482 를 캡처 좌표로 환산한 값이어야 한다.
    expect(log.clicks).toEqual([{ x: 721, y: 565 }]);
  });

  it("writes the model input frame and the step evidence under the execution tree", async () => {
    const { surface } = surfaceStub();

    await runQueuedBatch(base({ surface, models: modelStub() }) as never);

    const stepDirectory = join(executionRoot(projectRoot, RUN_ID, EXECUTION_ID), "cases", "SCN-1", "SCN-1-step-1");
    const frames = await readdir(join(stepDirectory, "frames"));
    expect(frames.some((name) => name.startsWith("model-input"))).toBe(true);

    const evidence = JSON.parse(await readFile(join(stepDirectory, "evidence.json"), "utf8"));
    expect(evidence).toMatchObject({
      stepId: "SCN-1#1",
      verdict: "PASSED",
      frameSpace: { modelSize: { width: 1229, height: 768 } },
      proposal: { modelPoint: { x: 615, y: 482 }, capturePoint: { x: 721, y: 565 } },
      maskedRegions: [{ elementRef: "EL-PW", label: "패스워드" }],
    });
  });

  it("aborts the execution when the mask could not be applied", async () => {
    const { surface, log } = surfaceStub({ maskApplied: false });

    const result = await runQueuedBatch(base({ surface, models: modelStub() }) as never);

    expect(result.runtimeStatus).toBe("ABORTED");
    expect(result.cases[0]?.steps[0]?.reason).toMatchObject({ code: "FRAME_MASKING_FAILED" });
    expect(log.clicks).toEqual([]);
  });

  it("types a resolved value without writing it to evidence", async () => {
    const { surface, log } = surfaceStub();

    await runQueuedBatch(
      base({
        surface,
        models: modelStub(),
        cases: [{ scenarioId: "SCN-1", title: "로그인", envelopes: [envelope("SCN-1#1", "EL-PW")] }],
        values: { "EL-PW": "test-only-value" },
      }) as never,
    );

    expect(log.typed).toEqual([{ point: { x: 721, y: 565 }, value: "test-only-value" }]);
    const evidence = await readFile(
      join(executionRoot(projectRoot, RUN_ID, EXECUTION_ID), "cases", "SCN-1", "SCN-1-step-1", "evidence.json"),
      "utf8",
    );
    expect(evidence).not.toContain("test-only-value");
    expect(evidence).toContain("EL-PW");
  });

  it("reports a target the model refused to guess as inconclusive", async () => {
    const { surface, log } = surfaceStub();

    const result = await runQueuedBatch(base({ surface, models: modelStub({ found: false }) }) as never);

    expect(result.cases[0]?.verdict).toBe("INCONCLUSIVE");
    expect(result.cases[0]?.steps[0]?.reason).toMatchObject({ code: "TARGET_NOT_FOUND" });
    expect(log.clicks).toEqual([]);
  });

  it("keeps observing a screen that fills in late", async () => {
    const { surface } = surfaceStub();

    const result = await runQueuedBatch(
      base({ surface, models: modelStub({ observed: [[], ["대시보드"], ["대시보드"]] }) }) as never,
    );

    expect(result.cases[0]?.verdict).toBe("PASSED");
  });

  it("writes the batch result the test center reads", async () => {
    const { surface } = surfaceStub();

    await runQueuedBatch(base({ surface, models: modelStub() }) as never);

    const record = JSON.parse(
      await readFile(join(executionRoot(projectRoot, RUN_ID, EXECUTION_ID), "execution-result.json"), "utf8"),
    );
    expect(record).toMatchObject({ executionId: EXECUTION_ID, batchId: "batch-001", runtimeStatus: "COMPLETED" });
  });

  it("stops between steps when cancellation is requested", async () => {
    const { surface, log } = surfaceStub();

    const result = await runQueuedBatch(
      base({
        surface,
        models: modelStub(),
        cases: [{ scenarioId: "SCN-1", title: "로그인", envelopes: [envelope("SCN-1#1"), envelope("SCN-1#2")] }],
        isCancelled: () => true,
      }) as never,
    );

    expect(result.runtimeStatus).toBe("CANCELLED");
    expect(log.clicks).toEqual([]);
  });
});
