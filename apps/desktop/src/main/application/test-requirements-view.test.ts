import { describe, expect, it } from "vitest";
import type { FactBundle, ScenarioSet } from "@scenarioforge/contracts";
import { projectTestExecutionRequirements } from "./test-requirements-view";

const RUN_ID = "RUN-req-01";
const identity = { project_id: "P-1", analysis_run_id: RUN_ID, source_snapshot_id: "SS-1" } as const;

const facts: FactBundle = {
  ...identity,
  schema_version: 2,
  screens: [
    {
      ...identity,
      schema_version: 3,
      screen_id: "SCR-LOGIN",
      route: "/login",
      title: "로그인",
      entry_guards: [],
      apis: [],
      feedback: [],
      displays: [],
      status: "verified",
      elements: [
        {
          id: "EL-PW",
          type: "password-textbox",
          label: "패스워드",
          interaction: { action_kind: "fill", surface_kind: "web", target_candidates: [{ by: "css", value: "#pw" }] },
          evidence: [],
        },
        {
          id: "EL-SUBMIT",
          type: "button",
          label: "로그인",
          interaction: { action_kind: "submit-login", surface_kind: "web", target_candidates: [{ by: "css", value: ".submit" }] },
          evidence: [],
        },
      ],
    },
  ],
  edges: [
    { ...identity, schema_version: 2, edge_id: "E-PW", kind: "normal", from: "SCR-LOGIN", on: "EL-PW", to: "SCR-LOGIN", feedback: [], evidence: [], status: "verified" },
    { ...identity, schema_version: 2, edge_id: "E-SUBMIT", kind: "normal", from: "SCR-LOGIN", on: "EL-SUBMIT", to: "SCR-HOME", feedback: [], evidence: [], status: "verified" },
  ],
  predicates: [],
};

const scenarioSet: ScenarioSet = {
  ...identity,
  schema_version: 2,
  scenarios: [
    {
      ...identity,
      schema_version: 2,
      scenario_id: "SCN-0001",
      workflow: "WF-login",
      kind: "normal",
      variation: {},
      preconditions: [],
      path: ["SCR-LOGIN", "SCR-HOME"],
      status: "verified",
      steps: [
        { n: 1, action: "패스워드를 입력한다", action_ref: { edge: "E-PW", element: "EL-PW" }, expected: "입력된다", assertion_refs: ["SCR-LOGIN"] },
        { n: 2, action: "로그인을 누른다", action_ref: { edge: "E-SUBMIT", element: "EL-SUBMIT" }, expected: "이동한다", assertion_refs: ["SCR-HOME"] },
      ],
    },
  ],
};


const project = (scenarioIds: string[], providedBindingKeys: string[] = []) =>
  projectTestExecutionRequirements({ runId: RUN_ID, scenarioSet, facts, scenarioIds, providedBindingKeys });

describe("test execution requirements projection", () => {
  it("derives one field per unresolved binding with the visible label", () => {
    const requirements = project(["SCN-0001"]);

    expect(requirements.runId).toBe(RUN_ID);
    expect(requirements.dataBindings).toEqual([
      {
        bindingKey: "EL-PW",
        label: "패스워드",
        controlKind: "password-textbox",
        secret: true,
        usedBy: [{ scenarioId: "SCN-0001", stepId: "SCN-0001#1" }],
      },
    ]);
    expect(requirements.scenarios[0]).toMatchObject({ state: "data-required", missingBindings: ["EL-PW"], blockers: [] });
  });

  it("proposes the password target as a mask default", () => {
    expect(project(["SCN-0001"]).maskDefaults).toEqual([
      { elementRef: "EL-PW", label: "패스워드", screenId: "SCR-LOGIN" },
    ]);
  });

  it("reports ready once the value is provided and carries no value back", () => {
    const requirements = project(["SCN-0001"], ["EL-PW"]);

    expect(requirements.scenarios[0]).toMatchObject({ state: "ready", compiledSteps: 2 });
    expect(requirements.dataBindings).toEqual([]);
  });

  it("does not offer a destructive allowance when no destructive step is selected", () => {
    expect(project(["SCN-0001"]).hasDestructiveStep).toBe(false);
  });

  it("rejects a scenario id that is not in the canonical run", () => {
    expect(() => project(["SCN-9999"])).toThrow("SCENARIO_SELECTION_NOT_IN_RUN");
  });

  it("carries the budget defaults the form should show", () => {
    expect(project(["SCN-0001"]).budgetDefaults).toEqual({ maxModelCalls: 3, maxScreenshots: 4, timeoutMs: 45_000 });
  });
});
