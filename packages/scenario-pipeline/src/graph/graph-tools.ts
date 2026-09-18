import { createHash } from "node:crypto";
import type { BusinessCatalog, FactBundle, FactEdge, ScenarioRecord, ScenarioSet, ScenarioSkeleton, WikiBundle, WikiWorkflow } from "@scenarioforge/contracts";
import { scenarioId, workflowId } from "../scanning/deterministic-id.js";
import { auditTransitionCoverage, type TransitionFeasibility, type TransitionObligation, type TransitionScope } from "./transition-coverage-audit.js";

export type WorkflowPath = { workflow: string; kind: "normal" | "exception"; edge_ids: string[] };
export type WikiSemanticPatch = { schema_version: 1; workflow_updates: Array<{ workflow_ref: string; goal: string }> };
export type BusinessClassificationPatch = { schema_version: 1; classifications: Array<{ label: string; workflow_refs: string[] }> };
export type ScenarioNarrationPatch = {
  schema_version: 1;
  scenario_updates: Array<{
    scenario_ref: string;
    preconditions: Array<{ index: number; text: string }>;
    steps: Array<{ n: number; action: string; expected: string }>;
  }>;
};

export type WikiGoalCorrectionScope = { base_artifact_hash: string; workflow_refs: string[] };
export type WikiGoalCorrectionPatch = WikiSemanticPatch & { base_artifact_hash: string };
export type BusinessClassificationCorrectionScope = { base_artifact_hash: string; workflow_refs: string[] };
export type BusinessClassificationCorrectionPatch = {
  schema_version: 1;
  base_artifact_hash: string;
  workflow_updates: Array<{ workflow_ref: string; label: string }>;
};
export type ScenarioNarrationCorrectionScope = {
  base_artifact_hash: string;
  scenario_refs: string[];
  fields: Record<string, {
    precondition_indexes: number[];
    step_fields: Record<string, Array<"action" | "expected">>;
  }>;
};
export type ScenarioNarrationCorrectionPatch = {
  schema_version: 1;
  base_artifact_hash: string;
  scenario_updates: Array<{
    scenario_ref: string;
    preconditions?: Array<{ index: number; text: string }>;
    steps?: Array<{ n: number; action?: string; expected?: string }>;
  }>;
};

export function semanticArtifactHash(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function issueTargetRefs(issueCodes: readonly string[], knownRefs: readonly string[], errorCode: string): string[] {
  const matchesByIssue = issueCodes.map((code) => knownRefs.filter((reference) => referenceMentioned(code, reference)));
  if (matchesByIssue.some((matches) => matches.length > 1)) throw new Error(`${errorCode}_AMBIGUOUS`);
  const targets = [...new Set(matchesByIssue.flat())].sort();
  if (!targets.length) throw new Error(errorCode);
  return targets;
}

export type JourneyWorkflowLinks = {
  schema_version: 1;
  project_id: string;
  analysis_run_id: string;
  source_snapshot_id: string;
  journeys: Array<{
    journey_ref: string;
    kind: "normal" | "recovery";
    title: string;
    feasibility: TransitionFeasibility;
    milestones: Array<{
      target_ref: string;
      position: number;
      phase: string;
      required_outcome: "normal" | "exception";
      workflow_refs: string[];
      edge_refs: string[];
      feasibility: TransitionFeasibility;
    }>;
  }>;
};

export type JourneyScenarioBindings = {
  schema_version: 1;
  project_id: string;
  analysis_run_id: string;
  source_snapshot_id: string;
  scenarios: Array<{
    scenario_ref: string;
    workflow_ref: string;
    path: string[];
    feasibility: TransitionFeasibility;
    roles: Array<"normal" | "exception" | "failure" | "recovery">;
    journey_milestones: Array<{ journey_ref: string; milestone_position: number; phase: string }>;
  }>;
  coverage: { total_scenarios: number; journey_bound_scenarios: number; unbound_scenario_refs: string[] };
};

export type GuardedPathInventory = {
  schema_version: 1;
  project_id: string;
  analysis_run_id: string;
  source_snapshot_id: string;
  nodes: Array<{ screen_ref: string; title: string; entry_guards: string[]; status: FactBundle["screens"][number]["status"] }>;
  edges: Array<{
    edge_ref: string;
    source_action_ref: string;
    branch_ref: string;
    outcome: "normal" | "exception";
    from_screen_ref: string;
    to_screen_ref: string;
    guard?: string;
    effect?: string;
    scope?: TransitionScope;
    feasibility: TransitionFeasibility;
    status: FactEdge["status"];
  }>;
  workflows: Array<{ workflow_ref: string; entry_screen_refs: string[]; success_terminal: string; edge_refs: string[] }>;
  paths: Array<{ workflow_ref: string; kind: "normal" | "exception"; edge_refs: string[]; feasibility: TransitionFeasibility }>;
  coverage: {
    total_obligations: number;
    linked_obligations: number;
    by_scope: Record<TransitionScope, { total: number; linked: number; unresolved: number }>;
    source_supported: { total: number; linked: number };
    runtime_unverified: { total: number; linked: number };
  };
  unresolved_obligations: TransitionObligation[];
  unknown_edge_claims: Array<{ source_action_ref: string; branch_ref: string; outcome: "normal" | "exception"; edge_ref: string }>;
};

function terminalScreen(workflow: WikiWorkflow): string | undefined {
  return workflow.success_terminal.match(/at\((SCR-[^)]+)\)/)?.[1];
}

type PredicateState = Map<string, string>;

function assignments(expression?: string): Array<{ predicate: string; value: string }> {
  if (!expression) return [];
  return expression.split(/\s*&&\s*/).flatMap((clause) => {
    const match = clause.match(/^(PRED-[A-Za-z0-9_.-]+)=(.*)$/);
    return match ? [{ predicate: match[1], value: match[2] }] : [];
  });
}

const baseScreenId = (screen: string): string => screen.split("[")[0];

const authenticationMarker = (value: string): boolean => /(?:^|[^a-z0-9])(?:authenticate|authentication|log[\s/_-]?in|sign[\s/_-]?in)(?:$|[^a-z0-9])/i.test(value);

function isAuthenticationEntryScreen(screen: FactBundle["screens"][number]): boolean {
  return screen.elements.some((element) => authenticationMarker(element.interaction.action_kind))
    || screen.apis.some((api) => [api.id, ...api.reads, ...api.writes].some(authenticationMarker));
}

function shellOriginScreens(facts: FactBundle): Map<string, string[]> {
  const shellByScreen = new Map(facts.screens.flatMap((screen) => screen.shell_screen_id ? [[screen.screen_id, screen.shell_screen_id] as const] : []));
  return new Map(facts.screens.map((screen) => {
    const origins = [screen.screen_id];
    for (let shell = shellByScreen.get(screen.screen_id); shell && !origins.includes(shell); shell = shellByScreen.get(shell)) origins.push(shell);
    return [screen.screen_id, origins];
  }));
}

