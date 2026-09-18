import type { EvidenceReference, FactBundle, ScenarioSet, SourceSnapshot, ValidationIssue, WikiBundle } from "@scenarioforge/contracts";
import { calculateCoverage, compileScenarioSet, uncoveredWorkflowEdgeIds } from "../graph/graph-tools.js";

export type ArtifactValidation = { valid: boolean; issues: ValidationIssue[] };
const issue = (code: string, path: string, message: string): ValidationIssue => ({ code, severity: "error", path, message });
const identityValid = (value: { project_id?: string; analysis_run_id?: string; source_snapshot_id?: string }): boolean => Boolean(value.project_id?.trim() && value.analysis_run_id?.trim() && value.source_snapshot_id?.trim());
const asyncActionKind = (actionKind: string): boolean => /(?:^|[_-])(?:auth|authenticate|login|submit|upload|parse|generate|preset|export|download|fetch|request)(?:$|[_-])/i.test(actionKind);
const requestStartOnlyEffect = (effect: string | undefined): boolean => {
  if (!effect) return false;
  const clauses = effect.split(/\s*&&\s*/);
  return clauses.length > 0 && clauses.every((clause) => {
    const assignment = clause.match(/^(PRED-[A-Za-z0-9_.-]+)=(.*)$/);
    if (!assignment) return false;
    const [, predicateId, value] = assignment;
    const stableOutcome = value === "" || /^(?:completed?|succeeded|success|done|ready|loaded|parsed|authenticated|exported|downloaded|generated)$/i.test(value);
    return !stableOutcome && /(?:^|[._-])(?:request(?:ing)?|busy|loading|poll(?:ing)?|pending|start(?:ed|ing)?|submitting|uploading|generating|exporting|downloading|parsing|authenticating|fetching|processing|in-progress)(?:$|[._-])/i.test(predicateId);
  });
};

function validateEvidence(evidence: EvidenceReference[], path: string, snapshotId: string, issues: ValidationIssue[]): void {
  if (!evidence.length) issues.push(issue("EVIDENCE_REQUIRED", path, "At least one evidence reference is required."));
  evidence.forEach((reference, index) => {
    if (reference.source_snapshot_id !== snapshotId) issues.push(issue("EVIDENCE_SNAPSHOT_MISMATCH", `${path}.${index}`, "Evidence must use the active source snapshot."));
    if (!reference.content_hash.startsWith("sha256:") || !reference.evidence_grant_id.startsWith("EVG-")) issues.push(issue("EVIDENCE_PROVENANCE_INVALID", `${path}.${index}`, "Evidence hash and grant are required."));
    if (reference.start_line < 1 || reference.end_line < reference.start_line) issues.push(issue("EVIDENCE_RANGE_INVALID", `${path}.${index}`, "Evidence line range is invalid."));
  });
}

export function collectFactEvidence(bundle: FactBundle): EvidenceReference[] {
  const references = [
    ...bundle.screens.flatMap((screen) => [
      ...screen.elements.flatMap((element) => element.evidence),
      ...screen.apis.flatMap((api) => api.evidence),
      ...screen.feedback.flatMap((feedback) => feedback.evidence),
      ...screen.displays.flatMap((display) => display.evidence),
    ]),
    ...bundle.edges.flatMap((edge) => edge.evidence),
    ...bundle.predicates.flatMap((predicate) => predicate.evidence),
  ];
  const unique = new Map(references.map((reference) => [`${reference.evidence_grant_id}:${reference.source_id}:${reference.start_line}:${reference.end_line}:${reference.content_hash}`, reference]));
  return [...unique.values()];
}

