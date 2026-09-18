/* 한 step 의 실행 루프. 캡처 -> 제안 -> gate -> 조작 -> 관측 -> 판정.
 *
 * 실제 화면과 모델은 port 로 주입한다. 이 파일에는 Electron 도 HTTP 도 없다.
 * 그래야 루프의 분기를 fake 로 전부 검사할 수 있다.
 *
 * 설계 근거: docs/architecture/07-vision-first-execution-design.md §4 · §5 · §6
 */

import type { FactScreen } from "@scenarioforge/contracts";
import type { FrameCoordinateSpace, FrameSize } from "../planning/frame-coordinate-space.js";
import { createFrameCoordinateSpace } from "../planning/frame-coordinate-space.js";
import type { Point, VisionActionProposal, VisionStepEnvelope } from "../types.js";
import type { AssertionResult, ObservedFrame, StepVerdict } from "./assertion-engine.js";
import { evaluateAssertions, resolveAssertions } from "./assertion-engine.js";
import type { GateDecision, RejectionCode } from "./proposal-gate.js";
import { evaluateProposal } from "./proposal-gate.js";

export type FrameCapture = { pngBase64: string; size: FrameSize };

export type SurfaceAdapter = {
  capture(): Promise<FrameCapture>;
  click(point: Point): Promise<void>;
  type(point: Point, value: string): Promise<void>;
};

export type OperatorModel = {
  /** null 은 «대상을 찾지 못했다»이며 추측이 아니다. */
  propose(input: { pngBase64: string; frameSize: FrameSize; envelope: VisionStepEnvelope }): Promise<VisionActionProposal | null>;
};

export type ObserverModel = {
  observe(input: { pngBase64: string; frameSize: FrameSize; questions: readonly string[] }): Promise<ObservedFrame>;
};

export type FrameKind = "before-action" | "model-input" | "after-action";

export type RecordedFrame = {
  id: string;
  kind: FrameKind;
  round: number;
  relativePath: string;
  size: FrameSize;
};

export type StepRunnerPorts = {
  surface: SurfaceAdapter;
  operator: OperatorModel;
  observer: ObserverModel;
  /** 마스킹 실패는 전송 생략이 아니라 중단이다. null 을 반환한다. */
  maskFrame(capture: FrameCapture): Promise<FrameCapture | null>;
  /** 모델 좌표계로 축소한 프레임. 좌표 환산의 기준이 된다. */
  resizeFrame(capture: FrameCapture, space: FrameCoordinateSpace): Promise<FrameCapture>;
  /** 원문 값은 여기서만 얻고 결과·기록에 담지 않는다. */
  resolveValue?(valueRef: string): Promise<string>;
  /* 증적으로 남길 프레임을 넘긴다. 저장은 호출자가 한다.
   * 모델에 보낸 프레임과 조작 후 관측 프레임을 모두 받는다. */
  recordFrame?(input: { kind: FrameKind; round: number; capture: FrameCapture }): Promise<RecordedFrame>;
};

export type StepAttempt = {
  attempt: number;
  decision: GateDecision;
  /** 모델이 화면에서 읽었다고 보고한 텍스트. 증적의 판정 근거다. */
  observedLabel?: string;
  confidence?: number;
};

export type StepOutcome =
  | {
      status: "completed";
      verdict: StepVerdict;
      attempts: StepAttempt[];
      capturePoint: Point;
      assertions: AssertionResult[];
      /** 조작 후 관측 회차 수. 화면이 늦게 채워졌는지 판단하는 근거다. */
      observations: number;
      frames: RecordedFrame[];
    }
  | { status: "inconclusive"; verdict: "INCONCLUSIVE"; attempts: StepAttempt[]; reason: InconclusiveReason; frames: RecordedFrame[] }
  | { status: "aborted"; verdict: "INCONCLUSIVE"; attempts: StepAttempt[]; reason: AbortReason; frames: RecordedFrame[] };

export type InconclusiveReason =
  | { code: "TARGET_NOT_FOUND"; detail: string }
  | { code: "BUDGET_EXHAUSTED"; detail: string }
  | { code: "ACTION_OUTCOME_UNKNOWN"; detail: string }
  | { code: "GATE_REJECTED"; detail: RejectionCode };

export type AbortReason =
  | { code: "FRAME_MASKING_FAILED"; detail: string }
  | { code: "SCREEN_TEXT_INSTRUCTION_DETECTED"; detail: string }
  | { code: "MISSING_DATA_BINDING"; detail: string };

function assertionQuestions(envelope: VisionStepEnvelope, screens: readonly FactScreen[]): string[] {
  return resolveAssertions(envelope.assertionRefs, screens).map((spec) => {
    if (spec.kind === "visible-text") return spec.expectedShape;
    if (spec.kind === "screen-shown") return spec.anchorText;
    return spec.ref;
  });
}

async function prepareFrame(
  ports: StepRunnerPorts,
  space: FrameCoordinateSpace,
  record: { kind: FrameKind; round: number; frames: RecordedFrame[] },
): Promise<FrameCapture | null> {
  const raw = await ports.surface.capture();
  const masked = await ports.maskFrame(raw);
  if (masked === null) return null;
  const resized = await ports.resizeFrame(masked, space);
  if (ports.recordFrame) {
    record.frames.push(await ports.recordFrame({ kind: record.kind, round: record.round, capture: resized }));
  }
  return resized;
}

