import { describe, expect, it } from "vitest";
import { auditTransitionCoverage, type TransitionCoverageClaim, type TransitionObligation } from "./transition-coverage-audit.js";

const obligations = [
  { source_action_ref: "EL-submit", branch_ref: "normal:1", scope: "journey", outcome: "normal", feasibility: "source-supported" },
  { source_action_ref: "EL-filter", branch_ref: "normal:1", scope: "view", outcome: "normal", feasibility: "source-supported" },
  { source_action_ref: "EL-submit", branch_ref: "exception:1", scope: "journey", outcome: "exception", feasibility: "runtime-unverified" },
] satisfies TransitionObligation[];

describe("transition coverage audit", () => {
  it("keeps structural coverage, view scope, and runtime feasibility separate", () => {
    const claims = [
      { source_action_ref: "EL-submit", branch_ref: "normal:1", outcome: "normal", edge_ref: "E-0001" },
      { source_action_ref: "EL-unknown", branch_ref: "normal:1", outcome: "normal", case_ref: "CASE-unknown" },
    ] satisfies TransitionCoverageClaim[];

    expect(auditTransitionCoverage(obligations, claims)).toEqual({
      total_obligations: 3,
      covered_obligations: 1,
      coverage_percent: 33.33,
      missing_obligations: [obligations[1], obligations[2]],
      by_scope: {
        journey: { total: 2, covered: 1, missing: 1 },
        view: { total: 1, covered: 0, missing: 1 },
      },
      source_supported: { total: 2, covered: 1, coverage_percent: 50 },
      runtime_unverified_obligations: [obligations[2]],
      unknown_claims: [claims[1]],
    });
  });

  it("rejects duplicate backend obligations", () => {
    expect(() => auditTransitionCoverage([...obligations, obligations[0]], [])).toThrow("TRANSITION_OBLIGATION_DUPLICATE:EL-submit:normal:normal:1");
  });
});
