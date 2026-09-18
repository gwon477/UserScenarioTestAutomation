/* 실측 응답 replay. 기록된 모델 제안을 실제 gate 에 통과시켜
 * gate 가 어떤 잘못된 제안을 막고 어떤 옳은 제안을 통과시키는지 고정한다.
 *
 * 데이터: docs/validation/vision-execution-grounding/PROBE-20260907-02
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createFrameCoordinateSpace } from "../planning/frame-coordinate-space.js";
import type { VisionStepEnvelope } from "../types.js";
import { evaluateProposal } from "./proposal-gate.js";

type RecordedTarget = {
  outcome: "hit" | "miss" | "not-found";
  visibleLabel: string;
  controlKind: string;
  point?: { x: number; y: number };
  observedLabel?: string;
  confidence: number | null;
  centerDistancePx?: number;
};

type RecordedProbe = {
  screens: Array<{ screenId: string; targets?: RecordedTarget[] }>;
};

const PROBE_DIR = join(import.meta.dirname, "../../../../docs/validation/vision-execution-grounding/PROBE-20260907-02");

function loadTargets(file: string): Array<{ screenId: string; target: RecordedTarget }> {
  const probe = JSON.parse(readFileSync(join(PROBE_DIR, file), "utf8")) as RecordedProbe;
  return probe.screens.flatMap((screen) => (screen.targets ?? []).map((target) => ({ screenId: screen.screenId, target })));
}

function envelopeFor(target: RecordedTarget, screenId: string): VisionStepEnvelope {
  return {
    stepId: "SCN-replay#1",
    actionRef: "E-replay",
    assertionRefs: ["ASRT-replay"],
    intent: { kind: "press" },
    allowedActions: ["click"],
    target: {
      descriptorId: "VTD-replay",
      elementRef: "EL-replay",
      visibleLabel: target.visibleLabel,
      controlKind: target.controlKind,
      surfaceHint: screenId,
      verificationCandidates: [],
      labelUniqueOnSurface: true,
      ambiguityRisk: "low",
    },
    budget: { maxModelCalls: 3, maxScreenshots: 4, timeoutMs: 30_000 },
    riskClass: "reversible-write",
  };
}

function replay(file: string) {
  const space = createFrameCoordinateSpace({ width: 1440, height: 900 });
  const rows = loadTargets(file).filter((row) => row.target.outcome !== "not-found");
  let acceptedHit = 0;
  const acceptedMiss: string[] = [];
  const rejectedHit: string[] = [];

  for (const { screenId, target } of rows) {
    const decision = evaluateProposal({
      envelope: envelopeFor(target, screenId),
      proposal: {
        stepId: "SCN-replay#1",
        action: "click",
        point: target.point ?? { x: -1, y: -1 },
        ...(target.observedLabel === undefined ? {} : { observedLabel: target.observedLabel }),
        confidence: target.confidence ?? 0,
      },
      space,
      modelCallsUsed: 1,
    });
    const accepted = decision.outcome === "accepted";
    if (accepted && target.outcome === "hit") acceptedHit += 1;
    if (accepted && target.outcome === "miss") acceptedMiss.push(`${screenId}:${target.visibleLabel}`);
    if (!accepted && target.outcome === "hit") rejectedHit.push(`${screenId}:${target.visibleLabel}`);
  }

  return { total: rows.length, acceptedHit, acceptedMiss, rejectedHit };
}

describe("proposal gate against recorded model output", () => {
  it("lets almost every correctly grounded AXSE proposal through", () => {
    const result = replay("axse-768.json");

    expect(result.total).toBe(39);
    expect(result.acceptedHit).toBe(36);
    // 「업무」 버튼은 35x25px 이고 모델이 30px 어긋났지만 라벨은 정확히 읽었다.
    // 라벨 대조로는 걸러지지 않는, 작은 대상의 남은 한계다.
    expect(result.acceptedMiss).toEqual(["06-main-parsed-db:업무"]);
    // 두 건은 입력이 채워진 뒤 사라진 placeholder 를 라벨로 삼은 서술이다.
    // 화면에 없는 글자를 기대했으므로 거부가 옳다.
    expect(result.rejectedHit).toEqual([
      "02-login-form-filled:아이디를 입력하세요",
      "02-login-form-filled:패스워드를 입력하세요",
    ]);
  });

  it("blocks every RA-DAR proposal that pointed at the wrong place", () => {
    const result = replay("ra-dar-768.json");

    expect(result.total).toBe(25);
    expect(result.acceptedHit).toBe(17);
    // 인접 행을 지목한 제안과 잘린 날짜 셀 제안이 모두 걸러졌다.
    expect(result.acceptedMiss).toEqual([]);
    // 남은 세 건은 화면에 보이지 않는 라벨을 기대한 서술이다.
    // aria-label 만 있는 아이콘 버튼과 select 의 옵션 전체 텍스트다.
    expect(result.rejectedHit).toEqual([
      "06-ledger:표시할 열 설정",
      "06-ledger:유형법률대통령령총리령부령고시훈령예규지침안내서기타국가표준",
      "07-ledger-status-filter:유형법률대통령령총리령부령고시훈령예규지침안내서기타국가표준",
    ]);
  });

  it("rejects the near-identical row control the model confused", () => {
    const rows = loadTargets("ra-dar-768.json");
    const confused = rows.find((row) => row.target.visibleLabel === "RA-2026-002 변경사항 반영");
    expect(confused).toBeDefined();
    expect(confused?.target.observedLabel).toBe("RA-2026-001 변경사항 반영");

    const decision = evaluateProposal({
      envelope: envelopeFor(confused!.target, confused!.screenId),
      proposal: {
        stepId: "SCN-replay#1",
        action: "click",
        point: confused!.target.point!,
        observedLabel: confused!.target.observedLabel!,
        confidence: confused!.target.confidence ?? 0,
      },
      space: createFrameCoordinateSpace({ width: 1440, height: 900 }),
      modelCallsUsed: 1,
    });

    expect(decision).toMatchObject({ outcome: "rejected", code: "OBSERVED_LABEL_MISMATCH" });
  });

  it("does not rely on confidence, which the probe showed has no discriminating power", () => {
    const rows = loadTargets("ra-dar-768.json").filter((row) => row.target.outcome !== "not-found");
    const hits = rows.filter((row) => row.target.outcome === "hit").map((row) => row.target.confidence ?? 0);
    const misses = rows.filter((row) => row.target.outcome === "miss").map((row) => row.target.confidence ?? 0);

    // 두 분포가 겹친다. 어떤 임계값도 hit 과 miss 를 가르지 못한다.
    expect(Math.min(...hits)).toBeLessThanOrEqual(Math.max(...misses));
    expect(Math.max(...misses)).toBeGreaterThanOrEqual(0.78);
  });
});
