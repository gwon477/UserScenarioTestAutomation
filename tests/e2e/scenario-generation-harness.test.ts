import { mkdtemp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { FactBundle, FactCatalog, ScenarioSet, WikiBundle } from "@scenarioforge/contracts";
import { createEdgeLedger, EvidenceGrantService, ScenarioGenerationHarness, type GenerationExecutor } from "@scenarioforge/scenario-pipeline";

type InvalidFact = false | "empty-title" | "missing-apis" | "foreign-id";

function executor(projectRoot: string, invalidFact: InvalidFact = false): GenerationExecutor {
  return {
    async planGeneration({ template }) {
      return {
        ...template,
        objective: "Generate one evidence-grounded scenario set.",
        steps: template.steps.map((entry) => ({
          ...entry,
          objective: `Complete only ${entry.step}.`,
          entry_checks: ["Validate input receipts."],
          execution_actions: ["Produce only the declared output."],
          completion_checks: ["Validate and persist the output."],
        })),
      };
    },
    async extractFacts({ snapshot, work }) {
      const page = snapshot.files.find((file) => file.path === "src/App.tsx")!;
      const element = snapshot.interactions[0];
      const evidence = (await new EvidenceGrantService(projectRoot).create(snapshot, work.workId, [{ source_id: page.source_id, start_line: 1, end_line: 1 }])).evidence[0];
      const emittedElementId = invalidFact === "foreign-id" ? "EL-model-invented" : element.element_id;
      const facts = {
        schema_version: 2, project_id: snapshot.project_id, analysis_run_id: snapshot.analysis_run_id, source_snapshot_id: snapshot.source_snapshot_id,
        screens: [
          { schema_version: 3, project_id: snapshot.project_id, analysis_run_id: snapshot.analysis_run_id, source_snapshot_id: snapshot.source_snapshot_id, screen_id: "SCR-checkout", route: "/checkout", title: invalidFact === "empty-title" ? "" : "Checkout", entry_guards: [],
            elements: [{ id: emittedElementId, type: "button", label: "Submit order", interaction: { action_kind: "click", surface_kind: "web", target_candidates: element.target_candidates }, evidence: [evidence] }],
            apis: [], feedback: [{ id: "FB-checkout-success", kind: "toast", text: "Order complete", assertion: { kind: "visible-text", expected_shape: "Order complete" }, evidence: [evidence] }], displays: [], status: "verified" },
          { schema_version: 3, project_id: snapshot.project_id, analysis_run_id: snapshot.analysis_run_id, source_snapshot_id: snapshot.source_snapshot_id, screen_id: "SCR-complete", route: "/complete", title: "Complete", entry_guards: [], elements: [], apis: [], feedback: [], displays: [], status: "verified" },
        ],
        edges: [{ schema_version: 2, project_id: snapshot.project_id, analysis_run_id: snapshot.analysis_run_id, source_snapshot_id: snapshot.source_snapshot_id, edge_id: "E-0001", kind: "normal", from: "SCR-checkout", on: emittedElementId, guard: "PRED-cart.ready=true", to: "SCR-complete", feedback: ["FB-checkout-success"], evidence: [evidence], status: "verified" }],
        predicates: [{ schema_version: 2, project_id: snapshot.project_id, analysis_run_id: snapshot.analysis_run_id, source_snapshot_id: snapshot.source_snapshot_id, pred_id: "PRED-cart.ready", values: ["true", "false"], source: "code", evidence: [evidence] }],
      } satisfies FactBundle;
      if (invalidFact === "missing-apis") delete (facts.screens[0] as Partial<FactBundle["screens"][number]>).apis;
      return facts as FactBundle;
    },
    async composeWiki({ skeleton }) {
      return { schema_version: 1, workflow_updates: skeleton.workflows.map((workflow) => ({ workflow_ref: workflow.workflow, goal: "Place an order" })) };
    },
    async composeScenarios({ draft }) { return draft; },
    async review() { return { pass: true, issueCodes: [] }; },
  };
}

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "scenarioforge-e2e-"));
  await mkdir(join(root, "src"));
  await writeFile(join(root, "src", "App.tsx"), `export function App(){return <><Route path="/checkout"/><Route path="/complete"/><button data-testid="submit-order">Submit order</button></>}\n`, "utf8");
  return root;
}

