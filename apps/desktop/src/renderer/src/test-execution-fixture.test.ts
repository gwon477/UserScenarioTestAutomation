import { describe, expect, it } from "vitest";
import { isValidStepEvidence } from "../../shared/test-execution";
import { createDemoTestExecution } from "./test-execution-fixture";

describe("createDemoTestExecution", () => {
  it("keeps a single-case retry active until its current step settles", () => {
    const execution = createDemoTestExecution(
      "run-001",
      "running",
      ["SCN-LEDGER-001"],
      "EXE-001",
    );

    expect(execution.cases).toHaveLength(1);
    expect(execution.cases[0]?.status).toBe("running");
    expect(execution.cases[0]?.steps.map((step) => step.status)).toEqual([
      "passed",
      "running",
      "queued",
    ]);
  });

  it("mixes passed, failed and inconclusive cases in one execution", () => {
    const execution = createDemoTestExecution(
      "run-001",
      "failed",
      undefined,
      "EXE-002",
    );

    expect(execution.cases.map((testCase) => testCase.status)).toEqual([
      "passed",
      "failed",
      "inconclusive",
    ]);
    // 실패 이후 단계는 대기가 아니라 건너뜀이다.
    expect(execution.cases[1]?.steps.map((step) => step.status)).toEqual([
      "passed",
      "failed",
      "skipped",
    ]);
  });

  it("gives every unsettled verdict an actionable reason code", () => {
    const execution = createDemoTestExecution(
      "run-001",
      "failed",
      undefined,
      "EXE-003",
    );
    const inconclusive = execution.cases
      .flatMap((testCase) => testCase.steps)
      .filter((step) => step.status === "inconclusive");

    expect(inconclusive).not.toHaveLength(0);
    for (const step of inconclusive) {
      expect(step.diagnostics?.reason?.code).toBe("TARGET_NOT_FOUND");
    }
  });

  it("keeps every fixture evidence record inside the shared evidence contract", () => {
    for (const mode of ["passed", "failed", "running"] as const) {
      const execution = createDemoTestExecution("run-001", mode, undefined, "EXE-004");
      for (const testCase of execution.cases) {
        for (const step of testCase.steps) {
          if (!step.evidence) continue;
          expect(isValidStepEvidence(step.evidence)).toBe(true);
        }
      }
    }
  });
});
