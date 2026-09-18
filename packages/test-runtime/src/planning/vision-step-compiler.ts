/* ScenarioRecord + FACT 를 비전 실행용 step envelope 으로 컴파일한다.
 *
 * 경계: 이 컴파일러는 생성 계층 산출물을 읽기만 한다. ID, evidence,
 * target_candidates 를 만들거나 바꾸지 않는다. 사람이 읽는 action·expected 는
 * 실행 지시로 파싱하지 않는다.
 *
 * 설계 근거: docs/architecture/07-vision-first-execution-design.md §2 · §3
 */

import type { FactEdge, FactElement, FactScreen, ScenarioRecord } from "@scenarioforge/contracts";
import type {
  ActionIntent,
  NonAutomatableStep,
  RiskClass,
  VisionActionKind,
  VisionStepEnvelope,
  VisualTargetDescriptor,
} from "../types.js";

export type CompileInput = {
  scenario: ScenarioRecord;
  screens: readonly FactScreen[];
  edges: readonly FactEdge[];
  /** step 이 소비할 값의 참조 키. 없으면 값이 필요한 step 은 자동화 대상이 아니다. */
  dataBindingKeys?: readonly string[];
  budget?: VisionStepEnvelope["budget"];
};

export type CompileResult = {
  scenarioId: string;
  envelopes: readonly VisionStepEnvelope[];
  nonAutomatable: readonly NonAutomatableStep[];
};

/* 한 step 의 상한. 모델 호출 3회는 제안 1회 + 거절 후 재제안 2회를 덮고,
 * 관측 4회는 화면이 늦게 채워지는 전환을 「연속 2회 일치」로 확정할 여유를 준다.
 *
 * 45초는 실측에서 왔다. 30초에서는 진입 화면이 그려지기 전에 첫 관측이 끝나
 * 대상을 못 찾는 사례가 있었다. */
export const DEFAULT_STEP_BUDGET: VisionStepEnvelope["budget"] = { maxModelCalls: 3, maxScreenshots: 4, timeoutMs: 45_000 };

/** FACT action_kind 에서 실행 의도로의 유일한 매핑. 여기 없는 값은 추측하지 않는다. */
const ACTION_KIND_MAP: Record<string, { intent: ActionIntent["kind"]; actions: readonly VisionActionKind[]; risk: RiskClass; needsValue: boolean }> = {
  click: { intent: "press", actions: ["click"], risk: "reversible-write", needsValue: false },
  toggle: { intent: "press", actions: ["click"], risk: "reversible-write", needsValue: false },
  navigate: { intent: "navigate", actions: ["click"], risk: "read", needsValue: false },
  fill: { intent: "fill", actions: ["type", "clear"], risk: "reversible-write", needsValue: true },
  select: { intent: "select", actions: ["selectOption", "click"], risk: "reversible-write", needsValue: true },
  upload: { intent: "upload", actions: ["click"], risk: "reversible-write", needsValue: true },
  submit: { intent: "press", actions: ["click"], risk: "reversible-write", needsValue: false },
  "submit-login": { intent: "press", actions: ["click"], risk: "reversible-write", needsValue: false },
  "submit-order": { intent: "press", actions: ["click"], risk: "destructive", needsValue: false },
  authenticate: { intent: "press", actions: ["click"], risk: "reversible-write", needsValue: false },
  logout: { intent: "press", actions: ["click"], risk: "reversible-write", needsValue: false },
  download: { intent: "press", actions: ["click"], risk: "read", needsValue: false },
  "download-csv": { intent: "press", actions: ["click"], risk: "read", needsValue: false },
};

function findElement(screens: readonly FactScreen[], elementId: string): { screen: FactScreen; element: FactElement } | undefined {
  for (const screen of screens) {
    const element = screen.elements.find((candidate) => candidate.id === elementId);
    if (element) return { screen, element };
  }
  return undefined;
}

/** 화면에 보이는 텍스트만 대상 서술에 쓴다. 비전 모델은 보이지 않는 라벨을 읽지 못한다. */
function visibleLabel(element: FactElement): string | undefined {
  const label = element.label.trim();
  return label && label !== "unresolved" ? label : undefined;
}

function ambiguityRisk(candidateCount: number, labelUnique: boolean): VisualTargetDescriptor["ambiguityRisk"] {
  if (labelUnique && candidateCount > 0) return "low";
  if (labelUnique) return "medium";
  return "high";
}

/* PROBE-20260907-02: 실패의 실제 원인은 그라운딩 정확도가 아니라 라벨이
 * 대상을 특정하지 못하는 경우였다. 같은 열의 잘린 날짜 셀과 접미사만 다른
 * 행 버튼에서 모델이 인접 행을 지목했다. 같은 화면에 같은 라벨이 여러 개면
 * 라벨 일치는 필요 조건일 뿐 충분 조건이 아니다. */
