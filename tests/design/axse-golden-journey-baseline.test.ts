import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { BusinessCatalog, CoverageManifest, FactBundle, ScenarioSet, WikiBundle } from "@scenarioforge/contracts";
import { parseGoldenDatasetMarkdown, summarizeLegacyJourneyCoverage } from "@scenarioforge/scenario-pipeline";

const projectRoot = join(import.meta.dirname, "../../test_project_source/axse-agents");
const completedRunId = "RUN-e4e375ef-f74f-439c-9c46-222ab084989b";
const runRoot = join(projectRoot, ".scenarioforge/runs", completedRunId);

async function json<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

describe("AXSE golden journey legacy baseline", () => {
  it("proves that 100% edge coverage is not a complete user journey", async () => {
    const [goldenMarkdown, facts, wiki, business, scenarios, coverage] = await Promise.all([
      readFile(join(projectRoot, "SCENARIOFORGE_GOLDEN_DATASET.md"), "utf8"),
      json<FactBundle>(join(runRoot, "facts", `FACT-${completedRunId}.json`)),
      json<WikiBundle>(join(runRoot, "wiki", `WIKI-${completedRunId}.json`)),
      json<BusinessCatalog>(join(runRoot, "wiki", `BUSINESS-CATALOG-${completedRunId}.json`)),
      json<ScenarioSet>(join(runRoot, "scenario-set.json")),
      json<CoverageManifest["coverage"]>(join(runRoot, "coverage.json")),
    ]);
    const golden = parseGoldenDatasetMarkdown(goldenMarkdown);
    const journeyCoverage = summarizeLegacyJourneyCoverage(facts, scenarios);

    expect(golden.counts).toMatchObject({ classifications: 6, workflows: 10, scenarios: 44, journeys: 2 });
    expect({
      classifications: business.classifications.length,
      workflows: wiki.workflows.length,
      scenarios: scenarios.scenarios.length,
      maxSteps: Math.max(...scenarios.scenarios.map((scenario) => scenario.steps.length)),
    }).toEqual({ classifications: 18, workflows: 50, scenarios: 67, maxSteps: 3 });
    expect(coverage).toMatchObject({ total_edges: 65, covered_edges: 65, coverage_percent: 100 });
    expect(journeyCoverage).toEqual({
      completeScenarioIds: [],
      scenariosWithAuthentication: 11,
      scenariosWithBusinessOutput: 6,
      scenariosWithExit: 2,
    });
  });
});