function canonicalScreenEntryPaths(facts: FactBundle): Map<string, string[]> {
  const screens = [...facts.screens.map((screen) => screen.screen_id)].sort();
  const normalTransitions = facts.edges
    .filter((edge) => edge.kind === "normal" && baseScreenId(edge.from) !== baseScreenId(edge.to))
    .sort((left, right) => left.edge_id.localeCompare(right.edge_id));
  const authenticatedEntryScreens = facts.screens
    .filter(isAuthenticationEntryScreen)
    .map((screen) => screen.screen_id)
    .sort();
  const incoming = new Set(normalTransitions.map((edge) => baseScreenId(edge.to)));
  const sourceScreens = screens.filter((screen) => !incoming.has(screen));
  const roots = authenticatedEntryScreens.length ? authenticatedEntryScreens : sourceScreens.length ? sourceScreens : screens.slice(0, 1);
  const outgoing = new Map<string, FactEdge[]>();
  normalTransitions.forEach((edge) => outgoing.set(baseScreenId(edge.from), [...(outgoing.get(baseScreenId(edge.from)) ?? []), edge]));
  const origins = shellOriginScreens(facts);
  const paths = new Map<string, string[]>(roots.map((screen) => [screen, []]));
  const queue = [...roots];
  while (queue.length) {
    const screen = queue.shift()!;
    const prefix = paths.get(screen)!;
    for (const edge of (origins.get(screen) ?? [screen]).flatMap((origin) => outgoing.get(origin) ?? [])) {
      const target = baseScreenId(edge.to);
      const candidate = [...prefix, edge.edge_id];
      const current = paths.get(target);
      const preferred = !current || candidate.length < current.length || (candidate.length === current.length && candidate.join(">").localeCompare(current.join(">")) < 0);
      if (!preferred) continue;
      paths.set(target, candidate);
      queue.push(target);
    }
  }
  return paths;
}

export function compileReachableWorkflowSkeleton(facts: FactBundle): WikiBundle {
  const screens = new Map(facts.screens.map((screen) => [screen.screen_id, screen]));
  const elements = new Map(facts.screens.flatMap((screen) => screen.elements.map((element) => [element.id, element] as const)));
  const groupedEdges = new Map<string, FactEdge[]>();
  for (const edge of [...facts.edges].sort((left, right) => left.edge_id.localeCompare(right.edge_id))) {
    const key = `${baseScreenId(edge.from)}:${edge.on}:${edge.guard ?? "always"}`;
    groupedEdges.set(key, [...(groupedEdges.get(key) ?? []), edge]);
  }
  const workflowEntries = [...groupedEdges.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([key, edges]) => {
    const entryScreen = baseScreenId(edges[0].from);
    const normal = edges.find((edge) => edge.kind === "normal") ?? edges[0];
    const guardAssignments = assignments(edges[0].guard);
    const predicateIds = [...new Set(edges.flatMap((edge) => [...assignments(edge.guard), ...assignments(edge.effect)].map((entry) => entry.predicate)))].sort();
    const targetScreens = [...new Set(edges.map((edge) => baseScreenId(edge.to)))].sort();
    const failureTerminals = [...new Set(edges.filter((edge) => edge.kind === "exception").map((edge) => edge.effect ?? `at(${baseScreenId(edge.to)})`))].sort();
    const element = elements.get(edges[0].on);
    const screen = screens.get(entryScreen);
    const workflow = workflowId(entryScreen, edges[0].on, edges[0].guard);
    return {
      key,
      edges,
      workflow: {
        schema_version: 2 as const,
        project_id: facts.project_id,
        analysis_run_id: facts.analysis_run_id,
        source_snapshot_id: facts.source_snapshot_id,
        workflow,
        goal: element ? `${element.label} (${screen?.title ?? entryScreen})` : `${screen?.title ?? entryScreen} workflow`,
        entry_screens: [entryScreen],
        success_terminal: `at(${baseScreenId(normal.to)})`,
        failure_terminals: failureTerminals,
        variation_axes: guardAssignments.map((entry) => entry.predicate),
        combination: { strategy: "base-choice" as const, axis_defaults: Object.fromEntries(guardAssignments.map((entry) => [entry.predicate, entry.value])) },
        depends_on: [] as string[],
        cites: [entryScreen, ...targetScreens.filter((id) => id !== entryScreen), edges[0].on, ...predicateIds, ...edges.map((edge) => edge.edge_id)],
        status: "draft" as const,
      },
    };
  });
  const entryPaths = canonicalScreenEntryPaths(facts);
  const workflowByEdge = new Map(workflowEntries.flatMap((entry) => entry.edges.map((edge) => [edge.edge_id, entry.workflow.workflow] as const)));
  for (const current of workflowEntries) {
    const predecessorEdge = entryPaths.get(current.workflow.entry_screens[0])?.at(-1);
    const dependency = predecessorEdge ? workflowByEdge.get(predecessorEdge) : undefined;
    current.workflow.depends_on = dependency && dependency !== current.workflow.workflow ? [dependency] : [];
  }
  return {
    schema_version: 2,
    project_id: facts.project_id,
    analysis_run_id: facts.analysis_run_id,
    source_snapshot_id: facts.source_snapshot_id,
    workflows: workflowEntries.map((entry) => entry.workflow),
  };
}

export function applyWikiSemanticPatch(skeleton: WikiBundle, patch: WikiSemanticPatch): WikiBundle {
  if (!patch || patch.schema_version !== 1 || !Array.isArray(patch.workflow_updates) || Object.keys(patch).some((key) => !["schema_version", "workflow_updates"].includes(key))) {
    throw new Error("WIKI_SEMANTIC_PATCH_INVALID");
  }
  const known = new Set(skeleton.workflows.map((workflow) => workflow.workflow));
  const updates = new Map<string, string>();
  for (const update of patch.workflow_updates) {
    if (!update || typeof update.workflow_ref !== "string" || typeof update.goal !== "string" || !update.goal.trim() || Object.keys(update).some((key) => !["workflow_ref", "goal"].includes(key))) {
      throw new Error("WIKI_SEMANTIC_PATCH_INVALID");
    }
    if (!known.has(update.workflow_ref)) throw new Error(`WIKI_SEMANTIC_PATCH_REFERENCE_INVALID:${update.workflow_ref}`);
    if (updates.has(update.workflow_ref)) throw new Error(`WIKI_SEMANTIC_PATCH_DUPLICATE:${update.workflow_ref}`);
    updates.set(update.workflow_ref, update.goal.trim());
  }
  if (updates.size !== skeleton.workflows.length) throw new Error("WIKI_SEMANTIC_PATCH_INCOMPLETE");
  return {
    ...structuredClone(skeleton),
    workflows: skeleton.workflows.map((workflow) => ({ ...structuredClone(workflow), goal: updates.get(workflow.workflow)! })),
  };
}

export function createWikiGoalCorrectionScope(wiki: WikiBundle, issueCodes: readonly string[]): WikiGoalCorrectionScope {
  return {
    base_artifact_hash: semanticArtifactHash(wiki),
    workflow_refs: issueTargetRefs(issueCodes, wiki.workflows.map((workflow) => workflow.workflow), "WIKI_CORRECTION_SCOPE_UNMAPPABLE"),
  };
}

export function applyWikiGoalCorrectionPatch(wiki: WikiBundle, scope: WikiGoalCorrectionScope, patch: WikiGoalCorrectionPatch): WikiBundle {
  if (!patch || patch.schema_version !== 1 || patch.base_artifact_hash !== scope.base_artifact_hash || semanticArtifactHash(wiki) !== scope.base_artifact_hash) {
    throw new Error("WIKI_CORRECTION_PATCH_BASE_MISMATCH");
  }
  if (!Array.isArray(patch.workflow_updates) || Object.keys(patch).some((key) => !["schema_version", "base_artifact_hash", "workflow_updates"].includes(key))) throw new Error("WIKI_CORRECTION_PATCH_INVALID");
  const supplied = [...patch.workflow_updates.map((update) => update.workflow_ref)].sort();
  if (!sameRefSet(supplied, scope.workflow_refs)) throw new Error("WIKI_CORRECTION_PATCH_SCOPE_INVALID");
  const replacement = new Map(patch.workflow_updates.map((update) => [update.workflow_ref, update]));
  const merged = applyWikiSemanticPatch(wiki, {
    schema_version: 1,
    workflow_updates: wiki.workflows.map((workflow) => replacement.get(workflow.workflow) ?? { workflow_ref: workflow.workflow, goal: workflow.goal }),
  });
  assertRecordsPreserved(wiki.workflows, merged.workflows, scope.workflow_refs, (workflow) => workflow.workflow, "WIKI_CORRECTION_OUTSIDE_SCOPE_CHANGED");
  return merged;
}

