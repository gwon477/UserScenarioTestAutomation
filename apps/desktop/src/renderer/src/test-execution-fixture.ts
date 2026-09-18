import type {
  EvidenceLibraryEntry,
  EvidenceLibraryView,
} from "../../shared/evidence-library";
import type { ProjectSummary } from "../../shared/projects";
import type {
  StepDiagnostics,
  StepEvidence,
  TestCaseResult,
  TestExecution,
  TestStepStatus,
} from "../../shared/test-execution";
import { createDemoScenarioResult } from "./scenario-result";

/* 시연용 표본 실행. 실제 수행 증적이 아니다.
 *
 * 정본 실행 트리(`runs/<RUN>/tests/...`)를 읽지 않고 renderer 안에서 조립한다.
 * preview 경로에서만 쓰고, 화면에는 표본임을 함께 표시한다.
 */

const targetUrl = "https://ra-dar.staging.internal/ledger";

/* 증적 판정별 캡처 구성은 `isValidStepEvidence` 계약을 따른다.
 * 성공은 완료 프레임 하나, 실패는 완료·직전·실패 세 프레임과 오류를 요구한다. */
function createEvidence(
  executionId: string,
  scenarioId: string,
  stepOrder: number,
  status: "passed" | "failed" | "inconclusive",
  action: string,
  expected: string,
): StepEvidence {
  const frame = (
    kind: "action-complete" | "before-failure" | "failure",
    capturedAt: string,
    label: string,
  ) => ({
    id: `${scenarioId}-${stepOrder}-${kind}`,
    kind,
    capturedAt,
    relativePath: `evidence/${scenarioId}/${stepOrder}-${kind}.png`,
    mimeType: "image/png" as const,
    width: 1440,
    height: 900,
    label,
  });

  if (status === "failed") {
    return {
      evidenceId: `EVD-${executionId.slice(-4)}-${scenarioId}-${stepOrder}`,
      executionId,
      scenarioId,
      stepOrder,
      status,
      action,
      expected,
      actual:
        "검색어를 입력했지만 원장 목록이 갱신되지 않고 이전 결과가 그대로 남았습니다. 목록 조회 요청이 504로 끊겼습니다.",
      captures: [
        frame("action-complete", "2026-09-08T08:12:31.104Z", "이전 단계 완료"),
        frame("before-failure", "2026-09-08T08:12:44.887Z", "실패 직전"),
        frame("failure", "2026-09-08T08:12:45.203Z", "실패 시점"),
      ],
      error: {
        category: "target.network",
        code: "LEDGER_QUERY_TIMEOUT",
        message: "GET /api/ledger?q=… 응답 504 · Gateway Timeout",
      },
    };
  }

  if (status === "inconclusive") {
    return {
      evidenceId: `EVD-${executionId.slice(-4)}-${scenarioId}-${stepOrder}`,
      executionId,
      scenarioId,
      stepOrder,
      status,
      action,
      expected,
      actual:
        "판단 근거 패널이 예산 안에서 화면에 나타나지 않아 판정을 확정하지 못했습니다.",
      captures: [
        frame("action-complete", "2026-09-08T08:13:02.550Z", "직전 단계 완료"),
        frame("before-failure", "2026-09-08T08:13:19.220Z", "관측 종료 시점"),
      ],
    };
  }

  return {
    evidenceId: `EVD-${executionId.slice(-4)}-${scenarioId}-${stepOrder}`,
    executionId,
    scenarioId,
    stepOrder,
    status,
    action,
    expected,
    actual: expected,
    captures: [
      frame(
        "action-complete",
        `2026-09-08T08:11:${String(10 + stepOrder).padStart(2, "0")}.000Z`,
        `${stepOrder}단계 완료`,
      ),
    ],
  };
}

/* 확정되지 않은 판정은 사유 코드를 함께 남긴다. 사유 없이 «확인 필요»만
 * 보여주면 사용자가 다음에 할 일을 알 수 없다. */
function createDiagnostics(status: TestStepStatus): StepDiagnostics | undefined {
  if (status !== "inconclusive") return undefined;
  return {
    reason: {
      code: "TARGET_NOT_FOUND",
      detail:
        "'Agent 판단 근거 열기' 이후 근거 패널을 관측 예산(12회) 안에서 찾지 못했습니다.",
    },
    path: { adapter: "vision-web", surface: "visual" },
    observations: 12,
  };
}

const EVIDENCE_STATUSES: TestStepStatus[] = ["passed", "failed", "inconclusive"];

