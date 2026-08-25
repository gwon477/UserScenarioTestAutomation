import { describe, expect, it } from "vitest";
import { createDemoTestExecution } from "./test-execution-fixture";

describe("createDemoTestExecution", () => {
  it("keeps a single-case retry active until its current step settles", () => {
    const execution = createDemoTestExecution(
      "run-001",
      "running",
      ["SCN-PAY-002"],
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

  it("marks cases after a failure as skipped rather than queued", () => {
    const execution = createDemoTestExecution(
      "run-001",
      "failed",
      undefined,
      "EXE-002",
    );

    expect(execution.cases.map((testCase) => testCase.status)).toEqual([
      "passed",
      "failed",
      "skipped",
    ]);
  });
});