export function compileBusinessCatalog(wiki: WikiBundle, patch: BusinessClassificationPatch, previousCatalog?: BusinessCatalog): BusinessCatalog {
  if (!patch || patch.schema_version !== 1 || !Array.isArray(patch.classifications) || !patch.classifications.length) throw new Error("BUSINESS_CLASSIFICATION_PATCH_INVALID");
  if (previousCatalog && (previousCatalog.project_id !== wiki.project_id
    || previousCatalog.analysis_run_id !== wiki.analysis_run_id
    || previousCatalog.source_snapshot_id !== wiki.source_snapshot_id
    || !Array.isArray(previousCatalog.classifications))) {
    throw new Error("BUSINESS_CLASSIFICATION_PRIOR_INVALID");
  }
  const workflows = new Map(wiki.workflows.map((workflow) => [workflow.workflow, workflow]));
  const assigned = new Set<string>();
  const assignedLabels = new Set<string>();
  const previousByLabel = new Map(previousCatalog?.classifications.map((classification) => [classification.label, classification]) ?? []);
  if (previousByLabel.size !== (previousCatalog?.classifications.length ?? 0)) throw new Error("BUSINESS_CLASSIFICATION_PRIOR_INVALID");
  const classifications = patch.classifications.map((entry) => {
    if (!entry || typeof entry.label !== "string" || !entry.label.trim() || !Array.isArray(entry.workflow_refs) || !entry.workflow_refs.length) throw new Error("BUSINESS_CLASSIFICATION_PATCH_INVALID");
    const label = entry.label.trim();
    if (assignedLabels.has(label)) throw new Error("BUSINESS_CLASSIFICATION_LABEL_DUPLICATE");
    assignedLabels.add(label);
    const workflowRefs = [...new Set(entry.workflow_refs)].sort();
    for (const workflowRef of workflowRefs) {
      if (!workflows.has(workflowRef)) throw new Error(`BUSINESS_CLASSIFICATION_WORKFLOW_INVALID:${workflowRef}`);
      if (assigned.has(workflowRef)) throw new Error(`BUSINESS_CLASSIFICATION_WORKFLOW_DUPLICATE:${workflowRef}`);
      assigned.add(workflowRef);
    }
    const previous = previousByLabel.get(label);
    if (previous?.workflow_refs.some((workflowRef) => !workflowRefs.includes(workflowRef))) {
      throw new Error(`BUSINESS_CLASSIFICATION_PRIOR_MEMBERSHIP_REMOVED:${previous.classification_id}`);
    }
    const classificationId = previous?.classification_id
      ?? `BC-${createHash("sha256").update(workflowRefs.join("\n")).digest("hex").slice(0, 12).toUpperCase()}`;
    return {
      classification_id: classificationId,
      label,
      workflow_refs: workflowRefs,
      edge_refs: [...new Set(workflowRefs.flatMap((workflowRef) => workflows.get(workflowRef)!.cites.filter((id) => id.startsWith("E-"))))].sort(),
    };
  }).sort((left, right) => left.classification_id.localeCompare(right.classification_id));
  const missingPreviousLabels = [...previousByLabel.keys()].filter((label) => !assignedLabels.has(label));
  if (missingPreviousLabels.length) throw new Error(`BUSINESS_CLASSIFICATION_PRIOR_MISSING:${missingPreviousLabels.join(",")}`);
  if (new Set(classifications.map((classification) => classification.classification_id)).size !== classifications.length) {
    throw new Error("BUSINESS_CLASSIFICATION_ID_DUPLICATE");
  }
  const missing = [...workflows.keys()].filter((workflow) => !assigned.has(workflow)).sort();
  if (missing.length) throw new Error(`BUSINESS_CLASSIFICATION_INCOMPLETE:${missing.join(",")}`);
  return { schema_version: 1, project_id: wiki.project_id, analysis_run_id: wiki.analysis_run_id, source_snapshot_id: wiki.source_snapshot_id, classifications };
}

export function createBusinessClassificationCorrectionScope(
  business: BusinessCatalog,
  issueCodes: readonly string[],
): BusinessClassificationCorrectionScope {
  const direct = issueTargetRefsOrEmpty(issueCodes, business.classifications.flatMap((classification) => classification.workflow_refs));
  const classificationTargets = business.classifications
    .filter((classification) => issueCodes.some((code) => referenceMentioned(code, classification.classification_id)))
    .flatMap((classification) => classification.workflow_refs);
  const workflowRefs = [...new Set([...direct, ...classificationTargets])].sort();
  if (!workflowRefs.length) throw new Error("BUSINESS_CORRECTION_SCOPE_UNMAPPABLE");
  return { base_artifact_hash: semanticArtifactHash(business), workflow_refs: workflowRefs };
}

export function applyBusinessClassificationCorrectionPatch(
  wiki: WikiBundle,
  business: BusinessCatalog,
  scope: BusinessClassificationCorrectionScope,
  patch: BusinessClassificationCorrectionPatch,
): BusinessCatalog {
  if (!patch || patch.schema_version !== 1 || patch.base_artifact_hash !== scope.base_artifact_hash || semanticArtifactHash(business) !== scope.base_artifact_hash) {
    throw new Error("BUSINESS_CORRECTION_PATCH_BASE_MISMATCH");
  }
  if (!Array.isArray(patch.workflow_updates) || Object.keys(patch).some((key) => !["schema_version", "base_artifact_hash", "workflow_updates"].includes(key))) throw new Error("BUSINESS_CORRECTION_PATCH_INVALID");
  const supplied = [...patch.workflow_updates.map((update) => update.workflow_ref)].sort();
  if (!sameRefSet(supplied, scope.workflow_refs)) throw new Error("BUSINESS_CORRECTION_PATCH_SCOPE_INVALID");
  const knownWorkflows = new Map(wiki.workflows.map((workflow) => [workflow.workflow, workflow]));
  const labelByWorkflow = new Map(business.classifications.flatMap((classification) => classification.workflow_refs.map((workflowRef) => [workflowRef, classification.label] as const)));
  const previousLabelByWorkflow = new Map(labelByWorkflow);
  for (const update of patch.workflow_updates) {
    if (!update || typeof update.workflow_ref !== "string" || typeof update.label !== "string" || !update.label.trim()
      || Object.keys(update).some((key) => !["workflow_ref", "label"].includes(key)) || !knownWorkflows.has(update.workflow_ref)) {
      throw new Error("BUSINESS_CORRECTION_PATCH_INVALID");
    }
    labelByWorkflow.set(update.workflow_ref, update.label.trim());
  }
  if (labelByWorkflow.size !== knownWorkflows.size || [...knownWorkflows.keys()].some((workflowRef) => !labelByWorkflow.has(workflowRef))) throw new Error("BUSINESS_CORRECTION_PATCH_INCOMPLETE");
  const targetSet = new Set(scope.workflow_refs);
  for (const [workflowRef, label] of previousLabelByWorkflow) {
    if (!targetSet.has(workflowRef) && labelByWorkflow.get(workflowRef) !== label) throw new Error("BUSINESS_CORRECTION_OUTSIDE_SCOPE_CHANGED");
  }
  const workflowsByLabel = new Map<string, string[]>();
  for (const [workflowRef, label] of labelByWorkflow) workflowsByLabel.set(label, [...(workflowsByLabel.get(label) ?? []), workflowRef].sort());
  const previousByLabel = new Map(business.classifications.map((classification) => [classification.label, classification]));
  const classifications = [...workflowsByLabel.entries()].map(([label, workflowRefs]) => {
    const prior = previousByLabel.get(label);
    return {
      classification_id: prior?.classification_id ?? `BC-${createHash("sha256").update(workflowRefs.join("\n")).digest("hex").slice(0, 12).toUpperCase()}`,
      label,
      workflow_refs: workflowRefs,
      edge_refs: [...new Set(workflowRefs.flatMap((workflowRef) => knownWorkflows.get(workflowRef)!.cites.filter((id) => id.startsWith("E-"))))].sort(),
    };
  }).sort((left, right) => left.classification_id.localeCompare(right.classification_id));
  if (new Set(classifications.map((classification) => classification.classification_id)).size !== classifications.length) throw new Error("BUSINESS_CLASSIFICATION_ID_DUPLICATE");
  return { ...structuredClone(business), classifications };
}