function createCase(
  executionId: string,
  scenario: ReturnType<
    typeof createDemoScenarioResult
  >["groups"][number]["scenarios"][number],
  stepStatuses: TestStepStatus[],
): TestCaseResult {
  const status = stepStatuses.includes("failed")
    ? "failed"
    : stepStatuses.includes("running")
      ? "running"
      : stepStatuses.includes("inconclusive")
        ? "inconclusive"
        : stepStatuses.every((stepStatus) => stepStatus === "passed")
          ? "passed"
          : stepStatuses.every((stepStatus) => stepStatus === "skipped")
            ? "skipped"
            : "queued";

  return {
    scenarioId: scenario.id,
    title: scenario.title,
    status,
    steps: scenario.steps.map((step, index) => {
      const stepStatus = stepStatuses[index] ?? "queued";
      const diagnostics = createDiagnostics(stepStatus);
      return {
        ...step,
        status: stepStatus,
        ...(EVIDENCE_STATUSES.includes(stepStatus)
          ? {
              evidence: createEvidence(
                executionId,
                scenario.id,
                step.order,
                stepStatus as "passed" | "failed" | "inconclusive",
                step.action,
                step.expected,
              ),
            }
          : {}),
        ...(diagnostics ? { diagnostics } : {}),
      };
    }),
  };
}

function scenariosById(runId: string, scenarioIds?: string[]) {
  const scenarios = createDemoScenarioResult(runId).groups.flatMap(
    (group) => group.scenarios,
  );
  if (!scenarioIds?.length) return scenarios;
  return scenarios.filter((scenario) => scenarioIds.includes(scenario.id));
}

export function createDemoTestExecution(
  runId: string,
  mode: "running" | "failed" | "passed" = "running",
  scenarioIds?: string[],
  executionId = "EXE-20260908-0042",
): TestExecution {
  const defaultScenarioIds =
    mode === "failed"
      ? ["SCN-AUTH-001", "SCN-LEDGER-001", "SCN-AGENT-001"]
      : ["SCN-AUTH-001", "SCN-LEDGER-001", "SCN-REVIEW-001"];
  const scenarios = scenariosById(runId, scenarioIds ?? defaultScenarioIds);
  const selected = scenarios.length > 0 ? scenarios : scenariosById(runId).slice(0, 3);

  const cases = selected.map((scenario, index) => {
    if (mode === "passed") {
      return createCase(
        executionId,
        scenario,
        scenario.steps.map(() => "passed"),
      );
    }

    /* 성공·실패·확인 필요를 한 실행에 함께 담는다. 실행 결과 화면과 증적
     * 상세, 사유 코드 표시를 한 번에 볼 수 있어야 한다. */
    if (mode === "failed") {
      if (index === 0) {
        return createCase(
          executionId,
          scenario,
          scenario.steps.map(() => "passed"),
        );
      }
      if (index === 1) {
        return createCase(
          executionId,
          scenario,
          scenario.steps.map((_, stepIndex) =>
            stepIndex === 0 ? "passed" : stepIndex === 1 ? "failed" : "skipped",
          ),
        );
      }
      return createCase(
        executionId,
        scenario,
        scenario.steps.map((_, stepIndex) =>
          stepIndex < 2 ? "passed" : stepIndex === 2 ? "inconclusive" : "skipped",
        ),
      );
    }

    if (index === 0 && selected.length > 1) {
      return createCase(
        executionId,
        scenario,
        scenario.steps.map(() => "passed"),
      );
    }
    if (index === 1 || selected.length === 1) {
      return createCase(
        executionId,
        scenario,
        scenario.steps.map((_, stepIndex) =>
          stepIndex === 0 ? "passed" : stepIndex === 1 ? "running" : "queued",
        ),
      );
    }
    return createCase(
      executionId,
      scenario,
      scenario.steps.map(() => "queued"),
    );
  });

  return {
    executionId,
    scenarioRunId: runId,
    targetUrl,
    status: mode,
    createdAt: "2026-09-08T08:11:04.000Z",
    ...(mode !== "running" ? { completedAt: "2026-09-08T08:13:19.500Z" } : {}),
    cases,
    evidenceBytes: cases.reduce(
      (total, testCase) =>
        total +
        testCase.steps.reduce(
          (stepTotal, step) =>
            stepTotal + (step.evidence?.captures.length ?? 0) * 286_720,
          0,
        ),
      0,
    ),
  };
}

