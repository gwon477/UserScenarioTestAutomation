import { describe, expect, it } from "vitest";
import {
  deriveExecutionResult,
  isValidStepEvidence,
  orderEvidenceCaptures,
  type TestCaseResult,
} from "./test-execution";

function caseWithStatus(
  scenarioId: string,
  status: TestCaseResult["status"],
): TestCaseResult {
  return {
    scenarioId,
    title: scenarioId,
    status,
    steps: [],
  };
}

describe("deriveExecutionResult", () => {
  it("uses failure as the highest-priority final result", () => {
    expect(
      deriveExecutionResult([
        caseWithStatus("SCN-001", "cancelled"),
        caseWithStatus("SCN-002", "inconclusive"),
        caseWithStatus("SCN-003", "failed"),
      ]),
    ).toBe("failed");
  });

  it("returns passed when every case passes", () => {
    expect(
      deriveExecutionResult([
        caseWithStatus("SCN-001", "passed"),
        caseWithStatus("SCN-002", "passed"),
      ]),
    ).toBe("passed");
  });

  it("does not finalize while any case is still active", () => {
    expect(
      deriveExecutionResult([
        caseWithStatus("SCN-001", "passed"),
        caseWithStatus("SCN-002", "running"),
      ]),
    ).toBeNull();
  });
});

describe("orderEvidenceCaptures", () => {
  it("prioritizes the failure frame and its preceding context", () => {
    const captures = orderEvidenceCaptures([
      {
        id: "capture-complete",
        kind: "action-complete",
        capturedAt: "2026-08-25T09:00:00.000Z",
        relativePath: "evidence/capture-complete.png",
        mimeType: "image/png",
        width: 1440,
        height: 900,
      },
      {
        id: "capture-before",
        kind: "before-failure",
        capturedAt: "2026-08-25T09:00:01.000Z",
        relativePath: "evidence/capture-before.png",
        mimeType: "image/png",
        width: 1440,
        height: 900,
      },
      {
        id: "capture-failure",
        kind: "failure",
        capturedAt: "2026-08-25T09:00:02.000Z",
        relativePath: "evidence/capture-failure.png",
        mimeType: "image/png",
        width: 1440,
        height: 900,
      },
    ]);

    expect(captures.map((capture) => capture.kind)).toEqual([
      "failure",
      "before-failure",
      "action-complete",
    ]);
  });
});

describe("isValidStepEvidence", () => {
  const completeCapture = {
    id: "capture-complete",
    kind: "action-complete" as const,
    capturedAt: "2026-08-25T09:00:00.000Z",
    relativePath: "evidence/capture-complete.png",
    mimeType: "image/png" as const,
    width: 1440,
    height: 900,
  };

  const passedEvidence = {
    evidenceId: "EVD-001",
    executionId: "EXE-001",
    scenarioId: "SCN-001",
    stepOrder: 1,
    status: "passed" as const,
    action: "결제를 요청한다.",
    expected: "완료 화면이 표시된다.",
    actual: "완료 화면이 표시됐다.",
    captures: [completeCapture],
  };

  it("accepts exactly one completion screen for a passed step", () => {
    expect(isValidStepEvidence(passedEvidence)).toBe(true);
    expect(
      isValidStepEvidence({
        ...passedEvidence,
        captures: [completeCapture, { ...completeCapture, id: "duplicate" }],
      }),
    ).toBe(false);
  });

  it("requires failure context screens and error details", () => {
    expect(
      isValidStepEvidence({
        ...passedEvidence,
        status: "failed",
        captures: [
          completeCapture,
          { ...completeCapture, id: "before", kind: "before-failure" },
          { ...completeCapture, id: "failure", kind: "failure" },
        ],
      }),
    ).toBe(false);
  });
});