export function defaultBusinessClassificationPatch(wiki: WikiBundle): BusinessClassificationPatch {
  const workflowsByLabel = new Map<string, string[]>();
  for (const workflow of wiki.workflows) workflowsByLabel.set(workflow.goal, [...(workflowsByLabel.get(workflow.goal) ?? []), workflow.workflow]);
  return {
    schema_version: 1,
    classifications: [...workflowsByLabel.entries()].map(([label, workflow_refs]) => ({ label, workflow_refs })),
  };
}

export function walkWorkflow(workflow: WikiWorkflow, facts: FactBundle, maxDepth = 24): WorkflowPath[] {
  const citedEdgeIds = new Set(workflow.cites.filter((id) => id.startsWith("E-")));
  const outgoing = new Map<string, FactEdge[]>();
  for (const edge of facts.edges) {
    if (!citedEdgeIds.has(edge.edge_id)) continue;
    outgoing.set(edge.from.split("[")[0], [...(outgoing.get(edge.from.split("[")[0]) ?? []), edge].sort((a, b) => a.edge_id.localeCompare(b.edge_id)));
  }
  const producedPredicates = new Set(facts.edges
    .filter((edge) => citedEdgeIds.has(edge.edge_id))
    .flatMap((edge) => assignments(edge.effect).map((assignment) => assignment.predicate)));
  const terminal = terminalScreen(workflow);
  const results: WorkflowPath[] = [];
  const visit = (screen: string, path: FactEdge[], visited: Set<string>, state: PredicateState): void => {
    const candidates = outgoing.get(screen) ?? [];
    if ((terminal && screen === terminal && path.length) || (!candidates.length && path.length) || path.length >= maxDepth) {
      results.push({ workflow: workflow.workflow, kind: path.some((edge) => edge.kind === "exception") ? "exception" : "normal", edge_ids: path.map((edge) => edge.edge_id) });
      return;
    }
    for (const edge of candidates) {
      if (visited.has(edge.edge_id)) continue;
      const enabled = assignments(edge.guard).every(({ predicate, value }) => {
        const current = state.get(predicate);
        if (current !== undefined) return current === value;
        return !producedPredicates.has(predicate);
      });
      if (!enabled) continue;
      const nextState = new Map(state);
      assignments(edge.effect).forEach(({ predicate, value }) => nextState.set(predicate, value));
      visit(edge.to.split("[")[0], [...path, edge], new Set([...visited, edge.edge_id]), nextState);
    }
  };
  const initialState = new Map(Object.entries(workflow.combination.axis_defaults));
  workflow.entry_screens.forEach((screen) => visit(screen, [], new Set(), initialState));
  return [...new Map(results.map((path) => [path.edge_ids.join(">"), path])).values()];
}

export function uncoveredWorkflowEdgeIds(facts: FactBundle, wiki: WikiBundle): string[] {
  const covered = new Set(wiki.workflows.flatMap((workflow) => walkWorkflow(workflow, facts).flatMap((path) => path.edge_ids)));
  return facts.edges.map((edge) => edge.edge_id).filter((edgeId) => !covered.has(edgeId)).sort();
}

const transitionKey = (value: Pick<TransitionObligation, "source_action_ref" | "branch_ref" | "outcome">): string =>
  `${value.source_action_ref}:${value.outcome}:${value.branch_ref}`;

export function compileGuardedPathInventory(
  facts: FactBundle,
  obligations: readonly TransitionObligation[],
): GuardedPathInventory {
  const ordinalByActionAndOutcome = new Map<string, number>();
  const claims = [...facts.edges]
    .sort((left, right) => left.edge_id.localeCompare(right.edge_id))
    .map((edge) => {
      const key = `${edge.on}:${edge.kind}`;
      const ordinal = (ordinalByActionAndOutcome.get(key) ?? 0) + 1;
      ordinalByActionAndOutcome.set(key, ordinal);
      return {
        source_action_ref: edge.on,
        branch_ref: edge.source_branch_ref ?? `${edge.kind}:${ordinal}`,
        outcome: edge.kind,
        edge_ref: edge.edge_id,
      };
    });
  const audit = auditTransitionCoverage(obligations, claims);
  const obligationByKey = new Map(obligations.map((obligation) => [transitionKey(obligation), obligation]));
  const claimByEdge = new Map(claims.map((claim) => [claim.edge_ref, claim]));
  const feasibilityByEdge = new Map(facts.edges.map((edge) => {
    const claim = claimByEdge.get(edge.edge_id)!;
    return [edge.edge_id, obligationByKey.get(transitionKey(claim))?.feasibility ?? "runtime-unverified"] as const;
  }));
  const skeleton = compileReachableWorkflowSkeleton(facts);
  const paths = skeleton.workflows
    .flatMap((workflow) => walkWorkflow(workflow, facts).map((path) => ({
      workflow_ref: workflow.workflow,
      kind: path.kind,
      edge_refs: path.edge_ids,
      feasibility: path.edge_ids.every((edgeId) => feasibilityByEdge.get(edgeId) === "source-supported")
        ? "source-supported" as const
        : "runtime-unverified" as const,
    })))
    .sort((left, right) => left.workflow_ref.localeCompare(right.workflow_ref)
      || Number(left.kind === "exception") - Number(right.kind === "exception")
      || left.edge_refs.length - right.edge_refs.length
      || left.edge_refs.join(">").localeCompare(right.edge_refs.join(">")));
  const linkedKeys = new Set(claims.map(transitionKey).filter((key) => obligationByKey.has(key)));
  const linkedByFeasibility = (feasibility: TransitionFeasibility): number => obligations
    .filter((obligation) => obligation.feasibility === feasibility && linkedKeys.has(transitionKey(obligation)))
    .length;
  const coverageByScope = (scope: TransitionScope): { total: number; linked: number; unresolved: number } => {
    const total = obligations.filter((obligation) => obligation.scope === scope).length;
    const linked = obligations.filter((obligation) => obligation.scope === scope && linkedKeys.has(transitionKey(obligation))).length;
    return { total, linked, unresolved: total - linked };
  };

  return {
    schema_version: 1,
    project_id: facts.project_id,
    analysis_run_id: facts.analysis_run_id,
    source_snapshot_id: facts.source_snapshot_id,
    nodes: [...facts.screens]
      .sort((left, right) => left.screen_id.localeCompare(right.screen_id))
      .map((screen) => ({ screen_ref: screen.screen_id, title: screen.title, entry_guards: [...screen.entry_guards], status: screen.status })),
    edges: [...facts.edges]
      .sort((left, right) => left.edge_id.localeCompare(right.edge_id))
      .map((edge) => {
        const claim = claimByEdge.get(edge.edge_id)!;
        const obligation = obligationByKey.get(transitionKey(claim));
        return {
          edge_ref: edge.edge_id,
          source_action_ref: edge.on,
          branch_ref: claim.branch_ref,
          outcome: edge.kind,
          from_screen_ref: edge.from,
          to_screen_ref: edge.to,
          ...(edge.guard ? { guard: edge.guard } : {}),
          ...(edge.effect ? { effect: edge.effect } : {}),
          ...(obligation ? { scope: obligation.scope } : {}),
          feasibility: obligation?.feasibility ?? "runtime-unverified",
          status: edge.status,
        };
      }),
    workflows: skeleton.workflows.map((workflow) => ({
      workflow_ref: workflow.workflow,
      entry_screen_refs: [...workflow.entry_screens],
      success_terminal: workflow.success_terminal,
      edge_refs: workflow.cites.filter((reference) => reference.startsWith("E-")),
    })),
    paths,
    coverage: {
      total_obligations: obligations.length,
      linked_obligations: audit.covered_obligations,
      by_scope: {
        journey: coverageByScope("journey"),
        view: coverageByScope("view"),
      },
      source_supported: {
        total: obligations.filter((obligation) => obligation.feasibility === "source-supported").length,
        linked: linkedByFeasibility("source-supported"),
      },
      runtime_unverified: {
        total: obligations.filter((obligation) => obligation.feasibility === "runtime-unverified").length,
        linked: linkedByFeasibility("runtime-unverified"),
      },
    },
    unresolved_obligations: audit.missing_obligations.map((obligation) => ({ ...obligation })),
    unknown_edge_claims: audit.unknown_claims.map((claim) => ({ ...claim, edge_ref: claim.edge_ref! })),
  };
}

