import { containsPotentialSecret } from "../packages/scenario-pipeline/src/security/secret-classifier.ts";
import { Type } from "@earendil-works/pi-ai";

const MAX_ARTIFACT_BYTES = 512_000;
const MAX_COLLECTION_ITEMS = 100;
const MAX_TEXT_LENGTH = 2_000;
const forbiddenArtifactTextPattern = /```|You are the (?:source-survey|source-gap-review|business-classification|user-journeys|scenario-cases) stage|Complete only 0[1-5]-(?:source-survey|source-gap-review|business-classification|user-journeys|scenario-cases)|Mandatory tool sequence|staging\.writeJson|analysis\.writeArtifact|artifact\.closure/i;

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : undefined;
}

function exactObject(value, requiredKeys, optionalKeys = []) {
  const item = record(value);
  if (!item) return false;
  const allowed = new Set([...requiredKeys, ...optionalKeys]);
  return requiredKeys.every((key) => Object.hasOwn(item, key))
    && Object.keys(item).every((key) => allowed.has(key));
}

function safeText(value, { allowEmpty = false } = {}) {
  return typeof value === "string"
    && value.length <= MAX_TEXT_LENGTH
    && (allowEmpty || value.trim().length > 0)
    && !/[\r\n\0]/.test(value)
    && !containsPotentialSecret(value)
    && !forbiddenArtifactTextPattern.test(value);
}

function stringArray(value, { allowEmpty = true } = {}) {
  return Array.isArray(value)
    && value.length <= MAX_COLLECTION_ITEMS
    && (allowEmpty || value.length > 0)
    && value.every((entry) => safeText(entry));
}

function collection(value) {
  return Array.isArray(value) && value.length <= MAX_COLLECTION_ITEMS;
}

export function sourceSurveyValueSchema(snapshotId, permittedSourceRefs = []) {
  const text = Type.String({ minLength: 1, maxLength: 2_000 });
  const textArray = Type.Array(text, { maxItems: 100 });
  const evidenceRefs = Type.Array(text, { minItems: 1, maxItems: 100 });
  const sourceRef = permittedSourceRefs.length
    ? Type.Union([...new Set(permittedSourceRefs)].sort().map((reference) => Type.Literal(reference)))
    : text;
  return Type.Object({
    schema_version: Type.Literal(1),
    stage: Type.Literal("source-survey"),
    source_snapshot_ref: Type.Literal(snapshotId),
    source_areas: Type.Array(Type.Object({
      area_key: Type.String({ pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$" }),
      label: text,
      purpose: text,
      user_visible_surfaces: textArray,
      entry_points: textArray,
      actions: textArray,
      observable_outcomes: textArray,
      business_outputs: textArray,
      recovery_paths: textArray,
      exit_paths: textArray,
      evidence_refs: evidenceRefs,
    }, { additionalProperties: false }), { minItems: 1, maxItems: 100 }),
    journey_threads: Type.Array(Type.Object({
      name: text,
      starts_at: text,
      ordered_milestones: Type.Array(text, { minItems: 1, maxItems: 100 }),
      furthest_business_outcome: text,
      exit_or_handoff: text,
      evidence_refs: evidenceRefs,
    }, { additionalProperties: false }), { minItems: 1, maxItems: 100 }),
    supporting_systems: Type.Array(Type.Object({
      name: text,
      role: text,
      evidence_refs: evidenceRefs,
    }, { additionalProperties: false }), { maxItems: 100 }),
    source_gaps: Type.Array(Type.Object({
      question: text,
      reason: text,
      affected_sections: Type.Array(text, { minItems: 1, maxItems: 100 }),
      source_refs_to_revisit: Type.Array(sourceRef, { minItems: 1, maxItems: 100 }),
    }, { additionalProperties: false }), { maxItems: 100 }),
    excluded_as_internal: Type.Array(Type.Object({
      description: text,
      reason: text,
      evidence_refs: evidenceRefs,
    }, { additionalProperties: false }), { maxItems: 100 }),
  }, { additionalProperties: false });
}

function collectStringValues(value, key, result = []) {
  if (Array.isArray(value)) {
    for (const entry of value) collectStringValues(entry, key, result);
    return result;
  }
  const item = record(value);
  if (!item) return result;
  for (const [name, entry] of Object.entries(item)) {
    if (name === key && Array.isArray(entry)) result.push(...entry);
    else collectStringValues(entry, key, result);
  }
  return result;
}

function validSourceArea(value) {
  const keys = ["area_key", "label", "purpose", "user_visible_surfaces", "entry_points", "actions", "observable_outcomes", "business_outputs", "recovery_paths", "exit_paths", "evidence_refs"];
  const item = record(value);
  return exactObject(value, keys)
    && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.area_key)
    && safeText(item.area_key)
    && safeText(item.label)
    && safeText(item.purpose)
    && ["user_visible_surfaces", "entry_points", "actions", "observable_outcomes", "business_outputs", "recovery_paths", "exit_paths"].every((key) => stringArray(item[key]))
    && stringArray(item.evidence_refs, { allowEmpty: false });
}

function validJourneyThread(value) {
  const keys = ["name", "starts_at", "ordered_milestones", "furthest_business_outcome", "exit_or_handoff", "evidence_refs"];
  const item = record(value);
  return exactObject(value, keys)
    && safeText(item.name)
    && safeText(item.starts_at)
    && stringArray(item.ordered_milestones, { allowEmpty: false })
    && safeText(item.furthest_business_outcome)
    && safeText(item.exit_or_handoff)
    && stringArray(item.evidence_refs, { allowEmpty: false });
}

function validSupportingSystem(value) {
  const item = record(value);
  return exactObject(value, ["name", "role", "evidence_refs"])
    && safeText(item.name)
    && safeText(item.role)
    && stringArray(item.evidence_refs, { allowEmpty: false });
}

function validSourceGap(value) {
  const item = record(value);
  return exactObject(value, ["question", "reason", "affected_sections", "source_refs_to_revisit"])
    && safeText(item.question)
    && safeText(item.reason)
    && stringArray(item.affected_sections, { allowEmpty: false })
    && item.affected_sections.every((section) => section === "source_areas"
      || section === "journey_threads"
      || section.startsWith("source_areas:")
      || section.startsWith("journey_threads:"))
    && stringArray(item.source_refs_to_revisit, { allowEmpty: false });
}

function validInternalExclusion(value) {
  const item = record(value);
  return exactObject(value, ["description", "reason", "evidence_refs"])
    && safeText(item.description)
    && safeText(item.reason)
    && stringArray(item.evidence_refs, { allowEmpty: false });
}

export function isSourceSurveyPathAllowed(path) {
  if (typeof path !== "string" || !path || path.startsWith("/") || path.includes("\\") || path.includes("\0")) return false;
  const segments = path.split("/");
  if (segments.some((segment) => !segment || segment === ".." || segment.startsWith("."))) return false;
  const lowered = segments.map((segment) => segment.toLowerCase());
  const excludedSegments = new Set(["test", "tests", "__tests__", "fixture", "fixtures", "docs", "documentation", "examples", "coverage", "storage", "logs"]);
  if (lowered.some((segment) => excludedSegments.has(segment))) return false;
  const name = lowered.at(-1);
  return !/(?:^test[_-]|[_-]test\.|\.(?:test|spec)\.|golden|mock(?:[-_.]|$)|generated[-_.]?scenario)/.test(name);
}

export function allowedSourceRefs(snapshot) {
  return new Set(snapshot.files.filter((file) => isSourceSurveyPathAllowed(file.path)).map((file) => file.source_id));
}

export function buildPermittedSourceSnapshot(snapshot, permittedRefs = allowedSourceRefs(snapshot)) {
  const allowed = (sourceId) => permittedRefs.has(sourceId);
  return {
    ...snapshot,
    files: snapshot.files.filter((file) => allowed(file.source_id)),
    routes: snapshot.routes.filter((route) => allowed(route.source_id)),
    apis: snapshot.apis.filter((api) => allowed(api.source_id)),
    interactions: snapshot.interactions.filter((interaction) => allowed(interaction.source_id)),
  };
}

export function effectiveClosureBudget(sourceBytesByRef, requestedRefs, requestedBudget, maxBudget = 120_000) {
  const requiredBytes = [...new Set(requestedRefs)].reduce((total, sourceRef) => total + (sourceBytesByRef.get(sourceRef) ?? 0), 0);
  if (requiredBytes > maxBudget) throw new Error("SOURCE_EVIDENCE_BUDGET_EXCEEDED");
  return Math.min(maxBudget, Math.max(Math.floor(requestedBudget), requiredBytes));
}

export function buildSourceInventoryView(snapshot, allowedRefs = allowedSourceRefs(snapshot)) {
  const allowed = (sourceId) => allowedRefs.has(sourceId);
  return {
    schema_version: 1,
    project_id: snapshot.project_id,
    analysis_run_id: snapshot.analysis_run_id,
    source_snapshot_id: snapshot.source_snapshot_id,
    source_root_hash: snapshot.root_hash,
    ui_stacks: snapshot.ui_stacks,
    unsupported_ui_stacks: snapshot.unsupported_ui_stacks,
    files: snapshot.files.filter((file) => allowed(file.source_id)).map((file) => ({
      source_ref: file.source_id,
      path: file.path,
      language: file.language,
      size_bytes: file.size_bytes,
      imports: file.imports,
    })),
    routes: snapshot.routes.filter((route) => allowed(route.source_id)).map((route) => ({
      route: route.route,
      source_ref: route.source_id,
      line: route.line,
    })),
    apis: snapshot.apis.filter((api) => allowed(api.source_id)).map((api) => ({
      method: api.method,
      path: api.path,
      source_ref: api.source_id,
      line: api.line,
    })),
    interactions: snapshot.interactions.filter((interaction) => allowed(interaction.source_id)).map((interaction) => ({
      kind: interaction.kind,
      label: interaction.label,
      source_ref: interaction.source_id,
      line: interaction.line,
    })),
  };
}

export function validateModelInventory(inventory) {
  let serialized;
  try {
    serialized = JSON.stringify(inventory);
  } catch {
    return ["SOURCE_INVENTORY_INVALID"];
  }
  if (Buffer.byteLength(serialized) > 2_000_000 || containsPotentialSecret(serialized)) return ["SOURCE_INVENTORY_SENSITIVE_OR_OVERSIZED"];
  return [];
}

export function validateSourceSurvey(value, snapshot, grantedEvidenceRefs, permittedSourceRefs) {
  const survey = record(value);
  if (!survey) return ["SOURCE_SURVEY_ARTIFACT_INVALID"];
  const issues = [];
  let serialized;
  try {
    serialized = JSON.stringify(survey);
  } catch {
    return ["SOURCE_SURVEY_ARTIFACT_INVALID"];
  }
  const topLevelKeys = ["schema_version", "stage", "source_snapshot_ref", "source_areas", "journey_threads", "supporting_systems", "source_gaps", "excluded_as_internal"];
  let malformed = !exactObject(survey, topLevelKeys)
    || survey.schema_version !== 1
    || survey.stage !== "source-survey"
    || !safeText(survey.source_snapshot_ref)
    || Buffer.byteLength(serialized) > MAX_ARTIFACT_BYTES
    || containsPotentialSecret(serialized)
    || forbiddenArtifactTextPattern.test(serialized);

  if (survey.source_snapshot_ref !== snapshot.source_snapshot_id) issues.push("SOURCE_SURVEY_SNAPSHOT_MISMATCH");
  const validators = {
    source_areas: validSourceArea,
    journey_threads: validJourneyThread,
    supporting_systems: validSupportingSystem,
    source_gaps: validSourceGap,
    excluded_as_internal: validInternalExclusion,
  };
  for (const [field, validator] of Object.entries(validators)) {
    if (!collection(survey[field])) {
      issues.push(`SOURCE_SURVEY_COLLECTION_MISSING:${field}`);
      malformed = true;
    } else if (!survey[field].every(validator)) {
      malformed = true;
    }
  }
  if (Array.isArray(survey.source_areas) && survey.source_areas.length === 0) issues.push("SOURCE_SURVEY_AREAS_EMPTY");
  if (Array.isArray(survey.journey_threads) && survey.journey_threads.length === 0) issues.push("SOURCE_SURVEY_THREADS_EMPTY");
  if (Array.isArray(survey.source_areas) && new Set(survey.source_areas.map((entry) => record(entry)?.area_key)).size !== survey.source_areas.length) malformed = true;
  if (Array.isArray(survey.journey_threads) && new Set(survey.journey_threads.map((entry) => record(entry)?.name)).size !== survey.journey_threads.length) malformed = true;

  if (Array.isArray(survey.source_gaps)) {
    const areaKeys = new Set((Array.isArray(survey.source_areas) ? survey.source_areas : []).map((area) => record(area)?.area_key));
    const threadNames = new Set((Array.isArray(survey.journey_threads) ? survey.journey_threads : []).map((thread) => record(thread)?.name));
    for (const gap of survey.source_gaps) {
      for (const section of Array.isArray(record(gap)?.affected_sections) ? gap.affected_sections : []) {
        if ((section.startsWith("source_areas:") && !areaKeys.has(section.slice("source_areas:".length)))
          || (section.startsWith("journey_threads:") && !threadNames.has(section.slice("journey_threads:".length)))) {
          issues.push(`SOURCE_SURVEY_GAP_SECTION_INVALID:${section}`);
        }
      }
    }
  }

  for (const evidenceRef of collectStringValues(survey, "evidence_refs")) {
    if (!grantedEvidenceRefs.has(evidenceRef)) issues.push(`SOURCE_SURVEY_EVIDENCE_REF_INVALID:${evidenceRef}`);
  }
  const sourceRefs = permittedSourceRefs ?? new Set(snapshot.files.map((file) => file.source_id));
  for (const sourceRef of collectStringValues(survey, "source_refs_to_revisit")) {
    if (!sourceRefs.has(sourceRef)) issues.push(`SOURCE_SURVEY_SOURCE_REF_INVALID:${sourceRef}`);
  }
  if (malformed) issues.unshift("SOURCE_SURVEY_ARTIFACT_INVALID");
  return [...new Set(issues)];
}

export function hydrateSourceSurvey(survey, evidenceByRef) {
  const citedRefs = [...new Set(collectStringValues(survey, "evidence_refs"))];
  return {
    survey,
    evidence_catalog: citedRefs
      .filter((evidenceRef) => evidenceByRef.has(evidenceRef))
      .map((evidenceRef) => ({ evidence_ref: evidenceRef, evidence: evidenceByRef.get(evidenceRef) })),
  };
}

export function auditSourceSurveyInventoryCoverage(sourceArtifact, inventory) {
  const artifact = record(sourceArtifact);
  const sourceSurvey = record(artifact?.survey);
  const sourceInventory = record(inventory);
  if (!sourceSurvey || !sourceInventory || !Array.isArray(artifact?.evidence_catalog)) {
    throw new Error("SOURCE_SURVEY_INVENTORY_AUDIT_INVALID");
  }
  const citedEvidenceRefs = new Set(collectStringValues(sourceSurvey, "evidence_refs"));
  const ranges = artifact.evidence_catalog.flatMap((entry) => {
    const item = record(entry);
    const evidence = record(item?.evidence);
    if (!citedEvidenceRefs.has(item?.evidence_ref)
      || !safeText(evidence?.source_id)
      || !Number.isInteger(evidence?.start_line)
      || !Number.isInteger(evidence?.end_line)) return [];
    return [{ source_ref: evidence.source_id, start_line: evidence.start_line, end_line: evidence.end_line }];
  });
  const records = [
    ...((Array.isArray(sourceInventory.routes) ? sourceInventory.routes : []).map((entry) => ({ kind: "route", entry }))),
    ...((Array.isArray(sourceInventory.apis) ? sourceInventory.apis : []).map((entry) => ({ kind: "api", entry }))),
    ...((Array.isArray(sourceInventory.interactions) ? sourceInventory.interactions : []).map((entry) => ({ kind: "interaction", entry }))),
  ].flatMap(({ kind, entry }) => {
    const item = record(entry);
    return safeText(item?.source_ref) && Number.isInteger(item?.line) && item.line > 0
      ? [{ kind, source_ref: item.source_ref, line: item.line }]
      : [];
  });
  const missingRecords = records.filter((entry) => !ranges.some((range) =>
    range.source_ref === entry.source_ref && range.start_line <= entry.line && range.end_line >= entry.line));
  const coveredRecords = records.length - missingRecords.length;
  return {
    total_records: records.length,
    covered_records: coveredRecords,
    missing_records: missingRecords,
    coverage_percent: records.length ? Math.round((coveredRecords / records.length) * 10_000) / 100 : 100,
  };
}

export function buildSourceSurveyInventoryGapSupplement(report, { runId, snapshotId, reviewedArtifactHash }) {
  const audit = record(report);
  if (!audit || !safeText(runId) || !safeText(snapshotId) || !safeText(reviewedArtifactHash) || !Array.isArray(audit.missing_records)) {
    throw new Error("SOURCE_SURVEY_INVENTORY_GAP_SUPPLEMENT_INVALID");
  }
  const grouped = new Map();
  for (const value of audit.missing_records) {
    const item = record(value);
    if (!safeText(item?.kind) || !safeText(item?.source_ref) || !Number.isInteger(item?.line) || item.line < 1) {
      throw new Error("SOURCE_SURVEY_INVENTORY_GAP_SUPPLEMENT_INVALID");
    }
    const current = grouped.get(item.source_ref) ?? { kinds: new Set(), lines: [] };
    current.kinds.add(item.kind);
    current.lines.push(item.line);
    grouped.set(item.source_ref, current);
  }
  const gaps = [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([sourceRef, details], index) => ({
      gap_id: `GAP-INVENTORY-${String(index + 1).padStart(4, "0")}`,
      kind: "deterministic-inventory-not-grounded",
      affected_sections: ["source_areas"],
      required_change: `Revisit the omitted ${[...details.kinds].sort().join("|")} inventory records at lines ${[...new Set(details.lines)].sort((left, right) => left - right).join("|")} and add one source-backed area when they expose a user-facing capability; otherwise leave the gap unresolved.`,
      source_refs_to_revisit: [sourceRef],
    }));
  return {
    schema_version: 1,
    run_id: runId,
    artifact_type: "source-survey-inventory-gap-supplement",
    source_snapshot_ref: snapshotId,
    reviewed_artifact: {
      artifact_id: "01-source-survey",
      content_hash: reviewedArtifactHash,
      status: "locally-validated-unregistered-probe",
    },
    golden_derived: false,
    gaps,
  };
}

export function buildSourceSurveySemanticGapDocument(survey, { runId, snapshotId, reviewedArtifactHash }) {
  const sourceSurvey = record(survey);
  const sourceGaps = Array.isArray(sourceSurvey?.source_gaps) ? sourceSurvey.source_gaps : undefined;
  if (!sourceGaps || !safeText(runId) || !safeText(snapshotId) || !safeText(reviewedArtifactHash)
    || sourceGaps.some((gap) => !validSourceGap(gap))) {
    throw new Error("SOURCE_SURVEY_SEMANTIC_GAP_DOCUMENT_INVALID");
  }
  const gaps = sourceGaps.map((gap, index) => ({
    gap_id: `GAP-SOURCE-${String(index + 1).padStart(4, "0")}`,
    kind: "source-survey-unresolved",
    affected_sections: [...gap.affected_sections],
    required_change: gap.question,
    source_refs_to_revisit: [...gap.source_refs_to_revisit],
  }));
  return {
    schema_version: 1,
    run_id: runId,
    artifact_type: "orchestrator-source-gaps",
    source_snapshot_ref: snapshotId,
    reviewed_artifact: {
      artifact_id: "01-source-survey",
      content_hash: reviewedArtifactHash,
      status: "locally-validated-unregistered-probe",
    },
    decision: gaps.length ? "semantic-correction-required" : "no-semantic-correction-required",
    golden_derived: false,
    preserve: ["Preserve every source area and journey thread outside the approved affected_sections."],
    gaps,
  };
}

export function mergeSourceSurveyInventoryGaps(gapDocument, supplement) {
  const gaps = record(gapDocument);
  const inventoryGaps = record(supplement);
  const reviewed = record(gaps?.reviewed_artifact);
  const supplementReviewed = record(inventoryGaps?.reviewed_artifact);
  if (!gaps || !inventoryGaps
    || inventoryGaps.schema_version !== 1
    || inventoryGaps.run_id !== gaps.run_id
    || inventoryGaps.artifact_type !== "source-survey-inventory-gap-supplement"
    || inventoryGaps.source_snapshot_ref !== gaps.source_snapshot_ref
    || inventoryGaps.golden_derived !== false
    || !Array.isArray(inventoryGaps.gaps)
    || supplementReviewed?.artifact_id !== reviewed?.artifact_id
    || supplementReviewed?.content_hash !== reviewed?.content_hash
    || supplementReviewed?.status !== reviewed?.status) {
    throw new Error("SOURCE_SURVEY_INVENTORY_GAP_SUPPLEMENT_INVALID");
  }
  const existingIds = new Set((Array.isArray(gaps.gaps) ? gaps.gaps : []).map((gap) => record(gap)?.gap_id));
  if (inventoryGaps.gaps.some((gap) => existingIds.has(record(gap)?.gap_id))) throw new Error("SOURCE_SURVEY_INVENTORY_GAP_DUPLICATE");
  const mergedGaps = [...structuredClone(gaps.gaps), ...structuredClone(inventoryGaps.gaps)];
  return {
    ...structuredClone(gaps),
    decision: mergedGaps.length ? "semantic-correction-required" : "no-semantic-correction-required",
    gaps: mergedGaps,
  };
}

export function validateSourceTransitionObligationInventory(value, { snapshotId, permittedSourceRefs, sourceInteractions }) {
  const inventory = record(value);
  const issues = [];
  const obligations = Array.isArray(inventory?.obligations) ? inventory.obligations : [];
  const unresolved = Array.isArray(inventory?.unresolved_interactions) ? inventory.unresolved_interactions : [];
  const validTopLevel = exactObject(inventory, ["schema_version", "artifact_type", "source_snapshot_ref", "branch_inventory_status", "obligations", "unresolved_interactions"])
    && inventory.schema_version === 1
    && inventory.artifact_type === "source-transition-obligations"
    && inventory.source_snapshot_ref === snapshotId
    && ["lower-bound", "complete"].includes(inventory.branch_inventory_status)
    && collection(obligations)
    && collection(unresolved);
  if (!validTopLevel) issues.push("SOURCE_TRANSITION_OBLIGATION_INVENTORY_INVALID");
  const validObligation = (value) => {
    const item = record(value);
    return exactObject(item, ["transition_ref", "source_action_ref", "branch_ref", "scope", "outcome", "feasibility", "source_ref", "line"])
      && /^T\d{3,}$/.test(item?.transition_ref)
      && safeText(item?.source_action_ref)
      && safeText(item?.branch_ref)
      && ["journey", "view"].includes(item?.scope)
      && ["normal", "exception"].includes(item?.outcome)
      && ["source-supported", "runtime-unverified"].includes(item?.feasibility)
      && safeText(item?.source_ref)
      && Number.isInteger(item?.line)
      && item.line > 0;
  };
  const validUnresolved = (value) => {
    const item = record(value);
    return exactObject(item, ["source_action_ref", "source_ref", "line", "kind"])
      && safeText(item?.source_action_ref)
      && safeText(item?.source_ref)
      && Number.isInteger(item?.line)
      && item.line > 0
      && safeText(item?.kind);
  };
  if (!obligations.every(validObligation) || !unresolved.every(validUnresolved)) issues.push("SOURCE_TRANSITION_OBLIGATION_ENTRY_INVALID");
  const transitionRefs = obligations.map((entry) => record(entry)?.transition_ref);
  const branchKeys = obligations.map((entry) => {
    const item = record(entry);
    return `${item?.source_action_ref}:${item?.outcome}:${item?.branch_ref}`;
  });
  if (new Set(transitionRefs).size !== transitionRefs.length || new Set(branchKeys).size !== branchKeys.length) {
    issues.push("SOURCE_TRANSITION_OBLIGATION_DUPLICATE");
  }
  for (const sourceRef of [...obligations, ...unresolved].map((entry) => record(entry)?.source_ref)) {
    if (!permittedSourceRefs.has(sourceRef)) issues.push(`SOURCE_TRANSITION_OBLIGATION_SOURCE_REF_INVALID:${sourceRef}`);
  }
  if (Array.isArray(sourceInteractions)) {
    const interactionByAction = new Map(sourceInteractions.map((interaction) => [record(interaction)?.element_id, record(interaction)]));
    const obligationActions = new Set(obligations.map((entry) => record(entry)?.source_action_ref));
    const unresolvedActions = new Set(unresolved.map((entry) => record(entry)?.source_action_ref));
    for (const entry of [...obligations, ...unresolved]) {
      const item = record(entry);
      const interaction = interactionByAction.get(item?.source_action_ref);
      if (!interaction || interaction.source_id !== item?.source_ref || interaction.line !== item?.line) {
        issues.push(`SOURCE_TRANSITION_OBLIGATION_SOURCE_BINDING_INVALID:${item?.source_action_ref}`);
      }
    }
    for (const sourceActionRef of obligationActions) {
      if (unresolvedActions.has(sourceActionRef)) issues.push(`SOURCE_TRANSITION_OBLIGATION_INTERACTION_STATUS_CONFLICT:${sourceActionRef}`);
    }
    for (const sourceActionRef of interactionByAction.keys()) {
      if (!obligationActions.has(sourceActionRef) && !unresolvedActions.has(sourceActionRef)) {
        issues.push(`SOURCE_TRANSITION_OBLIGATION_INTERACTION_MISSING:${sourceActionRef}`);
      }
    }
  }
  return [...new Set(issues)];
}

export function factGraphPermittedSourceRefs(transitionInventory) {
  const obligations = Array.isArray(record(transitionInventory)?.obligations) ? transitionInventory.obligations : [];
  return new Set(obligations
    .map((entry) => record(entry)?.source_ref)
    .filter((sourceRef) => typeof sourceRef === "string"));
}

export function validateFactGraphInputs({ runId, classificationArtifactHash, classificationArtifact, classificationValidation, inventory, transitionInventory }) {
  const classification = record(classificationArtifact);
  const provenance = record(classification?.provenance);
  const validation = record(classificationValidation);
  const sourceInventory = record(inventory);
  const transitions = record(transitionInventory);
  const inventoryFiles = Array.isArray(sourceInventory?.files) ? sourceInventory.files : [];
  const inventoryRefs = new Set(inventoryFiles.map((file) => record(file)?.source_ref).filter((sourceRef) => typeof sourceRef === "string"));
  const issues = [];
  const identityValid = classification?.schema_version === 1
    && classification?.run_id === runId
    && classification?.artifact_status === "locally-validated-unregistered-probe"
    && record(classification?.classification)
    && provenance?.project_id === sourceInventory?.project_id
    && provenance?.source_snapshot_id === sourceInventory?.source_snapshot_id
    && provenance?.source_root_hash === sourceInventory?.source_root_hash
    && sourceInventory?.schema_version === 1
    && sourceInventory?.analysis_run_id === runId
    && transitions?.schema_version === 1
    && transitions?.artifact_type === "source-transition-obligations";
  if (!identityValid || validation?.pass !== true || validation?.product_stage_acceptance !== "not-attempted") {
    issues.push("FACT_GRAPH_INPUT_INVALID");
  }
  if (validation?.artifact_hash !== classificationArtifactHash) issues.push("FACT_GRAPH_INPUT_HASH_MISMATCH");
  if (transitions?.source_snapshot_ref !== sourceInventory?.source_snapshot_id) issues.push("FACT_GRAPH_INPUT_SNAPSHOT_MISMATCH");
  const permittedRefs = factGraphPermittedSourceRefs(transitionInventory);
  if (!permittedRefs.size) issues.push("FACT_GRAPH_INPUT_JOURNEY_SOURCE_EMPTY");
  for (const sourceRef of permittedRefs) {
    if (!inventoryRefs.has(sourceRef)) issues.push(`FACT_GRAPH_INPUT_SOURCE_REF_INVALID:${sourceRef}`);
  }
  return [...new Set(issues)];
}

export function buildSourceTransitionObligationView(inventory, sourceArtifact) {
  const artifact = record(sourceArtifact);
  const survey = record(artifact?.survey);
  const evidenceByRef = new Map((Array.isArray(artifact?.evidence_catalog) ? artifact.evidence_catalog : [])
    .map((entry) => [record(entry)?.evidence_ref, record(record(entry)?.evidence)]));
  const sourceAreas = Array.isArray(survey?.source_areas) ? survey.source_areas : [];
  const sourceAreaRefsFor = (sourceRef, line) => sourceAreas.flatMap((area) => {
    const item = record(area);
    const supportsLine = (Array.isArray(item?.evidence_refs) ? item.evidence_refs : []).some((evidenceRef) => {
      const evidence = evidenceByRef.get(evidenceRef);
      return evidence?.source_id === sourceRef
        && Number.isInteger(evidence?.start_line)
        && Number.isInteger(evidence?.end_line)
        && evidence.start_line <= line
        && evidence.end_line >= line;
    });
    return supportsLine && safeText(item?.area_key) ? [item.area_key] : [];
  }).sort();
  return {
    branch_inventory_status: inventory.branch_inventory_status,
    obligations: inventory.obligations.map((entry) => ({
      transition_ref: entry.transition_ref,
      scope: entry.scope,
      outcome: entry.outcome,
      feasibility: entry.feasibility,
      source_area_refs: sourceAreaRefsFor(entry.source_ref, entry.line),
      source_refs_to_revisit: [entry.source_ref],
    })),
    unresolved_interactions: inventory.unresolved_interactions.map((entry) => ({
      source_ref: entry.source_ref,
      source_area_refs: sourceAreaRefsFor(entry.source_ref, entry.line),
    })),
  };
}

function allStrings(value, result = []) {
  if (typeof value === "string") result.push(value);
  else if (Array.isArray(value)) value.forEach((entry) => allStrings(entry, result));
  else if (record(value)) Object.values(value).forEach((entry) => allStrings(entry, result));
  return result;
}

function copiesSubstantialSource(value, sourceContents) {
  const artifactStrings = allStrings(value).map((entry) => entry.replace(/\s+/g, " ").trim()).filter((entry) => entry.length >= 80);
  if (!artifactStrings.length) return false;
  const sourceLines = sourceContents.flatMap((content) => content.split(/\r?\n/)).map((line) => line.replace(/\s+/g, " ").trim()).filter((line) => line.length >= 80);
  return artifactStrings.some((entry) => sourceLines.some((line) => entry.includes(line) || line.includes(entry)));
}

export function createSourceSurveyStageGuard(sourceBytesByRef, options = {}) {
  const maxClosureCalls = options.maxClosureCalls ?? 12;
  const maxGrantedBytes = options.maxGrantedBytes ?? 600_000;
  let inventoryReads = 0;
  let closureCalls = 0;
  let cumulativeGrantedBytes = 0;
  let artifactWriteAttempts = 0;
  let fatalError;

  const reject = (code) => {
    fatalError ??= code;
    throw new Error(code);
  };

  return {
    fail(code) {
      fatalError ??= code;
    },
    recordInventoryRead() {
      if (fatalError) throw new Error(fatalError);
      inventoryReads += 1;
    },
    beginClosure(sourceRefs) {
      if (fatalError) throw new Error(fatalError);
      if (inventoryReads === 0) return reject("SOURCE_INVENTORY_NOT_READ");
      const uniqueRefs = [...new Set(sourceRefs)];
      if (!uniqueRefs.length || uniqueRefs.some((sourceRef) => !sourceBytesByRef.has(sourceRef))) return reject("AGENTIC_SOURCE_SCOPE_VIOLATION");
      const requestedBytes = uniqueRefs.reduce((total, sourceRef) => total + sourceBytesByRef.get(sourceRef), 0);
      if (closureCalls + 1 > maxClosureCalls || cumulativeGrantedBytes + requestedBytes > maxGrantedBytes) return reject("AGENTIC_SURVEY_BUDGET_EXCEEDED");
      closureCalls += 1;
      cumulativeGrantedBytes += requestedBytes;
    },
    beginArtifactWrite() {
      if (fatalError) throw new Error(fatalError);
      if (inventoryReads === 0 || closureCalls === 0) throw new Error("AGENTIC_SOURCE_TOOLS_NOT_USED");
      artifactWriteAttempts += 1;
      if (artifactWriteAttempts > 1) throw new Error("AGENTIC_ARTIFACT_WRITE_DUPLICATE");
    },
    summary() {
      return {
        inventory_reads: inventoryReads,
        closure_calls: closureCalls,
        cumulative_granted_bytes: cumulativeGrantedBytes,
        artifact_write_attempts: artifactWriteAttempts,
        fatal_error: fatalError ?? null,
        max_closure_calls: maxClosureCalls,
        max_granted_bytes: maxGrantedBytes,
      };
    },
  };
}

export function createValidatedSourceSurveyWriter({ guard, snapshot, grantedEvidenceRefs, permittedSourceRefs, grantedSourceContents = () => [], onRejected = () => undefined, write }) {
  return async (value) => {
    guard.beginArtifactWrite();
    const issues = validateSourceSurvey(value, snapshot, grantedEvidenceRefs(), permittedSourceRefs);
    if (!issues.length && copiesSubstantialSource(value, grantedSourceContents())) issues.push("SOURCE_SURVEY_RAW_SOURCE_COPIED");
    if (issues.length) {
      guard.fail(issues[0]);
      onRejected(issues);
      throw new Error(issues[0]);
    }
    return write(value);
  };
}

export function gapReviewPermittedSourceRefs(gapDocument) {
  const gaps = collection(record(gapDocument)?.gaps) ? gapDocument.gaps : [];
  return new Set(gaps.flatMap((gap) => stringArray(record(gap)?.source_refs_to_revisit, { allowEmpty: false }) ? gap.source_refs_to_revisit : []));
}

const sourceGapReviewInputArtifactIds = new Set(["01-source-survey", "orchestrator-gaps", "source-inventory"]);

export function classifySourceGapReviewArtifactRequest(id, permittedSourceRefs) {
  if (sourceGapReviewInputArtifactIds.has(id)) return { kind: "input", id };
  if (permittedSourceRefs.has(id)) return { kind: "source-metadata", id };
  return null;
}

export function validateSourceGapReviewInputs({ runId, priorArtifactHash, priorArtifact, gapDocument, inventory }) {
  const prior = record(priorArtifact);
  const provenance = record(prior?.provenance);
  const priorSurvey = record(prior?.survey);
  const gaps = record(gapDocument);
  const reviewedArtifact = record(gaps?.reviewed_artifact);
  const sourceInventory = record(inventory);
  const issues = [];
  const gapEntries = collection(gaps?.gaps) ? gaps.gaps : [];
  const inventoryFiles = Array.isArray(sourceInventory?.files) ? sourceInventory.files : [];
  const inventoryRefs = new Set(inventoryFiles.map((file) => record(file)?.source_ref).filter((sourceRef) => typeof sourceRef === "string"));

  const validPrior = prior?.schema_version === 1
    && prior?.run_id === runId
    && prior?.artifact_status === "locally-validated-unregistered-probe"
    && provenance?.project_id === sourceInventory?.project_id
    && provenance?.source_snapshot_id === sourceInventory?.source_snapshot_id
    && provenance?.source_root_hash === sourceInventory?.source_root_hash
    && priorSurvey?.source_snapshot_ref === sourceInventory?.source_snapshot_id;
  const validGapDocument = gaps?.schema_version === 1
    && gaps?.run_id === runId
    && gaps?.artifact_type === "orchestrator-source-gaps"
    && gaps?.source_snapshot_ref === sourceInventory?.source_snapshot_id
    && reviewedArtifact?.artifact_id === "01-source-survey"
    && reviewedArtifact?.status === "locally-validated-unregistered-probe"
    && ((gaps?.decision === "semantic-correction-required" && gapEntries.length > 0)
      || (gaps?.decision === "no-semantic-correction-required" && gapEntries.length === 0))
    && gaps?.golden_derived === false
    && stringArray(gaps?.preserve)
    && new Set(gapEntries.map((gap) => record(gap)?.gap_id)).size === gapEntries.length
    && gapEntries.every((gap) => {
      const item = record(gap);
      return exactObject(item, ["gap_id", "kind", "affected_sections", "required_change", "source_refs_to_revisit"])
        && safeText(item.gap_id)
        && safeText(item.kind)
        && stringArray(item.affected_sections, { allowEmpty: false })
        && safeText(item.required_change)
        && stringArray(item.source_refs_to_revisit, { allowEmpty: false });
    });
  const validInventory = sourceInventory?.schema_version === 1
    && sourceInventory?.analysis_run_id === runId
    && safeText(sourceInventory?.project_id)
    && safeText(sourceInventory?.source_snapshot_id)
    && safeText(sourceInventory?.source_root_hash)
    && inventoryFiles.length > 0;

  if (!validPrior || !validGapDocument || !validInventory) issues.push("SOURCE_GAP_REVIEW_INPUT_INVALID");
  if (reviewedArtifact?.content_hash !== priorArtifactHash) issues.push("SOURCE_GAP_REVIEW_INPUT_HASH_MISMATCH");
  for (const sourceRef of gapReviewPermittedSourceRefs(gapDocument)) {
    if (!inventoryRefs.has(sourceRef)) issues.push(`SOURCE_GAP_REVIEW_INPUT_SOURCE_REF_INVALID:${sourceRef}`);
  }
  return [...new Set(issues)];
}

export function createSourceGapReviewStageGuard(gapDocument, sourceBytesByRef, options = {}) {
  const maxClosureCalls = options.maxClosureCalls ?? 8;
  const maxGrantedBytes = options.maxGrantedBytes ?? 400_000;
  const permittedSourceRefs = gapReviewPermittedSourceRefs(gapDocument);
  const gapsById = new Map((collection(record(gapDocument)?.gaps) ? gapDocument.gaps : []).map((gap) => [gap.gap_id, gap]));
  const requiredArtifactIds = sourceGapReviewInputArtifactIds;
  const artifactReads = new Set();
  const sourceReads = new Set();
  let closureCalls = 0;
  let cumulativeGrantedBytes = 0;
  let artifactWriteAttempts = 0;
  let fatalError;

  const reject = (code) => {
    fatalError ??= code;
    throw new Error(code);
  };

  return {
    fail(code) {
      fatalError ??= code;
    },
    recordArtifactRead(artifactId) {
      if (fatalError) throw new Error(fatalError);
      if (!requiredArtifactIds.has(artifactId)) return reject("AGENTIC_ARTIFACT_NOT_FOUND");
      artifactReads.add(artifactId);
    },
    beginClosure(sourceRefs) {
      if (fatalError) throw new Error(fatalError);
      if (![...requiredArtifactIds].every((artifactId) => artifactReads.has(artifactId))) return reject("SOURCE_GAP_REVIEW_INPUTS_NOT_READ");
      const uniqueRefs = [...new Set(sourceRefs)];
      if (!uniqueRefs.length || uniqueRefs.some((sourceRef) => !permittedSourceRefs.has(sourceRef) || !sourceBytesByRef.has(sourceRef))) return reject("AGENTIC_SOURCE_SCOPE_VIOLATION");
      const requestedBytes = uniqueRefs.reduce((total, sourceRef) => total + sourceBytesByRef.get(sourceRef), 0);
      if (closureCalls + 1 > maxClosureCalls || cumulativeGrantedBytes + requestedBytes > maxGrantedBytes) return reject("AGENTIC_SURVEY_BUDGET_EXCEEDED");
      closureCalls += 1;
      cumulativeGrantedBytes += requestedBytes;
      uniqueRefs.forEach((sourceRef) => sourceReads.add(sourceRef));
    },
    beginArtifactWrite(resolvedGapIds) {
      if (artifactWriteAttempts > 0) throw new Error("AGENTIC_ARTIFACT_WRITE_DUPLICATE");
      if (fatalError) throw new Error(fatalError);
      if (![...requiredArtifactIds].every((artifactId) => artifactReads.has(artifactId)) || closureCalls === 0) throw new Error("AGENTIC_SOURCE_TOOLS_NOT_USED");
      for (const gapId of resolvedGapIds) {
        const gap = gapsById.get(gapId);
        if (gap?.source_refs_to_revisit.some((sourceRef) => !sourceReads.has(sourceRef))) throw new Error("SOURCE_GAP_REVIEW_REQUIRED_SOURCE_NOT_READ");
      }
      artifactWriteAttempts += 1;
    },
    summary() {
      return {
        artifact_reads: [...artifactReads],
        source_refs_read: [...sourceReads],
        closure_calls: closureCalls,
        cumulative_granted_bytes: cumulativeGrantedBytes,
        artifact_write_attempts: artifactWriteAttempts,
        fatal_error: fatalError ?? null,
        max_closure_calls: maxClosureCalls,
        max_granted_bytes: maxGrantedBytes,
      };
    },
  };
}

function gapReviewMutationScopeIssues(item, priorSurvey, gapDocument) {
  const issues = [];
  const previousAreas = new Set(priorSurvey.source_areas.map((area) => area.area_key));
  const previousThreads = new Set(priorSurvey.journey_threads.map((thread) => thread.name));
  const areaUpserts = collection(item.source_area_upserts) ? item.source_area_upserts : [];
  const threadUpserts = collection(item.journey_thread_upserts) ? item.journey_thread_upserts : [];
  const areaKeys = areaUpserts.map((area) => record(area)?.area_key);
  const threadNames = threadUpserts.map((thread) => record(thread)?.name);
  const resolvedIds = new Set(collection(item.resolved_gap_ids) ? item.resolved_gap_ids : []);
  const resolvedGaps = gapDocument.gaps.filter((gap) => resolvedIds.has(gap.gap_id));
  const affectedSections = resolvedGaps.flatMap((gap) => gap.affected_sections);
  const namedAreas = new Set(affectedSections.filter((section) => section.startsWith("source_areas:")).map((section) => section.slice("source_areas:".length)));
  const namedThreads = new Set(affectedSections.filter((section) => section.startsWith("journey_threads:")).map((section) => section.slice("journey_threads:".length)));
  const mayAddArea = affectedSections.includes("source_areas");
  const mayAddThread = affectedSections.includes("journey_threads");

  if (new Set(areaKeys).size !== areaKeys.length || areaKeys.some((areaKey) => previousAreas.has(areaKey) ? !namedAreas.has(areaKey) : !mayAddArea)) issues.push("SOURCE_GAP_REVIEW_AREA_SCOPE_INVALID");
  if (new Set(threadNames).size !== threadNames.length || threadNames.some((threadName) => previousThreads.has(threadName) ? !namedThreads.has(threadName) : !mayAddThread)) issues.push("SOURCE_GAP_REVIEW_THREAD_SCOPE_INVALID");

  for (const gap of resolvedGaps) {
    const missing = gap.affected_sections.some((section) => {
      if (section === "source_areas") return !areaKeys.some((areaKey) => !previousAreas.has(areaKey));
      if (section.startsWith("source_areas:")) return !areaKeys.includes(section.slice("source_areas:".length));
      if (section === "journey_threads") return !threadNames.some((threadName) => !previousThreads.has(threadName));
      if (section.startsWith("journey_threads:")) return !threadNames.includes(section.slice("journey_threads:".length));
      return true;
    });
    if (missing) issues.push(`SOURCE_GAP_REVIEW_REQUIRED_SECTION_MISSING:${gap.gap_id}`);
  }

  const nestedEvidenceRefs = [...new Set([...areaUpserts, ...threadUpserts].flatMap((entry) => entry.evidence_refs ?? []))];
  const declaredEvidenceRefs = collection(item.evidence_refs) ? [...new Set(item.evidence_refs)] : [];
  if (nestedEvidenceRefs.length !== declaredEvidenceRefs.length || nestedEvidenceRefs.some((reference) => !declaredEvidenceRefs.includes(reference))) issues.push("SOURCE_GAP_REVIEW_EVIDENCE_SUMMARY_MISMATCH");
  return issues;
}

export function validateSourceGapReviewEnvelope(value, { runId, workId, snapshotId, rootHash, priorArtifactId, priorArtifactHash, permittedSourceRefs, acceptedEvidenceRefs, gapIds, priorSurvey, gapDocument, grantedSourceContents = [] }) {
  const item = record(value); const issues = [];
  const keys = ["schema_version","stage","run_id","work_id","source_snapshot_ref","source_root_hash","extends_artifact_id","extends_artifact_hash","source_area_upserts","journey_thread_upserts","resolved_gap_ids","additional_source_gaps","evidence_refs"];
  if (!exactObject(item, keys) || item.schema_version !== 1 || item.stage !== "source-gap-review") issues.push("SOURCE_GAP_REVIEW_ARTIFACT_INVALID");
  if (item?.run_id !== runId || item?.work_id !== workId || item?.source_snapshot_ref !== snapshotId || item?.source_root_hash !== rootHash || item?.extends_artifact_id !== priorArtifactId || item?.extends_artifact_hash !== priorArtifactHash) issues.push("SOURCE_GAP_REVIEW_PROVENANCE_MISMATCH");
  for (const field of ["source_area_upserts","journey_thread_upserts","additional_source_gaps"]) if (!collection(item?.[field])) issues.push(`SOURCE_GAP_REVIEW_COLLECTION_MISSING:${field}`);
  if (!stringArray(item?.resolved_gap_ids) || new Set(item.resolved_gap_ids).size !== item.resolved_gap_ids.length) issues.push("SOURCE_GAP_REVIEW_GAPS_INVALID");
  if (!stringArray(item?.evidence_refs)) issues.push("SOURCE_GAP_REVIEW_EVIDENCE_INVALID");
  if (item?.resolved_gap_ids?.some((id) => !gapIds.has(id))) issues.push("SOURCE_GAP_REVIEW_UNKNOWN_GAP");
  if (item?.source_area_upserts?.some((x) => !validSourceArea(x))) issues.push("SOURCE_GAP_REVIEW_AREA_INVALID");
  if (item?.journey_thread_upserts?.some((x) => !validJourneyThread(x))) issues.push("SOURCE_GAP_REVIEW_THREAD_INVALID");
  if (item?.additional_source_gaps?.some((x) => !validSourceGap(x))) issues.push("SOURCE_GAP_REVIEW_GAP_INVALID");
  for (const ref of collectStringValues(item, "evidence_refs")) if (!acceptedEvidenceRefs.has(ref)) issues.push(`SOURCE_GAP_REVIEW_EVIDENCE_REF_INVALID:${ref}`);
  for (const ref of collectStringValues(item, "source_refs_to_revisit")) if (!permittedSourceRefs.has(ref)) issues.push(`SOURCE_GAP_REVIEW_SOURCE_REF_INVALID:${ref}`);
  let serialized; try { serialized = JSON.stringify(item); } catch { issues.push("SOURCE_GAP_REVIEW_ARTIFACT_INVALID"); }
  if (serialized && (Buffer.byteLength(serialized) > MAX_ARTIFACT_BYTES || containsPotentialSecret(serialized) || forbiddenArtifactTextPattern.test(serialized))) issues.push("SOURCE_GAP_REVIEW_ARTIFACT_INVALID");
  if (priorSurvey && gapDocument && item) issues.push(...gapReviewMutationScopeIssues(item, priorSurvey, gapDocument));
  if (item && copiesSubstantialSource(item, grantedSourceContents)) issues.push("SOURCE_GAP_REVIEW_RAW_SOURCE_COPIED");
  return [...new Set(issues)];
}

export function validateSurveyEvidenceCatalog(survey, evidenceCatalog) {
  if (!Array.isArray(evidenceCatalog)) return ["SOURCE_GAP_REVIEW_EVIDENCE_CATALOG_INVALID"];
  const issues = [];
  const catalogRefs = [];
  for (const entry of evidenceCatalog) {
    const item = record(entry);
    if (!exactObject(item, ["evidence_ref", "evidence"]) || !safeText(item?.evidence_ref) || !record(item?.evidence)) {
      issues.push("SOURCE_GAP_REVIEW_EVIDENCE_CATALOG_INVALID");
      continue;
    }
    catalogRefs.push(item.evidence_ref);
  }
  const citedRefs = [...new Set(collectStringValues(survey, "evidence_refs"))];
  const catalogRefSet = new Set(catalogRefs);
  if (catalogRefSet.size !== catalogRefs.length || citedRefs.some((reference) => !catalogRefSet.has(reference))) {
    issues.push("SOURCE_GAP_REVIEW_EVIDENCE_CATALOG_MISMATCH");
  }
  return [...new Set(issues)];
}

export function applySourceGapReview(survey, correction, gapMap = new Map()) {
  const result = structuredClone(survey);
  const areas = new Map(result.source_areas.map((x) => [x.area_key, x]));
  correction.source_area_upserts.forEach((x) => areas.set(x.area_key, x)); result.source_areas = [...areas.values()];
  const threads = new Map(result.journey_threads.map((x) => [x.name, x]));
  correction.journey_thread_upserts.forEach((x) => threads.set(x.name, x)); result.journey_threads = [...threads.values()];
  const resolvedQuestions = new Set(correction.resolved_gap_ids.map((id) => gapMap.get(id)?.question).filter(Boolean));
  result.source_gaps = result.source_gaps.filter((x) => !resolvedQuestions.has(x.question));
  result.source_gaps.push(...correction.additional_source_gaps);
  return result;
}

const businessClassificationInputArtifactIds = new Set(["02-source-gap-review", "02-source-gap-review-validation", "source-inventory"]);

export const businessClassificationPerspectives = Object.freeze([
  "user-role",
  "authorization-scope",
  "organization-scope",
  "business-capability",
  "business-responsibility",
  "workflow-stage",
  "lifecycle-state",
  "data-domain",
  "channel-surface",
  "input-source",
  "output-deliverable",
  "integration-boundary",
  "risk-recovery",
  "compliance-policy",
]);

const businessClassificationPerspectiveSet = new Set([...businessClassificationPerspectives, "project-specific"]);

function businessClassificationEvidenceSourcesByArea(priorArtifact) {
  const prior = record(priorArtifact);
  const survey = record(prior?.survey);
  const evidenceByRef = new Map((Array.isArray(prior?.evidence_catalog) ? prior.evidence_catalog : []).map((entry) => [record(entry)?.evidence_ref, record(record(entry)?.evidence)?.source_id]));
  return new Map((Array.isArray(survey?.source_areas) ? survey.source_areas : []).map((area) => [
    record(area)?.area_key,
    new Set((Array.isArray(record(area)?.evidence_refs) ? area.evidence_refs : []).map((evidenceRef) => evidenceByRef.get(evidenceRef)).filter((sourceRef) => typeof sourceRef === "string")),
  ]));
}

export function businessClassificationSourceSupport(priorArtifact) {
  return [...businessClassificationEvidenceSourcesByArea(priorArtifact)].map(([sourceAreaRef, sourceRefs]) => ({
    source_area_ref: sourceAreaRef,
    source_refs: [...sourceRefs].sort(),
  }));
}

export function businessClassificationPermittedSourceRefs(priorArtifact) {
  const prior = record(priorArtifact);
  const survey = record(prior?.survey);
  const evidenceRefs = (Array.isArray(prior?.evidence_catalog) ? prior.evidence_catalog : [])
    .map((entry) => record(record(entry)?.evidence)?.source_id)
    .filter((sourceRef) => typeof sourceRef === "string");
  const gapRefs = collectStringValues(Array.isArray(survey?.source_gaps) ? survey.source_gaps : [], "source_refs_to_revisit")
    .filter((sourceRef) => typeof sourceRef === "string");
  return new Set([...evidenceRefs, ...gapRefs]);
}

export function classifyBusinessClassificationArtifactRequest(id, permittedSourceRefs) {
  if (businessClassificationInputArtifactIds.has(id)) return { kind: "input", id };
  if (permittedSourceRefs.has(id)) return { kind: "source-metadata", id };
  return null;
}

export function validateBusinessClassificationInputs({ runId, priorArtifactHash, priorArtifact, priorValidation, inventory }) {
  const prior = record(priorArtifact);
  const validation = record(priorValidation);
  const provenance = record(prior?.provenance);
  const correction = record(prior?.correction);
  const survey = record(prior?.survey);
  const sourceInventory = record(inventory);
  const inventoryFiles = Array.isArray(sourceInventory?.files) ? sourceInventory.files : [];
  const inventoryRefs = new Set(inventoryFiles.map((file) => record(file)?.source_ref).filter((sourceRef) => typeof sourceRef === "string"));
  const issues = [];

  const validPrior = prior?.schema_version === 1
    && prior?.run_id === runId
    && prior?.artifact_status === "locally-validated-unregistered-probe"
    && correction?.stage === "source-gap-review"
    && correction?.run_id === runId
    && provenance?.project_id === sourceInventory?.project_id
    && provenance?.source_snapshot_id === sourceInventory?.source_snapshot_id
    && provenance?.source_root_hash === sourceInventory?.source_root_hash
    && stringArray(provenance?.granted_evidence_refs)
    && stringArray(provenance?.inherited_evidence_refs)
    && survey?.stage === "source-survey"
    && survey?.source_snapshot_ref === sourceInventory?.source_snapshot_id
    && Array.isArray(survey?.source_areas)
    && survey.source_areas.length > 0
    && Array.isArray(survey?.journey_threads)
    && survey.journey_threads.length > 0;
  const validPriorValidation = validation?.pass === true
    && validation?.validation_scope === "local-probe-contract-only"
    && validation?.product_stage_acceptance === "not-attempted"
    && safeText(validation?.artifact_hash);
  const validInventory = sourceInventory?.schema_version === 1
    && sourceInventory?.analysis_run_id === runId
    && safeText(sourceInventory?.project_id)
    && safeText(sourceInventory?.source_snapshot_id)
    && safeText(sourceInventory?.source_root_hash)
    && inventoryFiles.length > 0;

  if (!validPrior || !validPriorValidation || !validInventory) issues.push("BUSINESS_CLASSIFICATION_INPUT_INVALID");
  if (priorArtifactHash !== undefined && priorArtifactHash !== null && !safeText(priorArtifactHash)) issues.push("BUSINESS_CLASSIFICATION_INPUT_INVALID");
  if (validation?.artifact_hash !== priorArtifactHash) issues.push("BUSINESS_CLASSIFICATION_INPUT_HASH_MISMATCH");
  for (const sourceRef of businessClassificationPermittedSourceRefs(priorArtifact)) {
    if (!inventoryRefs.has(sourceRef)) issues.push(`BUSINESS_CLASSIFICATION_INPUT_SOURCE_REF_INVALID:${sourceRef}`);
  }
  return [...new Set(issues)];
}

export function createBusinessClassificationStageGuard(priorArtifact, sourceBytesByRef, options = {}) {
  const maxClosureCalls = options.maxClosureCalls ?? 10;
  const maxGrantedBytes = options.maxGrantedBytes ?? 500_000;
  const permittedSourceRefs = businessClassificationPermittedSourceRefs(priorArtifact);
  const sourcesByArea = businessClassificationEvidenceSourcesByArea(priorArtifact);
  const artifactReads = new Set();
  const sourceReads = new Set();
  let closureCalls = 0;
  let cumulativeGrantedBytes = 0;
  let artifactWriteAttempts = 0;
  let fatalError;

  const reject = (code) => {
    fatalError ??= code;
    throw new Error(code);
  };

  return {
    fail(code) {
      fatalError ??= code;
    },
    recordArtifactRead(artifactId) {
      if (fatalError) throw new Error(fatalError);
      if (!businessClassificationInputArtifactIds.has(artifactId)) return reject("AGENTIC_ARTIFACT_NOT_FOUND");
      artifactReads.add(artifactId);
    },
    beginClosure(sourceRefs) {
      if (fatalError) throw new Error(fatalError);
      if (![...businessClassificationInputArtifactIds].every((artifactId) => artifactReads.has(artifactId))) return reject("BUSINESS_CLASSIFICATION_INPUTS_NOT_READ");
      const uniqueRefs = [...new Set(sourceRefs)];
      if (!uniqueRefs.length || uniqueRefs.some((sourceRef) => !permittedSourceRefs.has(sourceRef) || !sourceBytesByRef.has(sourceRef))) return reject("AGENTIC_SOURCE_SCOPE_VIOLATION");
      const requestedBytes = uniqueRefs.reduce((total, sourceRef) => total + sourceBytesByRef.get(sourceRef), 0);
      if (closureCalls + 1 > maxClosureCalls || cumulativeGrantedBytes + requestedBytes > maxGrantedBytes) return reject("AGENTIC_SURVEY_BUDGET_EXCEEDED");
      closureCalls += 1;
      cumulativeGrantedBytes += requestedBytes;
      uniqueRefs.forEach((sourceRef) => sourceReads.add(sourceRef));
    },
    beginArtifactWrite(classifications) {
      if (artifactWriteAttempts > 0) throw new Error("AGENTIC_ARTIFACT_WRITE_DUPLICATE");
      if (fatalError) throw new Error(fatalError);
      if (![...businessClassificationInputArtifactIds].every((artifactId) => artifactReads.has(artifactId)) || closureCalls === 0) throw new Error("AGENTIC_SOURCE_TOOLS_NOT_USED");
      for (const sourceAreaRef of (Array.isArray(classifications) ? classifications : []).flatMap((entry) => Array.isArray(record(entry)?.source_area_refs) ? entry.source_area_refs : [])) {
        const supportingSources = sourcesByArea.get(sourceAreaRef) ?? new Set();
        if (![...supportingSources].some((sourceRef) => sourceReads.has(sourceRef))) throw new Error(`BUSINESS_CLASSIFICATION_AREA_SOURCE_NOT_READ:${sourceAreaRef}`);
      }
      artifactWriteAttempts += 1;
    },
    summary() {
      return {
        artifact_reads: [...artifactReads],
        source_refs_read: [...sourceReads],
        closure_calls: closureCalls,
        cumulative_granted_bytes: cumulativeGrantedBytes,
        artifact_write_attempts: artifactWriteAttempts,
        fatal_error: fatalError ?? null,
        max_closure_calls: maxClosureCalls,
        max_granted_bytes: maxGrantedBytes,
      };
    },
  };
}

function validBusinessClassification(value) {
  const item = record(value);
  return exactObject(item, ["perspective", "perspective_label", "label", "description", "user_responsibilities", "source_area_refs", "journey_thread_refs", "business_outcomes"])
    && businessClassificationPerspectiveSet.has(item?.perspective)
    && safeText(item?.perspective_label)
    && safeText(item?.label)
    && safeText(item?.description)
    && stringArray(item?.user_responsibilities, { allowEmpty: false })
    && stringArray(item?.source_area_refs, { allowEmpty: false })
    && stringArray(item?.journey_thread_refs, { allowEmpty: false })
    && stringArray(item?.business_outcomes, { allowEmpty: false });
}

function validBusinessClassificationPerspectiveAssessment(value) {
  const item = record(value);
  return exactObject(item, ["perspective", "perspective_label", "decision", "rationale"])
    && businessClassificationPerspectiveSet.has(item?.perspective)
    && safeText(item?.perspective_label)
    && ["classified", "not-evidenced", "not-applicable"].includes(item?.decision)
    && safeText(item?.rationale);
}

function validBusinessClassificationUnresolved(value) {
  const item = record(value);
  return exactObject(item, ["description", "reason", "source_area_refs", "journey_thread_refs", "source_refs_to_revisit"])
    && safeText(item?.description)
    && safeText(item?.reason)
    && stringArray(item?.source_area_refs)
    && stringArray(item?.journey_thread_refs)
    && stringArray(item?.source_refs_to_revisit, { allowEmpty: false });
}

export function validateBusinessClassificationEnvelope(value, { runId, workId, snapshotId, rootHash, priorArtifactId, priorArtifactHash, priorArtifact, permittedSourceRefs, grantedSourceContents = [] }) {
  const item = record(value);
  const issues = [];
  const topLevelKeys = ["schema_version", "stage", "run_id", "work_id", "source_snapshot_ref", "source_root_hash", "extends_artifact_id", "extends_artifact_hash", "perspective_assessments", "classifications", "unresolved"];
  let malformed = !exactObject(item, topLevelKeys) || item?.schema_version !== 1 || item?.stage !== "business-classification";
  if (item?.run_id !== runId || item?.work_id !== workId || item?.source_snapshot_ref !== snapshotId || item?.source_root_hash !== rootHash || item?.extends_artifact_id !== priorArtifactId || item?.extends_artifact_hash !== priorArtifactHash) issues.push("BUSINESS_CLASSIFICATION_PROVENANCE_MISMATCH");
  if (!collection(item?.classifications)) {
    issues.push("BUSINESS_CLASSIFICATION_COLLECTION_MISSING:classifications");
    malformed = true;
  } else if (!item.classifications.every(validBusinessClassification)) {
    issues.push("BUSINESS_CLASSIFICATION_ENTRY_INVALID");
    malformed = true;
  }
  if (!collection(item?.perspective_assessments)) {
    issues.push("BUSINESS_CLASSIFICATION_COLLECTION_MISSING:perspective_assessments");
    malformed = true;
  } else if (!item.perspective_assessments.every(validBusinessClassificationPerspectiveAssessment)) {
    issues.push("BUSINESS_CLASSIFICATION_PERSPECTIVE_ASSESSMENT_INVALID");
    malformed = true;
  }
  if (!collection(item?.unresolved)) {
    issues.push("BUSINESS_CLASSIFICATION_COLLECTION_MISSING:unresolved");
    malformed = true;
  } else if (!item.unresolved.every(validBusinessClassificationUnresolved)) {
    issues.push("BUSINESS_CLASSIFICATION_UNRESOLVED_INVALID");
    malformed = true;
  }
  const classifications = Array.isArray(item?.classifications) ? item.classifications : [];
  const assessments = Array.isArray(item?.perspective_assessments) ? item.perspective_assessments : [];
  const unresolved = Array.isArray(item?.unresolved) ? item.unresolved : [];
  if (classifications.length === 0) issues.push("BUSINESS_CLASSIFICATION_EMPTY");
  const categoryKeys = classifications.map((entry) => [record(entry)?.perspective, record(entry)?.perspective_label, record(entry)?.label].join("\0"));
  if (new Set(categoryKeys).size !== categoryKeys.length) issues.push("BUSINESS_CLASSIFICATION_LABEL_DUPLICATE");
  const assessmentKeys = assessments.map((entry) => [record(entry)?.perspective, record(entry)?.perspective_label].join("\0"));
  if (new Set(assessmentKeys).size !== assessmentKeys.length) issues.push("BUSINESS_CLASSIFICATION_PERSPECTIVE_ASSESSMENT_DUPLICATE");
  for (const perspective of businessClassificationPerspectives) {
    const matching = assessments.filter((assessment) => record(assessment)?.perspective === perspective);
    if (matching.length !== 1) issues.push(`BUSINESS_CLASSIFICATION_PERSPECTIVE_ASSESSMENT_MISSING:${perspective}`);
  }
  for (const assessment of assessments) {
    const keyMatches = classifications.filter((classification) => record(classification)?.perspective === assessment.perspective && record(classification)?.perspective_label === assessment.perspective_label);
    if (assessment.decision === "classified" && keyMatches.length === 0) issues.push(`BUSINESS_CLASSIFICATION_PERSPECTIVE_CLASSIFICATION_MISSING:${assessment.perspective_label}`);
    if (assessment.decision !== "classified" && keyMatches.length > 0) issues.push(`BUSINESS_CLASSIFICATION_PERSPECTIVE_DECISION_CONFLICT:${assessment.perspective_label}`);
  }
  for (const classification of classifications) {
    if (!assessments.some((assessment) => assessment.perspective === classification.perspective && assessment.perspective_label === classification.perspective_label && assessment.decision === "classified")) {
      issues.push(`BUSINESS_CLASSIFICATION_PERSPECTIVE_UNASSESSED:${classification.perspective_label}`);
    }
  }

  const priorSurvey = record(record(priorArtifact)?.survey);
  const validAreaRefs = new Set((Array.isArray(priorSurvey?.source_areas) ? priorSurvey.source_areas : []).map((area) => record(area)?.area_key));
  const validThreadRefs = new Set((Array.isArray(priorSurvey?.journey_threads) ? priorSurvey.journey_threads : []).map((thread) => record(thread)?.name));
  const classifiedAreaRefs = classifications.flatMap((entry) => Array.isArray(record(entry)?.source_area_refs) ? entry.source_area_refs : []);
  const classifiedThreadRefs = classifications.flatMap((entry) => Array.isArray(record(entry)?.journey_thread_refs) ? entry.journey_thread_refs : []);
  for (const sourceAreaRef of classifiedAreaRefs) if (!validAreaRefs.has(sourceAreaRef)) issues.push(`BUSINESS_CLASSIFICATION_SOURCE_AREA_REF_INVALID:${sourceAreaRef}`);
  for (const journeyThreadRef of classifiedThreadRefs) if (!validThreadRefs.has(journeyThreadRef)) issues.push(`BUSINESS_CLASSIFICATION_JOURNEY_REF_INVALID:${journeyThreadRef}`);
  for (const sourceAreaRef of collectStringValues(unresolved, "source_area_refs")) if (!validAreaRefs.has(sourceAreaRef)) issues.push(`BUSINESS_CLASSIFICATION_UNRESOLVED_SOURCE_AREA_REF_INVALID:${sourceAreaRef}`);
  for (const journeyThreadRef of collectStringValues(unresolved, "journey_thread_refs")) if (!validThreadRefs.has(journeyThreadRef)) issues.push(`BUSINESS_CLASSIFICATION_UNRESOLVED_JOURNEY_REF_INVALID:${journeyThreadRef}`);
  for (const sourceAreaRef of validAreaRefs) if (!classifiedAreaRefs.includes(sourceAreaRef)) issues.push(`BUSINESS_CLASSIFICATION_AREA_COVERAGE_MISSING:${sourceAreaRef}`);
  for (const journeyThreadRef of validThreadRefs) if (!classifiedThreadRefs.includes(journeyThreadRef)) issues.push(`BUSINESS_CLASSIFICATION_JOURNEY_COVERAGE_MISSING:${journeyThreadRef}`);
  const primaryClassifications = classifications.filter((entry) => record(entry)?.perspective === "business-capability");
  const invalidPrimaryAssignment = primaryClassifications.some((entry) => !Array.isArray(record(entry)?.source_area_refs) || entry.source_area_refs.length !== 1)
    || [...validAreaRefs].some((sourceAreaRef) => primaryClassifications.filter((entry) => entry.source_area_refs?.[0] === sourceAreaRef).length !== 1);
  if (invalidPrimaryAssignment) issues.push("BUSINESS_CLASSIFICATION_PRIMARY_AREA_ASSIGNMENT_INVALID");

  for (const sourceRef of collectStringValues(unresolved, "source_refs_to_revisit")) if (!permittedSourceRefs.has(sourceRef)) issues.push(`BUSINESS_CLASSIFICATION_SOURCE_REF_INVALID:${sourceRef}`);

  let serialized;
  try {
    serialized = JSON.stringify(item);
  } catch {
    malformed = true;
  }
  if (serialized && (Buffer.byteLength(serialized) > MAX_ARTIFACT_BYTES || containsPotentialSecret(serialized) || forbiddenArtifactTextPattern.test(serialized))) malformed = true;
  if (item && copiesSubstantialSource(item, grantedSourceContents)) issues.push("BUSINESS_CLASSIFICATION_RAW_SOURCE_COPIED");
  if (malformed) issues.unshift("BUSINESS_CLASSIFICATION_ARTIFACT_INVALID");
  return [...new Set(issues)];
}

export function hydrateBusinessClassificationEvidence(classification, priorArtifact, evidenceByRef) {
  const sourcesByArea = businessClassificationEvidenceSourcesByArea(priorArtifact);
  const issues = [];
  const evidenceEntries = [...evidenceByRef.entries()];
  const evidenceBindings = (Array.isArray(record(classification)?.classifications) ? classification.classifications : []).map((entry, classificationPosition) => {
    const sourceAreaRefs = Array.isArray(record(entry)?.source_area_refs) ? entry.source_area_refs : [];
    const supportingSources = new Set(sourceAreaRefs.flatMap((sourceAreaRef) => [...(sourcesByArea.get(sourceAreaRef) ?? new Set())]));
    const evidenceRefs = evidenceEntries.filter(([, evidence]) => supportingSources.has(record(evidence)?.source_id)).map(([evidenceRef]) => evidenceRef);
    for (const sourceAreaRef of sourceAreaRefs) {
      const areaSources = sourcesByArea.get(sourceAreaRef) ?? new Set();
      if (!evidenceEntries.some(([, evidence]) => areaSources.has(record(evidence)?.source_id))) issues.push(`BUSINESS_CLASSIFICATION_AREA_EVIDENCE_MISSING:${sourceAreaRef}`);
    }
    return { classification_position: classificationPosition, source_area_refs: sourceAreaRefs, evidence_refs: evidenceRefs };
  });
  return {
    issues: [...new Set(issues)],
    evidence_bindings: evidenceBindings,
    evidence_catalog: evidenceEntries.map(([evidenceRef, evidence]) => ({ evidence_ref: evidenceRef, evidence })),
  };
}

const userJourneyInputArtifactIds = new Set([
  "02-source-gap-review",
  "02-source-gap-review-validation",
  "03-business-classification",
  "03-business-classification-validation",
  "source-inventory",
]);

function sameStringSet(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right)) return false;
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  return leftSet.size === left.length
    && rightSet.size === right.length
    && leftSet.size === rightSet.size
    && [...leftSet].every((entry) => rightSet.has(entry));
}

export function buildUserJourneyClassificationView(classificationArtifact) {
  const classifications = record(classificationArtifact)?.classification?.classifications;
  return (Array.isArray(classifications) ? classifications : []).map((entry, index) => ({
    classification_ref: `C${String(index + 1).padStart(3, "0")}`,
    perspective: entry.perspective,
    perspective_label: entry.perspective_label,
    label: entry.label,
    description: entry.description,
    user_responsibilities: entry.user_responsibilities,
    source_area_refs: entry.source_area_refs,
    journey_thread_refs: entry.journey_thread_refs,
    business_outcomes: entry.business_outcomes,
  }));
}

export function validateBusinessWorkflowMappingInputs({
  runId,
  classificationArtifactHash,
  classificationArtifact,
  classificationValidation,
  factGraphArtifactHash,
  factGraphArtifact,
  factGraphValidation,
  workflowSkeletonHash,
  workflowSkeleton,
  guardedPathInventoryHash,
  guardedPathInventory,
}) {
  const classification = record(classificationArtifact);
  const classificationCheck = record(classificationValidation);
  const classificationProvenance = record(classification?.provenance);
  const factGraph = record(factGraphArtifact);
  const factGraphCheck = record(factGraphValidation);
  const factGraphProvenance = record(factGraph?.provenance);
  const factArtifacts = record(factGraph?.artifacts);
  const workflowArtifact = record(factArtifacts?.workflow_skeleton);
  const inventoryArtifact = record(factArtifacts?.guarded_path_inventory);
  const skeleton = record(workflowSkeleton);
  const pathInventory = record(guardedPathInventory);
  const issues = [];

  const classificationValid = classification?.schema_version === 1
    && classification?.run_id === runId
    && classification?.artifact_status === "locally-validated-unregistered-probe"
    && record(classification?.classification)
    && safeText(classificationProvenance?.project_id)
    && safeText(classificationProvenance?.source_snapshot_id)
    && safeText(classificationProvenance?.source_root_hash)
    && classificationCheck?.pass === true
    && classificationCheck?.validation_scope === "local-probe-contract-only"
    && classificationCheck?.product_stage_acceptance === "not-attempted";
  const factGraphValid = factGraph?.schema_version === 1
    && factGraph?.run_id === runId
    && factGraph?.artifact_status === "locally-validated-unregistered-probe"
    && factGraphCheck?.pass === true
    && factGraphCheck?.validation_scope === "local-probe-contract-only"
    && factGraphCheck?.product_stage_acceptance === "not-attempted"
    && workflowArtifact
    && inventoryArtifact;
  const skeletonValid = skeleton?.schema_version === 2
    && skeleton?.analysis_run_id === runId
    && Array.isArray(skeleton?.workflows)
    && skeleton.workflows.length > 0;
  const inventoryValid = pathInventory?.schema_version === 1
    && pathInventory?.analysis_run_id === runId
    && Array.isArray(pathInventory?.workflows)
    && Array.isArray(pathInventory?.edges)
    && Array.isArray(pathInventory?.paths);
  if (!classificationValid || !factGraphValid || !skeletonValid || !inventoryValid) issues.push("BUSINESS_WORKFLOW_MAPPING_INPUT_INVALID");
  if (classificationCheck?.artifact_hash !== classificationArtifactHash) issues.push("BUSINESS_WORKFLOW_MAPPING_CLASSIFICATION_HASH_MISMATCH");
  if (factGraphCheck?.artifact_hash !== factGraphArtifactHash) issues.push("BUSINESS_WORKFLOW_MAPPING_FACT_GRAPH_HASH_MISMATCH");
  if (factGraphProvenance?.extends_artifact_hash !== classificationArtifactHash || factGraphCheck?.prior_artifact_hash !== classificationArtifactHash) {
    issues.push("BUSINESS_WORKFLOW_MAPPING_HANDOFF_CHAIN_MISMATCH");
  }
  if (workflowArtifact?.content_hash !== workflowSkeletonHash) issues.push("BUSINESS_WORKFLOW_MAPPING_WORKFLOW_HASH_MISMATCH");
  if (inventoryArtifact?.content_hash !== guardedPathInventoryHash) issues.push("BUSINESS_WORKFLOW_MAPPING_INVENTORY_HASH_MISMATCH");

  const expectedIdentity = [classificationProvenance?.project_id, runId, classificationProvenance?.source_snapshot_id];
  const factIdentity = [factGraphProvenance?.project_id, factGraph?.run_id, factGraphProvenance?.source_snapshot_id];
  const skeletonIdentity = [skeleton?.project_id, skeleton?.analysis_run_id, skeleton?.source_snapshot_id];
  const inventoryIdentity = [pathInventory?.project_id, pathInventory?.analysis_run_id, pathInventory?.source_snapshot_id];
  if (![factIdentity, skeletonIdentity, inventoryIdentity].every((identity) => identity.every((value, index) => value === expectedIdentity[index]))
    || factGraphProvenance?.source_root_hash !== classificationProvenance?.source_root_hash) {
    issues.push("BUSINESS_WORKFLOW_MAPPING_IDENTITY_MISMATCH");
  }

  const skeletonWorkflowRefs = Array.isArray(skeleton?.workflows)
    ? skeleton.workflows.map((workflow) => record(workflow)?.workflow).filter((reference) => typeof reference === "string")
    : [];
  const inventoryWorkflowRefs = Array.isArray(pathInventory?.workflows)
    ? pathInventory.workflows.map((workflow) => record(workflow)?.workflow_ref).filter((reference) => typeof reference === "string")
    : [];
  if (!sameStringSet(skeletonWorkflowRefs, inventoryWorkflowRefs)) issues.push("BUSINESS_WORKFLOW_MAPPING_WORKFLOW_SET_MISMATCH");
  return [...new Set(issues)];
}

export function buildBusinessWorkflowMappingPlan({
  classificationArtifactHash,
  factGraphArtifactHash,
  classificationArtifact,
  workflowSkeleton,
  guardedPathInventory,
}) {
  const classifications = buildUserJourneyClassificationView(classificationArtifact);
  const workflows = Array.isArray(record(workflowSkeleton)?.workflows) ? workflowSkeleton.workflows : [];
  const inventoryEdges = Array.isArray(record(guardedPathInventory)?.edges) ? guardedPathInventory.edges : [];
  const inventoryPaths = Array.isArray(record(guardedPathInventory)?.paths) ? guardedPathInventory.paths : [];
  const edgesByRef = new Map(inventoryEdges.map((edge) => [record(edge)?.edge_ref, edge]));
  const primaryClassificationRefs = classifications
    .filter((entry) => entry.perspective === "business-capability")
    .map((entry) => entry.classification_ref);
  const crossCuttingClassificationRefs = classifications
    .filter((entry) => entry.perspective !== "business-capability")
    .map((entry) => entry.classification_ref);

  return {
    schema_version: 1,
    classification_artifact_hash: classificationArtifactHash,
    fact_graph_artifact_hash: factGraphArtifactHash,
    primary_perspective: "business-capability",
    primary_classification_refs: primaryClassificationRefs,
    cross_cutting_classification_refs: crossCuttingClassificationRefs,
    classification_candidates: classifications,
    workflow_candidates: workflows.map((workflow) => {
      const edgeRefs = Array.isArray(record(workflow)?.cites)
        ? workflow.cites.filter((reference) => typeof reference === "string" && reference.startsWith("E-"))
        : [];
      return {
        workflow_ref: workflow.workflow,
        goal: workflow.goal,
        entry_screen_refs: Array.isArray(workflow.entry_screens) ? [...workflow.entry_screens] : [],
        success_terminal: workflow.success_terminal,
        edge_refs: edgeRefs,
        edges: edgeRefs.map((edgeRef) => edgesByRef.get(edgeRef)).filter(Boolean).map((edge) => ({ ...edge })),
        paths: inventoryPaths
          .filter((path) => record(path)?.workflow_ref === workflow.workflow)
          .map((path) => ({ ...path, edge_refs: Array.isArray(path.edge_refs) ? [...path.edge_refs] : [] })),
      };
    }),
  };
}

export function validateBusinessWorkflowMappingPatch(value, plan) {
  const item = record(value);
  const mappingPlan = record(plan);
  const issues = [];
  const assignments = Array.isArray(item?.assignments) ? item.assignments : [];
  const unresolved = Array.isArray(item?.unresolved) ? item.unresolved : [];
  const workflowCandidates = Array.isArray(mappingPlan?.workflow_candidates) ? mappingPlan.workflow_candidates : [];
  const classificationCandidates = Array.isArray(mappingPlan?.classification_candidates) ? mappingPlan.classification_candidates : [];
  const knownWorkflowRefs = new Set(workflowCandidates.map((workflow) => record(workflow)?.workflow_ref).filter((reference) => typeof reference === "string"));
  const knownClassificationRefs = new Set(classificationCandidates.map((entry) => record(entry)?.classification_ref).filter((reference) => typeof reference === "string"));
  const primaryClassificationRefs = new Set(Array.isArray(mappingPlan?.primary_classification_refs) ? mappingPlan.primary_classification_refs : []);
  const crossCuttingClassificationRefs = new Set(Array.isArray(mappingPlan?.cross_cutting_classification_refs) ? mappingPlan.cross_cutting_classification_refs : []);

  if (!exactObject(item, ["schema_version", "classification_artifact_hash", "fact_graph_artifact_hash", "assignments", "unresolved"])
    || item?.schema_version !== 1
    || !collection(item?.assignments)
    || !collection(item?.unresolved)) {
    issues.push("BUSINESS_WORKFLOW_MAPPING_PATCH_INVALID");
  }
  if (item?.classification_artifact_hash !== mappingPlan?.classification_artifact_hash
    || item?.fact_graph_artifact_hash !== mappingPlan?.fact_graph_artifact_hash) {
    issues.push("BUSINESS_WORKFLOW_MAPPING_PROVENANCE_MISMATCH");
  }

  const assignedWorkflowRefs = [];
  const unresolvedWorkflowRefs = [];
  const usedClassificationRefs = new Set();
  for (const assignment of assignments) {
    const entry = record(assignment);
    const workflowRef = entry?.workflow_ref;
    const primaryRef = entry?.primary_classification_ref;
    const crossRefs = Array.isArray(entry?.cross_cutting_classification_refs) ? entry.cross_cutting_classification_refs : [];
    if (!exactObject(entry, ["workflow_ref", "primary_classification_ref", "cross_cutting_classification_refs"])
      || !safeText(workflowRef)
      || !safeText(primaryRef)
      || !stringArray(entry?.cross_cutting_classification_refs)) {
      issues.push("BUSINESS_WORKFLOW_MAPPING_ASSIGNMENT_INVALID");
      continue;
    }
    if (!knownWorkflowRefs.has(workflowRef)) issues.push(`BUSINESS_WORKFLOW_MAPPING_WORKFLOW_REF_INVALID:${workflowRef}`);
    if (assignedWorkflowRefs.includes(workflowRef)) issues.push(`BUSINESS_WORKFLOW_MAPPING_WORKFLOW_DUPLICATE:${workflowRef}`);
    assignedWorkflowRefs.push(workflowRef);
    if (!primaryClassificationRefs.has(primaryRef)) issues.push(`BUSINESS_WORKFLOW_MAPPING_PRIMARY_REF_INVALID:${workflowRef}:${primaryRef}`);
    else usedClassificationRefs.add(primaryRef);
    if (new Set(crossRefs).size !== crossRefs.length) issues.push(`BUSINESS_WORKFLOW_MAPPING_CROSS_REF_DUPLICATE:${workflowRef}`);
    for (const crossRef of crossRefs) {
      if (!crossCuttingClassificationRefs.has(crossRef)) issues.push(`BUSINESS_WORKFLOW_MAPPING_CROSS_REF_INVALID:${workflowRef}:${crossRef}`);
      else usedClassificationRefs.add(crossRef);
    }
  }

  for (const gap of unresolved) {
    const entry = record(gap);
    const workflowRef = entry?.workflow_ref;
    const classificationRefsToReview = Array.isArray(entry?.classification_refs_to_review) ? entry.classification_refs_to_review : [];
    if (!exactObject(entry, ["workflow_ref", "reason", "classification_refs_to_review"])
      || !safeText(workflowRef)
      || !safeText(entry?.reason)
      || !stringArray(entry?.classification_refs_to_review, { allowEmpty: false })) {
      issues.push("BUSINESS_WORKFLOW_MAPPING_UNRESOLVED_INVALID");
      continue;
    }
    if (!knownWorkflowRefs.has(workflowRef)) issues.push(`BUSINESS_WORKFLOW_MAPPING_UNRESOLVED_WORKFLOW_REF_INVALID:${workflowRef}`);
    if (unresolvedWorkflowRefs.includes(workflowRef)) issues.push(`BUSINESS_WORKFLOW_MAPPING_UNRESOLVED_DUPLICATE:${workflowRef}`);
    if (assignedWorkflowRefs.includes(workflowRef)) issues.push(`BUSINESS_WORKFLOW_MAPPING_STATUS_CONFLICT:${workflowRef}`);
    unresolvedWorkflowRefs.push(workflowRef);
    for (const classificationRef of classificationRefsToReview) {
      if (!knownClassificationRefs.has(classificationRef)) issues.push(`BUSINESS_WORKFLOW_MAPPING_UNRESOLVED_CLASSIFICATION_REF_INVALID:${workflowRef}:${classificationRef}`);
    }
  }

  const accountedWorkflowRefs = new Set([...assignedWorkflowRefs, ...unresolvedWorkflowRefs]);
  const missingWorkflowRefs = [...knownWorkflowRefs].filter((reference) => !accountedWorkflowRefs.has(reference)).sort();
  if (missingWorkflowRefs.length) issues.push(`BUSINESS_WORKFLOW_MAPPING_INCOMPLETE:${missingWorkflowRefs.join(",")}`);
  const knownUnresolvedWorkflowRefs = [...new Set(unresolvedWorkflowRefs.filter((reference) => knownWorkflowRefs.has(reference)))].sort();
  if (knownUnresolvedWorkflowRefs.length) issues.push(`BUSINESS_WORKFLOW_MAPPING_UNRESOLVED:${knownUnresolvedWorkflowRefs.join(",")}`);
  const unusedClassificationRefs = [...knownClassificationRefs].filter((reference) => !usedClassificationRefs.has(reference)).sort();
  if (unusedClassificationRefs.length) issues.push(`BUSINESS_WORKFLOW_MAPPING_CLASSIFICATION_UNUSED:${unusedClassificationRefs.join(",")}`);
  return [...new Set(issues)];
}

export function compileBusinessCatalogPatchFromWorkflowMapping(mappingPatch, plan) {
  const issues = validateBusinessWorkflowMappingPatch(mappingPatch, plan);
  if (issues.length) throw new Error(issues[0]);
  const classificationsByRef = new Map(plan.classification_candidates.map((entry) => [entry.classification_ref, entry]));
  return {
    schema_version: 1,
    classifications: plan.primary_classification_refs.map((classificationRef) => ({
      label: classificationsByRef.get(classificationRef).label,
      workflow_refs: mappingPatch.assignments
        .filter((assignment) => assignment.primary_classification_ref === classificationRef)
        .map((assignment) => assignment.workflow_ref)
        .sort(),
    })),
  };
}

export function buildUserJourneyWorkflowLinkPlan({
  journeyArtifactHash,
  factGraphArtifactHash,
  businessWorkflowMappingArtifactHash,
  journeyArtifact,
  classificationArtifact,
  workflowSkeleton,
  guardedPathInventory,
  workflowClassificationMapping,
}) {
  const workflowScopingPerspectives = new Set([
    "authorization-scope",
    "organization-scope",
    "business-responsibility",
    "workflow-stage",
    "lifecycle-state",
    "data-domain",
    "input-source",
    "output-deliverable",
    "integration-boundary",
    "risk-recovery",
    "compliance-policy",
    "project-specific",
  ]);
  const semanticJourney = record(journeyArtifact)?.journey ?? journeyArtifact;
  const journeys = Array.isArray(record(semanticJourney)?.journeys) ? semanticJourney.journeys : [];
  const classifications = buildUserJourneyClassificationView(classificationArtifact);
  const classificationByRef = new Map(classifications.map((entry) => [entry.classification_ref, entry]));
  const assignments = Array.isArray(record(workflowClassificationMapping)?.assignments) ? workflowClassificationMapping.assignments : [];
  const assignmentByWorkflow = new Map(assignments.map((assignment) => [record(assignment)?.workflow_ref, assignment]));
  const workflows = Array.isArray(record(workflowSkeleton)?.workflows) ? workflowSkeleton.workflows : [];
  const inventoryEdges = Array.isArray(record(guardedPathInventory)?.edges) ? guardedPathInventory.edges : [];
  const edgeByRef = new Map(inventoryEdges.map((edge) => [record(edge)?.edge_ref, edge]));
  const workflowCandidates = workflows.map((workflow) => {
    const assignment = record(assignmentByWorkflow.get(workflow.workflow));
    const classificationRefs = [
      assignment?.primary_classification_ref,
      ...(Array.isArray(assignment?.cross_cutting_classification_refs) ? assignment.cross_cutting_classification_refs : []),
    ].filter((reference) => typeof reference === "string");
    const sourceAreaRefs = [...new Set(classificationRefs.flatMap((reference) => {
      const classification = classificationByRef.get(reference);
      if (reference === assignment?.primary_classification_ref) return classification?.source_area_refs ?? [];
      return classification?.source_area_refs?.length === 1 || workflowScopingPerspectives.has(classification?.perspective)
        ? classification.source_area_refs
        : [];
    }))].sort();
    const edgeRefs = Array.isArray(workflow.cites) ? workflow.cites.filter((reference) => typeof reference === "string" && reference.startsWith("E-")) : [];
    return {
      workflow_ref: workflow.workflow,
      goal: workflow.goal,
      classification_refs: classificationRefs,
      source_area_refs: sourceAreaRefs,
      edges: edgeRefs.map((edgeRef) => edgeByRef.get(edgeRef)).filter(Boolean).map((edge) => ({ ...edge })),
    };
  });

  let targetSequence = 0;
  return {
    schema_version: 1,
    project_id: workflowSkeleton.project_id,
    analysis_run_id: workflowSkeleton.analysis_run_id,
    source_snapshot_id: workflowSkeleton.source_snapshot_id,
    journey_artifact_hash: journeyArtifactHash,
    fact_graph_artifact_hash: factGraphArtifactHash,
    business_workflow_mapping_artifact_hash: businessWorkflowMappingArtifactHash,
    targets: journeys.flatMap((journey, journeyIndex) => {
      const journeyRef = `J${String(journeyIndex + 1).padStart(3, "0")}`;
      return (Array.isArray(record(journey)?.milestones) ? journey.milestones : []).map((milestone) => {
        const requiredOutcome = milestone.phase === "failure" ? "exception" : "normal";
        const milestoneAreaRefs = new Set(Array.isArray(milestone.source_area_refs) ? milestone.source_area_refs : []);
        const candidates = workflowCandidates.flatMap((workflow) => {
          if (!workflow.source_area_refs.some((sourceAreaRef) => milestoneAreaRefs.has(sourceAreaRef))) return [];
          const eligibleEdges = workflow.edges
            .filter((edge) => edge.outcome === requiredOutcome && edge.scope === "journey")
            .map((edge) => ({
              edge_ref: edge.edge_ref,
              source_action_ref: edge.source_action_ref,
              from_screen_ref: edge.from_screen_ref,
              to_screen_ref: edge.to_screen_ref,
              ...(edge.guard ? { guard: edge.guard } : {}),
              ...(edge.effect ? { effect: edge.effect } : {}),
              feasibility: edge.feasibility,
            }));
          return eligibleEdges.length ? [{ workflow_ref: workflow.workflow_ref, goal: workflow.goal, source_area_refs: workflow.source_area_refs, eligible_edges: eligibleEdges }] : [];
        }).sort((left, right) => left.workflow_ref.localeCompare(right.workflow_ref));
        return {
          target_ref: `JM${String(++targetSequence).padStart(3, "0")}`,
          journey_ref: journeyRef,
          journey_kind: journey.kind,
          journey_title: journey.title,
          milestone_position: milestone.position,
          phase: milestone.phase,
          action: milestone.action,
          observable_outcome: milestone.observable_outcome,
          source_area_refs: [...milestoneAreaRefs],
          required_outcome: requiredOutcome,
          allowed_workflow_refs: candidates.map((candidate) => candidate.workflow_ref),
          workflow_candidates: candidates,
        };
      });
    }),
  };
}

export function validateUserJourneyWorkflowLinkPatch(value, plan) {
  const item = record(value);
  const mappingPlan = record(plan);
  const issues = [];
  const links = Array.isArray(item?.milestone_links) ? item.milestone_links : [];
  const unresolved = Array.isArray(item?.unresolved) ? item.unresolved : [];
  const targets = Array.isArray(mappingPlan?.targets) ? mappingPlan.targets : [];
  const targetByRef = new Map(targets.map((target) => [record(target)?.target_ref, target]));
  if (!exactObject(item, ["schema_version", "journey_artifact_hash", "fact_graph_artifact_hash", "business_workflow_mapping_artifact_hash", "milestone_links", "unresolved"])
    || item?.schema_version !== 1
    || !collection(item?.milestone_links)
    || !collection(item?.unresolved)) {
    issues.push("USER_JOURNEY_WORKFLOW_LINK_PATCH_INVALID");
  }
  if (item?.journey_artifact_hash !== mappingPlan?.journey_artifact_hash
    || item?.fact_graph_artifact_hash !== mappingPlan?.fact_graph_artifact_hash
    || item?.business_workflow_mapping_artifact_hash !== mappingPlan?.business_workflow_mapping_artifact_hash) {
    issues.push("USER_JOURNEY_WORKFLOW_LINK_PROVENANCE_MISMATCH");
  }
  const targetList = targets;
  const departureScreenRefs = new Set(targetList.flatMap((target) => (
    Array.isArray(record(target)?.workflow_candidates) ? target.workflow_candidates : []
  ).flatMap((candidate) => (
    Array.isArray(record(candidate)?.eligible_edges) ? candidate.eligible_edges : []
  ).map((edge) => record(edge)?.from_screen_ref).filter(Boolean))));
  const finalPositionByJourney = new Map();
  for (const target of targetList) {
    const entry = record(target);
    if (!entry) continue;
    const previous = finalPositionByJourney.get(entry.journey_ref) ?? -Infinity;
    if (Number(entry.milestone_position) > previous) finalPositionByJourney.set(entry.journey_ref, Number(entry.milestone_position));
  }
  const midJourneyArrivals = (target) => {
    const entry = record(target);
    if (!entry || ["exit", "business-result"].includes(String(entry.phase))) return [];
    if (Number(entry.milestone_position) >= (finalPositionByJourney.get(entry.journey_ref) ?? Infinity)) return [];
    return (Array.isArray(entry.workflow_candidates) ? entry.workflow_candidates : []).flatMap((candidate) => (
      Array.isArray(record(candidate)?.eligible_edges) ? candidate.eligible_edges : []
    ).map((edge) => record(edge)?.to_screen_ref).filter(Boolean));
  };
  // A milestone that can land on a screen the journey cannot continue from has no honest link for
  // that intent, so recording it as a gap is the correct outcome rather than asserting a different
  // workflow that does not do the work the milestone describes.
  const deadEndTargetRefs = new Set(targetList.filter((target) => (
    midJourneyArrivals(target).some((screenRef) => !departureScreenRefs.has(screenRef))
  )).map((target) => record(target).target_ref));
  const accountedTargetRefs = [];
  for (const link of links) {
    const entry = record(link);
    if (!exactObject(entry, ["target_ref", "workflow_refs"])
      || !safeText(entry?.target_ref)
      || !stringArray(entry?.workflow_refs, { allowEmpty: false })) {
      issues.push("USER_JOURNEY_WORKFLOW_LINK_ENTRY_INVALID");
      continue;
    }
    const target = record(targetByRef.get(entry.target_ref));
    if (!target) issues.push(`USER_JOURNEY_WORKFLOW_LINK_TARGET_INVALID:${entry.target_ref}`);
    if (accountedTargetRefs.includes(entry.target_ref)) issues.push(`USER_JOURNEY_WORKFLOW_LINK_TARGET_DUPLICATE:${entry.target_ref}`);
    accountedTargetRefs.push(entry.target_ref);
    if (new Set(entry.workflow_refs).size !== entry.workflow_refs.length) issues.push(`USER_JOURNEY_WORKFLOW_LINK_WORKFLOW_DUPLICATE:${entry.target_ref}`);
    const allowed = new Set(Array.isArray(target?.allowed_workflow_refs) ? target.allowed_workflow_refs : []);
    for (const workflowRef of entry.workflow_refs) if (!allowed.has(workflowRef)) issues.push(`USER_JOURNEY_WORKFLOW_LINK_NOT_ALLOWED:${entry.target_ref}:${workflowRef}`);
    const candidateByWorkflow = new Map((Array.isArray(target?.workflow_candidates) ? target.workflow_candidates : [])
      .map((candidate) => [record(candidate)?.workflow_ref, candidate]));
    const coveredSourceAreaRefs = new Set(entry.workflow_refs.flatMap((workflowRef) => {
      const candidate = record(candidateByWorkflow.get(workflowRef));
      return Array.isArray(candidate?.source_area_refs) ? candidate.source_area_refs : [];
    }));
    for (const sourceAreaRef of Array.isArray(target?.source_area_refs) ? target.source_area_refs : []) {
      if (!coveredSourceAreaRefs.has(sourceAreaRef)) issues.push(`USER_JOURNEY_WORKFLOW_LINK_SOURCE_AREA_COVERAGE_MISSING:${entry.target_ref}:${sourceAreaRef}`);
    }
  }
  for (const gap of unresolved) {
    const entry = record(gap);
    if (!exactObject(entry, ["target_ref", "reason"]) || !safeText(entry?.target_ref) || !safeText(entry?.reason)) {
      issues.push("USER_JOURNEY_WORKFLOW_LINK_UNRESOLVED_INVALID");
      continue;
    }
    if (!targetByRef.has(entry.target_ref)) issues.push(`USER_JOURNEY_WORKFLOW_LINK_TARGET_INVALID:${entry.target_ref}`);
    if (accountedTargetRefs.includes(entry.target_ref)) issues.push(`USER_JOURNEY_WORKFLOW_LINK_TARGET_DUPLICATE:${entry.target_ref}`);
    accountedTargetRefs.push(entry.target_ref);
    // Every candidate for this milestone dead-ends, so no link could be honest. Recording the gap is
    // the correct outcome and carries forward; only a milestone that could have been linked fails.
    if (!deadEndTargetRefs.has(entry.target_ref)) issues.push(`USER_JOURNEY_WORKFLOW_LINK_UNRESOLVED:${entry.target_ref}`);
  }
  for (const link of links) {
    const entry = record(link);
    const target = record(targetByRef.get(entry?.target_ref));
    if (!entry || !target || !Array.isArray(entry.workflow_refs)) continue;
    const candidateByWorkflowRef = new Map((Array.isArray(target.workflow_candidates) ? target.workflow_candidates : [])
      .map((candidate) => [record(candidate)?.workflow_ref, candidate]));
    const arrivals = entry.workflow_refs.flatMap((workflowRef) => (
      Array.isArray(record(candidateByWorkflowRef.get(workflowRef))?.eligible_edges)
        ? candidateByWorkflowRef.get(workflowRef).eligible_edges
        : []
    ).map((edge) => record(edge)?.to_screen_ref).filter(Boolean));
    if (!midJourneyArrivals(target).length) continue;
    for (const screenRef of [...new Set(arrivals)]) {
      if (!departureScreenRefs.has(screenRef)) issues.push(`USER_JOURNEY_WORKFLOW_LINK_DEAD_END:${entry.target_ref}:${screenRef}`);
    }
  }
  const accounted = new Set(accountedTargetRefs);
  const missing = [...targetByRef.keys()].filter((targetRef) => !accounted.has(targetRef)).sort();
  if (missing.length) issues.push(`USER_JOURNEY_WORKFLOW_LINK_INCOMPLETE:${missing.join(",")}`);
  return [...new Set(issues)];
}

export function createUserJourneyWorkflowLinkCorrectionPlan({ basePatchHash, basePatch, plan }) {
  const item = record(basePatch);
  const targets = Array.isArray(record(plan)?.targets) ? plan.targets : [];
  const targetByRef = new Map(targets.map((target) => [record(target)?.target_ref, target]));
  if (!safeText(basePatchHash)
    || !exactObject(item, ["schema_version", "journey_artifact_hash", "fact_graph_artifact_hash", "business_workflow_mapping_artifact_hash", "milestone_links", "unresolved"])
    || item?.schema_version !== 1
    || item?.journey_artifact_hash !== plan?.journey_artifact_hash
    || item?.fact_graph_artifact_hash !== plan?.fact_graph_artifact_hash
    || item?.business_workflow_mapping_artifact_hash !== plan?.business_workflow_mapping_artifact_hash
    || !collection(item?.milestone_links)
    || !collection(item?.unresolved)) {
    throw new Error("USER_JOURNEY_WORKFLOW_LINK_CORRECTION_BASE_INVALID");
  }
  const linkByTarget = new Map();
  const unresolvedByTarget = new Map();
  for (const link of item.milestone_links) {
    const targetRef = record(link)?.target_ref;
    if (!targetByRef.has(targetRef) || linkByTarget.has(targetRef)) throw new Error("USER_JOURNEY_WORKFLOW_LINK_CORRECTION_BASE_INVALID");
    linkByTarget.set(targetRef, link);
  }
  for (const gap of item.unresolved) {
    const targetRef = record(gap)?.target_ref;
    if (!targetByRef.has(targetRef) || unresolvedByTarget.has(targetRef) || linkByTarget.has(targetRef)) throw new Error("USER_JOURNEY_WORKFLOW_LINK_CORRECTION_BASE_INVALID");
    unresolvedByTarget.set(targetRef, gap);
  }

  const correctionTargets = [];
  const retainedLinks = [];
  for (const target of targets) {
    const targetRef = target.target_ref;
    const link = linkByTarget.get(targetRef);
    if (!link || unresolvedByTarget.has(targetRef)) {
      correctionTargets.push(target);
      continue;
    }
    const singleTargetPlan = { ...plan, targets: [target] };
    const singleTargetPatch = {
      schema_version: 1,
      journey_artifact_hash: plan.journey_artifact_hash,
      fact_graph_artifact_hash: plan.fact_graph_artifact_hash,
      business_workflow_mapping_artifact_hash: plan.business_workflow_mapping_artifact_hash,
      milestone_links: [link],
      unresolved: [],
    };
    if (validateUserJourneyWorkflowLinkPatch(singleTargetPatch, singleTargetPlan).length) correctionTargets.push(target);
    else retainedLinks.push(structuredClone(link));
  }
  if (!correctionTargets.length) throw new Error("USER_JOURNEY_WORKFLOW_LINK_CORRECTION_NOT_REQUIRED");
  return {
    schema_version: 1,
    base_patch_hash: basePatchHash,
    journey_artifact_hash: plan.journey_artifact_hash,
    fact_graph_artifact_hash: plan.fact_graph_artifact_hash,
    business_workflow_mapping_artifact_hash: plan.business_workflow_mapping_artifact_hash,
    targets: correctionTargets,
    retained_links: retainedLinks,
  };
}

export function applyUserJourneyWorkflowLinkCorrectionPatch(correctionPatch, correctionPlan, fullPlan) {
  const item = record(correctionPatch);
  if (!exactObject(item, ["schema_version", "base_patch_hash", "journey_artifact_hash", "fact_graph_artifact_hash", "business_workflow_mapping_artifact_hash", "milestone_links", "unresolved"])
    || item?.schema_version !== 1
    || item?.base_patch_hash !== correctionPlan?.base_patch_hash) {
    throw new Error("USER_JOURNEY_WORKFLOW_LINK_CORRECTION_BASE_MISMATCH");
  }
  const targetRefs = new Set((Array.isArray(correctionPlan?.targets) ? correctionPlan.targets : []).map((target) => target.target_ref));
  const submittedRefs = [
    ...(Array.isArray(item.milestone_links) ? item.milestone_links : []).map((link) => record(link)?.target_ref),
    ...(Array.isArray(item.unresolved) ? item.unresolved : []).map((gap) => record(gap)?.target_ref),
  ];
  if (submittedRefs.some((targetRef) => !targetRefs.has(targetRef))) throw new Error("USER_JOURNEY_WORKFLOW_LINK_CORRECTION_TARGET_INVALID");
  const boundedPatch = {
    schema_version: 1,
    journey_artifact_hash: item.journey_artifact_hash,
    fact_graph_artifact_hash: item.fact_graph_artifact_hash,
    business_workflow_mapping_artifact_hash: item.business_workflow_mapping_artifact_hash,
    milestone_links: item.milestone_links,
    unresolved: item.unresolved,
  };
  const boundedPlan = { ...fullPlan, targets: correctionPlan.targets };
  const boundedIssues = validateUserJourneyWorkflowLinkPatch(boundedPatch, boundedPlan)
    .filter((issue) => !issue.startsWith("USER_JOURNEY_WORKFLOW_LINK_UNRESOLVED:"));
  if (boundedIssues.length) throw new Error(boundedIssues[0]);
  const targetOrder = new Map(fullPlan.targets.map((target, index) => [target.target_ref, index]));
  const merged = {
    schema_version: 1,
    journey_artifact_hash: fullPlan.journey_artifact_hash,
    fact_graph_artifact_hash: fullPlan.fact_graph_artifact_hash,
    business_workflow_mapping_artifact_hash: fullPlan.business_workflow_mapping_artifact_hash,
    milestone_links: [...correctionPlan.retained_links.map((link) => structuredClone(link)), ...item.milestone_links.map((link) => structuredClone(link))]
      .sort((left, right) => targetOrder.get(left.target_ref) - targetOrder.get(right.target_ref)),
    unresolved: item.unresolved.map((gap) => structuredClone(gap)),
  };
  const mergedIssues = validateUserJourneyWorkflowLinkPatch(merged, fullPlan)
    .filter((issue) => !issue.startsWith("USER_JOURNEY_WORKFLOW_LINK_UNRESOLVED:"));
  if (mergedIssues.length) throw new Error(mergedIssues[0]);
  return merged;
}

export function compileUserJourneyWorkflowLinks(mappingPatch, plan) {
  const issues = validateUserJourneyWorkflowLinkPatch(mappingPatch, plan);
  if (issues.length) throw new Error(issues[0]);
  const linkByTargetRef = new Map(mappingPatch.milestone_links.map((link) => [link.target_ref, link]));
  const milestones = plan.targets.map((target) => {
    const link = linkByTargetRef.get(target.target_ref);
    const candidateByWorkflow = new Map(target.workflow_candidates.map((candidate) => [candidate.workflow_ref, candidate]));
    const edgeRefs = [];
    const edgeFeasibilities = [];
    for (const workflowRef of link.workflow_refs) {
      for (const edge of candidateByWorkflow.get(workflowRef).eligible_edges) {
        if (!edgeRefs.includes(edge.edge_ref)) edgeRefs.push(edge.edge_ref);
        edgeFeasibilities.push(edge.feasibility);
      }
    }
    return {
      target_ref: target.target_ref,
      journey_ref: target.journey_ref,
      journey_kind: target.journey_kind,
      journey_title: target.journey_title,
      position: target.milestone_position,
      phase: target.phase,
      required_outcome: target.required_outcome,
      workflow_refs: [...link.workflow_refs],
      edge_refs: edgeRefs,
      feasibility: edgeFeasibilities.every((feasibility) => feasibility === "source-supported") ? "source-supported" : "runtime-unverified",
    };
  });
  const journeyRefs = [...new Set(milestones.map((milestone) => milestone.journey_ref))];
  return {
    schema_version: 1,
    project_id: plan.project_id,
    analysis_run_id: plan.analysis_run_id,
    source_snapshot_id: plan.source_snapshot_id,
    journeys: journeyRefs.map((journeyRef) => {
      const journeyMilestones = milestones.filter((milestone) => milestone.journey_ref === journeyRef);
      return {
        journey_ref: journeyRef,
        kind: journeyMilestones[0].journey_kind,
        title: journeyMilestones[0].journey_title,
        feasibility: journeyMilestones.every((milestone) => milestone.feasibility === "source-supported") ? "source-supported" : "runtime-unverified",
        milestones: journeyMilestones.map(({ journey_ref: _journeyRef, journey_kind: _journeyKind, journey_title: _journeyTitle, ...milestone }) => milestone),
      };
    }),
  };
}

export function userJourneyPermittedSourceRefs(sourceArtifact, classificationArtifact, transitionView) {
  const classificationUnresolved = record(classificationArtifact)?.classification?.unresolved;
  const unresolvedRefs = collectStringValues(Array.isArray(classificationUnresolved) ? classificationUnresolved : [], "source_refs_to_revisit")
    .filter((sourceRef) => typeof sourceRef === "string");
  const transitionObligations = Array.isArray(record(transitionView)?.obligations) ? transitionView.obligations : [];
  const unresolvedInteractions = Array.isArray(record(transitionView)?.unresolved_interactions) ? transitionView.unresolved_interactions : [];
  const transitionRefs = [
    ...collectStringValues(transitionObligations, "source_refs_to_revisit"),
    ...unresolvedInteractions.map((entry) => record(entry)?.source_ref),
  ].filter((sourceRef) => typeof sourceRef === "string");
  return new Set([...businessClassificationPermittedSourceRefs(sourceArtifact), ...unresolvedRefs, ...transitionRefs]);
}

export function classifyUserJourneyArtifactRequest(id, permittedSourceRefs, additionalInputArtifactIds = []) {
  if (userJourneyInputArtifactIds.has(id) || additionalInputArtifactIds.includes(id)) return { kind: "input", id };
  if (permittedSourceRefs.has(id)) return { kind: "source-metadata", id };
  return null;
}

const failClosedUserJourneyIssues = new Set([
  "USER_JOURNEY_ARTIFACT_INVALID",
  "USER_JOURNEY_PROVENANCE_MISMATCH",
  "USER_JOURNEY_ENTRY_INVALID",
  "USER_JOURNEY_EXCLUDED_THREAD_INVALID",
  "USER_JOURNEY_UNRESOLVED_INVALID",
  "USER_JOURNEY_THREAD_REF_INVALID",
  "USER_JOURNEY_CLASSIFICATION_REF_INVALID",
  "USER_JOURNEY_SOURCE_AREA_REF_INVALID",
  "USER_JOURNEY_TRANSITION_REF_INVALID",
  "USER_JOURNEY_TRANSITION_AREA_MISMATCH",
  "USER_JOURNEY_TRANSITION_STATUS_CONFLICT",
  "USER_JOURNEY_UNRESOLVED_THREAD_REF_INVALID",
  "USER_JOURNEY_UNRESOLVED_AREA_REF_INVALID",
  "USER_JOURNEY_SOURCE_REF_INVALID",
  "USER_JOURNEY_RAW_SOURCE_COPIED",
]);

export function isFailClosedUserJourneyIssue(issue) {
  return failClosedUserJourneyIssues.has(String(issue).split(":", 1)[0]);
}

export function validateUserJourneyInputs({ runId, sourceArtifactHash, sourceArtifact, sourceValidation, classificationArtifactHash, classificationArtifact, classificationValidation, inventory }) {
  const source = record(sourceArtifact);
  const sourceCheck = record(sourceValidation);
  const classification = record(classificationArtifact);
  const classificationCheck = record(classificationValidation);
  const sourceProvenance = record(source?.provenance);
  const classificationProvenance = record(classification?.provenance);
  const semanticClassification = record(classification?.classification);
  const sourceInventory = record(inventory);
  const inventoryFiles = Array.isArray(sourceInventory?.files) ? sourceInventory.files : [];
  const inventoryRefs = new Set(inventoryFiles.map((file) => record(file)?.source_ref).filter((sourceRef) => typeof sourceRef === "string"));
  const classificationEntries = Array.isArray(semanticClassification?.classifications) ? semanticClassification.classifications : [];
  const bindings = Array.isArray(classification?.evidence_bindings) ? classification.evidence_bindings : [];
  const evidenceCatalog = Array.isArray(classification?.evidence_catalog) ? classification.evidence_catalog : [];
  const evidenceRefs = evidenceCatalog.map((entry) => record(entry)?.evidence_ref);
  const evidenceRefSet = new Set(evidenceRefs);
  const issues = [];

  const validSource = source?.schema_version === 1
    && source?.run_id === runId
    && source?.artifact_status === "locally-validated-unregistered-probe"
    && sourceProvenance?.project_id === sourceInventory?.project_id
    && sourceProvenance?.source_snapshot_id === sourceInventory?.source_snapshot_id
    && sourceProvenance?.source_root_hash === sourceInventory?.source_root_hash
    && Array.isArray(source?.survey?.source_areas)
    && source.survey.source_areas.length > 0
    && Array.isArray(source?.survey?.journey_threads)
    && source.survey.journey_threads.length > 0;
  const validClassification = classification?.schema_version === 1
    && classification?.run_id === runId
    && classification?.artifact_status === "locally-validated-unregistered-probe"
    && classificationProvenance?.project_id === sourceInventory?.project_id
    && classificationProvenance?.source_snapshot_id === sourceInventory?.source_snapshot_id
    && classificationProvenance?.source_root_hash === sourceInventory?.source_root_hash
    && classificationProvenance?.extends_artifact_id === "02-source-gap-review"
    && classificationProvenance?.extends_artifact_hash === sourceArtifactHash
    && stringArray(classificationProvenance?.granted_evidence_refs, { allowEmpty: false })
    && stringArray(classificationProvenance?.inherited_evidence_refs)
    && semanticClassification?.stage === "business-classification"
    && semanticClassification?.run_id === runId
    && semanticClassification?.source_snapshot_ref === sourceInventory?.source_snapshot_id
    && semanticClassification?.source_root_hash === sourceInventory?.source_root_hash
    && semanticClassification?.extends_artifact_id === "02-source-gap-review"
    && semanticClassification?.extends_artifact_hash === sourceArtifactHash
    && classificationEntries.length > 0
    && evidenceCatalog.length > 0
    && bindings.length === classificationEntries.length;
  const validSourceCheck = sourceCheck?.pass === true
    && sourceCheck?.validation_scope === "local-probe-contract-only"
    && sourceCheck?.product_stage_acceptance === "not-attempted"
    && sourceCheck?.artifact_hash === sourceArtifactHash;
  const validClassificationCheck = classificationCheck?.pass === true
    && classificationCheck?.validation_scope === "local-probe-contract-only"
    && classificationCheck?.product_stage_acceptance === "not-attempted"
    && classificationCheck?.prior_artifact_hash === sourceArtifactHash
    && classificationCheck?.artifact_hash === classificationArtifactHash;
  const validInventory = sourceInventory?.schema_version === 1
    && sourceInventory?.analysis_run_id === runId
    && safeText(sourceInventory?.project_id)
    && safeText(sourceInventory?.source_snapshot_id)
    && safeText(sourceInventory?.source_root_hash)
    && inventoryFiles.length > 0;

  if (!validSource || !validClassification || !validSourceCheck || !validClassificationCheck || !validInventory) issues.push("USER_JOURNEY_INPUT_INVALID");
  if (!safeText(sourceArtifactHash) || !safeText(classificationArtifactHash)) issues.push("USER_JOURNEY_INPUT_INVALID");
  if (sourceCheck?.artifact_hash !== sourceArtifactHash) issues.push("USER_JOURNEY_SOURCE_HASH_MISMATCH");
  if (classificationCheck?.artifact_hash !== classificationArtifactHash) issues.push("USER_JOURNEY_CLASSIFICATION_HASH_MISMATCH");
  if (classificationCheck?.prior_artifact_hash !== sourceArtifactHash || classificationProvenance?.extends_artifact_hash !== sourceArtifactHash) issues.push("USER_JOURNEY_HANDOFF_CHAIN_MISMATCH");

  if (new Set(evidenceRefs).size !== evidenceRefs.length
    || evidenceRefs.some((evidenceRef) => !safeText(evidenceRef))
    || !sameStringSet(evidenceRefs, classificationProvenance?.granted_evidence_refs)) {
    issues.push("USER_JOURNEY_CLASSIFICATION_EVIDENCE_CATALOG_MISMATCH");
  }
  const inheritedEvidenceRefs = (Array.isArray(source?.evidence_catalog) ? source.evidence_catalog : []).map((entry) => record(entry)?.evidence_ref);
  if (!sameStringSet(inheritedEvidenceRefs, classificationProvenance?.inherited_evidence_refs)) issues.push("USER_JOURNEY_INHERITED_EVIDENCE_MISMATCH");
  for (let index = 0; index < bindings.length; index += 1) {
    const binding = record(bindings[index]);
    const classificationEntry = record(classificationEntries[index]);
    if (!exactObject(binding, ["classification_position", "source_area_refs", "evidence_refs"])
      || binding?.classification_position !== index
      || !sameStringSet(binding?.source_area_refs, classificationEntry?.source_area_refs)
      || !stringArray(binding?.evidence_refs, { allowEmpty: false })
      || binding.evidence_refs.some((evidenceRef) => !evidenceRefSet.has(evidenceRef))) {
      issues.push(`USER_JOURNEY_CLASSIFICATION_EVIDENCE_BINDING_INVALID:${index}`);
    }
  }
  for (const sourceRef of userJourneyPermittedSourceRefs(sourceArtifact, classificationArtifact)) {
    if (!inventoryRefs.has(sourceRef)) issues.push(`USER_JOURNEY_INPUT_SOURCE_REF_INVALID:${sourceRef}`);
  }
  return [...new Set(issues)];
}

export function createUserJourneyStageGuard(sourceArtifact, sourceBytesByRef, options = {}) {
  const maxClosureCalls = options.maxClosureCalls ?? 10;
  const maxGrantedBytes = options.maxGrantedBytes ?? 500_000;
  const maxArtifactWriteAttempts = options.maxArtifactWriteAttempts ?? 3;
  const permittedSourceRefs = options.permittedSourceRefs instanceof Set
    ? options.permittedSourceRefs
    : userJourneyPermittedSourceRefs(sourceArtifact, options.classificationArtifact);
  const sourcesByArea = businessClassificationEvidenceSourcesByArea(sourceArtifact);
  const requiredArtifactIds = new Set(options.requiredInputArtifactIds ?? userJourneyInputArtifactIds);
  const correctionTargets = Array.isArray(record(options.correctionPlan)?.targets) ? options.correctionPlan.targets : null;
  const correctionSourceRefs = correctionTargets
    ? uniqueSortedStrings(correctionTargets.flatMap((target) => Array.isArray(record(target)?.required_source_refs) ? target.required_source_refs : []))
    : [];
  const correctionAreaRefs = correctionTargets
    ? uniqueSortedStrings(correctionTargets.flatMap((target) => Array.isArray(record(target)?.required_source_area_refs) ? target.required_source_area_refs : []))
    : null;
  const artifactReads = new Set();
  const sourceReads = new Set();
  let closureCalls = 0;
  let cumulativeGrantedBytes = 0;
  let artifactWriteAttempts = 0;
  let artifactWrites = 0;
  let fatalError;

  const reject = (code) => {
    fatalError ??= code;
    throw new Error(code);
  };

  return {
    fail(code) {
      fatalError ??= code;
    },
    recordArtifactRead(artifactId) {
      if (fatalError) throw new Error(fatalError);
      if (!requiredArtifactIds.has(artifactId)) return reject("AGENTIC_ARTIFACT_NOT_FOUND");
      artifactReads.add(artifactId);
    },
    requireArtifactRefresh(artifactIds) {
      if (fatalError) throw new Error(fatalError);
      if (!Array.isArray(artifactIds) || artifactIds.some((artifactId) => !requiredArtifactIds.has(artifactId))) return reject("AGENTIC_ARTIFACT_NOT_FOUND");
      artifactIds.forEach((artifactId) => artifactReads.delete(artifactId));
    },
    requireSourceRefresh(sourceRefs) {
      if (fatalError) throw new Error(fatalError);
      if (!Array.isArray(sourceRefs) || sourceRefs.some((sourceRef) => !permittedSourceRefs.has(sourceRef))) return reject("AGENTIC_SOURCE_SCOPE_VIOLATION");
      sourceRefs.forEach((sourceRef) => sourceReads.delete(sourceRef));
    },
    beginClosure(sourceRefs) {
      if (fatalError) throw new Error(fatalError);
      if (![...requiredArtifactIds].every((artifactId) => artifactReads.has(artifactId))) return reject("USER_JOURNEY_INPUTS_NOT_READ");
      const uniqueRefs = [...new Set(sourceRefs)];
      if (!uniqueRefs.length || uniqueRefs.some((sourceRef) => !permittedSourceRefs.has(sourceRef) || !sourceBytesByRef.has(sourceRef))) return reject("AGENTIC_SOURCE_SCOPE_VIOLATION");
      const requestedBytes = uniqueRefs.reduce((total, sourceRef) => total + sourceBytesByRef.get(sourceRef), 0);
      if (closureCalls + 1 > maxClosureCalls || cumulativeGrantedBytes + requestedBytes > maxGrantedBytes) return reject("AGENTIC_SURVEY_BUDGET_EXCEEDED");
      closureCalls += 1;
      cumulativeGrantedBytes += requestedBytes;
      uniqueRefs.forEach((sourceRef) => sourceReads.add(sourceRef));
    },
    beginArtifactWrite(journeys) {
      if (artifactWrites > 0) throw new Error("AGENTIC_ARTIFACT_WRITE_DUPLICATE");
      if (fatalError) throw new Error(fatalError);
      if (![...requiredArtifactIds].every((artifactId) => artifactReads.has(artifactId)) || closureCalls === 0) throw new Error("AGENTIC_SOURCE_TOOLS_NOT_USED");
      if (artifactWriteAttempts >= maxArtifactWriteAttempts) return reject("AGENTIC_ARTIFACT_WRITE_ATTEMPTS_EXCEEDED");
      const sourceAreaRefs = correctionAreaRefs ?? (Array.isArray(journeys) ? journeys : []).flatMap((journey) => (
        Array.isArray(record(journey)?.milestones)
          ? journey.milestones.flatMap((milestone) => Array.isArray(record(milestone)?.source_area_refs) ? milestone.source_area_refs : [])
          : []
      ));
      for (const sourceAreaRef of sourceAreaRefs) {
        if (!sourcesByArea.has(sourceAreaRef)) return reject(`USER_JOURNEY_SOURCE_AREA_REF_INVALID:${sourceAreaRef}`);
        const supportingSources = sourcesByArea.get(sourceAreaRef);
        if (![...supportingSources].some((sourceRef) => sourceReads.has(sourceRef))) throw new Error(`USER_JOURNEY_AREA_SOURCE_NOT_READ:${sourceAreaRef}`);
      }
      for (const sourceRef of correctionSourceRefs) if (!sourceReads.has(sourceRef)) throw new Error(`USER_JOURNEY_TRANSITION_SOURCE_NOT_READ:${sourceRef}`);
      artifactWriteAttempts += 1;
    },
    completeArtifactWrite() {
      if (fatalError) throw new Error(fatalError);
      if (artifactWrites > 0) throw new Error("AGENTIC_ARTIFACT_WRITE_DUPLICATE");
      if (artifactWriteAttempts === 0) throw new Error("AGENTIC_ARTIFACT_WRITE_NOT_STARTED");
      artifactWrites += 1;
    },
    summary() {
      return {
        artifact_reads: [...artifactReads],
        source_refs_read: [...sourceReads],
        correction_source_refs_read: correctionSourceRefs.filter((sourceRef) => sourceReads.has(sourceRef)),
        closure_calls: closureCalls,
        cumulative_granted_bytes: cumulativeGrantedBytes,
        artifact_write_attempts: artifactWriteAttempts,
        artifact_writes: artifactWrites,
        fatal_error: fatalError ?? null,
        max_closure_calls: maxClosureCalls,
        max_granted_bytes: maxGrantedBytes,
        max_artifact_write_attempts: maxArtifactWriteAttempts,
      };
    },
  };
}

const journeyPhases = new Set(["entry", "work", "failure", "recovery", "business-result", "exit"]);

function validJourneyMilestone(value) {
  const item = record(value);
  return exactObject(item, ["position", "phase", "action", "observable_outcome", "source_area_refs"], ["transition_refs"])
    && Number.isInteger(item?.position)
    && item.position > 0
    && journeyPhases.has(item?.phase)
    && safeText(item?.action)
    && safeText(item?.observable_outcome)
    && stringArray(item?.source_area_refs, { allowEmpty: false })
    && (item.transition_refs === undefined || stringArray(item.transition_refs, { allowEmpty: false }));
}

function validJourneyHandoff(value) {
  const item = record(value);
  return exactObject(item, ["from_position", "to_position", "state"])
    && Number.isInteger(item?.from_position)
    && Number.isInteger(item?.to_position)
    && item.from_position > 0
    && item.to_position > 0
    && stringArray(item?.state, { allowEmpty: false });
}

function validJourneyResult(value) {
  const item = record(value);
  return exactObject(item, ["description", "milestone_position", "source_area_refs"])
    && safeText(item?.description)
    && Number.isInteger(item?.milestone_position)
    && item.milestone_position > 0
    && stringArray(item?.source_area_refs, { allowEmpty: false });
}

function validJourneyExit(value) {
  const item = record(value);
  return exactObject(item, ["kind", "action", "observable_outcome", "milestone_position"])
    && ["logout", "handoff", "process-end"].includes(item?.kind)
    && safeText(item?.action)
    && safeText(item?.observable_outcome)
    && Number.isInteger(item?.milestone_position)
    && item.milestone_position > 0;
}

function validJourneyRecovery(value) {
  const item = record(value);
  return exactObject(item, ["failure_milestone_position", "recovery_action_position", "rejoin_milestone_position"])
    && [item?.failure_milestone_position, item?.recovery_action_position, item?.rejoin_milestone_position].every((position) => Number.isInteger(position) && position > 0);
}

function validUserJourney(value) {
  const item = record(value);
  return exactObject(item, ["kind", "title", "persona", "source_thread_ref", "classification_refs", "prerequisites", "milestones", "handoffs", "business_result", "exit", "recovery"])
    && ["normal", "recovery"].includes(item?.kind)
    && safeText(item?.title)
    && safeText(item?.persona)
    && safeText(item?.source_thread_ref)
    && stringArray(item?.classification_refs, { allowEmpty: false })
    && stringArray(item?.prerequisites, { allowEmpty: false })
    && collection(item?.milestones)
    && item.milestones.length >= 3
    && item.milestones.every(validJourneyMilestone)
    && collection(item?.handoffs)
    && item.handoffs.every(validJourneyHandoff)
    && validJourneyResult(item?.business_result)
    && validJourneyExit(item?.exit)
    && ((item.kind === "normal" && item.recovery === null) || (item.kind === "recovery" && validJourneyRecovery(item.recovery)));
}

function validExcludedJourneyThread(value) {
  const item = record(value);
  return exactObject(item, ["source_thread_ref", "reason"])
    && safeText(item?.source_thread_ref)
    && safeText(item?.reason);
}

function validUserJourneyUnresolved(value) {
  const item = record(value);
  return exactObject(item, ["description", "reason", "source_thread_refs", "source_area_refs", "source_refs_to_revisit"], ["transition_refs"])
    && safeText(item?.description)
    && safeText(item?.reason)
    && stringArray(item?.source_thread_refs)
    && stringArray(item?.source_area_refs)
    && stringArray(item?.source_refs_to_revisit, { allowEmpty: false })
    && (item.transition_refs === undefined || stringArray(item.transition_refs, { allowEmpty: false }));
}

export function auditUserJourneyTransitionCoverage(journeyArtifact, transitionView) {
  const obligations = Array.isArray(record(transitionView)?.obligations) ? transitionView.obligations : [];
  const obligationByRef = new Map(obligations.map((obligation) => [record(obligation)?.transition_ref, obligation]));
  const mappedRefs = new Set();
  const unknownRefs = new Set();
  const areaMismatches = [];
  const journeys = Array.isArray(record(journeyArtifact)?.journeys) ? journeyArtifact.journeys : [];
  for (const [journeyIndex, journey] of journeys.entries()) {
    const milestones = Array.isArray(record(journey)?.milestones) ? journey.milestones : [];
    for (const milestone of milestones) {
      const milestoneItem = record(milestone);
      const sourceAreaRefs = new Set(Array.isArray(milestoneItem?.source_area_refs) ? milestoneItem.source_area_refs : []);
      for (const transitionRef of Array.isArray(milestoneItem?.transition_refs) ? milestoneItem.transition_refs : []) {
        const obligation = record(obligationByRef.get(transitionRef));
        if (!obligation) {
          unknownRefs.add(transitionRef);
          continue;
        }
        mappedRefs.add(transitionRef);
        const obligationAreas = Array.isArray(obligation.source_area_refs) ? obligation.source_area_refs : [];
        if (!obligationAreas.length || !obligationAreas.some((sourceAreaRef) => sourceAreaRefs.has(sourceAreaRef))) {
          areaMismatches.push({ journey_index: journeyIndex, milestone_position: milestoneItem?.position, transition_ref: transitionRef });
        }
      }
    }
  }
  const unresolvedRefs = new Set((Array.isArray(record(journeyArtifact)?.unresolved) ? journeyArtifact.unresolved : [])
    .flatMap((entry) => Array.isArray(record(entry)?.transition_refs) ? entry.transition_refs : []));
  for (const transitionRef of unresolvedRefs) if (!obligationByRef.has(transitionRef)) unknownRefs.add(transitionRef);
  const missingRefs = obligations
    .map((obligation) => record(obligation)?.transition_ref)
    .filter((transitionRef) => !mappedRefs.has(transitionRef) && !unresolvedRefs.has(transitionRef));
  const statusConflicts = [...mappedRefs].filter((transitionRef) => unresolvedRefs.has(transitionRef)).sort();
  const scope = (scope) => {
    const scoped = obligations.filter((obligation) => record(obligation)?.scope === scope);
    return { total: scoped.length, mapped: scoped.filter((obligation) => mappedRefs.has(obligation.transition_ref)).length };
  };
  return {
    total_obligations: obligations.length,
    mapped_obligations: mappedRefs.size,
    missing_obligation_refs: missingRefs,
    unresolved_obligation_refs: [...unresolvedRefs].filter((transitionRef) => obligationByRef.has(transitionRef)).sort(),
    unknown_transition_refs: [...unknownRefs].sort(),
    area_mismatches: areaMismatches,
    status_conflicts: statusConflicts,
    by_scope: { journey: scope("journey"), view: scope("view") },
    runtime_unverified_obligation_refs: obligations
      .filter((obligation) => record(obligation)?.feasibility === "runtime-unverified")
      .map((obligation) => obligation.transition_ref),
  };
}

function validUserJourneyTransitionMappingTarget(value) {
  const item = record(value);
  return exactObject(item, [
    "target_ref",
    "transition_ref",
    "scope",
    "outcome",
    "feasibility",
    "allowed_milestones",
    "required_source_area_refs",
    "required_source_refs",
  ])
    && /^JT\d{3,}$/.test(item?.target_ref)
    && /^T\d{3,}$/.test(item?.transition_ref)
    && ["journey", "view"].includes(item?.scope)
    && ["normal", "exception"].includes(item?.outcome)
    && ["source-supported", "runtime-unverified"].includes(item?.feasibility)
    && collection(item?.allowed_milestones)
    && item.allowed_milestones.every((milestone) => exactObject(milestone, ["journey_ref", "milestone_position"])
      && /^J\d{3,}$/.test(milestone.journey_ref)
      && Number.isInteger(milestone.milestone_position)
      && milestone.milestone_position > 0)
    && stringArray(item?.required_source_area_refs)
    && stringArray(item?.required_source_refs, { allowEmpty: false });
}

export function buildUserJourneyTransitionMappingPlan({ baseArtifactHash, priorArtifact, transitionView }) {
  const base = record(priorArtifact);
  const view = record(transitionView);
  const obligations = Array.isArray(view?.obligations) ? view.obligations : [];
  if (!safeText(baseArtifactHash)
    || !base
    || !Array.isArray(base.journeys)
    || !Array.isArray(base.unresolved)
    || !["lower-bound", "complete"].includes(view?.branch_inventory_status)
    || !collection(obligations)
    || obligations.some((obligation) => {
      const item = record(obligation);
      return !exactObject(item, ["transition_ref", "scope", "outcome", "feasibility", "source_area_refs", "source_refs_to_revisit"])
        || !/^T\d{3,}$/.test(item?.transition_ref)
        || !["journey", "view"].includes(item?.scope)
        || !["normal", "exception"].includes(item?.outcome)
        || !["source-supported", "runtime-unverified"].includes(item?.feasibility)
        || !stringArray(item?.source_area_refs)
        || !stringArray(item?.source_refs_to_revisit, { allowEmpty: false });
    })
    || new Set(obligations.map((obligation) => obligation.transition_ref)).size !== obligations.length) {
    throw new Error("USER_JOURNEY_TRANSITION_MAPPING_INPUT_INVALID");
  }

  const audit = auditUserJourneyTransitionCoverage(base, view);
  if (audit.unknown_transition_refs.length || audit.area_mismatches.length || audit.status_conflicts.length) {
    throw new Error("USER_JOURNEY_TRANSITION_MAPPING_BASE_INVALID");
  }
  const missingRefs = new Set(audit.missing_obligation_refs);
  const targets = obligations.filter((obligation) => missingRefs.has(obligation.transition_ref)).map((obligation, index) => {
    const requiredAreas = new Set(obligation.source_area_refs);
    const allowedMilestones = base.journeys.flatMap((journey, journeyIndex) => (
      (Array.isArray(record(journey)?.milestones) ? journey.milestones : []).flatMap((milestone) => {
        const milestoneAreas = Array.isArray(record(milestone)?.source_area_refs) ? milestone.source_area_refs : [];
        return milestoneAreas.some((sourceAreaRef) => requiredAreas.has(sourceAreaRef))
          ? [{ journey_ref: `J${String(journeyIndex + 1).padStart(3, "0")}`, milestone_position: milestone.position }]
          : [];
      })
    ));
    return {
      target_ref: `JT${String(index + 1).padStart(3, "0")}`,
      transition_ref: obligation.transition_ref,
      scope: obligation.scope,
      outcome: obligation.outcome,
      feasibility: obligation.feasibility,
      allowed_milestones: allowedMilestones,
      required_source_area_refs: uniqueSortedStrings(obligation.source_area_refs),
      required_source_refs: uniqueSortedStrings(obligation.source_refs_to_revisit),
    };
  });
  if (!targets.length) throw new Error("USER_JOURNEY_TRANSITION_MAPPING_TARGET_MISSING");
  return {
    schema_version: 1,
    artifact_type: "user-journey-transition-mapping-plan",
    base_artifact_hash: baseArtifactHash,
    source_snapshot_ref: base.source_snapshot_ref,
    branch_inventory_status: view.branch_inventory_status,
    targets,
  };
}

export function applyUserJourneyTransitionMappingPatch(baseArtifact, patch, plan) {
  const base = record(baseArtifact);
  const candidate = record(patch);
  const mappingPlan = record(plan);
  const targets = Array.isArray(mappingPlan?.targets) ? mappingPlan.targets : [];
  if (!base
    || !candidate
    || !mappingPlan
    || !exactObject(candidate, ["schema_version", "stage", "run_id", "work_id", "source_snapshot_ref", "source_root_hash", "base_artifact_hash", "changes"])
    || candidate.schema_version !== 1
    || candidate.stage !== "user-journey-transition-mapping-patch"
    || candidate.run_id !== base.run_id
    || candidate.work_id !== base.work_id
    || candidate.source_snapshot_ref !== base.source_snapshot_ref
    || candidate.source_root_hash !== base.source_root_hash
    || !collection(candidate.changes)
    || mappingPlan.schema_version !== 1
    || mappingPlan.artifact_type !== "user-journey-transition-mapping-plan"
    || mappingPlan.source_snapshot_ref !== base.source_snapshot_ref
    || !["lower-bound", "complete"].includes(mappingPlan.branch_inventory_status)
    || !collection(targets)
    || !targets.every(validUserJourneyTransitionMappingTarget)) {
    throw new Error("USER_JOURNEY_TRANSITION_MAPPING_PATCH_INVALID");
  }
  if (candidate.base_artifact_hash !== mappingPlan.base_artifact_hash) throw new Error("USER_JOURNEY_TRANSITION_MAPPING_BASE_MISMATCH");
  const targetByRef = new Map(targets.map((target) => [target.target_ref, target]));
  if (targetByRef.size !== targets.length || new Set(targets.map((target) => target.transition_ref)).size !== targets.length) {
    throw new Error("USER_JOURNEY_TRANSITION_MAPPING_PLAN_INVALID");
  }
  const changeRefs = candidate.changes.map((change) => record(change)?.target_ref);
  if (changeRefs.some((targetRef) => !targetByRef.has(targetRef)) || new Set(changeRefs).size !== changeRefs.length) {
    throw new Error("USER_JOURNEY_TRANSITION_MAPPING_TARGET_INVALID");
  }
  if (targets.some((target) => !changeRefs.includes(target.target_ref))) throw new Error("USER_JOURNEY_TRANSITION_MAPPING_TARGET_MISSING");

  const artifact = structuredClone(base);
  for (const changeValue of candidate.changes) {
    const change = record(changeValue);
    const target = targetByRef.get(change.target_ref);
    if (change.operation === "map") {
      if (!exactObject(change, ["target_ref", "operation", "journey_ref", "milestone_position"])) {
        throw new Error(`USER_JOURNEY_TRANSITION_MAPPING_OPERATION_INVALID:${change.target_ref}`);
      }
      const allowed = target.allowed_milestones.some((milestone) => milestone.journey_ref === change.journey_ref
        && milestone.milestone_position === change.milestone_position);
      if (!allowed) throw new Error(`USER_JOURNEY_TRANSITION_MAPPING_NOT_ALLOWED:${change.target_ref}`);
      const journeyIndex = Number(change.journey_ref.slice(1)) - 1;
      const milestone = artifact.journeys[journeyIndex]?.milestones?.find((entry) => entry.position === change.milestone_position);
      if (!milestone) throw new Error(`USER_JOURNEY_TRANSITION_MAPPING_NOT_ALLOWED:${change.target_ref}`);
      const existingRefs = Array.isArray(milestone.transition_refs) ? milestone.transition_refs : [];
      if (existingRefs.includes(target.transition_ref)) throw new Error(`USER_JOURNEY_TRANSITION_MAPPING_DUPLICATE:${change.target_ref}`);
      milestone.transition_refs = [...existingRefs, target.transition_ref];
      continue;
    }
    if (change.operation === "defer") {
      if (!exactObject(change, ["target_ref", "operation", "description", "reason"])
        || !safeText(change.description)
        || !safeText(change.reason)) {
        throw new Error(`USER_JOURNEY_TRANSITION_MAPPING_DEFER_INVALID:${change.target_ref}`);
      }
      const allowedJourneyRefs = new Set(target.allowed_milestones.map((milestone) => milestone.journey_ref));
      const sourceThreadRefs = artifact.journeys.flatMap((journey, journeyIndex) => (
        allowedJourneyRefs.has(`J${String(journeyIndex + 1).padStart(3, "0")}`) ? [journey.source_thread_ref] : []
      ));
      artifact.unresolved.push({
        description: change.description,
        reason: change.reason,
        source_thread_refs: uniqueSortedStrings(sourceThreadRefs),
        source_area_refs: structuredClone(target.required_source_area_refs),
        source_refs_to_revisit: structuredClone(target.required_source_refs),
        transition_refs: [target.transition_ref],
      });
      continue;
    }
    throw new Error(`USER_JOURNEY_TRANSITION_MAPPING_OPERATION_INVALID:${change.target_ref}`);
  }
  return {
    artifact,
    patch: structuredClone(candidate),
    changed_targets: candidate.changes.map((change) => change.target_ref),
  };
}

const recoverableUserJourneyTransitionMappingIssues = new Set([
  "USER_JOURNEY_TRANSITION_MAPPING_OPERATION_INVALID",
  "USER_JOURNEY_TRANSITION_MAPPING_NOT_ALLOWED",
  "USER_JOURNEY_TRANSITION_MAPPING_DUPLICATE",
  "USER_JOURNEY_TRANSITION_MAPPING_DEFER_INVALID",
]);

export function userJourneyTransitionMappingCompileFailures(error, baseArtifact, patch, plan) {
  const message = error instanceof Error ? error.message : String(error);
  const [code] = message.split(":");
  const targets = Array.isArray(record(plan)?.targets) ? plan.targets : [];
  const changes = Array.isArray(record(patch)?.changes) ? patch.changes : [];
  const knownRefs = new Set(targets.map((target) => record(target)?.target_ref));
  const changeRefs = changes.map((change) => record(change)?.target_ref);
  if ([
    "USER_JOURNEY_TRANSITION_MAPPING_PATCH_INVALID",
    "USER_JOURNEY_TRANSITION_MAPPING_BASE_MISMATCH",
    "USER_JOURNEY_TRANSITION_MAPPING_TARGET_INVALID",
    "USER_JOURNEY_TRANSITION_MAPPING_PLAN_INVALID",
  ].includes(code)
    || changeRefs.some((targetRef) => !knownRefs.has(targetRef))
    || new Set(changeRefs).size !== changeRefs.length) throw error;

  const changeByRef = new Map(changes.map((change) => [record(change)?.target_ref, change]));
  const failures = [];
  for (const target of targets) {
    const change = changeByRef.get(target.target_ref);
    if (!change) {
      failures.push({ target_ref: target.target_ref, issues: ["USER_JOURNEY_TRANSITION_MAPPING_TARGET_MISSING"] });
      continue;
    }
    try {
      applyUserJourneyTransitionMappingPatch(
        baseArtifact,
        { ...structuredClone(patch), changes: [structuredClone(change)] },
        { ...structuredClone(plan), targets: [structuredClone(target)] },
      );
    } catch (targetError) {
      const targetMessage = targetError instanceof Error ? targetError.message : String(targetError);
      const [targetCode, targetRef] = targetMessage.split(":");
      if (!recoverableUserJourneyTransitionMappingIssues.has(targetCode) || targetRef !== target.target_ref) throw targetError;
      failures.push({ target_ref: target.target_ref, issues: [targetMessage] });
    }
  }
  if (!failures.length) throw error;
  return failures;
}

export function retainSuccessfulUserJourneyTransitionMappings(baseArtifact, patch, plan, failures) {
  const targets = Array.isArray(record(plan)?.targets) ? plan.targets : [];
  const failedRefs = new Set(failures.map((failure) => record(failure)?.target_ref));
  if ([...failedRefs].some((targetRef) => !targets.some((target) => target.target_ref === targetRef))) {
    throw new Error("USER_JOURNEY_TRANSITION_MAPPING_TARGET_INVALID");
  }
  const changeByRef = new Map((Array.isArray(record(patch)?.changes) ? patch.changes : []).map((change) => [record(change)?.target_ref, change]));
  const successfulTargets = targets.filter((target) => !failedRefs.has(target.target_ref) && changeByRef.has(target.target_ref));
  const successfulChanges = successfulTargets.map((target) => changeByRef.get(target.target_ref));
  const remainingPlan = { ...structuredClone(plan), targets: targets.filter((target) => failedRefs.has(target.target_ref) || !changeByRef.has(target.target_ref)) };
  if (!successfulTargets.length) {
    return { artifact: structuredClone(baseArtifact), changed_targets: [], remaining_plan: remainingPlan };
  }
  const application = applyUserJourneyTransitionMappingPatch(
    baseArtifact,
    { ...structuredClone(patch), changes: structuredClone(successfulChanges) },
    { ...structuredClone(plan), targets: structuredClone(successfulTargets) },
  );
  return { ...application, remaining_plan: remainingPlan };
}

function classificationRefsForPerspective(classificationByRef, refs, perspective) {
  return refs.filter((ref) => classificationByRef.get(ref)?.perspective === perspective);
}

export function validateUserJourneyEnvelope(value, { runId, workId, snapshotId, rootHash, classificationArtifactId, classificationArtifactHash, sourceArtifactId, sourceArtifactHash, sourceArtifact, classificationArtifact, transitionView, permittedSourceRefs, grantedSourceContents = [] }) {
  const item = record(value);
  const issues = [];
  const topLevelKeys = ["schema_version", "stage", "run_id", "work_id", "source_snapshot_ref", "source_root_hash", "extends_artifact_id", "extends_artifact_hash", "source_basis_artifact_id", "source_basis_artifact_hash", "journeys", "excluded_threads", "unresolved"];
  let malformed = !exactObject(item, topLevelKeys) || item?.schema_version !== 1 || item?.stage !== "user-journeys";
  if (item?.run_id !== runId || item?.work_id !== workId || item?.source_snapshot_ref !== snapshotId || item?.source_root_hash !== rootHash
    || item?.extends_artifact_id !== classificationArtifactId || item?.extends_artifact_hash !== classificationArtifactHash
    || item?.source_basis_artifact_id !== sourceArtifactId || item?.source_basis_artifact_hash !== sourceArtifactHash) {
    issues.push("USER_JOURNEY_PROVENANCE_MISMATCH");
  }
  if (!collection(item?.journeys)) {
    issues.push("USER_JOURNEY_COLLECTION_MISSING:journeys");
    malformed = true;
  } else if (!item.journeys.every(validUserJourney)) {
    issues.push("USER_JOURNEY_ENTRY_INVALID");
    malformed = true;
  }
  if (!collection(item?.excluded_threads)) {
    issues.push("USER_JOURNEY_COLLECTION_MISSING:excluded_threads");
    malformed = true;
  } else if (!item.excluded_threads.every(validExcludedJourneyThread)) {
    issues.push("USER_JOURNEY_EXCLUDED_THREAD_INVALID");
    malformed = true;
  }
  if (!collection(item?.unresolved)) {
    issues.push("USER_JOURNEY_COLLECTION_MISSING:unresolved");
    malformed = true;
  } else if (!item.unresolved.every(validUserJourneyUnresolved)) {
    issues.push("USER_JOURNEY_UNRESOLVED_INVALID");
    malformed = true;
  }

  const journeys = Array.isArray(item?.journeys) ? item.journeys : [];
  const excludedThreads = Array.isArray(item?.excluded_threads) ? item.excluded_threads : [];
  const unresolved = Array.isArray(item?.unresolved) ? item.unresolved : [];
  const sourceSurvey = record(record(sourceArtifact)?.survey);
  const validAreaRefs = new Set((Array.isArray(sourceSurvey?.source_areas) ? sourceSurvey.source_areas : []).map((area) => record(area)?.area_key));
  const validThreadRefs = new Set((Array.isArray(sourceSurvey?.journey_threads) ? sourceSurvey.journey_threads : []).map((thread) => record(thread)?.name));
  const classificationView = buildUserJourneyClassificationView(classificationArtifact);
  const classificationByRef = new Map(classificationView.map((entry) => [entry.classification_ref, entry]));
  const primaryClassificationRefs = classificationView.filter((entry) => entry.perspective === "business-capability").map((entry) => entry.classification_ref);
  const primaryAreaRefs = new Set(classificationView.filter((entry) => entry.perspective === "business-capability").flatMap((entry) => entry.source_area_refs));

  if (!journeys.some((journey) => record(journey)?.kind === "normal")) issues.push("USER_JOURNEY_NORMAL_MISSING");
  if (!journeys.some((journey) => record(journey)?.kind === "recovery")) issues.push("USER_JOURNEY_RECOVERY_MISSING");
  const assignedThreads = [
    ...journeys.map((journey) => record(journey)?.source_thread_ref),
    ...excludedThreads.map((thread) => record(thread)?.source_thread_ref),
  ];
  for (const threadRef of assignedThreads) if (!validThreadRefs.has(threadRef)) issues.push(`USER_JOURNEY_THREAD_REF_INVALID:${threadRef}: use one of [${[...validThreadRefs].join(" | ")}]`);
  for (const threadRef of validThreadRefs) {
    const count = assignedThreads.filter((assigned) => assigned === threadRef).length;
    const normalCount = journeys.filter((journey) => record(journey)?.source_thread_ref === threadRef && record(journey)?.kind === "normal").length;
    const recoveryCount = journeys.filter((journey) => record(journey)?.source_thread_ref === threadRef && record(journey)?.kind === "recovery").length;
    const excludedCount = excludedThreads.filter((thread) => record(thread)?.source_thread_ref === threadRef).length;
    if (count === 0) issues.push(`USER_JOURNEY_THREAD_UNASSIGNED:${threadRef}`);
    if (normalCount > 1 || recoveryCount > 1 || excludedCount > 1 || (excludedCount && count > excludedCount)) issues.push(`USER_JOURNEY_THREAD_ASSIGNED_MULTIPLE:${threadRef}`);
  }

  journeys.forEach((journey, journeyIndex) => {
    const classificationRefs = Array.isArray(record(journey)?.classification_refs) ? journey.classification_refs : [];
    const milestones = Array.isArray(record(journey)?.milestones) ? journey.milestones : [];
    const handoffs = Array.isArray(record(journey)?.handoffs) ? journey.handoffs : [];
    const milestoneAreaRefs = milestones.flatMap((milestone) => Array.isArray(record(milestone)?.source_area_refs) ? milestone.source_area_refs : []);
    if (new Set(classificationRefs).size !== classificationRefs.length) issues.push(`USER_JOURNEY_CLASSIFICATION_REF_DUPLICATE:${journeyIndex}`);
    for (const classificationRef of classificationRefs) {
      const classification = classificationByRef.get(classificationRef);
      if (!classification) issues.push(`USER_JOURNEY_CLASSIFICATION_REF_INVALID:${journeyIndex}:${classificationRef}`);
      else if (!classification.journey_thread_refs.includes(journey.source_thread_ref)) issues.push(`USER_JOURNEY_CLASSIFICATION_THREAD_MISMATCH:${journeyIndex}:${classificationRef}`);
    }
    for (const primaryRef of primaryClassificationRefs) {
      const primary = classificationByRef.get(primaryRef);
      if (primary && !primary.journey_thread_refs.includes(journey.source_thread_ref)) continue;
      if (!classificationRefs.includes(primaryRef)) issues.push(`USER_JOURNEY_PRIMARY_CLASSIFICATION_MISSING:${journeyIndex}:${primaryRef}`);
    }
    const threadPrimaryAreaRefs = new Set(classificationView
      .filter((entry) => entry.perspective === "business-capability" && entry.journey_thread_refs.includes(journey.source_thread_ref))
      .flatMap((entry) => entry.source_area_refs));
    for (const sourceAreaRef of primaryAreaRefs) {
      if (!threadPrimaryAreaRefs.has(sourceAreaRef)) continue;
      if (!milestoneAreaRefs.includes(sourceAreaRef)) issues.push(`USER_JOURNEY_PRIMARY_AREA_MISSING:${journeyIndex}:${sourceAreaRef}`);
    }
    for (const sourceAreaRef of [...milestoneAreaRefs, ...(Array.isArray(journey.business_result?.source_area_refs) ? journey.business_result.source_area_refs : [])]) {
      if (!validAreaRefs.has(sourceAreaRef)) issues.push(`USER_JOURNEY_SOURCE_AREA_REF_INVALID:${journeyIndex}:${sourceAreaRef}`);
    }

    const expectedPositions = milestones.map((_, index) => index + 1);
    if (!milestones.every((milestone, index) => milestone.position === expectedPositions[index])
      || milestones[0]?.phase !== "entry"
      || milestones.at(-1)?.phase !== "exit") {
      issues.push(`USER_JOURNEY_MILESTONE_SEQUENCE_INVALID:${journeyIndex}`);
    }
    const expectedHandoffs = milestones.slice(0, -1).map((_, index) => `${index + 1}:${index + 2}`);
    const actualHandoffs = handoffs.map((handoff) => `${record(handoff)?.from_position}:${record(handoff)?.to_position}`);
    if (actualHandoffs.length !== expectedHandoffs.length || !expectedHandoffs.every((handoff) => actualHandoffs.filter((actual) => actual === handoff).length === 1)) {
      issues.push(`USER_JOURNEY_HANDOFF_CHAIN_INVALID:${journeyIndex}`);
    }
    const businessResultMilestone = milestones.find((milestone) => milestone.position === journey.business_result?.milestone_position);
    if (businessResultMilestone?.phase !== "business-result"
      || !sameStringSet(journey.business_result?.source_area_refs, businessResultMilestone?.source_area_refs)
      || journey.business_result?.milestone_position >= journey.exit?.milestone_position) {
      issues.push(`USER_JOURNEY_BUSINESS_RESULT_INVALID:${journeyIndex}`);
    }
    const exitMilestone = milestones.find((milestone) => milestone.position === journey.exit?.milestone_position);
    if (exitMilestone?.phase !== "exit" || journey.exit?.milestone_position !== milestones.length) issues.push(`USER_JOURNEY_EXIT_INVALID:${journeyIndex}`);

    const adaptivePerspectives = journey.kind === "recovery" ? ["risk-recovery", "output-deliverable"] : ["user-role", "workflow-stage", "output-deliverable"];
    for (const perspective of adaptivePerspectives) {
      const applicable = classificationView.filter((entry) => entry.perspective === perspective && entry.journey_thread_refs.includes(journey.source_thread_ref));
      if (applicable.length && classificationRefsForPerspective(classificationByRef, classificationRefs, perspective).length === 0) issues.push(`USER_JOURNEY_PERSPECTIVE_MISSING:${journeyIndex}:${perspective}`);
    }

    if (journey.kind === "normal" && journey.recovery !== null) issues.push(`USER_JOURNEY_RECOVERY_METADATA_INVALID:${journeyIndex}`);
    if (journey.kind === "recovery") {
      const recovery = record(journey.recovery);
      const failure = milestones.find((milestone) => milestone.position === recovery?.failure_milestone_position);
      const action = milestones.find((milestone) => milestone.position === recovery?.recovery_action_position);
      const rejoin = milestones.find((milestone) => milestone.position === recovery?.rejoin_milestone_position);
      if (!(recovery?.failure_milestone_position < recovery?.recovery_action_position
        && recovery?.recovery_action_position < recovery?.rejoin_milestone_position
        && recovery?.rejoin_milestone_position < journey.business_result?.milestone_position)
        || failure?.phase !== "failure" || action?.phase !== "recovery" || !["work", "business-result"].includes(rejoin?.phase)) {
        issues.push(`USER_JOURNEY_RECOVERY_SEQUENCE_INVALID:${journeyIndex}`);
      }
      const matchingNormal = journeys.find((candidate) => candidate.kind === "normal"
        && sameStringSet(candidate.business_result?.source_area_refs, journey.business_result?.source_area_refs)
        && candidate.exit?.kind === journey.exit?.kind);
      if (!matchingNormal) {
        issues.push(`USER_JOURNEY_RECOVERY_REJOIN_TARGET_MISSING:${journeyIndex}`);
      } else {
        const normalEntry = matchingNormal.milestones?.[0];
        const recoveryEntry = milestones[0];
        const pairMismatches = [
          ["persona", matchingNormal.persona !== journey.persona],
          ["business_result.description", matchingNormal.business_result?.description !== journey.business_result?.description],
          ["exit.action", matchingNormal.exit?.action !== journey.exit?.action],
          ["exit.observable_outcome", matchingNormal.exit?.observable_outcome !== journey.exit?.observable_outcome],
          ["milestones[0].source_area_refs", !sameStringSet(normalEntry?.source_area_refs, recoveryEntry?.source_area_refs)],
        ].filter(([, mismatched]) => mismatched).map(([field]) => field);
        if (pairMismatches.length) {
          issues.push(`USER_JOURNEY_RECOVERY_PAIR_MISMATCH:${journeyIndex}: copy these fields verbatim from the normal journey: ${pairMismatches.join(", ")}`);
        }
      }
    }
  });

  for (const sourceThreadRef of collectStringValues(unresolved, "source_thread_refs")) if (!validThreadRefs.has(sourceThreadRef)) issues.push(`USER_JOURNEY_UNRESOLVED_THREAD_REF_INVALID:${sourceThreadRef}`);
  for (const sourceAreaRef of collectStringValues(unresolved, "source_area_refs")) if (!validAreaRefs.has(sourceAreaRef)) issues.push(`USER_JOURNEY_UNRESOLVED_AREA_REF_INVALID:${sourceAreaRef}`);
  for (const sourceRef of collectStringValues(unresolved, "source_refs_to_revisit")) if (!permittedSourceRefs.has(sourceRef)) issues.push(`USER_JOURNEY_SOURCE_REF_INVALID:${sourceRef}`);

  if (transitionView) {
    const transitionAudit = auditUserJourneyTransitionCoverage(item, transitionView);
    for (const transitionRef of transitionAudit.unknown_transition_refs) issues.push(`USER_JOURNEY_TRANSITION_REF_INVALID:${transitionRef}`);
    for (const mismatch of transitionAudit.area_mismatches) issues.push(`USER_JOURNEY_TRANSITION_AREA_MISMATCH:${mismatch.journey_index}:${mismatch.milestone_position}:${mismatch.transition_ref}`);
    for (const transitionRef of transitionAudit.status_conflicts) issues.push(`USER_JOURNEY_TRANSITION_STATUS_CONFLICT:${transitionRef}`);
    for (const transitionRef of transitionAudit.missing_obligation_refs) issues.push(`USER_JOURNEY_TRANSITION_COVERAGE_MISSING:${transitionRef}`);
  }

  let serialized;
  try {
    serialized = JSON.stringify(item);
  } catch {
    malformed = true;
  }
  if (serialized && (Buffer.byteLength(serialized) > MAX_ARTIFACT_BYTES || containsPotentialSecret(serialized) || forbiddenArtifactTextPattern.test(serialized))) malformed = true;
  if (item && copiesSubstantialSource(item, grantedSourceContents)) issues.push("USER_JOURNEY_RAW_SOURCE_COPIED");
  if (malformed) issues.unshift("USER_JOURNEY_ARTIFACT_INVALID");
  return [...new Set(issues)];
}

export function hydrateUserJourneyEvidence(journeyArtifact, sourceArtifact, evidenceByRef) {
  const sourcesByArea = businessClassificationEvidenceSourcesByArea(sourceArtifact);
  const evidenceEntries = [...evidenceByRef.entries()];
  const issues = [];
  const journeyEvidenceBindings = (Array.isArray(record(journeyArtifact)?.journeys) ? journeyArtifact.journeys : []).map((journey, journeyPosition) => {
    const milestoneBindings = (Array.isArray(record(journey)?.milestones) ? journey.milestones : []).map((milestone) => {
      const sourceAreaRefs = Array.isArray(record(milestone)?.source_area_refs) ? milestone.source_area_refs : [];
      const supportingSources = new Set(sourceAreaRefs.flatMap((sourceAreaRef) => [...(sourcesByArea.get(sourceAreaRef) ?? new Set())]));
      const evidenceRefs = evidenceEntries.filter(([, evidence]) => supportingSources.has(record(evidence)?.source_id)).map(([evidenceRef]) => evidenceRef);
      for (const sourceAreaRef of sourceAreaRefs) {
        const areaSources = sourcesByArea.get(sourceAreaRef) ?? new Set();
        if (!evidenceEntries.some(([, evidence]) => areaSources.has(record(evidence)?.source_id))) issues.push(`USER_JOURNEY_MILESTONE_EVIDENCE_MISSING:${journeyPosition}:${milestone.position}:${sourceAreaRef}`);
      }
      return { milestone_position: milestone.position, source_area_refs: sourceAreaRefs, evidence_refs: evidenceRefs };
    });
    return {
      journey_position: journeyPosition,
      source_thread_ref: journey.source_thread_ref,
      evidence_refs: [...new Set(milestoneBindings.flatMap((binding) => binding.evidence_refs))],
      milestones: milestoneBindings,
    };
  });
  return {
    issues: [...new Set(issues)],
    journey_evidence_bindings: journeyEvidenceBindings,
    evidence_catalog: evidenceEntries.map(([evidenceRef, evidence]) => ({ evidence_ref: evidenceRef, evidence })),
  };
}

const scenarioCaseInputArtifactIds = new Set([
  "03-business-classification",
  "04-user-journeys",
  "04-user-journeys-validation",
  "orchestrator-next-stage-gaps",
  "source-inventory",
]);

export function buildScenarioCaseJourneyView(journeyArtifact, classificationArtifact, sourceArtifact) {
  const journeys = Array.isArray(record(journeyArtifact)?.journey?.journeys) ? journeyArtifact.journey.journeys : [];
  const classifications = buildUserJourneyClassificationView(classificationArtifact);
  const classificationByRef = new Map(classifications.map((entry) => [entry.classification_ref, entry]));
  const usedClassificationRefs = new Set(journeys.flatMap((journey) => Array.isArray(record(journey)?.classification_refs) ? journey.classification_refs : []));
  const projectedJourneys = journeys.map((journey, index) => {
    const classificationRefsByPerspective = {};
    for (const classificationRef of journey.classification_refs) {
      const perspective = classificationByRef.get(classificationRef)?.perspective;
      if (perspective) (classificationRefsByPerspective[perspective] ??= []).push(classificationRef);
    }
    return {
      journey_ref: `J${String(index + 1).padStart(3, "0")}`,
      kind: journey.kind,
      title: journey.title,
      persona: journey.persona,
      source_thread_ref: journey.source_thread_ref,
      classification_refs: journey.classification_refs,
      classification_refs_by_perspective: classificationRefsByPerspective,
      prerequisites: journey.prerequisites,
      milestones: journey.milestones,
      handoffs: journey.handoffs,
      business_result: journey.business_result,
      exit: journey.exit,
      recovery: journey.recovery,
    };
  });
  return {
    journeys: projectedJourneys,
    classification_groups: projectedJourneys.map((journey) => ({
      journey_ref: journey.journey_ref,
      classifications: journey.classification_refs.map((classificationRef) => classificationByRef.get(classificationRef)).filter(Boolean),
    })),
    classification_catalog: classifications.filter((entry) => usedClassificationRefs.has(entry.classification_ref)),
    source_area_support: businessClassificationSourceSupport(sourceArtifact),
    unresolved: Array.isArray(record(journeyArtifact)?.journey?.unresolved) ? journeyArtifact.journey.unresolved : [],
  };
}

export function scenarioCasePermittedSourceRefs(sourceArtifact, classificationArtifact, journeyArtifact, gapDocument) {
  const journeyUnresolved = record(journeyArtifact)?.journey?.unresolved;
  const gaps = record(gapDocument)?.gaps;
  return new Set([
    ...userJourneyPermittedSourceRefs(sourceArtifact, classificationArtifact),
    ...collectStringValues(Array.isArray(journeyUnresolved) ? journeyUnresolved : [], "source_refs_to_revisit"),
    ...collectStringValues(Array.isArray(gaps) ? gaps : [], "source_refs_to_revisit"),
  ]);
}

export function classifyScenarioCaseArtifactRequest(id, permittedSourceRefs, additionalInputArtifactIds = []) {
  if (scenarioCaseInputArtifactIds.has(id) || additionalInputArtifactIds.includes(id)) return { kind: "input", id };
  if (permittedSourceRefs.has(id)) return { kind: "source-metadata", id };
  return null;
}

const scenarioCaseCorrectionFields = ["title", "classification_refs", "preconditions", "variation", "steps", "terminal"];
const correctionFieldBySection = new Map([
  ["title", "title"],
  ["classifications", "classification_refs"],
  ["classification_refs", "classification_refs"],
  ["prerequisites", "preconditions"],
  ["preconditions", "preconditions"],
  ["variation", "variation"],
  ["steps", "steps"],
  ["terminal", "terminal"],
]);
const correctionFieldsByIssue = new Map([
  ["SCENARIO_CASE_CLASSIFICATION_REF_INVALID", ["classification_refs"]],
  ["SCENARIO_CASE_CLASSIFICATION_REF_DUPLICATE", ["classification_refs"]],
  ["SCENARIO_CASE_PERSPECTIVE_MISSING", ["classification_refs"]],
  ["SCENARIO_CASE_STEP_SEQUENCE_INVALID", ["steps"]],
  ["SCENARIO_CASE_STEP_AREA_MISMATCH", ["steps"]],
  ["SCENARIO_CASE_MILESTONE_REF_INVALID", ["steps"]],
  ["SCENARIO_CASE_VARIATION_INVALID", ["variation"]],
  ["SCENARIO_CASE_TERMINAL_INVALID", ["terminal"]],
  ["SCENARIO_CASE_SUCCESS_PATH_INCOMPLETE", ["steps", "terminal"]],
  ["SCENARIO_CASE_RECOVERY_PATH_INCOMPLETE", ["steps", "variation", "terminal"]],
]);

function uniqueSortedStrings(values) {
  return [...new Set(values.filter((value) => typeof value === "string"))].sort();
}

function scenarioCaseAreaRefs(scenarioCase) {
  return uniqueSortedStrings((Array.isArray(record(scenarioCase)?.steps) ? scenarioCase.steps : [])
    .flatMap((step) => Array.isArray(record(step)?.source_area_refs) ? step.source_area_refs : []));
}

function correctionSourcesForAreas(sourceSupport, areaRefs) {
  const requiredAreas = new Set(areaRefs);
  return uniqueSortedStrings(sourceSupport
    .filter((support) => requiredAreas.has(record(support)?.source_area_ref))
    .flatMap((support) => Array.isArray(record(support)?.source_refs) ? support.source_refs : []));
}

function correctionAreasForSources(sourceSupport, sourceRefs) {
  const requiredSources = new Set(sourceRefs);
  return uniqueSortedStrings(sourceSupport
    .filter((support) => (Array.isArray(record(support)?.source_refs) ? support.source_refs : []).some((sourceRef) => requiredSources.has(sourceRef)))
    .map((support) => record(support)?.source_area_ref));
}

function validScenarioCaseCorrectionField(field, value) {
  if (field === "title") return safeText(value);
  if (field === "classification_refs" || field === "preconditions") return stringArray(value, { allowEmpty: false });
  if (field === "variation") return value === null || validScenarioCaseVariation(value);
  if (field === "steps") return collection(value) && value.length >= 2 && value.every(validScenarioCaseStep);
  if (field === "terminal") return validScenarioCaseTerminal(value);
  return false;
}

function validScenarioCaseCorrectionAdditionStep(value) {
  const item = record(value);
  return exactObject(item, ["position", "journey_milestone_position", "action", "observable_outcome"])
    && Number.isInteger(item.position)
    && item.position > 0
    && Number.isInteger(item.journey_milestone_position)
    && item.journey_milestone_position > 0
    && safeText(item.action)
    && safeText(item.observable_outcome);
}

function validScenarioCaseCorrectionAddition(value) {
  const item = record(value);
  return exactObject(item, ["title", "classification_refs", "preconditions", "variation", "steps", "terminal"])
    && safeText(item.title)
    && stringArray(item.classification_refs, { allowEmpty: false })
    && stringArray(item.preconditions, { allowEmpty: false })
    && (item.variation === null || validScenarioCaseVariation(item.variation))
    && collection(item.steps)
    && item.steps.length >= 2
    && item.steps.every(validScenarioCaseCorrectionAdditionStep)
    && validScenarioCaseTerminal(item.terminal);
}

export function buildScenarioCaseCorrectionPlan({ baseArtifactHash, priorArtifact, gapDocument, validationIssues = [], journeyArtifact, classificationArtifact, sourceArtifact, transitionView }) {
  const base = record(priorArtifact);
  if (!safeText(baseArtifactHash) || !base || !Array.isArray(base.cases) || !Array.isArray(base.unresolved)) throw new Error("SCENARIO_CASE_CORRECTION_BASE_INVALID");
  const view = buildScenarioCaseJourneyView(journeyArtifact, classificationArtifact, sourceArtifact);
  const journeyByRef = new Map(view.journeys.map((journey) => [journey.journey_ref, journey]));
  const classificationByRef = new Map(view.classification_catalog.map((classification) => [classification.classification_ref, classification]));
  const obligationByRef = new Map((Array.isArray(record(transitionView)?.obligations) ? transitionView.obligations : [])
    .map((obligation) => [record(obligation)?.transition_ref, obligation]));
  const targets = new Map();

  const addUpdateTarget = (caseIndex, fields, reasonCode, areaRefs, sourceRefs) => {
    const scenarioCase = base.cases[caseIndex];
    if (!record(scenarioCase)) throw new Error(`SCENARIO_CASE_CORRECTION_CASE_INVALID:${caseIndex}`);
    const key = `update:${caseIndex}`;
    const target = targets.get(key) ?? {
      operation: "update-case",
      case_index: caseIndex,
      journey_ref: scenarioCase.journey_ref,
      kind: scenarioCase.kind,
      allowed_fields: [],
      reason_codes: [],
      required_source_area_refs: [],
      required_source_refs: [],
    };
    target.allowed_fields = uniqueSortedStrings([...target.allowed_fields, ...fields]);
    target.reason_codes = uniqueSortedStrings([...target.reason_codes, reasonCode]);
    target.required_source_area_refs = uniqueSortedStrings([...target.required_source_area_refs, ...areaRefs]);
    target.required_source_refs = uniqueSortedStrings([...target.required_source_refs, ...sourceRefs]);
    targets.set(key, target);
    return target;
  };

  const addCaseTarget = (journey, kind, reasonCode, areaRefs, sourceRefs) => {
    const key = `add:${journey.journey_ref}:${kind}`;
    const target = targets.get(key) ?? {
      operation: "add-cases",
      case_index: null,
      journey_ref: journey.journey_ref,
      kind,
      allowed_fields: [...scenarioCaseCorrectionFields],
      milestone_source_area_refs: journey.milestones.map((milestone) => ({
        milestone_position: milestone.position,
        source_area_refs: [...milestone.source_area_refs],
      })),
      reason_codes: [],
      required_source_area_refs: [],
      required_source_refs: [],
    };
    target.reason_codes = uniqueSortedStrings([...target.reason_codes, reasonCode]);
    target.required_source_area_refs = uniqueSortedStrings([...target.required_source_area_refs, ...areaRefs]);
    target.required_source_refs = uniqueSortedStrings([...target.required_source_refs, ...sourceRefs]);
    targets.set(key, target);
    return target;
  };

  for (const issue of validationIssues) {
    const [code, indexText, detail] = String(issue).split(":");
    if (code === "SCENARIO_CASE_TRANSITION_COVERAGE_MISSING") {
      const transitionRefs = String(indexText ?? "").split("|").filter(Boolean);
      if (!transitionRefs.length) throw new Error(`SCENARIO_CASE_CORRECTION_ISSUE_UNMAPPABLE:${code}`);
      for (const transitionRef of transitionRefs) {
        const obligation = record(obligationByRef.get(transitionRef));
        if (!obligation) throw new Error(`SCENARIO_CASE_CORRECTION_ISSUE_UNMAPPABLE:${code}`);
        const journeyMilestones = view.journeys.flatMap((journey) => journey.milestones
          .filter((milestone) => (Array.isArray(milestone.transition_refs) ? milestone.transition_refs : []).includes(transitionRef))
          .map((milestone) => ({ journey, milestone })));
        if (!journeyMilestones.length) throw new Error(`SCENARIO_CASE_CORRECTION_ISSUE_UNMAPPABLE:${code}`);
        const allowedCaseSteps = base.cases.flatMap((scenarioCase, caseIndex) => journeyMilestones.flatMap(({ journey, milestone }) => {
          if (scenarioCase.journey_ref !== journey.journey_ref || obligation.outcome === "exception" && scenarioCase.kind === "normal") return [];
          return scenarioCase.steps.flatMap((step) => step.journey_milestone_position === milestone.position
            ? [{ case_index: caseIndex, step_position: step.position }]
            : []);
        }));
        if (allowedCaseSteps.length) {
          targets.set(`transition:${transitionRef}`, {
            operation: "map-transition",
            transition_ref: transitionRef,
            allowed_case_steps: allowedCaseSteps,
            reason_codes: [issue],
            required_source_area_refs: uniqueSortedStrings(obligation.source_area_refs),
            required_source_refs: uniqueSortedStrings(obligation.source_refs_to_revisit),
          });
          continue;
        }
        const { journey, milestone } = journeyMilestones[0];
        const kind = journey.kind === "recovery" ? "recovery" : obligation.outcome === "exception" ? "exception" : "normal";
        const target = addCaseTarget(journey, kind, issue, obligation.source_area_refs, obligation.source_refs_to_revisit);
        target.required_transition_mappings = [
          ...(target.required_transition_mappings ?? []),
          { transition_ref: transitionRef, journey_milestone_position: milestone.position },
        ];
      }
      continue;
    }
    const fields = correctionFieldsByIssue.get(code);
    const caseIndex = Number(indexText);
    if (!fields || !Number.isInteger(caseIndex) || caseIndex < 0 || caseIndex >= base.cases.length) throw new Error(`SCENARIO_CASE_CORRECTION_ISSUE_UNMAPPABLE:${code}`);
    const scenarioCase = base.cases[caseIndex];
    let areaRefs = scenarioCaseAreaRefs(scenarioCase);
    if (fields.length === 1 && fields[0] === "classification_refs") {
      const perspective = code === "SCENARIO_CASE_PERSPECTIVE_MISSING" ? detail : classificationByRef.get(detail)?.perspective;
      const journey = journeyByRef.get(scenarioCase.journey_ref);
      const classificationAreas = (journey?.classification_refs ?? [])
        .filter((classificationRef) => !perspective || classificationByRef.get(classificationRef)?.perspective === perspective)
        .flatMap((classificationRef) => classificationByRef.get(classificationRef)?.source_area_refs ?? []);
      if (classificationAreas.length) areaRefs = uniqueSortedStrings(classificationAreas);
    }
    addUpdateTarget(caseIndex, fields, issue, areaRefs, correctionSourcesForAreas(view.source_area_support, areaRefs));
  }

  const gaps = Array.isArray(record(gapDocument)?.gaps) ? gapDocument.gaps : [];
  for (const gap of gaps) {
    const item = record(gap);
    if (!item || !safeText(item.gap_id) || !stringArray(item.affected_sections, { allowEmpty: false }) || !stringArray(item.source_refs_to_revisit, { allowEmpty: false })) {
      throw new Error("SCENARIO_CASE_CORRECTION_GAP_INVALID");
    }
    const gapSourceRefs = uniqueSortedStrings(item.source_refs_to_revisit);
    const gapAreaRefs = correctionAreasForSources(view.source_area_support, gapSourceRefs);
    for (const section of item.affected_sections) {
      const addition = section.match(/^(normal|boundary|exception|recovery)-cases$/);
      if (addition) {
        const kind = addition[1];
        for (const journey of view.journeys.filter((candidate) => kind === "recovery" ? candidate.kind === "recovery" : candidate.kind === "normal")) {
          const journeyAreas = uniqueSortedStrings(journey.milestones.flatMap((milestone) => milestone.source_area_refs));
          addCaseTarget(journey, kind, item.gap_id, gapAreaRefs.length ? gapAreaRefs : journeyAreas, gapSourceRefs.length ? gapSourceRefs : correctionSourcesForAreas(view.source_area_support, journeyAreas));
        }
        continue;
      }
      const update = section.match(/^(normal|boundary|exception|recovery)-case:([a-z_]+)$/);
      const field = update ? correctionFieldBySection.get(update[2]) : undefined;
      if (update && field) {
        base.cases.forEach((scenarioCase, caseIndex) => {
          if (record(scenarioCase)?.kind !== update[1]) return;
          const caseAreas = scenarioCaseAreaRefs(scenarioCase);
          const areaRefs = gapAreaRefs.length ? gapAreaRefs : caseAreas;
          addUpdateTarget(caseIndex, [field], item.gap_id, areaRefs, gapSourceRefs.length ? gapSourceRefs : correctionSourcesForAreas(view.source_area_support, areaRefs));
        });
        continue;
      }
      throw new Error(`SCENARIO_CASE_CORRECTION_SECTION_UNMAPPABLE:${section}`);
    }
  }

  const orderedTargets = [...targets.values()].map((target, index) => ({ target_ref: `CT${String(index + 1).padStart(3, "0")}`, ...target }));
  if (!orderedTargets.length) throw new Error("SCENARIO_CASE_CORRECTION_TARGET_MISSING");
  return {
    schema_version: 1,
    artifact_type: "scenario-case-correction-plan",
    base_artifact_hash: baseArtifactHash,
    source_snapshot_ref: base.source_snapshot_ref,
    targets: orderedTargets,
  };
}

export function applyScenarioCaseCorrectionPatch(baseArtifact, patch, plan) {
  const base = record(baseArtifact);
  const candidate = record(patch);
  const correctionPlan = record(plan);
  if (!base || !candidate || !correctionPlan
    || !exactObject(candidate, ["schema_version", "stage", "run_id", "work_id", "source_snapshot_ref", "source_root_hash", "base_artifact_hash", "changes"])
    || candidate.schema_version !== 1
    || candidate.stage !== "scenario-case-correction-patch"
    || candidate.run_id !== base.run_id
    || candidate.work_id !== base.work_id
    || candidate.source_snapshot_ref !== base.source_snapshot_ref
    || candidate.source_root_hash !== base.source_root_hash
    || !collection(candidate.changes)) throw new Error("SCENARIO_CASE_CORRECTION_PATCH_INVALID");
  if (candidate.base_artifact_hash !== correctionPlan.base_artifact_hash) throw new Error("SCENARIO_CASE_CORRECTION_BASE_MISMATCH");
  const targets = Array.isArray(correctionPlan.targets) ? correctionPlan.targets : [];
  const targetByRef = new Map(targets.map((target) => [record(target)?.target_ref, target]));
  const changeRefs = candidate.changes.map((change) => record(change)?.target_ref);
  if (changeRefs.some((targetRef) => !targetByRef.has(targetRef)) || new Set(changeRefs).size !== changeRefs.length) throw new Error("SCENARIO_CASE_CORRECTION_TARGET_INVALID");
  if (targets.some((target) => !changeRefs.includes(target.target_ref))) throw new Error("SCENARIO_CASE_CORRECTION_TARGET_MISSING");

  const artifact = structuredClone(base);
  const changedCaseIndexes = [];
  const targetCaseIndexes = [];
  const pendingTransitionMappings = [];
  for (const changeValue of candidate.changes) {
    const change = record(changeValue);
    const target = targetByRef.get(change.target_ref);
    const indexes = [];
    if (change.operation === "update-case") {
      if (target.operation !== "update-case" || !exactObject(change, ["target_ref", "operation", "fields"])) throw new Error(`SCENARIO_CASE_CORRECTION_OPERATION_INVALID:${change.target_ref}`);
      const fields = record(change.fields);
      if (!fields || Object.keys(fields).length === 0) throw new Error(`SCENARIO_CASE_CORRECTION_FIELD_MISSING:${change.target_ref}`);
      for (const [field, value] of Object.entries(fields)) {
        if (!target.allowed_fields.includes(field)) throw new Error(`SCENARIO_CASE_CORRECTION_FIELD_NOT_ALLOWED:${change.target_ref}:${field}`);
        if (!validScenarioCaseCorrectionField(field, value)) throw new Error(`SCENARIO_CASE_CORRECTION_FIELD_INVALID:${change.target_ref}:${field}`);
        artifact.cases[target.case_index][field] = structuredClone(value);
      }
      if (Object.keys(fields).every((field) => JSON.stringify(artifact.cases[target.case_index][field]) === JSON.stringify(base.cases[target.case_index][field]))) {
        throw new Error(`SCENARIO_CASE_CORRECTION_UNCHANGED:${change.target_ref}`);
      }
      indexes.push(target.case_index);
    } else if (change.operation === "map-transition") {
      if (target.operation !== "map-transition"
        || !exactObject(change, ["target_ref", "operation", "case_index", "step_position"])
        || !Number.isInteger(change.case_index)
        || !Number.isInteger(change.step_position)
        || !target.allowed_case_steps.some((entry) => entry.case_index === change.case_index && entry.step_position === change.step_position)) {
        throw new Error(`SCENARIO_CASE_CORRECTION_TRANSITION_MAPPING_NOT_ALLOWED:${change.target_ref}`);
      }
      pendingTransitionMappings.push({ target_ref: change.target_ref, transition_ref: target.transition_ref, case_index: change.case_index, step_position: change.step_position });
      indexes.push(change.case_index);
    } else if (change.operation === "add-cases") {
      if (target.operation !== "add-cases" || !exactObject(change, ["target_ref", "operation", "cases"]) || !collection(change.cases) || change.cases.length === 0) {
        throw new Error(`SCENARIO_CASE_CORRECTION_OPERATION_INVALID:${change.target_ref}`);
      }
      if (Number.isInteger(target.case_limit) && change.cases.length > target.case_limit) {
        throw new Error(`SCENARIO_CASE_CORRECTION_ADDITION_LIMIT_EXCEEDED:${change.target_ref}`);
      }
      const areasByMilestone = new Map((Array.isArray(target.milestone_source_area_refs) ? target.milestone_source_area_refs : [])
        .map((entry) => [record(entry)?.milestone_position, record(entry)?.source_area_refs]));
      for (const addition of change.cases) {
        if (!validScenarioCaseCorrectionAddition(addition)) {
          throw new Error(`SCENARIO_CASE_CORRECTION_ADDITION_INVALID:${change.target_ref}`);
        }
        const scenarioCase = {
          kind: target.kind,
          title: addition.title,
          journey_ref: target.journey_ref,
          classification_refs: structuredClone(addition.classification_refs),
          preconditions: structuredClone(addition.preconditions),
          variation: structuredClone(addition.variation),
          steps: addition.steps.map((step) => {
            const transitionRefs = (Array.isArray(target.required_transition_mappings) ? target.required_transition_mappings : [])
              .filter((mapping) => mapping.journey_milestone_position === step.journey_milestone_position)
              .map((mapping) => mapping.transition_ref);
            return {
              ...structuredClone(step),
              source_area_refs: structuredClone(areasByMilestone.get(step.journey_milestone_position)),
              ...(transitionRefs.length ? { transition_refs: transitionRefs } : {}),
            };
          }),
          terminal: structuredClone(addition.terminal),
        };
        if ((target.required_transition_mappings ?? []).some((mapping) => !scenarioCase.steps.some((step) => (
          step.journey_milestone_position === mapping.journey_milestone_position
            && step.transition_refs?.includes(mapping.transition_ref)
        )))) throw new Error(`SCENARIO_CASE_CORRECTION_ADDITION_INVALID:${change.target_ref}`);
        if (!validScenarioCase(scenarioCase)) throw new Error(`SCENARIO_CASE_CORRECTION_ADDITION_INVALID:${change.target_ref}`);
        indexes.push(artifact.cases.length);
        artifact.cases.push(scenarioCase);
      }
    } else if (change.operation === "defer") {
      if (!exactObject(change, ["target_ref", "operation", "unresolved"]) || !validScenarioCaseUnresolved(change.unresolved)) {
        throw new Error(`SCENARIO_CASE_CORRECTION_DEFER_INVALID:${change.target_ref}`);
      }
      artifact.unresolved.push(structuredClone(change.unresolved));
    } else {
      throw new Error(`SCENARIO_CASE_CORRECTION_OPERATION_INVALID:${change.target_ref}`);
    }
    changedCaseIndexes.push(...indexes);
    targetCaseIndexes.push({ target_ref: change.target_ref, case_indexes: indexes });
  }

  for (const mapping of pendingTransitionMappings) {
    const step = artifact.cases[mapping.case_index]?.steps?.find((entry) => entry.position === mapping.step_position);
    if (!step) throw new Error(`SCENARIO_CASE_CORRECTION_TRANSITION_MAPPING_NOT_ALLOWED:${mapping.target_ref}`);
    const existingRefs = Array.isArray(step.transition_refs) ? step.transition_refs : [];
    if (existingRefs.includes(mapping.transition_ref)) throw new Error(`SCENARIO_CASE_CORRECTION_TRANSITION_MAPPING_DUPLICATE:${mapping.target_ref}`);
    step.transition_refs = [...existingRefs, mapping.transition_ref];
  }

  const mappedCaseIndexes = new Set(targetCaseIndexes
    .filter((entry) => targetByRef.get(entry.target_ref)?.operation === "map-transition")
    .flatMap((entry) => entry.case_indexes));
  for (let index = 0; index < base.cases.length; index += 1) {
    const target = targets.find((entry) => entry.operation === "update-case" && entry.case_index === index);
    if (!target && !mappedCaseIndexes.has(index) && JSON.stringify(artifact.cases[index]) !== JSON.stringify(base.cases[index])) throw new Error(`SCENARIO_CASE_CORRECTION_OUTSIDE_TARGET:${index}`);
    if (target) {
      for (const field of Object.keys(base.cases[index])) {
        if (!target.allowed_fields.includes(field) && JSON.stringify(artifact.cases[index][field]) !== JSON.stringify(base.cases[index][field])) {
          throw new Error(`SCENARIO_CASE_CORRECTION_OUTSIDE_FIELD:${index}:${field}`);
        }
      }
    }
  }
  return { artifact, patch: structuredClone(candidate), changed_case_indexes: uniqueSortedNumbers(changedCaseIndexes), target_case_indexes: targetCaseIndexes };
}

const scenarioCaseIndexedValidationIssues = new Set([
  ...correctionFieldsByIssue.keys(),
  "SCENARIO_CASE_JOURNEY_KIND_INVALID",
  "SCENARIO_CASE_SOURCE_AREA_REF_INVALID",
]);

export function scenarioCaseCorrectionFailuresForIssues(validationIssues, application, plan, options = {}) {
  const targets = Array.isArray(record(plan)?.targets) ? plan.targets : [];
  const targetByRef = new Map(targets.map((target) => [target.target_ref, target]));
  const caseTargetRefs = new Map();
  for (const entry of Array.isArray(record(application)?.target_case_indexes) ? application.target_case_indexes : []) {
    for (const caseIndex of Array.isArray(record(entry)?.case_indexes) ? entry.case_indexes : []) {
      caseTargetRefs.set(caseIndex, [...(caseTargetRefs.get(caseIndex) ?? []), entry.target_ref]);
    }
  }
  const artifactCases = Array.isArray(record(application)?.artifact?.cases) ? application.artifact.cases : [];
  const knownClassificationRefs = options.knownClassificationRefs instanceof Set ? options.knownClassificationRefs : new Set();
  const failed = new Map();
  const addFailure = (targetRef, issue, caseIndex = null, rejectAll = false) => {
    const failure = failed.get(targetRef) ?? { target_ref: targetRef, failed_case_indexes: [], issues: [], reject_all: false };
    if (Number.isInteger(caseIndex)) failure.failed_case_indexes = uniqueSortedNumbers([...failure.failed_case_indexes, caseIndex]);
    failure.issues = uniqueSortedStrings([...failure.issues, issue]);
    failure.reject_all ||= rejectAll;
    failed.set(targetRef, failure);
  };
  for (const issue of validationIssues) {
    const [code, first, second] = String(issue).split(":");
    if (isFailClosedScenarioCaseIssue(issue)
      && !(code === "SCENARIO_CASE_CLASSIFICATION_REF_INVALID" && knownClassificationRefs.has(second))) {
      throw new Error(code);
    }
    if (scenarioCaseIndexedValidationIssues.has(code)) {
      const caseIndex = Number(first);
      const fields = correctionFieldsByIssue.get(code) ?? [];
      const matching = (caseTargetRefs.get(caseIndex) ?? [])
        .map((targetRef) => targetByRef.get(targetRef))
        .filter((target) => target?.operation === "add-cases"
          || target?.operation === "update-case" && fields.some((field) => target.allowed_fields.includes(field)));
      if (matching.length !== 1) throw new Error(`SCENARIO_CASE_CORRECTION_ISSUE_UNMAPPABLE:${code}`);
      addFailure(matching[0].target_ref, issue, caseIndex);
      continue;
    }
    if (code === "SCENARIO_CASE_KIND_MISSING") {
      const matching = targets.filter((target) => target.operation === "add-cases" && target.kind === first);
      if (!matching.length) throw new Error(`SCENARIO_CASE_CORRECTION_ISSUE_UNMAPPABLE:${code}`);
      matching.forEach((target) => addFailure(target.target_ref, issue, null, true));
      continue;
    }
    if (code === "SCENARIO_CASE_JOURNEY_KIND_MISSING") {
      const matching = targets.filter((target) => target.operation === "add-cases" && target.journey_ref === first && target.kind === second);
      if (!matching.length) throw new Error(`SCENARIO_CASE_CORRECTION_ISSUE_UNMAPPABLE:${code}`);
      matching.forEach((target) => addFailure(target.target_ref, issue, null, true));
      continue;
    }
    if (code === "SCENARIO_CASE_CLASSIFICATION_COVERAGE_MISSING") {
      const matching = targets.filter((target) => target.journey_ref === first && (
        target.operation === "add-cases"
        || target.operation === "update-case"
          && target.allowed_fields.includes("classification_refs")
          && (caseTargetRefs.get(target.case_index) ?? []).includes(target.target_ref)
      ));
      if (!matching.length) throw new Error(`SCENARIO_CASE_CORRECTION_ISSUE_UNMAPPABLE:${code}`);
      matching.forEach((target) => addFailure(target.target_ref, issue, null, target.operation !== "add-cases"));
      continue;
    }
    if (code === "SCENARIO_CASE_DUPLICATE") {
      const signatures = new Map();
      artifactCases.forEach((scenarioCase, caseIndex) => {
        const key = `${record(scenarioCase)?.journey_ref}:${record(scenarioCase)?.kind}:${record(scenarioCase)?.title}`;
        signatures.set(key, [...(signatures.get(key) ?? []), caseIndex]);
      });
      const matching = [...signatures.values()].filter((caseIndexes) => caseIndexes.length > 1)
        .flatMap((caseIndexes) => caseIndexes.flatMap((caseIndex) => (caseTargetRefs.get(caseIndex) ?? [])
          .filter((targetRef) => {
            const target = targetByRef.get(targetRef);
            return target?.operation === "add-cases" || target?.operation === "update-case" && target.allowed_fields.includes("title");
          })
          .map((targetRef) => ({ caseIndex, targetRef }))));
      if (!matching.length) throw new Error(`SCENARIO_CASE_CORRECTION_ISSUE_UNMAPPABLE:${code}`);
      matching.forEach(({ targetRef, caseIndex }) => addFailure(targetRef, issue, caseIndex));
      continue;
    }
    throw new Error(`SCENARIO_CASE_CORRECTION_ISSUE_UNMAPPABLE:${code}`);
  }
  return targets.map((target) => failed.get(target.target_ref)).filter(Boolean);
}

export function scenarioCaseCorrectionTargetRefsForIssues(validationIssues, application, plan, options = {}) {
  return scenarioCaseCorrectionFailuresForIssues(validationIssues, application, plan, options).map((failure) => failure.target_ref);
}

const recoverableScenarioCaseCorrectionCompileIssues = new Set([
  "SCENARIO_CASE_CORRECTION_OPERATION_INVALID",
  "SCENARIO_CASE_CORRECTION_FIELD_MISSING",
  "SCENARIO_CASE_CORRECTION_FIELD_NOT_ALLOWED",
  "SCENARIO_CASE_CORRECTION_FIELD_INVALID",
  "SCENARIO_CASE_CORRECTION_UNCHANGED",
  "SCENARIO_CASE_CORRECTION_ADDITION_INVALID",
  "SCENARIO_CASE_CORRECTION_ADDITION_LIMIT_EXCEEDED",
  "SCENARIO_CASE_CORRECTION_DEFER_INVALID",
  "SCENARIO_CASE_CORRECTION_TRANSITION_MAPPING_NOT_ALLOWED",
  "SCENARIO_CASE_CORRECTION_TRANSITION_MAPPING_DUPLICATE",
]);

export function scenarioCaseCorrectionCompileFailures(error, baseArtifact, patch, plan) {
  const message = error instanceof Error ? error.message : String(error);
  const [code] = message.split(":");
  const targets = Array.isArray(record(plan)?.targets) ? plan.targets : [];
  const changes = Array.isArray(record(patch)?.changes) ? patch.changes : [];
  const changeRefs = changes.map((change) => record(change)?.target_ref);
  const knownRefs = new Set(targets.map((target) => target.target_ref));
  if (["SCENARIO_CASE_CORRECTION_PATCH_INVALID", "SCENARIO_CASE_CORRECTION_BASE_MISMATCH", "SCENARIO_CASE_CORRECTION_TARGET_INVALID"].includes(code)
    || changeRefs.some((targetRef) => !knownRefs.has(targetRef))
    || new Set(changeRefs).size !== changeRefs.length) throw error;

  const changeByRef = new Map(changes.map((change) => [record(change)?.target_ref, change]));
  const failures = [];
  for (const target of targets) {
    const change = changeByRef.get(target.target_ref);
    if (!change) {
      failures.push({ target_ref: target.target_ref, failed_case_indexes: [], issues: ["SCENARIO_CASE_CORRECTION_TARGET_MISSING"], reject_all: true });
      continue;
    }
    try {
      applyScenarioCaseCorrectionPatch(baseArtifact, { ...structuredClone(patch), changes: [structuredClone(change)] }, { ...structuredClone(plan), targets: [structuredClone(target)] });
    } catch (targetError) {
      const targetMessage = targetError instanceof Error ? targetError.message : String(targetError);
      const [targetCode, targetRef] = targetMessage.split(":");
      if (!recoverableScenarioCaseCorrectionCompileIssues.has(targetCode) || targetRef !== target.target_ref) throw targetError;
      failures.push({ target_ref: target.target_ref, failed_case_indexes: [], issues: [targetMessage], reject_all: true });
    }
  }
  if (!failures.length) throw error;
  return failures;
}

export function isPersistableScenarioCaseCorrectionPatch(patch) {
  const candidate = record(patch);
  if (!candidate || !Array.isArray(candidate.changes)
    || ![candidate.run_id, candidate.work_id, candidate.source_snapshot_ref, candidate.source_root_hash, candidate.base_artifact_hash].every((value) => safeText(value))) return false;
  return candidate.changes.every((changeValue) => {
    const change = record(changeValue);
    if (!change || !safeText(change.target_ref)) return false;
    if (change.operation === "update-case") {
      const fields = record(change.fields);
      return fields && Object.entries(fields).every(([field, value]) => scenarioCaseCorrectionFields.includes(field) && validScenarioCaseCorrectionField(field, value));
    }
    if (change.operation === "map-transition") return Number.isInteger(change.case_index) && Number.isInteger(change.step_position);
    if (change.operation === "add-cases") return collection(change.cases) && change.cases.length > 0 && change.cases.every(validScenarioCaseCorrectionAddition);
    if (change.operation === "defer") return validScenarioCaseUnresolved(change.unresolved);
    return false;
  });
}

export function retainSuccessfulScenarioCaseCorrections(baseArtifact, patch, plan, failures) {
  const targets = Array.isArray(record(plan)?.targets) ? plan.targets : [];
  const failureByRef = new Map();
  for (const failureValue of failures) {
    const failure = typeof failureValue === "string"
      ? { target_ref: failureValue, failed_case_indexes: [], issues: [], reject_all: true }
      : record(failureValue);
    const previous = failureByRef.get(failure?.target_ref);
    failureByRef.set(failure?.target_ref, previous ? {
      target_ref: failure.target_ref,
      failed_case_indexes: uniqueSortedNumbers([...(previous.failed_case_indexes ?? []), ...(failure.failed_case_indexes ?? [])]),
      issues: uniqueSortedStrings([...(previous.issues ?? []), ...(failure.issues ?? [])]),
      reject_all: previous.reject_all === true || failure.reject_all === true,
    } : failure);
  }
  if ([...failureByRef.keys()].some((targetRef) => !targets.some((target) => target.target_ref === targetRef))) throw new Error("SCENARIO_CASE_CORRECTION_TARGET_INVALID");
  const changeByRef = new Map(patch.changes.map((change) => [change.target_ref, change]));
  let nextCaseIndex = Array.isArray(record(baseArtifact)?.cases) ? baseArtifact.cases.length : 0;
  const applicationIndexes = new Map();
  for (const change of patch.changes) {
    const target = targets.find((entry) => entry.target_ref === change.target_ref);
    if (change.operation === "update-case" && target?.operation === "update-case") applicationIndexes.set(change.target_ref, [target.case_index]);
    if (change.operation === "map-transition" && target?.operation === "map-transition") applicationIndexes.set(change.target_ref, [change.case_index]);
    if (change.operation === "add-cases" && Array.isArray(change.cases)) {
      applicationIndexes.set(change.target_ref, change.cases.map((_, index) => nextCaseIndex + index));
      nextCaseIndex += change.cases.length;
    }
    if (change.operation === "defer") applicationIndexes.set(change.target_ref, []);
  }
  const successfulTargets = [];
  const successfulChanges = [];
  const remainingTargets = [];

  for (const target of targets) {
    const failure = record(failureByRef.get(target.target_ref));
    const change = structuredClone(changeByRef.get(target.target_ref));
    if (!failure) {
      successfulTargets.push(target);
      successfulChanges.push(change);
      continue;
    }
    const remainingTarget = {
      ...structuredClone(target),
      reason_codes: uniqueSortedStrings([...(target.reason_codes ?? []), ...(failure.issues ?? [])]),
    };
    if (target.operation === "add-cases") {
      const failedCaseCount = Array.isArray(failure.failed_case_indexes) ? failure.failed_case_indexes.length : 0;
      remainingTarget.case_limit = failure.reject_all === true
        ? Math.max(1, Array.isArray(change?.cases) ? change.cases.length : target.case_limit ?? 1)
        : Math.max(1, failedCaseCount);
    }
    remainingTargets.push(remainingTarget);
    if (target.operation !== "add-cases" || failure.reject_all === true) continue;
    const failedIndexes = new Set(Array.isArray(failure.failed_case_indexes) ? failure.failed_case_indexes : []);
    const retainedCases = change.cases.filter((_, localIndex) => !failedIndexes.has(applicationIndexes.get(target.target_ref)?.[localIndex]));
    if (!retainedCases.length) continue;
    successfulTargets.push(target);
    successfulChanges.push({ ...change, cases: retainedCases });
  }

  const remainingPlan = { ...structuredClone(plan), targets: remainingTargets };
  if (!successfulTargets.length) return { artifact: structuredClone(baseArtifact), changed_case_indexes: [], target_case_indexes: [], remaining_plan: remainingPlan };
  const successfulPatch = { ...structuredClone(patch), changes: successfulChanges };
  const application = applyScenarioCaseCorrectionPatch(baseArtifact, successfulPatch, { ...structuredClone(plan), targets: successfulTargets });
  return { ...application, remaining_plan: remainingPlan };
}

function uniqueSortedNumbers(values) {
  return [...new Set(values.filter((value) => Number.isInteger(value)))].sort((left, right) => left - right);
}

export function replayScenarioCaseCorrectionAttempts({ baseArtifact, initialPlan, attempts, artifactHash, knownClassificationRefs = new Set() }) {
  if (!record(baseArtifact) || !record(initialPlan) || !Array.isArray(attempts) || attempts.length === 0 || typeof artifactHash !== "function") {
    throw new Error("SCENARIO_CASE_CORRECTION_RESUME_INVALID");
  }
  let currentArtifact = structuredClone(baseArtifact);
  let currentPlan = structuredClone(initialPlan);
  const changedCaseIndexes = new Set();

  for (const attemptValue of attempts) {
    const attempt = record(attemptValue);
    const validation = record(attempt?.validation);
    if (!attempt || !record(attempt.patch) || !record(attempt.retryPlan)
      || validation?.pass !== false
      || !stringArray(validation?.issues, { allowEmpty: false })
      || !stringArray(validation?.failed_target_refs, { allowEmpty: false })
      || validation?.reject_all_targets !== undefined && typeof validation.reject_all_targets !== "boolean"
      || !Array.isArray(validation?.failed_case_indexes)
      || validation.failed_case_indexes.some((caseIndex) => !Number.isInteger(caseIndex) || caseIndex < 0)) {
      throw new Error("SCENARIO_CASE_CORRECTION_RESUME_INVALID");
    }

    let application;
    let failures;
    try {
      application = applyScenarioCaseCorrectionPatch(currentArtifact, attempt.patch, currentPlan);
      failures = scenarioCaseCorrectionFailuresForIssues(validation.issues, application, currentPlan, { knownClassificationRefs });
    } catch (error) {
      const code = error instanceof Error ? error.message.split(":", 1)[0] : "";
      if (!validation.issues.includes(code)) throw new Error("SCENARIO_CASE_CORRECTION_RESUME_INVALID");
      try {
        failures = scenarioCaseCorrectionCompileFailures(error, currentArtifact, attempt.patch, currentPlan);
      } catch {
        throw new Error("SCENARIO_CASE_CORRECTION_RESUME_INVALID");
      }
    }

    if (validation.reject_all_targets === true) {
      failures = [...failures, ...currentPlan.targets.map((target) => target.target_ref)];
    }

    const failedTargetRefs = uniqueSortedStrings(failures.map((failure) => typeof failure === "string" ? failure : failure.target_ref));
    const failedCaseIndexes = uniqueSortedNumbers(failures.flatMap((failure) => typeof failure === "string" ? [] : failure.failed_case_indexes ?? []));
    if (!sameStringSet(failedTargetRefs, validation.failed_target_refs)
      || !sameStringSet(failedCaseIndexes.map(String), uniqueSortedNumbers(validation.failed_case_indexes).map(String))) {
      throw new Error("SCENARIO_CASE_CORRECTION_RESUME_INVALID");
    }
    const retained = retainSuccessfulScenarioCaseCorrections(currentArtifact, attempt.patch, currentPlan, failures);
    retained.changed_case_indexes.forEach((caseIndex) => changedCaseIndexes.add(caseIndex));
    const nextHash = artifactHash(retained.artifact);
    if (!safeText(nextHash)) throw new Error("SCENARIO_CASE_CORRECTION_RESUME_INVALID");
    const nextPlan = { ...retained.remaining_plan, base_artifact_hash: nextHash };
    if (JSON.stringify(nextPlan) !== JSON.stringify(attempt.retryPlan)) throw new Error("SCENARIO_CASE_CORRECTION_RESUME_INVALID");
    currentArtifact = retained.artifact;
    currentPlan = nextPlan;
  }

  return {
    artifact: currentArtifact,
    remainingPlan: currentPlan,
    changedCaseIndexes: uniqueSortedNumbers([...changedCaseIndexes]),
  };
}

export function validateScenarioCaseInputs({ runId, sourceArtifactHash, sourceArtifact, classificationArtifactHash, classificationArtifact, journeyArtifactHash, journeyArtifact, journeyValidation, gapDocument, inventory }) {
  const source = record(sourceArtifact);
  const classification = record(classificationArtifact);
  const journey = record(journeyArtifact);
  const journeyCheck = record(journeyValidation);
  const sourceProvenance = record(source?.provenance);
  const classificationProvenance = record(classification?.provenance);
  const journeyProvenance = record(journey?.provenance);
  const semanticJourney = record(journey?.journey);
  const gaps = record(gapDocument);
  const reviewedArtifact = record(gaps?.reviewed_artifact);
  const gapEntries = Array.isArray(gaps?.gaps) ? gaps.gaps : [];
  const sourceInventory = record(inventory);
  const inventoryFiles = Array.isArray(sourceInventory?.files) ? sourceInventory.files : [];
  const inventoryRefs = new Set(inventoryFiles.map((file) => record(file)?.source_ref).filter((sourceRef) => typeof sourceRef === "string"));
  const journeyEntries = Array.isArray(semanticJourney?.journeys) ? semanticJourney.journeys : [];
  const evidenceCatalog = Array.isArray(journey?.evidence_catalog) ? journey.evidence_catalog : [];
  const evidenceRefs = evidenceCatalog.map((entry) => record(entry)?.evidence_ref);
  const evidenceRefSet = new Set(evidenceRefs);
  const bindings = Array.isArray(journey?.journey_evidence_bindings) ? journey.journey_evidence_bindings : [];
  const issues = [];

  const validChain = source?.schema_version === 1
    && source?.run_id === runId
    && source?.artifact_status === "locally-validated-unregistered-probe"
    && classification?.schema_version === 1
    && classification?.run_id === runId
    && classification?.artifact_status === "locally-validated-unregistered-probe"
    && classificationProvenance?.extends_artifact_id === "02-source-gap-review"
    && classificationProvenance?.extends_artifact_hash === sourceArtifactHash
    && journey?.schema_version === 1
    && journey?.run_id === runId
    && journey?.artifact_status === "locally-validated-unregistered-probe"
    && journeyProvenance?.project_id === sourceInventory?.project_id
    && journeyProvenance?.source_snapshot_id === sourceInventory?.source_snapshot_id
    && journeyProvenance?.source_root_hash === sourceInventory?.source_root_hash
    && journeyProvenance?.extends_artifact_id === "03-business-classification"
    && journeyProvenance?.extends_artifact_hash === classificationArtifactHash
    && journeyProvenance?.source_basis_artifact_id === "02-source-gap-review"
    && journeyProvenance?.source_basis_artifact_hash === sourceArtifactHash
    && semanticJourney?.stage === "user-journeys"
    && semanticJourney?.source_snapshot_ref === sourceInventory?.source_snapshot_id
    && semanticJourney?.source_root_hash === sourceInventory?.source_root_hash
    && semanticJourney?.extends_artifact_hash === classificationArtifactHash
    && semanticJourney?.source_basis_artifact_hash === sourceArtifactHash
    && journeyEntries.length > 0
    && journeyCheck?.pass === true
    && journeyCheck?.validation_scope === "local-probe-contract-only"
    && journeyCheck?.product_stage_acceptance === "not-attempted"
    && journeyCheck?.source_artifact_hash === sourceArtifactHash
    && journeyCheck?.classification_artifact_hash === classificationArtifactHash
    && sourceProvenance?.source_snapshot_id === sourceInventory?.source_snapshot_id
    && sourceProvenance?.source_root_hash === sourceInventory?.source_root_hash
    && inventoryFiles.length > 0;
  if (!validChain) issues.push("SCENARIO_CASE_INPUT_INVALID");
  if (journeyCheck?.artifact_hash !== journeyArtifactHash) issues.push("SCENARIO_CASE_JOURNEY_HASH_MISMATCH");

  const validGapDocument = exactObject(gaps, ["schema_version", "artifact_type", "run_id", "source_snapshot_ref", "source_root_hash", "reviewed_artifact", "golden_derived", "decision", "gaps", "generator_exclusions"])
    && gaps.schema_version === 1
    && gaps.artifact_type === "orchestrator-source-gaps"
    && gaps.run_id === runId
    && gaps.source_snapshot_ref === sourceInventory?.source_snapshot_id
    && gaps.source_root_hash === sourceInventory?.source_root_hash
    && exactObject(reviewedArtifact, ["artifact_id", "content_hash", "status"])
    && reviewedArtifact.artifact_id === "04-user-journeys"
    && reviewedArtifact.status === "locally-validated-unregistered-probe"
    && gaps.golden_derived === false
    && gaps.decision === "carry-forward-semantic-question"
    && stringArray(gaps.generator_exclusions)
    && gapEntries.length > 0
    && new Set(gapEntries.map((gap) => record(gap)?.gap_id)).size === gapEntries.length
    && gapEntries.every((gap) => {
      const item = record(gap);
      return exactObject(item, ["gap_id", "kind", "affected_sections", "required_change", "source_refs_to_revisit"])
        && safeText(item.gap_id)
        && safeText(item.kind)
        && stringArray(item.affected_sections, { allowEmpty: false })
        && safeText(item.required_change)
        && stringArray(item.source_refs_to_revisit, { allowEmpty: false });
    });
  if (!validGapDocument) issues.push("SCENARIO_CASE_GAP_INVALID");
  if (reviewedArtifact?.content_hash !== journeyArtifactHash) issues.push("SCENARIO_CASE_GAP_HASH_MISMATCH");

  if (new Set(evidenceRefs).size !== evidenceRefs.length
    || evidenceRefs.some((evidenceRef) => !safeText(evidenceRef))
    || !sameStringSet(evidenceRefs, journeyProvenance?.granted_evidence_refs)) {
    issues.push("SCENARIO_CASE_JOURNEY_EVIDENCE_CATALOG_MISMATCH");
  }
  const expectedInheritedRefs = [...new Set([
    ...(Array.isArray(sourceProvenance?.inherited_evidence_refs) ? sourceProvenance.inherited_evidence_refs : []),
    ...(Array.isArray(sourceProvenance?.granted_evidence_refs) ? sourceProvenance.granted_evidence_refs : []),
    ...(Array.isArray(classificationProvenance?.granted_evidence_refs) ? classificationProvenance.granted_evidence_refs : []),
  ])];
  if (!sameStringSet(expectedInheritedRefs, journeyProvenance?.inherited_evidence_refs)) issues.push("SCENARIO_CASE_INHERITED_EVIDENCE_MISMATCH");
  if (bindings.length !== journeyEntries.length) issues.push("SCENARIO_CASE_JOURNEY_EVIDENCE_BINDING_INVALID");
  bindings.forEach((binding, index) => {
    const item = record(binding);
    const journeyEntry = record(journeyEntries[index]);
    const milestones = Array.isArray(journeyEntry?.milestones) ? journeyEntry.milestones : [];
    const milestoneBindings = Array.isArray(item?.milestones) ? item.milestones : [];
    if (!exactObject(item, ["journey_position", "source_thread_ref", "evidence_refs", "milestones"])
      || item.journey_position !== index
      || item.source_thread_ref !== journeyEntry?.source_thread_ref
      || !stringArray(item.evidence_refs, { allowEmpty: false })
      || item.evidence_refs.some((ref) => !evidenceRefSet.has(ref))
      || milestoneBindings.length !== milestones.length
      || milestoneBindings.some((milestoneBinding, milestoneIndex) => {
        const bound = record(milestoneBinding);
        const milestoneEntry = record(milestones[milestoneIndex]);
        return !exactObject(bound, ["milestone_position", "source_area_refs", "evidence_refs"])
          || bound.milestone_position !== milestoneEntry?.position
          || !sameStringSet(bound.source_area_refs, milestoneEntry?.source_area_refs)
          || !stringArray(bound.evidence_refs, { allowEmpty: false })
          || bound.evidence_refs.some((ref) => !evidenceRefSet.has(ref));
      })) {
      issues.push(`SCENARIO_CASE_JOURNEY_EVIDENCE_BINDING_INVALID:${index}`);
    }
  });
  for (const sourceRef of scenarioCasePermittedSourceRefs(sourceArtifact, classificationArtifact, journeyArtifact, gapDocument)) {
    if (!inventoryRefs.has(sourceRef)) issues.push(`SCENARIO_CASE_INPUT_SOURCE_REF_INVALID:${sourceRef}`);
  }
  return [...new Set(issues)];
}

export function createScenarioCaseStageGuard(sourceArtifact, gapDocument, sourceBytesByRef, options = {}) {
  const maxClosureCalls = options.maxClosureCalls ?? 10;
  const maxGrantedBytes = options.maxGrantedBytes ?? 500_000;
  const maxArtifactWriteAttempts = options.maxArtifactWriteAttempts ?? 3;
  const permittedSourceRefs = scenarioCasePermittedSourceRefs(sourceArtifact, options.classificationArtifact, options.journeyArtifact, gapDocument);
  const sourcesByArea = businessClassificationEvidenceSourcesByArea(sourceArtifact);
  const correctionTargets = Array.isArray(record(options.correctionPlan)?.targets) ? options.correctionPlan.targets : null;
  const gapSourceRefs = uniqueSortedStrings(correctionTargets
    ? correctionTargets.flatMap((target) => Array.isArray(record(target)?.required_source_refs) ? target.required_source_refs : [])
    : collectStringValues(Array.isArray(record(gapDocument)?.gaps) ? gapDocument.gaps : [], "source_refs_to_revisit"));
  const correctionAreaRefs = correctionTargets
    ? uniqueSortedStrings(correctionTargets.flatMap((target) => Array.isArray(record(target)?.required_source_area_refs) ? target.required_source_area_refs : []))
    : null;
  const requiredArtifactIds = new Set([...scenarioCaseInputArtifactIds, ...(options.additionalInputArtifactIds ?? [])]);
  const artifactReads = new Set();
  const sourceReads = new Set();
  let closureCalls = 0;
  let closureCompletions = 0;
  let pendingSourceRefs;
  let cumulativeGrantedBytes = 0;
  let artifactWriteAttempts = 0;
  let artifactWrites = 0;
  let fatalError;

  const reject = (code) => {
    fatalError ??= code;
    throw new Error(code);
  };

  return {
    fail(code) {
      fatalError ??= code;
    },
    recordArtifactRead(artifactId) {
      if (fatalError) throw new Error(fatalError);
      if (!requiredArtifactIds.has(artifactId)) return reject("AGENTIC_ARTIFACT_NOT_FOUND");
      artifactReads.add(artifactId);
    },
    requireArtifactRefresh(artifactIds) {
      if (fatalError) throw new Error(fatalError);
      if (!Array.isArray(artifactIds) || artifactIds.some((artifactId) => !requiredArtifactIds.has(artifactId))) return reject("AGENTIC_ARTIFACT_NOT_FOUND");
      artifactIds.forEach((artifactId) => artifactReads.delete(artifactId));
    },
    requireSourceRefresh(sourceRefs) {
      if (fatalError) throw new Error(fatalError);
      if (!Array.isArray(sourceRefs) || sourceRefs.some((sourceRef) => !permittedSourceRefs.has(sourceRef))) return reject("AGENTIC_SOURCE_SCOPE_VIOLATION");
      sourceRefs.forEach((sourceRef) => sourceReads.delete(sourceRef));
    },
    beginClosure(sourceRefs) {
      if (fatalError) throw new Error(fatalError);
      if (pendingSourceRefs) return reject("AGENTIC_CLOSURE_NOT_COMPLETED");
      if (![...requiredArtifactIds].every((artifactId) => artifactReads.has(artifactId))) return reject("SCENARIO_CASE_INPUTS_NOT_READ");
      const uniqueRefs = [...new Set(sourceRefs)];
      if (!uniqueRefs.length || uniqueRefs.some((sourceRef) => !permittedSourceRefs.has(sourceRef) || !sourceBytesByRef.has(sourceRef))) return reject("AGENTIC_SOURCE_SCOPE_VIOLATION");
      const requestedBytes = uniqueRefs.reduce((total, sourceRef) => total + sourceBytesByRef.get(sourceRef), 0);
      if (closureCalls + 1 > maxClosureCalls || cumulativeGrantedBytes + requestedBytes > maxGrantedBytes) return reject("AGENTIC_SURVEY_BUDGET_EXCEEDED");
      closureCalls += 1;
      cumulativeGrantedBytes += requestedBytes;
      pendingSourceRefs = new Set(uniqueRefs);
    },
    completeClosure(sourceRefs) {
      if (fatalError) throw new Error(fatalError);
      if (!pendingSourceRefs || !Array.isArray(sourceRefs)) return reject("AGENTIC_CLOSURE_NOT_COMPLETED");
      const uniqueRefs = [...new Set(sourceRefs)];
      if (uniqueRefs.some((sourceRef) => !pendingSourceRefs.has(sourceRef) || !permittedSourceRefs.has(sourceRef) || !sourceBytesByRef.has(sourceRef))) return reject("AGENTIC_SOURCE_SCOPE_VIOLATION");
      uniqueRefs.forEach((sourceRef) => sourceReads.add(sourceRef));
      pendingSourceRefs = undefined;
      closureCompletions += 1;
    },
    beginArtifactWrite(cases) {
      if (artifactWrites > 0) throw new Error("AGENTIC_ARTIFACT_WRITE_DUPLICATE");
      if (fatalError) throw new Error(fatalError);
      if (![...requiredArtifactIds].every((artifactId) => artifactReads.has(artifactId))) throw new Error("SCENARIO_CASE_INPUTS_NOT_READ");
      if (closureCalls === 0) throw new Error("AGENTIC_SOURCE_TOOLS_NOT_USED");
      if (artifactWriteAttempts >= maxArtifactWriteAttempts) return reject("AGENTIC_ARTIFACT_WRITE_ATTEMPTS_EXCEEDED");
      const sourceAreaRefs = correctionAreaRefs ?? (Array.isArray(cases) ? cases : []).flatMap((scenarioCase) => (
        Array.isArray(record(scenarioCase)?.steps)
          ? scenarioCase.steps.flatMap((step) => Array.isArray(record(step)?.source_area_refs) ? step.source_area_refs : [])
          : []
      ));
      for (const sourceAreaRef of sourceAreaRefs) {
        if (!sourcesByArea.has(sourceAreaRef)) return reject(`SCENARIO_CASE_SOURCE_AREA_REF_INVALID:${sourceAreaRef}`);
        if (![...sourcesByArea.get(sourceAreaRef)].some((sourceRef) => sourceReads.has(sourceRef))) throw new Error(`SCENARIO_CASE_AREA_SOURCE_NOT_READ:${sourceAreaRef}`);
      }
      for (const sourceRef of gapSourceRefs) if (!sourceReads.has(sourceRef)) throw new Error(`SCENARIO_CASE_GAP_SOURCE_NOT_READ:${sourceRef}`);
      artifactWriteAttempts += 1;
    },
    completeArtifactWrite() {
      if (fatalError) throw new Error(fatalError);
      if (artifactWrites > 0) throw new Error("AGENTIC_ARTIFACT_WRITE_DUPLICATE");
      if (artifactWriteAttempts === 0) throw new Error("AGENTIC_ARTIFACT_WRITE_NOT_STARTED");
      artifactWrites += 1;
    },
    summary() {
      return {
        artifact_reads: [...artifactReads],
        source_refs_read: [...sourceReads],
        gap_source_refs_read: gapSourceRefs.filter((sourceRef) => sourceReads.has(sourceRef)),
        closure_calls: closureCalls,
        closure_completions: closureCompletions,
        cumulative_granted_bytes: cumulativeGrantedBytes,
        artifact_write_attempts: artifactWriteAttempts,
        artifact_writes: artifactWrites,
        fatal_error: fatalError ?? null,
        max_closure_calls: maxClosureCalls,
        max_granted_bytes: maxGrantedBytes,
        max_artifact_write_attempts: maxArtifactWriteAttempts,
      };
    },
  };
}

const scenarioCaseKinds = new Set(["normal", "boundary", "exception", "recovery"]);

function validScenarioCaseStep(value) {
  const item = record(value);
  return exactObject(item, ["position", "journey_milestone_position", "action", "observable_outcome", "source_area_refs"], ["transition_refs"])
    && Number.isInteger(item?.position)
    && item.position > 0
    && Number.isInteger(item?.journey_milestone_position)
    && item.journey_milestone_position > 0
    && safeText(item?.action)
    && safeText(item?.observable_outcome)
    && stringArray(item?.source_area_refs, { allowEmpty: false })
    && (item.transition_refs === undefined || stringArray(item.transition_refs, { allowEmpty: false }));
}

function validScenarioCaseVariation(value) {
  const item = record(value);
  return exactObject(item, ["milestone_position", "condition", "expected_outcome", "recovery_action"])
    && Number.isInteger(item?.milestone_position)
    && item.milestone_position > 0
    && safeText(item?.condition)
    && safeText(item?.expected_outcome)
    && (item.recovery_action === null || safeText(item.recovery_action));
}

function validScenarioCaseTerminal(value) {
  const item = record(value);
  return exactObject(item, ["kind", "expected_result", "final_step_position"])
    && ["business-result-and-exit", "expected-failure"].includes(item?.kind)
    && safeText(item?.expected_result)
    && Number.isInteger(item?.final_step_position)
    && item.final_step_position > 0;
}

function validScenarioCase(value) {
  const item = record(value);
  return exactObject(item, ["kind", "title", "journey_ref", "classification_refs", "preconditions", "variation", "steps", "terminal"], ["status"])
    && scenarioCaseKinds.has(item?.kind)
    && safeText(item?.title)
    && safeText(item?.journey_ref)
    && stringArray(item?.classification_refs, { allowEmpty: false })
    && stringArray(item?.preconditions, { allowEmpty: false })
    && ((item.kind === "normal" && item.variation === null) || (item.kind !== "normal" && validScenarioCaseVariation(item.variation)))
    && collection(item?.steps)
    && item.steps.length >= 2
    && item.steps.every(validScenarioCaseStep)
    && validScenarioCaseTerminal(item?.terminal)
    && (item.status === undefined || ["draft", "unresolved"].includes(item.status));
}

function validScenarioCaseUnresolved(value) {
  const item = record(value);
  return exactObject(item, ["description", "reason", "journey_refs", "classification_refs", "source_area_refs", "source_refs_to_revisit"], ["transition_refs"])
    && safeText(item?.description)
    && safeText(item?.reason)
    && stringArray(item?.journey_refs)
    && stringArray(item?.classification_refs)
    && stringArray(item?.source_area_refs)
    && stringArray(item?.source_refs_to_revisit, { allowEmpty: false })
    && (item.transition_refs === undefined || stringArray(item.transition_refs, { allowEmpty: false }));
}

export function auditScenarioCaseTransitionLinkage(scenarioCaseArtifact, journeyArtifact, transitionView) {
  const obligations = Array.isArray(record(transitionView)?.obligations) ? transitionView.obligations : [];
  const obligationByRef = new Map(obligations.map((obligation) => [record(obligation)?.transition_ref, obligation]));
  const semanticJourney = record(journeyArtifact)?.journey ?? journeyArtifact;
  const journeys = Array.isArray(record(semanticJourney)?.journeys) ? semanticJourney.journeys : [];
  const allowedByJourneyMilestone = new Map();
  journeys.forEach((journey, journeyIndex) => {
    const journeyRef = `J${String(journeyIndex + 1).padStart(3, "0")}`;
    for (const milestone of Array.isArray(record(journey)?.milestones) ? journey.milestones : []) {
      allowedByJourneyMilestone.set(
        `${journeyRef}:${milestone.position}`,
        new Set(Array.isArray(record(milestone)?.transition_refs) ? milestone.transition_refs : []),
      );
    }
  });
  const coveredRefs = new Set();
  const unresolvedRefs = new Set((Array.isArray(record(semanticJourney)?.unresolved) ? semanticJourney.unresolved : [])
    .flatMap((entry) => Array.isArray(record(entry)?.transition_refs) ? entry.transition_refs : []));
  const unknownRefs = new Set();
  const milestoneMismatches = [];
  const outcomeMismatches = [];
  const nonAtomicStepMappings = [];
  const cases = Array.isArray(record(scenarioCaseArtifact)?.cases) ? scenarioCaseArtifact.cases : [];
  cases.forEach((scenarioCase, caseIndex) => {
    const unresolvedCase = record(scenarioCase)?.status === "unresolved";
    for (const step of Array.isArray(record(scenarioCase)?.steps) ? scenarioCase.steps : []) {
      const transitionRefs = Array.isArray(record(step)?.transition_refs) ? step.transition_refs : [];
      if (transitionRefs.length > 1) {
        nonAtomicStepMappings.push({ case_index: caseIndex, step_position: step.position, transition_refs: [...transitionRefs].sort() });
      }
      const allowed = allowedByJourneyMilestone.get(`${scenarioCase.journey_ref}:${step.journey_milestone_position}`) ?? new Set();
      for (const transitionRef of transitionRefs) {
        const obligation = record(obligationByRef.get(transitionRef));
        if (!obligation) {
          unknownRefs.add(transitionRef);
          continue;
        }
        if (!allowed.has(transitionRef)) {
          milestoneMismatches.push({ case_index: caseIndex, step_position: step.position, transition_ref: transitionRef });
          continue;
        }
        if (scenarioCase.kind === "normal" && obligation.outcome === "exception") {
          outcomeMismatches.push({ case_index: caseIndex, step_position: step.position, transition_ref: transitionRef });
          continue;
        }
        (unresolvedCase ? unresolvedRefs : coveredRefs).add(transitionRef);
      }
    }
  });
  for (const entry of Array.isArray(record(scenarioCaseArtifact)?.unresolved) ? scenarioCaseArtifact.unresolved : []) {
    for (const transitionRef of Array.isArray(record(entry)?.transition_refs) ? entry.transition_refs : []) {
      if (obligationByRef.has(transitionRef)) unresolvedRefs.add(transitionRef);
      else unknownRefs.add(transitionRef);
    }
  }
  const missingRefs = obligations
    .map((obligation) => record(obligation)?.transition_ref)
    .filter((transitionRef) => !coveredRefs.has(transitionRef) && !unresolvedRefs.has(transitionRef));
  const statusConflicts = [...coveredRefs].filter((transitionRef) => unresolvedRefs.has(transitionRef)).sort();
  const sourceSupported = obligations.filter((obligation) => record(obligation)?.feasibility === "source-supported");
  const sourceSupportedLinked = sourceSupported.filter((obligation) => coveredRefs.has(obligation.transition_ref)).length;
  return {
    assessment_kind: "lower-bound-transition-linkage",
    executable_coverage_status: "not-measurable",
    total_obligations: obligations.length,
    linked_obligations: coveredRefs.size,
    missing_obligation_refs: missingRefs,
    unresolved_obligation_refs: [...unresolvedRefs].sort(),
    unknown_transition_refs: [...unknownRefs].sort(),
    milestone_mismatches: milestoneMismatches,
    outcome_mismatches: outcomeMismatches,
    status_conflicts: statusConflicts,
    non_atomic_step_mappings: nonAtomicStepMappings,
    source_supported: {
      total: sourceSupported.length,
      linked: sourceSupportedLinked,
      linkage_percent: sourceSupported.length ? Math.round((sourceSupportedLinked / sourceSupported.length) * 10_000) / 100 : 100,
    },
    runtime_unverified_obligation_refs: obligations
      .filter((obligation) => record(obligation)?.feasibility === "runtime-unverified")
      .map((obligation) => obligation.transition_ref),
  };
}

const failClosedScenarioCaseIssues = new Set([
  "SCENARIO_CASE_ARTIFACT_INVALID",
  "SCENARIO_CASE_PROVENANCE_MISMATCH",
  "SCENARIO_CASE_ENTRY_INVALID",
  "SCENARIO_CASE_UNRESOLVED_INVALID",
  "SCENARIO_CASE_JOURNEY_REF_INVALID",
  "SCENARIO_CASE_CLASSIFICATION_REF_INVALID",
  "SCENARIO_CASE_SOURCE_AREA_REF_INVALID",
  "SCENARIO_CASE_TRANSITION_REF_INVALID",
  "SCENARIO_CASE_TRANSITION_MILESTONE_MISMATCH",
  "SCENARIO_CASE_TRANSITION_OUTCOME_MISMATCH",
  "SCENARIO_CASE_TRANSITION_STATUS_CONFLICT",
  "SCENARIO_CASE_STEP_AREA_MISMATCH",
  "SCENARIO_CASE_MILESTONE_REF_INVALID",
  "SCENARIO_CASE_UNRESOLVED_JOURNEY_REF_INVALID",
  "SCENARIO_CASE_UNRESOLVED_CLASSIFICATION_REF_INVALID",
  "SCENARIO_CASE_UNRESOLVED_AREA_REF_INVALID",
  "SCENARIO_CASE_SOURCE_REF_INVALID",
  "SCENARIO_CASE_RAW_SOURCE_COPIED",
]);

export function isFailClosedScenarioCaseIssue(issue) {
  return failClosedScenarioCaseIssues.has(String(issue).split(":", 1)[0]);
}

export function validateScenarioCaseEnvelope(value, { runId, workId, snapshotId, rootHash, journeyArtifactId, journeyArtifactHash, journeyArtifact, classificationArtifact, sourceArtifact, transitionView, permittedSourceRefs, grantedSourceContents = [] }) {
  const item = record(value);
  const issues = [];
  const topLevelKeys = ["schema_version", "stage", "run_id", "work_id", "source_snapshot_ref", "source_root_hash", "extends_artifact_id", "extends_artifact_hash", "cases", "unresolved"];
  let malformed = !exactObject(item, topLevelKeys) || item?.schema_version !== 1 || item?.stage !== "scenario-cases";
  if (item?.run_id !== runId || item?.work_id !== workId || item?.source_snapshot_ref !== snapshotId || item?.source_root_hash !== rootHash
    || item?.extends_artifact_id !== journeyArtifactId || item?.extends_artifact_hash !== journeyArtifactHash) {
    issues.push("SCENARIO_CASE_PROVENANCE_MISMATCH");
  }
  if (!collection(item?.cases) || item.cases.length === 0) {
    issues.push("SCENARIO_CASE_COLLECTION_MISSING:cases");
    malformed = true;
  } else if (!item.cases.every(validScenarioCase)) {
    issues.push("SCENARIO_CASE_ENTRY_INVALID");
    malformed = true;
  }
  if (!collection(item?.unresolved)) {
    issues.push("SCENARIO_CASE_COLLECTION_MISSING:unresolved");
    malformed = true;
  } else if (!item.unresolved.every(validScenarioCaseUnresolved)) {
    issues.push("SCENARIO_CASE_UNRESOLVED_INVALID");
    malformed = true;
  }

  const scenarioCases = Array.isArray(item?.cases) ? item.cases : [];
  const unresolved = Array.isArray(item?.unresolved) ? item.unresolved : [];
  const view = buildScenarioCaseJourneyView(journeyArtifact, classificationArtifact, sourceArtifact);
  const journeyByRef = new Map(view.journeys.map((journey) => [journey.journey_ref, journey]));
  const classificationByRef = new Map(view.classification_catalog.map((entry) => [entry.classification_ref, entry]));
  const validAreaRefs = new Set(view.journeys.flatMap((journey) => journey.milestones.flatMap((milestone) => milestone.source_area_refs)));
  for (const kind of scenarioCaseKinds) if (!scenarioCases.some((scenarioCase) => record(scenarioCase)?.kind === kind)) issues.push(`SCENARIO_CASE_KIND_MISSING:${kind}`);
  const signatures = scenarioCases.map((scenarioCase) => `${record(scenarioCase)?.journey_ref}:${record(scenarioCase)?.kind}:${record(scenarioCase)?.title}`);
  if (new Set(signatures).size !== signatures.length) issues.push("SCENARIO_CASE_DUPLICATE");

  for (const journey of view.journeys) {
    const requiredKinds = journey.kind === "normal" ? ["normal", "boundary", "exception"] : ["recovery"];
    for (const kind of requiredKinds) {
      if (!scenarioCases.some((scenarioCase) => scenarioCase.journey_ref === journey.journey_ref && scenarioCase.kind === kind)) {
        issues.push(`SCENARIO_CASE_JOURNEY_KIND_MISSING:${journey.journey_ref}:${kind}`);
      }
    }
    const coveredRefs = new Set(scenarioCases.filter((scenarioCase) => scenarioCase.journey_ref === journey.journey_ref).flatMap((scenarioCase) => Array.isArray(scenarioCase.classification_refs) ? scenarioCase.classification_refs : []));
    for (const classificationRef of journey.classification_refs) if (!coveredRefs.has(classificationRef)) issues.push(`SCENARIO_CASE_CLASSIFICATION_COVERAGE_MISSING:${journey.journey_ref}:${classificationRef}`);
  }

  scenarioCases.forEach((scenarioCase, caseIndex) => {
    const journey = journeyByRef.get(scenarioCase.journey_ref);
    if (!journey) issues.push(`SCENARIO_CASE_JOURNEY_REF_INVALID:${caseIndex}:${scenarioCase.journey_ref}`);
    const classificationRefs = Array.isArray(scenarioCase.classification_refs) ? scenarioCase.classification_refs : [];
    if (new Set(classificationRefs).size !== classificationRefs.length) issues.push(`SCENARIO_CASE_CLASSIFICATION_REF_DUPLICATE:${caseIndex}`);
    for (const classificationRef of classificationRefs) {
      if (!journey?.classification_refs.includes(classificationRef) || !classificationByRef.has(classificationRef)) issues.push(`SCENARIO_CASE_CLASSIFICATION_REF_INVALID:${caseIndex}:${classificationRef}`);
    }
    const adaptivePerspectives = {
      normal: ["user-role", "workflow-stage", "output-deliverable"],
      boundary: ["input-source", "lifecycle-state"],
      exception: ["lifecycle-state", "risk-recovery"],
      recovery: ["risk-recovery", "input-source", "lifecycle-state", "output-deliverable"],
    }[scenarioCase.kind] ?? [];
    for (const perspective of adaptivePerspectives) {
      const applicable = (journey?.classification_refs ?? []).some((classificationRef) => classificationByRef.get(classificationRef)?.perspective === perspective);
      const selected = classificationRefs.some((classificationRef) => classificationByRef.get(classificationRef)?.perspective === perspective);
      if (applicable && !selected) issues.push(`SCENARIO_CASE_PERSPECTIVE_MISSING:${caseIndex}:${perspective}`);
    }

    const steps = Array.isArray(scenarioCase.steps) ? scenarioCase.steps : [];
    const expectedPositions = steps.map((_, index) => index + 1);
    const milestonePositions = steps.map((step) => record(step)?.journey_milestone_position);
    if (!steps.every((step, index) => step.position === expectedPositions[index])
      || steps[0]?.journey_milestone_position !== 1
      || milestonePositions.some((position, index) => index > 0 && position < milestonePositions[index - 1])) {
      issues.push(`SCENARIO_CASE_STEP_SEQUENCE_INVALID:${caseIndex}`);
    }
    const milestonesByPosition = new Map((journey?.milestones ?? []).map((milestone) => [milestone.position, milestone]));
    steps.forEach((caseStep) => {
      const journeyMilestone = milestonesByPosition.get(caseStep.journey_milestone_position);
      if (!journeyMilestone) issues.push(`SCENARIO_CASE_MILESTONE_REF_INVALID:${caseIndex}:${caseStep.journey_milestone_position}`);
      for (const sourceAreaRef of Array.isArray(caseStep.source_area_refs) ? caseStep.source_area_refs : []) {
        if (!validAreaRefs.has(sourceAreaRef)) issues.push(`SCENARIO_CASE_SOURCE_AREA_REF_INVALID:${caseIndex}:${sourceAreaRef}`);
        else if (!journeyMilestone?.source_area_refs.includes(sourceAreaRef)) issues.push(`SCENARIO_CASE_STEP_AREA_MISMATCH:${caseIndex}:${caseStep.position}:${sourceAreaRef}`);
      }
    });

    if (scenarioCase.terminal?.final_step_position !== steps.length) issues.push(`SCENARIO_CASE_TERMINAL_INVALID:${caseIndex}`);
    const successTerminal = scenarioCase.terminal?.kind === "business-result-and-exit";
    const businessResultPosition = journey?.business_result?.milestone_position;
    const exitPosition = journey?.exit?.milestone_position;
    const successPathComplete = successTerminal
      && milestonePositions.includes(businessResultPosition)
      && milestonePositions.at(-1) === exitPosition;
    if (successTerminal && !successPathComplete) issues.push(`SCENARIO_CASE_SUCCESS_PATH_INCOMPLETE:${caseIndex}`);
    if (scenarioCase.terminal?.kind === "expected-failure" && !["boundary", "exception"].includes(scenarioCase.kind)) issues.push(`SCENARIO_CASE_TERMINAL_INVALID:${caseIndex}`);
    if (["normal", "recovery"].includes(scenarioCase.kind) && !successTerminal) issues.push(`SCENARIO_CASE_TERMINAL_INVALID:${caseIndex}`);
    if (scenarioCase.kind === "normal" && journey?.kind !== "normal") issues.push(`SCENARIO_CASE_JOURNEY_KIND_INVALID:${caseIndex}`);
    if (scenarioCase.kind === "recovery" && journey?.kind !== "recovery") issues.push(`SCENARIO_CASE_JOURNEY_KIND_INVALID:${caseIndex}`);

    if (scenarioCase.kind === "normal" && scenarioCase.variation !== null) issues.push(`SCENARIO_CASE_VARIATION_INVALID:${caseIndex}`);
    if (scenarioCase.kind !== "normal") {
      const variation = record(scenarioCase.variation);
      if (!milestonesByPosition.has(variation?.milestone_position) || !milestonePositions.includes(variation?.milestone_position)) issues.push(`SCENARIO_CASE_VARIATION_INVALID:${caseIndex}`);
      if (scenarioCase.kind === "recovery" && !safeText(variation?.recovery_action)) issues.push(`SCENARIO_CASE_VARIATION_INVALID:${caseIndex}`);
      if (scenarioCase.terminal?.kind === "expected-failure") {
        const variationStep = steps.find((caseStep) => caseStep.journey_milestone_position === variation?.milestone_position);
        if (!variationStep || scenarioCase.terminal.final_step_position < variationStep.position) issues.push(`SCENARIO_CASE_TERMINAL_INVALID:${caseIndex}`);
      }
    }

    if (scenarioCase.kind === "recovery") {
      const recovery = record(journey?.recovery);
      const requiredPositions = [
        recovery?.failure_milestone_position,
        recovery?.recovery_action_position,
        recovery?.rejoin_milestone_position,
        journey?.business_result?.milestone_position,
        journey?.exit?.milestone_position,
      ];
      if (scenarioCase.variation?.milestone_position !== recovery?.failure_milestone_position
        || requiredPositions.some((position) => !milestonePositions.includes(position))) {
        issues.push(`SCENARIO_CASE_RECOVERY_PATH_INCOMPLETE:${caseIndex}`);
      }
    }
  });

  for (const journeyRef of collectStringValues(unresolved, "journey_refs")) if (!journeyByRef.has(journeyRef)) issues.push(`SCENARIO_CASE_UNRESOLVED_JOURNEY_REF_INVALID:${journeyRef}`);
  for (const classificationRef of collectStringValues(unresolved, "classification_refs")) if (!classificationByRef.has(classificationRef)) issues.push(`SCENARIO_CASE_UNRESOLVED_CLASSIFICATION_REF_INVALID:${classificationRef}`);
  for (const sourceAreaRef of collectStringValues(unresolved, "source_area_refs")) if (!validAreaRefs.has(sourceAreaRef)) issues.push(`SCENARIO_CASE_UNRESOLVED_AREA_REF_INVALID:${sourceAreaRef}`);
  for (const sourceRef of collectStringValues(unresolved, "source_refs_to_revisit")) if (!permittedSourceRefs.has(sourceRef)) issues.push(`SCENARIO_CASE_SOURCE_REF_INVALID:${sourceRef}`);

  if (transitionView) {
    const transitionAudit = auditScenarioCaseTransitionLinkage(item, journeyArtifact, transitionView);
    for (const transitionRef of transitionAudit.unknown_transition_refs) issues.push(`SCENARIO_CASE_TRANSITION_REF_INVALID:${transitionRef}`);
    for (const mismatch of transitionAudit.milestone_mismatches) issues.push(`SCENARIO_CASE_TRANSITION_MILESTONE_MISMATCH:${mismatch.case_index}:${mismatch.step_position}:${mismatch.transition_ref}`);
    for (const mismatch of transitionAudit.outcome_mismatches) issues.push(`SCENARIO_CASE_TRANSITION_OUTCOME_MISMATCH:${mismatch.case_index}:${mismatch.step_position}:${mismatch.transition_ref}`);
    for (const transitionRef of transitionAudit.status_conflicts) issues.push(`SCENARIO_CASE_TRANSITION_STATUS_CONFLICT:${transitionRef}`);
    if (transitionAudit.missing_obligation_refs.length) issues.push(`SCENARIO_CASE_TRANSITION_COVERAGE_MISSING:${transitionAudit.missing_obligation_refs.join("|")}`);
  }

  let serialized;
  try {
    serialized = JSON.stringify(item);
  } catch {
    malformed = true;
  }
  if (serialized && (Buffer.byteLength(serialized) > MAX_ARTIFACT_BYTES || containsPotentialSecret(serialized) || forbiddenArtifactTextPattern.test(serialized))) malformed = true;
  if (item && copiesSubstantialSource(item, grantedSourceContents)) issues.push("SCENARIO_CASE_RAW_SOURCE_COPIED");
  if (malformed) issues.unshift("SCENARIO_CASE_ARTIFACT_INVALID");
  return [...new Set(issues)];
}

export function hydrateScenarioCaseEvidence(scenarioCaseArtifact, sourceArtifact, evidenceByRef) {
  const sourcesByArea = businessClassificationEvidenceSourcesByArea(sourceArtifact);
  const evidenceEntries = [...evidenceByRef.entries()];
  const issues = [];
  const scenarioCaseEvidenceBindings = (Array.isArray(record(scenarioCaseArtifact)?.cases) ? scenarioCaseArtifact.cases : []).map((scenarioCase, casePosition) => {
    const stepBindings = (Array.isArray(record(scenarioCase)?.steps) ? scenarioCase.steps : []).map((step) => {
      const sourceAreaRefs = Array.isArray(record(step)?.source_area_refs) ? step.source_area_refs : [];
      const supportingSources = new Set(sourceAreaRefs.flatMap((sourceAreaRef) => [...(sourcesByArea.get(sourceAreaRef) ?? new Set())]));
      const evidenceRefs = evidenceEntries.filter(([, evidenceEntry]) => supportingSources.has(record(evidenceEntry)?.source_id)).map(([evidenceRef]) => evidenceRef);
      for (const sourceAreaRef of sourceAreaRefs) {
        const areaSources = sourcesByArea.get(sourceAreaRef) ?? new Set();
        if (!evidenceEntries.some(([, evidenceEntry]) => areaSources.has(record(evidenceEntry)?.source_id))) issues.push(`SCENARIO_CASE_STEP_EVIDENCE_MISSING:${casePosition}:${step.position}:${sourceAreaRef}`);
      }
      return { step_position: step.position, journey_milestone_position: step.journey_milestone_position, source_area_refs: sourceAreaRefs, evidence_refs: evidenceRefs };
    });
    return {
      case_position: casePosition,
      journey_ref: scenarioCase.journey_ref,
      kind: scenarioCase.kind,
      classification_refs: scenarioCase.classification_refs,
      evidence_refs: [...new Set(stepBindings.flatMap((binding) => binding.evidence_refs))],
      steps: stepBindings,
    };
  });
  return {
    issues: [...new Set(issues)],
    scenario_case_evidence_bindings: scenarioCaseEvidenceBindings,
    evidence_catalog: evidenceEntries.map(([evidenceRef, evidenceEntry]) => ({ evidence_ref: evidenceRef, evidence: evidenceEntry })),
  };
}

export function hydrateScenarioCaseCorrectionEvidence(scenarioCaseArtifact, sourceArtifact, { priorEvidenceCatalog, currentEvidenceByRef }) {
  const priorEvidence = new Map((Array.isArray(priorEvidenceCatalog) ? priorEvidenceCatalog : [])
    .map((entry) => [record(entry)?.evidence_ref, record(entry)?.evidence])
    .filter(([evidenceRef, evidenceEntry]) => typeof evidenceRef === "string" && record(evidenceEntry)));
  const currentEvidence = currentEvidenceByRef instanceof Map ? currentEvidenceByRef : new Map();
  return hydrateScenarioCaseEvidence(scenarioCaseArtifact, sourceArtifact, new Map([...priorEvidence, ...currentEvidence]));
}