export function validateSourceSnapshot(snapshot: SourceSnapshot): ArtifactValidation {
  const issues: ValidationIssue[] = [];
  if (!snapshot || typeof snapshot !== "object" || !Array.isArray(snapshot.files) || !Array.isArray(snapshot.routes) || !Array.isArray(snapshot.apis) || !Array.isArray(snapshot.interactions) || !snapshot.i18n || typeof snapshot.i18n !== "object") return { valid: false, issues: [issue("SOURCE_SCHEMA_INVALID", "$", "Source snapshot structure is invalid.")] };
  if (!identityValid(snapshot)) issues.push(issue("COMMON_IDENTITY_INVALID", "$", "Common project/run/snapshot IDs are required."));
  if (snapshot.schema_version !== 1) issues.push(issue("SOURCE_SCHEMA_INVALID", "schema_version", "Source schema version must be 1."));
  if (!snapshot.root_hash.startsWith("sha256:")) issues.push(issue("SOURCE_ROOT_HASH_INVALID", "root_hash", "Root hash is required."));
  const ids = new Set<string>();
  snapshot.files.forEach((file, index) => {
    if (ids.has(file.source_id)) issues.push(issue("DUPLICATE_SOURCE_ID", `files.${index}.source_id`, "Source IDs must be unique."));
    ids.add(file.source_id);
    if (!file.content_hash.startsWith("sha256:") || file.path.startsWith("/") || file.path.includes("..")) issues.push(issue("SOURCE_PROVENANCE_INVALID", `files.${index}`, "Source path and hash are invalid."));
  });
  if (snapshot.source_behaviors !== undefined) {
    if (!Array.isArray(snapshot.source_behaviors)) return { valid: false, issues: [issue("SOURCE_BEHAVIOR_SCHEMA_INVALID", "source_behaviors", "Source behaviors must be an array.")] };
    const filesById = new Map(snapshot.files.map((file) => [file.source_id, file]));
    const interactionsById = new Map(snapshot.interactions.map((interaction) => [interaction.element_id, interaction]));
    const behaviorIds = new Set<string>();
    const validateRefs = (refs: unknown, path: string): void => {
      if (!Array.isArray(refs) || !refs.length) {
        issues.push(issue("SOURCE_BEHAVIOR_PROVENANCE_INVALID", path, "Source-backed behavior references are required."));
        return;
      }
      refs.forEach((reference, refIndex) => {
        if (!reference || typeof reference !== "object") {
          issues.push(issue("SOURCE_BEHAVIOR_PROVENANCE_INVALID", `${path}.${refIndex}`, "Source behavior reference is invalid."));
          return;
        }
        const value = reference as { source_id?: unknown; source_snapshot_id?: unknown; path?: unknown; line?: unknown; content_hash?: unknown };
        const file = typeof value.source_id === "string" ? filesById.get(value.source_id) : undefined;
        if (!file || value.source_snapshot_id !== snapshot.source_snapshot_id || value.path !== file.path || value.content_hash !== file.content_hash || typeof value.line !== "number" || value.line < 1) {
          issues.push(issue("SOURCE_BEHAVIOR_PROVENANCE_INVALID", `${path}.${refIndex}`, "Source behavior reference must match the active snapshot file and hash."));
        }
      });
    };
    snapshot.source_behaviors.forEach((behavior, index) => {
      const path = `source_behaviors.${index}`;
      if (behaviorIds.has(behavior.element_id)) issues.push(issue("DUPLICATE_SOURCE_BEHAVIOR", `${path}.element_id`, "Source behavior element IDs must be unique."));
      behaviorIds.add(behavior.element_id);
      const interaction = interactionsById.get(behavior.element_id);
      if (!interaction) issues.push(issue("SOURCE_BEHAVIOR_ELEMENT_INVALID", `${path}.element_id`, "Source behavior must reference a scanned interaction."));
      const behaviorFile = filesById.get(behavior.source_id);
      if (interaction && (interaction.source_id !== behavior.source_id || behaviorFile?.path !== behavior.path || interaction.line !== behavior.line
        || (interaction.screen_id !== undefined && behavior.screen_id !== interaction.screen_id))) {
        issues.push(issue("SOURCE_BEHAVIOR_PROVENANCE_INVALID", path, "Source behavior identity and location must match its scanned interaction."));
      }
      if (!Array.isArray(behavior.entry_guards) || !Array.isArray(behavior.persona_guards) || !behavior.view_state || !Array.isArray(behavior.view_state.states)
        || !Array.isArray(behavior.api_connections) || !behavior.response_consumer || !Array.isArray(behavior.response_consumer.state_keys)
        || !Array.isArray(behavior.response_consumer.next_view_states) || !Array.isArray(behavior.branches) || !Array.isArray(behavior.unresolved)
        || !["verified", "inferred", "unresolved"].includes(behavior.feasibility ?? "")) {
        issues.push(issue("SOURCE_BEHAVIOR_SCHEMA_INVALID", path, "A new scan must store complete structured behavior metadata."));
        return;
      }
      validateRefs(behavior.source_refs, `${path}.source_refs`);
      validateRefs(behavior.response_consumer.source_refs, `${path}.response_consumer.source_refs`);
      behavior.api_connections.forEach((connection, connectionIndex) => {
        const connectionPath = `${path}.api_connections.${connectionIndex}`;
        if (!connection || typeof connection.api_symbol !== "string" || !connection.api_symbol.trim()
          || !["GET", "POST", "PUT", "PATCH", "DELETE"].includes(connection.method)
          || typeof connection.path !== "string" || !connection.path.startsWith("/")
          || !["verified", "inferred", "unresolved"].includes(connection.feasibility)) {
          issues.push(issue("SOURCE_BEHAVIOR_SCHEMA_INVALID", connectionPath, "Source API connection metadata is invalid."));
          return;
        }
        validateRefs(connection.source_refs, `${path}.api_connections.${connectionIndex}.source_refs`);
        if (connection.backend) {
          if (typeof connection.backend.handler_symbol !== "string" || !connection.backend.handler_symbol.trim()
            || typeof connection.backend.route_path !== "string" || !connection.backend.route_path.startsWith("/")
            || connection.backend.route_method !== connection.method || !Array.isArray(connection.backend.service_symbols)
            || !Array.isArray(connection.backend.auth_guards) || !Array.isArray(connection.backend.success_statuses)
            || !Array.isArray(connection.backend.failure_statuses)) {
            issues.push(issue("SOURCE_BEHAVIOR_SCHEMA_INVALID", `${connectionPath}.backend`, "Source backend connection metadata is invalid."));
          }
          validateRefs(connection.backend.source_refs, `${connectionPath}.backend.source_refs`);
        }
      });
      const branchRefs = new Set<string>();
      behavior.branches.forEach((branch, branchIndex) => {
        const branchPath = `${path}.branches.${branchIndex}`;
        if (!branch || !/^(?:normal|exception):[1-9]\d*$/.test(branch.branch_ref)
          || branch.branch_ref.split(":")[0] !== branch.outcome
          || !Array.isArray(branch.guard_keys) || branch.guard_keys.some((key) => typeof key !== "string" || !key.trim())
          || !["verified", "inferred", "unresolved"].includes(branch.feasibility)
          || (branch.response_status !== undefined && (!Number.isInteger(branch.response_status) || branch.response_status < 100 || branch.response_status > 599))) {
          issues.push(issue("SOURCE_BEHAVIOR_SCHEMA_INVALID", branchPath, "Source branch metadata is invalid."));
          return;
        }
        if (branchRefs.has(branch.branch_ref)) issues.push(issue("SOURCE_BEHAVIOR_SCHEMA_INVALID", `${branchPath}.branch_ref`, "Source branch references must be unique per behavior."));
        branchRefs.add(branch.branch_ref);
        validateRefs(branch.source_refs, `${branchPath}.source_refs`);
      });
    });
  }
  return { valid: issues.length === 0, issues };
}

