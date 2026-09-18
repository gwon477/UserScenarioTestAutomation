import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyUserJourneyTransitionMappingPatch,
  buildUserJourneyClassificationView,
  createUserJourneyWorkflowLinkCorrectionPlan,
  buildUserJourneyWorkflowLinkPlan,
  buildUserJourneyTransitionMappingPlan,
  classifyUserJourneyArtifactRequest,
  createUserJourneyStageGuard,
  hydrateUserJourneyEvidence,
  isFailClosedUserJourneyIssue,
  retainSuccessfulUserJourneyTransitionMappings,
  compileUserJourneyWorkflowLinks,
  applyUserJourneyWorkflowLinkCorrectionPatch,
  userJourneyPermittedSourceRefs,
  validateUserJourneyEnvelope,
  validateUserJourneyInputs,
  validateUserJourneyWorkflowLinkPatch,
  auditUserJourneyTransitionCoverage,
  userJourneyTransitionMappingCompileFailures,
} from "../../scripts/staged-agent-analysis-contract.mjs";
import {
  stableAgenticErrorCode,
  validateUserJourneyTransitionCorrectionOptions,
  validateUserJourneyTransitionCorrectionPaths,
} from "../../scripts/staged-agent-run-support.mjs";

const sourceArtifact = {
  schema_version: 1,
  run_id: "RUN-1",
  model_id: "gpt-test",
  artifact_status: "locally-validated-unregistered-probe",
  provenance: {
    project_id: "P-1",
    work_id: "WORK-GAP",
    source_snapshot_id: "SS-1",
    source_root_hash: "sha256:root",
    extends_artifact_id: "01-source-survey",
    extends_artifact_hash: "sha256:survey",
    generated_with: "pi-coding-agent",
    resolved_gap_ids: [],
    granted_evidence_refs: ["EV-gap"],
    inherited_evidence_refs: ["EV-login", "EV-result"],
  },
  correction: {
    schema_version: 1,
    stage: "source-gap-review",
    run_id: "RUN-1",
    work_id: "WORK-GAP",
    source_snapshot_ref: "SS-1",
    source_root_hash: "sha256:root",
    extends_artifact_id: "01-source-survey",
    extends_artifact_hash: "sha256:survey",
    source_area_upserts: [],
    journey_thread_upserts: [],
    resolved_gap_ids: [],
    additional_source_gaps: [],
    evidence_refs: [],
  },
  survey: {
    schema_version: 1,
    stage: "source-survey",
    source_snapshot_ref: "SS-1",
    source_areas: [
      {
        area_key: "entry",
        label: "Application entry",
        purpose: "Enter the workspace",
        user_visible_surfaces: ["Login"],
        entry_points: ["Launch"],
        actions: ["Authenticate"],
        observable_outcomes: ["Workspace appears"],
        business_outputs: ["Session"],
        recovery_paths: ["Retry login"],
        exit_paths: ["Logout"],
        evidence_refs: ["EV-login"],
      },
      {
        area_key: "result",
        label: "Business result",
        purpose: "Produce and download the result",
        user_visible_surfaces: ["Results"],
        entry_points: ["Open results"],
        actions: ["Generate", "Download"],
        observable_outcomes: ["Result appears"],
        business_outputs: ["Export"],
        recovery_paths: ["Retry failed input"],
        exit_paths: ["Return to shell"],
        evidence_refs: ["EV-result"],
      },
    ],
    journey_threads: [
      {
        name: "Main journey",
        starts_at: "Application login",
        ordered_milestones: ["Login", "Generate", "Download", "Logout"],
        furthest_business_outcome: "Downloaded result",
        exit_or_handoff: "Logout",
        evidence_refs: ["EV-login", "EV-result"],
      },
      {
        name: "Preview fragment",
        starts_at: "Result preview button",
        ordered_milestones: ["Open preview", "Close preview"],
        furthest_business_outcome: "Preview visible",
        exit_or_handoff: "Remain on results",
        evidence_refs: ["EV-result"],
      },
      {
        name: "Recovery journey",
        starts_at: "Application login",
        ordered_milestones: ["Login", "Failure", "Retry", "Generate", "Download", "Logout"],
        furthest_business_outcome: "Downloaded result after recovery",
        exit_or_handoff: "Logout",
        evidence_refs: ["EV-login", "EV-result"],
      },
    ],
    supporting_systems: [],
    source_gaps: [{
      question: "How are partial failures retried?",
      reason: "The exact preservation rule is not visible.",
      affected_sections: ["journey_threads:Recovery journey"],
      source_refs_to_revisit: ["SRC-retry"],
    }],
    excluded_as_internal: [],
  },
  evidence_catalog: [
    { evidence_ref: "EV-login", evidence: { source_id: "SRC-login", source_snapshot_id: "SS-1", path: "Login.tsx", start_line: 1, end_line: 20, content_hash: "sha256:login", evidence_grant_id: "EVG-login" } },
    { evidence_ref: "EV-result", evidence: { source_id: "SRC-result", source_snapshot_id: "SS-1", path: "Result.tsx", start_line: 1, end_line: 20, content_hash: "sha256:result", evidence_grant_id: "EVG-result" } },
    { evidence_ref: "EV-gap", evidence: { source_id: "SRC-result", source_snapshot_id: "SS-1", path: "Result.tsx", start_line: 21, end_line: 40, content_hash: "sha256:gap", evidence_grant_id: "EVG-gap" } },
  ],
};

