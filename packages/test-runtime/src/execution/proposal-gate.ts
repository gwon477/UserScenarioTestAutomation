/* 모델 제안과 실제 입력 사이의 backend gate. LLM 이 아니라 코드다.
 *
 * PROBE-20260907-01 에서 확인된 두 가지가 이 gate 의 설계 근거다.
 *  1. confidence 는 판별력이 없다. hit 과 miss 모두 0.94~0.99 였다.
 *     따라서 신뢰도는 하한 검사에만 쓰고, 판정 무게는 라벨·후보 대조가 진다.
 *  2. 픽셀이 동일한 프레임에서 같은 대상 판정이 hit 과 not-found 로 갈렸다.
 *     따라서 단일 응답을 사실로 받지 않는다.
 *
 * 설계 근거: docs/architecture/07-vision-first-execution-design.md §5
 */

import type { FrameCoordinateSpace } from "../planning/frame-coordinate-space.js";
import { toCaptureSpace } from "../planning/frame-coordinate-space.js";
import type { Point, RiskClass, SemanticCandidate, VisionActionProposal, VisionStepEnvelope } from "../types.js";

export type RejectionCode =
  | "STEP_MISMATCH"
  | "ACTION_NOT_ALLOWED"
  | "LOCUS_OUT_OF_BOUNDS"
  | "OBSERVED_LABEL_MISMATCH"
  | "TARGET_NOT_DISAMBIGUATED"
  | "CANDIDATE_VERIFICATION_FAILED"
  | "CONFIDENCE_BELOW_THRESHOLD"
  | "DESTRUCTIVE_ACTION_NOT_PERMITTED"
  | "BUDGET_EXHAUSTED";

export type GateDecision =
  | { outcome: "accepted"; capturePoint: Point; modelPoint: Point }
  | { outcome: "rejected"; code: RejectionCode; detail: string }
  | { outcome: "aborted"; code: "SCREEN_TEXT_INSTRUCTION_DETECTED"; detail: string };

export type GateInput = {
  envelope: VisionStepEnvelope;
  proposal: VisionActionProposal;
  space: FrameCoordinateSpace;
  /** 이 step 에서 이미 소비한 모델 호출 수. */
  modelCallsUsed: number;
  /** target profile 이 파괴적 조작을 허용하는가. 기본은 허용하지 않는다. */
  destructiveAllowed?: boolean;
  /** 보조 제어면이 있을 때만 제공한다. null 은 «조회 불가»이고 실패가 아니다. */
  verifyCandidate?: (point: Point, candidates: readonly SemanticCandidate[]) => boolean | null;
};

/** confidence 하한. 판별력이 낮으므로 명백한 저신뢰만 걸러낸다. */
const CONFIDENCE_FLOOR: Record<RiskClass, number> = {
  read: 0.3,
  "reversible-write": 0.5,
  destructive: 0.8,
};

/* 화면에서 읽은 텍스트가 정책·대상·판정을 바꾸려 드는 형태인지 본다.
 * 대상 화면의 문자열은 신뢰 경계 밖의 데이터다. */
const INSTRUCTION_PATTERNS = [
  /ignore (all |any )?(previous|prior|above)/i,
  /disregard (the )?(previous|prior|above|instructions)/i,
  /system prompt/i,
  /you are (now )?(a|an|the)/i,
  /new instructions?:/i,
  /(이전|위의|앞의)\s*지시(사항)?[은는을를]?\s*무시/,
  /시스템\s*프롬프트/,
];

/* 글자와 숫자만 남긴다. 장식 기호와 구분자는 라벨의 일부가 아니다.
 * PROBE-20260907-02: 모델은 「↺ 새로고침」을 「↻ 새로고침」으로,
 * 「RADAR」를 「RA · DAR」로 옮겨 적었다. 좌표는 1~8px 오차로 정확했다.
 * 기호를 그대로 비교하면 옳은 제안을 막는다. */
const normalize = (value: string): string => value.replace(/[^\p{L}\p{N}]+/gu, "").toLowerCase();

