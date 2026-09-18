import { describe, expect, it } from "vitest";
import type { FactEdge, FactElement, FactScreen, ScenarioRecord } from "@scenarioforge/contracts";
import { compileVisionSteps } from "./vision-step-compiler.js";

const identity = { project_id: "P-1", analysis_run_id: "RUN-1", source_snapshot_id: "SS-1" } as const;

function element(overrides: Partial<FactElement> & { id: string }): FactElement {
  return {
    type: "button",
    label: "로그인",
    interaction: { action_kind: "click", surface_kind: "web", target_candidates: [{ by: "role-name", role: "button", name: "로그인" }] },
    evidence: [],
    ...overrides,
  };
}

function screen(elements: FactElement[]): FactScreen {
  return {
    ...identity,
    schema_version: 3,
    screen_id: "SCR-001",
    route: "/login",
    title: "로그인",
    entry_guards: [],
    elements,
    apis: [],
    feedback: [],
    displays: [],
    status: "verified",
  };
}

function edge(id: string, on: string): FactEdge {
  return { ...identity, schema_version: 2, edge_id: id, kind: "normal", from: "SCR-001", on, to: "SCR-002", feedback: [], evidence: [], status: "verified" };
}

function scenario(steps: ScenarioRecord["steps"]): ScenarioRecord {
  return {
    ...identity,
    schema_version: 2,
    scenario_id: "SCN-0001",
    workflow: "WF-login",
    kind: "normal",
    variation: {},
    preconditions: [],
    path: ["SCR-001", "SCR-002"],
    steps,
    status: "verified",
  };
}

const step = (n: number, edgeId: string, elementId: string, assertions: string[] = ["ASRT-1"]): ScenarioRecord["steps"][number] => ({
  n,
  action: "'로그인' 버튼을 누른다",
  action_ref: { edge: edgeId, element: elementId },
  expected: "대시보드가 표시된다",
  assertion_refs: assertions,
});

