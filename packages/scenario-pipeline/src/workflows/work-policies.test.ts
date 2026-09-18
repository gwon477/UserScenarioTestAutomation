import { describe, expect, it } from "vitest";
import { createGenerationWorkDescriptor, generationWorkPolicies, retryDelay, WorkScopeGuard, canIntegrateChild } from "../index.js";

describe("generation work isolation", () => {
  it("owns generation and scenario chat policies without execution writes", () => {
    expect(generationWorkPolicies["scenario.answer"]).toMatchObject({ sessionKind: "chat", childWork: "forbidden", writableEntities: ["conversation-record"] });
    for (const policy of Object.values(generationWorkPolicies)) {
      expect(policy.writableEntities).not.toContain("test-execution");
      expect(policy.writableEntities).not.toContain("canonical-state");
    }
  });

  it("enforces child ownership and settled integration", () => {
    const parent = createGenerationWorkDescriptor({ projectId: "project-1", analysisRunId: "run-1", sessionId: "session-1", workId: "parent-1", kind: "analysis.fact-extract", expectedRevision: 0, inputIds: [] });
    const child = createGenerationWorkDescriptor({ projectId: "project-1", analysisRunId: "run-1", sessionId: "session-1", workId: "child-1", parentWorkId: "parent-1", kind: "analysis.fact-extract", expectedRevision: 0, inputIds: [] });
    expect(() => new WorkScopeGuard().assertMutation(child, { entityOwnerWorkId: parent.workId })).toThrow("WORK_SCOPE_VIOLATION");
    expect(canIntegrateChild(parent, { workId: child.workId, parentWorkId: parent.workId, status: "settled" })).toBe(true);
    expect(canIntegrateChild(parent, { workId: child.workId, parentWorkId: parent.workId, status: "running" })).toBe(false);
  });

  it("retries only transient provider failures twice", () => {
    expect(retryDelay("provider-timeout", 1)).toBe(1000);
    expect(retryDelay("network-transient", 2)).toBe(3000);
    expect(retryDelay("provider-rate-limit", 1)).toBe(60_000);
    expect(retryDelay("provider-rate-limit", 2)).toBe(120_000);
    expect(retryDelay("provider-rate-limit", 3)).toBeNull();
    expect(retryDelay("schema", 1)).toBeNull();
  });
});
