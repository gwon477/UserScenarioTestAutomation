import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { BusinessCatalog, CoverageManifest, EdgeLedger, FactBundle, FactCatalog, GenerationStep, ProjectRuntimeState, ScenarioSet, ScenarioSkeleton, SourceSnapshot, WikiBundle } from "@scenarioforge/contracts";
import { GENERATION_STEPS } from "@scenarioforge/contracts";
import { assembleFactBundle, calculateCoverage, compileScenarioSkeleton, generationStepRegistry, scenarioSetFromSkeleton, validateFactBundle, validateScenarioSet, validateSourceSnapshot, validateWikiBundle } from "@scenarioforge/scenario-pipeline";

const runId = process.env.SCENARIOFORGE_INSPECT_RUN_ID;
const expectedStep = process.env.SCENARIOFORGE_INSPECT_STEP as GenerationStep | undefined;
const projectRoot = join(process.cwd(), "test_project_source", "axse-agents");

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

describe.skipIf(!runId || !expectedStep)("axse-agents persisted fine-step inspection", () => {
  it("validates every persisted receipt up to the requested boundary", async () => {
    const state = await readJson<ProjectRuntimeState>(join(projectRoot, ".scenarioforge", "state", "project-state.json"));
    expect(state.analysisRunId).toBe(runId);
    const expectedIndex = GENERATION_STEPS.indexOf(expectedStep!);
    expect(expectedIndex).toBeGreaterThanOrEqual(0);
    for (const [index, step] of GENERATION_STEPS.entries()) {
      expect(state.generationSteps[step].status).toBe(index <= expectedIndex ? "completed" : "pending");
      if (index <= expectedIndex) {
        const receiptId = state.generationSteps[step].receiptArtifactId!;
        expect(state.artifacts[receiptId]).toMatchObject({ analysisRunId: runId, generationStep: step, status: "persisted" });
      }
    }

    const artifact = <T>(id: string) => {
      const record = state.artifacts[id];
      if (!record?.finalPath) throw new Error(`INSPECTION_ARTIFACT_MISSING:${id}`);
      return readJson<T>(record.finalPath);
    };
    const snapshot = await artifact<SourceSnapshot>(state.sourceSnapshotId!);
    expect(validateSourceSnapshot(snapshot)).toMatchObject({ valid: true, issues: [] });
    for (const step of GENERATION_STEPS.filter((candidate) => generationStepRegistry[candidate].executor === "llm" && GENERATION_STEPS.indexOf(candidate) <= expectedIndex)) {
      const contextId = state.generationSteps[step].contextManifestArtifactId;
      expect(contextId).toBeTruthy();
      const context = await artifact<{ generationStep: GenerationStep; contextBytes: number; estimatedTokens: number; payloadHash: string }>(contextId!);
      expect(context.generationStep).toBe(step);
      expect(context.contextBytes).toBeLessThanOrEqual(generationStepRegistry[step].contextBudgetBytes);
      expect(context.contextBytes).toBeLessThanOrEqual(generationStepRegistry[step].contextBudgetBytes);
      expect(context.estimatedTokens).toBe(Math.ceil(context.contextBytes / 4));
      expect(context.payloadHash).toMatch(/^[a-f0-9]{64}$/);
    }
    if (expectedIndex === 0) return;

    const catalog = await artifact<FactCatalog>(`FACT-CATALOG-${runId}`);
    const catalogAsFact: FactBundle = { schema_version: 2, project_id: catalog.project_id, analysis_run_id: catalog.analysis_run_id, source_snapshot_id: catalog.source_snapshot_id, screens: catalog.screens, predicates: catalog.predicates, edges: [] };
    expect(validateFactBundle(catalogAsFact)).toMatchObject({ valid: true, issues: [] });
    expect(catalog.screens.length).toBeGreaterThan(0);
    if (expectedIndex === 1) return;

    const ledger = await artifact<EdgeLedger>(`EDGE-LEDGER-${runId}`);
    const assembled = assembleFactBundle(catalog, ledger);
    expect(validateFactBundle(assembled)).toMatchObject({ valid: true, issues: [] });
    expect(ledger.edges.length).toBeGreaterThan(0);
    if (expectedIndex === 2) return;

    const facts = await artifact<FactBundle>(`FACT-${runId}`);
    expect(facts).toEqual(assembled);
    if (expectedIndex === 3) return;

    const workflowSkeleton = await artifact<WikiBundle>(`WORKFLOW-SKELETON-${runId}`);
    expect(validateWikiBundle(workflowSkeleton, facts)).toMatchObject({ valid: true, issues: [] });
    if (expectedIndex === 4) return;

    const wiki = await artifact<WikiBundle>(`WIKI-${runId}`);
    expect(validateWikiBundle(wiki, facts)).toMatchObject({ valid: true, issues: [] });
    expect(wiki.workflows.map(({ goal: _goal, ...workflow }) => workflow)).toEqual(workflowSkeleton.workflows.map(({ goal: _goal, ...workflow }) => workflow));
    if (expectedIndex === 5) return;

    const business = await artifact<BusinessCatalog>(`BUSINESS-CATALOG-${runId}`);
    const classifiedWorkflows = business.classifications.flatMap((classification) => classification.workflow_refs).sort();
    expect(classifiedWorkflows).toEqual(wiki.workflows.map((workflow) => workflow.workflow).sort());
    expect(new Set(classifiedWorkflows).size).toBe(classifiedWorkflows.length);
    if (expectedIndex === 6) return;

    const scenarioSkeleton = await artifact<ScenarioSkeleton>(`SCENARIO-SKELETON-${runId}`);
    expect(scenarioSkeleton).toEqual(compileScenarioSkeleton(facts, wiki, business));
    const deterministicDraft = scenarioSetFromSkeleton(scenarioSkeleton);
    expect(validateScenarioSet(deterministicDraft, facts, wiki, deterministicDraft)).toMatchObject({ valid: true, issues: [] });
    const elements = new Map(facts.screens.flatMap((screen) => screen.elements.map((element) => [element.id, element] as const)));
    const authenticationScreens = new Set(facts.screens
      .filter((screen) => screen.apis.some((api) => [api.id, ...api.reads, ...api.writes].some((value) => /(?:authenticate|authentication|log[\s/_-]?in|sign[\s/_-]?in)/i.test(value))))
      .map((screen) => screen.screen_id));
    const loginEdge = facts.edges.find((edge) => edge.kind === "normal" && authenticationScreens.has(edge.from.split("[")[0]) && edge.from.split("[")[0] !== edge.to.split("[")[0]);
    expect(loginEdge).toBeTruthy();
    const successfulDownloads = facts.edges.filter((edge) => {
      const element = elements.get(edge.on);
      return edge.kind === "normal" && element?.interaction.action_kind.toLowerCase().includes("download") && /csv|excel|xlsx|엑셀/i.test(element.label);
    });
    expect(successfulDownloads.some((edge) => /csv/i.test(elements.get(edge.on)!.label))).toBe(true);
    expect(successfulDownloads.some((edge) => /excel|xlsx|엑셀/i.test(elements.get(edge.on)!.label))).toBe(true);
    for (const download of successfulDownloads) {
      const scenario = deterministicDraft.scenarios.find((candidate) => candidate.path.includes(download.edge_id));
      expect(scenario?.path[0]).toBe(loginEdge!.edge_id);
      expect(scenario?.path.at(-1)).toBe(download.edge_id);
    }
    const logoutEdges = facts.edges.filter((edge) => edge.kind === "normal" && elements.get(edge.on)?.interaction.action_kind.toLowerCase().includes("logout"));
    expect(logoutEdges.length).toBeGreaterThan(0);
    for (const logout of logoutEdges) {
      const scenario = deterministicDraft.scenarios.find((candidate) => candidate.path.includes(logout.edge_id));
      expect(scenario?.path[0]).toBe(loginEdge!.edge_id);
      expect(scenario?.path.at(-1)).toBe(logout.edge_id);
    }
    if (expectedIndex === 7) return;

    const scenarios = await artifact<ScenarioSet>(`SCENARIOS-${runId}`);
    expect(validateScenarioSet(scenarios, facts, wiki, deterministicDraft)).toMatchObject({ valid: true, issues: [] });
    expect(calculateCoverage(facts, scenarios)).toMatchObject({ coverage_percent: 100, uncovered_edge_ids: [] });
    if (expectedIndex === 8) return;

    const coverage = await artifact<CoverageManifest>(`COVERAGE-MANIFEST-${runId}`);
    expect(coverage.coverage).toMatchObject({ coverage_percent: 100, uncovered_edge_ids: [] });

  });
});
