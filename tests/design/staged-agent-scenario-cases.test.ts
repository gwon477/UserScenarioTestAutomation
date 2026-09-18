import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyScenarioCaseCorrectionPatch,
  buildScenarioCaseCorrectionPlan,
  buildScenarioCaseJourneyView,
  classifyScenarioCaseArtifactRequest,
  createScenarioCaseStageGuard,
  hydrateScenarioCaseEvidence,
  hydrateScenarioCaseCorrectionEvidence,
  isPersistableScenarioCaseCorrectionPatch,
  isFailClosedScenarioCaseIssue,
  retainSuccessfulScenarioCaseCorrections,
  replayScenarioCaseCorrectionAttempts,
  scenarioCaseCorrectionCompileFailures,
  scenarioCaseCorrectionFailuresForIssues,
  scenarioCaseCorrectionTargetRefsForIssues,
  scenarioCasePermittedSourceRefs,
  validateScenarioCaseEnvelope,
  validateScenarioCaseInputs,
  auditScenarioCaseTransitionLinkage,
} from "../../scripts/staged-agent-analysis-contract.mjs";
import {
  stableAgenticErrorCode,
  validateScenarioCaseCorrectionOptions,
  validateScenarioCaseCorrectionPaths,
  validateScenarioCaseJourneyDirectory,
} from "../../scripts/staged-agent-run-support.mjs";

const evidence = (sourceId: string, path: string, suffix: string) => ({
  source_id: sourceId,
  source_snapshot_id: "SS-1",
  path,
  start_line: 1,
  end_line: 20,
  content_hash: `sha256:${suffix}`,
  evidence_grant_id: `EVG-${suffix}`,
});

const sourceArtifact = {
  schema_version: 1,
  run_id: "RUN-1",
  artifact_status: "locally-validated-unregistered-probe",
  provenance: {
    project_id: "P-1",
    work_id: "WORK-SOURCE",
    source_snapshot_id: "SS-1",
    source_root_hash: "sha256:root",
    granted_evidence_refs: ["EV-entry", "EV-upload", "EV-result"],
    inherited_evidence_refs: [],
  },
  survey: {
    schema_version: 1,
    stage: "source-survey",
    source_snapshot_ref: "SS-1",
    source_areas: [
      { area_key: "entry", label: "Entry", purpose: "Start", user_visible_surfaces: [], entry_points: ["Login"], actions: ["Login"], observable_outcomes: ["Workspace"], business_outputs: [], recovery_paths: [], exit_paths: ["Logout"], evidence_refs: ["EV-entry"] },
      { area_key: "upload", label: "Upload", purpose: "Parse", user_visible_surfaces: [], entry_points: ["Upload"], actions: ["Upload"], observable_outcomes: ["Parsed or failed"], business_outputs: [], recovery_paths: ["Reselect"], exit_paths: [], evidence_refs: ["EV-upload"] },
      { area_key: "result", label: "Result", purpose: "Export", user_visible_surfaces: [], entry_points: ["Generate"], actions: ["Download"], observable_outcomes: ["Export"], business_outputs: ["Spreadsheet"], recovery_paths: [], exit_paths: [], evidence_refs: ["EV-result"] },
    ],
    journey_threads: [
      { name: "Main", starts_at: "Login", ordered_milestones: ["Login", "Upload", "Export", "Logout"], furthest_business_outcome: "Export", exit_or_handoff: "Logout", evidence_refs: ["EV-entry", "EV-upload", "EV-result"] },
      { name: "Recovery", starts_at: "Login", ordered_milestones: ["Login", "Failure", "Reselect", "Export", "Logout"], furthest_business_outcome: "Export", exit_or_handoff: "Logout", evidence_refs: ["EV-entry", "EV-upload", "EV-result"] },
    ],
    supporting_systems: [],
    source_gaps: [],
    excluded_as_internal: [],
  },
  evidence_catalog: [
    { evidence_ref: "EV-entry", evidence: evidence("SRC-entry", "Entry.tsx", "entry") },
    { evidence_ref: "EV-upload", evidence: evidence("SRC-upload", "Upload.tsx", "upload") },
    { evidence_ref: "EV-result", evidence: evidence("SRC-result", "Result.tsx", "result") },
  ],
};

const classifications = [
  { perspective: "business-capability", perspective_label: "Capability", label: "Enter", description: "Enter", user_responsibilities: ["Login"], source_area_refs: ["entry"], journey_thread_refs: ["Main", "Recovery"], business_outcomes: ["Session"] },
  { perspective: "business-capability", perspective_label: "Capability", label: "Upload", description: "Upload", user_responsibilities: ["Upload"], source_area_refs: ["upload"], journey_thread_refs: ["Main", "Recovery"], business_outcomes: ["Parsed"] },
  { perspective: "business-capability", perspective_label: "Capability", label: "Export", description: "Export", user_responsibilities: ["Download"], source_area_refs: ["result"], journey_thread_refs: ["Main", "Recovery"], business_outcomes: ["Export"] },
  { perspective: "user-role", perspective_label: "Role", label: "Operator", description: "Operator", user_responsibilities: ["Complete work"], source_area_refs: ["entry", "upload", "result"], journey_thread_refs: ["Main", "Recovery"], business_outcomes: ["Export"] },
  { perspective: "workflow-stage", perspective_label: "Stage", label: "Upload stage", description: "Stage", user_responsibilities: ["Progress"], source_area_refs: ["upload"], journey_thread_refs: ["Main", "Recovery"], business_outcomes: ["Parsed"] },
  { perspective: "input-source", perspective_label: "Input", label: "UTF-8 document", description: "Input", user_responsibilities: ["Choose file"], source_area_refs: ["upload"], journey_thread_refs: ["Main", "Recovery"], business_outcomes: ["Parsed"] },
  { perspective: "lifecycle-state", perspective_label: "State", label: "Parse state", description: "State", user_responsibilities: ["Observe"], source_area_refs: ["upload"], journey_thread_refs: ["Main", "Recovery"], business_outcomes: ["Parsed"] },
  { perspective: "output-deliverable", perspective_label: "Output", label: "Spreadsheet", description: "Output", user_responsibilities: ["Download"], source_area_refs: ["result"], journey_thread_refs: ["Main", "Recovery"], business_outcomes: ["Export"] },
  { perspective: "risk-recovery", perspective_label: "Recovery", label: "Replace invalid input", description: "Recovery", user_responsibilities: ["Reselect"], source_area_refs: ["upload"], journey_thread_refs: ["Recovery"], business_outcomes: ["Recovered export"] },
];

const classificationArtifact = {
  schema_version: 1,
  run_id: "RUN-1",
  artifact_status: "locally-validated-unregistered-probe",
  provenance: { project_id: "P-1", work_id: "WORK-BC", source_snapshot_id: "SS-1", source_root_hash: "sha256:root", extends_artifact_id: "02-source-gap-review", extends_artifact_hash: "sha256:source", generated_with: "pi-coding-agent", granted_evidence_refs: ["EV-BC-entry", "EV-BC-upload", "EV-BC-result"], inherited_evidence_refs: ["EV-entry", "EV-upload", "EV-result"] },
  classification: {
    schema_version: 1,
    stage: "business-classification",
    run_id: "RUN-1",
    work_id: "WORK-BC",
    source_snapshot_ref: "SS-1",
    source_root_hash: "sha256:root",
    extends_artifact_id: "02-source-gap-review",
    extends_artifact_hash: "sha256:source",
    perspective_assessments: [],
    classifications,
    unresolved: [],
  },
  evidence_bindings: classifications.map((entry, index) => ({ classification_position: index, source_area_refs: entry.source_area_refs, evidence_refs: [entry.source_area_refs.includes("entry") ? "EV-BC-entry" : entry.source_area_refs.includes("upload") ? "EV-BC-upload" : "EV-BC-result"] })),
  evidence_catalog: [
    { evidence_ref: "EV-BC-entry", evidence: evidence("SRC-entry", "Entry.tsx", "bc-entry") },
    { evidence_ref: "EV-BC-upload", evidence: evidence("SRC-upload", "Upload.tsx", "bc-upload") },
    { evidence_ref: "EV-BC-result", evidence: evidence("SRC-result", "Result.tsx", "bc-result") },
  ],
};

const milestone = (position: number, phase: string, sourceAreaRefs: string[]) => ({ position, phase, action: `Action ${position}`, observable_outcome: `Outcome ${position}`, source_area_refs: sourceAreaRefs });
const handoffs = (count: number) => Array.from({ length: count - 1 }, (_, index) => ({ from_position: index + 1, to_position: index + 2, state: [`State ${index + 1}`] }));

const semanticJourney = {
  schema_version: 1,
  stage: "user-journeys",
  run_id: "RUN-1",
  work_id: "WORK-JOURNEY",
  source_snapshot_ref: "SS-1",
  source_root_hash: "sha256:root",
  extends_artifact_id: "03-business-classification",
  extends_artifact_hash: "sha256:classification",
  source_basis_artifact_id: "02-source-gap-review",
  source_basis_artifact_hash: "sha256:source",
  journeys: [
    {
      kind: "normal",
      title: "Main journey",
      persona: "Operator",
      source_thread_ref: "Main",
      classification_refs: ["C001", "C002", "C003", "C004", "C005", "C006", "C007", "C008"],
      prerequisites: ["Credentials and a UTF-8 document are available."],
      milestones: [milestone(1, "entry", ["entry"]), milestone(2, "work", ["upload"]), milestone(3, "business-result", ["result"]), milestone(4, "exit", ["entry"])],
      handoffs: handoffs(4),
      business_result: { description: "Export acquired", milestone_position: 3, source_area_refs: ["result"] },
      exit: { kind: "logout", action: "Log out", observable_outcome: "Session ends", milestone_position: 4 },
      recovery: null,
    },
    {
      kind: "recovery",
      title: "Recovery journey",
      persona: "Operator",
      source_thread_ref: "Recovery",
      classification_refs: ["C001", "C002", "C003", "C004", "C005", "C006", "C007", "C008", "C009"],
      prerequisites: ["Credentials, a non-UTF-8 document, and a valid UTF-8 replacement are available."],
      milestones: [milestone(1, "entry", ["entry"]), milestone(2, "work", ["upload"]), milestone(3, "failure", ["upload"]), milestone(4, "recovery", ["upload"]), milestone(5, "work", ["result"]), milestone(6, "business-result", ["result"]), milestone(7, "exit", ["entry"])],
      handoffs: handoffs(7),
      business_result: { description: "Export acquired", milestone_position: 6, source_area_refs: ["result"] },
      exit: { kind: "logout", action: "Log out", observable_outcome: "Session ends", milestone_position: 7 },
      recovery: { failure_milestone_position: 3, recovery_action_position: 4, rejoin_milestone_position: 5 },
    },
  ],
  excluded_threads: [],
  unresolved: [],
};

