import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadRunSummaries } from "./run-summary";

/* 생성 이력의 원천은 디스크다. 예전에는 renderer localStorage 였고, 새 프로필이나
 * 다른 기기에서는 디스크에 run 이 있어도 목록이 비어 보였다. */

let projectRoot: string;
const runRoot = (runId: string) => join(projectRoot, ".scenarioforge", "runs", runId);

async function seedRun(input: {
  runId: string;
  createdAt: string;
  scenarios?: number;
  facts?: { screens: number; edges: number; predicates: number };
  wikiPages?: number;
  registerScenarios?: boolean;
}) {
  const root = runRoot(input.runId);
  await mkdir(join(root, "facts"), { recursive: true });
  const artifacts: Array<{ artifact_id: string; artifact_type: string; content_hash: string }> = [];

  if (input.registerScenarios !== false && input.scenarios !== undefined) {
    artifacts.push({ artifact_id: `SCENARIOS-${input.runId}`, artifact_type: "scenario-set", content_hash: "h" });
    await writeFile(
      join(root, "scenario-set.json"),
      JSON.stringify({ scenarios: Array.from({ length: input.scenarios }, (_v, i) => ({ scenario_id: `SCN-${i}` })) }),
    );
  }
  if (input.facts) {
    artifacts.push({ artifact_id: `FACT-${input.runId}`, artifact_type: "fact-bundle", content_hash: "h" });
    await writeFile(
      join(root, "facts", `FACT-${input.runId}.json`),
      JSON.stringify({
        screens: Array.from({ length: input.facts.screens }, () => ({})),
        edges: Array.from({ length: input.facts.edges }, () => ({})),
        predicates: Array.from({ length: input.facts.predicates }, () => ({})),
      }),
    );
  }
  if (input.wikiPages !== undefined) {
    artifacts.push({ artifact_id: `WIKI-${input.runId}`, artifact_type: "wiki-bundle", content_hash: "h" });
    await writeFile(
      join(root, "wiki-bundle.json"),
      JSON.stringify({ workflows: Array.from({ length: input.wikiPages }, () => ({})) }),
    );
  }
  await writeFile(
    join(root, "manifest.json"),
    JSON.stringify({ schema_version: 2, analysis_run_id: input.runId, created_at: input.createdAt, final_revision: 1, artifacts }),
  );
}

beforeEach(async () => {
  projectRoot = await mkdtemp(join(tmpdir(), "scenarioforge-runs-summary-"));
});

afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
});

describe("generation history from disk", () => {
  it("returns nothing when the project was never analyzed", async () => {
    expect(await loadRunSummaries(projectRoot)).toEqual([]);
  });

  it("counts artifacts and puts the newest run first", async () => {
    await seedRun({ runId: "RUN-old", createdAt: "2026-09-01T00:00:00.000Z", scenarios: 19, facts: { screens: 30, edges: 40, predicates: 5 }, wikiPages: 31 });
    await seedRun({ runId: "RUN-new", createdAt: "2026-09-07T00:00:00.000Z", scenarios: 24, facts: { screens: 40, edges: 50, predicates: 6 }, wikiPages: 36 });

    const runs = await loadRunSummaries(projectRoot);

    expect(runs.map((run) => run.runId)).toEqual(["RUN-new", "RUN-old"]);
    expect(runs[0]).toMatchObject({ complete: true, scenarios: 24, facts: 96, wikiPages: 36 });
  });

  it("keeps a run whose scenario artifact is not registered yet and marks it incomplete", async () => {
    await seedRun({ runId: "RUN-partial", createdAt: "2026-09-05T00:00:00.000Z", facts: { screens: 10, edges: 5, predicates: 1 } });

    const runs = await loadRunSummaries(projectRoot);

    // 조용히 숨기면 디스크에 있는 run 을 사용자가 볼 수 없다.
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ runId: "RUN-partial", complete: false, facts: 16 });
    expect(runs[0]?.scenarios).toBeUndefined();
  });

  it("keeps a run directory that has no manifest at all", async () => {
    await mkdir(runRoot("RUN-empty"), { recursive: true });

    expect(await loadRunSummaries(projectRoot)).toEqual([{ runId: "RUN-empty", complete: false }]);
  });

  it("rejects a manifest whose run id does not match its directory", async () => {
    await mkdir(runRoot("RUN-a"), { recursive: true });
    await writeFile(
      join(runRoot("RUN-a"), "manifest.json"),
      JSON.stringify({ schema_version: 2, analysis_run_id: "RUN-other", created_at: "2026-09-01T00:00:00.000Z", artifacts: [] }),
    );

    expect(await loadRunSummaries(projectRoot)).toEqual([{ runId: "RUN-a", complete: false }]);
  });

  it("puts runs without a recorded time after the dated ones", async () => {
    await seedRun({ runId: "RUN-dated", createdAt: "2026-09-01T00:00:00.000Z", scenarios: 3 });
    await mkdir(runRoot("RUN-nodate"), { recursive: true });

    expect((await loadRunSummaries(projectRoot)).map((run) => run.runId)).toEqual(["RUN-dated", "RUN-nodate"]);
  });
});
