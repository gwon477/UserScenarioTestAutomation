import type { EvidenceReference, FactBundle, ScenarioSet } from "@scenarioforge/contracts";
import { isDeepStrictEqual } from "node:util";
import type { EvidenceGrant } from "../security/evidence-grant-service.js";

export type SourceCitation = EvidenceReference;

export type JourneyCandidate = {
  schema_version: 1;
  project_name: string;
  classifications: Array<{
    classification_id: string;
    label: string;
    description: string;
    workflow_refs: string[];
    evidence: SourceCitation[];
  }>;
  workflows: Array<{
    workflow_id: string;
    classification_ref: string;
    goal: string;
    personas: string[];
    entry: string;
    normal_terminal: string;
    failure_terminals: string[];
    variation_axes: string[];
    evidence: SourceCitation[];
  }>;
  journeys: Array<{
    journey_id: string;
    kind: "normal" | "recovery" | "cross-persona";
    goal: string;
    classification_refs: string[];
    segments: Array<{
      segment_id: string;
      persona: string;
      entry: string;
      workflow_refs: string[];
      milestones: Array<{
        milestone_id: string;
        workflow_ref: string;
        action: string;
        outcome: string;
        evidence: SourceCitation[];
      }>;
      state_handoffs: Array<{
        key: string;
        produced_by: string;
        consumed_by: string;
        evidence: SourceCitation[];
      }>;
      terminal: string;
    }>;
    business_outcome: { description: string; evidence: SourceCitation[] };
    exit: { kind: "logout" | "handoff" | "process-end"; action: string; outcome: string; evidence: SourceCitation[] };
    recovery?: { failure_milestone_ref: string; rejoin_milestone_ref: string };
  }>;
  unresolved: Array<{ description: string; evidence?: SourceCitation[] }>;
};

export type GoldenDatasetSummary = {
  projectPrefix: string;
  counts: {
    classifications: number;
    workflows: number;
    transitions: number;
    scenarios: number;
    journeys: number;
  };
  classificationIds: string[];
  workflowIds: string[];
  transitionIds: string[];
  scenarioIds: string[];
  scenarioKinds?: Array<{
    scenarioId: string;
    kinds: Array<"normal" | "boundary" | "exception" | "recovery">;
  }>;
  journeys: Array<{
    journeyId: string;
    purpose: string;
    route: string;
    scenarioRefs: string[];
    verdict: string;
    required: boolean;
    kind: "normal" | "recovery";
  }>;
};

export type GoldenSemanticAssessment = {
  schema_version: 1;
  classification_matches: SemanticMatch[];
  workflow_matches: SemanticMatch[];
  journey_matches: SemanticMatch[];
  critical_gaps: string[];
};

export type GoldenScenarioAssessment = {
  schema_version: 1;
  scenario_matches: SemanticMatch[];
  critical_gaps: string[];
};

export type GoldenScenarioPriorityMatch = {
  golden_ref: string;
  candidate_refs: string[];
  score: number;
  success_candidate_refs: string[];
  success_score: number | null;
  resilience_candidate_refs: string[];
  resilience_score: number | null;
  rationale: string;
};

export type GoldenScenarioPriorityAssessment = { schema_version: 1; scenario_matches: GoldenScenarioPriorityMatch[] };

export type GoldenScenarioAssessmentCorrectionPlan = {
  schema_version: 1;
  target_golden_refs: string[];
  targets: Array<{
    golden_ref: string;
    fields: string[];
    unknown_candidate_refs: string[];
    suggested_candidate_refs: string[];
  }>;
};

export function createGoldenScenarioAssessmentCorrectionPlan(
  assessment: GoldenScenarioPriorityAssessment,
  golden: GoldenDatasetSummary,
  allowedCandidateRefs: Iterable<string>,
): GoldenScenarioAssessmentCorrectionPlan {
  const expected = new Set(golden.scenarioIds);
  const allowed = [...new Set(allowedCandidateRefs)].sort();
  const allowedSet = new Set(allowed);
  const targets = new Map<string, GoldenScenarioAssessmentCorrectionPlan["targets"][number]>();
  const seen = new Set<string>();
  const target = (goldenRef: string) => {
    const existing = targets.get(goldenRef);
    if (existing) return existing;
    const created = { golden_ref: goldenRef, fields: [], unknown_candidate_refs: [], suggested_candidate_refs: [] };
    targets.set(goldenRef, created);
    return created;
  };
  for (const row of assessment.scenario_matches) {
    if (!expected.has(row.golden_ref) || seen.has(row.golden_ref)) throw new Error("GOLDEN_SCENARIO_CORRECTION_TARGET_UNRESOLVED");
    seen.add(row.golden_ref);
    for (const field of ["candidate_refs", "success_candidate_refs", "resilience_candidate_refs"] as const) {
      const unknown = row[field].filter((reference) => !allowedSet.has(reference));
      if (!unknown.length) continue;
      const entry = target(row.golden_ref);
      entry.fields.push(field);
      entry.unknown_candidate_refs.push(...unknown);
      for (const reference of unknown) {
        const suffix = reference.split("-").slice(-2).join("-");
        entry.suggested_candidate_refs.push(...allowed.filter((candidate) => candidate.endsWith(suffix)));
      }
    }
  }
  for (const goldenRef of golden.scenarioIds) {
    if (!seen.has(goldenRef)) target(goldenRef).fields.push("scenario_match");
  }
  const orderedTargets = golden.scenarioIds.filter((goldenRef) => targets.has(goldenRef)).map((goldenRef) => {
    const entry = targets.get(goldenRef)!;
    return {
      ...entry,
      fields: [...new Set(entry.fields)].sort(),
      unknown_candidate_refs: [...new Set(entry.unknown_candidate_refs)].sort(),
      suggested_candidate_refs: [...new Set(entry.suggested_candidate_refs)].sort(),
    };
  });
  return { schema_version: 1, target_golden_refs: orderedTargets.map((entry) => entry.golden_ref), targets: orderedTargets };
}

