export type TransitionScope = "journey" | "view";
export type TransitionOutcome = "normal" | "exception";
export type TransitionFeasibility = "source-supported" | "runtime-unverified";

export type TransitionObligation = {
  source_action_ref: string;
  branch_ref: string;
  scope: TransitionScope;
  outcome: TransitionOutcome;
  feasibility: TransitionFeasibility;
};

export type TransitionCoverageClaim = {
  source_action_ref: string;
  branch_ref: string;
  outcome: TransitionOutcome;
  edge_ref?: string;
  case_ref?: string;
};

export type TransitionCoverageAudit = {
  total_obligations: number;
  covered_obligations: number;
  coverage_percent: number;
  missing_obligations: TransitionObligation[];
  by_scope: Record<TransitionScope, { total: number; covered: number; missing: number }>;
  source_supported: { total: number; covered: number; coverage_percent: number };
  runtime_unverified_obligations: TransitionObligation[];
  unknown_claims: TransitionCoverageClaim[];
};

const obligationKey = (value: Pick<TransitionObligation, "source_action_ref" | "branch_ref" | "outcome">): string =>
  `${value.source_action_ref}:${value.outcome}:${value.branch_ref}`;

const percentage = (covered: number, total: number): number =>
  total === 0 ? 100 : Math.round((covered / total) * 10_000) / 100;

export function auditTransitionCoverage(
  obligations: readonly TransitionObligation[],
  claims: readonly TransitionCoverageClaim[],
): TransitionCoverageAudit {
  const obligationByKey = new Map<string, TransitionObligation>();
  for (const obligation of obligations) {
    const key = obligationKey(obligation);
    if (obligationByKey.has(key)) throw new Error(`TRANSITION_OBLIGATION_DUPLICATE:${key}`);
    obligationByKey.set(key, obligation);
  }

  const coveredKeys = new Set(claims.map(obligationKey).filter((key) => obligationByKey.has(key)));
  const missingObligations = obligations.filter((obligation) => !coveredKeys.has(obligationKey(obligation)));
  const scopeReport = (scope: TransitionScope) => {
    const scoped = obligations.filter((obligation) => obligation.scope === scope);
    const covered = scoped.filter((obligation) => coveredKeys.has(obligationKey(obligation))).length;
    return { total: scoped.length, covered, missing: scoped.length - covered };
  };
  const sourceSupported = obligations.filter((obligation) => obligation.feasibility === "source-supported");
  const sourceSupportedCovered = sourceSupported.filter((obligation) => coveredKeys.has(obligationKey(obligation))).length;

  return {
    total_obligations: obligations.length,
    covered_obligations: coveredKeys.size,
    coverage_percent: percentage(coveredKeys.size, obligations.length),
    missing_obligations: missingObligations,
    by_scope: { journey: scopeReport("journey"), view: scopeReport("view") },
    source_supported: {
      total: sourceSupported.length,
      covered: sourceSupportedCovered,
      coverage_percent: percentage(sourceSupportedCovered, sourceSupported.length),
    },
    runtime_unverified_obligations: obligations.filter((obligation) => obligation.feasibility === "runtime-unverified"),
    unknown_claims: claims.filter((claim) => !obligationByKey.has(obligationKey(claim))),
  };
}