const perspectives = ["user-role", "authorization-scope", "organization-scope", "business-capability", "business-responsibility", "workflow-stage", "lifecycle-state", "data-domain", "channel-surface", "input-source", "output-deliverable", "integration-boundary", "risk-recovery", "compliance-policy"];
const classifiedPerspectives = new Set(["user-role", "business-capability", "workflow-stage", "output-deliverable", "risk-recovery"]);
const semanticClassification = {
  schema_version: 1,
  stage: "business-classification",
  run_id: "RUN-1",
  work_id: "WORK-BC",
  source_snapshot_ref: "SS-1",
  source_root_hash: "sha256:root",
  extends_artifact_id: "02-source-gap-review",
  extends_artifact_hash: "sha256:source",
  perspective_assessments: perspectives.map((perspective) => ({
    perspective,
    perspective_label: perspective,
    decision: classifiedPerspectives.has(perspective) ? "classified" : "not-evidenced",
    rationale: classifiedPerspectives.has(perspective) ? "The source supports this perspective." : "The source does not establish this perspective.",
  })),
  classifications: [
    { perspective: "business-capability", perspective_label: "business-capability", label: "Enter workspace", description: "Start the work.", user_responsibilities: ["Authenticate"], source_area_refs: ["entry"], journey_thread_refs: ["Main journey", "Recovery journey"], business_outcomes: ["Session"] },
    { perspective: "business-capability", perspective_label: "business-capability", label: "Produce result", description: "Generate the result.", user_responsibilities: ["Generate"], source_area_refs: ["result"], journey_thread_refs: ["Main journey", "Preview fragment", "Recovery journey"], business_outcomes: ["Export"] },
    { perspective: "user-role", perspective_label: "user-role", label: "Operator", description: "Operates the main journey.", user_responsibilities: ["Complete work"], source_area_refs: ["entry", "result"], journey_thread_refs: ["Main journey"], business_outcomes: ["Export"] },
    { perspective: "output-deliverable", perspective_label: "output-deliverable", label: "Result export", description: "Downloaded result.", user_responsibilities: ["Download"], source_area_refs: ["result"], journey_thread_refs: ["Main journey", "Recovery journey"], business_outcomes: ["Export"] },
    { perspective: "risk-recovery", perspective_label: "risk-recovery", label: "Retry failed work", description: "Recover and complete.", user_responsibilities: ["Retry"], source_area_refs: ["result"], journey_thread_refs: ["Recovery journey"], business_outcomes: ["Recovered export"] },
    { perspective: "workflow-stage", perspective_label: "workflow-stage", label: "End-to-end work", description: "Entry through exit.", user_responsibilities: ["Complete stages"], source_area_refs: ["entry", "result"], journey_thread_refs: ["Main journey"], business_outcomes: ["Export"] },
  ],
  unresolved: [],
};

const classificationArtifact = {
  schema_version: 1,
  run_id: "RUN-1",
  model_id: "gpt-test",
  artifact_status: "locally-validated-unregistered-probe",
  provenance: {
    project_id: "P-1",
    work_id: "WORK-BC",
    source_snapshot_id: "SS-1",
    source_root_hash: "sha256:root",
    extends_artifact_id: "02-source-gap-review",
    extends_artifact_hash: "sha256:source",
    generated_with: "pi-coding-agent",
    granted_evidence_refs: ["EV-BC-login", "EV-BC-result"],
    inherited_evidence_refs: ["EV-login", "EV-result", "EV-gap"],
  },
  classification: semanticClassification,
  evidence_bindings: semanticClassification.classifications.map((entry, position) => ({
    classification_position: position,
    source_area_refs: entry.source_area_refs,
    evidence_refs: entry.source_area_refs.includes("entry") ? ["EV-BC-login"] : ["EV-BC-result"],
  })),
  evidence_catalog: [
    { evidence_ref: "EV-BC-login", evidence: { source_id: "SRC-login", source_snapshot_id: "SS-1", path: "Login.tsx", start_line: 1, end_line: 20, content_hash: "sha256:bc-login", evidence_grant_id: "EVG-BC-login" } },
    { evidence_ref: "EV-BC-result", evidence: { source_id: "SRC-result", source_snapshot_id: "SS-1", path: "Result.tsx", start_line: 1, end_line: 20, content_hash: "sha256:bc-result", evidence_grant_id: "EVG-BC-result" } },
  ],
};

const inventory = {
  schema_version: 1,
  project_id: "P-1",
  analysis_run_id: "RUN-1",
  source_snapshot_id: "SS-1",
  source_root_hash: "sha256:root",
  files: [
    { source_ref: "SRC-login", path: "Login.tsx", language: "tsx", size_bytes: 20, imports: [] },
    { source_ref: "SRC-result", path: "Result.tsx", language: "tsx", size_bytes: 40, imports: [] },
    { source_ref: "SRC-retry", path: "Retry.ts", language: "ts", size_bytes: 30, imports: [] },
  ],
  routes: [], apis: [], interactions: [], ui_stacks: ["react"], unsupported_ui_stacks: [],
};

const sourceValidation = { pass: true, validation_scope: "local-probe-contract-only", product_stage_acceptance: "not-attempted", artifact_hash: "sha256:source" };
const classificationValidation = { pass: true, validation_scope: "local-probe-contract-only", product_stage_acceptance: "not-attempted", prior_artifact_hash: "sha256:source", artifact_hash: "sha256:classification" };

function milestone(position: number, phase: string, sourceAreaRefs: string[]) {
  return { position, phase, action: `Action ${position}`, observable_outcome: `Outcome ${position}`, source_area_refs: sourceAreaRefs };
}

function handoffs(count: number) {
  return Array.from({ length: count - 1 }, (_, index) => ({ from_position: index + 1, to_position: index + 2, state: [`State ${index + 1}`] }));
}

const journeys = {
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
      title: "Complete the main work",
      persona: "Operator",
      source_thread_ref: "Main journey",
      classification_refs: ["C001", "C002", "C003", "C004", "C006"],
      prerequisites: ["The application is available."],
      milestones: [milestone(1, "entry", ["entry"]), milestone(2, "work", ["entry", "result"]), milestone(3, "business-result", ["result"]), milestone(4, "exit", ["entry"])],
      handoffs: handoffs(4),
      business_result: { description: "Downloaded result", milestone_position: 3, source_area_refs: ["result"] },
      exit: { kind: "logout", action: "Log out", observable_outcome: "The session ends.", milestone_position: 4 },
      recovery: null,
    },
    {
      kind: "recovery",
      title: "Recover and complete the main work",
      persona: "Operator",
      source_thread_ref: "Recovery journey",
      classification_refs: ["C001", "C002", "C004", "C005"],
      prerequisites: ["The application is available."],
      milestones: [milestone(1, "entry", ["entry"]), milestone(2, "failure", ["result"]), milestone(3, "recovery", ["result"]), milestone(4, "work", ["result"]), milestone(5, "business-result", ["result"]), milestone(6, "exit", ["entry"])],
      handoffs: handoffs(6),
      business_result: { description: "Downloaded result", milestone_position: 5, source_area_refs: ["result"] },
      exit: { kind: "logout", action: "Log out", observable_outcome: "The session ends.", milestone_position: 6 },
      recovery: { failure_milestone_position: 2, recovery_action_position: 3, rejoin_milestone_position: 4 },
    },
  ],
  excluded_threads: [{ source_thread_ref: "Preview fragment", reason: "This is a local preview that returns to the current workflow." }],
  unresolved: [],
};

