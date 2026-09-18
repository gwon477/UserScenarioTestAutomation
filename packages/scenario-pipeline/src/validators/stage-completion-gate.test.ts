import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AnalysisCoordinator, ArtifactIndex, ArtifactWriter, StageCompletionGate } from "../index.js";

const validGateInput = {
  stage: "fact" as const,
  sessionStatus: "settled" as const,
  rootWorkStatus: "settled" as const,
  childWorkStatuses: [],
  activeActivities: [],
  artifactSchemaValid: true,
  requiredRelationsValid: true,
  finalArtifactPersisted: true,
  indexCandidateValid: true,
  stageManifestValid: true,
  journalCheckpointCommitted: true,
};

describe("analysis completion boundary", () => {
  it("does not complete FACT from agent_end alone", () => {
    expect(new StageCompletionGate().decide({ ...validGateInput, artifactSchemaValid: false, finalArtifactPersisted: false, indexCandidateValid: false, stageManifestValid: false })).toEqual({
      accepted: false,
      unmetGates: ["FACT_SCHEMA_INVALID"],
    });
  });

  it("does not complete while a declared child work is pending", () => {
    expect(new StageCompletionGate().decide({ ...validGateInput, childWorkStatuses: ["pending"] })).toEqual({ accepted: false, unmetGates: ["WORK_TREE_NOT_SETTLED"] });
  });

  it("enforces SRC to FACT to WIKI to SCENARIO order and immutable completion", () => {
    const coordinator = new AnalysisCoordinator();
    expect(() => coordinator.start("fact")).toThrow("ANALYSIS_STAGE_ORDER_VIOLATION");
    coordinator.start("src");
    expect(coordinator.requestCompletion({ ...validGateInput, stage: "src" }).accepted).toBe(true);
    expect(() => coordinator.start("src")).toThrow("COMPLETED_STAGE_IMMUTABLE");
    expect(coordinator.start("fact").attempt).toBe(1);
  });

  it("filters index rows by canonical revision and journal hash", async () => {
    const root = await mkdtemp(join(tmpdir(), "scenarioforge-index-"));
    const index = new ArtifactIndex(join(root, "scenario-index.sqlite"));
    index.insert([{ transactionId: "tx-1", stateRevision: 3, artifactId: "FACT-1", relatedId: "SCN-1", contentHash: "hash-1" }]);
    expect(index.queryByRelatedId("SCN-1", 2, () => true)).toEqual([]);
    expect(index.queryByRelatedId("SCN-1", 3, (tx, revision, hash) => tx === "tx-1" && revision === 3 && hash === "hash-1")).toHaveLength(1);
    expect(index.queryByRelatedId("SCN-1", 3, () => false)).toEqual([]);
    index.close();
  });

  it("moves an uncommitted final artifact to the orphan store", async () => {
    const root = await mkdtemp(join(tmpdir(), "scenarioforge-orphan-"));
    const writer = new ArtifactWriter(root);
    await writer.writeJson("run-1", "fact", "FACT-ORPHAN-1", { id: "FACT-ORPHAN-1" });
    const moved = await writer.recoverOrphans("run-1", new Set());
    expect(moved).toHaveLength(1);
    await expect(stat(join(root, ".scenarioforge/state/orphans/run-1-FACT-ORPHAN-1.json"))).resolves.toBeDefined();
  });
});
