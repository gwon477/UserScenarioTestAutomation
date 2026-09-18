import type { FactBundle, ScenarioRecord, ScenarioSet } from "@scenarioforge/contracts";
import { loadCanonicalRun, projectTestExecutionRequirements } from "./test-requirements-view";
import { loadScenarioView } from "./scenario-view";
import { loadTestExecutions } from "./test-execution-view";
import type { ScenarioReadinessView } from "../../shared/test-requirements";
import type { TestCaseResult } from "../../shared/test-execution";

/* 시나리오 질의. 정본 run 을 조회하는 tool 하나를 두고, 답변은 그 tool 이
 * 돌려준 사실만으로 만든다.
 *
 * 모르는 것은 모른다고 답한다. 정본에 없는 값을 문장으로 지어내지 않는다.
 * 원천 코드 본문, 프롬프트, 자격증명은 답변에 담지 않는다.
 */

export type ScenarioCaseFacts = {
  scenarioId: string;
  workflow: string;
  workflowGoal: string;
  kind: "normal" | "exception";
  variation: Record<string, string>;
  preconditions: string[];
  path: string[];
  screenTitles: Record<string, string>;
  steps: Array<{
    order: number;
    action: string;
    expected: string;
    edge: string;
    edgeKind: "normal" | "exception";
    guard?: string;
    effect?: string;
    elementLabel?: string;
    riskyWrite: boolean;
    assertions: string[];
  }>;
  readiness?: ScenarioReadinessView;
  lastRun?: {
    executionId: string;
    status: TestCaseResult["status"];
    steps: Array<{ order: number; status: string; reason?: string }>;
  };
};

/** 정본 run 에서 케이스 하나의 사실을 모은다. 이것이 질의가 쓰는 유일한 tool 이다. */
export async function lookupScenarioCase(
  projectRoot: string,
  runId: string,
  scenarioId: string,
): Promise<ScenarioCaseFacts | undefined> {
  const run = await loadCanonicalRun(projectRoot, runId);
  const scenario = run.scenarioSet.scenarios.find((entry) => entry.scenario_id === scenarioId);
  if (!scenario) return undefined;
  /* 업무 분류 이름은 WIKI 가 소유한다. scenario.workflow 는 ID 이고 사람이 읽는
   * 이름이 아니다. 읽지 못하면 ID 를 그대로 쓴다. */
  const goal = await loadScenarioView(projectRoot, runId)
    .then((view) => view.groups.find((group) => group.code === scenario.workflow)?.name)
    .catch(() => undefined);
  return buildFacts(projectRoot, runId, run.facts, run.scenarioSet, scenario, goal ?? scenario.workflow);
}

/** 케이스를 지정하지 않은 질문이 쓰는 run 요약. */
export async function lookupRunOverview(projectRoot: string, runId: string) {
  const run = await loadCanonicalRun(projectRoot, runId);
  const ids = run.scenarioSet.scenarios.map((entry) => entry.scenario_id);
  const requirements = projectTestExecutionRequirements({
    runId,
    scenarioSet: run.scenarioSet,
    facts: run.facts,
    scenarioIds: ids,
  });
  const byWorkflow = new Map<string, number>();
  for (const scenario of run.scenarioSet.scenarios) {
    byWorkflow.set(scenario.workflow, (byWorkflow.get(scenario.workflow) ?? 0) + 1);
  }
  return {
    runId,
    scenarios: ids.length,
    workflows: [...byWorkflow.entries()].map(([workflow, count]) => ({ workflow, count })),
    ready: requirements.scenarios.filter((entry) => entry.state === "ready").length,
    dataRequired: requirements.scenarios.filter((entry) => entry.state === "data-required").length,
    blocked: requirements.scenarios.filter((entry) => entry.state === "blocked").length,
  };
}

const RISKY_ACTION_KINDS = new Set(["submit-order"]);

