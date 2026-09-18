export type CommonRecordIdentity = {
  project_id: string;
  analysis_run_id: string;
  source_snapshot_id: string;
};

export type GenerationPlanStep = {
  step: import("./state.js").GenerationStep;
  role: "deterministic" | "author";
  input_artifact_types: import("./artifacts.js").GenerationArtifactType[];
  output_artifact_type: import("./artifacts.js").GenerationArtifactType;
  objective: string;
  entry_checks: string[];
  execution_actions: string[];
  completion_checks: string[];
  correction_mode: "none" | "targeted-patch";
  context_strategy: "none" | "isolated-session" | "step-role-lane";
};

export type GenerationPlan = CommonRecordIdentity & {
  schema_version: 1;
  objective: string;
  steps: GenerationPlanStep[];
};

export type EvidenceReference = {
  source_id: string;
  source_snapshot_id: string;
  path: string;
  start_line: number;
  end_line: number;
  content_hash: string;
  evidence_grant_id: string;
};

export type SourceFileRecord = {
  source_id: string;
  path: string;
  language: string;
  content_hash: string;
  size_bytes: number;
  imports: string[];
};

export type SourceRouteRecord = { screen_id: string; route: string; source_id: string; line: number };
export type SourceApiRecord = { api_id: string; screen_id?: string; method: string; path: string; source_id: string; line: number };
export type SourceShellRecord = {
  shell_screen_id: string;
  contained_screen_ids: string[];
  source_id: string;
  line: number;
};
export type SourceInteractionRecord = {
  element_id: string;
  screen_id?: string;
  kind: string;
  label?: string;
  source_id: string;
  line: number;
  target_candidates: Array<{ by: string; value?: string; role?: string; name?: string }>;
};

export type SourceCodeReference = {
  source_id: string;
  source_snapshot_id: string;
  path: string;
  line: number;
  content_hash: string;
};

export type SourceBehaviorFeasibility = "verified" | "inferred" | "unresolved";
export type SourceViewStateFacet = "screen" | "tab" | "modal" | "selection" | "loading" | "error" | "state";

export type SourceBehaviorBranchRecord = {
  branch_ref: string;
  outcome: "normal" | "exception";
  guard_keys: string[];
  response_status?: number;
  business_outcome?: string;
  feasibility: SourceBehaviorFeasibility;
  source_refs: SourceCodeReference[];
};

export type SourceApiConnectionRecord = {
  api_symbol: string;
  method: string;
  path: string;
  source_refs: SourceCodeReference[];
  backend?: {
    route_method: string;
    route_path: string;
    handler_symbol: string;
    service_symbols: string[];
    auth_guards: string[];
    success_statuses: number[];
    failure_statuses: number[];
    source_refs: SourceCodeReference[];
  };
  feasibility: SourceBehaviorFeasibility;
};

/**
 * Backend-derived, source-backed behavior handed from SRC to FACT/edge linking.
 * New fields are optional only so previously registered v1 snapshots remain readable;
 * a new scan writes the complete structured form and snapshot validation enforces it.
 */
export type SourceBehaviorRecord = {
  element_id: string;
  screen_id?: string;
  source_id: string;
  path: string;
  line: number;
  handler_lines: number[];
  called_symbols: string[];
  local_state_keys: string[];
  downstream_consumed_state_keys: string[];
  literal_navigation_targets: string[];
  stable_outcomes?: string[];
  explicit_failure: boolean;
  local_view_only: boolean;
  journey_required: boolean;
  entry_guards?: string[];
  persona_guards?: string[];
  view_state?: {
    screen_id?: string;
    states: Array<{ key: string; facet: SourceViewStateFacet }>;
  };
  api_connections?: SourceApiConnectionRecord[];
  response_consumer?: {
    state_keys: string[];
    next_view_states: string[];
    source_refs: SourceCodeReference[];
  };
  feasibility?: SourceBehaviorFeasibility;
  branches?: SourceBehaviorBranchRecord[];
  source_refs?: SourceCodeReference[];
  unresolved?: string[];
};

export type SourceSnapshot = CommonRecordIdentity & {
  schema_version: 1;
  created_at: string;
  root_hash: string;
  ui_stacks: string[];
  unsupported_ui_stacks: string[];
  files: SourceFileRecord[];
  routes: SourceRouteRecord[];
  apis: SourceApiRecord[];
  interactions: SourceInteractionRecord[];
  shells?: SourceShellRecord[];
  source_behaviors?: SourceBehaviorRecord[];
  i18n: Record<string, string>;
};