function labelIsUniqueOnScreen(screen: FactScreen, elementId: string, label: string): boolean {
  const target = normalizeLabel(label);
  return !screen.elements.some((candidate) => candidate.id !== elementId && normalizeLabel(visibleLabel(candidate) ?? "") === target);
}

const normalizeLabel = (value: string): string => value.replace(/\s+/g, "").toLowerCase();

function buildIntent(kind: ActionIntent["kind"], edge: FactEdge, valueRef: string | undefined): ActionIntent {
  if (kind === "navigate") return { kind, destinationRef: edge.to };
  if (kind === "press" || kind === "fill" || kind === "select" || kind === "upload") {
    return valueRef === undefined ? { kind } : { kind, valueRef };
  }
  return { kind } as ActionIntent;
}

export function compileVisionSteps(input: CompileInput): CompileResult {
  const { scenario, screens, edges } = input;
  const edgeById = new Map(edges.map((edge) => [edge.edge_id, edge]));
  const bindingKeys = new Set(input.dataBindingKeys ?? []);
  const budget = input.budget ?? DEFAULT_STEP_BUDGET;
  const envelopes: VisionStepEnvelope[] = [];
  const nonAutomatable: NonAutomatableStep[] = [];

  for (const step of scenario.steps) {
    const stepId = `${scenario.scenario_id}#${step.n}`;
    const actionRef = step.action_ref.edge;
    const reject = (reason: NonAutomatableStep["reason"], detail: string) => nonAutomatable.push({ stepId, actionRef, reason, detail });

    if (step.assertion_refs.length === 0) {
      reject("MISSING_ASSERTION_REFERENCE", "step has no assertion reference to evaluate");
      continue;
    }
    const edge = edgeById.get(step.action_ref.edge);
    if (!edge) {
      reject("EDGE_NOT_FOUND", step.action_ref.edge);
      continue;
    }
    const located = findElement(screens, step.action_ref.element);
    if (!located) {
      reject("ELEMENT_NOT_FOUND", step.action_ref.element);
      continue;
    }
    const actionKind = located.element.interaction.action_kind;
    if (actionKind === "unresolved") {
      reject("ACTION_KIND_UNRESOLVED", located.element.id);
      continue;
    }
    const mapped = ACTION_KIND_MAP[actionKind];
    if (!mapped) {
      reject("ACTION_KIND_UNSUPPORTED", actionKind);
      continue;
    }
    const label = visibleLabel(located.element);
    const candidates = located.element.interaction.target_candidates;
    // 비전 경로는 화면에서 읽을 수 있는 라벨이 있어야 대상을 지목할 수 있다.
    // target_candidates 는 사후 대조용이며 대상을 찾는 근거가 아니다.
    if (label === undefined) {
      reject("NO_VISUAL_TARGET_EVIDENCE", located.element.id);
      continue;
    }
    const labelUnique = labelIsUniqueOnScreen(located.screen, located.element.id, label);
    // 라벨이 대상을 특정하지 못하고 대조할 후보도 없으면 실행 시점에 구별할
    // 방법이 없다. 사람 확인으로 넘긴다.
    if (!labelUnique && candidates.length === 0) {
      reject("AMBIGUOUS_VISUAL_TARGET", `${located.element.id} shares its visible label on ${located.screen.screen_id}`);
      continue;
    }
    // 값이 필요한 step 에 참조 키가 없으면 값을 지어내지 않고 사람에게 넘긴다.
    // ScenarioRecord 는 아직 step 단위 data_binding_keys 를 싣지 않는다.
    const valueRef = mapped.needsValue
      ? [...bindingKeys].find((key) => key === located.element.id || key.endsWith(`:${located.element.id}`))
      : undefined;
    if (mapped.needsValue && valueRef === undefined) {
      reject("MISSING_DATA_BINDING", located.element.id);
      continue;
    }

    envelopes.push({
      stepId,
      actionRef,
      assertionRefs: [...step.assertion_refs],
      intent: buildIntent(mapped.intent, edge, valueRef),
      allowedActions: [...mapped.actions],
      target: {
        descriptorId: `VTD-${scenario.scenario_id}-${step.n}`,
        elementRef: located.element.id,
        visibleLabel: label,
        controlKind: located.element.type,
        surfaceHint: located.screen.route ?? located.screen.title,
        verificationCandidates: candidates,
        labelUniqueOnSurface: labelUnique,
        ambiguityRisk: ambiguityRisk(candidates.length, labelUnique),
      },
      ...(valueRef === undefined ? {} : { valueRef }),
      budget,
      riskClass: mapped.risk,
    });
  }

  return { scenarioId: scenario.scenario_id, envelopes, nonAutomatable };
}