export function compileScenarioSet(facts: FactBundle, wiki: WikiBundle): ScenarioSet {
  const edges = new Map(facts.edges.map((edge) => [edge.edge_id, edge]));
  const elements = new Map(facts.screens.flatMap((screen) => screen.elements.map((element) => [element.id, element] as const)));
  const feedback = new Map(facts.screens.flatMap((screen) => screen.feedback.map((item) => [item.id, item] as const)));
  const workflows = new Map(wiki.workflows.map((workflow) => [workflow.workflow, workflow]));
  const normalDependencyPrefix = (workflow: WikiWorkflow, visited: Set<string>): string[] => {
    const entries = new Set(workflow.entry_screens);
    const candidates = workflow.depends_on.flatMap((dependencyId) => {
      if (visited.has(dependencyId)) return [];
      const dependency = workflows.get(dependencyId);
      if (!dependency) return [];
      return walkWorkflow(dependency, facts)
        .filter((path) => path.kind === "normal" && entries.has(baseScreenId(edges.get(path.edge_ids.at(-1)!)!.to)))
        .map((path) => [...normalDependencyPrefix(dependency, new Set([...visited, dependencyId])), ...path.edge_ids]);
    });
    return candidates.sort((left, right) => right.length - left.length || left.join(">").localeCompare(right.join(">")))[0] ?? [];
  };
  const scenarios: ScenarioRecord[] = [];
  for (const workflow of wiki.workflows) {
    let ordinal = 1;
    const dependencyPrefix = normalDependencyPrefix(workflow, new Set([workflow.workflow]));
    const rankedPaths = walkWorkflow(workflow, facts).sort((left, right) =>
      Number(left.kind === "exception") - Number(right.kind === "exception")
      || left.edge_ids.length - right.edge_ids.length
      || left.edge_ids.join(">").localeCompare(right.edge_ids.join(">")));
    for (const path of rankedPaths) {
      const pathEdgeIds = [...dependencyPrefix, ...path.edge_ids];
      const pathEdges = pathEdgeIds.map((id) => edges.get(id)!);
      const steps = pathEdges.map((edge, index) => {
        const element = elements.get(edge.on);
        const assertions = [...edge.feedback, edge.to.split("[")[0]];
        const expectedParts = edge.feedback.map((id) => feedback.get(id)?.text).filter(Boolean);
        return { n: index + 1, action: element ? `'${element.label}' ${element.interaction.action_kind}` : "unresolved action", action_ref: { edge: edge.edge_id, element: edge.on }, expected: expectedParts.length ? expectedParts.join("; ") : `at ${edge.to}`, assertion_refs: assertions };
      });
      const requirements = new Map<string, { text: string; predicate: string }>();
      const pathState = new Map(Object.entries(workflow.combination.axis_defaults));
      pathEdges.forEach((edge) => {
        edge.guard?.split(/\s*&&\s*/).forEach((clause) => {
          const match = clause.match(/^(PRED-[A-Za-z0-9_.-]+)(?:=(.*))?$/);
          if (!match) return;
          if (match[2] !== undefined && pathState.get(match[1]) === match[2]) return;
          requirements.set(clause, { text: clause, predicate: match[1] });
        });
        assignments(edge.effect).forEach(({ predicate, value }) => pathState.set(predicate, value));
      });
      workflow.variation_axes.forEach((predicate) => {
        const value = workflow.combination.axis_defaults[predicate];
        if (typeof value !== "string") return;
        const text = `${predicate}=${value}`;
        requirements.set(text, { text, predicate });
      });
      scenarios.push({
        schema_version: 2, project_id: facts.project_id, analysis_run_id: facts.analysis_run_id, source_snapshot_id: facts.source_snapshot_id,
        scenario_id: scenarioId(workflow.workflow, ordinal++), workflow: workflow.workflow, kind: pathEdges.some((edge) => edge.kind === "exception") ? "exception" : "normal",
        variation: { ...workflow.combination.axis_defaults }, preconditions: [...requirements.values()].map((requirement) => ({ text: requirement.text, predicate_refs: [requirement.predicate], data_binding_keys: [] })),
        path: pathEdgeIds, steps, status: steps.some((step) => step.action.startsWith("unresolved")) ? "unresolved" : "draft",
      });
    }
  }
  return { schema_version: 2, project_id: facts.project_id, analysis_run_id: facts.analysis_run_id, source_snapshot_id: facts.source_snapshot_id, scenarios };
}

const backNavigationMarker = (value: string): boolean =>
  /(?:^|[^a-z0-9])(?:back|previous|return|cancel)(?:$|[^a-z0-9])/i.test(value) || /이전|뒤로|되돌|취소/.test(value);

/**
 * A scenario never walks a regression edge: replaying an earlier journey stage would let a
 * scenario run without terminating. An edge regresses when its element is a back control, or,
 * when a journey stage map is supplied, when it lands on a screen an earlier stage already owns.
 * Termination itself is guaranteed by using each edge at most once; the stage map additionally
 * keeps auto-inserted connectors from walking a journey backwards.
 */
export function isJourneyRegressionEdge(
  edge: FactEdge,
  facts: FactBundle,
  stageByScreen: ReadonlyMap<string, number> = new Map(),
): boolean {
  const element = facts.screens.flatMap((screen) => screen.elements).find((entry) => entry.id === edge.on);
  if (element && (backNavigationMarker(element.interaction.action_kind) || backNavigationMarker(element.label))) return true;
  const from = stageByScreen.get(baseScreenId(edge.from));
  const to = stageByScreen.get(baseScreenId(edge.to));
  return from !== undefined && to !== undefined && to < from;
}

function journeyStageByScreen(journey: JourneyWorkflowLinks["journeys"][number], facts: FactBundle): Map<string, number> {
  const edges = new Map(facts.edges.map((edge) => [edge.edge_id, edge] as const));
  const stages = new Map<string, number>();
  for (const milestone of [...journey.milestones].sort((left, right) => left.position - right.position)) {
    for (const edgeRef of milestone.edge_refs) {
      const edge = edges.get(edgeRef);
      if (!edge) continue;
      for (const screen of [baseScreenId(edge.from), baseScreenId(edge.to)]) {
        if (!stages.has(screen)) stages.set(screen, milestone.position);
      }
    }
  }
  return stages;
}

export type JourneyWalkAudit = {
  journey_ref: string;
  complete: boolean;
  path: string[];
  break?: { at_screen: string; next_edge_ref: string; next_from_screen: string };
};

/**
 * Walks one journey's milestone edges the way a scenario runs it: forward only, each edge at most
 * once. Reports where the walk stops so the linking stage can say which milestone cannot be reached
 * instead of silently producing a journey nobody can run.
 */
