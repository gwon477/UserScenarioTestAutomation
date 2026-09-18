import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SourceScanner } from "../../packages/scenario-pipeline/src/scanning/source-scanner.ts";
import { ClosureService } from "../../packages/scenario-pipeline/src/scanning/closure-service.ts";
import {
  buildSourceInventoryView,
  buildPermittedSourceSnapshot,
  classifySourceGapReviewArtifactRequest,
  createSourceGapReviewStageGuard,
  createSourceSurveyStageGuard,
  createValidatedSourceSurveyWriter,
  effectiveClosureBudget,
  gapReviewPermittedSourceRefs,
  hydrateSourceSurvey,
  isSourceSurveyPathAllowed,
  validateSourceGapReviewInputs,
  validateSurveyEvidenceCatalog,
  validateSourceSurvey,
  validateSourceGapReviewEnvelope,
  applySourceGapReview,
  auditSourceSurveyInventoryCoverage,
  buildSourceSurveyInventoryGapSupplement,
  buildSourceSurveySemanticGapDocument,
  mergeSourceSurveyInventoryGaps,
  buildSourceTransitionObligationView,
  factGraphPermittedSourceRefs,
  validateFactGraphInputs,
  validateSourceTransitionObligationInventory,
  sourceSurveyValueSchema,
} from "../../scripts/staged-agent-analysis-contract.mjs";
import { createAnalysisArtifactTool } from "../../packages/pi-runtime/src/tools/staging-tools.ts";
import {
  executeProbeLifecycle,
  promptWithDeadline,
  stableAgenticErrorCode,
  validateStagedProbeScope,
} from "../../scripts/staged-agent-run-support.mjs";

const snapshot = {
  schema_version: 1,
  project_id: "P-1",
  analysis_run_id: "RUN-1",
  source_snapshot_id: "SS-1",
  created_at: "2026-09-03T00:00:00.000Z",
  root_hash: "sha256:root",
  ui_stacks: ["react"],
  unsupported_ui_stacks: [],
  files: [{
    source_id: "SRC-app",
    path: "frontend/src/App.jsx",
    language: "jsx",
    content_hash: "sha256:file",
    size_bytes: 42,
    imports: ["./Login"],
  }],
  routes: [{ screen_id: "SCR-login", route: "/login", source_id: "SRC-app", line: 4 }],
  apis: [],
  interactions: [{
    element_id: "EL-login",
    screen_id: "SCR-login",
    kind: "button",
    label: "Login",
    source_id: "SRC-app",
    line: 10,
    target_candidates: [{ by: "role-name", role: "button", name: "Login" }],
  }],
  i18n: {},
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
    business_outputs: [],
    recovery_paths: [],
    exit_paths: [],
    evidence_refs: ["EV-1"],
  }],
  journey_threads: [{
    name: "Enter the workspace",
    starts_at: "Application launch",
    ordered_milestones: ["Login", "Project selection"],
    furthest_business_outcome: "Not yet established",
    exit_or_handoff: "Project selection",
    evidence_refs: ["EV-1"],
  }],
  supporting_systems: [],
  source_gaps: [{
    question: "Where is logout handled?",
    reason: "Not established in the inspected source",
    affected_sections: ["journey_threads:Enter the workspace"],
    source_refs_to_revisit: ["SRC-app"],
  }],
  excluded_as_internal: [],
};

const gapReviewDocument = {
  schema_version: 1,
  run_id: "RUN-1",
  artifact_type: "orchestrator-source-gaps",
  source_snapshot_ref: "SS-1",
  reviewed_artifact: {
    artifact_id: "01-source-survey",
    content_hash: "sha256:prior",
    status: "locally-validated-unregistered-probe",
  },
  decision: "semantic-correction-required",
  golden_derived: false,
  preserve: ["Keep validated source areas"],
  gaps: [{
    gap_id: "GAP-1",
    kind: "incomplete-normal-journey",
    affected_sections: ["journey_threads:Enter the workspace"],
    required_change: "Continue through the supported business result and logout.",
    source_refs_to_revisit: ["SRC-app"],
  }, {
    gap_id: "GAP-2",
    kind: "missing-recovery-journey",
    affected_sections: ["journey_threads"],
    required_change: "Add one source-backed recovery thread.",
    source_refs_to_revisit: ["SRC-app"],
  }],
};

const gapReviewInventory = {
  schema_version: 1,
  project_id: "P-1",
  analysis_run_id: "RUN-1",
  source_snapshot_id: "SS-1",
  source_root_hash: "sha256:root",
  ui_stacks: ["react"],
  unsupported_ui_stacks: [],
  files: [{ source_ref: "SRC-app", path: "frontend/src/App.jsx", language: "jsx", size_bytes: 42, imports: [] }],
  routes: [],
  apis: [],
  interactions: [],
};

const priorGapReviewArtifact = {
  schema_version: 1,
  run_id: "RUN-1",
  model_id: "gpt-test",
  artifact_status: "locally-validated-unregistered-probe",
  provenance: {
    project_id: "P-1",
    work_id: "WORK-SURVEY",
    source_snapshot_id: "SS-1",
    source_root_hash: "sha256:root",
    generated_with: "pi-coding-agent",
    granted_evidence_refs: ["EV-old"],
    unresolved_items: [],
  },
  survey,
  evidence_catalog: [],
};

