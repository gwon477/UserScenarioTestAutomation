/* 수행 계층이 소유하는 타입. 생성 계층의 canonical 타입은
 * @scenarioforge/contracts 에서 읽기만 한다.
 *
 * 설계 근거: docs/architecture/07-vision-first-execution-design.md
 */

import type { SourceInteractionRecord } from "@scenarioforge/contracts";

export type SemanticCandidate = SourceInteractionRecord["target_candidates"][number];

export type ActionIntent =
  | { kind: "launch" | "activate" | "close" }
  | { kind: "navigate"; destinationRef: string }
  | { kind: "press" | "fill" | "select" | "upload"; valueRef?: string }
  | { kind: "scroll" | "drag"; direction?: "up" | "down" | "left" | "right" }
  | { kind: "keyChord"; keyRef: string }
  | { kind: "back" | "home" | "switchContext" }
  | { kind: "wait" | "observe" };

export type VisionActionKind =
  | "click"
  | "doubleClick"
  | "rightClick"
  | "type"
  | "clear"
  | "selectOption"
  | "scroll"
  | "drag"
  | "keyChord"
  | "wait"
  | "observe";

export type RiskClass = "read" | "reversible-write" | "destructive";

/** 모델에게 «화면에서 무엇을 찾을지» 알려주는 고정 서술. 컴파일러만 만든다. */
export type VisualTargetDescriptor = {
  descriptorId: string;
  elementRef: string;
  /* 화면에 실제로 보이는 텍스트. 필수다.
   * PROBE-20260907-02: aria-label 만 있고 화면에 글자가 없는 아이콘 버튼은
   * 모델이 전부 «못 찾았다»고 답했다. 읽을 수 없는 라벨로는 대상을 지목할 수
   * 없으므로 비전 경로의 대상이 될 수 없다. */
  visibleLabel: string;
  controlKind: string;
  surfaceHint: string;
  /** 조작용이 아니라 제안 사후 대조용이다. */
  verificationCandidates: readonly SemanticCandidate[];
  /** 같은 화면에서 이 라벨이 유일한가. false 면 라벨 일치만으로 대상을 특정할 수 없다. */
  labelUniqueOnSurface: boolean;
  ambiguityRisk: "low" | "medium" | "high";
};

export type StepBudget = {
  maxModelCalls: number;
  maxScreenshots: number;
  timeoutMs: number;
};

export type VisionStepEnvelope = {
  stepId: string;
  actionRef: string;
  assertionRefs: readonly string[];
  intent: ActionIntent;
  /** 고정 화이트리스트. 모델은 이 밖의 action을 실행시킬 수 없다. */
  allowedActions: readonly VisionActionKind[];
  target: VisualTargetDescriptor;
  valueRef?: string;
  budget: StepBudget;
  riskClass: RiskClass;
};

export type Point = { x: number; y: number };

export type VisionActionProposal = {
  stepId: string;
  action: VisionActionKind;
  /** 이번 프레임 한정 관측값. canonical locator로 저장하지 않는다. */
  point: Point;
  observedLabel?: string;
  confidence: number;
};

/** 컴파일이 불가능해 사람 확인으로 넘긴 step. 모델에게 추측을 맡기지 않는다. */
export type NonAutomatableStep = {
  stepId: string;
  actionRef: string;
  reason:
    | "EDGE_NOT_FOUND"
    | "ELEMENT_NOT_FOUND"
    | "ACTION_KIND_UNRESOLVED"
    | "ACTION_KIND_UNSUPPORTED"
    | "NO_VISUAL_TARGET_EVIDENCE"
    | "AMBIGUOUS_VISUAL_TARGET"
    | "MISSING_ASSERTION_REFERENCE"
    | "MISSING_DATA_BINDING";
  detail: string;
};
