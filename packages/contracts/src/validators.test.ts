import { describe, expect, it } from "vitest";
import {
  createInitialProjectRuntimeState,
  getNextGenerationStep,
  validateDomainEvent,
  validateProjectRuntimeState,
  validateWorkDescriptor,
} from "./index.js";

describe("runtime contract validators", () => {
  it("rejects completed scenario without a persisted artifact", () => {
    const initial = createInitialProjectRuntimeState();
    const state = {
      ...initial,
      stages: { src: "completed", fact: "completed", wiki: "completed", scenario: "completed" } as const,
      artifactStatus: { src: "persisted", fact: "persisted", wiki: "persisted", scenario: "verified" } as const,
    };
    expect(validateProjectRuntimeState(state)).toEqual({ ok: false, code: "SCENARIO_ARTIFACT_NOT_PERSISTED" });
  });

  it("rejects unknown work and event values", () => {
    expect(validateWorkDescriptor({ kind: "analysis.magic" })).toEqual({ ok: false, code: "INVALID_SCHEMA_VERSION" });
    expect(validateDomainEvent({ schemaVersion: 1, eventId: "evt", projectId: "project", occurredAt: "now", revision: -1, eventType: "work.updated", payload: {} })).toEqual({
      ok: false,
      code: "INVALID_REVISION",
    });
  });

  it("rejects unknown lifecycle values even when stage maps are valid", () => {
    expect(validateProjectRuntimeState({ ...createInitialProjectRuntimeState("project"), runtimeStatus: "magical" })).toEqual({ ok: false, code: "INVALID_RUNTIME_STATUS" });
  });

  it("creates a fixed generation chain with only source scan runnable", () => {
    const state = createInitialProjectRuntimeState("project");

    expect(getNextGenerationStep(state.generationSteps)).toBe("source-scan");
    expect(Object.values(state.generationSteps).filter((step) => step.status !== "pending")).toEqual([]);
    expect(validateProjectRuntimeState(state)).toEqual({ ok: true, value: state });
  });

  it("rejects a completed generation step without its persisted receipt", () => {
    const initial = createInitialProjectRuntimeState("project");
    const state = {
      ...initial,
      generationSteps: {
        ...initial.generationSteps,
        "source-scan": {
          ...initial.generationSteps["source-scan"],
          status: "completed" as const,
        },
      },
    };

    expect(validateProjectRuntimeState(state)).toEqual({ ok: false, code: "SOURCE_SCAN_RECEIPT_NOT_PERSISTED" });
  });
});