export type FactElement = {
  id: string;
  type: string;
  label: string;
  interaction: { action_kind: string; surface_kind: "web" | "desktop" | "mobile" | "unknown"; target_candidates: SourceInteractionRecord["target_candidates"] };
  evidence: EvidenceReference[];
};
export type FactScreen = CommonRecordIdentity & {
  schema_version: 3;
  screen_id: string;
  route?: string;
  title: string;
  shell_screen_id?: string;
  entry_guards: string[];
  elements: FactElement[];
  apis: Array<{ id: string; reads: string[]; writes: string[]; evidence: EvidenceReference[] }>;
  feedback: Array<{ id: string; kind: string; text: string; assertion: { kind: string; expected_shape: string }; evidence: EvidenceReference[] }>;
  displays: Array<{ id: string; shape: string; assertion: { kind: string; expected_shape: string }; evidence: EvidenceReference[] }>;
  status: "draft" | "verified" | "failed" | "unresolved";
};
export type FactEdge = CommonRecordIdentity & {
  schema_version: 2;
  edge_id: string;
  source_branch_ref?: string;
  kind: "normal" | "exception";
  from: string;
  on: string;
  guard?: string;
  effect?: string;
  to: string;
  feedback: string[];
  evidence: EvidenceReference[];
  status: "draft" | "verified" | "failed" | "unresolved";
};
export type FactPredicate = CommonRecordIdentity & { schema_version: 2; pred_id: string; values: string[]; source: "code" | "db" | "assumed"; evidence: EvidenceReference[] };
export type FactBundle = CommonRecordIdentity & { schema_version: 2; screens: FactScreen[]; edges: FactEdge[]; predicates: FactPredicate[] };

export type FactCatalog = CommonRecordIdentity & {
  schema_version: 1;
  screens: FactScreen[];
  predicates: FactPredicate[];
};

export type EdgeAuditRow = {
  edge_id: string;
  journey_action_ref: string;
  normal_outcome: boolean;
  exception_outcome: boolean;
  guard_status: "present" | "not-required";
  effect_status: "present" | "not-required";
  evidence_status: "present" | "missing";
};

export type EdgeLedger = CommonRecordIdentity & {
  schema_version: 1;
  edges: FactEdge[];
  audit: EdgeAuditRow[];
};

export type WikiWorkflow = CommonRecordIdentity & {
  schema_version: 2;
  workflow: string;
  goal: string;
  entry_screens: string[];
  success_terminal: string;
  failure_terminals: string[];
  variation_axes: string[];
  combination: { strategy: "base-choice" | "pairwise"; axis_defaults: Record<string, string> };
  depends_on: string[];
  cites: string[];
  status: "draft" | "verified" | "failed" | "unresolved";
};
export type WikiBundle = CommonRecordIdentity & { schema_version: 2; workflows: WikiWorkflow[] };

export type BusinessClassification = {
  classification_id: string;
  label: string;
  workflow_refs: string[];
  edge_refs: string[];
};
export type BusinessCatalog = CommonRecordIdentity & { schema_version: 1; classifications: BusinessClassification[] };

export type ScenarioRecord = CommonRecordIdentity & {
  schema_version: 2;
  scenario_id: string;
  workflow: string;
  kind: "normal" | "exception";
  variation: Record<string, string>;
  preconditions: Array<{ text: string; predicate_refs: string[]; data_binding_keys: string[] }>;
  path: string[];
  steps: Array<{ n: number; action: string; action_ref: { edge: string; element: string }; expected: string; assertion_refs: string[] }>;
  status: "draft" | "verified" | "failed" | "unresolved";
};
export type ScenarioSet = CommonRecordIdentity & { schema_version: 2; scenarios: ScenarioRecord[] };
export type ScenarioSkeleton = CommonRecordIdentity & { schema_version: 1; scenarios: ScenarioRecord[]; classification_by_scenario: Record<string, string> };

export type CoverageManifest = CommonRecordIdentity & {
  schema_version: 1;
  coverage: { total_edges: number; covered_edges: number; uncovered_edge_ids: string[]; coverage_percent: number; assumed_predicates: string[] };
  artifact_ids: string[];
};
