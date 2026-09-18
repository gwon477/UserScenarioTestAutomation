/* 결정론적 판정. 모델 응답은 관측 후보이고 verdict 는 여기서만 나온다.
 *
 * assertion_refs 는 두 종류가 섞여 들어온다
 * (packages/scenario-pipeline/src/graph/graph-tools.ts 가 그렇게 만든다).
 *  1. edge.feedback ID  -> FactScreen.feedback 의 assertion { kind, expected_shape }
 *  2. 도착 화면 ID       -> «그 화면이 보인다»
 *
 * 설계 근거: docs/architecture/07-vision-first-execution-design.md §6
 */

import type { FactScreen } from "@scenarioforge/contracts";

export type AssertionSpec =
  | { ref: string; kind: "visible-text"; expectedShape: string }
  | { ref: string; kind: "screen-shown"; anchorText: string }
  | { ref: string; kind: "unsupported"; detail: string };

/** observer 가 한 프레임에서 읽어낸 텍스트. 자유 서술은 담지 않는다. */
export type ObservedFrame = { texts: readonly string[] };

export type StepVerdict = "PASSED" | "FAILED" | "INCONCLUSIVE";

export type AssertionResult = { ref: string; verdict: StepVerdict; detail: string };

const normalize = (value: string): string => value.replace(/[^\p{L}\p{N}]+/gu, "").toLowerCase();

function frameHas(frame: ObservedFrame, expected: string): boolean {
  const needle = normalize(expected);
  if (!needle) return false;
  return frame.texts.some((text) => normalize(text).includes(needle));
}

export function resolveAssertions(refs: readonly string[], screens: readonly FactScreen[]): AssertionSpec[] {
  const feedback = new Map(screens.flatMap((screen) => screen.feedback.map((entry) => [entry.id, entry])));
  const displays = new Map(screens.flatMap((screen) => screen.displays.map((entry) => [entry.id, entry])));
  const byScreenId = new Map(screens.map((screen) => [screen.screen_id, screen]));

  return refs.map((ref) => {
    const observed = feedback.get(ref) ?? displays.get(ref);
    if (observed) {
      if (observed.assertion.kind === "visible-text") {
        return { ref, kind: "visible-text", expectedShape: observed.assertion.expected_shape };
      }
      return { ref, kind: "unsupported", detail: `assertion kind ${observed.assertion.kind}` };
    }
    const screen = byScreenId.get(ref);
    if (screen) {
      const anchor = screen.title.trim();
      return anchor
        ? { ref, kind: "screen-shown", anchorText: anchor }
        : { ref, kind: "unsupported", detail: `screen ${ref} has no anchor text` };
    }
    return { ref, kind: "unsupported", detail: `unknown assertion reference ${ref}` };
  });
}

/* frames 는 조작 이후 관측한 순서대로다. 마지막 항목이 가장 최신이다. */
export function evaluateAssertions(specs: readonly AssertionSpec[], frames: readonly ObservedFrame[]): { verdict: StepVerdict; results: AssertionResult[] } {
  if (specs.length === 0) {
    return { verdict: "INCONCLUSIVE", results: [{ ref: "-", verdict: "INCONCLUSIVE", detail: "no assertion to evaluate" }] };
  }
  if (frames.length === 0) {
    return { verdict: "INCONCLUSIVE", results: specs.map((spec) => ({ ref: spec.ref, verdict: "INCONCLUSIVE" as const, detail: "no observation" })) };
  }

  const results = specs.map((spec): AssertionResult => {
    if (spec.kind === "unsupported") {
      // 판정할 수 없는 것은 통과가 아니다.
      return { ref: spec.ref, verdict: "INCONCLUSIVE", detail: spec.detail };
    }
    if (spec.kind === "visible-text") {
      // 불일치는 1회 재관측 뒤 확정한다. 어느 프레임에서든 보이면 통과다.
      const seen = frames.some((frame) => frameHas(frame, spec.expectedShape));
      return seen
        ? { ref: spec.ref, verdict: "PASSED", detail: spec.expectedShape }
        : { ref: spec.ref, verdict: "FAILED", detail: `expected text not observed: ${spec.expectedShape}` };
    }
    // 화면 전이는 연속 두 프레임에서 확인해야 통과다. 한 프레임만 있으면 확정하지 않는다.
    if (frames.length < 2) {
      return { ref: spec.ref, verdict: "INCONCLUSIVE", detail: "screen transition needs two observations" };
    }
    const [previous, latest] = frames.slice(-2);
    if (frameHas(previous, spec.anchorText) && frameHas(latest, spec.anchorText)) {
      return { ref: spec.ref, verdict: "PASSED", detail: spec.anchorText };
    }
    if (!frameHas(previous, spec.anchorText) && !frameHas(latest, spec.anchorText)) {
      return { ref: spec.ref, verdict: "FAILED", detail: `screen anchor not observed: ${spec.anchorText}` };
    }
    // 두 프레임의 관측이 엇갈리면 흔들리는 화면이다. 통과로 만들지 않는다.
    return { ref: spec.ref, verdict: "INCONCLUSIVE", detail: `screen anchor unstable: ${spec.anchorText}` };
  });

  /* 증명된 불일치는 테스트 결과이므로, 다른 항목이 판정 불가여도 FAILED 로 보고한다.
   * 판정 불가만 있는 경우에는 절대 PASSED 로 올리지 않는다. */
  if (results.some((result) => result.verdict === "FAILED")) return { verdict: "FAILED", results };
  if (results.some((result) => result.verdict === "INCONCLUSIVE")) return { verdict: "INCONCLUSIVE", results };
  return { verdict: "PASSED", results };
}
