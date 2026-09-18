import { describe, expect, it } from "vitest";
import { createFrameCoordinateSpace } from "../planning/frame-coordinate-space.js";
import type { VisionStepEnvelope } from "../types.js";
import { buildStepEvidence } from "./step-evidence.js";
import type { RecordedFrame, StepOutcome } from "./step-runner.js";

const space = createFrameCoordinateSpace({ width: 1440, height: 900 });

const envelope: VisionStepEnvelope = {
  stepId: "SCN-1#1",
  actionRef: "E-1",
  assertionRefs: ["SCR-2"],
  intent: { kind: "press" },
  allowedActions: ["click"],
  target: {
    descriptorId: "VTD-1",
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
};

const frame = (id: string, kind: RecordedFrame["kind"], round: number): RecordedFrame => ({
  id,
  kind,
  round,
  relativePath: `frames/${id}.png`,
  size: { width: 1229, height: 768 },
});

const completed: StepOutcome = {
  status: "completed",
  verdict: "PASSED",
  capturePoint: { x: 721, y: 565 },
  observations: 3,
  assertions: [{ ref: "SCR-2", verdict: "PASSED", detail: "대시보드" }],
  frames: [frame("f1", "model-input", 1), frame("f2", "after-action", 1), frame("f3", "after-action", 2)],
  attempts: [
    {
      attempt: 1,
      decision: { outcome: "accepted", capturePoint: { x: 721, y: 565 }, modelPoint: { x: 615, y: 482 } },
      observedLabel: "로그인",
      confidence: 0.99,
    },
  ],
};

describe("step evidence record", () => {
  it("records both coordinate spaces and the scale so the frame is reproducible", () => {
    const record = buildStepEvidence({ envelope, outcome: completed, space });

    expect(record.frameSpace).toEqual({
      captureSize: { width: 1440, height: 900 },
      modelSize: { width: 1229, height: 768 },
      scale: space.scale,
    });
    expect(record.proposal).toEqual({
      modelPoint: { x: 615, y: 482 },
      capturePoint: { x: 721, y: 565 },
      observedLabel: "로그인",
      confidence: 0.99,
    });
  });

  it("keeps the model input frame alongside the observation frames", () => {
    const record = buildStepEvidence({ envelope, outcome: completed, space });

    expect(record.frames.map((entry) => entry.kind)).toEqual(["model-input", "after-action", "after-action"]);
    expect(record.observations).toBe(3);
  });

  it("names the masked regions so a black box is not read as a rendering fault", () => {
    const record = buildStepEvidence({
      envelope,
      outcome: completed,
      space,
      maskedRegions: [{ elementRef: "EL-PW", label: "패스워드" }],
    });

    expect(record.maskedRegions).toEqual([{ elementRef: "EL-PW", label: "패스워드" }]);
  });

  it("records the rejection code of every attempt that did not act", () => {
    const retried: StepOutcome = {
      ...completed,
      attempts: [
        { attempt: 1, decision: { outcome: "rejected", code: "OBSERVED_LABEL_MISMATCH", detail: "로그아웃" }, observedLabel: "로그아웃", confidence: 0.99 },
        completed.attempts[0]!,
      ],
    };

    const record = buildStepEvidence({ envelope, outcome: retried, space });

    expect(record.attempts).toEqual([
      { attempt: 1, outcome: "rejected", code: "OBSERVED_LABEL_MISMATCH" },
      { attempt: 1, outcome: "accepted" },
    ]);
    expect(record.proposal?.observedLabel).toBe("로그인");
  });

  it("carries the reason and no proposal when the step never acted", () => {
    const aborted: StepOutcome = {
      status: "aborted",
      verdict: "INCONCLUSIVE",
      attempts: [],
      frames: [],
      reason: { code: "FRAME_MASKING_FAILED", detail: "SCN-1#1" },
    };

    const record = buildStepEvidence({ envelope, outcome: aborted, space });

    expect(record.proposal).toBeUndefined();
    expect(record.reason).toEqual({ code: "FRAME_MASKING_FAILED", detail: "SCN-1#1" });
    expect(record.assertions).toEqual([]);
    expect(record.verdict).toBe("INCONCLUSIVE");
  });

  it("never carries a data binding value", () => {
    const withValue: VisionStepEnvelope = { ...envelope, valueRef: "EL-PW", intent: { kind: "fill", valueRef: "EL-PW" } };

    const record = buildStepEvidence({ envelope: withValue, outcome: completed, space });

    expect(JSON.stringify(record)).not.toContain("kimtester");
    expect(JSON.stringify(record)).toContain("EL-PW");
  });
});
