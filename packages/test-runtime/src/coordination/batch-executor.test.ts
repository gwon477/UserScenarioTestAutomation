import { describe, expect, it } from "vitest";
import type { FactScreen } from "@scenarioforge/contracts";
import type { VisionStepEnvelope } from "../types.js";
import type { StepOutcome } from "../execution/step-runner.js";
import type { StepEvidenceRecord } from "../execution/step-evidence.js";
import { executeBatch, type BatchExecutorPorts, type CaseResultRecord } from "./batch-executor.js";

const screens: FactScreen[] = [];

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

const passed = (): StepOutcome => ({
  status: "completed",
  verdict: "PASSED",
  attempts: [],
  capturePoint: { x: 1, y: 1 },
  assertions: [],
  observations: 2,
  frames: [],
});
const failed = (): StepOutcome => ({
  status: "completed",
  verdict: "FAILED",
  attempts: [],
  capturePoint: { x: 1, y: 1 },
  assertions: [],
  observations: 2,
  frames: [],
});
const abortedMasking = (): StepOutcome => ({
  status: "aborted",
  verdict: "INCONCLUSIVE",
  attempts: [],
  frames: [],
  reason: { code: "FRAME_MASKING_FAILED", detail: "step" },
});
const inconclusive = (): StepOutcome => ({
  status: "inconclusive",
  verdict: "INCONCLUSIVE",
  attempts: [],
  frames: [],
  reason: { code: "TARGET_NOT_FOUND", detail: "로그인" },
});

function harness(outcomes: Record<string, () => StepOutcome>, options: { cancelBefore?: string } = {}) {
  const ran: string[] = [];
  const evidence: string[] = [];
  const caseRecords: CaseResultRecord[] = [];
  let cancelled = false;

  const ports: BatchExecutorPorts = {
    async runStep(envelopeInput) {
      ran.push(envelopeInput.stepId);
      return (outcomes[envelopeInput.stepId] ?? passed)();
    },
    buildEvidence: ({ envelope: target, outcome }) =>
      ({ schemaVersion: 1, stepId: target.stepId, verdict: outcome.verdict } as unknown as StepEvidenceRecord),
    async writeStepEvidence({ scenarioId, stepId }) {
      evidence.push(stepId);
      return `cases/${scenarioId}/${stepId}/evidence.json`;
    },
    async writeCaseResult(record) {
      caseRecords.push(record);
    },
    async writeBatchResult() {},
    now: () => "2026-09-07T00:00:00.000Z",
    isCancelled: () => {
      if (options.cancelBefore === undefined) return false;
      if (cancelled) return true;
      if (ran.at(-1) === options.cancelBefore) {
        cancelled = true;
        return true;
      }
      return false;
    },
  };

  return { ports, ran, evidence, caseRecords };
}

const twoCases = [
  { scenarioId: "SCN-1", title: "첫째", envelopes: [envelope("SCN-1#1"), envelope("SCN-1#2")] },
  { scenarioId: "SCN-2", title: "둘째", envelopes: [envelope("SCN-2#1")] },
];

const run = (ports: BatchExecutorPorts, cases = twoCases) =>
  executeBatch({ executionId: "EXEC-1", batchId: "batch-001", cases, screens, ports });

describe("batch executor", () => {
  it("runs every case and step in order", async () => {
    const { ports, ran } = harness({});

    const result = await run(ports);

    expect(ran).toEqual(["SCN-1#1", "SCN-1#2", "SCN-2#1"]);
    expect(result.runtimeStatus).toBe("COMPLETED");
    expect(result.cases.map((entry) => entry.verdict)).toEqual(["PASSED", "PASSED"]);
    expect(result.verdictCounts.PASSED).toBe(3);
  });

  it("writes step evidence for every step it ran", async () => {
    const { ports, evidence } = harness({});

    const result = await run(ports);

    expect(evidence).toEqual(["SCN-1#1", "SCN-1#2", "SCN-2#1"]);
    expect(result.cases[0]?.steps[0]?.evidencePath).toBe("cases/SCN-1/SCN-1#1/evidence.json");
  });

  it("stops the failed case but continues with the next one", async () => {
    const { ports, ran } = harness({ "SCN-1#1": failed });

    const result = await run(ports);

    expect(ran).toEqual(["SCN-1#1", "SCN-2#1"]);
    expect(result.cases[0]).toMatchObject({ verdict: "FAILED" });
    expect(result.cases[0]?.steps[1]).toMatchObject({ verdict: "SKIPPED" });
    expect(result.cases[1]).toMatchObject({ verdict: "PASSED" });
    expect(result.runtimeStatus).toBe("COMPLETED");
  });

  it("carries the reason of a step that could not be judged", async () => {
    const { ports } = harness({ "SCN-1#1": inconclusive });

    const result = await run(ports);

    expect(result.cases[0]).toMatchObject({ verdict: "INCONCLUSIVE" });
    expect(result.cases[0]?.steps[0]?.reason).toEqual({ code: "TARGET_NOT_FOUND", detail: "로그인" });
  });

  it("aborts the whole execution on a masking failure and does not touch the next case", async () => {
    const { ports, ran } = harness({ "SCN-1#1": abortedMasking });

    const result = await run(ports);

    expect(ran).toEqual(["SCN-1#1"]);
    expect(result.runtimeStatus).toBe("ABORTED");
    expect(result.cases[1]?.steps[0]).toMatchObject({ verdict: "SKIPPED" });
    expect(result.cases[1]?.verdict).toBe("INCONCLUSIVE");
  });

  it("marks the remaining work cancelled when the user stops the run", async () => {
    const { ports, ran } = harness({}, { cancelBefore: "SCN-1#1" });

    const result = await run(ports);

    expect(ran).toEqual(["SCN-1#1"]);
    expect(result.runtimeStatus).toBe("CANCELLED");
    expect(result.cases[0]).toMatchObject({ verdict: "CANCELLED" });
    expect(result.cases[1]?.steps[0]).toMatchObject({ verdict: "CANCELLED" });
    expect(result.verdictCounts.CANCELLED).toBe(2);
  });

  it("keeps the evidence of steps that already ran when the execution stops", async () => {
    const { ports, evidence } = harness({ "SCN-1#2": abortedMasking });

    await run(ports);

    expect(evidence).toEqual(["SCN-1#1", "SCN-1#2"]);
  });

  it("records the case results as it goes rather than only at the end", async () => {
    const { ports, caseRecords } = harness({});

    await run(ports);

    expect(caseRecords.map((record) => record.scenarioId)).toEqual(["SCN-1", "SCN-2"]);
  });
});
