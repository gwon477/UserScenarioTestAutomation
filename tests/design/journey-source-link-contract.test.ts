import { describe, expect, it } from "vitest";
import {
  applyJourneyRepair,
  applySourceFindingRepair,
  buildLinkedSourceSkeleton,
  composeJourneyCandidate,
  meaningfulReviewIssues,
  hydrateOpaqueEvidence,
  hydrateSourceFindingEvidence,
  normalizeLinkedRecovery,
  normalizeRawSourceMaps,
  validateLinkedSourceMap,
  validateSourceMapCheckpoint,
  validateSolutionJourneyCoverage,
} from "../../scripts/journey-source-link-contract.mjs";

const citation = (path: string) => ({ path, start_line: 1, end_line: 2 });

describe("journey source-link contract", () => {
  it("hydrates only backend-granted opaque evidence references", () => {
    const granted = { source_id: "SRC-1", source_snapshot_id: "SS-1", path: "App.tsx", start_line: 1, end_line: 20, content_hash: "sha256:abc", evidence_grant_id: "EVG-1" };
    const hydrated = hydrateOpaqueEvidence({ findings: [{ finding_id: "F-1", evidence_refs: ["EV-1", "EV-invented"], evidence: [{ path: "invented.ts" }] }] }, [{ ref: "EV-1", evidence: granted }]);

    expect(hydrated.value.findings[0].evidence).toEqual([granted]);
    expect(hydrated.issues).toEqual(["OPAQUE_EVIDENCE_REF_INVALID:root.findings[0]:EV-invented"]);
  });

  it("derives semantic artifact evidence from source-finding references", () => {
    const granted = { source_id: "SRC-1", source_snapshot_id: "SS-1", path: "App.tsx", start_line: 1, end_line: 20, content_hash: "sha256:abc", evidence_grant_id: "EVG-1" };
    const hydrated = hydrateSourceFindingEvidence({ workflows: [{ workflow_id: "WF-1", source_finding_refs: ["LF-1"], evidence: [{ path: "invented.ts" }] }] }, [{ finding_id: "LF-1", evidence: [granted] }]);

    expect(hydrated.value.workflows[0].evidence).toEqual([granted]);
    expect(hydrated.issues).toEqual([]);
  });

  it("accepts source-map resume only for the same source, model, prompt contract, and selection", () => {
    const provenance = { prompt_contract_version: 2, model_id: "gpt-5.6-luna", source_root_hash: "sha256:root", source_selection_digest: "sha256:selection" };
    const sourceSelection = [{ source_id: "SRC-1", path: "App.tsx", content_hash: "sha256:file" }];
    const checkpoint = { provenance, source_selection: sourceSelection, source_maps: [{ findings: [] }] };

    expect(validateSourceMapCheckpoint(checkpoint, provenance, sourceSelection)).toEqual([]);
    expect(validateSourceMapCheckpoint(checkpoint, { ...provenance, source_root_hash: "sha256:changed" }, sourceSelection))
      .toContain("CHECKPOINT_SOURCE_ROOT_MISMATCH");
  });

  it("normalizes empty API links and preserves backend finding IDs during source repair", () => {
    const maps = [{ findings: [{ finding_id: "F-001", workflow_goal: "wrong", api_links: [{ method: "", path: "" }, { method: "GET", path: "/tasks" }] }] }];
    const normalized = normalizeRawSourceMaps(maps);
    const repaired = applySourceFindingRepair(normalized, { corrections: [{ source_finding_ref: "F-001", replacement: { workflow_goal: "correct", evidence_refs: ["EV-1"] } }] });

    expect(normalized[0].findings[0].api_links).toEqual([{ method: "GET", path: "/tasks" }]);
    expect(repaired[0].findings[0]).toEqual({ finding_id: "F-001", workflow_goal: "correct", evidence_refs: ["EV-1"] });
  });

  it("rejects workflow fragments when authentication exists but no journey connects it to output and exit", () => {
    const findings = [
      { finding_id: "LF-login", workflow_goal: "Sign in", journey_roles: ["entry"], scope: "journey" },
      { finding_id: "LF-task", workflow_goal: "Create task", journey_roles: ["entry"], scope: "journey" },
      { finding_id: "LF-output", workflow_goal: "Download result", journey_roles: ["business-output"], scope: "journey" },
      { finding_id: "LF-exit", workflow_goal: "Logout", journey_roles: ["exit"], scope: "journey" },
      { finding_id: "LF-retry", workflow_goal: "Replace bad file", journey_roles: ["intermediate"], scope: "journey", recovery_capable: true, recovery_scope: "journey" },
    ];
    const fragmented = { journeys: [
      { kind: "normal", source_finding_refs: ["LF-login", "LF-exit"] },
      { kind: "normal", source_finding_refs: ["LF-task", "LF-output", "LF-exit"] },
      { kind: "recovery", source_finding_refs: ["LF-task", "LF-retry", "LF-output", "LF-exit"] },
    ] };
    const connected = { journeys: [
      { kind: "normal", source_finding_refs: ["LF-login", "LF-task", "LF-output", "LF-exit"] },
      { kind: "recovery", source_finding_refs: ["LF-login", "LF-task", "LF-retry", "LF-output", "LF-exit"] },
    ] };

    expect(validateSolutionJourneyCoverage(fragmented, findings)).toEqual([
      "SOLUTION_NORMAL_JOURNEY_MISSING",
      "SOLUTION_RECOVERY_JOURNEY_MISSING",
    ]);
    expect(validateSolutionJourneyCoverage(connected, findings)).toEqual([]);
  });
  it("accepts a user-visible finding linked to its supporting API", () => {
    const rawMaps = [{ findings: [
      {
        finding_id: "F-UI-001",
        surface: "ui",
        visible_to_user: true,
        executable: true,
        recovery_capable: false,
        evidence: [citation("frontend/src/Page.jsx")],
      },
      {
        finding_id: "F-API-001",
        surface: "api",
        visible_to_user: false,
        executable: true,
        recovery_capable: false,
        evidence: [citation("backend/app/api.py")],
      },
    ] }];
    const linked = {
      schema_version: 1,
      findings: [{
        finding_id: "LF-001",
        source_finding_refs: ["F-UI-001", "F-API-001"],
        scope: "journey",
        executable: true,
        journey_roles: ["business-output"],
        workflow_goal: "Download a report",
        recovery_capable: false,
        recovery_scope: "none",
        evidence: [citation("frontend/src/Page.jsx"), citation("backend/app/api.py")],
      }],
      unresolved: [],
    };

    expect(validateLinkedSourceMap(rawMaps, linked)).toEqual([]);
  });

  it("rejects backend-only journey promotion and an omitted executable UI finding", () => {
    const rawMaps = [{ findings: [
      {
        finding_id: "F-UI-001",
        surface: "ui",
        visible_to_user: true,
        executable: true,
        recovery_capable: true,
        evidence: [citation("frontend/src/Upload.jsx")],
      },
      {
        finding_id: "F-API-001",
        surface: "api",
        visible_to_user: false,
        executable: true,
        recovery_capable: false,
        evidence: [citation("backend/app/documents.py")],
      },
    ] }];
    const linked = {
      schema_version: 1,
      findings: [{
        finding_id: "LF-001",
        source_finding_refs: ["F-API-001"],
        scope: "journey",
        executable: true,
        journey_roles: ["business-output"],
        workflow_goal: "Download an internal document",
        recovery_capable: false,
        recovery_scope: "none",
        evidence: [citation("backend/app/documents.py")],
      }],
      unresolved: [],
    };

    expect(validateLinkedSourceMap(rawMaps, linked)).toEqual(expect.arrayContaining([
      "LINKED_JOURNEY_UI_SOURCE_MISSING:LF-001",
      "EXECUTABLE_UI_FINDING_UNASSIGNED:F-UI-001",
      "RECOVERY_UI_FINDING_UNASSIGNED:F-UI-001",
    ]));
  });

  it("allows unsupported backend behavior to remain explicitly unresolved", () => {
    const rawMaps = [{ findings: [{
      finding_id: "F-API-001",
      surface: "api",
      visible_to_user: false,
      executable: true,
      recovery_capable: false,
      evidence: [citation("backend/app/documents.py")],
    }] }];
    const linked = {
      schema_version: 1,
      findings: [],
      unresolved: [{ description: "No UI caller found", source_finding_refs: ["F-API-001"] }],
    };

    expect(validateLinkedSourceMap(rawMaps, linked)).toEqual([]);
  });

  it("requires visible recovery to be classified as local or journey-level", () => {
    const rawMaps = [{ findings: [{
      finding_id: "F-UI-RECOVERY",
      surface: "ui",
      visible_to_user: true,
      executable: true,
      recovery_capable: true,
      evidence: [citation("frontend/src/Upload.jsx")],
    }] }];
    const linked = {
      schema_version: 1,
      findings: [{
        finding_id: "LF-RECOVERY",
        source_finding_refs: ["F-UI-RECOVERY"],
        scope: "journey",
        executable: true,
        journey_roles: ["intermediate"],
        workflow_goal: "Replace a failed upload",
        recovery_capable: true,
        evidence: [citation("frontend/src/Upload.jsx")],
      }],
      unresolved: [],
    };

    expect(validateLinkedSourceMap(rawMaps, linked)).toContain("LINKED_RECOVERY_SCOPE_INVALID:LF-RECOVERY");
    linked.findings[0].recovery_scope = "local";
    expect(validateLinkedSourceMap(rawMaps, linked)).toEqual([]);
  });

  it("rejects a repair that erases fields needed by journey synthesis", () => {
    const rawMaps = [{ findings: [{
      finding_id: "F-UI-001",
      surface: "ui",
      visible_to_user: true,
      executable: true,
      recovery_capable: false,
      evidence: [citation("frontend/src/Page.jsx")],
    }] }];
    const damagedRepair = {
      schema_version: 1,
      findings: [{ finding_id: "LF-001", source_finding_refs: ["F-UI-001"], scope: "journey", executable: true }],
      unresolved: [],
    };

    expect(validateLinkedSourceMap(rawMaps, damagedRepair)).toEqual(expect.arrayContaining([
      "LINKED_JOURNEY_ROLES_EMPTY:LF-001",
      "LINKED_WORKFLOW_GOAL_EMPTY:LF-001",
      "LINKED_RECOVERY_CAPABILITY_INVALID:LF-001",
      "LINKED_EVIDENCE_EMPTY:LF-001",
    ]));
  });

  it("rejects recovery invented from findings that have no visible recovery action", () => {
    const rawMaps = [{ findings: [{
      finding_id: "F-UI-001",
      surface: "ui",
      visible_to_user: true,
      executable: true,
      recovery_capable: false,
      evidence: [citation("frontend/src/Progress.jsx")],
    }] }];
    const linked = {
      schema_version: 1,
      findings: [{
        finding_id: "LF-001",
        source_finding_refs: ["F-UI-001"],
        scope: "journey",
        executable: true,
        journey_roles: ["intermediate"],
        workflow_goal: "Monitor progress",
        recovery_capable: true,
        recovery_scope: "journey",
        evidence: [citation("frontend/src/Progress.jsx")],
      }],
      unresolved: [],
    };

    expect(validateLinkedSourceMap(rawMaps, linked)).toContain("LINKED_RECOVERY_UI_SOURCE_MISSING:LF-001");
    const normalized = normalizeLinkedRecovery(rawMaps, linked);
    expect(normalized.corrections).toEqual(["LINKED_RECOVERY_DOWNGRADED:LF-001"]);
    expect(normalized.value.findings[0]).toMatchObject({ recovery_capable: false, recovery_scope: "none" });
    expect(validateLinkedSourceMap(rawMaps, normalized.value)).toEqual([]);
   });

  it("prevents the linker from merging independent UI findings", () => {
    const rawMaps = [{ findings: [
      { finding_id: "F-UI-LOGIN", surface: "ui", visible_to_user: true, executable: true, recovery_capable: false, evidence: [citation("frontend/src/Login.jsx")] },
      { finding_id: "F-UI-EXPORT", surface: "ui", visible_to_user: true, executable: true, recovery_capable: false, evidence: [citation("frontend/src/Results.jsx")] },
    ] }];
    const linked = {
      schema_version: 1,
      findings: [{
        finding_id: "LF-MERGED",
        source_finding_refs: ["F-UI-LOGIN", "F-UI-EXPORT"],
        scope: "journey",
        executable: true,
        journey_roles: ["entry", "business-output"],
        workflow_goal: "Login and export",
        recovery_capable: false,
        recovery_scope: "none",
        evidence: [citation("frontend/src/Login.jsx"), citation("frontend/src/Results.jsx")],
      }],
      unresolved: [],
    };

    expect(validateLinkedSourceMap(rawMaps, linked)).toContain("LINKED_UI_SOURCE_COUNT_INVALID:LF-MERGED:2");
  });

  it("lets annotations classify raw UI findings without changing backend-owned semantics or evidence", () => {
    const rawMaps = [{ findings: [
      {
        finding_id: "F-UI-001",
        surface: "ui",
        visible_to_user: true,
        executable: true,
        recovery_capable: false,
        workflow_goal: "Download the result",
        ordered_actions: [{ action: "Click download", observable_outcome: "File starts", evidence: [citation("frontend/src/Results.jsx")] }],
        evidence: [citation("frontend/src/Results.jsx")],
      },
      {
        finding_id: "F-API-001",
        surface: "api",
        visible_to_user: false,
        executable: true,
        recovery_capable: false,
        workflow_goal: "Delete all documents",
        evidence: [citation("backend/app/documents.py")],
      },
    ] }];
    const linked = buildLinkedSourceSkeleton(rawMaps, {
      annotations: [{
        source_finding_ref: "F-UI-001",
        scope: "journey",
        journey_roles: ["business-output"],
        recovery_scope: "journey",
        workflow_goal: "Invented replacement",
        evidence: [citation("backend/app/documents.py")],
      }],
    });

    expect(linked.findings).toEqual([expect.objectContaining({
      finding_id: "LF-001",
      source_finding_refs: ["F-UI-001"],
      workflow_goal: "Download the result",
      journey_roles: ["business-output"],
      recovery_capable: false,
      recovery_scope: "none",
      evidence: [citation("frontend/src/Results.jsx")],
    })]);
    expect(linked.unresolved[0].source_finding_refs).toEqual(["F-API-001"]);
    expect(validateLinkedSourceMap(rawMaps, linked)).toEqual([]);
  });

  it("keeps validated taxonomy immutable while assembling and repairing journeys", () => {
    const taxonomy = {
      schema_version: 1,
      project_name: "sample",
      classifications: [{ classification_id: "BC-001" }],
      workflows: [{ workflow_id: "WF-001" }],
      unresolved: [{ description: "taxonomy uncertainty" }],
    };
    const candidate = composeJourneyCandidate(taxonomy, {
      journeys: [{ journey_id: "J-001" }],
      unresolved: [{ description: "journey uncertainty" }],
    });
    const repaired = applyJourneyRepair(candidate, {
      classifications: [{ classification_id: "BC-DAMAGED" }],
      workflows: [],
      journeys: [{ journey_id: "J-002" }],
      unresolved: [{ description: "new source gap", source_finding_refs: ["LF-099"], evidence: [] }],
    });

    expect(candidate.unresolved).toHaveLength(2);
    expect(repaired.classifications).toEqual(taxonomy.classifications);
    expect(repaired.workflows).toEqual(taxonomy.workflows);
    expect(repaired.journeys).toEqual([{ journey_id: "J-002" }]);
    expect(repaired.unresolved).toEqual([
      ...candidate.unresolved,
      { description: "new source gap", source_finding_refs: ["LF-099"], evidence: [] },
    ]);
  });

  it("does not treat an unresolved executable UI finding as assigned", () => {
    const rawMaps = [{ findings: [{
      finding_id: "F-001-001", surface: "ui", visible_to_user: true, executable: true,
      recovery_capable: false, evidence: [{ path: "App.tsx", start_line: 1, end_line: 2 }],
    }] }];
    const linked = { schema_version: 1, findings: [], unresolved: [{ source_finding_refs: ["F-001-001"], evidence: [] }] };

    expect(validateLinkedSourceMap(rawMaps, linked)).toContain("EXECUTABLE_UI_FINDING_UNASSIGNED:F-001-001");
  });

  it("requires journey-scoped recovery to remain in journey scope", () => {
    const rawMaps = [{ findings: [{
      finding_id: "F-001-001", surface: "ui", visible_to_user: true, executable: true,
      recovery_capable: true, evidence: [{ path: "Upload.tsx", start_line: 1, end_line: 20 }],
    }] }];
    const linked = { schema_version: 1, findings: [{
      finding_id: "LF-001", source_finding_refs: ["F-001-001"], scope: "supporting", executable: true,
      workflow_goal: "replace rejected file", journey_roles: ["intermediate"], recovery_capable: true,
      recovery_scope: "journey", evidence: [{ path: "Upload.tsx", start_line: 1, end_line: 20 }],
    }], unresolved: [] };

    expect(validateLinkedSourceMap(rawMaps, linked)).toContain("LINKED_RECOVERY_JOURNEY_SCOPE_INVALID:LF-001");
  });

  it("closes a journey recovery annotation into journey scope deterministically", () => {
    const rawMaps = [{ findings: [{
      finding_id: "F-001-001", surface: "ui", visible_to_user: true, executable: true,
      workflow_goal: "replace rejected file", recovery_capable: true,
      evidence: [{ path: "Upload.tsx", start_line: 1, end_line: 20 }],
    }] }];
    const linked = buildLinkedSourceSkeleton(rawMaps, { annotations: [{
      source_finding_ref: "F-001-001", scope: "supporting", journey_roles: ["intermediate"], recovery_scope: "journey",
    }] });

    expect(linked.findings[0]).toMatchObject({ scope: "journey", recovery_scope: "journey" });
    expect(validateLinkedSourceMap(rawMaps, linked)).toEqual([]);
  });

  it("ignores empty reviewer placeholders but preserves substantive issues", () => {
    expect(meaningfulReviewIssues({
      pass: true,
      issues: [{ code: "", detail: "", evidence: [{ path: "", start_line: 1, end_line: 1 }] }],
    })).toEqual([]);
    expect(meaningfulReviewIssues({
      pass: false,
      issues: [{ code: "STATE_HANDOFF_MISSING", detail: "failure is not connected to retry", evidence: [] }],
    })).toEqual([expect.objectContaining({ code: "STATE_HANDOFF_MISSING" })]);
  });
});
