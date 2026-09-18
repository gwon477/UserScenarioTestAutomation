import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { FactBundle, ScenarioSet } from "@scenarioforge/contracts";
import type { EvidenceGrant } from "../security/evidence-grant-service.js";
import {
  applyGoldenScenarioAssessmentCorrectionPatch,
  createGoldenScenarioAssessmentCorrectionPlan,
  evaluateJourneyCandidate,
  evaluateGoldenScenarioPriority,
  evaluateGoldenSimilarity,
  evaluateGoldenScenarioSimilarity,
  parseGoldenDatasetMarkdown,
  summarizeLegacyJourneyCoverage,
  type JourneyCandidate,
} from "./golden-journey-evaluator.js";

const repositoryRoot = join(import.meta.dirname, "../../../..");

const grantId = "EVG-test-journey";
const evidence = (line: number, path = "App.tsx") => [{
  source_id: "SRC-app",
  source_snapshot_id: "SS-test",
  path,
  start_line: line,
  end_line: line,
  content_hash: `sha256:${createHash("sha256").update(`line-${line}`).digest("hex")}`,
  evidence_grant_id: grantId,
}];
const grant: EvidenceGrant = {
  schema_version: 1,
  evidence_grant_id: grantId,
  project_id: "P-test",
  work_id: "work-test",
  source_snapshot_id: "SS-test",
  evidence: [1, 2, 3, 4].flatMap((line) => evidence(line)),
  created_at: "2026-09-03T00:00:00.000Z",
};

