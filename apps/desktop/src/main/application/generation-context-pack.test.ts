import { describe, expect, it } from "vitest";
import type { WorkDescriptor } from "@scenarioforge/contracts";
import { buildGenerationContextPack, canonicalJson } from "./generation-context-pack.js";

const work = {
  schemaVersion: 1,
  projectId: "PRJ-test",
  analysisRunId: "RUN-test",
  sourceSnapshotId: "SNAP-test",
  sessionId: "SESSION-test",
  workId: "WORK-test",
  kind: "analysis.fact-catalog",
  stage: "fact",
  generationStep: "fact-catalog",
  role: "author",
  outputArtifactType: "fact-catalog",
  attemptId: "ATTEMPT-test",
  expectedRevision: 1,
  inputIds: ["SNAP-test"],
  inputArtifacts: [{ artifactId: "SNAP-test", analysisRunId: "RUN-test", contentHash: "a".repeat(64) }],
  stagingPath: ".scenarioforge/staging/WORK-test",
  status: "running",
  createdAt: "2026-09-02T00:00:00.000Z",
  updatedAt: "2026-09-02T00:00:00.000Z",
  progress: 0,
  completionRequested: false,
} satisfies WorkDescriptor;

describe("generation context pack", () => {
  it("serializes object keys canonically while preserving array order", () => {
    expect(canonicalJson({ z: 1, nested: { b: 2, a: 1 }, list: [{ y: 2, x: 1 }, 3] })).toBe('{"list":[{"x":1,"y":2},3],"nested":{"a":1,"b":2},"z":1}');
    expect(canonicalJson({ nested: { a: 1, b: 2 }, list: [{ x: 1, y: 2 }, 3], z: 1 })).toBe('{"list":[{"x":1,"y":2},3],"nested":{"a":1,"b":2},"z":1}');
  });

  it("builds the same cache prefix and payload hash for semantically identical input", () => {
    const first = buildGenerationContextPack({ work, role: "author", payload: { screen: { title: "Login", id: "S1" }, refs: ["U1", "U2"] } });
    const second = buildGenerationContextPack({ work, role: "author", payload: { refs: ["U1", "U2"], screen: { id: "S1", title: "Login" } } });

    expect(first.serialized).toBe(second.serialized);
    expect(first.manifest).toEqual(second.manifest);
    expect(first.manifest.cacheKey).toBe("scenarioforge:fact-catalog:author:v2");
    expect(first.manifest.contextBytes).toBe(Buffer.byteLength(first.serialized, "utf8"));
    expect(first.manifest).toMatchObject({
      schemaVersion: 2,
      optimizationStrategy: "step-role-lane-compaction",
      sessionDisposition: "disposed-at-step-end",
    });
  });

  it("fails before provider invocation when a step context exceeds its registry budget", () => {
    expect(() => buildGenerationContextPack({ work, role: "author", payload: { oversized: "x".repeat(360_000) } })).toThrow("GENERATION_CONTEXT_BYTE_BUDGET_EXCEEDED:fact-catalog");
  });

  it("uses the byte budget as the single enforcement authority and keeps tokens observational", () => {
    expect(() => buildGenerationContextPack({ work, role: "author", payload: { oversized: "x".repeat(120_000) } })).toThrow("GENERATION_CONTEXT_BYTE_BUDGET_EXCEEDED:fact-catalog");
    const pack = buildGenerationContextPack({ work, role: "author", payload: { bounded: "x".repeat(80_000) } });
    expect(pack.manifest.estimatedTokens).toBe(Math.ceil(pack.manifest.contextBytes / 4));
  });
});