const journeyArtifact = {
  schema_version: 1,
  run_id: "RUN-1",
  model_id: "gpt-test",
  artifact_status: "locally-validated-unregistered-probe",
  provenance: { project_id: "P-1", work_id: "WORK-JOURNEY", source_snapshot_id: "SS-1", source_root_hash: "sha256:root", extends_artifact_id: "03-business-classification", extends_artifact_hash: "sha256:classification", source_basis_artifact_id: "02-source-gap-review", source_basis_artifact_hash: "sha256:source", generated_with: "pi-coding-agent", granted_evidence_refs: ["EV-J-entry", "EV-J-upload", "EV-J-result"], inherited_evidence_refs: ["EV-entry", "EV-upload", "EV-result", "EV-BC-entry", "EV-BC-upload", "EV-BC-result"] },
  journey: semanticJourney,
  journey_evidence_bindings: semanticJourney.journeys.map((journey, journeyPosition) => ({
    journey_position: journeyPosition,
    source_thread_ref: journey.source_thread_ref,
    evidence_refs: ["EV-J-entry", "EV-J-upload", "EV-J-result"],
    milestones: journey.milestones.map((entry) => ({ milestone_position: entry.position, source_area_refs: entry.source_area_refs, evidence_refs: entry.source_area_refs.includes("entry") ? ["EV-J-entry"] : entry.source_area_refs.includes("upload") ? ["EV-J-upload"] : ["EV-J-result"] })),
  })),
  evidence_catalog: [
    { evidence_ref: "EV-J-entry", evidence: evidence("SRC-entry", "Entry.tsx", "j-entry") },
    { evidence_ref: "EV-J-upload", evidence: evidence("SRC-upload", "Upload.tsx", "j-upload") },
    { evidence_ref: "EV-J-result", evidence: evidence("SRC-result", "Result.tsx", "j-result") },
  ],
};

const journeyValidation = { pass: true, validation_scope: "local-probe-contract-only", product_stage_acceptance: "not-attempted", source_artifact_hash: "sha256:source", classification_artifact_hash: "sha256:classification", artifact_hash: "sha256:journey" };
const gaps = {
  schema_version: 1,
  artifact_type: "orchestrator-source-gaps",
  run_id: "RUN-1",
  source_snapshot_ref: "SS-1",
  source_root_hash: "sha256:root",
  reviewed_artifact: { artifact_id: "04-user-journeys", content_hash: "sha256:journey", status: "locally-validated-unregistered-probe" },
  golden_derived: false,
  decision: "carry-forward-semantic-question",
  gaps: [{ gap_id: "GAP-UTF8", kind: "incomplete-recovery-precondition", affected_sections: ["recovery-case:prerequisites"], required_change: "Distinguish invalid encoding from a valid replacement.", source_refs_to_revisit: ["SRC-upload"] }],
  generator_exclusions: ["external evaluator artifacts"],
};
const inventory = {
  schema_version: 1,
  project_id: "P-1",
  analysis_run_id: "RUN-1",
  source_snapshot_id: "SS-1",
  source_root_hash: "sha256:root",
  files: [
    { source_ref: "SRC-entry", path: "Entry.tsx", language: "tsx", size_bytes: 20, imports: [] },
    { source_ref: "SRC-upload", path: "Upload.tsx", language: "tsx", size_bytes: 20, imports: [] },
    { source_ref: "SRC-result", path: "Result.tsx", language: "tsx", size_bytes: 20, imports: [] },
  ],
  routes: [], apis: [], interactions: [], ui_stacks: ["react"], unsupported_ui_stacks: [],
};

const step = (position: number, journeyMilestonePosition: number, sourceAreaRefs: string[]) => ({ position, journey_milestone_position: journeyMilestonePosition, action: `Case action ${position}`, observable_outcome: `Case outcome ${position}`, source_area_refs: sourceAreaRefs });
const successTerminal = (finalStepPosition: number) => ({ kind: "business-result-and-exit", expected_result: "Export acquired and session ends", final_step_position: finalStepPosition });
const failureTerminal = (finalStepPosition: number) => ({ kind: "expected-failure", expected_result: "A visible validation error is shown", final_step_position: finalStepPosition });

const cases = {
  schema_version: 1,
  stage: "scenario-cases",
  run_id: "RUN-1",
  work_id: "WORK-CASES",
  source_snapshot_ref: "SS-1",
  source_root_hash: "sha256:root",
  extends_artifact_id: "04-user-journeys",
  extends_artifact_hash: "sha256:journey",
  cases: [
    {
      kind: "normal",
      title: "Complete the main journey",
      journey_ref: "J001",
      classification_refs: ["C001", "C002", "C003", "C004", "C005", "C006", "C007", "C008"],
      preconditions: ["Valid credentials and a UTF-8 document are available."],
      variation: null,
      steps: [step(1, 1, ["entry"]), step(2, 2, ["upload"]), step(3, 3, ["result"]), step(4, 4, ["entry"])],
      terminal: successTerminal(4),
    },
    {
      kind: "boundary",
      title: "Reject a document outside the UTF-8 boundary",
      journey_ref: "J001",
      classification_refs: ["C002", "C005", "C006", "C007"],
      preconditions: ["A document that cannot be decoded as UTF-8 is available."],
      variation: { milestone_position: 2, condition: "The selected document is not UTF-8.", expected_outcome: "The request is rejected with a visible error.", recovery_action: null },
      steps: [step(1, 1, ["entry"]), step(2, 2, ["upload"])],
      terminal: failureTerminal(2),
    },
    {
      kind: "exception",
      title: "Show a login request failure",
      journey_ref: "J001",
      classification_refs: ["C001", "C004", "C007"],
      preconditions: ["The login request fails."],
      variation: { milestone_position: 1, condition: "The login request returns an error.", expected_outcome: "The error is visible and entry does not advance.", recovery_action: null },
      steps: [step(1, 1, ["entry"]), step(2, 1, ["entry"])],
      terminal: failureTerminal(2),
    },
    {
      kind: "recovery",
      title: "Replace invalid input and complete the recovery journey",
      journey_ref: "J002",
      classification_refs: ["C001", "C002", "C003", "C004", "C005", "C006", "C007", "C008", "C009"],
      preconditions: ["A non-UTF-8 document and a valid UTF-8 replacement are available."],
      variation: { milestone_position: 3, condition: "The first document is not UTF-8.", expected_outcome: "A decoding error is visible.", recovery_action: "Remove it and select the valid UTF-8 replacement." },
      steps: [step(1, 1, ["entry"]), step(2, 2, ["upload"]), step(3, 3, ["upload"]), step(4, 4, ["upload"]), step(5, 5, ["result"]), step(6, 6, ["result"]), step(7, 7, ["entry"])],
      terminal: successTerminal(7),
    },
  ],
  unresolved: [],
};

const correctionAddition = (scenarioCase: (typeof cases.cases)[number]) => {
  const { kind: _kind, journey_ref: _journeyRef, ...addition } = structuredClone(scenarioCase);
  addition.steps = addition.steps.map(({ source_area_refs: _sourceAreaRefs, ...stepEntry }) => stepEntry);
  return addition;
};

const context = {
  runId: "RUN-1",
  workId: "WORK-CASES",
  snapshotId: "SS-1",
  rootHash: "sha256:root",
  journeyArtifactId: "04-user-journeys",
  journeyArtifactHash: "sha256:journey",
  journeyArtifact,
  classificationArtifact,
  sourceArtifact,
  permittedSourceRefs: new Set(["SRC-entry", "SRC-upload", "SRC-result"]),
};