export async function runStep(
  envelope: VisionStepEnvelope,
  screens: readonly FactScreen[],
  ports: StepRunnerPorts,
  options?: { destructiveAllowed?: boolean; verifyCandidate?: Parameters<typeof evaluateProposal>[0]["verifyCandidate"] },
): Promise<StepOutcome> {
  const attempts: StepAttempt[] = [];
  const frames: RecordedFrame[] = [];
  const first = await ports.surface.capture();
  const space = createFrameCoordinateSpace(first.size);

  let value: string | undefined;
  if (envelope.valueRef !== undefined) {
    if (!ports.resolveValue) {
      return { status: "aborted", verdict: "INCONCLUSIVE", attempts, frames, reason: { code: "MISSING_DATA_BINDING", detail: envelope.valueRef } };
    }
    value = await ports.resolveValue(envelope.valueRef);
  }

  for (let attempt = 1; attempt <= envelope.budget.maxModelCalls; attempt += 1) {
    const frame = await prepareFrame(ports, space, { kind: "model-input", round: attempt, frames });
    if (frame === null) {
      return { status: "aborted", verdict: "INCONCLUSIVE", attempts, frames, reason: { code: "FRAME_MASKING_FAILED", detail: envelope.stepId } };
    }

    const proposal = await ports.operator.propose({ pngBase64: frame.pngBase64, frameSize: frame.size, envelope });
    if (proposal === null) {
      // 모델이 추측하지 않고 못 찾았다고 답한 것은 정직한 결과다. 실패로 만들지 않는다.
      if (attempt === envelope.budget.maxModelCalls) {
        return { status: "inconclusive", verdict: "INCONCLUSIVE", attempts, frames, reason: { code: "TARGET_NOT_FOUND", detail: envelope.target.visibleLabel } };
      }
      continue;
    }

    const decision = evaluateProposal({
      envelope,
      proposal,
      space,
      modelCallsUsed: attempt,
      ...(options?.destructiveAllowed === undefined ? {} : { destructiveAllowed: options.destructiveAllowed }),
      ...(options?.verifyCandidate === undefined ? {} : { verifyCandidate: options.verifyCandidate }),
    });
    attempts.push({
      attempt,
      decision,
      ...(proposal.observedLabel === undefined ? {} : { observedLabel: proposal.observedLabel }),
      confidence: proposal.confidence,
    });

    if (decision.outcome === "aborted") {
      return { status: "aborted", verdict: "INCONCLUSIVE", attempts, frames, reason: { code: decision.code, detail: decision.detail } };
    }
    if (decision.outcome === "rejected") {
      if (attempt === envelope.budget.maxModelCalls) {
        return { status: "inconclusive", verdict: "INCONCLUSIVE", attempts, frames, reason: { code: "GATE_REJECTED", detail: decision.code } };
      }
      continue;
    }

    /* 조작은 여기서 한 번만 일어난다. 실패가 부작용을 남겼는지 알 수 없으면
     * 같은 action 을 다시 시도하지 않는다. */
    try {
      if (value === undefined) await ports.surface.click(decision.capturePoint);
      else await ports.surface.type(decision.capturePoint, value);
    } catch (error) {
      return {
        status: "inconclusive",
        verdict: "INCONCLUSIVE",
        attempts,
        frames,
        reason: { code: "ACTION_OUTCOME_UNKNOWN", detail: error instanceof Error ? error.message : String(error) },
      };
    }

    /* 조작 후 관측. 화면 전이는 연속 두 관측이 일치해야 확정된다.
     * 데이터를 늦게 채우는 화면은 부재 -> 존재로 넘어가므로 처음 두 장만 보면
     * 로딩을 «불안정»으로 오판한다. maxScreenshots 안에서 확정될 때까지 다시 본다.
     * PROBE-20260907-04 에서 실제로 첫 관측이 비어 있고 두 번째에 나타났다. */
    const questions = assertionQuestions(envelope, screens);
    const specs = resolveAssertions(envelope.assertionRefs, screens);
    const observations: ObservedFrame[] = [];
    let evaluated = evaluateAssertions(specs, observations);
    for (let round = 0; round < Math.max(2, envelope.budget.maxScreenshots); round += 1) {
      const after = await prepareFrame(ports, space, { kind: "after-action", round: round + 1, frames });
      if (after === null) {
        return { status: "aborted", verdict: "INCONCLUSIVE", attempts, frames, reason: { code: "FRAME_MASKING_FAILED", detail: envelope.stepId } };
      }
      observations.push(await ports.observer.observe({ pngBase64: after.pngBase64, frameSize: after.size, questions }));
      if (observations.length < 2) continue;
      evaluated = evaluateAssertions(specs, observations);
      // 확정된 판정은 더 보지 않는다. 판정 불가만 예산 안에서 재관측한다.
      if (evaluated.verdict !== "INCONCLUSIVE") break;
    }

    return {
      status: "completed",
      verdict: evaluated.verdict,
      attempts,
      capturePoint: decision.capturePoint,
      assertions: evaluated.results,
      observations: observations.length,
      frames,
    };
  }

  return { status: "inconclusive", verdict: "INCONCLUSIVE", attempts, frames, reason: { code: "BUDGET_EXHAUSTED", detail: envelope.stepId } };
}
