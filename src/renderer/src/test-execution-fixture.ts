import type {
  StepEvidence,
  TestCaseResult,
  TestExecution,
  TestStepStatus,
} from "../../shared/test-execution";
import { createDemoScenarioResult } from "./scenario-result";

const targetUrl = "https://staging.commerce.example/checkout";

function createEvidence(
  executionId: string,
  scenarioId: string,
  stepOrder: number,
  status: "passed" | "failed",
  action: string,
  expected: string,
): StepEvidence {
  const failed = status === "failed";
  return {
    evidenceId: `EVD-${executionId.slice(-4)}-${scenarioId}-${stepOrder}`,
    executionId,
    scenarioId,
    stepOrder,
    status,
    action,
    expected,
    actual: failed
      ? "결제 요청 후 오류 안내 없이 동일 화면에 머물렀습니다. 결제 API가 503을 반환했습니다."
      : expected,
    captures: failed
      ? [
          {
            id: `${scenarioId}-${stepOrder}-complete`,
            kind: "action-complete",
            capturedAt: "2026-08-25T06:41:15.188Z",
            relativePath: `evidence/${scenarioId}/${stepOrder}-complete.png`,
            mimeType: "image/png",
            width: 1440,
            height: 900,
            label: "이전 단계 완료",
          },
          {
            id: `${scenarioId}-${stepOrder}-before`,
            kind: "before-failure",
            capturedAt: "2026-08-25T06:41:18.042Z",
            relativePath: `evidence/${scenarioId}/${stepOrder}-before-failure.png`,
            mimeType: "image/png",
            width: 1440,
            height: 900,
            label: "실패 직전",
          },
          {
            id: `${scenarioId}-${stepOrder}-failure`,
            kind: "failure",
            capturedAt: "2026-08-25T06:41:18.391Z",
            relativePath: `evidence/${scenarioId}/${stepOrder}-failure.png`,
            mimeType: "image/png",
            width: 1440,
            height: 900,
            label: "실패 시점",
          },
        ]
      : [
          {
            id: `${scenarioId}-${stepOrder}-complete`,
            kind: "action-complete",
            capturedAt: `2026-08-25T06:40:${String(10 + stepOrder).padStart(2, "0")}.000Z`,
            relativePath: `evidence/${scenarioId}/${stepOrder}-complete.png`,
            mimeType: "image/png",
            width: 1440,
            height: 900,
            label: `${stepOrder}단계 완료`,
          },
        ],
    ...(failed
      ? {
          error: {
            category: "target.network",
            code: "PAYMENT_GATEWAY_UNAVAILABLE",
            message: "POST /api/payments 응답 503 · Service Unavailable",
          },
        }
      : {}),
  };
}

function createCase(
  executionId: string,
  scenario: ReturnType<typeof createDemoScenarioResult>["groups"][number]["scenarios"][number],
  stepStatuses: TestStepStatus[],
): TestCaseResult {
  const status = stepStatuses.includes("failed")
    ? "failed"
    : stepStatuses.includes("running")
      ? "running"
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
      return {
        ...step,
        status: stepStatus,
        ...(["passed", "failed"].includes(stepStatus)
          ? {
              evidence: createEvidence(
                executionId,
                scenario.id,
                step.order,
                stepStatus as "passed" | "failed",
                step.action,
                step.expected,
              ),
            }
          : {}),
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
  executionId = "EXE-20260825-0007",
): TestExecution {
  const defaultScenarioIds =
    mode === "failed"
      ? ["SCN-ORD-001", "SCN-PAY-002", "SCN-MEM-001"]
      : ["SCN-ORD-001", "SCN-PAY-001", "SCN-PAY-002"];
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
            stepIndex === 0 ? "failed" : "skipped",
          ),
        );
      }
      return createCase(
        executionId,
        scenario,
        scenario.steps.map(() => "skipped"),
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
    createdAt: "2026-08-25T06:40:07.000Z",
    ...(mode !== "running"
      ? { completedAt: "2026-08-25T06:41:18.500Z" }
      : {}),
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
    createDemoTestExecution(runId, "failed", undefined, "EXE-20260825-0006"),
    createDemoTestExecution(runId, "passed", undefined, "EXE-20260822-0005"),
  ];
}

export function findFirstFailure(execution: TestExecution): StepEvidence | null {
  for (const testCase of execution.cases) {
    for (const step of testCase.steps) {
      if (step.evidence?.status === "failed") return step.evidence;
    }
  }
  return null;
}