function planJourneyWalk(facts: FactBundle, journey: JourneyWorkflowLinks["journeys"][number]): JourneyWalkAudit {
  const edges = new Map(facts.edges.map((edge) => [edge.edge_id, edge]));
  const origins = shellOriginScreens(facts);
  const normalOutgoing = new Map<string, FactEdge[]>();
  for (const edge of [...facts.edges].filter((entry) => entry.kind === "normal").sort((left, right) => left.edge_id.localeCompare(right.edge_id))) {
    const from = baseScreenId(edge.from);
    normalOutgoing.set(from, [...(normalOutgoing.get(from) ?? []), edge]);
  }
  const reachableFrom = (screen: string): FactEdge[] => (origins.get(screen) ?? [screen]).flatMap((origin) => normalOutgoing.get(origin) ?? []);
  const stageByScreen = journeyStageByScreen(journey, facts);
  const bridge = (from: string, to: string, used: ReadonlySet<string>): string[] | undefined => {
    if (from === to) return [];
    const seen = new Set([from]);
    const queue: Array<{ screen: string; path: string[] }> = [{ screen: from, path: [] }];
    while (queue.length) {
      const { screen, path } = queue.shift()!;
      for (const edge of reachableFrom(screen)) {
        const target = baseScreenId(edge.to);
        if (seen.has(target) || used.has(edge.edge_id) || isJourneyRegressionEdge(edge, facts, stageByScreen)) continue;
        const next = [...path, edge.edge_id];
        if (target === to) return next;
        seen.add(target);
        queue.push({ screen: target, path: next });
      }
    }
    return undefined;
  };
  const ordered = [...journey.milestones].sort((left, right) => left.position - right.position);
  const sequence: string[] = [];
  for (const edgeRef of ordered.flatMap((milestone) => milestone.edge_refs)) {
    if (sequence.at(-1) !== edgeRef) sequence.push(edgeRef);
  }
  const deadEndDetour = (edge: FactEdge, index: number): boolean => {
    const target = baseScreenId(edge.to);
    if (index === sequence.length - 1 || target === baseScreenId(edge.from)) return false;
    return !sequence.slice(index + 1).some((laterRef) => {
      const later = edges.get(laterRef);
      return later ? (origins.get(baseScreenId(later.from)) ?? [baseScreenId(later.from)]).includes(target) : false;
    });
  };
  const path: string[] = [];
  const used = new Set<string>();
  let screen: string | undefined;
  for (const [index, edgeRef] of sequence.entries()) {
    const edge = edges.get(edgeRef);
    if (!edge) throw new Error(`JOURNEY_SCENARIO_EDGE_UNKNOWN:${journey.journey_ref}:${edgeRef}`);
    if (used.has(edgeRef) || isJourneyRegressionEdge(edge, facts) || deadEndDetour(edge, index)) continue;
    const from = baseScreenId(edge.from);
    screen ??= from;
    if (!(origins.get(screen) ?? [screen]).includes(from) && screen === baseScreenId(edge.to)) continue;
    if (!(origins.get(screen) ?? [screen]).includes(from)) {
      const connector = bridge(screen, from, used);
      if (!connector) {
        return { journey_ref: journey.journey_ref, complete: false, path, break: { at_screen: screen, next_edge_ref: edgeRef, next_from_screen: from } };
      }
      connector.forEach((id) => { path.push(id); used.add(id); });
    }
    path.push(edgeRef);
    used.add(edgeRef);
    screen = baseScreenId(edge.to);
  }
  return { journey_ref: journey.journey_ref, complete: path.length > 0, path };
}

export function auditJourneyWalkability(facts: FactBundle, journeyLinks: JourneyWorkflowLinks): JourneyWalkAudit[] {
  return journeyLinks.journeys.map((journey) => planJourneyWalk(facts, journey));
}

export function compileJourneyCompleteScenarios(facts: FactBundle, journeyLinks: JourneyWorkflowLinks): ScenarioRecord[] {
  const edges = new Map(facts.edges.map((edge) => [edge.edge_id, edge]));
  const elements = new Map(facts.screens.flatMap((screen) => screen.elements.map((element) => [element.id, element] as const)));
  const feedback = new Map(facts.screens.flatMap((screen) => screen.feedback.map((item) => [item.id, item] as const)));

  const scenarios: ScenarioRecord[] = [];
  for (const journey of journeyLinks.journeys) {
    const walk = planJourneyWalk(facts, journey);
    if (!walk.complete) continue;
    const ordered = [...journey.milestones].sort((left, right) => left.position - right.position);
    const pathEdgeIds = walk.path;
    const pathEdges = pathEdgeIds.map((id) => edges.get(id)!);
    const state = new Map<string, string>();
    const requirements = new Map<string, { text: string; predicate: string }>();
    pathEdges.forEach((edge) => {
      edge.guard?.split(/\s*&&\s*/).forEach((clause) => {
        const match = clause.match(/^(PRED-[A-Za-z0-9_.-]+)(?:=(.*))?$/);
        if (!match) return;
        if (match[2] !== undefined && state.get(match[1]) === match[2]) return;
        requirements.set(clause, { text: clause, predicate: match[1] });
      });
      assignments(edge.effect).forEach(({ predicate, value }) => state.set(predicate, value));
    });
    const steps = pathEdges.map((edge, index) => {
      const element = elements.get(edge.on);
      const expectedParts = edge.feedback.map((id) => feedback.get(id)?.text).filter(Boolean);
      return {
        n: index + 1,
        action: element ? `'${element.label}' ${element.interaction.action_kind}` : "unresolved action",
        action_ref: { edge: edge.edge_id, element: edge.on },
        expected: expectedParts.length ? expectedParts.join("; ") : `at ${edge.to}`,
        assertion_refs: [...edge.feedback, baseScreenId(edge.to)],
      };
    });
    const businessResult = ordered.filter((milestone) => milestone.phase === "business-result").at(-1);
    const workflow = businessResult?.workflow_refs[0] ?? ordered.at(-1)?.workflow_refs[0];
    if (!workflow) throw new Error(`JOURNEY_SCENARIO_WORKFLOW_MISSING:${journey.journey_ref}`);
    scenarios.push({
      schema_version: 2,
      project_id: facts.project_id,
      analysis_run_id: facts.analysis_run_id,
      source_snapshot_id: facts.source_snapshot_id,
      scenario_id: `SCN-JOURNEY-${journey.journey_ref}-001`,
      workflow,
      kind: pathEdges.some((edge) => edge.kind === "exception") ? "exception" : "normal",
      variation: {},
      preconditions: [...requirements.values()].map((requirement) => ({ text: requirement.text, predicate_refs: [requirement.predicate], data_binding_keys: [] })),
      path: pathEdgeIds,
      steps,
      status: steps.some((step) => step.action.startsWith("unresolved")) ? "unresolved" : "draft",
    });
  }
  return scenarios;
}

export function compileScenarioSkeleton(facts: FactBundle, wiki: WikiBundle, businessCatalog: BusinessCatalog, journeyLinks?: JourneyWorkflowLinks): ScenarioSkeleton {
  const scenarios = [...compileScenarioSet(facts, wiki).scenarios, ...(journeyLinks ? compileJourneyCompleteScenarios(facts, journeyLinks) : [])];
  const classificationByWorkflow = new Map(businessCatalog.classifications.flatMap((classification) => classification.workflow_refs.map((workflow) => [workflow, classification.classification_id] as const)));
  const classificationByScenario = Object.fromEntries(scenarios.map((scenario) => {
    const classification = classificationByWorkflow.get(scenario.workflow);
    if (!classification) throw new Error(`SCENARIO_BUSINESS_CLASSIFICATION_MISSING:${scenario.workflow}`);
    return [scenario.scenario_id, classification];
  }));
  return { schema_version: 1, project_id: facts.project_id, analysis_run_id: facts.analysis_run_id, source_snapshot_id: facts.source_snapshot_id, scenarios, classification_by_scenario: classificationByScenario };
}

