import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import {
  businessClassificationPerspectives,
  buildBusinessWorkflowMappingPlan,
  businessClassificationPermittedSourceRefs,
  classifyBusinessClassificationArtifactRequest,
  compileBusinessCatalogPatchFromWorkflowMapping,
  createBusinessClassificationStageGuard,
  hydrateBusinessClassificationEvidence,
  businessClassificationSourceSupport,
  validateBusinessClassificationEnvelope,
  validateBusinessClassificationInputs,
  validateBusinessWorkflowMappingInputs,
  validateBusinessWorkflowMappingPatch,
} from "../../scripts/staged-agent-analysis-contract.mjs";
import { stableAgenticErrorCode } from "../../scripts/staged-agent-run-support.mjs";

const inventory = {
  schema_version: 1,
  project_id: "P-1",
  analysis_run_id: "RUN-1",
  source_snapshot_id: "SS-1",
  source_root_hash: "sha256:root",
  ui_stacks: ["react"],
  unsupported_ui_stacks: [],
  files: [
    { source_ref: "SRC-app", path: "frontend/src/App.jsx", language: "jsx", size_bytes: 42, imports: [] },
    { source_ref: "SRC-gap", path: "frontend/src/Retry.jsx", language: "jsx", size_bytes: 24, imports: [] },
  ],
  routes: [],
  apis: [],
  interactions: [],
};

const survey = {
  schema_version: 1,
  stage: "source-survey",
  source_snapshot_ref: "SS-1",
  source_areas: [{
    area_key: "authentication",
    label: "Authentication",
    purpose: "Enter the application",
    user_visible_surfaces: ["Login form"],
    entry_points: ["Open the application"],
    actions: ["Submit credentials"],
    observable_outcomes: ["Project selection appears"],
    business_outputs: ["Authenticated session"],
    recovery_paths: ["Retry login"],
    exit_paths: ["Logout"],
    evidence_refs: ["EV-old"],
  }],
  journey_threads: [{
    name: "Enter and finish",
    starts_at: "Application launch",
    ordered_milestones: ["Login", "Complete work", "Logout"],
    furthest_business_outcome: "Work result",
    exit_or_handoff: "Logout",
    evidence_refs: ["EV-old"],
  }],
  supporting_systems: [],
  source_gaps: [{
    question: "How is a failed login retried?",
    reason: "The exact backend rule is uncertain",
    affected_sections: ["source_areas:authentication"],
    source_refs_to_revisit: ["SRC-gap"],
  }],
  excluded_as_internal: [],
};

const prior = {
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
    granted_evidence_refs: ["EV-old"],
    inherited_evidence_refs: [],
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
  survey,
  evidence_catalog: [{
    evidence_ref: "EV-old",
    evidence: {
      source_id: "SRC-app",
      source_snapshot_id: "SS-1",
      path: "frontend/src/App.jsx",
      start_line: 1,
      end_line: 20,
      content_hash: "sha256:slice",
      evidence_grant_id: "EVG-old",
    },
  }],
};

const classification = {
  schema_version: 1,
  stage: "business-classification",
  run_id: "RUN-1",
  work_id: "WORK-BC",
  source_snapshot_ref: "SS-1",
  source_root_hash: "sha256:root",
  extends_artifact_id: "02-source-gap-review",
  extends_artifact_hash: "sha256:prior",
  perspective_assessments: businessClassificationPerspectives.map((perspective) => ({
    perspective,
    perspective_label: perspective === "business-capability" ? "Business capability" : perspective,
    decision: perspective === "business-capability" ? "classified" : "not-evidenced",
    rationale: perspective === "business-capability" ? "The source exposes an authentication capability." : "The inspected source does not establish this perspective.",
  })),
  classifications: [{
    perspective: "business-capability",
    perspective_label: "Business capability",
    label: "Access and session management",
    description: "Authenticate a user, select the work context, and close the session.",
    user_responsibilities: ["Authenticate", "Select a project", "Logout"],
    source_area_refs: ["authentication"],
    journey_thread_refs: ["Enter and finish"],
    business_outcomes: ["Authenticated session"],
  }],
  unresolved: [],
};

const priorValidation = {
  pass: true,
  validation_scope: "local-probe-contract-only",
  product_stage_acceptance: "not-attempted",
  artifact_hash: "sha256:prior",
};

