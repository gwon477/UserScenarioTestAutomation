import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ProjectHistoryReset } from "@scenarioforge/project-runtime";

const projectRoot = process.env.SCENARIOFORGE_RESET_PROJECT_ROOT;

describe.skipIf(!projectRoot)("supported live project history reset", () => {
  it("resets only disposable ScenarioForge history for the selected inactive project", async () => {
    const result = await new ProjectHistoryReset().reset(projectRoot!);
    const state = JSON.parse(await readFile(join(projectRoot!, ".scenarioforge", "state", "project-state.json"), "utf8"));
    expect(result.removedFiles).toBeGreaterThan(0);
    expect(state).toMatchObject({ schemaVersion: 2, projectStatus: "ready", runtimeStatus: "ready", sessionStatus: "idle", works: {}, artifacts: {} });
    expect(state.analysisRunId).toBeUndefined();
  });
});