export function compileJourneyScenarioBindings(
  skeleton: ScenarioSkeleton,
  journeyLinks: JourneyWorkflowLinks,
  inventory: GuardedPathInventory,
  facts?: FactBundle,
): JourneyScenarioBindings {
  const identity = [skeleton.project_id, skeleton.analysis_run_id, skeleton.source_snapshot_id];
  if ([journeyLinks, inventory].some((artifact) => [artifact.project_id, artifact.analysis_run_id, artifact.source_snapshot_id]
    .some((value, index) => value !== identity[index]))) {
    throw new Error("SCENARIO_JOURNEY_BINDING_IDENTITY_MISMATCH");
  }
  const knownWorkflows = new Set(skeleton.scenarios.map((scenario) => scenario.workflow));
  const edgeFeasibility = new Map(inventory.edges.map((edge) => [edge.edge_ref, edge.feasibility]));
  // A milestone the journey walk drops is not part of the journey a user can run, so a scenario must
  // not be reported as belonging to it. Without facts the walk cannot be replayed and every declared
  // milestone still binds, which keeps older callers working.
  const walkedEdgeRefs = facts
    ? new Map(auditJourneyWalkability(facts, journeyLinks).map((audit) => [audit.journey_ref, new Set(audit.path)]))
    : undefined;
  const milestoneByWorkflow = new Map<string, Array<{ journey_ref: string; journey_kind: "normal" | "recovery"; milestone_position: number; phase: string }>>();
  for (const journey of journeyLinks.journeys) {
    const walked = walkedEdgeRefs?.get(journey.journey_ref);
    for (const milestone of journey.milestones) {
      const dropped = walked !== undefined && !milestone.edge_refs.some((edgeRef) => walked.has(edgeRef));
      for (const workflowRef of milestone.workflow_refs) {
        if (!knownWorkflows.has(workflowRef)) throw new Error(`SCENARIO_JOURNEY_BINDING_WORKFLOW_INVALID:${workflowRef}`);
        if (dropped) continue;
        milestoneByWorkflow.set(workflowRef, [...(milestoneByWorkflow.get(workflowRef) ?? []), {
          journey_ref: journey.journey_ref,
          journey_kind: journey.kind,
          milestone_position: milestone.position,
          phase: milestone.phase,
        }]);
      }
    }
  }
  const roleOrder = ["normal", "exception", "failure", "recovery"] as const;
  const scenarios = skeleton.scenarios.map((scenario) => {
    const milestones = milestoneByWorkflow.get(scenario.workflow) ?? [];
    const roles = new Set<JourneyScenarioBindings["scenarios"][number]["roles"][number]>([scenario.kind]);
    if (milestones.some((milestone) => milestone.phase === "failure")) roles.add("failure");
    if (milestones.some((milestone) => milestone.journey_kind === "recovery")) roles.add("recovery");
    const pathFeasibility = scenario.path.map((edgeRef) => edgeFeasibility.get(edgeRef));
    if (pathFeasibility.some((feasibility) => !feasibility)) throw new Error(`SCENARIO_JOURNEY_BINDING_EDGE_INVALID:${scenario.scenario_id}`);
    return {
      scenario_ref: scenario.scenario_id,
      workflow_ref: scenario.workflow,
      path: [...scenario.path],
      feasibility: pathFeasibility.every((feasibility) => feasibility === "source-supported") ? "source-supported" as const : "runtime-unverified" as const,
      roles: roleOrder.filter((role) => roles.has(role)),
      journey_milestones: milestones.map(({ journey_kind: _journeyKind, ...milestone }) => milestone),
    };
  });
  const unboundScenarioRefs = scenarios.filter((scenario) => !scenario.journey_milestones.length).map((scenario) => scenario.scenario_ref);
  return {
    schema_version: 1,
    project_id: skeleton.project_id,
    analysis_run_id: skeleton.analysis_run_id,
    source_snapshot_id: skeleton.source_snapshot_id,
    scenarios,
    coverage: {
      total_scenarios: scenarios.length,
      journey_bound_scenarios: scenarios.length - unboundScenarioRefs.length,
      unbound_scenario_refs: unboundScenarioRefs,
    },
  };
}

export function scenarioSetFromSkeleton(skeleton: ScenarioSkeleton): ScenarioSet {
  return { schema_version: 2, project_id: skeleton.project_id, analysis_run_id: skeleton.analysis_run_id, source_snapshot_id: skeleton.source_snapshot_id, scenarios: structuredClone(skeleton.scenarios) };
}

export function applyScenarioNarrationPatch(draft: ScenarioSet, patch: ScenarioNarrationPatch): ScenarioSet {
  if (!patch || patch.schema_version !== 1 || !Array.isArray(patch.scenario_updates) || Object.keys(patch).some((key) => !["schema_version", "scenario_updates"].includes(key))) {
    throw new Error("SCENARIO_NARRATION_PATCH_INVALID");
  }
  const scenarios = new Map(draft.scenarios.map((scenario) => [scenario.scenario_id, scenario]));
  const updates = new Map<string, ScenarioNarrationPatch["scenario_updates"][number]>();
  for (const update of patch.scenario_updates) {
    if (!update || typeof update.scenario_ref !== "string" || !Array.isArray(update.preconditions) || !Array.isArray(update.steps) || Object.keys(update).some((key) => !["scenario_ref", "preconditions", "steps"].includes(key))) {
      throw new Error("SCENARIO_NARRATION_PATCH_INVALID");
    }
    const scenario = scenarios.get(update.scenario_ref);
    if (!scenario) throw new Error(`SCENARIO_NARRATION_PATCH_REFERENCE_INVALID:${update.scenario_ref}`);
    if (updates.has(update.scenario_ref)) throw new Error(`SCENARIO_NARRATION_PATCH_DUPLICATE:${update.scenario_ref}`);
    const preconditionIndexes = new Set<number>();
    const stepNumbers = new Set<number>();
    const preconditionsValid = update.preconditions.every((entry) => entry
      && Number.isInteger(entry.index)
      && entry.index >= 0
      && entry.index < scenario.preconditions.length
      && !preconditionIndexes.has(entry.index)
      && (preconditionIndexes.add(entry.index), true)
      && typeof entry.text === "string"
      && Boolean(entry.text.trim())
      && Object.keys(entry).every((key) => ["index", "text"].includes(key)));
    const stepsValid = update.steps.every((entry) => entry
      && Number.isInteger(entry.n)
      && scenario.steps.some((step) => step.n === entry.n)
      && !stepNumbers.has(entry.n)
      && (stepNumbers.add(entry.n), true)
      && typeof entry.action === "string"
      && Boolean(entry.action.trim())
      && typeof entry.expected === "string"
      && Boolean(entry.expected.trim())
      && Object.keys(entry).every((key) => ["n", "action", "expected"].includes(key)));
    if (!preconditionsValid || !stepsValid || update.preconditions.length !== scenario.preconditions.length || update.steps.length !== scenario.steps.length) {
      throw new Error(`SCENARIO_NARRATION_PATCH_INCOMPLETE:${update.scenario_ref}`);
    }
    updates.set(update.scenario_ref, update);
  }
  if (updates.size !== draft.scenarios.length) throw new Error("SCENARIO_NARRATION_PATCH_INCOMPLETE");
  return {
    ...structuredClone(draft),
    scenarios: draft.scenarios.map((scenario) => {
      const update = updates.get(scenario.scenario_id)!;
      const preconditionText = new Map(update.preconditions.map((entry) => [entry.index, entry.text.trim()]));
      const stepNarration = new Map(update.steps.map((entry) => [entry.n, entry]));
      return {
        ...structuredClone(scenario),
        preconditions: scenario.preconditions.map((precondition, index) => ({ ...structuredClone(precondition), text: preconditionText.get(index)! })),
        steps: scenario.steps.map((step) => ({ ...structuredClone(step), action: stepNarration.get(step.n)!.action.trim(), expected: stepNarration.get(step.n)!.expected.trim() })),
      };
    }),
  };
}