describe("staged Pi source-survey contract", () => {
  it("validates provenance-bound gap corrections and preserves untouched sections", () => {
    const correction = { schema_version: 1, stage: "source-gap-review", run_id: "RUN-1", work_id: "WORK-1", source_snapshot_ref: "SS-1", source_root_hash: "sha256:root", extends_artifact_id: "01-source-survey", extends_artifact_hash: "sha256:prior", source_area_upserts: [], journey_thread_upserts: [], resolved_gap_ids: ["GAP-1"], additional_source_gaps: [], evidence_refs: ["EV-1"] };
    expect(validateSourceGapReviewEnvelope(correction, { runId: "RUN-1", workId: "WORK-1", snapshotId: "SS-1", rootHash: "sha256:root", priorArtifactId: "01-source-survey", priorArtifactHash: "sha256:prior", permittedSourceRefs: new Set(["SRC-app"]), acceptedEvidenceRefs: new Set(["EV-1"]), gapIds: new Set(["GAP-1"]) })).toEqual([]);
    const patched = applySourceGapReview(survey, correction, new Map([["GAP-1", survey.source_gaps[0]]]));
    expect(patched.source_areas).toHaveLength(1); expect(patched.source_gaps).toHaveLength(0);
  });

  it("validates gap-review handoff identity and derives only orchestrator-granted source refs", () => {
    expect(validateSourceGapReviewInputs({
      runId: "RUN-1",
      priorArtifactHash: "sha256:prior",
      priorArtifact: priorGapReviewArtifact,
      gapDocument: gapReviewDocument,
      inventory: gapReviewInventory,
    })).toEqual([]);
    expect([...gapReviewPermittedSourceRefs(gapReviewDocument)]).toEqual(["SRC-app"]);

    expect(validateSourceGapReviewInputs({
      runId: "RUN-1",
      priorArtifactHash: "sha256:changed",
      priorArtifact: priorGapReviewArtifact,
      gapDocument: {
        ...gapReviewDocument,
        gaps: [{ ...gapReviewDocument.gaps[0], source_refs_to_revisit: ["SRC-unknown"] }],
      },
      inventory: gapReviewInventory,
    })).toEqual(expect.arrayContaining([
      "SOURCE_GAP_REVIEW_INPUT_HASH_MISMATCH",
      "SOURCE_GAP_REVIEW_INPUT_SOURCE_REF_INVALID:SRC-unknown",
    ]));
  });

  it("turns source-survey uncertainty into backend-scoped correction gaps", () => {
    expect(buildSourceSurveySemanticGapDocument(survey, {
      runId: "RUN-1",
      snapshotId: "SS-1",
      reviewedArtifactHash: "sha256:prior",
    })).toMatchObject({
      artifact_type: "orchestrator-source-gaps",
      decision: "semantic-correction-required",
      golden_derived: false,
      gaps: [{
        gap_id: "GAP-SOURCE-0001",
        affected_sections: ["journey_threads:Enter the workspace"],
        source_refs_to_revisit: ["SRC-app"],
      }],
    });
  });

  it("constructs the exact source-survey write tool schema outside the live runner", () => {
    const tool = createAnalysisArtifactTool("WORK-1", "01-source-survey", async () => ({
      path: "probe.json",
      contentHash: "sha256:probe",
    }), sourceSurveyValueSchema("SS-1", ["SRC-app"]));
    expect(tool.name).toBe("analysis.writeArtifact");
    expect(JSON.stringify(tool.parameters)).toContain('"const":"SRC-app"');
  });

  it("accepts an explicit backend no-op when the source survey has no gaps", () => {
    const gapDocument = buildSourceSurveySemanticGapDocument({ ...survey, source_gaps: [] }, {
      runId: "RUN-1",
      snapshotId: "SS-1",
      reviewedArtifactHash: "sha256:prior",
    });
    expect(gapDocument).toMatchObject({ decision: "no-semantic-correction-required", gaps: [] });
    expect(validateSourceGapReviewInputs({
      runId: "RUN-1",
      priorArtifactHash: "sha256:prior",
      priorArtifact: { ...priorGapReviewArtifact, survey: { ...survey, source_gaps: [] } },
      gapDocument,
      inventory: gapReviewInventory,
    })).toEqual([]);
  });

  it("does not apply semantic artifact collection limits to the source inventory", () => {
    const files = Array.from({ length: 101 }, (_, index) => ({
      source_ref: index === 0 ? "SRC-app" : `SRC-extra-${index}`,
      path: `frontend/src/extra-${index}.js`,
      language: "javascript",
      size_bytes: 1,
      imports: [],
    }));

    expect(validateSourceGapReviewInputs({
      runId: "RUN-1",
      priorArtifactHash: "sha256:prior",
      priorArtifact: priorGapReviewArtifact,
      gapDocument: gapReviewDocument,
      inventory: { ...gapReviewInventory, files },
    })).toEqual([]);
  });

  it("fails closed when the required gap document reuses a gap ID", () => {
    expect(validateSourceGapReviewInputs({
      runId: "RUN-1",
      priorArtifactHash: "sha256:prior",
      priorArtifact: priorGapReviewArtifact,
      gapDocument: {
        ...gapReviewDocument,
        gaps: [gapReviewDocument.gaps[0], { ...gapReviewDocument.gaps[1], gap_id: "GAP-1" }],
      },
      inventory: gapReviewInventory,
    })).toContain("SOURCE_GAP_REVIEW_INPUT_INVALID");
  });

  it("requires all handoff artifacts and the source refs for each resolved gap to be reread", () => {
    const guard = createSourceGapReviewStageGuard(gapReviewDocument, new Map([["SRC-app", 42]]));
    guard.recordArtifactRead("01-source-survey");
    guard.recordArtifactRead("orchestrator-gaps");
    guard.recordArtifactRead("source-inventory");
    guard.beginClosure(["SRC-app"]);
    expect(() => guard.beginArtifactWrite(["GAP-1", "GAP-2"])).not.toThrow();

    const unread = createSourceGapReviewStageGuard({
      ...gapReviewDocument,
      gaps: [{ ...gapReviewDocument.gaps[0], source_refs_to_revisit: ["SRC-app", "SRC-other"] }],
    }, new Map([["SRC-app", 42], ["SRC-other", 24]]));
    unread.recordArtifactRead("01-source-survey");
    unread.recordArtifactRead("orchestrator-gaps");
    unread.recordArtifactRead("source-inventory");
    unread.beginClosure(["SRC-app"]);
    expect(() => unread.beginArtifactWrite(["GAP-1"])).toThrow("SOURCE_GAP_REVIEW_REQUIRED_SOURCE_NOT_READ");
  });

  it("lets the gap review write after a write rejected for not reading source yet", () => {
    const guard = createSourceGapReviewStageGuard(gapReviewDocument, new Map([["SRC-app", 42]]));
    guard.recordArtifactRead("01-source-survey");
    guard.recordArtifactRead("orchestrator-gaps");
    guard.recordArtifactRead("source-inventory");
    expect(() => guard.beginArtifactWrite(["GAP-1", "GAP-2"])).toThrow("AGENTIC_SOURCE_TOOLS_NOT_USED");

    guard.beginClosure(["SRC-app"]);

    expect(() => guard.beginArtifactWrite(["GAP-1", "GAP-2"])).not.toThrow();
  });

  it("returns permitted source IDs as metadata-only artifact views without widening source scope", () => {
    const permitted = new Set(["SRC-app"]);

    expect(classifySourceGapReviewArtifactRequest("01-source-survey", permitted)).toEqual({ kind: "input", id: "01-source-survey" });
    expect(classifySourceGapReviewArtifactRequest("SRC-app", permitted)).toEqual({ kind: "source-metadata", id: "SRC-app" });
    expect(classifySourceGapReviewArtifactRequest("SRC-unknown", permitted)).toBeNull();
  });

  it("allows only named section corrections and additions requested by resolved gaps", () => {
    const correctedThread = {
      ...survey.journey_threads[0],
      ordered_milestones: ["Login", "Project selection", "Business result", "Logout"],
      exit_or_handoff: "Logout",
      evidence_refs: ["EV-new"],
    };
    const recoveryThread = {
      name: "Recover and finish",
      starts_at: "Application launch",
      ordered_milestones: ["Login", "Failure", "Retry", "Business result", "Logout"],
      furthest_business_outcome: "Business result",
      exit_or_handoff: "Logout",
      evidence_refs: ["EV-new"],
    };
    const valid = {
      schema_version: 1,
      stage: "source-gap-review",
      run_id: "RUN-1",
      work_id: "WORK-1",
      source_snapshot_ref: "SS-1",
      source_root_hash: "sha256:root",
      extends_artifact_id: "01-source-survey",
      extends_artifact_hash: "sha256:prior",
      source_area_upserts: [],
      journey_thread_upserts: [correctedThread, recoveryThread],
      resolved_gap_ids: ["GAP-1", "GAP-2"],
      additional_source_gaps: [],
      evidence_refs: ["EV-new"],
    };
    const validationContext = {
      runId: "RUN-1",
      workId: "WORK-1",
      snapshotId: "SS-1",
      rootHash: "sha256:root",
      priorArtifactId: "01-source-survey",
      priorArtifactHash: "sha256:prior",
      permittedSourceRefs: new Set(["SRC-app"]),
      acceptedEvidenceRefs: new Set(["EV-new"]),
      gapIds: new Set(["GAP-1", "GAP-2"]),
      priorSurvey: survey,
      gapDocument: gapReviewDocument,
    };

    expect(validateSourceGapReviewEnvelope(valid, validationContext)).toEqual([]);
    expect(validateSourceGapReviewEnvelope({
      ...valid,
      source_area_upserts: [{ ...survey.source_areas[0], evidence_refs: ["EV-new"] }],
    }, validationContext)).toContain("SOURCE_GAP_REVIEW_AREA_SCOPE_INVALID");
    expect(validateSourceGapReviewEnvelope({
      ...valid,
      journey_thread_upserts: [recoveryThread],
    }, validationContext)).toContain("SOURCE_GAP_REVIEW_REQUIRED_SECTION_MISSING:GAP-1");
  });

  it("gives the gap-review agent complete upsert schemas before its single write attempt", async () => {
    const source = await readFile(new URL("../../scripts/run-staged-axse-source-gap-review.mjs", import.meta.url), "utf8");

    expect(source).toContain('"source_area_upserts": [{');
    expect(source).toContain('"recovery_paths": []');
    expect(source).toContain('"journey_thread_upserts": [{');
    expect(source).toContain('"ordered_milestones": []');
    expect(source).toContain('"evidence_refs": ["EV-GAP-reference"]');
    expect(source).toContain("submit an upsert for every exact affected_sections entry");
    expect(source).toContain('`${ARTIFACT_ID}.rejected.json`');
    expect(source).toContain("Type.Union([...permittedSourceRefs].sort()");
  });

  it("revalidates and carries prior evidence into the merged gap-review artifact", async () => {
    const source = await readFile(new URL("../../scripts/run-staged-axse-source-gap-review.mjs", import.meta.url), "utf8");

    expect(source).toContain('verifyPersistedReferences(snapshot, "WORK-AXSE-SOURCE-SURVEY"');
    expect(source).toContain("const mergedEvidenceCatalog = [...prior.evidence_catalog, ...citedEvidence]");
    expect(source).toContain("evidence_catalog: mergedEvidenceCatalog");
  });

  it("rejects stale correction provenance and unknown gaps", () => {
    const bad = { schema_version: 1, stage: "source-gap-review", run_id: "RUN-old", work_id: "WORK-1", source_snapshot_ref: "SS-1", source_root_hash: "sha256:root", extends_artifact_id: "01-source-survey", extends_artifact_hash: "sha256:prior", source_area_upserts: [], journey_thread_upserts: [], resolved_gap_ids: ["GAP-X"], additional_source_gaps: [], evidence_refs: [] };
    expect(validateSourceGapReviewEnvelope(bad, { runId: "RUN-1", workId: "WORK-1", snapshotId: "SS-1", rootHash: "sha256:root", priorArtifactId: "01-source-survey", priorArtifactHash: "sha256:prior", permittedSourceRefs: new Set(), acceptedEvidenceRefs: new Set(), gapIds: new Set(["GAP-1"]) })).toEqual(expect.arrayContaining(["SOURCE_GAP_REVIEW_PROVENANCE_MISMATCH", "SOURCE_GAP_REVIEW_UNKNOWN_GAP"]));
  });
  it("keeps inventory identity backend-owned and omits executable target candidates", () => {
    expect(buildSourceInventoryView(snapshot)).toMatchObject({
      source_snapshot_id: "SS-1",
      files: [{ source_ref: "SRC-app", path: "frontend/src/App.jsx" }],
      interactions: [{ source_ref: "SRC-app", label: "Login" }],
    });
    expect(JSON.stringify(buildSourceInventoryView(snapshot))).not.toMatch(/target_candidates|screen_ref|element_ref|api_ref/);
  });

  it("excludes tests, fixtures, generated documents, hidden metadata, and golden-like files from model source scope", () => {
    for (const path of [
      "backend/tests/test_auth.py",
      "backend/fixtures/users.json",
      "docs/scenarios/generated.json",
      ".codex/context.json",
      "frontend/src/data/mock-data.js",
      "SCENARIOFORGE_GOLDEN_DATASET.json",
    ]) expect(isSourceSurveyPathAllowed(path)).toBe(false);
    expect(isSourceSurveyPathAllowed("frontend/src/features/login/login.page.jsx")).toBe(true);
    expect(isSourceSurveyPathAllowed("backend/app/api/v1/auth.py")).toBe(true);
  });

  it("keeps the actual AXSE model inventory free of tests, generated scenarios, and golden-like files", async () => {
    const projectRoot = join(process.cwd(), "test_project_source", "axse-agents");
    const actual = await new SourceScanner().scan({ projectRoot, projectId: "P-test", analysisRunId: "RUN-test", sourceSnapshotId: "SS-test" });
    const paths = buildSourceInventoryView(actual).files.map((file) => file.path);

    expect(paths).toContain("frontend/src/App.jsx");
    expect(paths).toContain("backend/app/api/v1/auth.py");
    expect(paths.some((path) => /(?:^|\/)tests?(?:\/|$)|docs\/scenarios|golden|mock-data/i.test(path))).toBe(false);
  });

  it("keeps AXSE MainPage readable while pruning its excluded mock-data dependency", async () => {
    const projectRoot = join(process.cwd(), "test_project_source", "axse-agents");
    const actual = await new SourceScanner().scan({ projectRoot, projectId: "P-test", analysisRunId: "RUN-test", sourceSnapshotId: "SS-test" });
    const permitted = buildPermittedSourceSnapshot(actual);
    const mainPage = permitted.files.find((file) => file.path === "frontend/src/features/main/pages/main.page.jsx");
    expect(mainPage).toBeDefined();
    const bytes = new Map(permitted.files.map((file) => [file.source_id, file.size_bytes]));
    const budget = effectiveClosureBudget(bytes, [mainPage!.source_id], 1_000);
    const closure = new ClosureService().build(permitted, [mainPage!.source_id], budget);

    expect(budget).toBe(mainPage!.size_bytes);
    expect(closure.files.map((file) => file.path)).toContain("frontend/src/features/main/pages/main.page.jsx");
    expect(closure.files.map((file) => file.path)).not.toContain("frontend/src/features/main/data/mock-data.js");
  });

  it("raises a closure budget to the total size of all uniquely requested source roots", () => {
    const bytes = new Map([["SRC-a", 600], ["SRC-b", 500]]);

    expect(effectiveClosureBudget(bytes, ["SRC-a", "SRC-b", "SRC-a"], 100, 1_200)).toBe(1_100);
    expect(() => effectiveClosureBudget(bytes, ["SRC-a", "SRC-b"], 100, 1_000)).toThrow("SOURCE_EVIDENCE_BUDGET_EXCEEDED");
  });

  it("accepts an incomplete survey when uncertainty is explicit and all references are granted", () => {
    expect(validateSourceSurvey(survey, snapshot, new Set(["EV-1"]))).toEqual([]);
  });

  it("rejects a gap scope that does not name an existing semantic section", () => {
    expect(validateSourceSurvey({
      ...survey,
      source_gaps: [{ ...survey.source_gaps[0], affected_sections: ["source_areas:unknown"] }],
    }, snapshot, new Set(["EV-1"]))).toContain("SOURCE_SURVEY_GAP_SECTION_INVALID:source_areas:unknown");
  });

  it("rejects stale snapshots, invented evidence, and invented source references", () => {
    const invalid = {
      ...survey,
      source_snapshot_ref: "SS-stale",
      source_areas: [{ ...survey.source_areas[0], evidence_refs: ["EV-invented"] }],
      source_gaps: [{ ...survey.source_gaps[0], source_refs_to_revisit: ["SRC-invented"] }],
    };

    expect(validateSourceSurvey(invalid, snapshot, new Set(["EV-1"]))).toEqual(expect.arrayContaining([
      "SOURCE_SURVEY_SNAPSHOT_MISMATCH",
      "SOURCE_SURVEY_EVIDENCE_REF_INVALID:EV-invented",
      "SOURCE_SURVEY_SOURCE_REF_INVALID:SRC-invented",
    ]));
  });

  it.each([
    ["null source area", { ...survey, source_areas: [null] }],
    ["missing journey fields", { ...survey, journey_threads: [{}] }],
    ["scalar evidence refs", { ...survey, source_areas: [{ ...survey.source_areas[0], evidence_refs: "EV-1" }] }],
    ["scalar revisit refs", { ...survey, source_gaps: [{ ...survey.source_gaps[0], source_refs_to_revisit: "SRC-app" }] }],
    ["unknown executable fields", { ...survey, target_candidates: [{ by: "css", value: "button" }] }],
    ["secret-bearing output", { ...survey, source_areas: [{ ...survey.source_areas[0], purpose: 'api_key="definitely-secret-value"' }] }],
    ["raw source block", { ...survey, source_areas: [{ ...survey.source_areas[0], purpose: "function login() {\n  return true;\n}" }] }],
  ])("fails closed for %s", (_label, candidate) => {
    expect(validateSourceSurvey(candidate, snapshot, new Set(["EV-1"]))).toContain("SOURCE_SURVEY_ARTIFACT_INVALID");
  });

  it("allows ordinary export and import language in human-readable semantics", () => {
    const ordinaryLanguage = {
      ...survey,
      source_areas: [{ ...survey.source_areas[0], actions: ["Import a document", "Export CSV and Excel"] }],
    };
    expect(validateSourceSurvey(ordinaryLanguage, snapshot, new Set(["EV-1"]))).toEqual([]);
  });

  it("requires inventory then bounded allowed-source closure before exactly one artifact write", () => {
    const guard = createSourceSurveyStageGuard(new Map([["SRC-app", 42]]), { maxClosureCalls: 2, maxGrantedBytes: 100 });
    expect(() => guard.beginArtifactWrite()).toThrow("AGENTIC_SOURCE_TOOLS_NOT_USED");

    const wrongOrder = createSourceSurveyStageGuard(new Map([["SRC-app", 42]]), { maxClosureCalls: 2, maxGrantedBytes: 100 });
    expect(() => wrongOrder.beginClosure(["SRC-app"])).toThrow("SOURCE_INVENTORY_NOT_READ");
    const valid = createSourceSurveyStageGuard(new Map([["SRC-app", 42]]), { maxClosureCalls: 2, maxGrantedBytes: 100 });
    valid.recordInventoryRead();
    valid.beginClosure(["SRC-app"]);
    valid.beginArtifactWrite();
    expect(() => valid.beginArtifactWrite()).toThrow("AGENTIC_ARTIFACT_WRITE_DUPLICATE");
    expect(valid.summary()).toMatchObject({ inventory_reads: 1, closure_calls: 1, cumulative_granted_bytes: 42, artifact_write_attempts: 2 });

    const forbidden = createSourceSurveyStageGuard(new Map([["SRC-app", 42]]));
    forbidden.recordInventoryRead();
    expect(() => forbidden.beginClosure(["SRC-forbidden"])).toThrow("AGENTIC_SOURCE_SCOPE_VIOLATION");
    expect(() => forbidden.beginArtifactWrite()).toThrow("AGENTIC_SOURCE_SCOPE_VIOLATION");
  });

  it("lets the agent write after a write rejected for not reading source yet", () => {
    const guard = createSourceSurveyStageGuard(new Map([["SRC-app", 42]]), { maxClosureCalls: 2, maxGrantedBytes: 100 });
    guard.recordInventoryRead();
    expect(() => guard.beginArtifactWrite()).toThrow("AGENTIC_SOURCE_TOOLS_NOT_USED");

    guard.beginClosure(["SRC-app"]);

    expect(() => guard.beginArtifactWrite()).not.toThrow();
    expect(guard.summary()).toMatchObject({ artifact_write_attempts: 1 });
  });

  it("enforces cumulative source-read budgets before a closure is granted", () => {
    const guard = createSourceSurveyStageGuard(new Map([["SRC-app", 60]]), { maxClosureCalls: 1, maxGrantedBytes: 100 });
    guard.recordInventoryRead();
    guard.beginClosure(["SRC-app"]);
    expect(() => guard.beginClosure(["SRC-app"])).toThrow("AGENTIC_SURVEY_BUDGET_EXCEEDED");
  });

  it("rejects an invalid candidate before any artifact write and prevents a second submission", async () => {
    const guard = createSourceSurveyStageGuard(new Map([["SRC-app", 42]]));
    guard.recordInventoryRead();
    guard.beginClosure(["SRC-app"]);
    const writes: unknown[] = [];
    const rejected: string[][] = [];
    const writer = createValidatedSourceSurveyWriter({
      guard,
      snapshot,
      grantedEvidenceRefs: () => new Set(["EV-1"]),
      permittedSourceRefs: new Set(["SRC-app"]),
      onRejected: (issues) => rejected.push(issues),
      write: async (value) => { writes.push(value); },
    });
    const invalid = { ...survey, source_areas: [{ ...survey.source_areas[0], purpose: 'credential="definitely-secret-value"' }] };

    await expect(writer(invalid)).rejects.toThrow("SOURCE_SURVEY_ARTIFACT_INVALID");
    await expect(writer(survey)).rejects.toThrow("SOURCE_SURVEY_ARTIFACT_INVALID");
    expect(writes).toEqual([]);
    expect(rejected[0]).toContain("SOURCE_SURVEY_ARTIFACT_INVALID");
  });

  it("rejects a substantial verbatim Python source line before persistence", async () => {
    const guard = createSourceSurveyStageGuard(new Map([["SRC-app", 42]]));
    guard.recordInventoryRead();
    guard.beginClosure(["SRC-app"]);
    let written = false;
    const copied = "def export_scenario_matrix(project_id, workflow_id, selected_columns, output_format): return repository.build_export(project_id, workflow_id)";
    const writer = createValidatedSourceSurveyWriter({
      guard,
      snapshot,
      grantedEvidenceRefs: () => new Set(["EV-1"]),
      permittedSourceRefs: new Set(["SRC-app"]),
      grantedSourceContents: () => [copied],
      write: async () => { written = true; },
    });

    await expect(writer({ ...survey, source_areas: [{ ...survey.source_areas[0], purpose: copied }] })).rejects.toThrow("SOURCE_SURVEY_RAW_SOURCE_COPIED");
    expect(written).toBe(false);
  });

  it("hydrates only cited opaque evidence into a backend-owned catalog", () => {
    const reference = {
      source_id: "SRC-app",
      source_snapshot_id: "SS-1",
      path: "frontend/src/App.jsx",
      start_line: 1,
      end_line: 20,
      content_hash: "sha256:slice",
      evidence_grant_id: "EVG-1",
    };

    expect(hydrateSourceSurvey(survey, new Map([["EV-1", reference]]))).toMatchObject({
      survey,
      evidence_catalog: [{ evidence_ref: "EV-1", evidence: reference }],
    });
  });

  it("adds deterministic inventory records omitted from the survey to the gap denominator", () => {
    const reference = {
      source_id: "SRC-app",
      source_snapshot_id: "SS-1",
      path: "frontend/src/App.jsx",
      start_line: 1,
      end_line: 5,
      content_hash: "sha256:slice",
      evidence_grant_id: "EVG-1",
    };
    const report = auditSourceSurveyInventoryCoverage(
      hydrateSourceSurvey(survey, new Map([["EV-1", reference]])),
      buildSourceInventoryView(snapshot),
    );

    expect(report).toEqual({
      total_records: 2,
      covered_records: 1,
      missing_records: [{ kind: "interaction", source_ref: "SRC-app", line: 10 }],
      coverage_percent: 50,
    });
  });

  it("persists the inventory difference audit after source-survey generation", async () => {
    const source = await readFile(new URL("../../scripts/run-staged-axse-source-survey.mjs", import.meta.url), "utf8");
    const gapReviewSource = await readFile(new URL("../../scripts/run-staged-axse-source-gap-review.mjs", import.meta.url), "utf8");

    expect(source).toContain("auditSourceSurveyInventoryCoverage");
    expect(source).toContain('"source-survey-inventory-audit.json"');
    expect(source).toContain('"source-survey-inventory-gaps.json"');
    expect(source).toContain('"orchestrator-gaps.json"');
    expect(source).toContain('"source-transition-obligations.json"');
    expect(source).toContain("sourceSurveyValueSchema(snapshot.source_snapshot_id, [...permittedRefs])");
    expect(source).toContain('setStage("source-survey-tool-schema")');
    expect(source).toContain('setStage("source-survey-tool-registration")');
    expect(source).toContain("validation_issues: artifactValidationIssues");
    expect(gapReviewSource).toContain("mergeSourceSurveyInventoryGaps");
    expect(gapReviewSource).toContain('"source-survey-inventory-audit.json"');
    expect(gapReviewSource).toContain('"02-source-gap-review-input-gaps.json"');
  });

  it("feeds deterministic inventory omissions into the source-gap correction input", () => {
    const supplement = buildSourceSurveyInventoryGapSupplement({
      missing_records: [
        { kind: "interaction", source_ref: "SRC-app", line: 10 },
        { kind: "api", source_ref: "SRC-app", line: 20 },
      ],
    }, { runId: "RUN-1", snapshotId: "SS-1", reviewedArtifactHash: "sha256:prior" });
    const merged = mergeSourceSurveyInventoryGaps(gapReviewDocument, supplement);

    expect(merged.gaps).toHaveLength(gapReviewDocument.gaps.length + 1);
    expect(merged.gaps.at(-1)).toMatchObject({
      kind: "deterministic-inventory-not-grounded",
      affected_sections: ["source_areas"],
      source_refs_to_revisit: ["SRC-app"],
    });
    expect(validateSourceGapReviewInputs({
      runId: "RUN-1",
      priorArtifactHash: "sha256:prior",
      priorArtifact: { schema_version: 1, run_id: "RUN-1", artifact_status: "locally-validated-unregistered-probe", provenance: { project_id: "P-1", source_snapshot_id: "SS-1", source_root_hash: "sha256:root" }, survey },
      gapDocument: merged,
      inventory: { ...gapReviewInventory, interactions: [{ source_ref: "SRC-app", line: 10 }] },
    })).toEqual([]);
  });

  it("validates backend transition obligations and exposes only opaque refs to later semantic stages", () => {
    const transitionInventory = {
      schema_version: 1,
      artifact_type: "source-transition-obligations",
      source_snapshot_ref: "SS-1",
      branch_inventory_status: "lower-bound",
      obligations: [{
        transition_ref: "T001",
        source_action_ref: "EL-login",
        branch_ref: "normal:1",
        scope: "journey",
        outcome: "normal",
        feasibility: "runtime-unverified",
        source_ref: "SRC-app",
        line: 10,
      }],
      unresolved_interactions: [],
    };
    const sourceArtifact = hydrateSourceSurvey(survey, new Map([["EV-1", {
      source_id: "SRC-app",
      source_snapshot_id: "SS-1",
      path: "frontend/src/App.jsx",
      start_line: 1,
      end_line: 20,
      content_hash: "sha256:slice",
      evidence_grant_id: "EVG-1",
    }]]));

    expect(validateSourceTransitionObligationInventory(transitionInventory, {
      snapshotId: "SS-1",
      permittedSourceRefs: new Set(["SRC-app"]),
      sourceInteractions: [{ element_id: "EL-login", source_id: "SRC-app", line: 10 }],
    })).toEqual([]);
    expect(validateSourceTransitionObligationInventory({
      ...transitionInventory,
      obligations: [{ ...transitionInventory.obligations[0], line: 11 }],
    }, {
      snapshotId: "SS-1",
      permittedSourceRefs: new Set(["SRC-app"]),
      sourceInteractions: [{ element_id: "EL-login", source_id: "SRC-app", line: 10 }],
    })).toContain("SOURCE_TRANSITION_OBLIGATION_SOURCE_BINDING_INVALID:EL-login");
    expect(validateSourceTransitionObligationInventory({
      ...transitionInventory,
      obligations: [],
    }, {
      snapshotId: "SS-1",
      permittedSourceRefs: new Set(["SRC-app"]),
      sourceInteractions: [{ element_id: "EL-login", source_id: "SRC-app", line: 10 }],
    })).toContain("SOURCE_TRANSITION_OBLIGATION_INTERACTION_MISSING:EL-login");
    const view = buildSourceTransitionObligationView(transitionInventory, sourceArtifact);
    expect(view.obligations).toEqual([{
      transition_ref: "T001",
      scope: "journey",
      outcome: "normal",
      feasibility: "runtime-unverified",
      source_area_refs: ["authentication"],
      source_refs_to_revisit: ["SRC-app"],
    }]);
    expect(JSON.stringify(view)).not.toMatch(/EL-login|normal:1|"line"/);
  });

  it("binds transition refs to source areas by cited line range instead of whole-file membership", () => {
    const rangedSurvey = structuredClone(survey);
    rangedSurvey.source_areas.push({
      ...rangedSurvey.source_areas[0],
      area_key: "result",
      label: "Result",
      evidence_refs: ["EV-2"],
    });
    const rangedArtifact = hydrateSourceSurvey(rangedSurvey, new Map([
      ["EV-1", { source_id: "SRC-app", source_snapshot_id: "SS-1", path: "frontend/src/App.jsx", start_line: 1, end_line: 20, content_hash: "sha256:first", evidence_grant_id: "EVG-1" }],
      ["EV-2", { source_id: "SRC-app", source_snapshot_id: "SS-1", path: "frontend/src/App.jsx", start_line: 21, end_line: 40, content_hash: "sha256:second", evidence_grant_id: "EVG-2" }],
    ]));
    const view = buildSourceTransitionObligationView({
      branch_inventory_status: "lower-bound",
      obligations: [{ transition_ref: "T001", scope: "journey", outcome: "normal", feasibility: "source-supported", source_ref: "SRC-app", line: 30 }],
      unresolved_interactions: [],
    }, rangedArtifact);

    expect(view.obligations[0].source_area_refs).toEqual(["result"]);
  });

  it("requires a merged survey catalog to preserve inherited and correction evidence", () => {
    const correctedThread = {
      ...survey.journey_threads[0],
      evidence_refs: ["EV-new"],
    };
    const mergedSurvey = applySourceGapReview(survey, {
      source_area_upserts: [],
      journey_thread_upserts: [correctedThread],
      resolved_gap_ids: [],
      additional_source_gaps: [],
    });
    const inherited = {
      evidence_ref: "EV-1",
      evidence: { source_id: "SRC-app", evidence_grant_id: "EVG-old" },
    };
    const correction = {
      evidence_ref: "EV-new",
      evidence: { source_id: "SRC-app", evidence_grant_id: "EVG-new" },
    };

    expect(validateSurveyEvidenceCatalog(mergedSurvey, [correction])).toContain("SOURCE_GAP_REVIEW_EVIDENCE_CATALOG_MISMATCH");
    expect(validateSurveyEvidenceCatalog(mergedSurvey, [inherited, correction])).toEqual([]);
  });

  it("accepts only the canonical AXSE fixture and canonical run output path", async () => {
    const repositoryRoot = await mkdtemp(join(tmpdir(), "scenarioforge-staged-scope-"));
    const expectedProject = join(repositoryRoot, "test_project_source", "axse-agents");
    const outputParent = join(repositoryRoot, "docs", "validation", "axse-agentic-analysis");
    await mkdir(expectedProject, { recursive: true });
    await mkdir(outputParent, { recursive: true });
    const runId = "RUN-AXSE-AGENTIC-test-01";

    await expect(validateStagedProbeScope({ repositoryRoot, projectRoot: expectedProject, outputRoot: join(outputParent, runId), runId })).resolves.toMatchObject({ projectRoot: expectedProject });

    const unrelated = await mkdtemp(join(tmpdir(), "scenarioforge-unrelated-"));
    const sameBasename = join(unrelated, "axse-agents");
    await mkdir(sameBasename);
    await expect(validateStagedProbeScope({ repositoryRoot, projectRoot: sameBasename, outputRoot: join(outputParent, runId), runId })).rejects.toThrow("AGENTIC_PROJECT_SCOPE_INVALID");
    const alias = join(repositoryRoot, "axse-alias");
    await symlink(expectedProject, alias);
    await expect(validateStagedProbeScope({ repositoryRoot, projectRoot: alias, outputRoot: join(outputParent, runId), runId })).rejects.toThrow("AGENTIC_PROJECT_SCOPE_INVALID");
    await expect(validateStagedProbeScope({ repositoryRoot, projectRoot: expectedProject, outputRoot: join(outputParent, runId), runId: "../escape" })).rejects.toThrow("AGENTIC_RUN_ID_INVALID");
    await expect(validateStagedProbeScope({ repositoryRoot, projectRoot: expectedProject, outputRoot: join(repositoryRoot, "elsewhere", runId), runId })).rejects.toThrow("AGENTIC_OUTPUT_PATH_INVALID");
  });

  it("preserves the primary failure, writes sanitized failure metadata, and always disposes", async () => {
    const events: string[] = [];
    const writes: unknown[] = [];
    const result = await executeProbeLifecycle({
      runId: "RUN-AXSE-AGENTIC-lifecycle",
      writeFailure: async (failure) => { writes.push(failure); },
      reportFailure: (message) => { events.push(message); },
      execute: async (setStage) => { setStage("pi-source-survey"); throw new Error("429 secret provider body"); },
      dispose: async () => { events.push("disposed"); },
    });

    expect(result).toEqual({ ok: false, stage: "pi-source-survey", errorCode: "PROVIDER_RATE_LIMIT" });
    expect(writes).toEqual([{ schema_version: 1, run_id: "RUN-AXSE-AGENTIC-lifecycle", stage: "pi-source-survey", error_code: "PROVIDER_RATE_LIMIT" }]);
    expect(events).toEqual(["RUN-AXSE-AGENTIC-lifecycle failed at pi-source-survey: PROVIDER_RATE_LIMIT", "disposed"]);
    expect(JSON.stringify({ events, writes })).not.toContain("secret provider body");
  });

  it("aborts a prompt at its deadline and still lets lifecycle disposal run", async () => {
    const events: string[] = [];
    const pending = new Promise(() => undefined);
    await expect(promptWithDeadline({
      prompt: () => pending,
      abort: async () => { events.push("aborted"); },
      timeoutMs: 10,
      schedule: (callback) => { queueMicrotask(callback); return 1; },
      cancel: () => { events.push("timer-cleared"); },
    })).rejects.toThrow("PROVIDER_TIMEOUT");
    expect(events).toEqual(["aborted", "timer-cleared"]);
  });

  it("disposes after successful lifecycle execution", async () => {
    const events: string[] = [];
    const result = await executeProbeLifecycle({
      runId: "RUN-AXSE-AGENTIC-success",
      writeFailure: async () => { throw new Error("not expected"); },
      reportFailure: (message) => { events.push(message); },
      execute: async (setStage) => { setStage("source-survey-validation"); return "done"; },
      dispose: async () => { events.push("disposed"); },
    });

    expect(result).toEqual({ ok: true, value: "done" });
    expect(events).toEqual(["disposed"]);
  });

  it("writes the final tool audit before publishing a locally validated run marker", async () => {
    const runnerNames = [
      "run-staged-axse-source-survey.mjs",
      "run-staged-axse-source-gap-review.mjs",
      "run-staged-axse-business-classification.mjs",
      "run-staged-axse-fact-graph.mjs",
      "run-staged-axse-business-workflow-mapping.mjs",
      "run-staged-axse-user-journeys.mjs",
      "run-staged-axse-user-journey-workflow-link.mjs",
      "run-staged-axse-graph-scenario-cases.mjs",
    ];
    for (const runnerName of runnerNames) {
      const source = await readFile(new URL(`../../scripts/${runnerName}`, import.meta.url), "utf8");
      expect(source.lastIndexOf('"tool-audit.json"'), runnerName).toBeLessThan(source.lastIndexOf('"run.json"'));
    }
  });

  it("provides a native TypeScript source loader for standalone Electron probes", async () => {
    const source = await readFile(new URL("../../scripts/typescript-source-loader.mjs", import.meta.url), "utf8");

    expect(source).toContain('specifier.endsWith(".js")');
    expect(source).toContain('.ts`');
    expect(source).toContain('error?.code !== "ERR_MODULE_NOT_FOUND"');
    expect(source).toContain("ts.transpileModule");
  });

  it("accepts only a validated same-snapshot classification and journey transition sources for FACT graph work", () => {
    const transitionInventory = {
      schema_version: 1,
      artifact_type: "source-transition-obligations",
      source_snapshot_ref: "SS-1",
      branch_inventory_status: "lower-bound",
      obligations: [
        { transition_ref: "T001", source_action_ref: "EL-login", branch_ref: "normal:1", scope: "journey", outcome: "normal", feasibility: "source-supported", source_ref: "SRC-app", line: 10 },
        { transition_ref: "T002", source_action_ref: "EL-filter", branch_ref: "normal:1", scope: "view", outcome: "normal", feasibility: "source-supported", source_ref: "SRC-view", line: 20 },
      ],
      unresolved_interactions: [],
    };
    const classificationArtifact = {
      schema_version: 1,
      run_id: "RUN-1",
      artifact_status: "locally-validated-unregistered-probe",
      provenance: { project_id: "P-1", source_snapshot_id: "SS-1", source_root_hash: "sha256:root" },
      classification: { source_snapshot_ref: "SS-1" },
    };
    const classificationValidation = { pass: true, artifact_hash: "sha256:classification", product_stage_acceptance: "not-attempted" };
    const factInventory = {
      ...gapReviewInventory,
      files: [...gapReviewInventory.files, { source_ref: "SRC-view", path: "frontend/src/View.jsx", language: "jsx", size_bytes: 21, imports: [] }],
    };

    expect([...factGraphPermittedSourceRefs(transitionInventory)]).toEqual(["SRC-app", "SRC-view"]);
    expect(validateFactGraphInputs({
      runId: "RUN-1",
      classificationArtifactHash: "sha256:classification",
      classificationArtifact,
      classificationValidation,
      inventory: factInventory,
      transitionInventory,
    })).toEqual([]);
    expect(validateFactGraphInputs({
      runId: "RUN-1",
      classificationArtifactHash: "sha256:changed",
      classificationArtifact,
      classificationValidation,
      inventory: factInventory,
      transitionInventory: { ...transitionInventory, source_snapshot_ref: "SS-stale" },
    })).toEqual(expect.arrayContaining([
      "FACT_GRAPH_INPUT_HASH_MISMATCH",
      "FACT_GRAPH_INPUT_SNAPSHOT_MISMATCH",
    ]));
    expect(stableAgenticErrorCode(new Error("FACT_CORRECTION_PATCH_INVALID:private detail"))).toBe("FACT_CORRECTION_PATCH_INVALID");
    expect(stableAgenticErrorCode(new Error("GOLDEN_INPUT_PROVENANCE_INVALID:private detail"))).toBe("GOLDEN_INPUT_PROVENANCE_INVALID");
  });

  it("corrects a validated FACT graph by appending only missing source transitions", async () => {
    const source = await readFile(new URL("../../scripts/run-staged-axse-fact-graph.mjs", import.meta.url), "utf8");

    expect(source).toContain("createFactTransitionCorrectionDraft");
    expect(source).toContain("mergeFactTransitionCorrection");
    expect(source).toContain("FACT_GRAPH_VALIDATED_CORRECTION_BASE_INVALID");
    expect(source).toContain("fact-transition-correction-report.json");
    expect(source).toContain('out_of_scope_preservation: "verified"');
    expect(source).toContain("if (!validatedCorrectionBase)");
  });

  it("resumes a failed FACT correction from its backend-verified merged patch", async () => {
    const source = await readFile(new URL("../../scripts/run-staged-axse-fact-graph.mjs", import.meta.url), "utf8");

    expect(source).toContain('option("--failed-correction-from")');
    expect(source).toContain('option("--failed-correction-chain")');
    expect(source).toContain('option("--correction-patch-from")');
    expect(source).toContain("FACT_GRAPH_FAILED_CORRECTION_INVALID");
    expect(source).toContain("loadFailedCorrectionStage");
    expect(source).toContain("applyFactCorrectionPatch(basePatch, failedPlan, failedCorrectionPatch)");
    expect(source).toContain("validateFactEnrichmentPatchReferences");
    expect(source).toContain("for (const failedStage of FAILED_CORRECTION_CHAIN)");
    expect(source).toContain('artifactTool.execute("backend-correction-replay"');
    expect(source).toContain('correction_scope: "failed-predicate-targets"');
  });
});