export function validateFactBundle(bundle: FactBundle): ArtifactValidation {
  const issues: ValidationIssue[] = [];
  if (!bundle || typeof bundle !== "object" || !Array.isArray(bundle.screens) || !Array.isArray(bundle.edges) || !Array.isArray(bundle.predicates)) return { valid: false, issues: [issue("FACT_SCHEMA_INVALID", "$", "FACT bundle structure is invalid.")] };
  if (bundle.screens.some((screen) => !screen || !Array.isArray(screen.elements) || !Array.isArray(screen.apis) || !Array.isArray(screen.feedback) || !Array.isArray(screen.displays) || !Array.isArray(screen.entry_guards)) || bundle.edges.some((edge) => !edge || !Array.isArray(edge.feedback) || !Array.isArray(edge.evidence)) || bundle.predicates.some((predicate) => !predicate || !Array.isArray(predicate.values) || !Array.isArray(predicate.evidence))) return { valid: false, issues: [issue("FACT_SCHEMA_INVALID", "$", "FACT records contain invalid collections.")] };
  if (bundle.screens.some((screen) => screen.elements.some((element) => !element || !Array.isArray(element.evidence) || !element.interaction || !Array.isArray(element.interaction.target_candidates)) || screen.apis.some((api) => !api || !Array.isArray(api.evidence) || !Array.isArray(api.reads) || !Array.isArray(api.writes)) || screen.feedback.some((feedback) => !feedback || !Array.isArray(feedback.evidence) || !feedback.assertion) || screen.displays.some((display) => !display || !Array.isArray(display.evidence) || !display.assertion))) return { valid: false, issues: [issue("FACT_SCHEMA_INVALID", "$", "FACT nested records are invalid.")] };
  if (!identityValid(bundle) || bundle.schema_version !== 2) issues.push(issue("FACT_SCHEMA_INVALID", "$", "FACT bundle identity or version is invalid."));
  const screens = new Set(bundle.screens.map((screen) => screen.screen_id));
  const elementList = bundle.screens.flatMap((screen) => screen.elements.map((element) => element.id));
  const elements = new Set(elementList);
  const elementScreenById = new Map(bundle.screens.flatMap((screen) => screen.elements.map((element) => [element.id, screen.screen_id] as const)));
  const feedbackList = bundle.screens.flatMap((screen) => screen.feedback.map((item) => item.id));
  const feedback = new Set(feedbackList);
  const predicates = new Set(bundle.predicates.map((predicate) => predicate.pred_id));
  const allIds = [...screens, ...elementList, ...feedbackList, ...bundle.screens.flatMap((screen) => [...screen.apis.map((api) => api.id), ...screen.displays.map((display) => display.id)]), ...bundle.edges.map((edge) => edge.edge_id), ...bundle.predicates.map((predicate) => predicate.pred_id)];
  if (new Set(allIds).size !== allIds.length) issues.push(issue("DUPLICATE_FACT_ID", "$", "FACT IDs must be globally unique."));
  bundle.screens.forEach((screen, screenIndex) => {
    if (screen.schema_version !== 3 || !screen.title.trim() || screen.project_id !== bundle.project_id || screen.analysis_run_id !== bundle.analysis_run_id || screen.source_snapshot_id !== bundle.source_snapshot_id) issues.push(issue("FACT_SCREEN_INVALID", `screens.${screenIndex}`, "FACT screen v3, identity, and title are required."));
    screen.elements.forEach((element, elementIndex) => {
      validateEvidence(element.evidence, `screens.${screenIndex}.elements.${elementIndex}.evidence`, bundle.source_snapshot_id, issues);
      for (const candidate of element.interaction.target_candidates) {
        if (candidate.by === "coordinate" || "x" in candidate || "y" in candidate) issues.push(issue("CANONICAL_COORDINATE_FORBIDDEN", `screens.${screenIndex}.elements.${elementIndex}.interaction`, "Coordinates cannot be canonical targets."));
      }
    });
    screen.apis.forEach((api, index) => validateEvidence(api.evidence, `screens.${screenIndex}.apis.${index}.evidence`, bundle.source_snapshot_id, issues));
    screen.feedback.forEach((feedbackItem, index) => validateEvidence(feedbackItem.evidence, `screens.${screenIndex}.feedback.${index}.evidence`, bundle.source_snapshot_id, issues));
    screen.displays.forEach((display, index) => validateEvidence(display.evidence, `screens.${screenIndex}.displays.${index}.evidence`, bundle.source_snapshot_id, issues));
    if (screen.entry_guards.flatMap((guard) => guard.match(/PRED-[A-Za-z0-9_.-]+/g) ?? []).some((id) => !predicates.has(id))) issues.push(issue("SCREEN_GUARD_PREDICATE_INVALID", `screens.${screenIndex}.entry_guards`, "Screen guards must use registered predicates."));
  });
  bundle.edges.forEach((edge, edgeIndex) => {
    if (edge.schema_version !== 2 || edge.project_id !== bundle.project_id || edge.analysis_run_id !== bundle.analysis_run_id || edge.source_snapshot_id !== bundle.source_snapshot_id) issues.push(issue("FACT_EDGE_IDENTITY_INVALID", `edges.${edgeIndex}`, "Edge identity must match its FACT bundle."));
    if (edge.source_branch_ref !== undefined && !/^(?:normal|exception):[1-9]\d*$/.test(edge.source_branch_ref)) issues.push(issue("FACT_EDGE_SOURCE_BRANCH_INVALID", `edges.${edgeIndex}.source_branch_ref`, "Edge source branch reference is invalid."));
    if (!screens.has(edge.from.split("[")[0]) || !screens.has(edge.to.split("[")[0])) issues.push(issue("EDGE_SCREEN_REF_INVALID", `edges.${edgeIndex}`, "Edge screen reference is missing."));
    if (!elements.has(edge.on)) issues.push(issue("EDGE_ELEMENT_REF_INVALID", `edges.${edgeIndex}.on`, "Edge element reference is missing."));
    else if (elementScreenById.get(edge.on) !== edge.from.split("[")[0]) issues.push(issue("EDGE_ELEMENT_SCREEN_MISMATCH", `edges.${edgeIndex}.on`, "Edge trigger element must belong to the edge source screen."));
    if (edge.feedback.some((id) => !feedback.has(id))) issues.push(issue("EDGE_FEEDBACK_REF_INVALID", `edges.${edgeIndex}.feedback`, "Edge feedback reference is missing."));
    if ((edge.guard?.match(/PRED-[A-Za-z0-9_.-]+/g) ?? []).some((id) => !predicates.has(id))) issues.push(issue("EDGE_GUARD_PREDICATE_INVALID", `edges.${edgeIndex}.guard`, "Edge guards must use registered predicates."));
    const effectClauses = edge.effect?.split(/\s*&&\s*/) ?? [];
    if (edge.effect !== undefined && (!effectClauses.length || effectClauses.some((clause) => {
      const match = clause.match(/^(PRED-[A-Za-z0-9_.-]+)=(.*)$/);
      if (!match) return true;
      const predicate = bundle.predicates.find((candidate) => candidate.pred_id === match[1]);
      return !predicate || !predicate.values.includes(match[2]);
    }))) issues.push(issue("EDGE_EFFECT_PREDICATE_INVALID", `edges.${edgeIndex}.effect`, "Edge effects must assign registered predicate values."));
    if (edge.kind === "normal" && edge.from.split("[")[0] === edge.to.split("[")[0] && edge.effect === undefined && edge.feedback.length === 0) {
      issues.push(issue("FACT_SELF_LOOP_OUTCOME_MISSING", `edges.${edgeIndex}`, "A same-screen journey edge must record an observable effect or feedback outcome."));
    }
    validateEvidence(edge.evidence, `edges.${edgeIndex}.evidence`, bundle.source_snapshot_id, issues);
  });
  const elementById = new Map(bundle.screens.flatMap((screen) => screen.elements.map((element) => [element.id, element] as const)));
  const normalEdgesByTrigger = new Map<string, number[]>();
  bundle.edges.forEach((edge, edgeIndex) => {
    if (edge.kind !== "normal") return;
    normalEdgesByTrigger.set(edge.on, [...(normalEdgesByTrigger.get(edge.on) ?? []), edgeIndex]);
  });
  for (const [elementId, edgeIndexes] of normalEdgesByTrigger) {
    const actionKind = elementById.get(elementId)?.interaction.action_kind ?? "";
    if (asyncActionKind(actionKind) && edgeIndexes.length > 1) {
      issues.push(issue("FACT_ASYNC_TRIGGER_SPLIT", `edges.${edgeIndexes.join(",")}`, "One async user trigger must collapse internal request/loading/polling states into one stable normal outcome edge."));
    }
    if (asyncActionKind(actionKind)) {
      for (const edgeIndex of edgeIndexes) {
        if (requestStartOnlyEffect(bundle.edges[edgeIndex].effect)) issues.push(issue("FACT_ASYNC_TRIGGER_REQUEST_START_ONLY", `edges.${edgeIndex}.effect`, "A normal async edge must record an observable stable success or output, not only request/loading/polling state."));
      }
    }
  }
  bundle.predicates.forEach((predicate, index) => {
    if (predicate.schema_version !== 2 || predicate.project_id !== bundle.project_id || predicate.analysis_run_id !== bundle.analysis_run_id || predicate.source_snapshot_id !== bundle.source_snapshot_id) issues.push(issue("FACT_PREDICATE_IDENTITY_INVALID", `predicates.${index}`, "Predicate identity must match its FACT bundle."));
    validateEvidence(predicate.evidence, `predicates.${index}.evidence`, bundle.source_snapshot_id, issues);
  });
  return { valid: issues.length === 0, issues };
}

