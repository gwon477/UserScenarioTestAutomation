import type { TestExecutionRequest } from "../../shared/desktop-api";
import type { TestExecutionRequirements } from "../../shared/test-requirements";

/* 실행 명령 검증. renderer 가 보낸 관계를 신뢰하지 않고 정본에서 도출한
 * 요구사항과만 대조한다. 계약은 docs/screens/04-scenario-results.md 를 따른다. */

export type CommandRejection = {
  stage: "request" | "environment" | "planning";
  code: string;
  detail?: string;
  scenarioIds?: string[];
};

function isHttpUrl(value: string): boolean {
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

export function validateExecutionCommand(input: {
  requirements: TestExecutionRequirements;
  request: Pick<TestExecutionRequest, "scenarioIds" | "targetUrl" | "dataBindings" | "maskElementRefs" | "destructiveAllowed">;
}): CommandRejection | null {
  const { requirements, request } = input;

  if (request.scenarioIds.length === 0) return { stage: "request", code: "SCENARIO_SELECTION_EMPTY" };
  if (!isHttpUrl(request.targetUrl)) return { stage: "request", code: "TARGET_ENTRY_INVALID" };

  const blocked = requirements.scenarios.filter((entry) => entry.blockers.length > 0);
  if (blocked.length === requirements.scenarios.length) {
    return { stage: "planning", code: "NO_RUNNABLE_SCENARIO", scenarioIds: blocked.map((entry) => entry.scenarioId) };
  }

  const supplied = new Set(
    Object.entries(request.dataBindings)
      .filter(([, value]) => typeof value === "string" && value.trim().length > 0)
      .map(([key]) => key),
  );
  const missing = requirements.dataBindings.map((field) => field.bindingKey).filter((key) => !supplied.has(key));
  if (missing.length > 0) return { stage: "request", code: "DATA_BINDING_MISSING", detail: missing.join(", ") };

  const declared = new Set(requirements.maskDefaults.map((mask) => mask.elementRef));
  const requested = new Set(request.maskElementRefs);
  // 가려야 할 대상을 빼고 실행할 수 없다. 마스킹 실패는 실행 중단 사유다.
  const omitted = [...declared].filter((ref) => !requested.has(ref));
  if (omitted.length > 0) return { stage: "request", code: "MASK_TARGET_OMITTED", detail: omitted.join(", ") };
  const unknown = [...requested].filter((ref) => !declared.has(ref));
  if (unknown.length > 0) return { stage: "request", code: "MASK_TARGET_NOT_DECLARED", detail: unknown.join(", ") };

  if (requirements.hasDestructiveStep && !request.destructiveAllowed) {
    return { stage: "request", code: "DESTRUCTIVE_NOT_ALLOWED" };
  }

  return null;
}
