/* 테스트 설정 폼이 물어야 하는 것. main 이 컴파일 결과에서 투영해 전달하고
 * renderer 는 이 값으로 폼을 생성한다. renderer 가 필드 목록을 정하지 않는다.
 *
 * 계약은 docs/screens/04-scenario-results.md 의 «테스트 설정 패널»을 따른다.
 */

export type ScenarioBlockerReason =
  | "EDGE_NOT_FOUND"
  | "ELEMENT_NOT_FOUND"
  | "ACTION_KIND_UNRESOLVED"
  | "ACTION_KIND_UNSUPPORTED"
  | "NO_VISUAL_TARGET_EVIDENCE"
  | "AMBIGUOUS_VISUAL_TARGET"
  | "MISSING_ASSERTION_REFERENCE";

export type ScenarioReadinessState = "ready" | "data-required" | "blocked";

export type ScenarioReadinessView = {
  scenarioId: string;
  state: ScenarioReadinessState;
  compiledSteps: number;
  missingBindings: string[];
  blockers: Array<{ stepId: string; reason: ScenarioBlockerReason; detail: string }>;
};

export type DataBindingFieldView = {
  bindingKey: string;
  label: string;
  controlKind: string;
  secret: boolean;
  usedBy: Array<{ scenarioId: string; stepId: string }>;
};

export type MaskTargetView = {
  elementRef: string;
  label: string;
  screenId: string;
};

export type TestExecutionRequirements = {
  runId: string;
  scenarios: ScenarioReadinessView[];
  dataBindings: DataBindingFieldView[];
  maskDefaults: MaskTargetView[];
  hasDestructiveStep: boolean;
  budgetDefaults: { maxModelCalls: number; maxScreenshots: number; timeoutMs: number };
};

const BLOCKER_REASONS: readonly string[] = [
  "EDGE_NOT_FOUND",
  "ELEMENT_NOT_FOUND",
  "ACTION_KIND_UNRESOLVED",
  "ACTION_KIND_UNSUPPORTED",
  "NO_VISUAL_TARGET_EVIDENCE",
  "AMBIGUOUS_VISUAL_TARGET",
  "MISSING_ASSERTION_REFERENCE",
];

const READINESS_STATES: readonly string[] = ["ready", "data-required", "blocked"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string");

export function isTestExecutionRequirements(value: unknown): value is TestExecutionRequirements {
  if (
    !isRecord(value) ||
    typeof value.runId !== "string" ||
    typeof value.hasDestructiveStep !== "boolean" ||
    !Array.isArray(value.scenarios) ||
    !Array.isArray(value.dataBindings) ||
    !Array.isArray(value.maskDefaults) ||
    !isRecord(value.budgetDefaults) ||
    typeof value.budgetDefaults.maxModelCalls !== "number" ||
    typeof value.budgetDefaults.maxScreenshots !== "number" ||
    typeof value.budgetDefaults.timeoutMs !== "number"
  ) {
    return false;
  }

  const scenariosValid = value.scenarios.every(
    (entry) =>
      isRecord(entry) &&
      typeof entry.scenarioId === "string" &&
      typeof entry.state === "string" &&
      READINESS_STATES.includes(entry.state) &&
      typeof entry.compiledSteps === "number" &&
      isStringArray(entry.missingBindings) &&
      Array.isArray(entry.blockers) &&
      entry.blockers.every(
        (blocker) =>
          isRecord(blocker) &&
          typeof blocker.stepId === "string" &&
          typeof blocker.reason === "string" &&
          BLOCKER_REASONS.includes(blocker.reason) &&
          typeof blocker.detail === "string",
      ),
  );

  const bindingsValid = value.dataBindings.every(
    (entry) =>
      isRecord(entry) &&
      typeof entry.bindingKey === "string" &&
      typeof entry.label === "string" &&
      typeof entry.controlKind === "string" &&
      typeof entry.secret === "boolean" &&
      Array.isArray(entry.usedBy) &&
      entry.usedBy.every(
        (use) => isRecord(use) && typeof use.scenarioId === "string" && typeof use.stepId === "string",
      ),
  );

  const masksValid = value.maskDefaults.every(
    (entry) =>
      isRecord(entry) &&
      typeof entry.elementRef === "string" &&
      typeof entry.label === "string" &&
      typeof entry.screenId === "string",
  );

  return scenariosValid && bindingsValid && masksValid;
}