export function validateWikiBundle(bundle: WikiBundle, facts: FactBundle): ArtifactValidation {
  const issues: ValidationIssue[] = [];
  if (!bundle || typeof bundle !== "object" || !Array.isArray(bundle.workflows) || bundle.workflows.some((workflow) => !workflow || !Array.isArray(workflow.entry_screens) || !Array.isArray(workflow.failure_terminals) || !Array.isArray(workflow.variation_axes) || !Array.isArray(workflow.depends_on) || !Array.isArray(workflow.cites) || !workflow.combination || typeof workflow.combination.axis_defaults !== "object")) return { valid: false, issues: [issue("WIKI_SCHEMA_INVALID", "$", "WIKI bundle structure is invalid.")] };
  const factIds = new Set([...facts.screens.flatMap((screen) => [screen.screen_id, ...screen.elements.map((element) => element.id), ...screen.apis.map((api) => api.id), ...screen.feedback.map((feedback) => feedback.id), ...screen.displays.map((display) => display.id)]), ...facts.edges.map((edge) => edge.edge_id), ...facts.predicates.map((predicate) => predicate.pred_id)]);
  const outgoing = new Map<string, string[]>();
  for (const edge of facts.edges) {
    const from = edge.from.split("[")[0];
    const to = edge.to.split("[")[0];
    outgoing.set(from, [...(outgoing.get(from) ?? []), to]);
  }
  const reaches = (entries: string[], target: string): boolean => {
    const queue = [...entries];
    const visited = new Set(entries);
    while (queue.length) {
      const screen = queue.shift()!;
      for (const next of outgoing.get(screen) ?? []) {
        if (next === target) return true;
        if (!visited.has(next)) {
          visited.add(next);
          queue.push(next);
        }
      }
    }
    return false;
  };
  if (!identityValid(bundle) || bundle.schema_version !== 2 || bundle.project_id !== facts.project_id || bundle.analysis_run_id !== facts.analysis_run_id || bundle.source_snapshot_id !== facts.source_snapshot_id) issues.push(issue("WIKI_SCHEMA_INVALID", "$", "WIKI bundle identity or version is invalid."));
  const workflowIds = new Set(bundle.workflows.map((workflow) => workflow.workflow));
  bundle.workflows.forEach((workflow, index) => {
    if (workflow.schema_version !== 2 || workflow.project_id !== bundle.project_id || workflow.analysis_run_id !== bundle.analysis_run_id || workflow.source_snapshot_id !== bundle.source_snapshot_id) issues.push(issue("WORKFLOW_IDENTITY_INVALID", `workflows.${index}`, "Workflow identity must match its WIKI bundle."));
    if (!workflow.entry_screens.length || !workflow.success_terminal.trim()) issues.push(issue("WORKFLOW_TERMINAL_INVALID", `workflows.${index}`, "Entry and success terminal are required."));
    if (workflow.entry_screens.some((id) => !factIds.has(id))) issues.push(issue("WORKFLOW_ENTRY_SCREEN_INVALID", `workflows.${index}.entry_screens`, "Entry screens must exist in FACT."));
    const terminalScreen = workflow.success_terminal.match(/^at\((SCR-[^)]+)\)$/)?.[1];
    if (terminalScreen && (!factIds.has(terminalScreen) || !reaches(workflow.entry_screens, terminalScreen))) issues.push(issue("WORKFLOW_TERMINAL_UNREACHABLE", `workflows.${index}.success_terminal`, "Screen terminals must be reachable from an entry screen through one or more FACT edges."));
    if (workflow.cites.some((id) => !factIds.has(id))) issues.push(issue("WORKFLOW_CITE_INVALID", `workflows.${index}.cites`, "Workflow cites must exist in FACT."));
    if (workflow.depends_on.some((id) => !workflowIds.has(id))) issues.push(issue("WORKFLOW_DEPENDENCY_INVALID", `workflows.${index}.depends_on`, "Workflow dependencies must exist in this WIKI bundle."));
  });
  const uncoveredEdges = uncoveredWorkflowEdgeIds(facts, bundle);
  if (uncoveredEdges.length) issues.push(issue("WIKI_EDGE_COVERAGE_INCOMPLETE", "workflows", `Every verified FACT edge must belong to a reachable workflow path. Uncovered: ${uncoveredEdges.slice(0, 20).join(",")}`));
  return { valid: issues.length === 0, issues };
}

