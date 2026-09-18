import { describe, expect, it } from "vitest";
import type { FactBundle } from "@scenarioforge/contracts";
import { createSourceTransitionObligationInventory, type SourceInteractionBehavior, validateFactCatalogSourceBehaviors, validateFactSourceBehaviors } from "./source-interaction-behavior.js";

describe("source transition obligation inventory", () => {
  it("keeps a handler-resolved interaction unresolved when no transition scope is established", () => {
    const behavior: SourceInteractionBehavior = {
      element_id: "EL-neutral",
      source_id: "SRC-app",
      path: "src/App.tsx",
      line: 12,
      handler_lines: [12],
      called_symbols: [],
      local_state_keys: [],
      downstream_consumed_state_keys: [],
      literal_navigation_targets: [],
      stable_outcomes: [],
      explicit_failure: false,
      local_view_only: false,
      journey_required: false,
    };

    const inventory = createSourceTransitionObligationInventory({
      source_snapshot_id: "SS-1",
      interactions: [{
        element_id: "EL-neutral",
        kind: "button",
        source_id: "SRC-app",
        line: 12,
        target_candidates: [],
      }],
    }, [behavior]);

    expect(inventory.obligations).toEqual([]);
    expect(inventory.unresolved_interactions).toEqual([{
      source_action_ref: "EL-neutral",
      source_ref: "SRC-app",
      line: 12,
      kind: "button",
    }]);
  });

  it("requires a same-screen FACT transition for a source-backed local view action", () => {
    const behavior: SourceInteractionBehavior = {
      element_id: "EL-filter",
      source_id: "SRC-list",
      path: "src/List.tsx",
      line: 21,
      handler_lines: [21],
      called_symbols: ["setSearch"],
      local_state_keys: ["search"],
      downstream_consumed_state_keys: [],
      literal_navigation_targets: [],
      stable_outcomes: [],
      explicit_failure: false,
      local_view_only: true,
      journey_required: false,
    };
    const facts = {
      schema_version: 2,
      project_id: "P-1",
      analysis_run_id: "RUN-1",
      source_snapshot_id: "SS-1",
      screens: [{
        schema_version: 3,
        project_id: "P-1",
        analysis_run_id: "RUN-1",
        source_snapshot_id: "SS-1",
        screen_id: "SCR-list",
        title: "List",
        entry_guards: [],
        elements: [{ id: "EL-filter", type: "input", label: "Search", interaction: { action_kind: "filter", surface_kind: "web", target_candidates: [] }, evidence: [] }],
        apis: [],
        feedback: [],
        displays: [],
        status: "verified",
      }],
      edges: [],
      predicates: [],
    } satisfies FactBundle;

    expect(validateFactSourceBehaviors(facts, [behavior])).toContainEqual(expect.objectContaining({
      code: "FACT_SOURCE_ACTION_MISSING",
      path: "$.edges[on=EL-filter]",
    }));
  });

  it("accepts a local-view effect whose predicate is the canonical form of a camel-case state key", () => {
    const behavior: SourceInteractionBehavior = {
      element_id: "EL-menu",
      source_id: "SRC-main",
      path: "src/Main.tsx",
      line: 21,
      handler_lines: [21],
      called_symbols: ["setTaskMenuOpen"],
      local_state_keys: ["taskMenuOpen"],
      downstream_consumed_state_keys: [],
      literal_navigation_targets: [],
      stable_outcomes: [],
      explicit_failure: false,
      local_view_only: true,
      journey_required: false,
    };
    const identity = { project_id: "P-1", analysis_run_id: "RUN-1", source_snapshot_id: "SS-1" };
    const evidence = { source_id: "SRC-main", source_snapshot_id: "SS-1", path: "src/Main.tsx", start_line: 21, end_line: 21, content_hash: "sha256:main", evidence_grant_id: "EVG-1" };
    const facts = {
      schema_version: 2,
      ...identity,
      screens: [{
        schema_version: 3,
        ...identity,
        screen_id: "SCR-main",
        title: "Main",
        entry_guards: [],
        elements: [{ id: "EL-menu", type: "button", label: "Menu", interaction: { action_kind: "open_menu", surface_kind: "web", target_candidates: [] }, evidence: [evidence] }],
        apis: [],
        feedback: [],
        displays: [],
        status: "verified",
      }],
      edges: [{ schema_version: 2, ...identity, edge_id: "E-0001", kind: "normal", from: "SCR-main", on: "EL-menu", to: "SCR-main", effect: "PRED-taskmenuopen=true", feedback: [], evidence: [evidence], status: "verified" }],
      predicates: [{ schema_version: 2, ...identity, pred_id: "PRED-taskmenuopen", values: ["true", "false"], source: "code", evidence: [evidence] }],
    } satisfies FactBundle;

    expect(validateFactSourceBehaviors(facts, [behavior]).map((issue) => issue.code)).not.toContain("FACT_LOCAL_VIEW_EFFECT_UNSUPPORTED");
  });
});

