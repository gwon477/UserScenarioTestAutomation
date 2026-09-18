import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  evaluateGoldenSimilarity,
  evaluateJourneyCandidate,
  parseGoldenDatasetMarkdown,
  SourceScanner,
  type EvidenceGrant,
  type GoldenSemanticAssessment,
  type JourneyCandidate,
} from "@scenarioforge/scenario-pipeline";

const resultPath = process.env.SCENARIOFORGE_JOURNEY_PROBE_RESULT;
const requireResult = process.env.SCENARIOFORGE_REQUIRE_JOURNEY_PROBE === "1";
const projectRoot = join(import.meta.dirname, "../../test_project_source/axse-agents");

describe.runIf(requireResult && !resultPath)("AXSE isolated journey design probe requirement", () => {
  it("requires an explicit fresh probe result path", () => {
    expect(resultPath, "SCENARIOFORGE_JOURNEY_PROBE_RESULT is required").toBeTruthy();
  });
});

describe.runIf(Boolean(resultPath))("AXSE isolated journey design probe", () => {
  it("is source-grounded and semantically similar to the golden business and journey structure", async () => {
    const result = JSON.parse(await readFile(resolve(resultPath!), "utf8")) as {
      project_name: string;
      model_id: string;
      provenance: { prompt_contract_version: number; source_snapshot_id: string; source_root_hash: string; source_selection_digest: string };
      source_snapshot: { source_snapshot_id: string; root_hash: string };
      evidence_grant: EvidenceGrant;
      candidate: JourneyCandidate;
      assessment: GoldenSemanticAssessment;
    };
    const golden = parseGoldenDatasetMarkdown(await readFile(join(projectRoot, "SCENARIOFORGE_GOLDEN_DATASET.md"), "utf8"));
    const currentSnapshot = await new SourceScanner().scan({ projectRoot, projectId: "P-verify", analysisRunId: "RUN-verify", sourceSnapshotId: "SS-verify" });
    const structure = await evaluateJourneyCandidate(result.evidence_grant, result.candidate);
    const similarity = evaluateGoldenSimilarity(golden, result.assessment, 0.7, result.candidate);
    const candidateIds = new Set([
      ...result.candidate.classifications.map((entry) => entry.classification_id),
      ...result.candidate.workflows.map((entry) => entry.workflow_id),
      ...result.candidate.journeys.map((entry) => entry.journey_id),
    ]);
    const unknownCandidateRefs = [
      ...result.assessment.classification_matches,
      ...result.assessment.workflow_matches,
      ...result.assessment.journey_matches,
    ].flatMap((entry) => entry.candidate_refs).filter((reference) => !candidateIds.has(reference));

    expect(result.project_name).toBe("axse-agents");
    expect(result.model_id).toBe("gpt-5.6-luna");
    expect(result.provenance).toMatchObject({
      prompt_contract_version: 2,
      source_snapshot_id: result.source_snapshot.source_snapshot_id,
      source_root_hash: currentSnapshot.root_hash,
    });
    expect(result.source_snapshot.root_hash).toBe(currentSnapshot.root_hash);
    expect(result.evidence_grant.source_snapshot_id).toBe(result.source_snapshot.source_snapshot_id);
    expect(structure, structure.issues.join("\n")).toMatchObject({ valid: true });
    expect(structure.completeJourneyIds).toHaveLength(result.candidate.journeys.length);
    expect(unknownCandidateRefs).toEqual([]);
    expect(similarity, similarity.criticalGaps.join("\n")).toMatchObject({ passed: true, requiredJourneyRecall: 1 });
    expect(similarity.classificationRecall).toBeGreaterThanOrEqual(0.8);
    expect(similarity.workflowRecall).toBeGreaterThanOrEqual(0.8);
    const normalJourneys = result.candidate.journeys.filter((journey) => journey.kind === "normal");
    const recoveryJourneys = result.candidate.journeys.filter((journey) => journey.kind === "recovery");
    expect(normalJourneys.length).toBeGreaterThanOrEqual(1);
    expect(recoveryJourneys.length).toBeGreaterThanOrEqual(1);
    for (const journey of recoveryJourneys) {
      const milestones = journey.segments.flatMap((segment) => segment.milestones);
      const positions = new Map(milestones.map((milestone, index) => [milestone.milestone_id, index]));
      expect(positions.get(journey.recovery!.failure_milestone_ref)).toBeLessThan(positions.get(journey.recovery!.rejoin_milestone_ref)!);
      expect(journey.business_outcome.description.trim()).not.toBe("");
      expect(journey.exit.action.trim()).not.toBe("");
    }
  });
});