export function applyGoldenScenarioAssessmentCorrectionPatch(
  assessment: GoldenScenarioPriorityAssessment,
  patch: GoldenScenarioPriorityAssessment,
  plan: GoldenScenarioAssessmentCorrectionPlan,
): GoldenScenarioPriorityAssessment {
  if (patch?.schema_version !== 1 || !Array.isArray(patch.scenario_matches)) throw new Error("GOLDEN_SCENARIO_CORRECTION_PATCH_INVALID");
  const targetRefs = new Set(plan.target_golden_refs);
  const targetByRef = new Map(plan.targets.map((target) => [target.golden_ref, target]));
  const correctableFields = new Set(["scenario_match", "candidate_refs", "score", "success_candidate_refs", "success_score", "resilience_candidate_refs", "resilience_score", "rationale"]);
  if (plan.targets.length !== targetRefs.size || plan.targets.some((target) => !targetRefs.has(target.golden_ref)
    || target.fields.some((field) => !correctableFields.has(field)))) {
    throw new Error("GOLDEN_SCENARIO_CORRECTION_PLAN_INVALID");
  }
  const priorByRef = new Map(assessment.scenario_matches.map((row) => [row.golden_ref, row]));
  const updates = new Map<string, GoldenScenarioPriorityMatch>();
  for (const row of patch.scenario_matches) {
    if (!targetRefs.has(row.golden_ref) || updates.has(row.golden_ref)) throw new Error("GOLDEN_SCENARIO_CORRECTION_PATCH_SCOPE_INVALID");
    const prior = priorByRef.get(row.golden_ref);
    const fields = new Set(targetByRef.get(row.golden_ref)?.fields ?? []);
    if (prior && !fields.has("scenario_match")) {
      for (const field of ["candidate_refs", "score", "success_candidate_refs", "success_score", "resilience_candidate_refs", "resilience_score", "rationale"] as const) {
        if (!fields.has(field) && !isDeepStrictEqual(row[field], prior[field])) throw new Error(`GOLDEN_SCENARIO_CORRECTION_PATCH_FIELD_SCOPE_INVALID:${row.golden_ref}:${field}`);
      }
    }
    updates.set(row.golden_ref, row);
  }
  if (updates.size !== targetRefs.size) throw new Error("GOLDEN_SCENARIO_CORRECTION_PATCH_INCOMPLETE");
  const present = new Set<string>();
  const scenarioMatches = assessment.scenario_matches.map((row) => {
    const update = updates.get(row.golden_ref);
    if (!update) return row;
    present.add(row.golden_ref);
    return update;
  });
  for (const goldenRef of plan.target_golden_refs) {
    if (!present.has(goldenRef)) scenarioMatches.push(updates.get(goldenRef)!);
  }
  return { schema_version: 1, scenario_matches: scenarioMatches };
}

export type SemanticMatch = {
  golden_ref: string;
  candidate_refs: string[];
  score: number;
  rationale: string;
};

const unquote = (value: string): string => value.trim().replace(/^`|`$/g, "");

function uniqueMatches(markdown: string, pattern: RegExp): string[] {
  return [...new Set([...markdown.matchAll(pattern)].map((match) => match[1]))];
}