describe("unsatisfiable unresolved-feasibility actions", () => {
  const behavior = (feasibility: SourceInteractionBehavior["feasibility"]): SourceInteractionBehavior => ({
    element_id: "EL-shell-button-home",
    source_id: "SRC-app",
    path: "src/Main.jsx",
    line: 98,
    handler_lines: [98],
    called_symbols: [],
    local_state_keys: [],
    downstream_consumed_state_keys: [],
    literal_navigation_targets: [],
    stable_outcomes: [],
    explicit_failure: false,
    local_view_only: false,
    journey_required: true,
    feasibility,
  });

  const facts: Pick<FactBundle, "screens" | "predicates"> = {
    screens: [{
      schema_version: 3,
      project_id: "PRJ-1", analysis_run_id: "RUN-1", source_snapshot_id: "SNAP-1",
      screen_id: "SCR-main", title: "Main", entry_guards: [], status: "draft",
      elements: [{
        id: "EL-shell-button-home", type: "button", label: "홈으로",
        interaction: { action_kind: "unresolved", surface_kind: "web", target_candidates: [] },
        evidence: [],
      }],
      apis: [], feedback: [], displays: [],
    }],
    predicates: [],
  };

  it("does not demand a resolved action when the contract forbids the edge that would resolve it", () => {
    expect(validateFactCatalogSourceBehaviors(facts, [behavior("unresolved")])
      .filter((issue) => issue.code === "FACT_SOURCE_ACTION_UNRESOLVED")).toEqual([]);
  });

  it("still demands a resolved action when the source behavior is resolvable", () => {
    expect(validateFactCatalogSourceBehaviors(facts, [behavior("verified")])
      .map((issue) => issue.code)).toContain("FACT_SOURCE_ACTION_UNRESOLVED");
  });
});

describe("journey actions must leave the screen or leave a lasting result", () => {
  const behavior = (overrides: Partial<SourceInteractionBehavior> = {}): SourceInteractionBehavior => ({
    element_id: "EL-login-button-submit",
    source_id: "SRC-login",
    path: "src/Login.jsx",
    line: 40,
    handler_lines: [40],
    called_symbols: ["dispatch"],
    local_state_keys: [],
    downstream_consumed_state_keys: [],
    literal_navigation_targets: [],
    stable_outcomes: [],
    explicit_failure: false,
    local_view_only: false,
    journey_required: true,
    feasibility: "verified",
    view_state: { screen_id: "SCR-login", states: [{ key: "loading", facet: "loading" }] },
    branches: [{ branch_ref: "normal:1", outcome: "normal", guard_keys: [], feasibility: "verified", source_refs: ["SRC-login"] }],
    source_refs: ["SRC-login"],
    ...overrides,
  }) as SourceInteractionBehavior;

  const factsWith = (to: string): FactBundle => ({
    schema_version: 2, project_id: "PRJ-1", analysis_run_id: "RUN-1", source_snapshot_id: "SNAP-1",
    screens: [
      { schema_version: 3, project_id: "PRJ-1", analysis_run_id: "RUN-1", source_snapshot_id: "SNAP-1", screen_id: "SCR-login", route: "/login", title: "Login", entry_guards: [], status: "draft",
        elements: [{ id: "EL-login-button-submit", type: "button", label: "Sign in", interaction: { action_kind: "submit login", surface_kind: "web", target_candidates: [] }, evidence: [] }],
        apis: [], feedback: [], displays: [] },
      { schema_version: 3, project_id: "PRJ-1", analysis_run_id: "RUN-1", source_snapshot_id: "SNAP-1", screen_id: "SCR-home", route: "/home", title: "Home", entry_guards: [], status: "draft", elements: [], apis: [], feedback: [], displays: [] },
    ],
    edges: [{ schema_version: 2, project_id: "PRJ-1", analysis_run_id: "RUN-1", source_snapshot_id: "SNAP-1", edge_id: "E-0001", source_branch_ref: "normal:1", kind: "normal", from: "SCR-login", on: "EL-login-button-submit", to, feedback: [], evidence: [], status: "draft" }],
    predicates: [],
  });

  it("rejects a journey action whose only normal edge loops back with no lasting result", () => {
    expect(validateFactSourceBehaviors(factsWith("SCR-login"), [behavior()]).map((issue) => issue.code))
      .toContain("FACT_JOURNEY_ACTION_SELF_LOOP_ONLY");
  });

  it("accepts the same action once it leaves the screen", () => {
    expect(validateFactSourceBehaviors(factsWith("SCR-home"), [behavior()]).map((issue) => issue.code))
      .not.toContain("FACT_JOURNEY_ACTION_SELF_LOOP_ONLY");
  });

  it("accepts an in-screen journey action that produces a stable outcome", () => {
    expect(validateFactSourceBehaviors(factsWith("SCR-login"), [behavior({ stable_outcomes: ["csv.downloaded"] })]).map((issue) => issue.code))
      .not.toContain("FACT_JOURNEY_ACTION_SELF_LOOP_ONLY");
  });
});