async function buildFacts(
  projectRoot: string,
  runId: string,
  facts: FactBundle,
  scenarioSet: ScenarioSet,
  scenario: ScenarioRecord,
  workflowGoal: string,
): Promise<ScenarioCaseFacts> {
  const edges = new Map(facts.edges.map((edge) => [edge.edge_id, edge]));
  const elements = new Map(
    facts.screens.flatMap((screen) => screen.elements.map((element) => [element.id, element] as const)),
  );
  const assertionText = new Map<string, string>(
    facts.screens.flatMap((screen) => [
      ...screen.feedback.map((entry) => [entry.id, entry.assertion.expected_shape] as const),
      ...screen.displays.map((entry) => [entry.id, entry.assertion.expected_shape] as const),
      [screen.screen_id, screen.title] as const,
    ]),
  );

  const requirements = projectTestExecutionRequirements({
    runId,
    scenarioSet,
    facts,
    scenarioIds: [scenario.scenario_id],
  });

  /* 마지막 수행 결과. 없으면 없다고 답한다. */
  let lastRun: ScenarioCaseFacts["lastRun"];
  for (const execution of await loadTestExecutions(projectRoot, runId)) {
    const testCase = execution.cases.find((entry) => entry.scenarioId === scenario.scenario_id);
    if (!testCase) continue;
    lastRun = {
      executionId: execution.executionId,
      status: testCase.status,
      steps: testCase.steps.map((step) => ({
        order: step.order,
        status: step.status,
        ...(step.diagnostics?.reason ? { reason: step.diagnostics.reason.code } : {}),
      })),
    };
    break;
  }

  return {
    scenarioId: scenario.scenario_id,
    workflow: scenario.workflow,
    workflowGoal,
    kind: scenario.kind,
    variation: { ...scenario.variation },
    preconditions: scenario.preconditions.map((entry) => entry.text),
    path: [...scenario.path],
    screenTitles: Object.fromEntries(facts.screens.map((screen) => [screen.screen_id, screen.title])),
    steps: scenario.steps.map((step) => {
      const edge = edges.get(step.action_ref.edge);
      const element = elements.get(step.action_ref.element);
      return {
        order: step.n,
        action: step.action,
        expected: step.expected,
        edge: step.action_ref.edge,
        edgeKind: edge?.kind ?? "normal",
        ...(edge?.guard ? { guard: edge.guard } : {}),
        ...(edge?.effect ? { effect: edge.effect } : {}),
        ...(element ? { elementLabel: element.label } : {}),
        riskyWrite: element ? RISKY_ACTION_KINDS.has(element.interaction.action_kind) : false,
        assertions: step.assertion_refs.map((ref) => assertionText.get(ref) ?? ref),
      };
    }),
    ...(requirements.scenarios[0] ? { readiness: requirements.scenarios[0] } : {}),
    ...(lastRun ? { lastRun } : {}),
  };
}

/* ── 답변 ──────────────────────────────────────────────────────────────────
 * tool 이 돌려준 사실만 문장으로 옮긴다. 질문 의도는 낱말로만 좁히고,
 * 의도를 못 읽으면 요약을 준다. 정본에 없으면 없다고 말한다. */

type Intent = "steps" | "exception" | "readiness" | "evidence" | "summary";

/* 좁은 낱말이 먼저다. 「수행 결과가 어떻게 되나요」처럼 두 의도의 낱말이
 * 섞이면 더 구체적인 쪽을 고른다. */
function intentOf(question: string): Intent {
  const text = question.replace(/\s+/g, "");
  if (!text) return "summary";
  if (/실패|예외|분기|오류|막히|안되|위험/.test(text)) return "exception";
  if (/실행가능|준비|자동화|값필요|바인딩|돌릴/.test(text)) return "readiness";
  if (/증적|결과|판정|수행|통과/.test(text)) return "evidence";
  if (/스텝|단계|흐름|절차|어떻게/.test(text)) return "steps";
  return "summary";
}

const stateLabel: Record<ScenarioReadinessView["state"], string> = {
  ready: "실행 가능",
  "data-required": "값 입력 필요",
  blocked: "자동화 불가",
};

function describeSteps(facts: ScenarioCaseFacts): string[] {
  return facts.steps.map((step) => {
    const guard = step.guard ? ` (조건: ${step.guard})` : "";
    const write = step.riskyWrite ? " · 원장에 쓰는 단계" : "";
    return `${String(step.order).padStart(2, "0")}. ${step.action}${guard} → ${step.expected}${write}`;
  });
}

function describeReadiness(facts: ScenarioCaseFacts): string[] {
  const readiness = facts.readiness;
  if (!readiness) return ["실행 준비 상태를 확인할 수 없습니다."];
  const lines = [`실행 준비: ${stateLabel[readiness.state]} · 컴파일된 단계 ${readiness.compiledSteps}개`];
  for (const blocker of readiness.blockers) {
    lines.push(`- ${blocker.stepId} 자동화 불가 (${blocker.reason})`);
  }
  if (readiness.missingBindings.length > 0) {
    lines.push(`- 값이 필요한 입력 ${readiness.missingBindings.length}개. 실행 설정에서 채우면 해소됩니다.`);
  }
  return lines;
}