describe("vision step compiler", () => {
  it("compiles a press step into a bounded envelope from FACT evidence", () => {
    const result = compileVisionSteps({
      scenario: scenario([step(1, "E-1", "EL-1")]),
      screens: [screen([element({ id: "EL-1" })])],
      edges: [edge("E-1", "EL-1")],
    });

    expect(result.nonAutomatable).toEqual([]);
    expect(result.envelopes).toHaveLength(1);
    const [envelope] = result.envelopes;
    expect(envelope.stepId).toBe("SCN-0001#1");
    expect(envelope.intent).toEqual({ kind: "press" });
    expect(envelope.allowedActions).toEqual(["click"]);
    expect(envelope.assertionRefs).toEqual(["ASRT-1"]);
    expect(envelope.target.visibleLabel).toBe("로그인");
    expect(envelope.target.ambiguityRisk).toBe("low");
    expect(envelope.target.verificationCandidates).toHaveLength(1);
    expect(envelope.riskClass).toBe("reversible-write");
  });

  it("carries the navigate destination from the edge rather than the step text", () => {
    const result = compileVisionSteps({
      scenario: scenario([step(1, "E-1", "EL-1")]),
      screens: [screen([element({ id: "EL-1", interaction: { action_kind: "navigate", surface_kind: "web", target_candidates: [] } })])],
      edges: [edge("E-1", "EL-1")],
    });

    expect(result.envelopes[0]?.intent).toEqual({ kind: "navigate", destinationRef: "SCR-002" });
    expect(result.envelopes[0]?.riskClass).toBe("read");
  });

  it("refuses to guess a value and reports the missing data binding", () => {
    const fillElement = element({ id: "EL-2", type: "textbox", label: "아이디", interaction: { action_kind: "fill", surface_kind: "web", target_candidates: [] } });

    const withoutBinding = compileVisionSteps({
      scenario: scenario([step(1, "E-1", "EL-2")]),
      screens: [screen([fillElement])],
      edges: [edge("E-1", "EL-2")],
    });
    const withBinding = compileVisionSteps({
      scenario: scenario([step(1, "E-1", "EL-2")]),
      screens: [screen([fillElement])],
      edges: [edge("E-1", "EL-2")],
      dataBindingKeys: ["EL-2"],
    });

    expect(withoutBinding.envelopes).toEqual([]);
    expect(withoutBinding.nonAutomatable[0]).toMatchObject({ reason: "MISSING_DATA_BINDING", stepId: "SCN-0001#1" });
    expect(withBinding.envelopes[0]?.intent).toEqual({ kind: "fill", valueRef: "EL-2" });
    expect(withBinding.envelopes[0]?.valueRef).toBe("EL-2");
  });

  it("marks a step non-automatable instead of inventing a target or action", () => {
    const cases: Array<[string, ReturnType<typeof compileVisionSteps>, string]> = [
      [
        "unresolved action kind",
        compileVisionSteps({
          scenario: scenario([step(1, "E-1", "EL-1")]),
          screens: [screen([element({ id: "EL-1", interaction: { action_kind: "unresolved", surface_kind: "web", target_candidates: [] } })])],
          edges: [edge("E-1", "EL-1")],
        }),
        "ACTION_KIND_UNRESOLVED",
      ],
      [
        "unsupported action kind",
        compileVisionSteps({
          scenario: scenario([step(1, "E-1", "EL-1")]),
          screens: [screen([element({ id: "EL-1", interaction: { action_kind: "teleport", surface_kind: "web", target_candidates: [] } })])],
          edges: [edge("E-1", "EL-1")],
        }),
        "ACTION_KIND_UNSUPPORTED",
      ],
      [
        "no visible label to point the model at",
        compileVisionSteps({
          scenario: scenario([step(1, "E-1", "EL-1")]),
          screens: [screen([element({ id: "EL-1", label: "  " })])],
          edges: [edge("E-1", "EL-1")],
        }),
        "NO_VISUAL_TARGET_EVIDENCE",
      ],
      [
        "label repeats on the screen with no candidate to disambiguate",
        compileVisionSteps({
          scenario: scenario([step(1, "E-1", "EL-1")]),
          screens: [
            screen([
              element({ id: "EL-1", interaction: { action_kind: "click", surface_kind: "web", target_candidates: [] } }),
              element({ id: "EL-9", interaction: { action_kind: "click", surface_kind: "web", target_candidates: [] } }),
            ]),
          ],
          edges: [edge("E-1", "EL-1")],
        }),
        "AMBIGUOUS_VISUAL_TARGET",
      ],
      [
        "missing assertion reference",
        compileVisionSteps({
          scenario: scenario([step(1, "E-1", "EL-1", [])]),
          screens: [screen([element({ id: "EL-1" })])],
          edges: [edge("E-1", "EL-1")],
        }),
        "MISSING_ASSERTION_REFERENCE",
      ],
      [
        "unknown edge",
        compileVisionSteps({
          scenario: scenario([step(1, "E-missing", "EL-1")]),
          screens: [screen([element({ id: "EL-1" })])],
          edges: [edge("E-1", "EL-1")],
        }),
        "EDGE_NOT_FOUND",
      ],
      [
        "unknown element",
        compileVisionSteps({
          scenario: scenario([step(1, "E-1", "EL-missing")]),
          screens: [screen([element({ id: "EL-1" })])],
          edges: [edge("E-1", "EL-1")],
        }),
        "ELEMENT_NOT_FOUND",
      ],
    ];

    for (const [name, result, reason] of cases) {
      expect(result.envelopes, name).toEqual([]);
      expect(result.nonAutomatable[0]?.reason, name).toBe(reason);
    }
  });

  it("reports a unique label and its ambiguity risk", () => {
    const result = compileVisionSteps({
      scenario: scenario([step(1, "E-1", "EL-1")]),
      screens: [screen([element({ id: "EL-1" }), element({ id: "EL-9", label: "취소" })])],
      edges: [edge("E-1", "EL-1")],
    });

    expect(result.envelopes[0]?.target.labelUniqueOnSurface).toBe(true);
    expect(result.envelopes[0]?.target.ambiguityRisk).toBe("low");
  });

  it("marks a repeated label as not unique when a candidate can disambiguate it", () => {
    const result = compileVisionSteps({
      scenario: scenario([step(1, "E-1", "EL-1")]),
      screens: [screen([element({ id: "EL-1" }), element({ id: "EL-9" })])],
      edges: [edge("E-1", "EL-1")],
    });

    expect(result.envelopes[0]?.target.labelUniqueOnSurface).toBe(false);
    expect(result.envelopes[0]?.target.ambiguityRisk).toBe("high");
  });

  it("keeps a label-only target at medium ambiguity risk", () => {
    const result = compileVisionSteps({
      scenario: scenario([step(1, "E-1", "EL-1")]),
      screens: [screen([element({ id: "EL-1", interaction: { action_kind: "click", surface_kind: "web", target_candidates: [] } })])],
      edges: [edge("E-1", "EL-1")],
    });

    expect(result.envelopes[0]?.target.ambiguityRisk).toBe("medium");
  });

  it("compiles the automatable steps and reports the rest of the same scenario", () => {
    const result = compileVisionSteps({
      scenario: scenario([step(1, "E-1", "EL-1"), step(2, "E-1", "EL-missing"), step(3, "E-1", "EL-1")]),
      screens: [screen([element({ id: "EL-1" })])],
      edges: [edge("E-1", "EL-1")],
    });

    expect(result.envelopes.map((envelope) => envelope.stepId)).toEqual(["SCN-0001#1", "SCN-0001#3"]);
    expect(result.nonAutomatable.map((entry) => entry.stepId)).toEqual(["SCN-0001#2"]);
  });
});