export function createScenarioNarrationCorrectionScope(set: ScenarioSet, issueCodes: readonly string[]): ScenarioNarrationCorrectionScope {
  const scenarioRefs = issueTargetRefs(issueCodes, set.scenarios.map((scenario) => scenario.scenario_id), "SCENARIO_CORRECTION_SCOPE_UNMAPPABLE");
  const fields = Object.fromEntries(scenarioRefs.map((scenarioRef) => {
    const scenario = set.scenarios.find((candidate) => candidate.scenario_id === scenarioRef)!;
    const matchingIssues = issueCodes.filter((code) => referenceMentioned(code, scenarioRef));
    const preconditionIndexes = new Set<number>();
    const stepFields = new Map<number, Set<"action" | "expected">>();
    for (const code of matchingIssues) {
      for (const match of code.matchAll(/preconditions?(?:\.|=|:)(\d+)/gi)) {
        const index = Number(match[1]);
        if (index >= 0 && index < scenario.preconditions.length) preconditionIndexes.add(index);
      }
      for (const match of code.matchAll(/steps?(?:\.|=|:)(\d+)/gi)) {
        const n = Number(match[1]);
        if (!scenario.steps.some((step) => step.n === n)) continue;
        const selected = stepFields.get(n) ?? new Set<"action" | "expected">();
        if (/(?:^|[^A-Za-z])action(?:$|[^A-Za-z])/i.test(code)) selected.add("action");
        if (/(?:^|[^A-Za-z])expected(?:$|[^A-Za-z])/i.test(code)) selected.add("expected");
        if (!selected.size) { selected.add("action"); selected.add("expected"); }
        stepFields.set(n, selected);
      }
    }
    if (!preconditionIndexes.size && !stepFields.size) {
      scenario.preconditions.forEach((_entry, index) => preconditionIndexes.add(index));
      scenario.steps.forEach((step) => stepFields.set(step.n, new Set(["action", "expected"])));
    }
    return [scenarioRef, {
      precondition_indexes: [...preconditionIndexes].sort((left, right) => left - right),
      step_fields: Object.fromEntries([...stepFields].sort(([left], [right]) => left - right).map(([n, selected]) => [String(n), [...selected].sort()])),
    }];
  }));
  return {
    base_artifact_hash: semanticArtifactHash(set),
    scenario_refs: scenarioRefs,
    fields,
  };
}

export function applyScenarioNarrationCorrectionPatch(
  set: ScenarioSet,
  scope: ScenarioNarrationCorrectionScope,
  patch: ScenarioNarrationCorrectionPatch,
): ScenarioSet {
  if (!patch || patch.schema_version !== 1 || patch.base_artifact_hash !== scope.base_artifact_hash || semanticArtifactHash(set) !== scope.base_artifact_hash) {
    throw new Error("SCENARIO_CORRECTION_PATCH_BASE_MISMATCH");
  }
  if (!Array.isArray(patch.scenario_updates) || Object.keys(patch).some((key) => !["schema_version", "base_artifact_hash", "scenario_updates"].includes(key))) throw new Error("SCENARIO_CORRECTION_PATCH_INVALID");
  const supplied = [...patch.scenario_updates.map((update) => update.scenario_ref)].sort();
  if (!sameRefSet(supplied, scope.scenario_refs)) throw new Error("SCENARIO_CORRECTION_PATCH_SCOPE_INVALID");
  const merged = structuredClone(set);
  for (const update of patch.scenario_updates) {
    if (!update || typeof update.scenario_ref !== "string" || Object.keys(update).some((key) => !["scenario_ref", "preconditions", "steps"].includes(key))) throw new Error("SCENARIO_CORRECTION_PATCH_INVALID");
    const target = merged.scenarios.find((scenario) => scenario.scenario_id === update.scenario_ref);
    const authorized = scope.fields[update.scenario_ref];
    if (!target || !authorized) throw new Error("SCENARIO_CORRECTION_PATCH_SCOPE_INVALID");
    const preconditions = update.preconditions ?? [];
    const steps = update.steps ?? [];
    if (!sameRefSet(preconditions.map((entry) => String(entry.index)).sort(), authorized.precondition_indexes.map(String).sort())
      || !sameRefSet(steps.map((entry) => String(entry.n)).sort(), Object.keys(authorized.step_fields).sort())) {
      throw new Error("SCENARIO_CORRECTION_PATCH_FIELDS_INCOMPLETE");
    }
    for (const entry of preconditions) {
      if (!entry || !Number.isInteger(entry.index) || typeof entry.text !== "string" || !entry.text.trim() || Object.keys(entry).some((key) => !["index", "text"].includes(key))) throw new Error("SCENARIO_CORRECTION_PATCH_INVALID");
      target.preconditions[entry.index]!.text = entry.text.trim();
    }
    for (const entry of steps) {
      if (!entry || !Number.isInteger(entry.n) || Object.keys(entry).some((key) => !["n", "action", "expected"].includes(key))) throw new Error("SCENARIO_CORRECTION_PATCH_INVALID");
      const allowedFields = authorized.step_fields[String(entry.n)] ?? [];
      const suppliedFields = Object.keys(entry).filter((key): key is "action" | "expected" => key === "action" || key === "expected").sort();
      if (!sameRefSet(suppliedFields, [...allowedFields].sort()) || suppliedFields.some((field) => typeof entry[field] !== "string" || !entry[field]!.trim())) throw new Error("SCENARIO_CORRECTION_PATCH_FIELD_SCOPE_INVALID");
      const step = target.steps.find((candidate) => candidate.n === entry.n)!;
      if (entry.action !== undefined) step.action = entry.action.trim();
      if (entry.expected !== undefined) step.expected = entry.expected.trim();
    }
  }
  assertRecordsPreserved(set.scenarios, merged.scenarios, scope.scenario_refs, (scenario) => scenario.scenario_id, "SCENARIO_CORRECTION_OUTSIDE_SCOPE_CHANGED");
  return merged;
}

function issueTargetRefsOrEmpty(issueCodes: readonly string[], knownRefs: readonly string[]): string[] {
  return knownRefs.filter((reference) => issueCodes.some((code) => referenceMentioned(code, reference))).sort();
}

function referenceMentioned(value: string, reference: string): boolean {
  const escaped = reference.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^A-Za-z0-9._-])${escaped}(?:$|[^A-Za-z0-9._-])`).test(value);
}

function sameRefSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]) && new Set(left).size === left.length;
}

function assertRecordsPreserved<T>(
  before: readonly T[],
  after: readonly T[],
  targetRefs: readonly string[],
  identify: (record: T) => string,
  errorCode: string,
): void {
  const targets = new Set(targetRefs);
  const afterById = new Map(after.map((record) => [identify(record), record]));
  for (const record of before) {
    const id = identify(record);
    if (!targets.has(id) && JSON.stringify(record) !== JSON.stringify(afterById.get(id))) throw new Error(errorCode);
  }
}

export type CoverageReport = { total_edges: number; covered_edges: number; uncovered_edge_ids: string[]; coverage_percent: number; assumed_predicates: string[] };
export function calculateCoverage(facts: FactBundle, scenarios: ScenarioSet): CoverageReport {
  const covered = new Set(scenarios.scenarios.flatMap((scenario) => scenario.path));
  const uncovered = facts.edges.map((edge) => edge.edge_id).filter((id) => !covered.has(id)).sort();
  return { total_edges: facts.edges.length, covered_edges: facts.edges.length - uncovered.length, uncovered_edge_ids: uncovered, coverage_percent: facts.edges.length ? Math.round(((facts.edges.length - uncovered.length) / facts.edges.length) * 10000) / 100 : 100, assumed_predicates: facts.predicates.filter((predicate) => predicate.source === "assumed").map((predicate) => predicate.pred_id).sort() };
}
