import { describe, expect, it } from "vitest";
import type { TestExecutionRequirements } from "../../shared/test-requirements";
import { validateExecutionCommand } from "./test-execution-command";

const requirements: TestExecutionRequirements = {
  runId: "RUN-1",
  scenarios: [
    { scenarioId: "SCN-1", state: "data-required", compiledSteps: 2, missingBindings: ["EL-PW"], blockers: [] },
    { scenarioId: "SCN-2", state: "ready", compiledSteps: 1, missingBindings: [], blockers: [] },
  ],
  dataBindings: [
    { bindingKey: "EL-PW", label: "패스워드", controlKind: "password-textbox", secret: true, usedBy: [{ scenarioId: "SCN-1", stepId: "SCN-1#1" }] },
  ],
  maskDefaults: [{ elementRef: "EL-PW", label: "패스워드", screenId: "SCR-LOGIN" }],
  hasDestructiveStep: false,
  budgetDefaults: { maxModelCalls: 3, maxScreenshots: 4, timeoutMs: 30_000 },
};

const request = {
  scenarioIds: ["SCN-1", "SCN-2"],
  targetUrl: "https://staging.example.com",
  dataBindings: { "EL-PW": "test-only" },
  maskElementRefs: ["EL-PW"],
  destructiveAllowed: false,
};

describe("execution command validation", () => {
  it("accepts a request that satisfies every requirement", () => {
    expect(validateExecutionCommand({ requirements, request })).toBeNull();
  });

  it("rejects a non-http target entry", () => {
    for (const targetUrl of ["", "file:///etc/passwd", "ftp://example.com", "not-a-url"]) {
      expect(validateExecutionCommand({ requirements, request: { ...request, targetUrl } })).toMatchObject({
        stage: "request",
        code: "TARGET_ENTRY_INVALID",
      });
    }
  });

  it("rejects an empty selection", () => {
    expect(validateExecutionCommand({ requirements, request: { ...request, scenarioIds: [] } })).toMatchObject({
      code: "SCENARIO_SELECTION_EMPTY",
    });
  });

  it("rejects a blank data binding and names the missing key", () => {
    expect(validateExecutionCommand({ requirements, request: { ...request, dataBindings: { "EL-PW": "   " } } })).toMatchObject({
      stage: "request",
      code: "DATA_BINDING_MISSING",
      detail: "EL-PW",
    });
  });

  it("refuses to run with a declared mask target omitted", () => {
    expect(validateExecutionCommand({ requirements, request: { ...request, maskElementRefs: [] } })).toMatchObject({
      code: "MASK_TARGET_OMITTED",
      detail: "EL-PW",
    });
  });

  it("refuses a mask target the requirements never declared", () => {
    expect(
      validateExecutionCommand({ requirements, request: { ...request, maskElementRefs: ["EL-PW", "EL-OTHER"] } }),
    ).toMatchObject({ code: "MASK_TARGET_NOT_DECLARED", detail: "EL-OTHER" });
  });

  it("requires an explicit allowance for a destructive step", () => {
    const destructive = { ...requirements, hasDestructiveStep: true };

    expect(validateExecutionCommand({ requirements: destructive, request })).toMatchObject({
      code: "DESTRUCTIVE_NOT_ALLOWED",
    });
    expect(validateExecutionCommand({ requirements: destructive, request: { ...request, destructiveAllowed: true } })).toBeNull();
  });

  it("rejects at the planning stage when every case is blocked", () => {
    const blocked: TestExecutionRequirements = {
      ...requirements,
      scenarios: requirements.scenarios.map((entry) => ({
        ...entry,
        blockers: [{ stepId: `${entry.scenarioId}#1`, reason: "NO_VISUAL_TARGET_EVIDENCE", detail: "EL-X" }],
      })),
    };

    expect(validateExecutionCommand({ requirements: blocked, request })).toMatchObject({
      stage: "planning",
      code: "NO_RUNNABLE_SCENARIO",
      scenarioIds: ["SCN-1", "SCN-2"],
    });
  });
});