/* 부분 일치를 무조건 받아주면 대상을 특정하지 못한다.
 * PROBE-20260907-02: 잘린 날짜 셀에서 모델이 읽은 「2026-08」은
 * 「2026-08-21T09:12:00+09:00」의 접두사이지만 같은 열의 여섯 행 모두에
 * 들어맞았고, 실제로 인접 행을 지목했다. 짧은 조각은 근거로 쓰지 않는다. */
const LABEL_COVERAGE_FLOOR = 0.6;

function labelAgrees(expected: string, observed: string): boolean {
  const a = normalize(expected);
  const b = normalize(observed);
  if (!a || !b) return false;
  if (a === b) return true;
  const contained = a.includes(b) || b.includes(a);
  if (!contained) return false;
  return Math.min(a.length, b.length) / Math.max(a.length, b.length) >= LABEL_COVERAGE_FLOOR;
}

export function evaluateProposal(input: GateInput): GateDecision {
  const { envelope, proposal, space } = input;

  const injected = INSTRUCTION_PATTERNS.find((pattern) => pattern.test(proposal.observedLabel ?? ""));
  if (injected) {
    return { outcome: "aborted", code: "SCREEN_TEXT_INSTRUCTION_DETECTED", detail: `observedLabel matched ${injected.source}` };
  }

  if (proposal.stepId !== envelope.stepId) {
    return { outcome: "rejected", code: "STEP_MISMATCH", detail: proposal.stepId };
  }
  if (input.modelCallsUsed > envelope.budget.maxModelCalls) {
    return { outcome: "rejected", code: "BUDGET_EXHAUSTED", detail: `${input.modelCallsUsed}/${envelope.budget.maxModelCalls}` };
  }
  if (!envelope.allowedActions.includes(proposal.action)) {
    return { outcome: "rejected", code: "ACTION_NOT_ALLOWED", detail: proposal.action };
  }
  if (envelope.riskClass === "destructive" && input.destructiveAllowed !== true) {
    return { outcome: "rejected", code: "DESTRUCTIVE_ACTION_NOT_PERMITTED", detail: envelope.target.elementRef };
  }
  const withinModelFrame =
    Number.isFinite(proposal.point.x) &&
    Number.isFinite(proposal.point.y) &&
    proposal.point.x >= 0 &&
    proposal.point.y >= 0 &&
    proposal.point.x <= space.modelSize.width &&
    proposal.point.y <= space.modelSize.height;
  if (!withinModelFrame) {
    return { outcome: "rejected", code: "LOCUS_OUT_OF_BOUNDS", detail: `${proposal.point.x},${proposal.point.y}` };
  }
  if (proposal.confidence < CONFIDENCE_FLOOR[envelope.riskClass]) {
    return { outcome: "rejected", code: "CONFIDENCE_BELOW_THRESHOLD", detail: String(proposal.confidence) };
  }

  // 라벨 대조는 항상 한다. 대상 서술의 유일한 시각 근거이기 때문이다.
  if (!labelAgrees(envelope.target.visibleLabel, proposal.observedLabel ?? "")) {
    return { outcome: "rejected", code: "OBSERVED_LABEL_MISMATCH", detail: proposal.observedLabel ?? "" };
  }

  const capturePoint = toCaptureSpace(space, proposal.point);

  const verdict =
    input.verifyCandidate && envelope.target.verificationCandidates.length > 0
      ? input.verifyCandidate(capturePoint, envelope.target.verificationCandidates)
      : null;
  // null 은 보조 제어면 조회 불가다. 조회할 수 없는 것을 실패로 만들지 않는다.
  if (verdict === false) {
    return { outcome: "rejected", code: "CANDIDATE_VERIFICATION_FAILED", detail: envelope.target.elementRef };
  }

  // 라벨이 화면에서 유일하지 않으면 라벨 일치는 대상을 특정하지 못한다.
  // 후보 대조가 성공했을 때만 통과시킨다.
  if (!envelope.target.labelUniqueOnSurface && verdict !== true) {
    return { outcome: "rejected", code: "TARGET_NOT_DISAMBIGUATED", detail: envelope.target.elementRef };
  }

  return { outcome: "accepted", capturePoint, modelPoint: { ...proposal.point } };
}