export function validateWikiReadiness(bundle: WikiBundle, facts: FactBundle): ArtifactValidation {
  const validation = validateWikiBundle(bundle, facts);
  const issues = [...validation.issues];
  const unresolvedFacts = [
    ...facts.screens.filter((screen) => screen.status === "failed" || screen.status === "unresolved").map((screen) => screen.screen_id),
    ...facts.edges.filter((edge) => edge.status === "failed" || edge.status === "unresolved").map((edge) => edge.edge_id),
  ];
  if (unresolvedFacts.length) issues.push(issue("WIKI_SOURCE_GAPS_UNRESOLVED", "facts", `Source-backed FACT gaps remain: ${unresolvedFacts.slice(0, 20).join(",")}`));
  const unverified = bundle.workflows.filter((workflow) => workflow.status !== "verified").map((workflow) => workflow.workflow);
  if (unverified.length) issues.push(issue("WIKI_WORKFLOW_NOT_VERIFIED", "workflows", `Every workflow must be semantically reviewed before scenario generation: ${unverified.slice(0, 20).join(",")}`));
  const normalWorkflows = new Set(compileScenarioSet(facts, bundle).scenarios
    .filter((scenario) => scenario.kind === "normal")
    .map((scenario) => scenario.workflow));
  bundle.workflows.forEach((workflow, index) => {
    if (!normalWorkflows.has(workflow.workflow)) {
      issues.push(issue("WIKI_SUCCESS_PATH_MISSING", `workflows.${index}`, `Workflow ${workflow.workflow} requires its own source-backed normal path before scenario generation.`));
    }
  });
  return { valid: issues.length === 0, issues };
}

