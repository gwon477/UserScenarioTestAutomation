import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deleteAnalysisData, loadProjectSummary, unreachableSummary } from "./project-summary";

let projectRoot: string;

beforeEach(async () => {
  projectRoot = await mkdtemp(join(tmpdir(), "scenarioforge-project-"));
});

afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
});

describe("analysis data deletion", () => {
  it("removes only the analysis directory and leaves the source alone", async () => {
    await mkdir(join(projectRoot, ".scenarioforge", "runs", "RUN-1"), { recursive: true });
    await writeFile(join(projectRoot, ".scenarioforge", "runs", "RUN-1", "manifest.json"), "{}");
    await mkdir(join(projectRoot, "src"), { recursive: true });
    await writeFile(join(projectRoot, "src", "app.ts"), "export const a = 1;");

    await deleteAnalysisData(projectRoot);

    await expect(stat(join(projectRoot, ".scenarioforge"))).rejects.toThrow();
    // 원본 소스코드는 건드리지 않는다.
    expect((await stat(join(projectRoot, "src", "app.ts"))).isFile()).toBe(true);
  });

  it("does nothing when the project was never analyzed", async () => {
    await expect(deleteAnalysisData(projectRoot)).resolves.toBeUndefined();
  });

  it("refuses when the analysis path is not a directory", async () => {
    await writeFile(join(projectRoot, ".scenarioforge"), "not a directory");

    await expect(deleteAnalysisData(projectRoot)).rejects.toThrow("ANALYSIS_PATH_NOT_DIRECTORY");
  });
});

describe("unreachable project summary", () => {
  it("keeps the entry visible with zeroed counts", () => {
    const summary = unreachableSummary({
      path: "/Volumes/ext/legacy-erp",
      addedAt: "2026-09-01T00:00:00.000Z",
    });

    expect(summary).toMatchObject({
      name: "legacy-erp",
      reachable: false,
      runs: 0,
      executions: 0,
      frames: 0,
      bytes: 0,
    });
  });
});

describe("latest run selection", () => {
  /** manifest 와 시나리오 산출물을 갖춘 run 하나를 만든다. */
  async function writeCompleteRun(runId: string, createdAt: string) {
    const runRoot = join(projectRoot, ".scenarioforge", "runs", runId);
    await mkdir(runRoot, { recursive: true });
    await writeFile(join(runRoot, "scenario-set.json"), JSON.stringify({ scenarios: [{ scenario_id: "SCN-1" }] }));
    await writeFile(
      join(runRoot, "manifest.json"),
      JSON.stringify({
        schema_version: 2,
        analysis_run_id: runId,
        created_at: createdAt,
        artifacts: [{ artifact_id: `SCENARIOS-${runId}`, artifact_type: "scenario-set", content_hash: "x" }],
      }),
    );
  }

  /* 「열기」가 바로 들어갈 run 이다. 디렉터리 이름 순서로 고르면 시나리오
   * 산출물이 없는 run 을 가리켜 열기가 실패한다. */
  it("points at the newest run that has a registered scenario artifact", async () => {
    await writeCompleteRun("RUN-a", "2026-09-01T00:00:00.000Z");
    await writeCompleteRun("RUN-b", "2026-09-09T00:00:00.000Z");
    // 이름 순서로는 마지막이지만 산출물이 없어 열 수 없는 run.
    await mkdir(join(projectRoot, ".scenarioforge", "runs", "RUN-z"), { recursive: true });

    const summary = await loadProjectSummary(projectRoot, { path: projectRoot, addedAt: "2026-09-01T00:00:00.000Z" });

    expect(summary.runs).toBe(3);
    expect(summary.latestRunId).toBe("RUN-b");
  });

  it("leaves the latest run unset when no run has a scenario artifact", async () => {
    await mkdir(join(projectRoot, ".scenarioforge", "runs", "RUN-z"), { recursive: true });

    const summary = await loadProjectSummary(projectRoot, { path: projectRoot, addedAt: "2026-09-01T00:00:00.000Z" });

    expect(summary.latestRunId).toBeUndefined();
  });
});