describe("scenario generation harness E2E", () => {
  it("persists SRC→FACT→WIKI→SCENARIO using canonical IDs and gates", async () => {
    const projectRoot = await fixtureRoot();
    const harness = new ScenarioGenerationHarness({
      projectRoot,
      projectId: "PRJ-fixture",
      runtimeVersion: "1.0.0",
      protocolVersion: "1",
      executor: executor(projectRoot),
      modelBindings: [{ role: "author", provider: "azure-openai", api: "azure-openai-chat-completions", modelId: "gpt-4.1", endpoint: "https://skax.ai-talentlab.com", apiVersion: "2024-12-01-preview", dataPolicyAccepted: true }],
    });
    const result = await harness.run();
    expect(result.coverage.coverage_percent).toBe(100);
    expect(result.scenarios.scenarios[0]).toMatchObject({ scenario_id: expect.stringMatching(/^SCN-/), path: ["E-0001"] });
    expect(harness.getState()?.stages).toEqual({ src: "completed", fact: "completed", wiki: "completed", scenario: "completed" });
    expect(harness.getState()?.artifactStatus).toEqual({ src: "persisted", fact: "persisted", wiki: "persisted", scenario: "persisted" });
    const plan = Object.values(harness.getState()!.artifacts).find((artifact) => artifact.artifactType === "generation-plan");
    expect(plan).toMatchObject({ status: "persisted", analysisRunId: result.analysisRunId });
    expect(Object.values(harness.getState()!.works)
      .filter((work) => work.generationStep)
      .every((work) => work.objective && work.stepPlan?.entryChecks.length && work.stepPlan.executionActions.length && work.stepPlan.completionChecks.length
        && work.inputArtifacts?.some((input) => input.artifactId === plan?.artifactId))).toBe(true);
    await expect(stat(join(projectRoot, ".scenarioforge/runs", result.analysisRunId, "scenario-set.json"))).resolves.toBeDefined();
    expect(JSON.parse(await readFile(join(projectRoot, ".scenarioforge/runs", result.analysisRunId, "coverage.json"), "utf8"))).toMatchObject({ coverage_percent: 100 });
    expect(JSON.parse(await readFile(join(projectRoot, ".scenarioforge/runs", result.analysisRunId, "manifest.json"), "utf8"))).toMatchObject({
      schema_version: 2,
      analysis_run_id: result.analysisRunId,
      assurance: "single-model",
      final_revision: result.finalRevision,
      model_bindings: [{
        role: "author",
        provider: "azure-openai",
        api: "azure-openai-chat-completions",
        model_id: "gpt-4.1",
        endpoint: "https://skax.ai-talentlab.com",
        api_version: "2024-12-01-preview",
        data_policy_accepted: true,
      }],
    });
    expect(Object.values(harness.getState()!.artifacts).filter((artifact) => artifact.artifactId.startsWith("VERDICT-")).every((artifact) => artifact.status === "persisted")).toBe(true);
  });

  it("fails planning work cleanly and retries it in the same analysis run", async () => {
    const projectRoot = await fixtureRoot();
    const planningFailure: GenerationExecutor = {
      ...executor(projectRoot),
      async planGeneration() { throw new Error("PROVIDER_RATE_LIMITED"); },
    };
    const failed = new ScenarioGenerationHarness({ projectRoot, projectId: "PRJ-fixture", runtimeVersion: "1.0.0", protocolVersion: "1", executor: planningFailure });

    await expect(failed.advance({ mode: "new" })).rejects.toThrow("PROVIDER_RATE_LIMITED");
    const failedState = failed.getState()!;
    const failedPlanWorks = Object.values(failedState.works).filter((work) => work.kind === "analysis.generation-plan");
    expect(failedPlanWorks).toHaveLength(1);
    expect(failedPlanWorks[0]).toMatchObject({ status: "failed", error: { code: "PROVIDER_RATE_LIMITED", retryable: true } });
    const runId = failedState.analysisRunId;
    failed.close();

    const recovered = new ScenarioGenerationHarness({ projectRoot, projectId: "PRJ-fixture", runtimeVersion: "1.0.0", protocolVersion: "1", executor: executor(projectRoot) });
    const src = await recovered.advance({ mode: "continue" });
    expect(src).toMatchObject({ analysisRunId: runId, step: "source-scan" });
    expect(Object.values(recovered.getState()!.artifacts).find((artifact) => artifact.artifactType === "generation-plan")).toMatchObject({ status: "persisted" });
    recovered.close();
  });

  it("restores an interrupted invalid FACT stage as recovering, never running", async () => {
    const projectRoot = await fixtureRoot();
    const failed = new ScenarioGenerationHarness({ projectRoot, projectId: "PRJ-fixture", runtimeVersion: "1.0.0", protocolVersion: "1", executor: executor(projectRoot, "empty-title") });
    await expect(failed.run()).rejects.toThrow("STEP_ARTIFACT_REJECTED:fact-catalog:FACT_SCREEN_INVALID");
    expect(failed.getState()).toMatchObject({ activeStage: "fact", sessionStatus: "failed", stages: { fact: "failed" }, artifactStatus: { fact: "invalid" }, generationSteps: { "fact-catalog": { status: "failed" } } });
    failed.close();
    const restored = new ScenarioGenerationHarness({ projectRoot, projectId: "PRJ-fixture", runtimeVersion: "1.0.0", protocolVersion: "1", executor: executor(projectRoot) });
    await restored.initialize();
    expect(restored.getState()).toMatchObject({ runtimeStatus: "recovering", sessionStatus: "recovering", activeStage: "fact", generationSteps: { "fact-catalog": { status: "failed" } } });
    restored.close();
  });

  it("fails the active work and retries a recoverable stage in the same run", async () => {
    const projectRoot = await fixtureRoot();
    const first = new ScenarioGenerationHarness({ projectRoot, projectId: "PRJ-fixture", runtimeVersion: "1.0.0", protocolVersion: "1", executor: executor(projectRoot) });
    const src = await first.advance();
    first.close();

    const throwingExecutor: GenerationExecutor = {
      ...executor(projectRoot),
      async extractFacts() {
        throw new Error("MODEL_ARTIFACT_NOT_SUBMITTED");
      },
    };
    const failed = new ScenarioGenerationHarness({ projectRoot, projectId: "PRJ-fixture", runtimeVersion: "1.0.0", protocolVersion: "1", executor: throwingExecutor });
    await expect(failed.advance({ mode: "continue" })).rejects.toThrow("MODEL_ARTIFACT_NOT_SUBMITTED");
    const failedState = failed.getState()!;
    const failedFactWorks = Object.values(failedState.works).filter((work) => work.analysisRunId === src.analysisRunId && work.stage === "fact");
    expect(failedFactWorks).toHaveLength(1);
    expect(failedFactWorks[0]).toMatchObject({ status: "failed", error: { code: "MODEL_ARTIFACT_NOT_SUBMITTED", retryable: true } });
    failed.close();

    const recovered = new ScenarioGenerationHarness({ projectRoot, projectId: "PRJ-fixture", runtimeVersion: "1.0.0", protocolVersion: "1", executor: executor(projectRoot) });
    const fact = await recovered.advance({ mode: "continue" });

    expect(fact).toMatchObject({ stage: "fact", step: "fact-catalog", analysisRunId: src.analysisRunId });
    expect(recovered.getState()).toMatchObject({
      analysisRunId: src.analysisRunId,
      runtimeStatus: "ready",
      sessionStatus: "idle",
      stages: { src: "completed", fact: "running", wiki: "pending", scenario: "pending" },
      generationSteps: { "fact-catalog": { status: "completed" }, "edge-ledger": { status: "pending" } },
    });
    recovered.close();
  });

  it("disposes the generation-plan and active step session lanes after success and failure", async () => {
    const projectRoot = await fixtureRoot();
    const disposed: string[] = [];
    const base = executor(projectRoot);
    const first = new ScenarioGenerationHarness({
      projectRoot,
      projectId: "PRJ-fixture",
      runtimeVersion: "1.0.0",
      protocolVersion: "1",
      executor: {
        ...base,
        async disposeStepSessionLanes(step) { disposed.push(step); },
      },
    });

    await expect(first.advance({ mode: "new" })).resolves.toMatchObject({ step: "source-scan" });
    expect(disposed).toEqual(["generation-plan", "source-scan"]);
    first.close();

    disposed.length = 0;
    const failed = new ScenarioGenerationHarness({
      projectRoot,
      projectId: "PRJ-fixture",
      runtimeVersion: "1.0.0",
      protocolVersion: "1",
      executor: {
        ...base,
        async extractFacts() { throw new Error("MODEL_ARTIFACT_NOT_SUBMITTED"); },
        async disposeStepSessionLanes(step) { disposed.push(step); },
      },
    });

    await expect(failed.advance({ mode: "continue" })).rejects.toThrow("MODEL_ARTIFACT_NOT_SUBMITTED");
    expect(disposed).toEqual(["generation-plan", "fact-catalog"]);
    failed.close();
  });

  it("rejects malformed FACT collections without leaking a secondary traversal exception", async () => {
    const projectRoot = await fixtureRoot();
    const harness = new ScenarioGenerationHarness({ projectRoot, projectId: "PRJ-fixture", runtimeVersion: "1.0.0", protocolVersion: "1", executor: executor(projectRoot, "missing-apis") });

    await expect(harness.run()).rejects.toThrow(/^STEP_ARTIFACT_REJECTED:fact-catalog:FACT_SCHEMA_INVALID$/);
    expect(harness.getState()).toMatchObject({ sessionStatus: "failed", stages: { fact: "failed" } });
    harness.close();
  });

  it("applies an executor semantic patch to a backend-owned reachable workflow skeleton", async () => {
    const projectRoot = await fixtureRoot();
    const base = executor(projectRoot);
    const semanticOnly: GenerationExecutor = {
      ...base,
      async composeWiki(input: Parameters<GenerationExecutor["composeWiki"]>[0]) {
        const skeleton = input.skeleton;
        expect(skeleton).toMatchObject({
          workflows: [expect.objectContaining({
            workflow: expect.stringMatching(/^WF-/),
            cites: expect.arrayContaining(["E-0001"]),
          })],
        });
        return {
          schema_version: 1,
          workflow_updates: skeleton.workflows.map((workflow) => ({ workflow_ref: workflow.workflow, goal: "주문 제출" })),
        };
      },
    };
    const harness = new ScenarioGenerationHarness({ projectRoot, projectId: "PRJ-fixture", runtimeVersion: "1.0.0", protocolVersion: "1", executor: semanticOnly });

    const result = await harness.run();

    expect(result.wiki.workflows).toEqual([
      expect.objectContaining({ goal: "주문 제출", cites: expect.arrayContaining(["E-0001"]) }),
    ]);
    expect(result.coverage).toMatchObject({ coverage_percent: 100, uncovered_edge_ids: [] });
    harness.close();
  });

  it("advances and persists exactly one fine-grained generation step per invocation", async () => {
    const projectRoot = await fixtureRoot();
    const advance = async () => {
      const harness = new ScenarioGenerationHarness({ projectRoot, projectId: "PRJ-fixture", runtimeVersion: "1.0.0", protocolVersion: "1", executor: executor(projectRoot) });
      const result = await harness.advance();
      const state = harness.getState();
      harness.close();
      return { result, state };
    };

    const expectedSteps = ["source-scan", "fact-catalog", "edge-ledger", "assembled-fact", "reachable-workflow-skeleton", "common-wiki", "business-catalog", "scenario-skeleton", "scenario-narration", "coverage-manifest"] as const;
    let analysisRunId: string | undefined;
    for (const [index, expectedStep] of expectedSteps.entries()) {
      const advanced = await advance();
      analysisRunId ??= advanced.result.analysisRunId;
      expect(advanced.result).toMatchObject({ step: expectedStep, analysisRunId });
      expect(advanced.state?.generationSteps[expectedStep]).toMatchObject({ status: "completed", receiptArtifactId: expect.any(String) });
      expect(advanced.state).toMatchObject({ progress: (index + 1) * 10, sessionStatus: "idle" });
      expect(expectedSteps.slice(index + 1).every((step) => advanced.state?.generationSteps[step].status === "pending")).toBe(true);
      if (expectedStep === "coverage-manifest") expect(advanced.result).toMatchObject({ coverage: { coverage_percent: 100, uncovered_edge_ids: [] } });
    }
    const final = await advance();
    expect(final.result.analysisRunId).not.toBe(analysisRunId);
    expect(final.result.step).toBe("source-scan");
  });

  it("starts a new run at SRC when the caller explicitly replaces a recoverable run", async () => {
    const projectRoot = await fixtureRoot();
    const first = new ScenarioGenerationHarness({ projectRoot, projectId: "PRJ-fixture", runtimeVersion: "1.0.0", protocolVersion: "1", executor: executor(projectRoot) });
    const previous = await first.advance();
    first.close();

    const restarted = new ScenarioGenerationHarness({ projectRoot, projectId: "PRJ-fixture", runtimeVersion: "1.0.0", protocolVersion: "1", executor: executor(projectRoot) });
    const fresh = await restarted.advance({ mode: "new" });

    expect(fresh.stage).toBe("src");
    expect(fresh.analysisRunId).not.toBe(previous.analysisRunId);
    expect(restarted.getState()).toMatchObject({
      analysisRunId: fresh.analysisRunId,
      stages: { src: "completed", fact: "pending", wiki: "pending", scenario: "pending" },
      sessionStatus: "idle",
    });
    restarted.close();
  });

  it("rejects FACT element and API IDs that are not owned by the active scanner inventory", async () => {
    const projectRoot = await fixtureRoot();
    const harness = new ScenarioGenerationHarness({ projectRoot, projectId: "PRJ-fixture", runtimeVersion: "1.0.0", protocolVersion: "1", executor: executor(projectRoot, "foreign-id") });

    await expect(harness.run()).rejects.toThrow("STEP_ARTIFACT_REJECTED:fact-catalog:FACT_INVENTORY_ID_INVALID");
    harness.close();
  });

  it("repairs one semantically rejected FACT draft and reviews it again before settling", async () => {
    const projectRoot = await fixtureRoot();
    const base = executor(projectRoot);
    let factReviewCalls = 0;
    let repairCalls = 0;
    const repairable: GenerationExecutor = {
      ...base,
      async review({ stage }) {
        if (stage === "fact" && ++factReviewCalls === 1) return { pass: false, issueCodes: ["FACT_GUARD_MISSING"] };
        return { pass: true, issueCodes: [] };
      },
      async repairFacts({ facts, issueCodes }) {
        repairCalls += 1;
        expect(issueCodes).toEqual(["FACT_GUARD_MISSING"]);
        return facts;
      },
    };
    const harness = new ScenarioGenerationHarness({ projectRoot, projectId: "PRJ-fixture", runtimeVersion: "1.0.0", protocolVersion: "1", executor: repairable });

    await expect(harness.run()).resolves.toBeDefined();
    expect(repairCalls).toBe(1);
    expect(factReviewCalls).toBe(2);
    expect(harness.getState()).toMatchObject({ sessionStatus: "idle", stages: { fact: "completed", wiki: "completed", scenario: "completed" } });
    harness.close();
  });

  it("routes a repairable FACT async-trigger validation issue through the bounded repair loop", async () => {
    const projectRoot = await fixtureRoot();
    const base = executor(projectRoot);
    let repairCalls = 0;
    let factReviewCalls = 0;
    const repairable: GenerationExecutor = {
      ...base,
      async extractFacts(input) {
        const facts = await base.extractFacts(input);
        facts.screens[0].elements[0].interaction.action_kind = "download_csv";
        facts.edges.push({ ...facts.edges[0], edge_id: "E-0002", to: "SCR-checkout" });
        return facts;
      },
      async repairFacts({ facts, issueCodes }) {
        repairCalls += 1;
        expect(issueCodes).toEqual(["FACT_ASYNC_TRIGGER_SPLIT"]);
        return { ...facts, edges: facts.edges.filter((edge) => edge.edge_id !== "E-0002") };
      },
      async review({ stage }) {
        if (stage === "fact") factReviewCalls += 1;
        return { pass: true, issueCodes: [] };
      },
    };
    const harness = new ScenarioGenerationHarness({ projectRoot, projectId: "PRJ-fixture", runtimeVersion: "1.0.0", protocolVersion: "1", executor: repairable });

    await expect(harness.run()).resolves.toBeDefined();
    expect(repairCalls).toBe(1);
    expect(factReviewCalls).toBe(1);
    harness.close();
  });

  it("repairs a fine-grained edge ledger whose trigger belongs to another source screen", async () => {
    const projectRoot = await fixtureRoot();
    const base = executor(projectRoot);
    let repairCalls = 0;
    const repairable: GenerationExecutor = {
      ...base,
      async linkEdges({ snapshot, work }) {
        const facts = await base.extractFacts({ snapshot, work });
        facts.edges[0].from = "SCR-complete";
        return createEdgeLedger(facts);
      },
      async repairEdgeLedger({ ledger, issueCodes, validationIssues }) {
        repairCalls += 1;
        expect(issueCodes).toEqual(["EDGE_ELEMENT_SCREEN_MISMATCH"]);
        expect(validationIssues).toEqual([expect.objectContaining({ code: "EDGE_ELEMENT_SCREEN_MISMATCH", path: "edges.0.on" })]);
        return { ...ledger, edges: ledger.edges.map((edge) => ({ ...edge, from: "SCR-checkout" })) };
      },
      async reviewEdgeLedger() {
        return { pass: true, issueCodes: [] };
      },
    };
    const harness = new ScenarioGenerationHarness({ projectRoot, projectId: "PRJ-fixture", runtimeVersion: "1.0.0", protocolVersion: "1", executor: repairable });

    await expect(harness.advance()).resolves.toMatchObject({ step: "source-scan" });
    await expect(harness.advance()).resolves.toMatchObject({ step: "fact-catalog" });
    await expect(harness.advance()).resolves.toMatchObject({ step: "edge-ledger" });
    expect(repairCalls).toBe(1);
    harness.close();
  });

  it("preserves a semantic reviewer repair budget after FACT catalog source-gate repairs", async () => {
    const projectRoot = await fixtureRoot();
    const base = executor(projectRoot);
    let reviewCalls = 0;
    const repairIssueCodes: string[][] = [];
    const repairable: GenerationExecutor = {
      ...base,
      async extractFactCatalog({ snapshot, work }) {
        const facts = await base.extractFacts({ snapshot, work });
        return { schema_version: 1, project_id: facts.project_id, analysis_run_id: facts.analysis_run_id, source_snapshot_id: facts.source_snapshot_id, screens: facts.screens, predicates: facts.predicates } satisfies FactCatalog;
      },
      async reviewFactCatalog() {
        reviewCalls += 1;
        if (reviewCalls <= 2) return { pass: false, issueCodes: [`FACT_SOURCE_STATE_PREDICATE_MISSING:U${reviewCalls}`] };
        if (reviewCalls <= 5) return { pass: false, issueCodes: [`PRED-business-diagnostics-${reviewCalls}-missing`] };
        return { pass: true, issueCodes: [] };
      },
      async repairFactCatalog({ catalog, issueCodes }) {
        repairIssueCodes.push(issueCodes);
        return catalog;
      },
    };
    const harness = new ScenarioGenerationHarness({ projectRoot, projectId: "PRJ-fixture", runtimeVersion: "1.0.0", protocolVersion: "1", executor: repairable });

    await expect(harness.advance()).resolves.toMatchObject({ step: "source-scan" });
    await expect(harness.advance()).resolves.toMatchObject({ step: "fact-catalog" });
    expect(repairIssueCodes).toEqual([
      ["FACT_SOURCE_STATE_PREDICATE_MISSING:U1"],
      ["FACT_SOURCE_STATE_PREDICATE_MISSING:U2"],
      ["PRED-business-diagnostics-3-missing"],
      ["PRED-business-diagnostics-4-missing"],
      ["PRED-business-diagnostics-5-missing"],
    ]);
    expect(reviewCalls).toBe(6);
    harness.close();
  });

  it("preserves the six-repair semantic budget for a fine-grained edge ledger", async () => {
    const projectRoot = await fixtureRoot();
    const base = executor(projectRoot);
    let repairCalls = 0;
    let reviewCalls = 0;
    const repairable: GenerationExecutor = {
      ...base,
      async linkEdges({ snapshot, work }) {
        return createEdgeLedger(await base.extractFacts({ snapshot, work }));
      },
      async repairEdgeLedger({ ledger }) {
        repairCalls += 1;
        return ledger;
      },
      async reviewEdgeLedger() {
        reviewCalls += 1;
        return reviewCalls <= 6
          ? { pass: false, issueCodes: [`EDGE_SEMANTIC_REVIEW_${reviewCalls}`] }
          : { pass: true, issueCodes: [] };
      },
    };
    const harness = new ScenarioGenerationHarness({ projectRoot, projectId: "PRJ-fixture", runtimeVersion: "1.0.0", protocolVersion: "1", executor: repairable });

    await expect(harness.advance()).resolves.toMatchObject({ step: "source-scan" });
    await expect(harness.advance()).resolves.toMatchObject({ step: "fact-catalog" });
    await expect(harness.advance()).resolves.toMatchObject({ step: "edge-ledger" });
    expect(repairCalls).toBe(6);
    expect(reviewCalls).toBe(7);
    harness.close();
  });

  it("routes an async request-start-only FACT edge through the bounded repair loop", async () => {
    const projectRoot = await fixtureRoot();
    const base = executor(projectRoot);
    let repairCalls = 0;
    const repairable: GenerationExecutor = {
      ...base,
      async extractFacts(input) {
        const facts = await base.extractFacts(input);
        facts.screens[0].elements[0].interaction.action_kind = "generate_scenarios";
        facts.predicates.push({
          schema_version: 2,
          project_id: facts.project_id,
          analysis_run_id: facts.analysis_run_id,
          source_snapshot_id: facts.source_snapshot_id,
          pred_id: "PRED-generation-requesting",
          values: ["true", "false"],
          source: "code",
          evidence: facts.edges[0].evidence,
        });
        facts.edges[0].effect = "PRED-generation-requesting=true";
        return facts;
      },
      async repairFacts({ facts, issueCodes, validationIssues }) {
        repairCalls += 1;
        expect(issueCodes).toEqual(["FACT_ASYNC_TRIGGER_REQUEST_START_ONLY"]);
        expect(validationIssues).toEqual([expect.objectContaining({ code: "FACT_ASYNC_TRIGGER_REQUEST_START_ONLY", path: "edges.0.effect" })]);
        return { ...facts, edges: facts.edges.map(({ effect: _requestStart, ...edge }) => edge) };
      },
    };
    const harness = new ScenarioGenerationHarness({ projectRoot, projectId: "PRJ-fixture", runtimeVersion: "1.0.0", protocolVersion: "1", executor: repairable });

    await expect(harness.run()).resolves.toBeDefined();
    expect(repairCalls).toBe(1);
    harness.close();
  });

  it("routes an outcome-less same-screen FACT edge through the bounded repair loop", async () => {
    const projectRoot = await fixtureRoot();
    const base = executor(projectRoot);
    let repairCalls = 0;
    const repairable: GenerationExecutor = {
      ...base,
      async extractFacts(input) {
        const facts = await base.extractFacts(input);
        facts.edges[0] = { ...facts.edges[0], to: facts.edges[0].from, feedback: [] };
        return facts;
      },
      async repairFacts({ facts, issueCodes, validationIssues }) {
        repairCalls += 1;
        expect(issueCodes).toEqual(["FACT_SELF_LOOP_OUTCOME_MISSING"]);
        expect(validationIssues).toEqual([expect.objectContaining({ code: "FACT_SELF_LOOP_OUTCOME_MISSING", path: "edges.0" })]);
        return { ...facts, edges: facts.edges.map((edge, index) => index === 0 ? { ...edge, effect: "PRED-cart.ready=false" } : edge) };
      },
    };
    const harness = new ScenarioGenerationHarness({ projectRoot, projectId: "PRJ-fixture", runtimeVersion: "1.0.0", protocolVersion: "1", executor: repairable });

    await expect(harness.run()).resolves.toBeDefined();
    expect(repairCalls).toBe(1);
    harness.close();
  });

  it("does not consume the semantic review budget when repairing a deterministic FACT contract issue", async () => {
    const projectRoot = await fixtureRoot();
    const base = executor(projectRoot);
    let repairCalls = 0;
    let factReviewCalls = 0;
    const repairable: GenerationExecutor = {
      ...base,
      async extractFacts(input) {
        const facts = await base.extractFacts(input);
        facts.screens[0].elements[0].interaction.action_kind = "generate_scenarios";
        facts.predicates.push({
          schema_version: 2,
          project_id: facts.project_id,
          analysis_run_id: facts.analysis_run_id,
          source_snapshot_id: facts.source_snapshot_id,
          pred_id: "PRED-generation-requesting",
          values: ["true", "false"],
          source: "code",
          evidence: facts.edges[0].evidence,
        });
        facts.edges[0].effect = "PRED-generation-requesting=true";
        return facts;
      },
      async repairFacts({ facts, issueCodes }) {
        repairCalls += 1;
        if (issueCodes.includes("FACT_ASYNC_TRIGGER_REQUEST_START_ONLY")) {
          return { ...facts, edges: facts.edges.map(({ effect: _requestStart, ...edge }) => edge) };
        }
        return facts;
      },
      async review({ stage }) {
        if (stage === "fact" && ++factReviewCalls <= 6) return { pass: false, issueCodes: ["FACT_GUARD_STILL_MISSING"] };
        return { pass: true, issueCodes: [] };
      },
    };
    const harness = new ScenarioGenerationHarness({ projectRoot, projectId: "PRJ-fixture", runtimeVersion: "1.0.0", protocolVersion: "1", executor: repairable });

    await expect(harness.run()).resolves.toBeDefined();
    expect(repairCalls).toBe(7);
    expect(factReviewCalls).toBe(7);
    harness.close();
  });

  it("renews the edge validation-repair budget after a reviewer-approved validation checkpoint", async () => {
    const projectRoot = await fixtureRoot();
    const base = executor(projectRoot);
    let extractCalls = 0;
    let repairCalls = 0;
    let factReviewCalls = 0;
    const repairable: GenerationExecutor = {
      ...base,
      async extractFacts(input) {
        const facts = await base.extractFacts(input);
        extractCalls += 1;
        facts.predicates.push({
          schema_version: 2,
          project_id: facts.project_id,
          analysis_run_id: facts.analysis_run_id,
          source_snapshot_id: facts.source_snapshot_id,
          pred_id: "PRED-generation-requesting",
          values: ["true", "false"],
          source: "code",
          evidence: facts.edges[0].evidence,
        });
        facts.screens[0].elements[0].interaction.action_kind = "generate_scenarios";
        if (extractCalls === 2) {
          facts.edges[0].effect = "PRED-generation-requesting=true";
        }
        return facts;
      },
      async repairFacts({ facts, issueCodes }) {
        repairCalls += 1;
        if (repairCalls === 1) {
          expect(issueCodes).toEqual(["FACT_ASYNC_TRIGGER_REQUEST_START_ONLY"]);
          return facts;
        }
        if (repairCalls === 2) {
          expect(issueCodes).toEqual(["FACT_ASYNC_TRIGGER_REQUEST_START_ONLY"]);
          return { ...facts, edges: facts.edges.map((edge) => ({ ...edge, effect: "PRED-cart.ready=false" })) };
        }
        if (repairCalls === 3) {
          expect(issueCodes).toEqual(["EDGE_OUTCOME_DETAIL_MISSING"]);
          return { ...facts, edges: facts.edges.map(({ effect: _effect, ...edge }) => ({ ...edge, to: edge.from, feedback: [] })) };
        }
        expect(issueCodes).toEqual(["FACT_SELF_LOOP_OUTCOME_MISSING"]);
        return { ...facts, edges: facts.edges.map((edge) => ({ ...edge, effect: "PRED-cart.ready=false" })) };
      },
      async review({ stage }) {
        if (stage === "fact" && ++factReviewCalls === 1) return { pass: false, issueCodes: ["EDGE_OUTCOME_DETAIL_MISSING"] };
        return { pass: true, issueCodes: [] };
      },
    };
    const harness = new ScenarioGenerationHarness({ projectRoot, projectId: "PRJ-fixture", runtimeVersion: "1.0.0", protocolVersion: "1", executor: repairable });

    await expect(harness.advance()).resolves.toMatchObject({ step: "source-scan" });
    await expect(harness.advance()).resolves.toMatchObject({ step: "fact-catalog" });
    await expect(harness.advance()).resolves.toMatchObject({ step: "edge-ledger" });
    expect(repairCalls).toBe(4);
    expect(factReviewCalls).toBe(2);
    harness.close();
  });

  it("stops after six FACT semantic repairs when the seventh review still fails", async () => {
    const projectRoot = await fixtureRoot();
    const base = executor(projectRoot);
    let factReviewCalls = 0;
    let repairCalls = 0;
    const repairable: GenerationExecutor = {
      ...base,
      async review({ stage }) {
        if (stage === "fact") {
          factReviewCalls += 1;
          return { pass: false, issueCodes: ["FACT_GUARD_STILL_MISSING"] };
        }
        return { pass: true, issueCodes: [] };
      },
      async repairFacts({ facts }) {
        repairCalls += 1;
        return facts;
      },
    };
    const harness = new ScenarioGenerationHarness({ projectRoot, projectId: "PRJ-fixture", runtimeVersion: "1.0.0", protocolVersion: "1", executor: repairable });

    await expect(harness.run()).rejects.toThrow("STEP_ARTIFACT_REJECTED:edge-ledger:FACT_GUARD_STILL_MISSING");
    expect(repairCalls).toBe(6);
    expect(factReviewCalls).toBe(7);
    harness.close();
  });

  it("allows one contract correction when a semantic FACT replacement references an undeclared effect predicate", async () => {
    const projectRoot = await fixtureRoot();
    const base = executor(projectRoot);
    let factReviewCalls = 0;
    let repairCalls = 0;
    const repairable: GenerationExecutor = {
      ...base,
      async review({ stage }) {
        if (stage === "fact" && ++factReviewCalls === 1) return { pass: false, issueCodes: ["MISSING_JOURNEY_ACTION"] };
        return { pass: true, issueCodes: [] };
      },
      async repairFacts({ facts, issueCodes }) {
        repairCalls += 1;
        if (repairCalls === 1) {
          expect(issueCodes).toEqual(["MISSING_JOURNEY_ACTION"]);
          return { ...facts, edges: facts.edges.map((edge) => ({ ...edge, effect: "PRED-query.applied=true" })) };
        }
        expect(issueCodes).toEqual(["EDGE_EFFECT_PREDICATE_INVALID"]);
        return {
          ...facts,
          predicates: [
            ...facts.predicates,
            {
              schema_version: 2,
              project_id: facts.project_id,
              analysis_run_id: facts.analysis_run_id,
              source_snapshot_id: facts.source_snapshot_id,
              pred_id: "PRED-query.applied",
              values: ["true", "false"],
              source: "code",
              evidence: facts.edges[0].evidence,
            },
          ],
        };
      },
    };
    const harness = new ScenarioGenerationHarness({ projectRoot, projectId: "PRJ-fixture", runtimeVersion: "1.0.0", protocolVersion: "1", executor: repairable });

    await expect(harness.run()).rejects.toThrow("STEP_ARTIFACT_REJECTED:edge-ledger:EDGE_LEDGER_PREDICATE_REFERENCE_INVALID");
    expect(repairCalls).toBe(1);
    expect(factReviewCalls).toBe(1);
    expect(harness.getState()).toMatchObject({ sessionStatus: "failed", generationSteps: { "fact-catalog": { status: "completed" }, "edge-ledger": { status: "failed" } } });
    harness.close();
  });

  it("covers every verified FACT edge in backend-owned WIKI skeletons without structural repair", async () => {
    const projectRoot = await fixtureRoot();
    const base = executor(projectRoot);
    const repairable: GenerationExecutor = {
      ...base,
      async extractFacts(input) {
        const facts = await base.extractFacts(input);
        facts.edges.push({
          ...facts.edges[0],
          edge_id: "E-0002",
          from: "SCR-checkout",
          to: "SCR-checkout",
          guard: undefined,
          effect: "PRED-cart.ready=false",
          feedback: [],
        });
        return facts;
      },
    };
    const harness = new ScenarioGenerationHarness({ projectRoot, projectId: "PRJ-fixture", runtimeVersion: "1.0.0", protocolVersion: "1", executor: repairable });

    const result = await harness.run();

    expect(result.wiki.workflows.flatMap((workflow) => workflow.cites)).toEqual(expect.arrayContaining(["E-0001", "E-0002"]));
    expect(result.coverage).toMatchObject({ coverage_percent: 100, uncovered_edge_ids: [] });
    harness.close();
  });

  it("repairs only WIKI goals after semantic review without changing the backend skeleton", async () => {
    const projectRoot = await fixtureRoot();
    const base = executor(projectRoot);
    let repairCalls = 0;
    let wikiReviewCalls = 0;
    let capturedSkeleton: Parameters<GenerationExecutor["composeWiki"]>[0]["skeleton"] | undefined;
    const repairable: GenerationExecutor = {
      ...base,
      async composeWiki(input) {
        capturedSkeleton = structuredClone(input.skeleton);
        return base.composeWiki(input);
      },
      async review({ stage, artifact }) {
        if (stage === "wiki" && ++wikiReviewCalls === 1) return { pass: false, issueCodes: [`WIKI_GOAL_AMBIGUOUS:${(artifact as WikiBundle).workflows[0].workflow}`] };
        return { pass: true, issueCodes: [] };
      },
      async repairWiki({ scope, issueCodes }) {
        repairCalls += 1;
        expect(issueCodes[0]).toContain("WIKI_GOAL_AMBIGUOUS:");
        return { schema_version: 1, base_artifact_hash: scope.base_artifact_hash, workflow_updates: scope.workflow_refs.map((workflow_ref) => ({ workflow_ref, goal: "주문 제출 및 결과 확인" })) };
      },
    };
    const harness = new ScenarioGenerationHarness({ projectRoot, projectId: "PRJ-fixture", runtimeVersion: "1.0.0", protocolVersion: "1", executor: repairable });

    const result = await harness.run();

    expect(repairCalls).toBe(1);
    expect(result.wiki.workflows[0]).toEqual({ ...capturedSkeleton!.workflows[0], goal: "주문 제출 및 결과 확인", status: "verified" });
    expect(result.coverage).toMatchObject({ coverage_percent: 100, uncovered_edge_ids: [] });
    harness.close();
  });

  it("repairs scenario narration once without changing the backend-owned scenario skeleton", async () => {
    const projectRoot = await fixtureRoot();
    const base = executor(projectRoot);
    let repairCalls = 0;
    let scenarioReviewCalls = 0;
    const repairable: GenerationExecutor = {
      ...base,
      async review({ stage, artifact }) {
        if (stage === "scenario" && ++scenarioReviewCalls === 1) return { pass: false, issueCodes: [`SCENARIO_NARRATION_EXCEPTION_OUTCOME_MISSING:${(artifact as ScenarioSet).scenarios[0].scenario_id}`] };
        return { pass: true, issueCodes: [] };
      },
      async repairScenarios({ scenarios, scope, issueCodes }) {
        repairCalls += 1;
        expect(issueCodes[0]).toContain("SCENARIO_NARRATION_EXCEPTION_OUTCOME_MISSING:");
        return {
          schema_version: 1,
          base_artifact_hash: scope.base_artifact_hash,
          scenario_updates: scenarios.scenarios.filter((scenario) => scope.scenario_refs.includes(scenario.scenario_id)).map((scenario) => ({
            scenario_ref: scenario.scenario_id,
            preconditions: scenario.preconditions.map((entry, index) => ({ index, text: entry.text })),
            steps: scenario.steps.map((step) => ({ n: step.n, action: step.action, expected: "The evidence-grounded result is shown." })),
          })),
        };
      },
    };
    const harness = new ScenarioGenerationHarness({ projectRoot, projectId: "PRJ-fixture", runtimeVersion: "1.0.0", protocolVersion: "1", executor: repairable });

    const result = await harness.run();

    expect(repairCalls).toBe(1);
    expect(scenarioReviewCalls).toBe(2);
    expect(result.scenarios.scenarios[0].steps[0]).toMatchObject({
      expected: "The evidence-grounded result is shown.",
      action_ref: { edge: "E-0001" },
    });
    expect(result.coverage).toMatchObject({ coverage_percent: 100, uncovered_edge_ids: [] });
    harness.close();
  });
});
