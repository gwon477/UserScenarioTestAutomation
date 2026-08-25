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
  }>;
};

export type TestExecutionStatus =
  | "queued"
  | "preparing"
  | "running"
  | TestResultStatus;

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
