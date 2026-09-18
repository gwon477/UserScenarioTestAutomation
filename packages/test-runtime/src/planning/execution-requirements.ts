/* 실행 요청 폼이 무엇을 물어야 하는지 컴파일 결과에서 도출한다.
 *
 * 폼을 손으로 설계하지 않는다는 명세(docs/screens/04-scenario-results.md)의
 * 구현 지점이다. 컴파일러가 step 단위로 무엇이 부족한지 이미 확정하므로
 * 여기서는 그것을 «물어야 할 것»과 «못 고르는 이유»로 옮긴다.
 */

import type { FactEdge, FactElement, FactScreen, ScenarioRecord } from "@scenarioforge/contracts";
import type { NonAutomatableStep, SemanticCandidate, StepBudget } from "../types.js";
import { compileVisionSteps, DEFAULT_STEP_BUDGET } from "./vision-step-compiler.js";

/** 사용자에게 물어야 하는 값 하나. */
export type DataBindingField = {
  bindingKey: string;
  elementRef: string;
  /** 화면에 보이는 라벨. 사용자가 어느 입력인지 알아보는 근거다. */
  label: string;
  controlKind: string;
  /** password 계열이면 마스킹 입력으로 받고 화면에 되돌려 표시하지 않는다. */
  secret: boolean;
  usedBy: ReadonlyArray<{ scenarioId: string; stepId: string }>;
};

/** 프레임 전송 전에 가려야 하는 대상. 기본값이며 사용자가 확인·추가한다. */
export type MaskTargetDefault = {
  elementRef: string;
  label: string;
  screenId: string;
  candidates: readonly SemanticCandidate[];
};

export type ScenarioReadinessState = "ready" | "data-required" | "blocked";

export type ScenarioReadiness = {
  scenarioId: string;
  state: ScenarioReadinessState;
  compiledSteps: number;
  /** 사용자가 값을 넣으면 해소되는 항목. */
  missingBindings: readonly string[];
  /** 사용자가 입력으로 해소할 수 없는 항목. */
  blockers: readonly NonAutomatableStep[];
};

export type ExecutionRequirements = {
  scenarios: readonly ScenarioReadiness[];
  dataBindings: readonly DataBindingField[];
  maskDefaults: readonly MaskTargetDefault[];
  /** 파괴적 step이 없으면 허용 체크박스를 표시하지 않는다. */
  hasDestructiveStep: boolean;
  budgetDefaults: StepBudget;
};

const isSecretControl = (controlKind: string): boolean => /password|secret|credential/i.test(controlKind);

function locate(screens: readonly FactScreen[], elementRef: string): { screen: FactScreen; element: FactElement } | undefined {
  for (const screen of screens) {
    const element = screen.elements.find((candidate) => candidate.id === elementRef);
    if (element) return { screen, element };
  }
  return undefined;
}

export function deriveExecutionRequirements(input: {
  scenarios: readonly ScenarioRecord[];
  screens: readonly FactScreen[];
  edges: readonly FactEdge[];
  /** 이미 값이 채워진 binding key. 채워진 것은 다시 묻지 않는다. */
  providedBindingKeys?: readonly string[];
  budget?: StepBudget;
}): ExecutionRequirements {
  const provided = new Set(input.providedBindingKeys ?? []);
  const budget = input.budget ?? DEFAULT_STEP_BUDGET;
  const readiness: ScenarioReadiness[] = [];
  const fieldByKey = new Map<string, DataBindingField & { usedBy: Array<{ scenarioId: string; stepId: string }> }>();
  const maskByRef = new Map<string, MaskTargetDefault>();
  let hasDestructiveStep = false;

  for (const scenario of input.scenarios) {
    const compiled = compileVisionSteps({
      scenario,
      screens: input.screens,
      edges: input.edges,
      dataBindingKeys: [...provided],
      budget,
    });

    const missing: string[] = [];
    const blockers: NonAutomatableStep[] = [];
    for (const entry of compiled.nonAutomatable) {
      if (entry.reason === "MISSING_DATA_BINDING") {
        missing.push(entry.detail);
        const located = locate(input.screens, entry.detail);
        const existing = fieldByKey.get(entry.detail);
        if (existing) existing.usedBy.push({ scenarioId: scenario.scenario_id, stepId: entry.stepId });
        else if (located) {
          fieldByKey.set(entry.detail, {
            bindingKey: entry.detail,
            elementRef: located.element.id,
            label: located.element.label,
            controlKind: located.element.type,
            secret: isSecretControl(located.element.type),
            usedBy: [{ scenarioId: scenario.scenario_id, stepId: entry.stepId }],
          });
        }
        continue;
      }
      blockers.push(entry);
    }

    for (const envelope of compiled.envelopes) {
      if (envelope.riskClass === "destructive") hasDestructiveStep = true;
      // 비밀값을 입력하는 대상은 프레임에서 가려야 한다.
      if (!isSecretControl(envelope.target.controlKind)) continue;
      const located = locate(input.screens, envelope.target.elementRef);
      if (!located || maskByRef.has(envelope.target.elementRef)) continue;
      maskByRef.set(envelope.target.elementRef, {
        elementRef: located.element.id,
        label: located.element.label,
        screenId: located.screen.screen_id,
        candidates: located.element.interaction.target_candidates,
      });
    }

    readiness.push({
      scenarioId: scenario.scenario_id,
      state: blockers.length > 0 ? "blocked" : missing.length > 0 ? "data-required" : "ready",
      compiledSteps: compiled.envelopes.length,
      missingBindings: missing,
      blockers,
    });
  }

  // 값이 필요한 대상도 마스킹 후보다. 컴파일이 거부돼 envelope 이 없어도 놓치지 않는다.
  for (const field of fieldByKey.values()) {
    if (!field.secret || maskByRef.has(field.elementRef)) continue;
    const located = locate(input.screens, field.elementRef);
    if (!located) continue;
    maskByRef.set(field.elementRef, {
      elementRef: located.element.id,
      label: located.element.label,
      screenId: located.screen.screen_id,
      candidates: located.element.interaction.target_candidates,
    });
  }

  return {
    scenarios: readiness,
    dataBindings: [...fieldByKey.values()],
    maskDefaults: [...maskByRef.values()],
    hasDestructiveStep,
    budgetDefaults: budget,
  };
}