export function validateScenarioSet(set: ScenarioSet, facts: FactBundle, wiki: WikiBundle, expectedDraft?: ScenarioSet): ArtifactValidation {
  const issues: ValidationIssue[] = [];
  if (!set || typeof set !== "object" || !Array.isArray(set.scenarios) || set.scenarios.some((scenario) => !scenario || !Array.isArray(scenario.path) || !Array.isArray(scenario.steps) || !Array.isArray(scenario.preconditions) || scenario.preconditions.some((precondition) => !precondition || !Array.isArray(precondition.predicate_refs) || !Array.isArray(precondition.data_binding_keys)) || !scenario.variation || typeof scenario.variation !== "object" || scenario.steps.some((step) => !step || !step.action_ref || !Array.isArray(step.assertion_refs)))) return { valid: false, issues: [issue("SCENARIO_SCHEMA_INVALID", "$", "Scenario set structure is invalid.")] };
  const edges = new Map(facts.edges.map((edge) => [edge.edge_id, edge]));
  const elements = new Set(facts.screens.flatMap((screen) => screen.elements.map((element) => element.id)));
  const assertions = new Set(facts.screens.flatMap((screen) => [...screen.feedback.map((item) => item.id), ...screen.displays.map((item) => item.id), screen.screen_id]));
  const predicateIds = new Set(facts.predicates.map((predicate) => predicate.pred_id));
  const workflows = new Set(wiki.workflows.map((workflow) => workflow.workflow));
  if (!identityValid(set) || set.schema_version !== 2 || set.project_id !== facts.project_id || set.analysis_run_id !== facts.analysis_run_id || set.source_snapshot_id !== facts.source_snapshot_id) issues.push(issue("SCENARIO_SCHEMA_INVALID", "$", "Scenario set identity or version is invalid."));
  const ids = new Set<string>();
  set.scenarios.forEach((scenario, index) => {
    if (scenario.schema_version !== 2 || scenario.project_id !== set.project_id || scenario.analysis_run_id !== set.analysis_run_id || scenario.source_snapshot_id !== set.source_snapshot_id) issues.push(issue("SCENARIO_IDENTITY_INVALID", `scenarios.${index}`, "Scenario identity must match its set."));
    if (ids.has(scenario.scenario_id)) issues.push(issue("DUPLICATE_SCENARIO_ID", `scenarios.${index}.scenario_id`, "Scenario IDs must be unique."));
    ids.add(scenario.scenario_id);
    if (!workflows.has(scenario.workflow)) issues.push(issue("SCENARIO_WORKFLOW_REF_INVALID", `scenarios.${index}.workflow`, "Scenario workflow is missing."));
    if (scenario.path.some((id) => !edges.has(id))) issues.push(issue("SCENARIO_PATH_INVALID", `scenarios.${index}.path`, "Scenario path edge is missing."));
    if (scenario.preconditions.some((precondition) => !precondition.text.trim() || !Array.isArray(precondition.predicate_refs) || !Array.isArray(precondition.data_binding_keys) || precondition.predicate_refs.some((id) => !predicateIds.has(id)))) issues.push(issue("SCENARIO_PRECONDITION_INVALID", `scenarios.${index}.preconditions`, "Preconditions must reference registered predicates."));
    if (scenario.steps.length !== scenario.path.length || scenario.kind !== (scenario.path.some((id) => edges.get(id)?.kind === "exception") ? "exception" : "normal")) issues.push(issue("SCENARIO_PATH_STEP_MISMATCH", `scenarios.${index}`, "Path, kind, and step count must match the deterministic walk."));
    scenario.steps.forEach((step, stepIndex) => {
      const edge = edges.get(step.action_ref.edge);
      if (step.n !== stepIndex + 1 || step.action_ref.edge !== scenario.path[stepIndex] || !edge || edge.on !== step.action_ref.element || !elements.has(step.action_ref.element)) issues.push(issue("SCENARIO_ACTION_REF_INVALID", `scenarios.${index}.steps.${stepIndex}`, "Step order or action reference is invalid."));
      if (step.assertion_refs.some((id) => !assertions.has(id))) issues.push(issue("SCENARIO_ASSERTION_REF_INVALID", `scenarios.${index}.steps.${stepIndex}.assertion_refs`, "Assertion reference is missing."));
    });
  });
  if (expectedDraft) {
    const immutable = (scenario: ScenarioSet["scenarios"][number]) => ({
      scenario_id: scenario.scenario_id,
      workflow: scenario.workflow,
      kind: scenario.kind,
      variation: scenario.variation,
      preconditions: scenario.preconditions.map((precondition) => ({
        predicate_refs: precondition.predicate_refs,
        data_binding_keys: precondition.data_binding_keys,
      })),
      path: scenario.path,
      steps: scenario.steps.map((step) => ({ n: step.n, action_ref: step.action_ref, assertion_refs: step.assertion_refs })),
    });
    const actual = [...set.scenarios].sort((left, right) => left.scenario_id.localeCompare(right.scenario_id)).map(immutable);
    const expected = [...expectedDraft.scenarios].sort((left, right) => left.scenario_id.localeCompare(right.scenario_id)).map(immutable);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) issues.push(issue("SCENARIO_DETERMINISTIC_FIELDS_CHANGED", "$", "The author may change narration only; deterministic scenario fields are immutable."));
  }
  const coverage = calculateCoverage(facts, set);
  if (coverage.uncovered_edge_ids.length) issues.push(issue("SCENARIO_EDGE_COVERAGE_INCOMPLETE", "scenarios", `Every verified FACT edge must be covered by a scenario. Uncovered: ${coverage.uncovered_edge_ids.slice(0, 20).join(",")}`));
  return { valid: issues.length === 0, issues };
}
