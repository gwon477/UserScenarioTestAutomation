import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ProjectBootstrapper } from "../bootstrap/project-bootstrapper.js";
import { ProjectHistoryReset } from "./project-history-reset.js";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "scenarioforge-reset-"));
  await new ProjectBootstrapper().bootstrap({ projectRoot: root, projectId: "PRJ-reset", runtimeVersion: "1", protocolVersion: "1" });
  for (const path of ["runs/RUN-old/out.json", "sessions/analysis/old.jsonl", "staging/WORK-old/out.json", "logs/agent/old.log", "state/scenario-index.sqlite"]) {
    await mkdir(join(root, ".scenarioforge", path, ".."), { recursive: true });
    await writeFile(join(root, ".scenarioforge", path), "legacy", "utf8");
  }
  return root;
}

describe("project history reset", () => {
  it("removes disposable history while preserving runtime and project configuration", async () => {
    const root = await fixture();
    const runtimeBefore = await readFile(join(root, ".scenarioforge/runtime/runtime-manifest.json"), "utf8");
    const projectBefore = await readFile(join(root, ".scenarioforge/project.json"), "utf8");

    const result = await new ProjectHistoryReset().reset(root);

    expect(result.removedFiles).toBeGreaterThanOrEqual(5);
    expect(await readFile(join(root, ".scenarioforge/runtime/runtime-manifest.json"), "utf8")).toBe(runtimeBefore);
    expect(await readFile(join(root, ".scenarioforge/project.json"), "utf8")).toBe(projectBefore);
    const state = JSON.parse(await readFile(join(root, ".scenarioforge/state/project-state.json"), "utf8"));
    expect(state).toMatchObject({ schemaVersion: 2, projectId: "PRJ-reset", projectStatus: "ready", runtimeStatus: "ready", sessionStatus: "idle", works: {}, artifacts: {} });
    expect(state.analysisRunId).toBeUndefined();
    await expect(access(join(root, ".scenarioforge/runs/RUN-old/out.json"))).rejects.toThrow();
  });

  it("refuses reset while the current analysis is active", async () => {
    const root = await fixture();
    const statePath = join(root, ".scenarioforge/state/project-state.json");
    const state = JSON.parse(await readFile(statePath, "utf8"));
    await writeFile(statePath, JSON.stringify({ ...state, analysisRunId: "RUN-active", sessionId: "SESSION-active", sessionStatus: "running", activeStage: "fact", activeStep: "fact-catalog" }, null, 2), "utf8");

    await expect(new ProjectHistoryReset().reset(root)).rejects.toThrow("HISTORY_RESET_ACTIVE_ANALYSIS");
    await expect(readFile(join(root, ".scenarioforge/runs/RUN-old/out.json"), "utf8")).resolves.toBe("legacy");
  });

  it("rolls the quarantined history back when initialization fails", async () => {
    const root = await fixture();
    const reset = new ProjectHistoryReset({ afterQuarantine: () => { throw new Error("injected reset failure"); } });

    await expect(reset.reset(root)).rejects.toThrow("injected reset failure");
    await expect(readFile(join(root, ".scenarioforge/runs/RUN-old/out.json"), "utf8")).resolves.toBe("legacy");
    await expect(readFile(join(root, ".scenarioforge/state/scenario-index.sqlite"), "utf8")).resolves.toBe("legacy");
  });
});