export function createDemoExecutionHistory(runId: string): TestExecution[] {
  return [
    createDemoTestExecution(runId, "failed", undefined, "EXE-20260908-0042"),
    /* 앞선 실행은 다른 날짜여야 한다. 같은 시각이면 목록에서 두 실행을
     * 구분할 수 없고 정렬도 의미를 잃는다. */
    {
      ...createDemoTestExecution(runId, "passed", undefined, "EXE-20260905-0031"),
      createdAt: "2026-09-05T11:52:10.000Z",
      completedAt: "2026-09-05T11:54:02.000Z",
    },
  ];
}

/* 증적 라이브러리는 실행 fixture 에서 파생시킨다. 숫자를 따로 적어두면
 * 실행 목록과 증적 탭이 서로 다른 값을 말하게 된다. */
export function createDemoEvidenceLibrary(runId: string): EvidenceLibraryView {
  const verdictOf = (
    status: TestStepStatus,
  ): EvidenceLibraryEntry["verdict"] | null =>
    status === "passed"
      ? "PASSED"
      : status === "failed"
        ? "FAILED"
        : status === "inconclusive"
          ? "INCONCLUSIVE"
          : null;

  const entries: EvidenceLibraryEntry[] = [];
  for (const execution of createDemoExecutionHistory(runId)) {
    for (const testCase of execution.cases) {
      for (const step of testCase.steps) {
        const verdict = verdictOf(step.status);
        if (!verdict || !step.evidence) continue;
        const reasonCode = step.diagnostics?.reason?.code;
        entries.push({
          runId,
          executionId: execution.executionId,
          scenarioId: testCase.scenarioId,
          stepId: `${testCase.scenarioId}#${step.order}`,
          order: step.order,
          verdict,
          ...(reasonCode ? { reasonCode } : {}),
          frameCount: step.evidence.captures.length,
          bytes: step.evidence.captures.length * 286_720,
          reviewCount: verdict === "FAILED" ? 1 : 0,
          causeTags: verdict === "FAILED" ? ["대상 앱 결함"] : [],
          decisions: verdict === "FAILED" ? ["동의"] : [],
          createdAt: execution.createdAt,
        });
      }
    }
  }

  const totals = entries.reduce(
    (accumulated, entry) => ({
      steps: accumulated.steps + 1,
      frames: accumulated.frames + entry.frameCount,
      bytes: accumulated.bytes + entry.bytes,
      verdicts: {
        ...accumulated.verdicts,
        [entry.verdict]: accumulated.verdicts[entry.verdict] + 1,
      },
      reasonCodes: entry.reasonCode
        ? {
            ...accumulated.reasonCodes,
            [entry.reasonCode]: (accumulated.reasonCodes[entry.reasonCode] ?? 0) + 1,
          }
        : accumulated.reasonCodes,
      causeTags: entry.causeTags.reduce(
        (tags, tag) => ({ ...tags, [tag]: (tags[tag] ?? 0) + 1 }),
        accumulated.causeTags,
      ),
      reviewed: accumulated.reviewed + (entry.reviewCount > 0 ? 1 : 0),
    }),
    {
      steps: 0,
      frames: 0,
      bytes: 0,
      verdicts: { PASSED: 0, FAILED: 0, INCONCLUSIVE: 0 },
      reasonCodes: {} as Record<string, number>,
      causeTags: {} as Record<string, number>,
      reviewed: 0,
    },
  );

  return {
    entries: entries.sort(
      (left, right) =>
        right.createdAt.localeCompare(left.createdAt) ||
        left.scenarioId.localeCompare(right.scenarioId) ||
        left.order - right.order,
    ),
    totals,
  };
}

/* 런처에 보이는 프로젝트 카드. 분석이 끝나고 테스트까지 돌린 상태를 가정한다. */
export function createDemoProjectSummary(
  project: { name: string; path?: string },
  runId: string,
  runCount: number,
): ProjectSummary {
  const executions = createDemoExecutionHistory(runId);
  const library = createDemoEvidenceLibrary(runId);
  return {
    path: project.path ?? `/${project.name}`,
    name: project.name,
    reachable: true,
    addedAt: "2026-09-05T11:20:00.000Z",
    lastOpenedAt: "2026-09-08T17:31:00.000Z",
    runs: runCount,
    latestRunId: runId,
    executions: executions.length,
    failedExecutions: executions.filter((execution) => execution.status === "failed")
      .length,
    frames: library.totals.frames,
    bytes: library.totals.bytes,
  };
}

export function findFirstFailure(execution: TestExecution): StepEvidence | null {
  for (const testCase of execution.cases) {
    for (const step of testCase.steps) {
      if (step.evidence?.status === "failed") return step.evidence;
    }
  }
  return null;
}