const validationContext = {
  runId: "RUN-1",
  workId: "WORK-BC",
  snapshotId: "SS-1",
  rootHash: "sha256:root",
  priorArtifactId: "02-source-gap-review",
  priorArtifactHash: "sha256:prior",
  priorArtifact: prior,
  permittedSourceRefs: new Set(["SRC-app", "SRC-gap"]),
};

describe("staged Pi business-classification contract", () => {
  it("validates the prior handoff and derives only evidence-backed or explicit-gap source scope", () => {
    expect(validateBusinessClassificationInputs({
      runId: "RUN-1",
      priorArtifactHash: "sha256:prior",
      priorArtifact: prior,
      priorValidation,
      inventory,
    })).toEqual([]);
    expect([...businessClassificationPermittedSourceRefs(prior)].sort()).toEqual(["SRC-app", "SRC-gap"]);
    expect(businessClassificationSourceSupport(prior)).toEqual([{ source_area_ref: "authentication", source_refs: ["SRC-app"] }]);
    expect(businessClassificationSourceSupport(prior, [
      { element_id: "EL-login", source_id: "SRC-app", journey_required: true, local_view_only: false },
      { element_id: "EL-toggle", source_id: "SRC-app", journey_required: false, local_view_only: true },
    ])).toEqual([{
      source_area_ref: "authentication",
      source_refs: ["SRC-app"],
      journey_action_count: 1,
      journey_action_source_refs: ["SRC-app"],
    }]);
    expect(businessClassificationSourceSupport(prior, [
      { element_id: "EL-toggle", source_id: "SRC-app", journey_required: false, local_view_only: true },
    ])).toEqual([{
      source_area_ref: "authentication",
      source_refs: ["SRC-app"],
      journey_action_count: 0,
      journey_action_source_refs: [],
    }]);

    expect(validateBusinessClassificationInputs({
      runId: "RUN-1",
      priorArtifactHash: "sha256:changed",
      priorArtifact: prior,
      priorValidation,
      inventory,
    })).toContain("BUSINESS_CLASSIFICATION_INPUT_HASH_MISMATCH");

    expect(validateBusinessClassificationInputs({
      runId: "RUN-1",
      priorArtifactHash: "sha256:prior",
      priorArtifact: { ...prior, provenance: { ...prior.provenance, inherited_evidence_refs: undefined } },
      priorValidation,
      inventory,
    })).toContain("BUSINESS_CLASSIFICATION_INPUT_INVALID");
  });

  it("keeps source metadata lookup bounded to the classification scope", () => {
    const permitted = new Set(["SRC-app"]);
    expect(classifyBusinessClassificationArtifactRequest("02-source-gap-review", permitted)).toEqual({ kind: "input", id: "02-source-gap-review" });
    expect(classifyBusinessClassificationArtifactRequest("source-inventory", permitted)).toEqual({ kind: "input", id: "source-inventory" });
    expect(classifyBusinessClassificationArtifactRequest("SRC-app", permitted)).toEqual({ kind: "source-metadata", id: "SRC-app" });
    expect(classifyBusinessClassificationArtifactRequest("SRC-other", permitted)).toBeNull();
  });

  it("requires both inputs and a supporting reread for every classified source area", () => {
    const guard = createBusinessClassificationStageGuard(prior, new Map([["SRC-app", 42], ["SRC-gap", 24]]));
    guard.recordArtifactRead("02-source-gap-review");
    guard.recordArtifactRead("02-source-gap-review-validation");
    guard.recordArtifactRead("source-inventory");
    guard.beginClosure(["SRC-app"]);
    expect(() => guard.beginArtifactWrite(classification.classifications)).not.toThrow();

    const unread = createBusinessClassificationStageGuard(prior, new Map([["SRC-app", 42], ["SRC-gap", 24]]));
    unread.recordArtifactRead("02-source-gap-review");
    unread.recordArtifactRead("02-source-gap-review-validation");
    unread.recordArtifactRead("source-inventory");
    unread.beginClosure(["SRC-gap"]);
    expect(() => unread.beginArtifactWrite(classification.classifications)).toThrow("BUSINESS_CLASSIFICATION_AREA_SOURCE_NOT_READ:authentication");
  });

  it("does not consume the single durable write after a recoverable precondition rejection", () => {
    const guard = createBusinessClassificationStageGuard(prior, new Map([["SRC-app", 42], ["SRC-gap", 24]]));
    guard.recordArtifactRead("02-source-gap-review");
    guard.recordArtifactRead("02-source-gap-review-validation");
    guard.recordArtifactRead("source-inventory");
    expect(() => guard.beginArtifactWrite(classification.classifications)).toThrow("AGENTIC_SOURCE_TOOLS_NOT_USED");
    guard.beginClosure(["SRC-app"]);
    expect(() => guard.beginArtifactWrite(classification.classifications)).not.toThrow();
    expect(() => guard.beginArtifactWrite(classification.classifications)).toThrow("AGENTIC_ARTIFACT_WRITE_DUPLICATE");
    expect(guard.summary().artifact_write_attempts).toBe(1);
  });

  it("accepts semantic classifications with complete area and journey coverage", () => {
    expect(validateBusinessClassificationEnvelope(classification, validationContext)).toEqual([]);
  });

  it("allows one source area to participate in multiple evidenced perspectives", () => {
    const multiAxis = {
      ...classification,
      perspective_assessments: classification.perspective_assessments.map((assessment) => assessment.perspective === "user-role"
        ? { ...assessment, decision: "classified", perspective_label: "User role", rationale: "An authenticated user operates the workflow." }
        : assessment),
      classifications: [
        classification.classifications[0],
        {
          ...classification.classifications[0],
          perspective: "user-role",
          perspective_label: "User role",
          label: "Authenticated operator",
          description: "An authenticated operator starts and closes the work session.",
        },
      ],
    };
    expect(validateBusinessClassificationEnvelope(multiAxis, validationContext)).toEqual([]);
  });

  it("keeps each source area as one distinct primary business-capability category", () => {
    const secondArea = { ...survey.source_areas[0], area_key: "document-upload", label: "Document upload" };
    const twoAreaPrior = {
      ...prior,
      survey: { ...survey, source_areas: [survey.source_areas[0], secondArea] },
    };
    const collapsed = {
      ...classification,
      classifications: [{
        ...classification.classifications[0],
        source_area_refs: ["authentication", "document-upload"],
      }],
    };
    expect(validateBusinessClassificationEnvelope(collapsed, { ...validationContext, priorArtifact: twoAreaPrior }))
      .toContain("BUSINESS_CLASSIFICATION_PRIMARY_AREA_ASSIGNMENT_INVALID");
  });

  it("rejects missing coverage, invented refs, and model-owned IDs", () => {
    expect(validateBusinessClassificationEnvelope({ ...classification, classifications: [] }, validationContext)).toEqual(expect.arrayContaining([
      "BUSINESS_CLASSIFICATION_EMPTY",
      "BUSINESS_CLASSIFICATION_AREA_COVERAGE_MISSING:authentication",
      "BUSINESS_CLASSIFICATION_JOURNEY_COVERAGE_MISSING:Enter and finish",
    ]));
    expect(validateBusinessClassificationEnvelope({
      ...classification,
      classifications: [{ ...classification.classifications[0], source_area_refs: ["unknown"] }],
    }, validationContext)).toContain("BUSINESS_CLASSIFICATION_SOURCE_AREA_REF_INVALID:unknown");
    expect(validateBusinessClassificationEnvelope({
      ...classification,
      classifications: [{ ...classification.classifications[0], source_area_refs: ["authentication"], classification_id: "BC-model" }],
    }, validationContext)).toContain("BUSINESS_CLASSIFICATION_ARTIFACT_INVALID");
    expect(validateBusinessClassificationEnvelope({
      ...classification,
      unresolved: [{
        description: "The model reported an unknown classification boundary.",
        reason: "The source does not establish it.",
        source_area_refs: ["unknown"],
        journey_thread_refs: ["unknown"],
        source_refs_to_revisit: ["SRC-gap"],
      }],
    }, validationContext)).toEqual(expect.arrayContaining([
      "BUSINESS_CLASSIFICATION_UNRESOLVED_SOURCE_AREA_REF_INVALID:unknown",
      "BUSINESS_CLASSIFICATION_UNRESOLVED_JOURNEY_REF_INVALID:unknown",
    ]));
  });

  it("keeps evidence binding backend-owned and requires current support for every referenced area", () => {
    const evidence = {
      source_id: "SRC-app",
      source_snapshot_id: "SS-1",
      path: "frontend/src/App.jsx",
      start_line: 1,
      end_line: 20,
      content_hash: "sha256:new",
      evidence_grant_id: "EVG-new",
    };
    expect(hydrateBusinessClassificationEvidence(classification, prior, new Map([["EV-BC-0001", evidence]]))).toMatchObject({
      issues: [],
      evidence_bindings: [{ classification_position: 0, source_area_refs: ["authentication"], evidence_refs: ["EV-BC-0001"] }],
      evidence_catalog: [{ evidence_ref: "EV-BC-0001", evidence }],
    });
    expect(hydrateBusinessClassificationEvidence(classification, prior, new Map([["EV-BC-0001", { ...evidence, source_id: "SRC-gap" }]])).issues)
      .toContain("BUSINESS_CLASSIFICATION_AREA_EVIDENCE_MISSING:authentication");
  });

  it("maps every backend workflow to one primary classification and applicable cross-cutting classifications", () => {
    const classificationArtifact = {
      classification: {
        classifications: [
          classification.classifications[0],
          {
            ...classification.classifications[0],
            perspective: "user-role",
            perspective_label: "User role",
            label: "Authenticated operator",
          },
        ],
      },
    };
    const workflowSkeleton = {
      workflows: [
        { workflow: "WF-login", goal: "Authenticate", entry_screens: ["SCR-login"], success_terminal: "at(SCR-home)", cites: ["E-login"] },
        { workflow: "WF-logout", goal: "Close session", entry_screens: ["SCR-home"], success_terminal: "at(SCR-login)", cites: ["E-logout"] },
      ],
    };
    const guardedPathInventory = {
      edges: [
        { edge_ref: "E-login", source_action_ref: "EL-login", branch_ref: "normal:1", outcome: "normal", from_screen_ref: "SCR-login", to_screen_ref: "SCR-home", feasibility: "source-supported" },
        { edge_ref: "E-logout", source_action_ref: "EL-logout", branch_ref: "normal:1", outcome: "normal", from_screen_ref: "SCR-home", to_screen_ref: "SCR-login", feasibility: "source-supported" },
      ],
      paths: [
        { workflow_ref: "WF-login", kind: "normal", edge_refs: ["E-login"], feasibility: "source-supported" },
        { workflow_ref: "WF-logout", kind: "normal", edge_refs: ["E-logout"], feasibility: "source-supported" },
      ],
    };
    const plan = buildBusinessWorkflowMappingPlan({
      classificationArtifactHash: "sha256:classification",
      factGraphArtifactHash: "sha256:fact-graph",
      classificationArtifact,
      workflowSkeleton,
      guardedPathInventory,
    });
    const patch = {
      schema_version: 1,
      classification_artifact_hash: "sha256:classification",
      fact_graph_artifact_hash: "sha256:fact-graph",
      assignments: [
        { workflow_ref: "WF-login", primary_classification_ref: "C001", cross_cutting_classification_refs: ["C002"] },
        { workflow_ref: "WF-logout", primary_classification_ref: "C001", cross_cutting_classification_refs: ["C002"] },
      ],
      unresolved: [],
    };

    expect(plan).toMatchObject({
      primary_perspective: "business-capability",
      primary_classification_refs: ["C001"],
      cross_cutting_classification_refs: ["C002"],
      workflow_candidates: [
        expect.objectContaining({ workflow_ref: "WF-login", edge_refs: ["E-login"], edges: [expect.objectContaining({ edge_ref: "E-login" })] }),
        expect.objectContaining({ workflow_ref: "WF-logout", edge_refs: ["E-logout"] }),
      ],
    });
    expect(validateBusinessWorkflowMappingPatch(patch, plan)).toEqual([]);
    expect(compileBusinessCatalogPatchFromWorkflowMapping(patch, plan)).toEqual({
      schema_version: 1,
      classifications: [{ label: "Access and session management", workflow_refs: ["WF-login", "WF-logout"] }],
    });
  });

  it("fails closed when classification or FACT graph handoff hashes and identities drift", () => {
    const classificationArtifact = {
      schema_version: 1,
      run_id: "RUN-1",
      artifact_status: "locally-validated-unregistered-probe",
      provenance: { project_id: "P-1", source_snapshot_id: "SS-1", source_root_hash: "sha256:root" },
      classification,
    };
    const workflowSkeleton = {
      schema_version: 2,
      project_id: "P-1",
      analysis_run_id: "RUN-1",
      source_snapshot_id: "SS-1",
      workflows: [{ workflow: "WF-login", goal: "Authenticate", entry_screens: ["SCR-login"], success_terminal: "at(SCR-home)", cites: ["E-login"] }],
    };
    const guardedPathInventory = {
      schema_version: 1,
      project_id: "P-1",
      analysis_run_id: "RUN-1",
      source_snapshot_id: "SS-1",
      workflows: [{ workflow_ref: "WF-login" }],
      edges: [],
      paths: [],
    };
    const factGraphArtifact = {
      schema_version: 1,
      run_id: "RUN-1",
      artifact_status: "locally-validated-unregistered-probe",
      provenance: {
        project_id: "P-1",
        source_snapshot_id: "SS-1",
        source_root_hash: "sha256:root",
        extends_artifact_hash: "sha256:classification",
      },
      artifacts: {
        workflow_skeleton: { content_hash: "sha256:workflow" },
        guarded_path_inventory: { content_hash: "sha256:inventory" },
      },
    };
    const context = {
      runId: "RUN-1",
      classificationArtifactHash: "sha256:classification",
      classificationArtifact,
      classificationValidation: { pass: true, validation_scope: "local-probe-contract-only", product_stage_acceptance: "not-attempted", artifact_hash: "sha256:classification" },
      factGraphArtifactHash: "sha256:fact-graph",
      factGraphArtifact,
      factGraphValidation: { pass: true, validation_scope: "local-probe-contract-only", product_stage_acceptance: "not-attempted", prior_artifact_hash: "sha256:classification", artifact_hash: "sha256:fact-graph" },
      workflowSkeletonHash: "sha256:workflow",
      workflowSkeleton,
      guardedPathInventoryHash: "sha256:inventory",
      guardedPathInventory,
    };

    expect(validateBusinessWorkflowMappingInputs(context)).toEqual([]);
    expect(validateBusinessWorkflowMappingInputs({ ...context, factGraphArtifactHash: "sha256:changed" }))
      .toContain("BUSINESS_WORKFLOW_MAPPING_FACT_GRAPH_HASH_MISMATCH");
    expect(validateBusinessWorkflowMappingInputs({ ...context, guardedPathInventory: { ...guardedPathInventory, source_snapshot_id: "SS-old" } }))
      .toContain("BUSINESS_WORKFLOW_MAPPING_IDENTITY_MISMATCH");
  });

  it("rejects incomplete, duplicate, invented, and dead classification mappings", () => {
    const classificationArtifact = {
      classification: {
        classifications: [
          classification.classifications[0],
          { ...classification.classifications[0], perspective: "workflow-stage", perspective_label: "Stage", label: "Entry stage" },
        ],
      },
    };
    const plan = buildBusinessWorkflowMappingPlan({
      classificationArtifactHash: "sha256:classification",
      factGraphArtifactHash: "sha256:fact-graph",
      classificationArtifact,
      workflowSkeleton: { workflows: [{ workflow: "WF-login", goal: "Authenticate", entry_screens: ["SCR-login"], success_terminal: "at(SCR-home)", cites: ["E-login"] }] },
      guardedPathInventory: { edges: [], paths: [] },
    });
    const invalid = {
      schema_version: 1,
      classification_artifact_hash: "sha256:classification",
      fact_graph_artifact_hash: "sha256:fact-graph",
      assignments: [
        { workflow_ref: "WF-login", primary_classification_ref: "C999", cross_cutting_classification_refs: [] },
        { workflow_ref: "WF-login", primary_classification_ref: "C001", cross_cutting_classification_refs: ["C001"] },
      ],
      unresolved: [],
    };

    expect(validateBusinessWorkflowMappingPatch(invalid, plan)).toEqual(expect.arrayContaining([
      "BUSINESS_WORKFLOW_MAPPING_WORKFLOW_DUPLICATE:WF-login",
      "BUSINESS_WORKFLOW_MAPPING_PRIMARY_REF_INVALID:WF-login:C999",
      "BUSINESS_WORKFLOW_MAPPING_CROSS_REF_INVALID:WF-login:C001",
      "BUSINESS_WORKFLOW_MAPPING_CLASSIFICATION_UNUSED:C002",
    ]));
    expect(validateBusinessWorkflowMappingPatch({ ...invalid, assignments: [] }, plan)).toEqual(expect.arrayContaining([
      "BUSINESS_WORKFLOW_MAPPING_INCOMPLETE:WF-login",
      "BUSINESS_WORKFLOW_MAPPING_CLASSIFICATION_UNUSED:C001,C002",
    ]));
  });

  it("fails closed for copied source, secrets, and stale provenance", () => {
    const copied = "function authenticateAndSelectProject(username, password, projectIdentifier) { return startWorkspace(username, password, projectIdentifier); }";
    expect(validateBusinessClassificationEnvelope({
      ...classification,
      classifications: [{ ...classification.classifications[0], description: copied }],
    }, { ...validationContext, grantedSourceContents: [copied] })).toContain("BUSINESS_CLASSIFICATION_RAW_SOURCE_COPIED");
    expect(validateBusinessClassificationEnvelope({
      ...classification,
      classifications: [{ ...classification.classifications[0], description: 'api_key="definitely-secret-value"' }],
    }, validationContext)).toContain("BUSINESS_CLASSIFICATION_ENTRY_INVALID");
    expect(validateBusinessClassificationEnvelope({ ...classification, source_snapshot_ref: "SS-old" }, validationContext)).toContain("BUSINESS_CLASSIFICATION_PROVENANCE_MISMATCH");
    expect(validateBusinessClassificationEnvelope({
      ...classification,
      classifications: [{ ...classification.classifications[0], description: "You are the business-classification stage of ScenarioForge." }],
    }, validationContext)).toEqual(expect.arrayContaining([
      "BUSINESS_CLASSIFICATION_ARTIFACT_INVALID",
      "BUSINESS_CLASSIFICATION_ENTRY_INVALID",
    ]));
  });

  it("gives Pi a strict semantic schema without canonical or executable fields", async () => {
    const source = await readFile(new URL("../../scripts/run-staged-axse-business-classification.mjs", import.meta.url), "utf8");
    expect(source).toContain('"stage": "business-classification"');
    expect(source).toContain('"perspective": "one listed perspective"');
    expect(source).toContain('"decision": "classified|not-evidenced|not-applicable"');
    expect(source).toContain('"source_area_refs": ["exact source area key"]');
    expect(source).toContain('"journey_thread_refs": ["exact journey thread name"]');
    expect(source).toContain("Evidence metadata is attached by the backend");
    expect(source).toContain("Mandatory tool sequence");
    expect(source).not.toMatch(/classification_id|target_candidates|screen_ref|element_ref|api_ref/);
    expect(source).toContain("verifyPersistedReferences");
  });

  it("gives Pi only opaque classification and workflow references for the mapping stage", async () => {
    const source = await readFile(new URL("../../scripts/run-staged-axse-business-workflow-mapping.mjs", import.meta.url), "utf8");
    expect(source).toContain('"primary_classification_ref": "exact primary C reference"');
    expect(source).toContain('"cross_cutting_classification_refs": ["exact non-primary C reference"]');
    expect(source).toContain('"unresolved": [{');
    expect(source).toContain("validateBusinessWorkflowMappingPatch");
    expect(source).toContain("compileBusinessCatalogPatchFromWorkflowMapping");
    expect(source).toContain("compileBusinessCatalog");
    expect(source).toContain('option("--extend-from")');
    expect(source).toContain('option("--reuse-mapping-from")');
    expect(source).toContain("BUSINESS_WORKFLOW_MAPPING_EXTENSION_BASE_DRIFT");
    expect(source).toContain("backend.mapping.reuse");
    expect(source).toContain("previousBusinessCatalog");
    expect(source).toContain('out_of_scope_preservation: "verified"');
    expect(source).not.toContain("test_project_source/axse-agents/");
  });

  it("preserves sanitized classification failure codes", () => {
    expect(stableAgenticErrorCode(new Error("BUSINESS_CLASSIFICATION_AREA_SOURCE_NOT_READ:authentication raw detail"))).toBe("BUSINESS_CLASSIFICATION_AREA_SOURCE_NOT_READ");
  });
});