function describeEvidence(facts: ScenarioCaseFacts): string[] {
  if (!facts.lastRun) return ["아직 이 케이스를 수행한 기록이 없습니다."];
  const lines = [`마지막 수행 ${facts.lastRun.executionId} · 판정 ${facts.lastRun.status}`];
  for (const step of facts.lastRun.steps) {
    lines.push(`- ${String(step.order).padStart(2, "0")} ${step.status}${step.reason ? ` (${step.reason})` : ""}`);
  }
  return lines;
}

function describeException(facts: ScenarioCaseFacts): string[] {
  const lines: string[] = [];
  const exceptionSteps = facts.steps.filter((step) => step.edgeKind === "exception");
  if (exceptionSteps.length > 0) {
    lines.push("예외 분기로 표시된 단계:");
    for (const step of exceptionSteps) {
      lines.push(`- ${String(step.order).padStart(2, "0")} ${step.action}${step.guard ? ` (조건: ${step.guard})` : ""}`);
    }
  }
  const writes = facts.steps.filter((step) => step.riskyWrite);
  if (writes.length > 0) {
    lines.push(`원장에 쓰는 단계 ${writes.length}개는 파괴적 조작 허용 없이는 게이트가 막습니다.`);
  }
  const failed = facts.lastRun?.steps.filter((step) => step.status !== "passed") ?? [];
  if (failed.length > 0) {
    lines.push("마지막 수행에서 통과하지 못한 단계:");
    for (const step of failed) lines.push(`- ${String(step.order).padStart(2, "0")} ${step.status}${step.reason ? ` (${step.reason})` : ""}`);
  }
  if (lines.length === 0) lines.push("예외 분기로 표시된 단계도, 통과하지 못한 단계도 없습니다.");
  return lines;
}

function answerForCase(facts: ScenarioCaseFacts, intent: Intent): string {
  const head = `${facts.scenarioId} · ${facts.workflowGoal} (${facts.kind === "normal" ? "정상" : "예외"})`;
  const body =
    intent === "steps"
      ? describeSteps(facts)
      : intent === "readiness"
        ? describeReadiness(facts)
        : intent === "evidence"
          ? describeEvidence(facts)
          : intent === "exception"
            ? describeException(facts)
            : [
                `여정: ${facts.path.map((screen) => facts.screenTitles[screen] ?? screen).join(" → ")}`,
                `사전 조건: ${facts.preconditions.join(" / ") || "없음"}`,
                `단계 ${facts.steps.length}개 · ${describeReadiness(facts)[0]}`,
                ...(facts.lastRun ? [describeEvidence(facts)[0]!] : ["아직 수행 기록이 없습니다."]),
              ];
  return [head, ...body].join("\n");
}

export async function answerScenarioQuestion(input: {
  projectRoot: string;
  runId: string;
  scenarioIds: readonly string[];
  question: string;
}): Promise<string> {
  const intent = intentOf(input.question);

  if (input.scenarioIds.length === 0) {
    const overview = await lookupRunOverview(input.projectRoot, input.runId);
    return [
      `${overview.runId} · 업무 분류 ${overview.workflows.length}개 · 시나리오 ${overview.scenarios}건`,
      ...overview.workflows.map((entry) => `- ${entry.workflow} ${entry.count}건`),
      `실행 가능 ${overview.ready} · 값 입력 필요 ${overview.dataRequired} · 자동화 불가 ${overview.blocked}`,
      "케이스를 끌어다 놓으면 그 ID 를 기준으로 답변합니다.",
    ].join("\n");
  }

  const answers: string[] = [];
  for (const scenarioId of input.scenarioIds) {
    const facts = await lookupScenarioCase(input.projectRoot, input.runId, scenarioId);
    // 정본에 없는 ID 는 아는 척하지 않는다.
    answers.push(facts ? answerForCase(facts, intent) : `${scenarioId} 는 이 run 의 정본 시나리오에 없습니다.`);
  }
  return answers.join("\n\n");
}

/** 테스트 전용. 질의 의도 판정만 노출한다. */
export const __testing = { intentOf };