export function parseGoldenDatasetMarkdown(markdown: string): GoldenDatasetSummary {
  const journeyIds = uniqueMatches(markdown, /^\|\s*`?([A-Z][A-Z0-9]*-J-\d+)`?\s*\|/gm);
  const projectPrefix = journeyIds[0]?.match(/^([A-Z][A-Z0-9]*)-/)?.[1];
  if (!projectPrefix) throw new Error("GOLDEN_DATASET_PROJECT_PREFIX_NOT_FOUND");
  const escaped = projectPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const classificationIds = uniqueMatches(markdown, new RegExp("^\\|\\s*`?(" + escaped + "-BC-\\d+)`?\\s*\\|", "gm"));
  const workflowIds = uniqueMatches(markdown, new RegExp("^###\\s+`(" + escaped + "-WF-\\d+)`", "gm"));
  const transitionIds = uniqueMatches(markdown, new RegExp("^\\|\\s*`?(" + escaped + "-E-\\d+)`?\\s*\\|", "gm"));
  const scenarioIds = uniqueMatches(markdown, new RegExp("^####\\s+`(" + escaped + "-SCN-\\d+)`", "gm"));
  const scenarioKinds = scenarioIds.map((scenarioId) => {
    const heading = new RegExp("^####\\s+`" + scenarioId + "`", "m").exec(markdown);
    if (!heading) throw new Error(`GOLDEN_SCENARIO_DEFINITION_NOT_FOUND:${scenarioId}`);
    const blockStart = heading.index;
    const nextHeading = markdown.slice(blockStart + heading[0].length).search(/^####\s+`|^##\s+/m);
    const blockEnd = nextHeading < 0 ? markdown.length : blockStart + heading[0].length + nextHeading;
    const kindLine = markdown.slice(blockStart, blockEnd).match(/^-\s+[^\n]*kind:\s*(.+)$/m)?.[1] ?? "";
    const kinds = [...new Set(kindLine.match(/normal|boundary|exception|recovery/g) ?? [])] as Array<"normal" | "boundary" | "exception" | "recovery">;
    if (!kinds.length) throw new Error(`GOLDEN_SCENARIO_KIND_NOT_FOUND:${scenarioId}`);
    return { scenarioId, kinds };
  });
  const journeys = new Map<string, GoldenDatasetSummary["journeys"][number]>();
  for (const line of markdown.split(/\r?\n/)) {
    if (!new RegExp("^\\|\\s*`?" + escaped + "-J-\\d+").test(line)) continue;
    const cells = line.slice(1, line.endsWith("|") ? -1 : undefined).split("|").map(unquote);
    const journeyId = cells[0];
    if (journeys.has(journeyId)) continue;
    const verdict = cells[4] ?? "";
    journeys.set(journeyId, {
      journeyId,
      purpose: cells[1] ?? "",
      route: cells[2] ?? "",
      scenarioRefs: [...new Set((cells[3] ?? "").match(new RegExp(`${escaped}-SCN-\\d+`, "g")) ?? [])],
      verdict,
      required: verdict.includes("필수"),
      kind: verdict.includes("복구") || (cells[1] ?? "").includes("복구") ? "recovery" : "normal",
    });
  }
  return {
    projectPrefix,
    counts: {
      classifications: classificationIds.length,
      workflows: workflowIds.length,
      transitions: transitionIds.length,
      scenarios: scenarioIds.length,
      journeys: journeys.size,
    },
    classificationIds,
    workflowIds,
    transitionIds,
    scenarioIds,
    scenarioKinds,
    journeys: [...journeys.values()],
  };
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function semanticMatches(value: unknown, issue: string, issues: string[]): SemanticMatch[] {
  if (!Array.isArray(value)) {
    issues.push(issue);
    return [];
  }
  return value.filter((entry): entry is SemanticMatch => (
    record(entry)
    && typeof entry.golden_ref === "string"
    && Array.isArray(entry.candidate_refs)
    && entry.candidate_refs.every((candidateRef) => typeof candidateRef === "string")
    && typeof entry.score === "number"
    && Number.isFinite(entry.score)
  ));
}

function recall(expected: string[], matches: SemanticMatch[], threshold: number): number {
  if (!expected.length) return 1;
  const expectedSet = new Set(expected);
  const matched = new Set(matches
    .filter((entry) => expectedSet.has(entry.golden_ref) && entry.candidate_refs.length > 0 && entry.score >= threshold)
    .map((entry) => entry.golden_ref));
  return matched.size / expected.length;
}

export function evaluateGoldenSimilarity(
  golden: GoldenDatasetSummary,
  assessment: GoldenSemanticAssessment,
  threshold = 0.7,
  candidate?: JourneyCandidate,
): {
  passed: boolean;
  classificationRecall: number;
  workflowRecall: number;
  requiredJourneyRecall: number;
  criticalGaps: string[];
} {
  const assessmentIssues: string[] = [];
  if (assessment?.schema_version !== 1) assessmentIssues.push("ASSESSMENT_SCHEMA_VERSION_INVALID");
  const classificationMatches = semanticMatches(assessment?.classification_matches, "ASSESSMENT_CLASSIFICATION_MATCHES_INVALID", assessmentIssues);
  const workflowMatches = semanticMatches(assessment?.workflow_matches, "ASSESSMENT_WORKFLOW_MATCHES_INVALID", assessmentIssues);
  const journeyMatches = semanticMatches(assessment?.journey_matches, "ASSESSMENT_JOURNEY_MATCHES_INVALID", assessmentIssues);
  const suppliedCriticalGaps = Array.isArray(assessment?.critical_gaps)
    ? assessment.critical_gaps.filter((gap): gap is string => typeof gap === "string" && Boolean(gap.trim()))
    : (assessmentIssues.push("ASSESSMENT_CRITICAL_GAPS_INVALID"), []);
  const requiredJourneys = golden.journeys.filter((journey) => journey.required);
  const classificationRecall = recall(golden.classificationIds, classificationMatches, threshold);
  const workflowRecall = recall(golden.workflowIds, workflowMatches, threshold);
  const candidateKinds = new Map((Array.isArray(candidate?.journeys) ? candidate.journeys : [])
    .filter((journey) => record(journey) && typeof journey.journey_id === "string")
    .map((journey) => [journey.journey_id, journey.kind]));
  const eligibleByGolden = new Map(requiredJourneys.map((journey) => {
    const candidates = journeyMatches
      .filter((match) => match.golden_ref === journey.journeyId && match.score >= threshold)
      .flatMap((match) => match.candidate_refs)
      .filter((candidateRef) => !candidate || candidateKinds.get(candidateRef) === journey.kind);
    return [journey.journeyId, [...new Set(candidates)]] as const;
  }));
  const matchedGoldenByCandidate = new Map<string, string>();
  const matchJourney = (goldenId: string, visited: Set<string>): boolean => {
    for (const candidateRef of eligibleByGolden.get(goldenId) ?? []) {
      if (visited.has(candidateRef)) continue;
      visited.add(candidateRef);
      const existingGolden = matchedGoldenByCandidate.get(candidateRef);
      if (!existingGolden || matchJourney(existingGolden, visited)) {
        matchedGoldenByCandidate.set(candidateRef, goldenId);
        return true;
      }
    }
    return false;
  };
  const matchedRequiredJourneys = requiredJourneys.filter((journey) => matchJourney(journey.journeyId, new Set())).length;
  const requiredJourneyRecall = requiredJourneys.length ? matchedRequiredJourneys / requiredJourneys.length : 1;
  const criticalGaps = [...new Set([...assessmentIssues, ...suppliedCriticalGaps])];
  return {
    passed: classificationRecall >= 0.8 && workflowRecall >= 0.8 && requiredJourneyRecall === 1 && criticalGaps.length === 0,
    classificationRecall,
    workflowRecall,
    requiredJourneyRecall,
    criticalGaps,
  };
}

export function evaluateGoldenScenarioSimilarity(
  golden: GoldenDatasetSummary,
  assessment: GoldenScenarioAssessment,
  matchThreshold = 0.7,
  requiredRecall = 0.8,
): {
  passed: boolean;
  scenarioRecall: number;
  matchedScenarioCount: number;
  totalGoldenScenarios: number;
  unmatchedGoldenScenarioIds: string[];
  criticalGaps: string[];
} {
  const assessmentIssues: string[] = [];
  if (assessment?.schema_version !== 1) assessmentIssues.push("ASSESSMENT_SCHEMA_VERSION_INVALID");
  const scenarioMatches = semanticMatches(assessment?.scenario_matches, "ASSESSMENT_SCENARIO_MATCHES_INVALID", assessmentIssues);
  const suppliedCriticalGaps = Array.isArray(assessment?.critical_gaps)
    ? assessment.critical_gaps.filter((gap): gap is string => typeof gap === "string" && Boolean(gap.trim()))
    : (assessmentIssues.push("ASSESSMENT_CRITICAL_GAPS_INVALID"), []);
  const expected = new Set(golden.scenarioIds);
  const seen = new Set<string>();
  for (const match of scenarioMatches) {
    if (seen.has(match.golden_ref)) assessmentIssues.push(`ASSESSMENT_SCENARIO_MATCH_DUPLICATE:${match.golden_ref}`);
    seen.add(match.golden_ref);
    if (!expected.has(match.golden_ref)) assessmentIssues.push(`ASSESSMENT_SCENARIO_MATCH_UNKNOWN:${match.golden_ref}`);
    if (match.score < 0 || match.score > 1) assessmentIssues.push(`ASSESSMENT_SCENARIO_SCORE_INVALID:${match.golden_ref}`);
  }

  const eligibleByGolden = new Map(golden.scenarioIds.map((scenarioId) => {
    const candidates = scenarioMatches
      .filter((match) => match.golden_ref === scenarioId && match.score >= matchThreshold && match.score <= 1)
      .flatMap((match) => match.candidate_refs);
    return [scenarioId, [...new Set(candidates)]] as const;
  }));
  const matchedGoldenByCandidate = new Map<string, string>();
  const matchScenario = (goldenId: string, visited: Set<string>): boolean => {
    for (const candidateRef of eligibleByGolden.get(goldenId) ?? []) {
      if (visited.has(candidateRef)) continue;
      visited.add(candidateRef);
      const existingGolden = matchedGoldenByCandidate.get(candidateRef);
      if (!existingGolden || matchScenario(existingGolden, visited)) {
        matchedGoldenByCandidate.set(candidateRef, goldenId);
        return true;
      }
    }
    return false;
  };
  const matchedGolden = new Set(golden.scenarioIds.filter((scenarioId) => matchScenario(scenarioId, new Set())));
  const totalGoldenScenarios = golden.scenarioIds.length;
  const matchedScenarioCount = matchedGolden.size;
  const scenarioRecall = totalGoldenScenarios ? matchedScenarioCount / totalGoldenScenarios : 1;
  const criticalGaps = [...new Set([...assessmentIssues, ...suppliedCriticalGaps])];
  return {
    passed: scenarioRecall >= requiredRecall && criticalGaps.length === 0,
    scenarioRecall,
    matchedScenarioCount,
    totalGoldenScenarios,
    unmatchedGoldenScenarioIds: golden.scenarioIds.filter((scenarioId) => !matchedGolden.has(scenarioId)),
    criticalGaps,
  };
}

function maximumMatchedGolden(
  goldenIds: string[],
  candidateRefs: (goldenId: string) => string[],
): Set<string> {
  const matchedGoldenByCandidate = new Map<string, string>();
  const match = (goldenId: string, visited: Set<string>): boolean => {
    for (const candidateRef of candidateRefs(goldenId)) {
      if (visited.has(candidateRef)) continue;
      visited.add(candidateRef);
      const existingGolden = matchedGoldenByCandidate.get(candidateRef);
      if (!existingGolden || match(existingGolden, visited)) {
        matchedGoldenByCandidate.set(candidateRef, goldenId);
        return true;
      }
    }
    return false;
  };
  return new Set(goldenIds.filter((goldenId) => match(goldenId, new Set())));
}

export function evaluateGoldenScenarioPriority(
  golden: GoldenDatasetSummary,
  assessment: GoldenScenarioPriorityAssessment,
  matchThreshold = 0.7,
  requiredSuccessRecall = 0.8,
): {
  passed: boolean;
  successScenarioRecall: number;
  matchedSuccessScenarioCount: number;
  totalSuccessScenarios: number;
  unmatchedSuccessScenarioIds: string[];
  resilienceScenarioRecall: number;
  matchedResilienceScenarioCount: number;
  totalResilienceScenarios: number;
  unmatchedResilienceScenarioIds: string[];
  assessmentIssues: string[];
} {
  const issues: string[] = [];
  if (assessment?.schema_version !== 1) issues.push("ASSESSMENT_SCHEMA_VERSION_INVALID");
  const expected = new Set(golden.scenarioIds);
  const kindEntries = Array.isArray(golden.scenarioKinds) ? golden.scenarioKinds : [];
  const kindByScenario = new Map<string, Set<string>>();
  for (const entry of kindEntries) {
    if (!expected.has(entry.scenarioId)) issues.push(`GOLDEN_SCENARIO_KIND_UNKNOWN:${entry.scenarioId}`);
    if (kindByScenario.has(entry.scenarioId)) issues.push(`GOLDEN_SCENARIO_KIND_DUPLICATE:${entry.scenarioId}`);
    kindByScenario.set(entry.scenarioId, new Set(entry.kinds));
  }
  for (const scenarioId of golden.scenarioIds) {
    if (!kindByScenario.has(scenarioId)) issues.push(`GOLDEN_SCENARIO_KIND_MISSING:${scenarioId}`);
  }

  const rows = Array.isArray(assessment?.scenario_matches) ? assessment.scenario_matches : [];
  if (!Array.isArray(assessment?.scenario_matches)) issues.push("ASSESSMENT_SCENARIO_MATCHES_INVALID");
  const rowByGolden = new Map<string, GoldenScenarioPriorityAssessment["scenario_matches"][number]>();
  const validScore = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
  for (const row of rows) {
    if (!record(row) || typeof row.golden_ref !== "string"
      || !Array.isArray(row.candidate_refs) || row.candidate_refs.some((ref) => typeof ref !== "string")
      || !validScore(row.score)
      || !Array.isArray(row.success_candidate_refs) || row.success_candidate_refs.some((ref) => typeof ref !== "string")
      || !Array.isArray(row.resilience_candidate_refs) || row.resilience_candidate_refs.some((ref) => typeof ref !== "string")
      || !(row.success_score === null || validScore(row.success_score))
      || !(row.resilience_score === null || validScore(row.resilience_score))) {
      issues.push("ASSESSMENT_SCENARIO_MATCHES_INVALID");
      continue;
    }
    if (!expected.has(row.golden_ref)) issues.push(`ASSESSMENT_SCENARIO_MATCH_UNKNOWN:${row.golden_ref}`);
    if (rowByGolden.has(row.golden_ref)) issues.push(`ASSESSMENT_SCENARIO_MATCH_DUPLICATE:${row.golden_ref}`);
    rowByGolden.set(row.golden_ref, row);
  }
  for (const scenarioId of golden.scenarioIds) {
    if (!rowByGolden.has(scenarioId)) issues.push(`ASSESSMENT_SCENARIO_MATCH_MISSING:${scenarioId}`);
    const row = rowByGolden.get(scenarioId);
    const kinds = kindByScenario.get(scenarioId) ?? new Set<string>();
    const hasSuccess = kinds.has("normal");
    const hasResilience = [...kinds].some((kind) => ["boundary", "exception", "recovery"].includes(kind));
    if (row && !hasSuccess && (row.success_score !== null || row.success_candidate_refs.length)) issues.push(`ASSESSMENT_SUCCESS_NOT_APPLICABLE_INVALID:${scenarioId}`);
    if (row && !hasResilience && (row.resilience_score !== null || row.resilience_candidate_refs.length)) issues.push(`ASSESSMENT_RESILIENCE_NOT_APPLICABLE_INVALID:${scenarioId}`);
    if (row && hasSuccess && row.success_score === null) issues.push(`ASSESSMENT_SUCCESS_SCORE_MISSING:${scenarioId}`);
    if (row && hasResilience && row.resilience_score === null) issues.push(`ASSESSMENT_RESILIENCE_SCORE_MISSING:${scenarioId}`);
  }

  const successIds = golden.scenarioIds.filter((scenarioId) => kindByScenario.get(scenarioId)?.has("normal"));
  const resilienceIds = golden.scenarioIds.filter((scenarioId) => [...(kindByScenario.get(scenarioId) ?? [])]
    .some((kind) => ["boundary", "exception", "recovery"].includes(kind)));
  const successMatched = maximumMatchedGolden(successIds, (scenarioId) => {
    const row = rowByGolden.get(scenarioId);
    return row && row.success_score !== null && row.success_score >= matchThreshold ? [...new Set(row.success_candidate_refs)] : [];
  });
  const resilienceMatched = maximumMatchedGolden(resilienceIds, (scenarioId) => {
    const row = rowByGolden.get(scenarioId);
    return row && row.resilience_score !== null && row.resilience_score >= matchThreshold ? [...new Set(row.resilience_candidate_refs)] : [];
  });
  const successScenarioRecall = successIds.length ? successMatched.size / successIds.length : 1;
  const resilienceScenarioRecall = resilienceIds.length ? resilienceMatched.size / resilienceIds.length : 1;
  const assessmentIssues = [...new Set(issues)];
  return {
    passed: successScenarioRecall >= requiredSuccessRecall && assessmentIssues.length === 0,
    successScenarioRecall,
    matchedSuccessScenarioCount: successMatched.size,
    totalSuccessScenarios: successIds.length,
    unmatchedSuccessScenarioIds: successIds.filter((scenarioId) => !successMatched.has(scenarioId)),
    resilienceScenarioRecall,
    matchedResilienceScenarioCount: resilienceMatched.size,
    totalResilienceScenarios: resilienceIds.length,
    unmatchedResilienceScenarioIds: resilienceIds.filter((scenarioId) => !resilienceMatched.has(scenarioId)),
    assessmentIssues,
  };
}

export type JourneyCandidateEvaluation = {
  valid: boolean;
  issues: string[];
  completeJourneyIds: string[];
  counts: { classifications: number; workflows: number; journeys: number };
};

function nonEmpty(value: unknown): boolean {
  return typeof value === "string" && Boolean(value.trim());
}

export async function evaluateJourneyCandidate(grant: EvidenceGrant, candidate: JourneyCandidate): Promise<JourneyCandidateEvaluation> {
  const issues: string[] = [];
  if (candidate?.schema_version !== 1) issues.push("CANDIDATE_SCHEMA_VERSION_INVALID");
  if (!nonEmpty(candidate?.project_name)) issues.push("CANDIDATE_PROJECT_NAME_INVALID");
  if (grant?.schema_version !== 1 || !nonEmpty(grant?.evidence_grant_id) || !nonEmpty(grant?.source_snapshot_id)) issues.push("EVIDENCE_GRANT_INVALID");
  const classificationInput = Array.isArray(candidate?.classifications) ? candidate.classifications as unknown[] : [];
  const workflowInput = Array.isArray(candidate?.workflows) ? candidate.workflows as unknown[] : [];
  const journeyInput = Array.isArray(candidate?.journeys) ? candidate.journeys as unknown[] : [];
  if (!Array.isArray(candidate?.classifications)) issues.push("CANDIDATE_CLASSIFICATIONS_INVALID");
  if (!Array.isArray(candidate?.workflows)) issues.push("CANDIDATE_WORKFLOWS_INVALID");
  if (!Array.isArray(candidate?.journeys)) issues.push("CANDIDATE_JOURNEYS_INVALID");
  const candidateClassifications = classificationInput.filter((entry, index): entry is JourneyCandidate["classifications"][number] => {
    if (record(entry)) return true;
    issues.push(`CANDIDATE_CLASSIFICATION_ENTRY_INVALID:${index}`);
    return false;
  });
  const candidateWorkflows = workflowInput.filter((entry, index): entry is JourneyCandidate["workflows"][number] => {
    if (record(entry)) return true;
    issues.push(`CANDIDATE_WORKFLOW_ENTRY_INVALID:${index}`);
    return false;
  });
  const candidateJourneys = journeyInput.filter((entry, index): entry is JourneyCandidate["journeys"][number] => {
    if (record(entry)) return true;
    issues.push(`CANDIDATE_JOURNEY_ENTRY_INVALID:${index}`);
    return false;
  });
  const classifications = new Map<string, JourneyCandidate["classifications"][number]>();
  for (const classification of candidateClassifications) {
    if (!nonEmpty(classification.classification_id)) issues.push("CLASSIFICATION_ID_INVALID");
    else if (classifications.has(classification.classification_id)) issues.push(`CLASSIFICATION_ID_DUPLICATE:${classification.classification_id}`);
    else classifications.set(classification.classification_id, classification);
  }
  const workflows = new Map<string, JourneyCandidate["workflows"][number]>();
  for (const workflow of candidateWorkflows) {
    if (!nonEmpty(workflow.workflow_id)) issues.push("WORKFLOW_ID_INVALID");
    else if (workflows.has(workflow.workflow_id)) issues.push(`WORKFLOW_ID_DUPLICATE:${workflow.workflow_id}`);
    else workflows.set(workflow.workflow_id, workflow);
  }
  const journeyIds = new Set<string>();
  for (const journey of candidateJourneys) {
    if (!nonEmpty(journey.journey_id)) issues.push("JOURNEY_ID_INVALID");
    else if (journeyIds.has(journey.journey_id)) issues.push(`JOURNEY_ID_DUPLICATE:${journey.journey_id}`);
    else journeyIds.add(journey.journey_id);
  }
  const allowedEvidence = new Set((Array.isArray(grant?.evidence) ? grant.evidence : []).map((item) => [
    item.evidence_grant_id, item.source_snapshot_id, item.source_id, item.path, item.start_line, item.end_line, item.content_hash,
  ].join(":")));
  const journeyIssueIds = new Set<string>();
  const markJourneyIssue = (journeyId: string, issue: string): void => {
    issues.push(issue);
    journeyIssueIds.add(journeyId);
  };
  const verifyEvidence = async (citations: unknown[], owner?: string): Promise<void> => {
    for (const value of citations) {
      const citation = record(value) ? value as EvidenceReference : undefined;
      const key = citation ? [citation.evidence_grant_id, citation.source_snapshot_id, citation.source_id, citation.path, citation.start_line, citation.end_line, citation.content_hash].join(":") : "";
      if (!citation || !allowedEvidence.has(key)) {
        const path = typeof citation?.path === "string" ? citation.path : "unknown";
        const start = typeof citation?.start_line === "number" ? citation.start_line : "?";
        const end = typeof citation?.end_line === "number" ? citation.end_line : "?";
        issues.push(`EVIDENCE_GRANT_VIOLATION:${path}:${start}-${end}`);
        if (owner) journeyIssueIds.add(owner);
      }
    }
  };

  for (const classification of candidateClassifications) {
    if (!nonEmpty(classification.label) || !nonEmpty(classification.description)) issues.push(`CLASSIFICATION_SEMANTICS_EMPTY:${classification.classification_id}`);
    const classificationEvidence = Array.isArray(classification.evidence) ? classification.evidence : [];
    const classificationWorkflowRefs = Array.isArray(classification.workflow_refs) ? classification.workflow_refs : [];
    if (!classificationEvidence.length) issues.push(`CLASSIFICATION_EVIDENCE_EMPTY:${classification.classification_id}`);
    await verifyEvidence(classificationEvidence);
    for (const workflowRef of classificationWorkflowRefs) {
      if (!workflows.has(workflowRef)) issues.push(`CLASSIFICATION_WORKFLOW_REFERENCE_INVALID:${classification.classification_id}:${workflowRef}`);
    }
  }
  for (const workflow of candidateWorkflows) {
    if (!classifications.has(workflow.classification_ref)) issues.push(`WORKFLOW_CLASSIFICATION_REFERENCE_INVALID:${workflow.workflow_id}:${workflow.classification_ref}`);
    if (!nonEmpty(workflow.goal) || !nonEmpty(workflow.entry) || !nonEmpty(workflow.normal_terminal)) issues.push(`WORKFLOW_SEMANTICS_EMPTY:${workflow.workflow_id}`);
    const workflowEvidence = Array.isArray(workflow.evidence) ? workflow.evidence : [];
    if (!workflowEvidence.length) issues.push(`WORKFLOW_EVIDENCE_EMPTY:${workflow.workflow_id}`);
    await verifyEvidence(workflowEvidence);
  }
  for (const journey of candidateJourneys) {
    const journeyId = nonEmpty(journey.journey_id) ? journey.journey_id : "unknown";
    if (!nonEmpty(journey.goal)) markJourneyIssue(journeyId, `JOURNEY_GOAL_EMPTY:${journeyId}`);
    if (!["normal", "recovery", "cross-persona"].includes(journey.kind)) markJourneyIssue(journeyId, `JOURNEY_KIND_INVALID:${journeyId}`);
    const segments = Array.isArray(journey.segments) ? journey.segments : [];
    const classificationRefs = Array.isArray(journey.classification_refs) ? journey.classification_refs : [];
    if (!segments.length) markJourneyIssue(journeyId, `JOURNEY_SEGMENTS_EMPTY:${journeyId}`);
    for (const classificationRef of classificationRefs) {
      if (!classifications.has(classificationRef)) markJourneyIssue(journeyId, `JOURNEY_CLASSIFICATION_REFERENCE_INVALID:${journeyId}:${classificationRef}`);
    }
    const segmentIds = new Set<string>();
    const milestonePositions = new Map<string, number>();
    let milestonePosition = 0;
    for (const segment of segments) {
      if (segmentIds.has(segment.segment_id)) markJourneyIssue(journeyId, `JOURNEY_SEGMENT_ID_DUPLICATE:${journeyId}:${segment.segment_id}`);
      segmentIds.add(segment.segment_id);
      for (const milestone of Array.isArray(segment.milestones) ? segment.milestones : []) {
        if (milestonePositions.has(milestone.milestone_id)) markJourneyIssue(journeyId, `JOURNEY_MILESTONE_ID_DUPLICATE:${journeyId}:${milestone.milestone_id}`);
        else milestonePositions.set(milestone.milestone_id, milestonePosition);
        milestonePosition += 1;
      }
    }
    const milestoneIds = new Set(milestonePositions.keys());
    for (const segment of segments) {
      const milestones = Array.isArray(segment.milestones) ? segment.milestones : [];
      const stateHandoffs = Array.isArray(segment.state_handoffs) ? segment.state_handoffs : [];
      const workflowRefs = Array.isArray(segment.workflow_refs) ? segment.workflow_refs : [];
      if (!nonEmpty(segment.persona) || !nonEmpty(segment.entry) || !nonEmpty(segment.terminal)) markJourneyIssue(journeyId, `JOURNEY_SEGMENT_SEMANTICS_EMPTY:${journeyId}:${segment.segment_id}`);
      if (!milestones.length) markJourneyIssue(journeyId, `JOURNEY_MILESTONES_EMPTY:${journeyId}:${segment.segment_id}`);
      if (!stateHandoffs.length) markJourneyIssue(journeyId, `JOURNEY_STATE_HANDOFFS_EMPTY:${journeyId}:${segment.segment_id}`);
      for (const workflowRef of workflowRefs) {
        if (!workflows.has(workflowRef)) markJourneyIssue(journeyId, `JOURNEY_WORKFLOW_REFERENCE_INVALID:${journeyId}:${workflowRef}`);
      }
      for (const milestone of milestones) {
        if (!workflows.has(milestone.workflow_ref)) markJourneyIssue(journeyId, `JOURNEY_MILESTONE_WORKFLOW_REFERENCE_INVALID:${journeyId}:${milestone.milestone_id}:${milestone.workflow_ref}`);
        if (!nonEmpty(milestone.action) || !nonEmpty(milestone.outcome)) markJourneyIssue(journeyId, `JOURNEY_MILESTONE_SEMANTICS_EMPTY:${journeyId}:${milestone.milestone_id}`);
        const milestoneEvidence = Array.isArray(milestone.evidence) ? milestone.evidence : [];
        if (!milestoneEvidence.length) markJourneyIssue(journeyId, `JOURNEY_MILESTONE_EVIDENCE_EMPTY:${journeyId}:${milestone.milestone_id}`);
        await verifyEvidence(milestoneEvidence, journeyId);
      }
      for (const handoff of stateHandoffs) {
        if (!nonEmpty(handoff.key) || !milestoneIds.has(handoff.produced_by) || !milestoneIds.has(handoff.consumed_by)) markJourneyIssue(journeyId, `JOURNEY_STATE_HANDOFF_INVALID:${journeyId}:${handoff.key}`);
        const producerPosition = milestonePositions.get(handoff.produced_by);
        const consumerPosition = milestonePositions.get(handoff.consumed_by);
        if (producerPosition !== undefined && consumerPosition !== undefined && producerPosition >= consumerPosition) markJourneyIssue(journeyId, `JOURNEY_STATE_HANDOFF_ORDER_INVALID:${journeyId}:${handoff.key}`);
        const handoffEvidence = Array.isArray(handoff.evidence) ? handoff.evidence : [];
        if (!handoffEvidence.length) markJourneyIssue(journeyId, `JOURNEY_STATE_HANDOFF_EVIDENCE_EMPTY:${journeyId}:${handoff.key}`);
        await verifyEvidence(handoffEvidence, journeyId);
      }
    }
    const businessOutcome = journey.business_outcome;
    const businessEvidence = Array.isArray(businessOutcome?.evidence) ? businessOutcome.evidence : [];
    const exit = journey.exit;
    const exitEvidence = Array.isArray(exit?.evidence) ? exit.evidence : [];
    if (!nonEmpty(businessOutcome?.description) || !businessEvidence.length) markJourneyIssue(journeyId, `JOURNEY_BUSINESS_OUTCOME_INVALID:${journeyId}`);
    if (!["logout", "handoff", "process-end"].includes(exit?.kind) || !nonEmpty(exit?.action) || !nonEmpty(exit?.outcome) || !exitEvidence.length) markJourneyIssue(journeyId, `JOURNEY_EXIT_INVALID:${journeyId}`);
    if (journey.kind === "recovery") {
      if (!journey.recovery || !milestoneIds.has(journey.recovery.failure_milestone_ref) || !milestoneIds.has(journey.recovery.rejoin_milestone_ref)) markJourneyIssue(journeyId, `JOURNEY_RECOVERY_REJOIN_INVALID:${journeyId}`);
      const failurePosition = milestonePositions.get(journey.recovery?.failure_milestone_ref ?? "");
      const rejoinPosition = milestonePositions.get(journey.recovery?.rejoin_milestone_ref ?? "");
      if (failurePosition !== undefined && rejoinPosition !== undefined && failurePosition >= rejoinPosition) markJourneyIssue(journeyId, `JOURNEY_RECOVERY_ORDER_INVALID:${journeyId}`);
    }
    await verifyEvidence(businessEvidence, journeyId);
    await verifyEvidence(exitEvidence, journeyId);
  }

  return {
    valid: issues.length === 0,
    issues: [...new Set(issues)],
    completeJourneyIds: candidateJourneys.map((journey) => journey.journey_id).filter((journeyId) => nonEmpty(journeyId) && !journeyIssueIds.has(journeyId)),
    counts: { classifications: candidateClassifications.length, workflows: candidateWorkflows.length, journeys: candidateJourneys.length },
  };
}

export function summarizeLegacyJourneyCoverage(facts: FactBundle, scenarioSet: ScenarioSet): {
  completeScenarioIds: string[];
  scenariosWithAuthentication: number;
  scenariosWithBusinessOutput: number;
  scenariosWithExit: number;
} {
  const elements = new Map(facts.screens.flatMap((screen) => screen.elements.map((element) => [element.id, element] as const)));
  const categories = scenarioSet.scenarios.map((scenario) => {
    const stepText = scenario.steps.map((step) => {
      const element = elements.get(step.action_ref.element);
      return [step.action, step.expected, element?.label, element?.interaction.action_kind].filter(Boolean).join(" ");
    });
    const firstAuthentication = stepText.findIndex((text) => /authenticat|log[\s_-]?in|sign[\s_-]?in|로그인/i.test(text));
    const firstBusinessOutput = stepText.findIndex((text) => /download|export|csv|excel|xlsx|file output|다운로드|내보내기|반출/i.test(text));
    const firstExit = stepText.findIndex((text) => /log[\s_-]?out|sign[\s_-]?out|session[\s_-]?reset|로그아웃/i.test(text));
    return { scenarioId: scenario.scenario_id, firstAuthentication, firstBusinessOutput, firstExit };
  });
  return {
    completeScenarioIds: categories
      .filter((entry) => entry.firstAuthentication >= 0 && entry.firstBusinessOutput > entry.firstAuthentication && entry.firstExit > entry.firstBusinessOutput)
      .map((entry) => entry.scenarioId),
    scenariosWithAuthentication: categories.filter((entry) => entry.firstAuthentication >= 0).length,
    scenariosWithBusinessOutput: categories.filter((entry) => entry.firstBusinessOutput >= 0).length,
    scenariosWithExit: categories.filter((entry) => entry.firstExit >= 0).length,
  };
}
