/* 한 step 의 durable 증적 기록.
 *
 * 비전 경로에서 판정 근거는 원본 화면이 아니라 «모델에 전송된 프레임»이다.
 * 원본만 남기면 왜 그렇게 판정됐는지 재구성할 수 없다. 좌표계 배율과 제안
 * 좌표를 함께 남기지 않으면 증적이 재현 불가다.
 *
 * 계약은 docs/screens/06-evidence.md 를 따른다.
 */

import type { FrameCoordinateSpace } from "../planning/frame-coordinate-space.js";
import type { Point, VisionStepEnvelope } from "../types.js";
import type { AssertionResult, StepVerdict } from "./assertion-engine.js";
import type { RecordedFrame, StepOutcome } from "./step-runner.js";

export type MaskedRegionRecord = {
  elementRef: string;
  label: string;
};

export type StepEvidenceRecord = {
  schemaVersion: 1;
  stepId: string;
  actionRef: string;
  verdict: StepVerdict;
  target: {
    elementRef: string;
    visibleLabel: string;
    controlKind: string;
    labelUniqueOnSurface: boolean;
  };
  /** 캡처 좌표계와 모델 전송 좌표계, 그리고 그 배율. */
  frameSpace: {
    captureSize: { width: number; height: number };
    modelSize: { width: number; height: number };
    scale: number;
  };
  /** 소비한 binding key. 원문 값은 담지 않는다. */
  valueRef?: string;
  /** 가려진 대상. 검은 사각형을 렌더링 오류로 오해하지 않게 표시용으로 남긴다. */
  maskedRegions: readonly MaskedRegionRecord[];
  /** 실제로 적용된 제안. 두 좌표계를 모두 남긴다. */
  proposal?: {
    modelPoint: Point;
    capturePoint: Point;
    observedLabel: string;
    confidence: number;
  };
  attempts: ReadonlyArray<{ attempt: number; outcome: "accepted" | "rejected" | "aborted"; code?: string }>;
  assertions: readonly AssertionResult[];
  observations: number;
  reason?: { code: string; detail: string };
  frames: readonly RecordedFrame[];
};

export function buildStepEvidence(input: {
  envelope: VisionStepEnvelope;
  outcome: StepOutcome;
  space: FrameCoordinateSpace;
  maskedRegions?: readonly MaskedRegionRecord[];
}): StepEvidenceRecord {
  const { envelope, outcome, space } = input;
  const accepted = outcome.attempts.find((attempt) => attempt.decision.outcome === "accepted");
  const decision = accepted?.decision.outcome === "accepted" ? accepted.decision : undefined;

  return {
    schemaVersion: 1,
    stepId: envelope.stepId,
    actionRef: envelope.actionRef,
    verdict: outcome.verdict,
    target: {
      elementRef: envelope.target.elementRef,
      visibleLabel: envelope.target.visibleLabel,
      controlKind: envelope.target.controlKind,
      labelUniqueOnSurface: envelope.target.labelUniqueOnSurface,
    },
    frameSpace: {
      captureSize: { ...space.captureSize },
      modelSize: { ...space.modelSize },
      scale: space.scale,
    },
    ...(envelope.valueRef === undefined ? {} : { valueRef: envelope.valueRef }),
    maskedRegions: input.maskedRegions ?? [],
    ...(decision
      ? {
          proposal: {
            modelPoint: { ...decision.modelPoint },
            capturePoint: { ...decision.capturePoint },
            // 모델이 화면에서 읽은 텍스트. 판정 근거로 남긴다.
            observedLabel: accepted?.observedLabel ?? "",
            confidence: accepted?.confidence ?? 0,
          },
        }
      : {}),
    attempts: outcome.attempts.map((attempt) => ({
      attempt: attempt.attempt,
      outcome: attempt.decision.outcome,
      ...(attempt.decision.outcome === "accepted" ? {} : { code: attempt.decision.code }),
    })),
    assertions: outcome.status === "completed" ? outcome.assertions : [],
    observations: outcome.status === "completed" ? outcome.observations : 0,
    ...(outcome.status === "completed" ? {} : { reason: { code: outcome.reason.code, detail: outcome.reason.detail } }),
    frames: outcome.frames,
  };
}
