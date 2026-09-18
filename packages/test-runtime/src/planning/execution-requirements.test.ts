import { describe, expect, it } from "vitest";
import type { FactEdge, FactElement, FactScreen, ScenarioRecord } from "@scenarioforge/contracts";
import { deriveExecutionRequirements } from "./execution-requirements.js";

const identity = { project_id: "P-1", analysis_run_id: "RUN-1", source_snapshot_id: "SS-1" } as const;

function element(overrides: Partial<FactElement> & { id: string }): FactElement {
  return {
    type: "button",
    label: "로그인",
    interaction: { action_kind: "click", surface_kind: "web", target_candidates: [{ by: "css", value: ".submit" }] },
    evidence: [],
    ...overrides,
  };
}

const screen = (screenId: string, elements: FactElement[]): FactScreen => ({
  ...identity,
  schema_version: 3,
  screen_id: screenId,
  route: "/login",
  title: "로그인",
  entry_guards: [],
  elements,
  apis: [],
  feedback: [],
  displays: [],
  status: "verified",
});

const edge = (id: string, on: string): FactEdge => ({
  ...identity,
  schema_version: 2,
  edge_id: id,
  kind: "normal",
  from: "SCR-1",
  on,
  to: "SCR-2",
  feedback: [],
  evidence: [],
  status: "verified",
});

const scenario = (id: string, steps: ScenarioRecord["steps"]): ScenarioRecord => ({
  ...identity,
  schema_version: 2,
  scenario_id: id,
  workflow: "WF-1",
  kind: "normal",
  variation: {},
  preconditions: [],
  path: ["SCR-1", "SCR-2"],
  steps,
  status: "verified",
});

const step = (n: number, edgeId: string, elementId: string) => ({
  n,
  action: "동작",
  action_ref: { edge: edgeId, element: elementId },
  expected: "결과",
  assertion_refs: ["SCR-2"],
});

const userIdField = element({ id: "EL-ID", type: "textbox", label: "아이디", interaction: { action_kind: "fill", surface_kind: "web", target_candidates: [{ by: "css", value: "#id" }] } });
const passwordField = element({ id: "EL-PW", type: "password-textbox", label: "패스워드", interaction: { action_kind: "fill", surface_kind: "web", target_candidates: [{ by: "css", value: "#pw" }] } });

describe("execution requirements", () => {
  it("asks for one field per unresolved data binding with its visible label", () => {
    const requirements = deriveExecutionRequirements({
      scenarios: [scenario("SCN-1", [step(1, "E-1", "EL-ID"), step(2, "E-2", "EL-PW")])],
      screens: [screen("SCR-1", [userIdField, passwordField])],
      edges: [edge("E-1", "EL-ID"), edge("E-2", "EL-PW")],
    });

    expect(requirements.dataBindings).toEqual([
      { bindingKey: "EL-ID", elementRef: "EL-ID", label: "아이디", controlKind: "textbox", secret: false, usedBy: [{ scenarioId: "SCN-1", stepId: "SCN-1#1" }] },
      { bindingKey: "EL-PW", elementRef: "EL-PW", label: "패스워드", controlKind: "password-textbox", secret: true, usedBy: [{ scenarioId: "SCN-1", stepId: "SCN-1#2" }] },
    ]);
    expect(requirements.scenarios[0]).toMatchObject({ state: "data-required", missingBindings: ["EL-ID", "EL-PW"] });
  });

  it("stops asking once a value is provided", () => {
    const requirements = deriveExecutionRequirements({
      scenarios: [scenario("SCN-1", [step(1, "E-1", "EL-ID")])],
      screens: [screen("SCR-1", [userIdField])],
      edges: [edge("E-1", "EL-ID")],
      providedBindingKeys: ["EL-ID"],
    });

    expect(requirements.dataBindings).toEqual([]);
    expect(requirements.scenarios[0]).toMatchObject({ state: "ready", compiledSteps: 1 });
  });

  it("reports which cases and steps share one value", () => {
    const requirements = deriveExecutionRequirements({
      scenarios: [
        scenario("SCN-1", [step(1, "E-1", "EL-ID")]),
        scenario("SCN-2", [step(1, "E-1", "EL-ID")]),
      ],
      screens: [screen("SCR-1", [userIdField])],
      edges: [edge("E-1", "EL-ID")],
    });

    expect(requirements.dataBindings).toHaveLength(1);
    expect(requirements.dataBindings[0]?.usedBy).toEqual([
      { scenarioId: "SCN-1", stepId: "SCN-1#1" },
      { scenarioId: "SCN-2", stepId: "SCN-2#1" },
    ]);
  });

  it("separates blockers the user cannot fix from values the user can supply", () => {
    const unresolved = element({ id: "EL-X", interaction: { action_kind: "unresolved", surface_kind: "web", target_candidates: [] } });

    const requirements = deriveExecutionRequirements({
      scenarios: [scenario("SCN-1", [step(1, "E-1", "EL-ID"), step(2, "E-2", "EL-X")])],
      screens: [screen("SCR-1", [userIdField, unresolved])],
      edges: [edge("E-1", "EL-ID"), edge("E-2", "EL-X")],
    });

    expect(requirements.scenarios[0]?.state).toBe("blocked");
    expect(requirements.scenarios[0]?.blockers.map((entry) => entry.reason)).toEqual(["ACTION_KIND_UNRESOLVED"]);
    expect(requirements.scenarios[0]?.missingBindings).toEqual(["EL-ID"]);
  });

  it("proposes password targets as mask defaults even before values are supplied", () => {
    const requirements = deriveExecutionRequirements({
      scenarios: [scenario("SCN-1", [step(1, "E-2", "EL-PW")])],
      screens: [screen("SCR-1", [passwordField])],
      edges: [edge("E-2", "EL-PW")],
    });

    expect(requirements.maskDefaults).toEqual([
      { elementRef: "EL-PW", label: "패스워드", screenId: "SCR-1", candidates: [{ by: "css", value: "#pw" }] },
    ]);
  });

  it("flags a destructive step only when one is present", () => {
    const destructive = element({ id: "EL-ORDER", label: "주문 확정", interaction: { action_kind: "submit-order", surface_kind: "web", target_candidates: [{ by: "css", value: ".order" }] } });

    const without = deriveExecutionRequirements({
      scenarios: [scenario("SCN-1", [step(1, "E-1", "EL-SAFE")])],
      screens: [screen("SCR-1", [element({ id: "EL-SAFE" })])],
      edges: [edge("E-1", "EL-SAFE")],
    });
    const withDestructive = deriveExecutionRequirements({
      scenarios: [scenario("SCN-1", [step(1, "E-1", "EL-ORDER")])],
      screens: [screen("SCR-1", [destructive])],
      edges: [edge("E-1", "EL-ORDER")],
    });

    expect(without.hasDestructiveStep).toBe(false);
    expect(withDestructive.hasDestructiveStep).toBe(true);
  });

  it("carries the budget defaults the form should show", () => {
    const requirements = deriveExecutionRequirements({
      scenarios: [scenario("SCN-1", [step(1, "E-1", "EL-SAFE")])],
      screens: [screen("SCR-1", [element({ id: "EL-SAFE" })])],
      edges: [edge("E-1", "EL-SAFE")],
    });

    expect(requirements.budgetDefaults).toEqual({ maxModelCalls: 3, maxScreenshots: 4, timeoutMs: 45_000 });
  });
});
