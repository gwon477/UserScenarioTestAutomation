/* 증적 상세가 읽는 형태. packages/test-runtime 의 StepEvidenceRecord 를
 * 화면 계약으로 옮긴 것이다. 계약은 docs/screens/06-evidence.md 를 따른다. */

export type EvidenceFrameKind = "before-action" | "model-input" | "after-action";

export type EvidenceFrameView = {
  id: string;
  kind: EvidenceFrameKind;
  round: number;
  relativePath: string;
  size: { width: number; height: number };
};

export type StepEvidenceView = {
  schemaVersion: 1;
  stepId: string;
  actionRef: string;
  verdict: "PASSED" | "FAILED" | "INCONCLUSIVE";
  target: { elementRef: string; visibleLabel: string; controlKind: string; labelUniqueOnSurface: boolean };
  frameSpace: {
    captureSize: { width: number; height: number };
    modelSize: { width: number; height: number };
    scale: number;
  };
  valueRef?: string;
  maskedRegions: Array<{ elementRef: string; label: string }>;
  proposal?: {
    modelPoint: { x: number; y: number };
    capturePoint: { x: number; y: number };
    observedLabel: string;
    confidence: number;
  };
  attempts: Array<{ attempt: number; outcome: "accepted" | "rejected" | "aborted"; code?: string }>;
  assertions: Array<{ ref: string; verdict: string; detail: string }>;
  observations: number;
  reason?: { code: string; detail: string };
  frames: EvidenceFrameView[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isStepEvidenceView(value: unknown): value is StepEvidenceView {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    typeof value.stepId !== "string" ||
    !isRecord(value.frameSpace) ||
    !isRecord(value.frameSpace.captureSize) ||
    !isRecord(value.frameSpace.modelSize) ||
    typeof value.frameSpace.scale !== "number" ||
    !Array.isArray(value.frames) ||
    !Array.isArray(value.maskedRegions) ||
    !Array.isArray(value.assertions)
  ) {
    return false;
  }
  return value.frames.every(
    (frame) =>
      isRecord(frame) &&
      typeof frame.id === "string" &&
      typeof frame.relativePath === "string" &&
      isRecord(frame.size) &&
      typeof frame.size.width === "number" &&
      typeof frame.size.height === "number",
  );
}

/* 사람 검토 기록. 결정론적 verdict 를 덮어쓰지 않는 덧붙임 레이어다. */
export type ReviewDecision = "동의" | "오탐" | "미탐" | "재실행 필요";

export type ReviewCauseTag =
  | "앵커 부적절"
  | "라벨 화면 미표시"
  | "라벨 렌더링 불일치"
  | "대상 크기 과소"
  | "환경 문제"
  | "대상 앱 결함"
  | "기타";

export type HumanReviewView = {
  reviewId: string;
  executionId: string;
  scenarioId: string;
  stepId: string;
  decision: ReviewDecision;
  causeTag?: ReviewCauseTag;
  note: string;
  author: string;
  at: string;
};

export const REVIEW_DECISION_OPTIONS: readonly ReviewDecision[] = ["동의", "오탐", "미탐", "재실행 필요"];

export const REVIEW_CAUSE_TAG_OPTIONS: readonly ReviewCauseTag[] = [
  "앵커 부적절",
  "라벨 화면 미표시",
  "라벨 렌더링 불일치",
  "대상 크기 과소",
  "환경 문제",
  "대상 앱 결함",
  "기타",
];