describe("golden journey evaluator", () => {
  it("extracts the AXSE benchmark dimensions and required journeys from the golden document", async () => {
    const markdown = await readFile(
      join(repositoryRoot, "test_project_source/axse-agents/SCENARIOFORGE_GOLDEN_DATASET.md"),
      "utf8",
    );

    const golden = parseGoldenDatasetMarkdown(markdown);

    expect(golden.projectPrefix).toBe("AXSE");
    expect(golden.counts).toEqual({
      classifications: 6,
      workflows: 10,
      transitions: 90,
      scenarios: 44,
      journeys: 2,
    });
    expect(golden.journeys).toEqual([
      expect.objectContaining({ journeyId: "AXSE-J-001", scenarioRefs: ["AXSE-SCN-0043"], required: true }),
      expect.objectContaining({ journeyId: "AXSE-J-002", scenarioRefs: ["AXSE-SCN-0044"], required: true }),
    ]);
    expect(golden.scenarioKinds?.filter((entry) => entry.kinds.includes("normal"))).toHaveLength(32);
    expect(golden.scenarioKinds?.filter((entry) => entry.kinds.some((kind) => ["boundary", "exception", "recovery"].includes(kind)))).toHaveLength(22);
  });

  it("accepts a granted journey with explicit handoff, business outcome, and exit", async () => {
    const candidate: JourneyCandidate = {
      schema_version: 1,
      project_name: "sample",
      classifications: [{ classification_id: "BC-1", label: "생성 업무", description: "결과 생성", workflow_refs: ["WF-1"], evidence: evidence(2) }],
      workflows: [{ workflow_id: "WF-1", classification_ref: "BC-1", goal: "결과 생성 및 다운로드", personas: ["operator"], entry: "login", normal_terminal: "download complete", failure_terminals: [], variation_axes: [], evidence: evidence(2) }],
      journeys: [{
        journey_id: "J-1",
        kind: "normal",
        goal: "결과를 생성해 활용",
        classification_refs: ["BC-1"],
        segments: [{
          segment_id: "SEG-1",
          persona: "operator",
          entry: "login screen",
          workflow_refs: ["WF-1"],
          milestones: [
            { milestone_id: "M-1", workflow_ref: "WF-1", action: "로그인", outcome: "세션 생성", evidence: evidence(1) },
            { milestone_id: "M-2", workflow_ref: "WF-1", action: "결과 다운로드", outcome: "CSV 파일", evidence: evidence(3) },
          ],
          state_handoffs: [{ key: "taskId", produced_by: "M-1", consumed_by: "M-2", evidence: evidence(2) }],
          terminal: "CSV 다운로드 완료",
        }],
        business_outcome: { description: "생성 결과 파일을 확보", evidence: evidence(3) },
        exit: { kind: "logout", action: "로그아웃", outcome: "세션 제거", evidence: evidence(4) },
      }],
      unresolved: [],
    };

    const result = await evaluateJourneyCandidate(grant, candidate);

    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.completeJourneyIds).toEqual(["J-1"]);
  });

  it("rejects missing handoffs, invalid references, and evidence outside the grant", async () => {
    const candidate: JourneyCandidate = {
      schema_version: 1,
      project_name: "sample",
      classifications: [{ classification_id: "BC-1", label: "업무", description: "업무", workflow_refs: ["WF-missing"], evidence: evidence(1, "missing.ts") }],
      workflows: [],
      journeys: [{
        journey_id: "J-1",
        kind: "normal",
        goal: "업무 완료",
        classification_refs: ["BC-1"],
        segments: [{ segment_id: "SEG-1", persona: "operator", entry: "login", workflow_refs: ["WF-missing"], milestones: [], state_handoffs: [], terminal: "done" }],
        business_outcome: { description: "done", evidence: evidence(9) },
        exit: { kind: "logout", action: "logout", outcome: "signed out", evidence: evidence(1) },
      }],
      unresolved: [],
    };

    const result = await evaluateJourneyCandidate(grant, candidate);

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([
      "CLASSIFICATION_WORKFLOW_REFERENCE_INVALID:BC-1:WF-missing",
      "JOURNEY_WORKFLOW_REFERENCE_INVALID:J-1:WF-missing",
      "JOURNEY_MILESTONES_EMPTY:J-1:SEG-1",
      "JOURNEY_STATE_HANDOFFS_EMPTY:J-1:SEG-1",
      "EVIDENCE_GRANT_VIOLATION:missing.ts:1-1",
      "EVIDENCE_GRANT_VIOLATION:App.tsx:9-9",
    ]));
  });

  it("reports malformed model output as validation issues instead of throwing", async () => {
    const malformed = {
      schema_version: 1,
      project_name: "sample",
      classifications: [],
      workflows: [],
      journeys: [{ journey_id: "J-1", goal: "result", classification_refs: [], segments: [] }],
    } as unknown as JourneyCandidate;

    const result = await evaluateJourneyCandidate(grant, malformed);

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([
      "JOURNEY_SEGMENTS_EMPTY:J-1",
      "JOURNEY_KIND_INVALID:J-1",
      "JOURNEY_BUSINESS_OUTCOME_INVALID:J-1",
      "JOURNEY_EXIT_INVALID:J-1",
    ]));
  });

  it("reports primitive array members and invalid versioned identities instead of throwing", async () => {
    const malformed = {
      schema_version: 2,
      project_name: "",
      classifications: [null, "bad"],
      workflows: [42],
      journeys: [null],
    } as unknown as JourneyCandidate;

    const result = await evaluateJourneyCandidate(grant, malformed);

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([
      "CANDIDATE_SCHEMA_VERSION_INVALID",
      "CANDIDATE_PROJECT_NAME_INVALID",
      "CANDIDATE_CLASSIFICATION_ENTRY_INVALID:0",
      "CANDIDATE_WORKFLOW_ENTRY_INVALID:0",
      "CANDIDATE_JOURNEY_ENTRY_INVALID:0",
    ]));
  });

  it("rejects duplicate milestones, backward handoffs, and a recovery rejoin before failure", async () => {
    const candidate: JourneyCandidate = {
      schema_version: 1,
      project_name: "sample",
      classifications: [{ classification_id: "BC-1", label: "업무", description: "업무", workflow_refs: ["WF-1"], evidence: evidence(1) }],
      workflows: [{ workflow_id: "WF-1", classification_ref: "BC-1", goal: "완료", personas: ["operator"], entry: "start", normal_terminal: "done", failure_terminals: [], variation_axes: [], evidence: evidence(1) }],
      journeys: [{
        journey_id: "J-1", kind: "recovery", goal: "복구 후 완료", classification_refs: ["BC-1"],
        segments: [{
          segment_id: "SEG-1", persona: "operator", entry: "start", workflow_refs: ["WF-1"], terminal: "done",
          milestones: [
            { milestone_id: "M-1", workflow_ref: "WF-1", action: "start", outcome: "started", evidence: evidence(1) },
            { milestone_id: "M-1", workflow_ref: "WF-1", action: "retry", outcome: "retried", evidence: evidence(2) },
          ],
          state_handoffs: [{ key: "state", produced_by: "M-1", consumed_by: "M-1", evidence: evidence(2) }],
        }],
        business_outcome: { description: "done", evidence: evidence(3) },
        exit: { kind: "logout", action: "logout", outcome: "signed out", evidence: evidence(4) },
        recovery: { failure_milestone_ref: "M-1", rejoin_milestone_ref: "M-1" },
      }],
      unresolved: [],
    };

    const result = await evaluateJourneyCandidate(grant, candidate);

    expect(result.issues).toEqual(expect.arrayContaining([
      "JOURNEY_MILESTONE_ID_DUPLICATE:J-1:M-1",
      "JOURNEY_STATE_HANDOFF_ORDER_INVALID:J-1:state",
      "JOURNEY_RECOVERY_ORDER_INVALID:J-1",
    ]));
  });

  it("does not count separate login, export, and logout scenarios as one complete journey", () => {
    const identity = { project_id: "P", analysis_run_id: "R", source_snapshot_id: "S" };
    const facts = {
      schema_version: 2,
      ...identity,
      screens: [{
        schema_version: 3,
        ...identity,
        screen_id: "SCR-main",
        title: "Main",
        entry_guards: [],
        elements: [
          { id: "EL-login", type: "button", label: "Login", interaction: { action_kind: "authenticate", surface_kind: "web", target_candidates: [] }, evidence: [] },
          { id: "EL-export", type: "button", label: "Excel download", interaction: { action_kind: "download", surface_kind: "web", target_candidates: [] }, evidence: [] },
          { id: "EL-logout", type: "button", label: "Logout", interaction: { action_kind: "session-reset", surface_kind: "web", target_candidates: [] }, evidence: [] },
        ],
        apis: [], feedback: [], displays: [], status: "verified",
      }],
      edges: [], predicates: [],
    } satisfies FactBundle;
    const scenario = (scenario_id: string, element: string): ScenarioSet["scenarios"][number] => ({
      schema_version: 2, ...identity, scenario_id, workflow: "WF", kind: "normal", variation: {}, preconditions: [], path: [],
      steps: [{ n: 1, action: element, action_ref: { edge: `E-${scenario_id}`, element }, expected: "done", assertion_refs: [] }], status: "verified",
    });

    expect(summarizeLegacyJourneyCoverage(facts, { schema_version: 2, ...identity, scenarios: [
      scenario("1", "EL-login"), scenario("2", "EL-export"), scenario("3", "EL-logout"),
    ] }).completeScenarioIds).toEqual([]);
    expect(summarizeLegacyJourneyCoverage(facts, { schema_version: 2, ...identity, scenarios: [{
      ...scenario("4", "EL-login"),
      steps: ["EL-login", "EL-export", "EL-logout"].map((element, index) => ({ n: index + 1, action: element, action_ref: { edge: `E-${index}`, element }, expected: "done", assertion_refs: [] })),
    }] }).completeScenarioIds).toEqual(["4"]);
  });

  it("requires every golden journey and at least 80% of business classifications and workflows", () => {
    const golden = {
      projectPrefix: "TEST",
      counts: { classifications: 5, workflows: 5, transitions: 0, scenarios: 0, journeys: 2 },
      classificationIds: ["C1", "C2", "C3", "C4", "C5"],
      workflowIds: ["W1", "W2", "W3", "W4", "W5"],
      transitionIds: [], scenarioIds: [],
      journeys: [
        { journeyId: "J1", purpose: "normal", kind: "normal" as const, route: "", scenarioRefs: [], verdict: "필수", required: true },
        { journeyId: "J2", purpose: "recovery", kind: "recovery" as const, route: "", scenarioRefs: [], verdict: "필수", required: true },
      ],
    };
    const match = (golden_ref: string, score = 0.8) => ({ golden_ref, candidate_refs: [`candidate-${golden_ref}`], score, rationale: "same source-backed intent" });

    expect(evaluateGoldenSimilarity(golden, {
      schema_version: 1,
      classification_matches: golden.classificationIds.slice(0, 4).map((id) => match(id)),
      workflow_matches: golden.workflowIds.slice(0, 4).map((id) => match(id)),
      journey_matches: golden.journeys.map((journey) => match(journey.journeyId)),
      critical_gaps: [],
    })).toMatchObject({ passed: true, classificationRecall: 0.8, workflowRecall: 0.8, requiredJourneyRecall: 1 });

    expect(evaluateGoldenSimilarity(golden, {
      schema_version: 1,
      classification_matches: golden.classificationIds.map((id) => match(id)),
      workflow_matches: golden.workflowIds.map((id) => match(id)),
      journey_matches: [match("J1")],
      critical_gaps: ["J2 missing"],
    })).toMatchObject({ passed: false, requiredJourneyRecall: 0.5 });
  });

  it("requires distinct kind-compatible candidates for normal and recovery golden journeys", () => {
    const golden = {
      projectPrefix: "TEST",
      counts: { classifications: 0, workflows: 0, transitions: 0, scenarios: 0, journeys: 2 },
      classificationIds: [], workflowIds: [], transitionIds: [], scenarioIds: [],
      journeys: [
        { journeyId: "J1", purpose: "normal", kind: "normal" as const, route: "", scenarioRefs: [], verdict: "필수", required: true },
        { journeyId: "J2", purpose: "recovery", kind: "recovery" as const, route: "", scenarioRefs: [], verdict: "필수", required: true },
      ],
    };
    const candidate = {
      schema_version: 1,
      project_name: "sample",
      classifications: [], workflows: [], unresolved: [],
      journeys: [{ journey_id: "candidate-normal", kind: "normal", goal: "", classification_refs: [], segments: [], business_outcome: { description: "", evidence: [] }, exit: { kind: "logout", action: "", outcome: "", evidence: [] } }],
    } as JourneyCandidate;

    const result = evaluateGoldenSimilarity(golden, {
      schema_version: 1,
      classification_matches: [], workflow_matches: [], critical_gaps: [],
      journey_matches: [
        { golden_ref: "J1", candidate_refs: ["candidate-normal"], score: 0.9, rationale: "normal" },
        { golden_ref: "J2", candidate_refs: ["candidate-normal"], score: 0.9, rationale: "incorrect reuse" },
      ],
    }, 0.7, candidate);

    expect(result).toMatchObject({ passed: false, requiredJourneyRecall: 0.5 });
  });

  it("fails closed for malformed semantic assessments", () => {
    const golden = {
      projectPrefix: "TEST",
      counts: { classifications: 1, workflows: 0, transitions: 0, scenarios: 0, journeys: 0 },
      classificationIds: ["C1"], workflowIds: [], transitionIds: [], scenarioIds: [], journeys: [],
    };

    expect(evaluateGoldenSimilarity(golden, {} as never)).toMatchObject({
      passed: false,
      classificationRecall: 0,
      criticalGaps: expect.arrayContaining(["ASSESSMENT_CLASSIFICATION_MATCHES_INVALID"]),
    });
  });

  it("measures golden scenario recall without reusing one candidate for multiple golden cases", () => {
    const golden = {
      projectPrefix: "TEST",
      counts: { classifications: 0, workflows: 0, transitions: 0, scenarios: 3, journeys: 0 },
      classificationIds: [], workflowIds: [], transitionIds: [], scenarioIds: ["S1", "S2", "S3"], journeys: [],
    };

    const result = evaluateGoldenScenarioSimilarity(golden, {
      schema_version: 1,
      scenario_matches: [
        { golden_ref: "S1", candidate_refs: ["candidate-shared"], score: 0.9, rationale: "same branch" },
        { golden_ref: "S2", candidate_refs: ["candidate-shared"], score: 0.9, rationale: "over-broad reuse" },
        { golden_ref: "S3", candidate_refs: ["candidate-distinct"], score: 0.8, rationale: "same branch" },
      ],
      critical_gaps: [],
    }, 0.7, 0.6);

    expect(result).toEqual({
      passed: true,
      scenarioRecall: 2 / 3,
      matchedScenarioCount: 2,
      totalGoldenScenarios: 3,
      unmatchedGoldenScenarioIds: ["S2"],
      criticalGaps: [],
    });
  });

  it("fails closed for duplicate or malformed golden scenario assessment rows", () => {
    const golden = {
      projectPrefix: "TEST",
      counts: { classifications: 0, workflows: 0, transitions: 0, scenarios: 1, journeys: 0 },
      classificationIds: [], workflowIds: [], transitionIds: [], scenarioIds: ["S1"], journeys: [],
    };

    const result = evaluateGoldenScenarioSimilarity(golden, {
      schema_version: 1,
      scenario_matches: [
        { golden_ref: "S1", candidate_refs: ["candidate-1"], score: 0.9, rationale: "match" },
        { golden_ref: "S1", candidate_refs: ["candidate-2"], score: 0.8, rationale: "duplicate" },
      ],
      critical_gaps: [],
    });

    expect(result).toMatchObject({
      passed: false,
      scenarioRecall: 1,
      criticalGaps: ["ASSESSMENT_SCENARIO_MATCH_DUPLICATE:S1"],
    });
    expect(evaluateGoldenScenarioSimilarity(golden, {} as never)).toMatchObject({
      passed: false,
      scenarioRecall: 0,
      criticalGaps: expect.arrayContaining([
        "ASSESSMENT_SCHEMA_VERSION_INVALID",
        "ASSESSMENT_SCENARIO_MATCHES_INVALID",
        "ASSESSMENT_CRITICAL_GAPS_INVALID",
      ]),
    });
  });

  it("uses success coverage as the gate while reporting resilience coverage separately", () => {
    const golden = {
      projectPrefix: "TEST",
      counts: { classifications: 0, workflows: 0, transitions: 0, scenarios: 3, journeys: 0 },
      classificationIds: [], workflowIds: [], transitionIds: [], scenarioIds: ["S1", "S2", "S3"], journeys: [],
      scenarioKinds: [
        { scenarioId: "S1", kinds: ["normal" as const] },
        { scenarioId: "S2", kinds: ["normal" as const, "exception" as const] },
        { scenarioId: "S3", kinds: ["exception" as const] },
      ],
    };

    const result = evaluateGoldenScenarioPriority(golden, {
      schema_version: 1,
      scenario_matches: [
        { golden_ref: "S1", candidate_refs: ["C1"], score: 0.9, success_candidate_refs: ["C1"], success_score: 0.9, resilience_candidate_refs: [], resilience_score: null, rationale: "success" },
        { golden_ref: "S2", candidate_refs: ["C2"], score: 0.6, success_candidate_refs: ["C2"], success_score: 0.8, resilience_candidate_refs: [], resilience_score: 0.2, rationale: "success only" },
        { golden_ref: "S3", candidate_refs: [], score: 0.1, success_candidate_refs: [], success_score: null, resilience_candidate_refs: [], resilience_score: 0.1, rationale: "missing exception" },
      ],
    }, 0.7, 0.8);

    expect(result).toEqual({
      passed: true,
      successScenarioRecall: 1,
      matchedSuccessScenarioCount: 2,
      totalSuccessScenarios: 2,
      unmatchedSuccessScenarioIds: [],
      resilienceScenarioRecall: 0,
      matchedResilienceScenarioCount: 0,
      totalResilienceScenarios: 2,
      unmatchedResilienceScenarioIds: ["S2", "S3"],
      assessmentIssues: [],
    });
  });

  it("targets and merges only golden scenario rows with unknown candidate references", () => {
    const golden = {
      projectPrefix: "TEST",
      counts: { classifications: 0, workflows: 0, transitions: 0, scenarios: 2, journeys: 0 },
      classificationIds: [], workflowIds: [], transitionIds: [], scenarioIds: ["S1", "S2"], journeys: [],
      scenarioKinds: [
        { scenarioId: "S1", kinds: ["normal" as const] },
        { scenarioId: "S2", kinds: ["normal" as const, "recovery" as const] },
      ],
    };
    const assessment = {
      schema_version: 1 as const,
      scenario_matches: [
        { golden_ref: "S1", candidate_refs: ["SCN-ONE-001"], score: 0.9, success_candidate_refs: ["SCN-ONE-001"], success_score: 0.9, resilience_candidate_refs: [], resilience_score: null, rationale: "preserve" },
        { golden_ref: "S2", candidate_refs: ["SCN-BUSINESS-CE6F1E6C-002"], score: 0.8, success_candidate_refs: ["SCN-CE6F1E6C-002"], success_score: 0.8, resilience_candidate_refs: ["SCN-BUSINESS-CE6F1E6C-002"], resilience_score: 0.8, rationale: "correct one ref" },
      ],
    };
    const plan = createGoldenScenarioAssessmentCorrectionPlan(assessment, golden, ["SCN-ONE-001", "SCN-BUSINESS-CE6F1E6C-002"]);

    expect(plan).toEqual({
      schema_version: 1,
      target_golden_refs: ["S2"],
      targets: [{
        golden_ref: "S2",
        fields: ["success_candidate_refs"],
        unknown_candidate_refs: ["SCN-CE6F1E6C-002"],
        suggested_candidate_refs: ["SCN-BUSINESS-CE6F1E6C-002"],
      }],
    });

    const merged = applyGoldenScenarioAssessmentCorrectionPatch(assessment, {
      schema_version: 1,
      scenario_matches: [{ ...assessment.scenario_matches[1], success_candidate_refs: ["SCN-BUSINESS-CE6F1E6C-002"] }],
    }, plan);
    expect(merged.scenario_matches[0]).toEqual(assessment.scenario_matches[0]);
    expect(merged.scenario_matches[1].success_candidate_refs).toEqual(["SCN-BUSINESS-CE6F1E6C-002"]);
    expect(() => applyGoldenScenarioAssessmentCorrectionPatch(assessment, {
      schema_version: 1,
      scenario_matches: [{ ...assessment.scenario_matches[1], score: 0.1, success_candidate_refs: ["SCN-BUSINESS-CE6F1E6C-002"] }],
    }, plan)).toThrow("GOLDEN_SCENARIO_CORRECTION_PATCH_FIELD_SCOPE_INVALID:S2:score");
    expect(() => applyGoldenScenarioAssessmentCorrectionPatch(assessment, { schema_version: 1, scenario_matches: [] }, plan))
      .toThrow("GOLDEN_SCENARIO_CORRECTION_PATCH_INCOMPLETE");
  });
});
