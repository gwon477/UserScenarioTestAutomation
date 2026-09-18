export type TestResultStatus =
  | "passed"
  | "failed"
  | "inconclusive"
  | "cancelled";

export type TestStepStatus =
  | "queued"
  | "running"
  | TestResultStatus
  | "skipped";

export type EvidenceCaptureKind =
  | "action-complete"
  | "before-failure"
  | "failure";

export type EvidenceCapture = {
  id: string;
  kind: EvidenceCaptureKind;
  capturedAt: string;
  relativePath: string;
  mimeType: "image/png" | "image/webp";
  width: number;
  height: number;
  label?: string;
};

export type EvidenceError = {
  category: string;
  message: string;
  code?: string;
};

export type StepEvidence = {
  evidenceId: string;
  executionId: string;
  scenarioId: string;
  stepOrder: number;
  status: TestResultStatus;
  action: string;
  expected: string;
  actual: string;
  captures: EvidenceCapture[];
  error?: EvidenceError;
};

/* step 이 왜 그 판정을 받았는지. «확인 필요»만 표시하고 사유를 감추면
 * 사용자가 할 수 있는 일이 없다. 비전 경로에서 이 사유가 가장 행동 가능한
 * 정보다. 계약은 docs/screens/05-test-center.md 를 따른다.
 *
 * 코드만 담고 표시 문구는 담지 않는다. 문구는 renderer 소유다. */
export type StepReasonCode =
  | "TARGET_NOT_FOUND"
  | "BUDGET_EXHAUSTED"
  | "ACTION_OUTCOME_UNKNOWN"
  | "GATE_REJECTED"
  | "FRAME_MASKING_FAILED"
  | "SCREEN_TEXT_INSTRUCTION_DETECTED"
  | "MISSING_DATA_BINDING";

export type GateRejectionCode =
  | "STEP_MISMATCH"
  | "ACTION_NOT_ALLOWED"
  | "LOCUS_OUT_OF_BOUNDS"
  | "OBSERVED_LABEL_MISMATCH"
  | "TARGET_NOT_DISAMBIGUATED"
  | "CANDIDATE_VERIFICATION_FAILED"
  | "CONFIDENCE_BELOW_THRESHOLD"
  | "DESTRUCTIVE_ACTION_NOT_PERMITTED"
  | "BUDGET_EXHAUSTED";

export type AssertionOutcome = {
  ref: string;
  status: TestResultStatus;
  detail: string;
};

export type StepDiagnostics = {
  /** 판정이 확정되지 않았거나 중단된 경우의 사유. 성공·실패면 없다. */
  reason?: { code: StepReasonCode; gateCode?: GateRejectionCode; detail: string };
  /** 제안·거절 재시도 회차. 마지막 항목이 실제로 적용된 판정이다. */
  attempts?: ReadonlyArray<{ attempt: number; outcome: "accepted" | "rejected" | "aborted"; code?: GateRejectionCode | "SCREEN_TEXT_INSTRUCTION_DETECTED" }>;
  /** 사용한 실행 경로. semantic 인지 visual 인지 사용자가 알아야 한다. */
  path?: { adapter: string; surface: "semantic" | "visual"; fallbackFrom?: string };
  /** assertion 참조별 결과. */
  assertions?: readonly AssertionOutcome[];
  /** 관측 회차 수. 화면이 늦게 채워졌는지 판단하는 근거다. */
  observations?: number;
};

export type TestCaseResult = {
  scenarioId: string;
  title: string;
  status: TestStepStatus;
  steps: Array<{
    order: number;
    action: string;
    expected: string;
    status: TestStepStatus;
    evidence?: StepEvidence;
    diagnostics?: StepDiagnostics;
  }>;
};

export type TestExecutionStatus =
  | "queued"
  | "preparing"
  | "running"
  | TestResultStatus;

/* 실행에 필요한 데이터 binding. key 와 secret 여부만 담는다.
 * 값은 저장되지 않으므로 실행 시점에 다시 받아야 한다. */
export type RequiredBinding = {
  bindingKey: string;
  secret: boolean;
};

export type TestExecution = {
  executionId: string;
  scenarioRunId: string;
  retryOfExecutionId?: string;
  targetUrl: string;
  status: TestExecutionStatus;
  createdAt: string;
  completedAt?: string;
  cases: TestCaseResult[];
  evidenceBytes: number;
  requiredBindings?: RequiredBinding[];
};

const finalResultPriority: TestResultStatus[] = [
  "failed",
  "inconclusive",
  "cancelled",
  "passed",
];

export function deriveExecutionResult(
  cases: TestCaseResult[],
): TestResultStatus | null {
  if (cases.length === 0) {
    return "inconclusive";
  }

  if (
    cases.some((testCase) =>
      ["queued", "running"].includes(testCase.status),
    )
  ) {
    return null;
  }

  return (
    finalResultPriority.find((status) =>
      cases.some((testCase) => testCase.status === status),
    ) ?? "inconclusive"
  );
}

export function isValidStepEvidence(evidence: StepEvidence): boolean {
  const capturesAreValid = evidence.captures.every(
    (capture) =>
      capture.id.length > 0 &&
      capture.relativePath.length > 0 &&
      capture.width > 0 &&
      capture.height > 0,
  );
  if (!capturesAreValid) return false;

  if (evidence.status === "passed") {
    return (
      evidence.captures.length === 1 &&
      evidence.captures[0]?.kind === "action-complete" &&
      evidence.error === undefined
    );
  }

  if (evidence.status === "failed") {
    const captureKinds = new Set(
      evidence.captures.map((capture) => capture.kind),
    );
    return (
      captureKinds.has("action-complete") &&
      captureKinds.has("before-failure") &&
      captureKinds.has("failure") &&
      Boolean(evidence.error?.category && evidence.error.message)
    );
  }

  return evidence.captures.length > 0;
}

const evidencePriority: Record<EvidenceCaptureKind, number> = {
  failure: 0,
  "before-failure": 1,
  "action-complete": 2,
};

export function orderEvidenceCaptures(
  captures: EvidenceCapture[],
): EvidenceCapture[] {
  return [...captures].sort(
    (left, right) => evidencePriority[left.kind] - evidencePriority[right.kind],
  );
}