const context = {
  runId: "RUN-1", workId: "WORK-JOURNEY", snapshotId: "SS-1", rootHash: "sha256:root",
  classificationArtifactId: "03-business-classification", classificationArtifactHash: "sha256:classification",
  sourceArtifactId: "02-source-gap-review", sourceArtifactHash: "sha256:source",
  sourceArtifact, classificationArtifact,
  permittedSourceRefs: new Set(["SRC-login", "SRC-result", "SRC-retry"]),
};

describe("staged Pi user-journeys contract", () => {
  it("validates both prior handoffs, hashes, evidence bindings, and source scope", () => {
    expect(validateUserJourneyInputs({ runId: "RUN-1", sourceArtifactHash: "sha256:source", sourceArtifact, sourceValidation, classificationArtifactHash: "sha256:classification", classificationArtifact, classificationValidation, inventory })).toEqual([]);
    expect(validateUserJourneyInputs({ runId: "RUN-1", sourceArtifactHash: "sha256:source", sourceArtifact, sourceValidation, classificationArtifactHash: "sha256:changed", classificationArtifact, classificationValidation, inventory })).toContain("USER_JOURNEY_CLASSIFICATION_HASH_MISMATCH");
    expect([...userJourneyPermittedSourceRefs(sourceArtifact, classificationArtifact)].sort()).toEqual(["SRC-login", "SRC-result", "SRC-retry"]);
    expect([...userJourneyPermittedSourceRefs(sourceArtifact, classificationArtifact, {
      obligations: [{ source_refs_to_revisit: ["SRC-transition-only"] }],
      unresolved_interactions: [{ source_ref: "SRC-unresolved-transition" }],
    })].sort()).toEqual(["SRC-login", "SRC-result", "SRC-retry", "SRC-transition-only", "SRC-unresolved-transition"]);
  });

  it("rejects duplicate values that only appear to match a classification evidence binding", () => {
    const duplicateBinding = structuredClone(classificationArtifact);
    duplicateBinding.evidence_bindings[2].source_area_refs = ["entry", "entry"];
    expect(validateUserJourneyInputs({ runId: "RUN-1", sourceArtifactHash: "sha256:source", sourceArtifact, sourceValidation, classificationArtifactHash: "sha256:classification", classificationArtifact: duplicateBinding, classificationValidation, inventory }))
      .toContain("USER_JOURNEY_CLASSIFICATION_EVIDENCE_BINDING_INVALID:2");
  });

  it("projects backend-owned opaque classification references", () => {
    expect(buildUserJourneyClassificationView(classificationArtifact).map((entry) => entry.classification_ref)).toEqual(["C001", "C002", "C003", "C004", "C005", "C006"]);
    expect(buildUserJourneyClassificationView(classificationArtifact)[0]).toMatchObject({ perspective: "business-capability", source_area_refs: ["entry"] });
  });

  it("bounds artifact and source metadata lookup to the stage scope", () => {
    const permitted = new Set(["SRC-login"]);
    expect(classifyUserJourneyArtifactRequest("03-business-classification", permitted)).toEqual({ kind: "input", id: "03-business-classification" });
    expect(classifyUserJourneyArtifactRequest("SRC-login", permitted)).toEqual({ kind: "source-metadata", id: "SRC-login" });
    expect(classifyUserJourneyArtifactRequest("SRC-other", permitted)).toBeNull();
  });

  it("requires every input and a current supporting reread for every journey area", () => {
    const guard = createUserJourneyStageGuard(sourceArtifact, new Map([["SRC-login", 20], ["SRC-result", 40], ["SRC-retry", 30]]));
    for (const id of ["02-source-gap-review", "02-source-gap-review-validation", "03-business-classification", "03-business-classification-validation", "source-inventory"]) guard.recordArtifactRead(id);
    guard.beginClosure(["SRC-login", "SRC-result"]);
    expect(() => guard.beginArtifactWrite(journeys.journeys)).not.toThrow();

    const unread = createUserJourneyStageGuard(sourceArtifact, new Map([["SRC-login", 20], ["SRC-result", 40], ["SRC-retry", 30]]));
    for (const id of ["02-source-gap-review", "02-source-gap-review-validation", "03-business-classification", "03-business-classification-validation", "source-inventory"]) unread.recordArtifactRead(id);
    unread.beginClosure(["SRC-login"]);
    expect(() => unread.beginArtifactWrite(journeys.journeys)).toThrow("USER_JOURNEY_AREA_SOURCE_NOT_READ:result");
  });

  it("keeps a pre-closure write rejection recoverable without consuming the durable write", () => {
    const guard = createUserJourneyStageGuard(sourceArtifact, new Map([["SRC-login", 20], ["SRC-result", 40], ["SRC-retry", 30]]));
    for (const id of ["02-source-gap-review", "02-source-gap-review-validation", "03-business-classification", "03-business-classification-validation", "source-inventory"]) guard.recordArtifactRead(id);
    expect(() => guard.beginArtifactWrite(journeys.journeys)).toThrow("AGENTIC_SOURCE_TOOLS_NOT_USED");
    guard.beginClosure(["SRC-login", "SRC-result"]);
    expect(() => guard.beginArtifactWrite(journeys.journeys)).not.toThrow();
    guard.completeArtifactWrite();
    expect(() => guard.beginArtifactWrite(journeys.journeys)).toThrow("AGENTIC_ARTIFACT_WRITE_DUPLICATE");
  });

  it("limits transition correction source reads to the backend plan", () => {
    const correctionPlan = {
      targets: [{ required_source_area_refs: ["result"], required_source_refs: ["SRC-result"] }],
    };
    const requiredInputArtifactIds = ["prior-user-journeys", "user-journey-transition-mapping-plan", "source-transition-obligations", "source-inventory"];
    const guard = createUserJourneyStageGuard(
      sourceArtifact,
      new Map([["SRC-login", 20], ["SRC-result", 40], ["SRC-retry", 30]]),
      { classificationArtifact, correctionPlan, requiredInputArtifactIds },
    );
    requiredInputArtifactIds.forEach((id) => guard.recordArtifactRead(id));
    guard.beginClosure(["SRC-result"]);
    expect(() => guard.beginArtifactWrite([])).not.toThrow();
    expect(guard.summary().correction_source_refs_read).toEqual(["SRC-result"]);

    const unread = createUserJourneyStageGuard(
      sourceArtifact,
      new Map([["SRC-login", 20], ["SRC-result", 40], ["SRC-retry", 30]]),
      { classificationArtifact, correctionPlan, requiredInputArtifactIds },
    );
    requiredInputArtifactIds.forEach((id) => unread.recordArtifactRead(id));
    unread.beginClosure(["SRC-login"]);
    expect(() => unread.beginArtifactWrite([])).toThrow("USER_JOURNEY_AREA_SOURCE_NOT_READ:result");
  });

  it("allows bounded semantic correction before a durable write and keeps trust failures terminal", () => {
    const guard = createUserJourneyStageGuard(sourceArtifact, new Map([["SRC-login", 20], ["SRC-result", 40], ["SRC-retry", 30]]));
    for (const id of ["02-source-gap-review", "02-source-gap-review-validation", "03-business-classification", "03-business-classification-validation", "source-inventory"]) guard.recordArtifactRead(id);
    guard.beginClosure(["SRC-login", "SRC-result"]);
    expect(() => guard.beginArtifactWrite(journeys.journeys)).not.toThrow();
    expect(() => guard.beginArtifactWrite(journeys.journeys)).not.toThrow();
    guard.completeArtifactWrite();
    expect(() => guard.beginArtifactWrite(journeys.journeys)).toThrow("AGENTIC_ARTIFACT_WRITE_DUPLICATE");
    expect(guard.summary()).toMatchObject({ artifact_write_attempts: 2, artifact_writes: 1, max_artifact_write_attempts: 3 });
    expect(isFailClosedUserJourneyIssue("USER_JOURNEY_ARTIFACT_INVALID")).toBe(true);
    expect(isFailClosedUserJourneyIssue("USER_JOURNEY_RECOVERY_SEQUENCE_INVALID:1")).toBe(false);
  });

  it("fails closed when a milestone tries to use an unknown source area", () => {
    const guard = createUserJourneyStageGuard(sourceArtifact, new Map([["SRC-login", 20], ["SRC-result", 40], ["SRC-retry", 30]]));
    for (const id of ["02-source-gap-review", "02-source-gap-review-validation", "03-business-classification", "03-business-classification-validation", "source-inventory"]) guard.recordArtifactRead(id);
    guard.beginClosure(["SRC-login", "SRC-result"]);
    const unknownArea = structuredClone(journeys.journeys);
    unknownArea[0].milestones[0].source_area_refs = ["unknown"];
    expect(() => guard.beginArtifactWrite(unknownArea)).toThrow("USER_JOURNEY_SOURCE_AREA_REF_INVALID:unknown");
    expect(guard.summary().fatal_error).toBe("USER_JOURNEY_SOURCE_AREA_REF_INVALID:unknown");
  });

  it("accepts complete normal and recovery journeys and excludes workflow fragments", () => {
    expect(validateUserJourneyEnvelope(journeys, context)).toEqual([]);
  });

  it("maps journey and view obligations onto complete-journey milestones without promoting fragments", () => {
    const candidate = structuredClone(journeys);
    candidate.journeys[0].milestones[0].transition_refs = ["T001"];
    candidate.journeys[0].milestones[1].transition_refs = ["T002"];
    candidate.journeys[1].milestones[1].transition_refs = ["T003"];
    const transitionView = {
      obligations: [
        { transition_ref: "T001", scope: "journey", outcome: "normal", feasibility: "source-supported", source_area_refs: ["entry"], source_refs_to_revisit: ["SRC-login"] },
        { transition_ref: "T002", scope: "view", outcome: "normal", feasibility: "source-supported", source_area_refs: ["result"], source_refs_to_revisit: ["SRC-result"] },
        { transition_ref: "T003", scope: "journey", outcome: "exception", feasibility: "runtime-unverified", source_area_refs: ["result"], source_refs_to_revisit: ["SRC-result"] },
      ],
      unresolved_interactions: [],
    };

    expect(auditUserJourneyTransitionCoverage(candidate, transitionView)).toMatchObject({
      total_obligations: 3,
      mapped_obligations: 3,
      missing_obligation_refs: [],
      unknown_transition_refs: [],
      area_mismatches: [],
      by_scope: { journey: { total: 2, mapped: 2 }, view: { total: 1, mapped: 1 } },
      runtime_unverified_obligation_refs: ["T003"],
      status_conflicts: [],
    });

    candidate.unresolved.push({
      description: "Transition status is not established.",
      reason: "Runtime confirmation remains unavailable.",
      source_thread_refs: ["Main journey"],
      source_area_refs: ["entry"],
      source_refs_to_revisit: ["SRC-login"],
      transition_refs: ["T001"],
    });
    expect(auditUserJourneyTransitionCoverage(candidate, transitionView).status_conflicts).toEqual(["T001"]);

    candidate.journeys[0].milestones[1].transition_refs = ["T999"];
    expect(auditUserJourneyTransitionCoverage(candidate, transitionView)).toMatchObject({
      missing_obligation_refs: ["T002"],
      unknown_transition_refs: ["T999"],
    });
  });

  it("links existing journey milestones to only area-compatible backend workflows and injects feasibility", () => {
    const classificationArtifact = {
      classification: {
        classifications: [
          { perspective: "business-capability", perspective_label: "Capability", label: "Enter", description: "Enter", user_responsibilities: ["Enter"], source_area_refs: ["entry"], journey_thread_refs: ["Recovery"], business_outcomes: ["Session"] },
          { perspective: "business-capability", perspective_label: "Capability", label: "Work", description: "Work", user_responsibilities: ["Work"], source_area_refs: ["result"], journey_thread_refs: ["Recovery"], business_outcomes: ["Result"] },
          { perspective: "user-role", perspective_label: "Role", label: "Operator", description: "Operator", user_responsibilities: ["Retry"], source_area_refs: ["entry", "result"], journey_thread_refs: ["Recovery"], business_outcomes: ["Recovered"] },
        ],
      },
    };
    const journeyArtifact = {
      journey: {
        journeys: [{
          kind: "recovery",
          title: "Recover",
          milestones: [
            { position: 1, phase: "entry", action: "Log in", observable_outcome: "Session starts", source_area_refs: ["entry"] },
            { position: 2, phase: "failure", action: "Observe failure", observable_outcome: "Error appears", source_area_refs: ["result"] },
            { position: 3, phase: "recovery", action: "Retry", observable_outcome: "Work resumes", source_area_refs: ["result"] },
          ],
        }],
      },
    };
    const workflowSkeleton = {
      project_id: "P-1",
      analysis_run_id: "RUN-1",
      source_snapshot_id: "SS-1",
      workflows: [
        { workflow: "WF-login", goal: "Log in", cites: ["E-login"] },
        { workflow: "WF-work", goal: "Run work", cites: ["E-work", "E-fail"] },
        { workflow: "WF-retry", goal: "Retry work", cites: ["E-retry"] },
      ],
    };
    const guardedPathInventory = {
      edges: [
        { edge_ref: "E-login", outcome: "normal", scope: "journey", feasibility: "source-supported" },
        { edge_ref: "E-work", outcome: "normal", scope: "journey", feasibility: "runtime-unverified" },
        { edge_ref: "E-fail", outcome: "exception", scope: "journey", feasibility: "runtime-unverified" },
        { edge_ref: "E-retry", outcome: "normal", scope: "journey", feasibility: "source-supported" },
      ],
    };
    const workflowClassificationMapping = {
      assignments: [
        { workflow_ref: "WF-login", primary_classification_ref: "C001", cross_cutting_classification_refs: [] },
        { workflow_ref: "WF-work", primary_classification_ref: "C002", cross_cutting_classification_refs: ["C003"] },
        { workflow_ref: "WF-retry", primary_classification_ref: "C002", cross_cutting_classification_refs: ["C003"] },
      ],
    };
    const plan = buildUserJourneyWorkflowLinkPlan({
      journeyArtifactHash: "sha256:journey",
      factGraphArtifactHash: "sha256:fact",
      businessWorkflowMappingArtifactHash: "sha256:mapping",
      journeyArtifact,
      classificationArtifact,
      workflowSkeleton,
      guardedPathInventory,
      workflowClassificationMapping,
    });
    const patch = {
      schema_version: 1,
      journey_artifact_hash: "sha256:journey",
      fact_graph_artifact_hash: "sha256:fact",
      business_workflow_mapping_artifact_hash: "sha256:mapping",
      milestone_links: [
        { target_ref: "JM001", workflow_refs: ["WF-login"] },
        { target_ref: "JM002", workflow_refs: ["WF-work"] },
        { target_ref: "JM003", workflow_refs: ["WF-retry"] },
      ],
      unresolved: [],
    };

    expect(plan.targets).toEqual([
      expect.objectContaining({ target_ref: "JM001", required_outcome: "normal", allowed_workflow_refs: ["WF-login"] }),
      expect.objectContaining({ target_ref: "JM002", required_outcome: "exception", allowed_workflow_refs: ["WF-work"] }),
      expect.objectContaining({ target_ref: "JM003", required_outcome: "normal", allowed_workflow_refs: ["WF-retry", "WF-work"] }),
    ]);
    expect(validateUserJourneyWorkflowLinkPatch(patch, plan)).toEqual([]);
    expect(compileUserJourneyWorkflowLinks(patch, plan)).toMatchObject({
      journeys: [{
        journey_ref: "J001",
        feasibility: "runtime-unverified",
        milestones: [
          { position: 1, edge_refs: ["E-login"], feasibility: "source-supported" },
          { position: 2, edge_refs: ["E-fail"], feasibility: "runtime-unverified" },
          { position: 3, edge_refs: ["E-retry"], feasibility: "source-supported" },
        ],
      }],
    });
  });

  it("rejects graph links outside the backend target and keeps unresolved milestones non-acceptable", () => {
    const plan = {
      schema_version: 1,
      journey_artifact_hash: "sha256:journey",
      fact_graph_artifact_hash: "sha256:fact",
      business_workflow_mapping_artifact_hash: "sha256:mapping",
      targets: [{
        target_ref: "JM001",
        journey_ref: "J001",
        journey_kind: "recovery",
        milestone_position: 2,
        phase: "failure",
        required_outcome: "exception",
        allowed_workflow_refs: ["WF-fail"],
        workflow_candidates: [{ workflow_ref: "WF-fail", eligible_edges: [{ edge_ref: "E-fail", feasibility: "runtime-unverified" }] }],
      }],
    };
    const invalid = {
      schema_version: 1,
      journey_artifact_hash: "sha256:journey",
      fact_graph_artifact_hash: "sha256:fact",
      business_workflow_mapping_artifact_hash: "sha256:mapping",
      milestone_links: [{ target_ref: "JM001", workflow_refs: ["WF-normal"] }],
      unresolved: [],
    };
    expect(validateUserJourneyWorkflowLinkPatch(invalid, plan)).toContain("USER_JOURNEY_WORKFLOW_LINK_NOT_ALLOWED:JM001:WF-normal");
    expect(validateUserJourneyWorkflowLinkPatch({
      ...invalid,
      milestone_links: [],
      unresolved: [{ target_ref: "JM001", reason: "Runtime evidence is not available." }],
    }, plan)).toContain("USER_JOURNEY_WORKFLOW_LINK_UNRESOLVED:JM001");
  });

  it("repairs only unresolved milestone links and preserves every validated link", () => {
    const plan = {
      schema_version: 1,
      journey_artifact_hash: "sha256:journey",
      fact_graph_artifact_hash: "sha256:fact",
      business_workflow_mapping_artifact_hash: "sha256:mapping",
      targets: ["JM001", "JM002", "JM003"].map((targetRef, index) => ({
        target_ref: targetRef,
        journey_ref: "J001",
        journey_kind: "recovery",
        milestone_position: index + 1,
        phase: index === 1 ? "failure" : "work",
        required_outcome: index === 1 ? "exception" : "normal",
        source_area_refs: ["result"],
        allowed_workflow_refs: [`WF-${index + 1}`],
        workflow_candidates: [{ workflow_ref: `WF-${index + 1}`, source_area_refs: ["result"], eligible_edges: [{ edge_ref: `E-${index + 1}`, feasibility: "source-supported" }] }],
      })),
    };
    const basePatch = {
      schema_version: 1,
      journey_artifact_hash: "sha256:journey",
      fact_graph_artifact_hash: "sha256:fact",
      business_workflow_mapping_artifact_hash: "sha256:mapping",
      milestone_links: [
        { target_ref: "JM001", workflow_refs: ["WF-1"] },
        { target_ref: "JM002", workflow_refs: ["WF-2"] },
      ],
      unresolved: [{ target_ref: "JM003", reason: "The exact workflow is uncertain." }],
    };
    const correctionPlan = createUserJourneyWorkflowLinkCorrectionPlan({ basePatchHash: "sha256:base", basePatch, plan });
    const correctionPatch = {
      schema_version: 1,
      base_patch_hash: "sha256:base",
      journey_artifact_hash: "sha256:journey",
      fact_graph_artifact_hash: "sha256:fact",
      business_workflow_mapping_artifact_hash: "sha256:mapping",
      milestone_links: [{ target_ref: "JM003", workflow_refs: ["WF-3"] }],
      unresolved: [],
    };

    expect(correctionPlan.targets.map((target) => target.target_ref)).toEqual(["JM003"]);
    expect(correctionPlan.retained_links).toEqual(basePatch.milestone_links);
    expect(applyUserJourneyWorkflowLinkCorrectionPatch(correctionPatch, correctionPlan, plan)).toEqual({
      ...basePatch,
      milestone_links: [...basePatch.milestone_links, { target_ref: "JM003", workflow_refs: ["WF-3"] }],
      unresolved: [],
    });
    expect(() => applyUserJourneyWorkflowLinkCorrectionPatch({
      ...correctionPatch,
      milestone_links: [{ target_ref: "JM001", workflow_refs: ["WF-1"] }],
    }, correctionPlan, plan)).toThrow("USER_JOURNEY_WORKFLOW_LINK_CORRECTION_TARGET_INVALID");
  });

  it("gives Pi only backend-authorized milestone and workflow references for graph linkage", async () => {
    const source = await readFile(new URL("../../scripts/run-staged-axse-user-journey-workflow-link.mjs", import.meta.url), "utf8");
    expect(source).toContain('"target_ref": "exact JM reference"');
    expect(source).toContain('"workflow_refs": ["exact allowed WF reference"]');
    expect(source).toContain("buildUserJourneyWorkflowLinkPlan");
    expect(source).toContain("validateUserJourneyWorkflowLinkPatch");
    expect(source).toContain("compileUserJourneyWorkflowLinks");
    expect(source).toContain("Do not rewrite journeys or milestones");
    expect(source).toContain('option("--reuse-from")');
    expect(source).toContain('artifactTool.execute("backend-link-reuse"');
    expect(source).toContain("model_call_count: 0");
  });

  it("rejects a transition ref claimed as both mapped and unresolved", () => {
    const candidate = structuredClone(journeys);
    candidate.journeys[0].milestones[0].transition_refs = ["T001"];
    candidate.unresolved.push({
      description: "Transition status is not established.",
      reason: "Runtime confirmation remains unavailable.",
      source_thread_refs: ["Main journey"],
      source_area_refs: ["entry"],
      source_refs_to_revisit: ["SRC-login"],
      transition_refs: ["T001"],
    });
    const transitionView = {
      obligations: [{ transition_ref: "T001", scope: "journey", outcome: "normal", feasibility: "source-supported", source_area_refs: ["entry"], source_refs_to_revisit: ["SRC-login"] }],
      unresolved_interactions: [],
    };

    expect(validateUserJourneyEnvelope(candidate, { ...context, transitionView }))
      .toContain("USER_JOURNEY_TRANSITION_STATUS_CONFLICT:T001");
  });

  it("builds correction targets only for missing transitions and bounds every mapping to an area-compatible milestone", () => {
    const candidate = structuredClone(journeys);
    candidate.journeys[0].milestones[0].transition_refs = ["T001"];
    const transitionView = {
      branch_inventory_status: "lower-bound",
      obligations: [
        { transition_ref: "T001", scope: "journey", outcome: "normal", feasibility: "source-supported", source_area_refs: ["entry"], source_refs_to_revisit: ["SRC-login"] },
        { transition_ref: "T002", scope: "view", outcome: "normal", feasibility: "source-supported", source_area_refs: ["result"], source_refs_to_revisit: ["SRC-result"] },
        { transition_ref: "T003", scope: "journey", outcome: "exception", feasibility: "runtime-unverified", source_area_refs: ["result"], source_refs_to_revisit: ["SRC-result"] },
      ],
      unresolved_interactions: [],
    };

    const plan = buildUserJourneyTransitionMappingPlan({
      baseArtifactHash: "sha256:journeys",
      priorArtifact: candidate,
      transitionView,
    });

    expect(plan).toMatchObject({
      artifact_type: "user-journey-transition-mapping-plan",
      base_artifact_hash: "sha256:journeys",
      branch_inventory_status: "lower-bound",
    });
    expect(plan.targets.map((target) => target.transition_ref)).toEqual(["T002", "T003"]);
    expect(plan.targets[0]).toMatchObject({
      target_ref: "JT001",
      required_source_area_refs: ["result"],
      required_source_refs: ["SRC-result"],
    });
    expect(plan.targets[0].allowed_milestones).toEqual(expect.arrayContaining([
      { journey_ref: "J001", milestone_position: 2 },
      { journey_ref: "J002", milestone_position: 2 },
    ]));
    expect(plan.targets[0].allowed_milestones).not.toContainEqual({ journey_ref: "J001", milestone_position: 1 });
  });

  it("merges only backend-authorized transition mappings and backend-owned unresolved references", () => {
    const transitionView = {
      branch_inventory_status: "lower-bound",
      obligations: [
        { transition_ref: "T001", scope: "journey", outcome: "normal", feasibility: "source-supported", source_area_refs: ["entry"], source_refs_to_revisit: ["SRC-login"] },
        { transition_ref: "T002", scope: "view", outcome: "exception", feasibility: "runtime-unverified", source_area_refs: ["result"], source_refs_to_revisit: ["SRC-result"] },
      ],
      unresolved_interactions: [],
    };
    const plan = buildUserJourneyTransitionMappingPlan({ baseArtifactHash: "sha256:journeys", priorArtifact: journeys, transitionView });
    const patch = {
      schema_version: 1,
      stage: "user-journey-transition-mapping-patch",
      run_id: journeys.run_id,
      work_id: journeys.work_id,
      source_snapshot_ref: journeys.source_snapshot_ref,
      source_root_hash: journeys.source_root_hash,
      base_artifact_hash: "sha256:journeys",
      changes: [
        { target_ref: "JT001", operation: "map", journey_ref: "J001", milestone_position: 1 },
        { target_ref: "JT002", operation: "defer", description: "실행 조건 확인이 필요합니다.", reason: "정적 소스만으로 도달 가능성을 확정할 수 없습니다." },
      ],
    };

    const merged = applyUserJourneyTransitionMappingPatch(journeys, patch, plan);
    expect(merged.artifact.journeys[0].milestones[0].transition_refs).toEqual(["T001"]);
    expect(merged.artifact.unresolved.at(-1)).toEqual({
      description: "실행 조건 확인이 필요합니다.",
      reason: "정적 소스만으로 도달 가능성을 확정할 수 없습니다.",
      source_thread_refs: ["Recovery journey", "Main journey"].sort(),
      source_area_refs: ["result"],
      source_refs_to_revisit: ["SRC-result"],
      transition_refs: ["T002"],
    });
    expect(auditUserJourneyTransitionCoverage(merged.artifact, transitionView).missing_obligation_refs).toEqual([]);
    expect(merged.changed_targets).toEqual(["JT001", "JT002"]);

    const preserved = structuredClone(merged.artifact);
    delete preserved.journeys[0].milestones[0].transition_refs;
    preserved.unresolved.pop();
    expect(preserved).toEqual(journeys);

    expect(() => applyUserJourneyTransitionMappingPatch(journeys, {
      ...patch,
      changes: [{ target_ref: "JT001", operation: "map", journey_ref: "J001", milestone_position: 3 }, patch.changes[1]],
    }, plan)).toThrow("USER_JOURNEY_TRANSITION_MAPPING_NOT_ALLOWED:JT001");
    expect(() => applyUserJourneyTransitionMappingPatch(journeys, { ...patch, journeys: [] }, plan))
      .toThrow("USER_JOURNEY_TRANSITION_MAPPING_PATCH_INVALID");
  });

  it("retains valid transition targets and retries only the failed target", () => {
    const transitionView = {
      branch_inventory_status: "lower-bound",
      obligations: [
        { transition_ref: "T001", scope: "journey", outcome: "normal", feasibility: "source-supported", source_area_refs: ["entry"], source_refs_to_revisit: ["SRC-login"] },
        { transition_ref: "T002", scope: "view", outcome: "normal", feasibility: "source-supported", source_area_refs: ["result"], source_refs_to_revisit: ["SRC-result"] },
      ],
      unresolved_interactions: [],
    };
    const plan = buildUserJourneyTransitionMappingPlan({ baseArtifactHash: "sha256:journeys", priorArtifact: journeys, transitionView });
    const patch = {
      schema_version: 1,
      stage: "user-journey-transition-mapping-patch",
      run_id: journeys.run_id,
      work_id: journeys.work_id,
      source_snapshot_ref: journeys.source_snapshot_ref,
      source_root_hash: journeys.source_root_hash,
      base_artifact_hash: "sha256:journeys",
      changes: [
        { target_ref: "JT001", operation: "map", journey_ref: "J001", milestone_position: 1 },
        { target_ref: "JT002", operation: "map", journey_ref: "J001", milestone_position: 1 },
      ],
    };

    let failure: unknown;
    try {
      applyUserJourneyTransitionMappingPatch(journeys, patch, plan);
    } catch (error) {
      failure = error;
    }
    const failures = userJourneyTransitionMappingCompileFailures(failure, journeys, patch, plan);
    expect(failures).toEqual([{ target_ref: "JT002", issues: ["USER_JOURNEY_TRANSITION_MAPPING_NOT_ALLOWED:JT002"] }]);

    const retained = retainSuccessfulUserJourneyTransitionMappings(journeys, patch, plan, failures);
    expect(retained.artifact.journeys[0].milestones[0].transition_refs).toEqual(["T001"]);
    expect(retained.changed_targets).toEqual(["JT001"]);
    expect(retained.remaining_plan.targets.map((target) => target.target_ref)).toEqual(["JT002"]);
  });

  it("requires both journey kinds and assigns every source thread exactly once", () => {
    expect(validateUserJourneyEnvelope({ ...journeys, journeys: journeys.journeys.slice(0, 1) }, context)).toEqual(expect.arrayContaining(["USER_JOURNEY_RECOVERY_MISSING", "USER_JOURNEY_THREAD_UNASSIGNED:Recovery journey"]));
    expect(validateUserJourneyEnvelope({ ...journeys, excluded_threads: [] }, context)).toContain("USER_JOURNEY_THREAD_UNASSIGNED:Preview fragment");
  });

  it("requires every primary capability and rejects invalid or thread-incompatible classification refs", () => {
    const missingPrimary = structuredClone(journeys);
    missingPrimary.journeys[0].classification_refs = missingPrimary.journeys[0].classification_refs.filter((ref) => ref !== "C002");
    expect(validateUserJourneyEnvelope(missingPrimary, context)).toContain("USER_JOURNEY_PRIMARY_CLASSIFICATION_MISSING:0:C002");
    const incompatible = structuredClone(journeys);
    incompatible.journeys[1].classification_refs.push("C003");
    expect(validateUserJourneyEnvelope(incompatible, context)).toContain("USER_JOURNEY_CLASSIFICATION_THREAD_MISMATCH:1:C003");
  });

  it("lets a normal journey and its recovery pair share one source thread", () => {
    const paired = structuredClone(journeys);
    paired.journeys[1].source_thread_ref = paired.journeys[0].source_thread_ref;
    paired.excluded_threads = [
      ...paired.excluded_threads,
      { source_thread_ref: "Recovery journey", reason: "Covered by the paired recovery journey." },
    ];
    const issues = validateUserJourneyEnvelope(paired, context) as string[];

    expect(issues.filter((issue) => issue.startsWith("USER_JOURNEY_THREAD_ASSIGNED_MULTIPLE"))).toEqual([]);
  });

  it("does not demand a primary capability that the journey's own thread forbids", () => {
    const mainOnlyCapability = structuredClone(classificationArtifact);
    mainOnlyCapability.classification.classifications[2] = {
      ...mainOnlyCapability.classification.classifications[2],
      perspective: "business-capability",
      perspective_label: "business-capability",
      journey_thread_refs: ["Main journey"],
    };
    const scopedContext = { ...context, classificationArtifact: mainOnlyCapability };
    const issues = validateUserJourneyEnvelope(structuredClone(journeys), scopedContext) as string[];

    expect(issues.filter((issue) => issue.startsWith("USER_JOURNEY_PRIMARY_CLASSIFICATION_MISSING:1:"))).toEqual([]);
    expect(issues.filter((issue) => issue.startsWith("USER_JOURNEY_CLASSIFICATION_THREAD_MISMATCH:1:"))).toEqual([]);
  });

  it("requires contiguous milestones, adjacent state handoffs, business result, and exit", () => {
    const broken = structuredClone(journeys);
    broken.journeys[0].milestones[1].position = 7;
    broken.journeys[0].handoffs = [];
    broken.journeys[0].business_result.milestone_position = 2;
    broken.journeys[0].exit.milestone_position = 3;
    expect(validateUserJourneyEnvelope(broken, context)).toEqual(expect.arrayContaining([
      "USER_JOURNEY_MILESTONE_SEQUENCE_INVALID:0",
      "USER_JOURNEY_HANDOFF_CHAIN_INVALID:0",
      "USER_JOURNEY_BUSINESS_RESULT_INVALID:0",
      "USER_JOURNEY_EXIT_INVALID:0",
    ]));
  });

  it("requires ordered recovery that rejoins a matching normal journey", () => {
    const broken = structuredClone(journeys);
    broken.journeys[1].recovery = { failure_milestone_position: 3, recovery_action_position: 2, rejoin_milestone_position: 4 };
    broken.journeys[1].business_result.source_area_refs = ["entry"];
    expect(validateUserJourneyEnvelope(broken, context)).toEqual(expect.arrayContaining([
      "USER_JOURNEY_RECOVERY_SEQUENCE_INVALID:1",
      "USER_JOURNEY_RECOVERY_REJOIN_TARGET_MISSING:1",
    ]));
  });

  it("requires recovery to preserve the normal persona, result, entry area, and exit", () => {
    const broken = structuredClone(journeys);
    broken.journeys[1].persona = "Different operator";
    broken.journeys[1].business_result.description = "Different result";
    broken.journeys[1].exit.action = "Different exit";
    broken.journeys[1].milestones[0].source_area_refs = ["result"];
    expect(validateUserJourneyEnvelope(broken, context)).toContainEqual(
      expect.stringContaining("USER_JOURNEY_RECOVERY_PAIR_MISMATCH:1: copy these fields verbatim from the normal journey: persona, business_result.description, exit.action, milestones[0].source_area_refs"),
    );
  });

  it("rejects invented unresolved refs, model-owned IDs, copied prompt text, and secrets", () => {
    const unresolved = { ...journeys, unresolved: [{ description: "Unknown boundary", reason: "Not established", source_thread_refs: ["Unknown"], source_area_refs: ["unknown"], source_refs_to_revisit: ["SRC-retry"] }] };
    expect(validateUserJourneyEnvelope(unresolved, context)).toEqual(expect.arrayContaining(["USER_JOURNEY_UNRESOLVED_THREAD_REF_INVALID:Unknown", "USER_JOURNEY_UNRESOLVED_AREA_REF_INVALID:unknown"]));
    expect(validateUserJourneyEnvelope({ ...journeys, journeys: [{ ...journeys.journeys[0], journey_id: "J-model" }, journeys.journeys[1]] }, context)).toContain("USER_JOURNEY_ARTIFACT_INVALID");
    expect(validateUserJourneyEnvelope({ ...journeys, journeys: [{ ...journeys.journeys[0], title: "You are the user-journeys stage of ScenarioForge." }, journeys.journeys[1]] }, context)).toContain("USER_JOURNEY_ARTIFACT_INVALID");
    expect(validateUserJourneyEnvelope({ ...journeys, journeys: [{ ...journeys.journeys[0], title: 'api_key="definitely-secret-value"' }, journeys.journeys[1]] }, context)).toContain("USER_JOURNEY_ENTRY_INVALID");
  });

  it("binds current evidence to every milestone without delegating evidence refs to the model", () => {
    const evidenceByRef = new Map([
      ["EV-J-0001", { source_id: "SRC-login", source_snapshot_id: "SS-1", path: "Login.tsx", start_line: 1, end_line: 20, content_hash: "sha256:new-login", evidence_grant_id: "EVG-new-login" }],
      ["EV-J-0002", { source_id: "SRC-result", source_snapshot_id: "SS-1", path: "Result.tsx", start_line: 1, end_line: 40, content_hash: "sha256:new-result", evidence_grant_id: "EVG-new-result" }],
    ]);
    const hydrated = hydrateUserJourneyEvidence(journeys, sourceArtifact, evidenceByRef);
    expect(hydrated.issues).toEqual([]);
    expect(hydrated.journey_evidence_bindings).toHaveLength(2);
    expect(hydrated.journey_evidence_bindings.flatMap((journey) => journey.milestones).every((entry) => entry.evidence_refs.length > 0)).toBe(true);
    expect(hydrated.evidence_catalog).toHaveLength(2);
  });

  it("gives Pi a strict semantic journey schema without golden data, canonical IDs, targets, or evidence fields", async () => {
    const source = await readFile(new URL("../../scripts/run-staged-axse-user-journeys.mjs", import.meta.url), "utf8");
    expect(source).toContain('"stage": "user-journeys"');
    expect(source).toContain('"classification_refs": ["exact supplied C-reference"]');
    expect(source).toContain('"failure_milestone_position"');
    expect(source).toContain("same business result and exit");
    expect(source).toContain("A rejected semantic submission may be corrected");
    expect(source).toContain("Evidence metadata is attached by the backend");
    expect(source).not.toMatch(/golden|journey_id|classification_id|target_candidates|screen_ref|element_ref|api_ref/i);
    expect(source).toContain("verifyPersistedReferences");
    expect(source).toContain("throw new Error(failClosedIssue)");
    expect(source).toContain('"stage": "user-journey-transition-mapping-patch"');
    expect(source).toContain("Submit only this correction patch shape");
    expect(source).toContain("supersedes_agent_artifact_hash");
    expect(source).toContain("transition_inventory_hash");
    expect(stableAgenticErrorCode(new Error("USER_JOURNEY_AREA_SOURCE_NOT_READ:result raw detail"))).toBe("USER_JOURNEY_AREA_SOURCE_NOT_READ");
  });

  it("accepts only isolated transition-correction directories and rejects symlinked prior artifacts", async () => {
    expect(validateUserJourneyTransitionCorrectionOptions({})).toBeNull();
    expect(validateUserJourneyTransitionCorrectionOptions({
      priorDirectory: "04-user-journeys",
      outputDirectory: "04-user-journeys-transition-correction-01",
    })).toEqual({
      priorDirectory: "04-user-journeys",
      outputDirectory: "04-user-journeys-transition-correction-01",
    });
    expect(() => validateUserJourneyTransitionCorrectionOptions({
      priorDirectory: "../04-user-journeys",
      outputDirectory: "04-user-journeys-transition-correction-01",
    })).toThrow("USER_JOURNEY_TRANSITION_CORRECTION_INPUT_INVALID");

    const root = await mkdtemp(join(tmpdir(), "scenarioforge-journey-correction-"));
    const priorRoot = join(root, "04-user-journeys");
    const outputRoot = join(root, "04-user-journeys-transition-correction-01");
    await mkdir(priorRoot);
    await expect(validateUserJourneyTransitionCorrectionPaths({ runRoot: root, priorRoot, outputRoot })).resolves.toBeUndefined();
    const linkedPrior = join(root, "04-user-journeys-linked");
    await symlink(priorRoot, linkedPrior);
    await expect(validateUserJourneyTransitionCorrectionPaths({ runRoot: root, priorRoot: linkedPrior, outputRoot })).rejects.toThrow("USER_JOURNEY_TRANSITION_CORRECTION_PATH_INVALID");
    await rm(root, { recursive: true, force: true });
  });
});