describe("staged Pi scenario-cases contract", () => {
  it("validates the journey handoff, gap provenance, evidence, and source inventory", () => {
    expect(validateScenarioCaseInputs({ runId: "RUN-1", sourceArtifactHash: "sha256:source", sourceArtifact, classificationArtifactHash: "sha256:classification", classificationArtifact, journeyArtifactHash: "sha256:journey", journeyArtifact, journeyValidation, gapDocument: gaps, inventory })).toEqual([]);
    expect(validateScenarioCaseInputs({ runId: "RUN-1", sourceArtifactHash: "sha256:source", sourceArtifact, classificationArtifactHash: "sha256:classification", classificationArtifact, journeyArtifactHash: "sha256:changed", journeyArtifact, journeyValidation, gapDocument: gaps, inventory })).toEqual(expect.arrayContaining(["SCENARIO_CASE_JOURNEY_HASH_MISMATCH", "SCENARIO_CASE_GAP_HASH_MISMATCH"]));
    expect(validateScenarioCaseInputs({ runId: "RUN-1", sourceArtifactHash: "sha256:source", sourceArtifact, classificationArtifactHash: "sha256:classification", classificationArtifact, journeyArtifactHash: "sha256:journey", journeyArtifact, journeyValidation, gapDocument: { ...gaps, golden_derived: true }, inventory })).toContain("SCENARIO_CASE_GAP_INVALID");
  });

  it("projects opaque journey references with their allowed classifications", () => {
    const view = buildScenarioCaseJourneyView(journeyArtifact, classificationArtifact, sourceArtifact);
    expect(view.journeys.map((entry) => entry.journey_ref)).toEqual(["J001", "J002"]);
    expect(view.journeys[0]).toMatchObject({ kind: "normal", classification_refs: semanticJourney.journeys[0].classification_refs });
    expect(view.journeys[0].classification_refs_by_perspective["risk-recovery"]).toBeUndefined();
    expect(view.journeys[1].classification_refs_by_perspective["risk-recovery"]).toEqual(["C009"]);
    expect(view.classification_catalog.map((entry) => entry.classification_ref)).toEqual(["C001", "C002", "C003", "C004", "C005", "C006", "C007", "C008", "C009"]);
    expect(view.source_area_support).toEqual(expect.arrayContaining([{ source_area_ref: "upload", source_refs: ["SRC-upload"] }]));
  });

  it("groups model-facing classifications by the journey that permits them", () => {
    const view = buildScenarioCaseJourneyView(journeyArtifact, classificationArtifact, sourceArtifact);
    expect(view.classification_groups.map((group) => group.journey_ref)).toEqual(["J001", "J002"]);
    expect(view.classification_groups[0].classifications.map((entry) => entry.classification_ref)).toEqual(semanticJourney.journeys[0].classification_refs);
    expect(view.classification_groups[1].classifications.map((entry) => entry.classification_ref)).toEqual(semanticJourney.journeys[1].classification_refs);
    expect(view.classification_groups[0].classifications.some((entry) => entry.classification_ref === "C009")).toBe(false);
    expect(view.classification_groups[1].classifications.some((entry) => entry.classification_ref === "C009")).toBe(true);
  });

  it("limits artifact and source metadata lookup to the scenario-case scope", () => {
    const permitted = scenarioCasePermittedSourceRefs(sourceArtifact, classificationArtifact, journeyArtifact, gaps);
    expect([...permitted].sort()).toEqual(["SRC-entry", "SRC-result", "SRC-upload"]);
    expect(classifyScenarioCaseArtifactRequest("04-user-journeys", permitted)).toEqual({ kind: "input", id: "04-user-journeys" });
    expect(classifyScenarioCaseArtifactRequest("prior-scenario-cases", permitted, ["prior-scenario-cases"])).toEqual({ kind: "input", id: "prior-scenario-cases" });
    expect(classifyScenarioCaseArtifactRequest("SRC-upload", permitted)).toEqual({ kind: "source-metadata", id: "SRC-upload" });
    expect(classifyScenarioCaseArtifactRequest("orchestrator-external-evaluation", permitted)).toBeNull();
  });

  it("requires all inputs, all case areas, and every model-safe gap source to be reread", () => {
    const guard = createScenarioCaseStageGuard(sourceArtifact, gaps, new Map([["SRC-entry", 20], ["SRC-upload", 20], ["SRC-result", 20]]), { classificationArtifact, journeyArtifact });
    for (const id of ["03-business-classification", "04-user-journeys", "04-user-journeys-validation", "orchestrator-next-stage-gaps", "source-inventory"]) guard.recordArtifactRead(id);
    guard.beginClosure(["SRC-entry", "SRC-upload", "SRC-result"]);
    guard.completeClosure(["SRC-entry", "SRC-upload", "SRC-result"]);
    expect(() => guard.beginArtifactWrite(cases.cases)).not.toThrow();
    guard.completeArtifactWrite();
    expect(guard.summary()).toMatchObject({ artifact_write_attempts: 1, artifact_writes: 1, gap_source_refs_read: ["SRC-upload"] });

    const missingGap = createScenarioCaseStageGuard(sourceArtifact, gaps, new Map([["SRC-entry", 20], ["SRC-upload", 20], ["SRC-result", 20]]), { classificationArtifact, journeyArtifact });
    for (const id of ["03-business-classification", "04-user-journeys", "04-user-journeys-validation", "orchestrator-next-stage-gaps", "source-inventory"]) missingGap.recordArtifactRead(id);
    missingGap.beginClosure(["SRC-entry", "SRC-result"]);
    missingGap.completeClosure(["SRC-entry", "SRC-result"]);
    expect(() => missingGap.beginArtifactWrite([cases.cases[2]])).toThrow("SCENARIO_CASE_GAP_SOURCE_NOT_READ:SRC-upload");

    const correction = createScenarioCaseStageGuard(sourceArtifact, gaps, new Map([["SRC-entry", 20], ["SRC-upload", 20], ["SRC-result", 20]]), {
      classificationArtifact,
      journeyArtifact,
      additionalInputArtifactIds: ["prior-scenario-cases", "scenario-case-correction-plan"],
      correctionPlan: buildScenarioCaseCorrectionPlan({
        baseArtifactHash: "sha256:base",
        priorArtifact: cases,
        gapDocument: gaps,
        journeyArtifact,
        classificationArtifact,
        sourceArtifact,
      }),
    });
    for (const id of ["03-business-classification", "04-user-journeys", "04-user-journeys-validation", "orchestrator-next-stage-gaps", "source-inventory"]) correction.recordArtifactRead(id);
    expect(() => correction.beginClosure(["SRC-entry"])).toThrow("SCENARIO_CASE_INPUTS_NOT_READ");

    const scopedCorrection = createScenarioCaseStageGuard(sourceArtifact, gaps, new Map([["SRC-entry", 20], ["SRC-upload", 20], ["SRC-result", 20]]), {
      classificationArtifact,
      journeyArtifact,
      additionalInputArtifactIds: ["prior-scenario-cases", "scenario-case-correction-plan"],
      correctionPlan: buildScenarioCaseCorrectionPlan({
        baseArtifactHash: "sha256:base",
        priorArtifact: cases,
        gapDocument: gaps,
        journeyArtifact,
        classificationArtifact,
        sourceArtifact,
      }),
    });
    for (const id of ["03-business-classification", "04-user-journeys", "04-user-journeys-validation", "orchestrator-next-stage-gaps", "source-inventory", "prior-scenario-cases", "scenario-case-correction-plan"]) scopedCorrection.recordArtifactRead(id);
    scopedCorrection.beginClosure(["SRC-upload"]);
    scopedCorrection.completeClosure(["SRC-upload"]);
    expect(() => scopedCorrection.beginArtifactWrite(cases.cases)).not.toThrow();

    const exhaustedCorrection = createScenarioCaseStageGuard(sourceArtifact, gaps, new Map([["SRC-entry", 20], ["SRC-upload", 20], ["SRC-result", 20]]), {
      classificationArtifact,
      journeyArtifact,
      maxArtifactWriteAttempts: 0,
    });
    for (const id of ["03-business-classification", "04-user-journeys", "04-user-journeys-validation", "orchestrator-next-stage-gaps", "source-inventory"]) exhaustedCorrection.recordArtifactRead(id);
    exhaustedCorrection.beginClosure(["SRC-entry", "SRC-upload", "SRC-result"]);
    exhaustedCorrection.completeClosure(["SRC-entry", "SRC-upload", "SRC-result"]);
    expect(() => exhaustedCorrection.beginArtifactWrite(cases.cases)).toThrow("AGENTIC_ARTIFACT_WRITE_ATTEMPTS_EXCEEDED");
    scopedCorrection.requireArtifactRefresh(["prior-scenario-cases", "scenario-case-correction-plan"]);
    scopedCorrection.requireSourceRefresh(["SRC-upload"]);
    expect(() => scopedCorrection.beginArtifactWrite(cases.cases)).toThrow("SCENARIO_CASE_INPUTS_NOT_READ");
    scopedCorrection.recordArtifactRead("prior-scenario-cases");
    scopedCorrection.recordArtifactRead("scenario-case-correction-plan");
    expect(() => scopedCorrection.beginArtifactWrite(cases.cases)).toThrow("SCENARIO_CASE_AREA_SOURCE_NOT_READ:upload");
    scopedCorrection.beginClosure(["SRC-upload"]);
    scopedCorrection.completeClosure(["SRC-upload"]);
    expect(() => scopedCorrection.beginArtifactWrite(cases.cases)).not.toThrow();

    const omitted = createScenarioCaseStageGuard(sourceArtifact, gaps, new Map([["SRC-entry", 20], ["SRC-upload", 20], ["SRC-result", 20]]), { classificationArtifact, journeyArtifact });
    for (const id of ["03-business-classification", "04-user-journeys", "04-user-journeys-validation", "orchestrator-next-stage-gaps", "source-inventory"]) omitted.recordArtifactRead(id);
    omitted.beginClosure(["SRC-entry", "SRC-upload", "SRC-result"]);
    omitted.completeClosure(["SRC-entry", "SRC-result"]);
    expect(() => omitted.beginArtifactWrite(cases.cases)).toThrow("SCENARIO_CASE_AREA_SOURCE_NOT_READ:upload");

    const expandedGrant = createScenarioCaseStageGuard(sourceArtifact, gaps, new Map([["SRC-entry", 20], ["SRC-upload", 20], ["SRC-result", 20]]), { classificationArtifact, journeyArtifact });
    for (const id of ["03-business-classification", "04-user-journeys", "04-user-journeys-validation", "orchestrator-next-stage-gaps", "source-inventory"]) expandedGrant.recordArtifactRead(id);
    expandedGrant.beginClosure(["SRC-entry"]);
    expect(() => expandedGrant.completeClosure(["SRC-entry", "SRC-upload"])).toThrow("AGENTIC_SOURCE_SCOPE_VIOLATION");
  });

  it("allows bounded semantic correction but fails closed for an unknown source area", () => {
    const guard = createScenarioCaseStageGuard(sourceArtifact, gaps, new Map([["SRC-entry", 20], ["SRC-upload", 20], ["SRC-result", 20]]), { classificationArtifact, journeyArtifact });
    for (const id of ["03-business-classification", "04-user-journeys", "04-user-journeys-validation", "orchestrator-next-stage-gaps", "source-inventory"]) guard.recordArtifactRead(id);
    guard.beginClosure(["SRC-entry", "SRC-upload", "SRC-result"]);
    guard.completeClosure(["SRC-entry", "SRC-upload", "SRC-result"]);
    expect(() => guard.beginArtifactWrite(cases.cases)).not.toThrow();
    expect(() => guard.beginArtifactWrite(cases.cases)).not.toThrow();
    guard.completeArtifactWrite();
    expect(guard.summary()).toMatchObject({ artifact_write_attempts: 2, artifact_writes: 1, max_artifact_write_attempts: 3 });

    const unknown = createScenarioCaseStageGuard(sourceArtifact, gaps, new Map([["SRC-entry", 20], ["SRC-upload", 20], ["SRC-result", 20]]), { classificationArtifact, journeyArtifact });
    for (const id of ["03-business-classification", "04-user-journeys", "04-user-journeys-validation", "orchestrator-next-stage-gaps", "source-inventory"]) unknown.recordArtifactRead(id);
    unknown.beginClosure(["SRC-entry", "SRC-upload", "SRC-result"]);
    unknown.completeClosure(["SRC-entry", "SRC-upload", "SRC-result"]);
    const invented = structuredClone(cases.cases);
    invented[0].steps[0].source_area_refs = ["invented"];
    expect(() => unknown.beginArtifactWrite(invented)).toThrow("SCENARIO_CASE_SOURCE_AREA_REF_INVALID:invented");
    expect(isFailClosedScenarioCaseIssue("SCENARIO_CASE_SOURCE_AREA_REF_INVALID:invented")).toBe(true);
  });

  it("accepts normal, boundary, exception, and recovery cases grounded in complete journeys", () => {
    expect(validateScenarioCaseEnvelope(cases, context)).toEqual([]);
  });

  it("audits case coverage against transition refs and excludes unresolved cases from covered totals", () => {
    const candidate = structuredClone(cases);
    const journeyWithTransitions = structuredClone(journeyArtifact);
    journeyWithTransitions.journey.journeys[0].milestones[0].transition_refs = ["T001"];
    journeyWithTransitions.journey.journeys[0].milestones[1].transition_refs = ["T002"];
    journeyWithTransitions.journey.journeys[0].milestones[2].transition_refs = ["T003"];
    journeyWithTransitions.journey.journeys[0].milestones[0].transition_refs.push("T004");
    candidate.cases[0].steps[0].transition_refs = ["T001"];
    candidate.cases[0].steps[1].transition_refs = ["T002"];
    candidate.cases[0].steps[2].transition_refs = ["T003"];
    candidate.cases[2].steps[0].transition_refs = ["T004"];
    const transitionView = {
      obligations: [
        { transition_ref: "T001", scope: "journey", outcome: "normal", feasibility: "source-supported", source_area_refs: ["entry"], source_refs_to_revisit: ["SRC-entry"] },
        { transition_ref: "T002", scope: "view", outcome: "normal", feasibility: "source-supported", source_area_refs: ["upload"], source_refs_to_revisit: ["SRC-upload"] },
        { transition_ref: "T003", scope: "journey", outcome: "exception", feasibility: "runtime-unverified", source_area_refs: ["result"], source_refs_to_revisit: ["SRC-result"] },
        { transition_ref: "T004", scope: "journey", outcome: "exception", feasibility: "runtime-unverified", source_area_refs: ["entry"], source_refs_to_revisit: ["SRC-entry"] },
      ],
      unresolved_interactions: [],
    };

    expect(auditScenarioCaseTransitionLinkage(candidate, journeyWithTransitions, transitionView)).toMatchObject({
      assessment_kind: "lower-bound-transition-linkage",
      executable_coverage_status: "not-measurable",
      total_obligations: 4,
      linked_obligations: 3,
      missing_obligation_refs: ["T003"],
      unresolved_obligation_refs: [],
      unknown_transition_refs: [],
      milestone_mismatches: [],
      outcome_mismatches: [{ case_index: 0, step_position: 3, transition_ref: "T003" }],
      status_conflicts: [],
      source_supported: { total: 2, linked: 2, linkage_percent: 100 },
      runtime_unverified_obligation_refs: ["T003", "T004"],
      non_atomic_step_mappings: [],
    });

    candidate.cases[0].steps[0].transition_refs = ["T001", "T004"];
    expect(auditScenarioCaseTransitionLinkage(candidate, journeyWithTransitions, transitionView).non_atomic_step_mappings)
      .toEqual([{ case_index: 0, step_position: 1, transition_refs: ["T001", "T004"] }]);
    candidate.cases[0].steps[0].transition_refs = ["T001"];

    candidate.cases[0].steps[2].transition_refs = [];
    candidate.cases[1].steps[1].transition_refs = ["T003"];
    journeyWithTransitions.journey.journeys[0].milestones[1].transition_refs = ["T002", "T003"];
    expect(auditScenarioCaseTransitionLinkage(candidate, journeyWithTransitions, transitionView)).toMatchObject({
      linked_obligations: 4,
      missing_obligation_refs: [],
      outcome_mismatches: [],
    });

    candidate.unresolved.push({
      description: "Transition remains unresolved.",
      reason: "Runtime confirmation is unavailable.",
      journey_refs: ["J001"],
      classification_refs: [],
      source_area_refs: ["entry"],
      source_refs_to_revisit: ["SRC-entry"],
      transition_refs: ["T001"],
    });
    expect(auditScenarioCaseTransitionLinkage(candidate, journeyWithTransitions, transitionView).status_conflicts).toEqual(["T001"]);
    candidate.unresolved = [];

    candidate.cases[0].status = "unresolved";
    expect(auditScenarioCaseTransitionLinkage(candidate, journeyWithTransitions, transitionView)).toMatchObject({
      linked_obligations: 2,
      missing_obligation_refs: [],
      unresolved_obligation_refs: ["T001", "T002"],
      source_supported: { total: 2, linked: 0, linkage_percent: 0 },
    });
  });

  it("rejects exception refs claimed by normal cases and conflicting resolved status", () => {
    const candidate = structuredClone(cases);
    const journeyWithTransitions = structuredClone(journeyArtifact);
    journeyWithTransitions.journey.journeys[0].milestones[0].transition_refs = ["T001"];
    candidate.cases[0].steps[0].transition_refs = ["T001"];
    const transitionView = {
      obligations: [{ transition_ref: "T001", scope: "journey", outcome: "exception", feasibility: "runtime-unverified", source_area_refs: ["entry"], source_refs_to_revisit: ["SRC-entry"] }],
      unresolved_interactions: [],
    };

    expect(validateScenarioCaseEnvelope(candidate, { ...context, journeyArtifact: journeyWithTransitions, transitionView })).toEqual(expect.arrayContaining([
      "SCENARIO_CASE_TRANSITION_OUTCOME_MISMATCH:0:1:T001",
      "SCENARIO_CASE_TRANSITION_COVERAGE_MISSING:T001",
    ]));

    transitionView.obligations[0].outcome = "normal";
    candidate.unresolved.push({
      description: "Transition remains unresolved.",
      reason: "Runtime confirmation is unavailable.",
      journey_refs: ["J001"],
      classification_refs: [],
      source_area_refs: ["entry"],
      source_refs_to_revisit: ["SRC-entry"],
      transition_refs: ["T001"],
    });
    expect(validateScenarioCaseEnvelope(candidate, { ...context, journeyArtifact: journeyWithTransitions, transitionView }))
      .toContain("SCENARIO_CASE_TRANSITION_STATUS_CONFLICT:T001");
  });

  it("carries journey-deferred transitions out of the executable case denominator", () => {
    const deferredJourney = structuredClone(journeyArtifact);
    deferredJourney.journey.unresolved.push({
      description: "Runtime reachability is unresolved.",
      reason: "Static source cannot establish it.",
      source_thread_refs: ["Main journey"],
      source_area_refs: ["entry"],
      source_refs_to_revisit: ["SRC-entry"],
      transition_refs: ["T001"],
    });
    const transitionView = {
      obligations: [{ transition_ref: "T001", scope: "journey", outcome: "exception", feasibility: "runtime-unverified", source_area_refs: ["entry"], source_refs_to_revisit: ["SRC-entry"] }],
      unresolved_interactions: [],
    };

    expect(auditScenarioCaseTransitionLinkage(cases, deferredJourney, transitionView)).toMatchObject({
      linked_obligations: 0,
      missing_obligation_refs: [],
      unresolved_obligation_refs: ["T001"],
    });
  });

  it("turns only missing transition obligations into bounded case-step mapping targets", () => {
    const journeyWithTransitions = structuredClone(journeyArtifact);
    journeyWithTransitions.journey.journeys[0].milestones[0].transition_refs = ["T001"];
    journeyWithTransitions.journey.journeys[0].milestones[1].transition_refs = ["T002"];
    const transitionView = {
      obligations: [
        { transition_ref: "T001", scope: "journey", outcome: "normal", feasibility: "source-supported", source_area_refs: ["entry"], source_refs_to_revisit: ["SRC-entry"] },
        { transition_ref: "T002", scope: "view", outcome: "exception", feasibility: "runtime-unverified", source_area_refs: ["upload"], source_refs_to_revisit: ["SRC-upload"] },
      ],
      unresolved_interactions: [],
    };
    const issues = validateScenarioCaseEnvelope(cases, { ...context, journeyArtifact: journeyWithTransitions, transitionView });
    expect(issues).toContain("SCENARIO_CASE_TRANSITION_COVERAGE_MISSING:T001|T002");
    const plan = buildScenarioCaseCorrectionPlan({
      baseArtifactHash: "sha256:base",
      priorArtifact: cases,
      validationIssues: issues.filter((issue) => issue.startsWith("SCENARIO_CASE_TRANSITION_COVERAGE_MISSING")),
      journeyArtifact: journeyWithTransitions,
      classificationArtifact,
      sourceArtifact,
      transitionView,
    });

    expect(plan.targets).toHaveLength(2);
    expect(plan.targets[0]).toMatchObject({
      operation: "map-transition",
      transition_ref: "T001",
      required_source_area_refs: ["entry"],
      required_source_refs: ["SRC-entry"],
    });
    expect(plan.targets[1]).toMatchObject({
      operation: "map-transition",
      transition_ref: "T002",
      required_source_area_refs: ["upload"],
      required_source_refs: ["SRC-upload"],
    });
    expect(plan.targets[1].allowed_case_steps).not.toContainEqual({ case_index: 0, step_position: 2 });

    const patch = {
      schema_version: 1,
      stage: "scenario-case-correction-patch",
      run_id: "RUN-1",
      work_id: "WORK-CASES",
      source_snapshot_ref: "SS-1",
      source_root_hash: "sha256:root",
      base_artifact_hash: "sha256:base",
      changes: [
        { target_ref: "CT001", operation: "map-transition", case_index: 0, step_position: 1 },
        { target_ref: "CT002", operation: "map-transition", case_index: 1, step_position: 2 },
      ],
    };
    const result = applyScenarioCaseCorrectionPatch(cases, patch, plan);
    expect(result.artifact.cases[0].steps[0].transition_refs).toEqual(["T001"]);
    expect(result.artifact.cases[1].steps[1].transition_refs).toEqual(["T002"]);
    expect(result.artifact.cases[2]).toEqual(cases.cases[2]);
    expect(validateScenarioCaseEnvelope(result.artifact, { ...context, journeyArtifact: journeyWithTransitions, transitionView })).toEqual([]);

    const invalid = structuredClone(patch);
    invalid.changes[1] = { target_ref: "CT002", operation: "map-transition", case_index: 0, step_position: 2 };
    expect(() => applyScenarioCaseCorrectionPatch(cases, invalid, plan))
      .toThrow("SCENARIO_CASE_CORRECTION_TRANSITION_MAPPING_NOT_ALLOWED:CT002");
  });

  it("requires normal, boundary, and exception cases for normal journeys and recovery for recovery journeys", () => {
    const missing = { ...cases, cases: cases.cases.filter((entry) => entry.kind !== "boundary" && entry.kind !== "recovery") };
    expect(validateScenarioCaseEnvelope(missing, context)).toEqual(expect.arrayContaining([
      "SCENARIO_CASE_KIND_MISSING:boundary",
      "SCENARIO_CASE_KIND_MISSING:recovery",
      "SCENARIO_CASE_JOURNEY_KIND_MISSING:J001:boundary",
      "SCENARIO_CASE_JOURNEY_KIND_MISSING:J002:recovery",
    ]));
  });

  it("preserves journey classification references and their diverse perspective coverage", () => {
    const invalid = structuredClone(cases);
    invalid.cases[0].classification_refs = ["C001"];
    invalid.cases[1].classification_refs = ["C002"];
    invalid.cases[2].classification_refs = ["C001"];
    expect(validateScenarioCaseEnvelope(invalid, context)).toEqual(expect.arrayContaining([
      "SCENARIO_CASE_CLASSIFICATION_COVERAGE_MISSING:J001:C004",
      "SCENARIO_CASE_PERSPECTIVE_MISSING:1:input-source",
      "SCENARIO_CASE_PERSPECTIVE_MISSING:1:lifecycle-state",
    ]));
    const invented = structuredClone(cases);
    invented.cases[0].classification_refs.push("C009");
    expect(validateScenarioCaseEnvelope(invented, context)).toContain("SCENARIO_CASE_CLASSIFICATION_REF_INVALID:0:C009");
  });

  it("builds a correction plan that limits a gap repair to the affected case field and source", () => {
    const plan = buildScenarioCaseCorrectionPlan({
      baseArtifactHash: "sha256:base",
      priorArtifact: cases,
      gapDocument: gaps,
      journeyArtifact,
      classificationArtifact,
      sourceArtifact,
    });

    expect(plan.targets).toEqual([{
      target_ref: "CT001",
      operation: "update-case",
      case_index: 3,
      journey_ref: "J002",
      kind: "recovery",
      allowed_fields: ["preconditions"],
      reason_codes: ["GAP-UTF8"],
      required_source_area_refs: ["upload"],
      required_source_refs: ["SRC-upload"],
    }]);
  });

  it("repairs only targeted fields and preserves every non-target case exactly", () => {
    const plan = buildScenarioCaseCorrectionPlan({
      baseArtifactHash: "sha256:base",
      priorArtifact: cases,
      gapDocument: gaps,
      journeyArtifact,
      classificationArtifact,
      sourceArtifact,
    });
    const result = applyScenarioCaseCorrectionPatch(cases, {
      schema_version: 1,
      stage: "scenario-case-correction-patch",
      run_id: "RUN-1",
      work_id: "WORK-CASES",
      source_snapshot_ref: "SS-1",
      source_root_hash: "sha256:root",
      base_artifact_hash: "sha256:base",
      changes: [{ target_ref: "CT001", operation: "update-case", fields: { preconditions: ["A corrected, source-backed recovery setup is available."] } }],
    }, plan);

    expect(result.artifact.cases.slice(0, 3)).toEqual(cases.cases.slice(0, 3));
    expect(result.artifact.cases[3]).toEqual({
      ...cases.cases[3],
      preconditions: ["A corrected, source-backed recovery setup is available."],
    });
    expect(result.artifact.unresolved).toEqual(cases.unresolved);
    expect(result.changed_case_indexes).toEqual([3]);

    const forbidden = structuredClone(result.patch);
    forbidden.changes[0].fields = { title: "Unrelated rewrite" };
    expect(() => applyScenarioCaseCorrectionPatch(cases, forbidden, plan)).toThrow("SCENARIO_CASE_CORRECTION_FIELD_NOT_ALLOWED:CT001:title");
    expect(() => applyScenarioCaseCorrectionPatch(cases, { ...result.patch, base_artifact_hash: "sha256:stale" }, plan)).toThrow("SCENARIO_CASE_CORRECTION_BASE_MISMATCH");
  });

  it("revalidates merged evidence while retaining prior grants without rereading unrelated source", () => {
    const priorEvidence = new Map([
      ["EV-prior-entry", evidence("SRC-entry", "Entry.tsx", "prior-entry")],
      ["EV-prior-upload", evidence("SRC-upload", "Upload.tsx", "prior-upload")],
      ["EV-prior-result", evidence("SRC-result", "Result.tsx", "prior-result")],
    ]);
    const priorHydrated = hydrateScenarioCaseEvidence(cases, sourceArtifact, priorEvidence);
    const corrected = structuredClone(cases);
    corrected.cases[3].preconditions = ["A corrected recovery setup is available."];
    const hydrated = hydrateScenarioCaseCorrectionEvidence(corrected, sourceArtifact, {
      priorEvidenceCatalog: priorHydrated.evidence_catalog,
      currentEvidenceByRef: new Map([["EV-current-upload", evidence("SRC-upload", "Upload.tsx", "current-upload")]]),
    });

    expect(hydrated.issues).toEqual([]);
    expect(hydrated.scenario_case_evidence_bindings[3].evidence_refs).toContain("EV-current-upload");
    expect(hydrated.evidence_catalog.map((entry) => entry.evidence_ref).sort()).toEqual([
      "EV-current-upload",
      "EV-prior-entry",
      "EV-prior-result",
      "EV-prior-upload",
    ]);
  });

  it("treats missing case families as bounded additions without rewriting prior cases", () => {
    const breadthGaps = {
      ...gaps,
      gaps: [{
        ...gaps.gaps[0],
        gap_id: "GAP-NORMAL-BREADTH",
        kind: "incomplete-source-distinct-case-breadth",
        affected_sections: ["normal-cases"],
      }],
    };
    const plan = buildScenarioCaseCorrectionPlan({
      baseArtifactHash: "sha256:base",
      priorArtifact: cases,
      gapDocument: breadthGaps,
      journeyArtifact,
      classificationArtifact,
      sourceArtifact,
    });
    expect(plan.targets).toHaveLength(1);
    expect(plan.targets[0]).toMatchObject({ operation: "add-cases", case_index: null, journey_ref: "J001", kind: "normal" });

    const added = { ...structuredClone(cases.cases[0]), title: "A distinct normal source branch" };
    const result = applyScenarioCaseCorrectionPatch(cases, {
      schema_version: 1,
      stage: "scenario-case-correction-patch",
      run_id: "RUN-1",
      work_id: "WORK-CASES",
      source_snapshot_ref: "SS-1",
      source_root_hash: "sha256:root",
      base_artifact_hash: "sha256:base",
      changes: [{ target_ref: "CT001", operation: "add-cases", cases: [correctionAddition(added)] }],
    }, plan);

    expect(result.artifact.cases.slice(0, cases.cases.length)).toEqual(cases.cases);
    expect(result.artifact.cases.at(-1)).toEqual(added);
    expect(result.changed_case_indexes).toEqual([4]);
  });

  it("narrows classification validation errors to only the affected case fields", () => {
    const rejected = structuredClone(cases);
    rejected.cases[1].classification_refs.push("C015");
    rejected.cases[2].classification_refs.push("C031");
    rejected.cases[3].classification_refs.push("C033");
    const plan = buildScenarioCaseCorrectionPlan({
      baseArtifactHash: "sha256:rejected",
      priorArtifact: rejected,
      validationIssues: [
        "SCENARIO_CASE_CLASSIFICATION_REF_INVALID:1:C015",
        "SCENARIO_CASE_CLASSIFICATION_REF_INVALID:2:C031",
        "SCENARIO_CASE_CLASSIFICATION_REF_INVALID:3:C033",
      ],
      journeyArtifact,
      classificationArtifact,
      sourceArtifact,
    });

    expect(plan.targets.map((target) => ({ case_index: target.case_index, allowed_fields: target.allowed_fields }))).toEqual([
      { case_index: 1, allowed_fields: ["classification_refs"] },
      { case_index: 2, allowed_fields: ["classification_refs"] },
      { case_index: 3, allowed_fields: ["classification_refs"] },
    ]);
    expect(plan.targets.every((target) => target.operation === "update-case" && target.required_source_area_refs.length > 0 && target.required_source_refs.length > 0)).toBe(true);
  });

  it("retains successful correction targets and retries only the case that failed validation", () => {
    const breadthGaps = {
      ...gaps,
      gaps: [{
        ...gaps.gaps[0],
        gap_id: "GAP-CASE-BREADTH",
        kind: "incomplete-source-distinct-case-breadth",
        affected_sections: ["normal-cases", "boundary-cases"],
      }],
    };
    const plan = buildScenarioCaseCorrectionPlan({
      baseArtifactHash: "sha256:base",
      priorArtifact: cases,
      gapDocument: breadthGaps,
      journeyArtifact,
      classificationArtifact,
      sourceArtifact,
    });
    const normal = { ...structuredClone(cases.cases[0]), title: "A valid added normal case" };
    const invalidBoundary = { ...structuredClone(cases.cases[1]), title: "An invalid added boundary case", classification_refs: [...cases.cases[1].classification_refs, "C009"] };
    const patch = {
      schema_version: 1,
      stage: "scenario-case-correction-patch",
      run_id: "RUN-1",
      work_id: "WORK-CASES",
      source_snapshot_ref: "SS-1",
      source_root_hash: "sha256:root",
      base_artifact_hash: "sha256:base",
      changes: [
        { target_ref: plan.targets[0].target_ref, operation: "add-cases", cases: [correctionAddition(normal)] },
        { target_ref: plan.targets[1].target_ref, operation: "add-cases", cases: [correctionAddition(invalidBoundary)] },
      ],
    };
    const application = applyScenarioCaseCorrectionPatch(cases, patch, plan);
    const failedTargetRefs = scenarioCaseCorrectionTargetRefsForIssues(
      ["SCENARIO_CASE_CLASSIFICATION_REF_INVALID:5:C009"],
      application,
      plan,
      { knownClassificationRefs: new Set(buildScenarioCaseJourneyView(journeyArtifact, classificationArtifact, sourceArtifact).classification_catalog.map((entry) => entry.classification_ref)) },
    );
    expect(() => scenarioCaseCorrectionTargetRefsForIssues(
      ["SCENARIO_CASE_CLASSIFICATION_REF_INVALID:5:C999"],
      application,
      plan,
      { knownClassificationRefs: new Set(buildScenarioCaseJourneyView(journeyArtifact, classificationArtifact, sourceArtifact).classification_catalog.map((entry) => entry.classification_ref)) },
    )).toThrow("SCENARIO_CASE_CLASSIFICATION_REF_INVALID");
    const retained = retainSuccessfulScenarioCaseCorrections(cases, patch, plan, failedTargetRefs);

    expect(failedTargetRefs).toEqual([plan.targets[1].target_ref]);
    expect(retained.artifact.cases).toEqual([...cases.cases, normal]);
    expect(retained.changed_case_indexes).toEqual([4]);
    expect(retained.remaining_plan.targets).toEqual([{ ...plan.targets[1], case_limit: 1 }]);
  });

  it("retains valid sibling additions when one case in the same target fails", () => {
    const breadthGaps = {
      ...gaps,
      gaps: [{
        ...gaps.gaps[0],
        gap_id: "GAP-NORMAL-BREADTH",
        kind: "incomplete-source-distinct-case-breadth",
        affected_sections: ["normal-cases"],
      }],
    };
    const plan = buildScenarioCaseCorrectionPlan({
      baseArtifactHash: "sha256:base",
      priorArtifact: cases,
      gapDocument: breadthGaps,
      journeyArtifact,
      classificationArtifact,
      sourceArtifact,
    });
    const valid = { ...structuredClone(cases.cases[0]), title: "A valid sibling normal case" };
    const invalid = { ...structuredClone(cases.cases[0]), title: "An invalid sibling normal case", classification_refs: [...cases.cases[0].classification_refs, "C009"] };
    const patch = {
      schema_version: 1,
      stage: "scenario-case-correction-patch",
      run_id: "RUN-1",
      work_id: "WORK-CASES",
      source_snapshot_ref: "SS-1",
      source_root_hash: "sha256:root",
      base_artifact_hash: "sha256:base",
      changes: [{ target_ref: plan.targets[0].target_ref, operation: "add-cases", cases: [correctionAddition(valid), correctionAddition(invalid)] }],
    };
    const application = applyScenarioCaseCorrectionPatch(cases, patch, plan);
    const failures = scenarioCaseCorrectionFailuresForIssues(
      ["SCENARIO_CASE_CLASSIFICATION_REF_INVALID:5:C009"],
      application,
      plan,
      { knownClassificationRefs: new Set(buildScenarioCaseJourneyView(journeyArtifact, classificationArtifact, sourceArtifact).classification_catalog.map((entry) => entry.classification_ref)) },
    );
    const retained = retainSuccessfulScenarioCaseCorrections(cases, patch, plan, failures);

    expect(failures).toEqual([{
      target_ref: plan.targets[0].target_ref,
      failed_case_indexes: [5],
      issues: ["SCENARIO_CASE_CLASSIFICATION_REF_INVALID:5:C009"],
      reject_all: false,
    }]);
    expect(retained.artifact.cases).toEqual([...cases.cases, valid]);
    expect(retained.changed_case_indexes).toEqual([4]);
    expect(retained.remaining_plan.targets).toEqual([{
      ...plan.targets[0],
      reason_codes: ["GAP-NORMAL-BREADTH", "SCENARIO_CASE_CLASSIFICATION_REF_INVALID:5:C009"],
      case_limit: 1,
    }]);

    const overbroadRetry = {
      ...patch,
      base_artifact_hash: retained.remaining_plan.base_artifact_hash,
      changes: [{ target_ref: plan.targets[0].target_ref, operation: "add-cases", cases: [correctionAddition(valid), correctionAddition(valid)] }],
    };
    expect(() => applyScenarioCaseCorrectionPatch(retained.artifact, overbroadRetry, retained.remaining_plan)).toThrow("SCENARIO_CASE_CORRECTION_ADDITION_LIMIT_EXCEEDED:CT001");
  });

  it("retains valid targets when another correction change fails compilation", () => {
    const breadthGaps = {
      ...gaps,
      gaps: [{
        ...gaps.gaps[0],
        gap_id: "GAP-CASE-BREADTH",
        kind: "incomplete-source-distinct-case-breadth",
        affected_sections: ["normal-cases", "boundary-cases"],
      }],
    };
    const plan = buildScenarioCaseCorrectionPlan({
      baseArtifactHash: "sha256:base",
      priorArtifact: cases,
      gapDocument: breadthGaps,
      journeyArtifact,
      classificationArtifact,
      sourceArtifact,
    });
    const invalidNormal = correctionAddition({ ...structuredClone(cases.cases[0]), title: "Invalid normal addition" });
    invalidNormal.variation = { milestone_position: 2, condition: "Invalid normal variation", expected_outcome: "Invalid", recovery_action: null };
    const validBoundary = { ...structuredClone(cases.cases[1]), title: "Valid boundary addition" };
    const patch = {
      schema_version: 1,
      stage: "scenario-case-correction-patch",
      run_id: "RUN-1",
      work_id: "WORK-CASES",
      source_snapshot_ref: "SS-1",
      source_root_hash: "sha256:root",
      base_artifact_hash: "sha256:base",
      changes: [
        { target_ref: plan.targets[0].target_ref, operation: "add-cases", cases: [invalidNormal] },
        { target_ref: plan.targets[1].target_ref, operation: "add-cases", cases: [correctionAddition(validBoundary)] },
      ],
    };
    let compileError: unknown;
    try {
      applyScenarioCaseCorrectionPatch(cases, patch, plan);
    } catch (error) {
      compileError = error;
    }
    const failures = scenarioCaseCorrectionCompileFailures(compileError, cases, patch, plan);
    const retained = retainSuccessfulScenarioCaseCorrections(cases, patch, plan, failures);

    expect(isPersistableScenarioCaseCorrectionPatch(patch)).toBe(true);
    expect(failures).toEqual([{
      target_ref: plan.targets[0].target_ref,
      failed_case_indexes: [],
      issues: ["SCENARIO_CASE_CORRECTION_ADDITION_INVALID:CT001"],
      reject_all: true,
    }]);
    expect(retained.artifact.cases).toEqual([...cases.cases, validBoundary]);
    expect(retained.remaining_plan.targets).toEqual([{
      ...plan.targets[0],
      reason_codes: ["GAP-CASE-BREADTH", "SCENARIO_CASE_CORRECTION_ADDITION_INVALID:CT001"],
      case_limit: 1,
    }]);
  });

  it("attributes an indexed field failure to its field target when transition targets share the case", () => {
    const plan = {
      targets: [
        { target_ref: "CT001", operation: "update-case", case_index: 0, allowed_fields: ["classification_refs"] },
        { target_ref: "CT002", operation: "map-transition", transition_ref: "T001" },
      ],
    };
    const application = {
      artifact: cases,
      target_case_indexes: [
        { target_ref: "CT001", case_indexes: [0] },
        { target_ref: "CT002", case_indexes: [0] },
      ],
    };

    expect(scenarioCaseCorrectionFailuresForIssues(
      ["SCENARIO_CASE_CLASSIFICATION_REF_INVALID:0:C002"],
      application,
      plan,
      { knownClassificationRefs: new Set(["C002"]) },
    )).toEqual([{
      target_ref: "CT001",
      failed_case_indexes: [0],
      issues: ["SCENARIO_CASE_CLASSIFICATION_REF_INVALID:0:C002"],
      reject_all: false,
    }]);
  });

  it("replays a rejected patch and resumes with only its failed target", () => {
    const plan = {
      schema_version: 1,
      stage: "scenario-case-correction-plan",
      base_artifact_hash: "sha256:base",
      targets: [
        { target_ref: "CT001", operation: "update-case", case_index: 0, journey_ref: "J001", kind: "normal", allowed_fields: ["title"], reason_codes: ["GAP-1"], required_source_area_refs: ["entry"], required_source_refs: ["SRC-entry"] },
        { target_ref: "CT002", operation: "update-case", case_index: 1, journey_ref: "J001", kind: "boundary", allowed_fields: ["title"], reason_codes: ["GAP-2"], required_source_area_refs: ["entry"], required_source_refs: ["SRC-entry"] },
      ],
    };
    const patch = {
      schema_version: 1,
      stage: "scenario-case-correction-patch",
      run_id: "RUN-1",
      work_id: "WORK-CASES",
      source_snapshot_ref: "SS-1",
      source_root_hash: "sha256:root",
      base_artifact_hash: "sha256:base",
      changes: [
        { target_ref: "CT001", operation: "update-case", fields: { title: "Corrected normal title" } },
        { target_ref: "CT002", operation: "update-case", fields: { title: cases.cases[1].title } },
      ],
    };
    const retryPlan = {
      ...plan,
      base_artifact_hash: "sha256:retained",
      targets: [{ ...plan.targets[1], reason_codes: ["GAP-2", "SCENARIO_CASE_CORRECTION_UNCHANGED:CT002"] }],
    };

    const replayed = replayScenarioCaseCorrectionAttempts({
      baseArtifact: cases,
      initialPlan: plan,
      attempts: [{
        patch,
        validation: { pass: false, issues: ["SCENARIO_CASE_CORRECTION_UNCHANGED"], failed_target_refs: ["CT002"], failed_case_indexes: [] },
        retryPlan,
      }],
      artifactHash: () => "sha256:retained",
    });

    expect(replayed.artifact.cases[0].title).toBe("Corrected normal title");
    expect(replayed.artifact.cases[1]).toEqual(cases.cases[1]);
    expect(replayed.remainingPlan).toEqual(retryPlan);
    expect(replayed.changedCaseIndexes).toEqual([0]);
  });

  it("replays a conservative reject-all decision without retaining unrelated targets", () => {
    const plan = {
      schema_version: 1,
      stage: "scenario-case-correction-plan",
      base_artifact_hash: "sha256:base",
      targets: [
        { target_ref: "CT001", operation: "update-case", case_index: 0, journey_ref: "J001", kind: "normal", allowed_fields: ["title"], reason_codes: ["GAP-1"], required_source_area_refs: ["entry"], required_source_refs: ["SRC-entry"] },
        { target_ref: "CT002", operation: "update-case", case_index: 1, journey_ref: "J001", kind: "boundary", allowed_fields: ["title"], reason_codes: ["GAP-2"], required_source_area_refs: ["entry"], required_source_refs: ["SRC-entry"] },
      ],
    };
    const patch = {
      schema_version: 1,
      stage: "scenario-case-correction-patch",
      run_id: "RUN-1",
      work_id: "WORK-CASES",
      source_snapshot_ref: "SS-1",
      source_root_hash: "sha256:root",
      base_artifact_hash: "sha256:base",
      changes: [
        { target_ref: "CT001", operation: "update-case", fields: { title: "Corrected normal title" } },
        { target_ref: "CT002", operation: "update-case", fields: { title: cases.cases[1].title } },
      ],
    };
    const retryPlan = {
      ...plan,
      targets: [
        plan.targets[0],
        { ...plan.targets[1], reason_codes: ["GAP-2", "SCENARIO_CASE_CORRECTION_UNCHANGED:CT002"] },
      ],
    };

    const replayed = replayScenarioCaseCorrectionAttempts({
      baseArtifact: cases,
      initialPlan: plan,
      attempts: [{
        patch,
        validation: {
          pass: false,
          issues: ["SCENARIO_CASE_CORRECTION_UNCHANGED"],
          reject_all_targets: true,
          failed_target_refs: ["CT001", "CT002"],
          failed_case_indexes: [],
        },
        retryPlan,
      }],
      artifactHash: () => "sha256:base",
    });

    expect(replayed.artifact).toEqual(cases);
    expect(replayed.remainingPlan).toEqual(retryPlan);
    expect(replayed.changedCaseIndexes).toEqual([]);
  });

  it("requires ordered steps and explicit success or expected-failure terminals", () => {
    const broken = structuredClone(cases);
    broken.cases[0].steps[1].position = 9;
    broken.cases[0].terminal.final_step_position = 3;
    broken.cases[1].terminal.kind = "business-result-and-exit";
    expect(validateScenarioCaseEnvelope(broken, context)).toEqual(expect.arrayContaining([
      "SCENARIO_CASE_STEP_SEQUENCE_INVALID:0",
      "SCENARIO_CASE_TERMINAL_INVALID:0",
      "SCENARIO_CASE_SUCCESS_PATH_INCOMPLETE:1",
    ]));

    const malformedStep = structuredClone(cases);
    malformedStep.cases[0].steps[0].action = "";
    malformedStep.cases[0].steps[0].source_area_refs = [];
    expect(validateScenarioCaseEnvelope(malformedStep, context)).toContain("SCENARIO_CASE_ENTRY_INVALID");
  });

  it("requires a recovery case to traverse failure, recovery, rejoin, result, and exit", () => {
    const broken = structuredClone(cases);
    broken.cases[3].steps = broken.cases[3].steps.filter((entry) => entry.journey_milestone_position !== 4);
    broken.cases[3].steps.forEach((entry, index) => { entry.position = index + 1; });
    broken.cases[3].terminal.final_step_position = broken.cases[3].steps.length;
    expect(validateScenarioCaseEnvelope(broken, context)).toContain("SCENARIO_CASE_RECOVERY_PATH_INCOMPLETE:3");
  });

  it("rejects unknown milestone refs, model-owned IDs, secrets, raw source, and invalid unresolved refs", () => {
    const invalidMilestone = structuredClone(cases);
    invalidMilestone.cases[0].steps[0].journey_milestone_position = 99;
    expect(validateScenarioCaseEnvelope(invalidMilestone, context)).toContain("SCENARIO_CASE_MILESTONE_REF_INVALID:0:99");
    const modelId = structuredClone(cases);
    Object.assign(modelId.cases[0], { scenario_id: "SCN-model" });
    expect(validateScenarioCaseEnvelope(modelId, context)).toContain("SCENARIO_CASE_ARTIFACT_INVALID");
    const secret = structuredClone(cases);
    secret.cases[0].title = 'api_key="definitely-secret-value"';
    expect(validateScenarioCaseEnvelope(secret, context)).toContain("SCENARIO_CASE_ENTRY_INVALID");
    const unresolved = { ...cases, unresolved: [{ description: "Unknown", reason: "Not established", journey_refs: ["J999"], classification_refs: ["C999"], source_area_refs: ["unknown"], source_refs_to_revisit: ["SRC-unknown"] }] };
    expect(validateScenarioCaseEnvelope(unresolved, context)).toEqual(expect.arrayContaining([
      "SCENARIO_CASE_UNRESOLVED_JOURNEY_REF_INVALID:J999",
      "SCENARIO_CASE_UNRESOLVED_CLASSIFICATION_REF_INVALID:C999",
      "SCENARIO_CASE_UNRESOLVED_AREA_REF_INVALID:unknown",
      "SCENARIO_CASE_SOURCE_REF_INVALID:SRC-unknown",
    ]));
    const raw = structuredClone(cases);
    raw.cases[0].preconditions = ["A very long original source line copied byte for byte into the generated scenario case should be rejected by the raw source overlap gate."];
    expect(validateScenarioCaseEnvelope(raw, { ...context, grantedSourceContents: [raw.cases[0].preconditions[0]] })).toContain("SCENARIO_CASE_RAW_SOURCE_COPIED");
  });

  it("binds backend-owned current evidence to every case step", () => {
    const hydrated = hydrateScenarioCaseEvidence(cases, sourceArtifact, new Map([
      ["EV-C-entry", evidence("SRC-entry", "Entry.tsx", "case-entry")],
      ["EV-C-upload", evidence("SRC-upload", "Upload.tsx", "case-upload")],
      ["EV-C-result", evidence("SRC-result", "Result.tsx", "case-result")],
    ]));
    expect(hydrated.issues).toEqual([]);
    expect(hydrated.scenario_case_evidence_bindings).toHaveLength(4);
    expect(hydrated.scenario_case_evidence_bindings.flatMap((entry) => entry.steps).every((entry) => entry.evidence_refs.length > 0)).toBe(true);
    expect(hydrated.evidence_catalog).toHaveLength(3);
  });

  it("keeps the Pi runner free of golden data and backend-owned executable fields", async () => {
    const source = await readFile(new URL("../../scripts/run-staged-axse-scenario-cases.mjs", import.meta.url), "utf8");
    expect(source).toContain('"stage": "scenario-cases"');
    expect(source).toContain("normal, boundary, exception, and recovery");
    expect(source).toContain("user-role, authorization-scope, business-responsibility, workflow-stage, lifecycle-state, data-domain, channel-surface, input-source, output-deliverable, integration-boundary, and risk-recovery");
    expect(source).toContain("A rejected semantic submission may be corrected");
    expect(source).toContain("classification_refs_by_perspective");
    expect(source).toContain("classifications_by_journey");
    expect(source).toContain("matching journey_ref group in classifications_by_journey");
    expect(source).not.toContain("classifications: projected.classification_catalog");
    expect(source).toContain("queueMicrotask");
    expect(source).toContain("stageGuard.summary().fatal_error");
    expect(source).toContain('option("--gap-file")');
    expect(source).toContain('option("--correction-from")');
    expect(source).toContain('option("--journey-from")');
    expect(source).toContain('option("--resume-from")');
    expect(source).toContain('"prior-scenario-cases"');
    expect(source).toContain('"scenario-case-correction-plan"');
    expect(source).toContain('"stage": "scenario-case-correction-patch"');
    expect(source).toContain('"operation":"map-transition"');
    expect(source).toContain("source-transition-obligations");
    expect(source).toContain("transition_inventory_hash");
    expect(source).toContain("applyScenarioCaseCorrectionPatch");
    expect(source).toContain("scenarioCaseCorrectionFailuresForIssues");
    expect(source).toContain("retainSuccessfulScenarioCaseCorrections");
    expect(source).toContain("const remainingArtifactWriteAttempts = Math.max(0, 3 - resumedAttemptCount)");
    expect(source).toContain('if (correctionPlan && remainingArtifactWriteAttempts === 0) throw new Error("AGENTIC_ARTIFACT_WRITE_ATTEMPTS_EXCEEDED")');
    expect(source).toContain("maxArtifactWriteAttempts: remainingArtifactWriteAttempts");
    expect(source).toContain("hydrateScenarioCaseCorrectionEvidence");
    expect(source).toContain("artifact_revision");
    expect(source).not.toContain('writeJson(join(scope.outputRoot, "run.json")');
    expect(source).toContain("transition_linkage: transitionLinkage");
    expect(source).not.toContain("transition_coverage: transitionAudit");
    expect(source).toContain("one concrete branch condition per case");
    expect(source).toContain("Use only these exact artifact IDs");
    expect(source).toContain("requested_artifact_id: id");
    expect(source).toContain("priorValidation?.artifact_hash !== priorArtifactHash");
    expect(source).toContain('priorValidation?.validation_scope !== "local-probe-contract-only"');
    expect(source).toContain('priorValidation?.product_stage_acceptance !== "not-attempted"');
    expect(source).toContain("priorArtifact?.provenance?.granted_evidence_refs");
    expect(source).toContain("priorArtifact?.provenance?.inherited_evidence_refs");
    expect(source).toContain("priorArtifact.scenario_cases");
    expect(source).toContain("already_granted: true");
    expect(source).not.toMatch(/golden|scenario_id|target_candidates|screen_ref|element_ref|api_ref|edge_ref|workflow_ref/i);
    expect(source).toContain("verifyPersistedReferences");
    expect(stableAgenticErrorCode(new Error("SCENARIO_CASE_AREA_SOURCE_NOT_READ:upload raw detail"))).toBe("SCENARIO_CASE_AREA_SOURCE_NOT_READ");
    expect(stableAgenticErrorCode(new Error("GRAPH_SCENARIO_EXTENSION_BASE_DRIFT:private detail"))).toBe("GRAPH_SCENARIO_EXTENSION_BASE_DRIFT");
  });

  it("accepts only bounded correction input basenames", () => {
    expect(validateScenarioCaseJourneyDirectory()).toBe("04-user-journeys");
    expect(validateScenarioCaseJourneyDirectory("04-user-journeys-transition-correction-01"))
      .toBe("04-user-journeys-transition-correction-01");
    expect(() => validateScenarioCaseJourneyDirectory("../04-user-journeys"))
      .toThrow("SCENARIO_CASE_JOURNEY_INPUT_INVALID");
    expect(validateScenarioCaseCorrectionOptions({})).toEqual({
      gapFilename: "orchestrator-next-stage-gaps.json",
      priorDirectory: null,
      resumeDirectory: null,
    });
    expect(validateScenarioCaseCorrectionOptions({
      gapFilename: "orchestrator-scenario-breadth-gaps.json",
      priorDirectory: "05-scenario-cases-external-evaluation-failed-02",
      resumeDirectory: "05-scenario-cases-partial-failed-03",
    })).toEqual({
      gapFilename: "orchestrator-scenario-breadth-gaps.json",
      priorDirectory: "05-scenario-cases-external-evaluation-failed-02",
      resumeDirectory: "05-scenario-cases-partial-failed-03",
    });
    expect(() => validateScenarioCaseCorrectionOptions({ gapFilename: "../../secret.json", priorDirectory: "05-scenario-cases-failed" })).toThrow("SCENARIO_CASE_CORRECTION_INPUT_INVALID");
    expect(() => validateScenarioCaseCorrectionOptions({ gapFilename: "orchestrator-gaps.json" })).toThrow("SCENARIO_CASE_CORRECTION_INPUT_INVALID");
    expect(() => validateScenarioCaseCorrectionOptions({ resumeDirectory: "05-scenario-cases-partial-failed-03" })).toThrow("SCENARIO_CASE_CORRECTION_INPUT_INVALID");
  });

  it("keeps graph scenario structure backend-owned and gives Luna narration fields only", async () => {
    const source = await readFile(new URL("../../scripts/run-staged-axse-graph-scenario-cases.mjs", import.meta.url), "utf8");
    expect(source).toContain("compileScenarioSkeleton");
    expect(source).toContain("compileJourneyScenarioBindings");
    expect(source).toContain("createScenarioCompositionPayload");
    expect(source).toContain("applyScenarioNarrationPatch");
    expect(source).toContain("validateScenarioSet");
    expect(source).toContain("The model may rewrite narration fields only");
    expect(source).toContain('option("--extend-from")');
    expect(source).toContain("GRAPH_SCENARIO_EXTENSION_BASE_DRIFT");
    expect(source).toContain("GRAPH_SCENARIO_EXTENSION_NARRATION_DRIFT");
    expect(source).toContain('out_of_scope_preservation: "verified"');
    expect(source).not.toContain("golden");
  });

  it("keeps golden comparison isolated from generation and validates both journey and case recall", async () => {
    const source = await readFile(new URL("../../scripts/run-staged-axse-golden-evaluation.mjs", import.meta.url), "utf8");
    expect(source).toContain("evaluateGoldenSimilarity");
    expect(source).toContain("evaluateGoldenScenarioSimilarity");
    expect(source).toContain("evaluateGoldenScenarioPriority");
    expect(source).toContain("required_golden_refs");
    expect(source).toContain('resilience_scenario_recall: "advisory"');
    expect(source).toContain('option("--taxonomy-assessment-from")');
    expect(source).toContain('option("--taxonomy-assessment-failed-from")');
    expect(source).toContain('option("--scenario-assessment-from")');
    expect(source).toContain('option("--scenario-assessment-reuse-from")');
    expect(source).toContain("createGoldenScenarioAssessmentCorrectionPlan");
    expect(source).toContain("applyGoldenScenarioAssessmentCorrectionPatch");
    expect(source).toContain("backend.assessment.correction-merge");
    expect(source).toContain("taxonomyWrite.content_hash !== sourceAssessment.hash");
    expect(source).toContain("rejectedWrite?.content_hash !== rejectedAssessment.hash");
    expect(source).toContain('out_of_scope_preservation: "verified"');
    expect(source).toContain("GOLDEN_TAXONOMY_ASSESSMENT_REUSE_INVALID");
    expect(source).toContain("GOLDEN_SCENARIO_ASSESSMENT_CORRECTION_INVALID");
    expect(source).toContain("golden-performance-report.json");
    expect(source).toContain('evaluation_policy: "success-first-v1"');
    expect(source).toContain("parseGoldenDatasetMarkdown");
    expect(source).toContain("GOLDEN_INPUT_PROVENANCE_INVALID");
    expect(source).not.toContain("compileScenarioSkeleton");
    expect(source).not.toContain('join(scope.outputRoot, "run.json")');
  });

  it("rejects correction inputs that escape the run through symbolic links", async () => {
    const runRoot = await mkdtemp(join(tmpdir(), "scenarioforge-scenario-correction-"));
    const journeyRoot = join(runRoot, "04-user-journeys");
    const priorRoot = join(runRoot, "05-scenario-cases-reviewed");
    const resumeRoot = join(runRoot, "05-scenario-cases-partial-failed");
    const gapPath = join(journeyRoot, "orchestrator-scenario-breadth-gaps.json");
    await mkdir(journeyRoot);
    await mkdir(priorRoot);
    await mkdir(resumeRoot);
    await writeFile(gapPath, "{}\n");

    await expect(validateScenarioCaseCorrectionPaths({ runRoot, gapPath, priorRoot, resumeRoot })).resolves.toBeUndefined();

    const outside = await mkdtemp(join(tmpdir(), "scenarioforge-scenario-outside-"));
    const outsidePrior = join(outside, "prior");
    await mkdir(outsidePrior);
    const linkedPrior = join(runRoot, "05-scenario-cases-linked");
    await symlink(outsidePrior, linkedPrior);
    await expect(validateScenarioCaseCorrectionPaths({ runRoot, gapPath, priorRoot: linkedPrior })).rejects.toThrow("SCENARIO_CASE_CORRECTION_PATH_INVALID");
    await expect(validateScenarioCaseCorrectionPaths({ runRoot, gapPath, priorRoot, resumeRoot: linkedPrior })).rejects.toThrow("SCENARIO_CASE_CORRECTION_PATH_INVALID");

    const outsideGap = join(outside, "gap.json");
    await writeFile(outsideGap, "{}\n");
    const linkedGap = join(journeyRoot, "orchestrator-linked-gaps.json");
    await symlink(outsideGap, linkedGap);
    await expect(validateScenarioCaseCorrectionPaths({ runRoot, gapPath: linkedGap, priorRoot })).rejects.toThrow("SCENARIO_CASE_CORRECTION_PATH_INVALID");
  });
});
