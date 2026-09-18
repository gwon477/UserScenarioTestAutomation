import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  AnalysisStage,
  BusinessCatalog,
  CoverageManifest,
  DomainError,
  EdgeLedger,
  FactBundle,
  FactCatalog,
  GenerationArtifactType,
  GenerationPlan,
  GenerationStep,
  ScenarioSet,
  ScenarioSkeleton,
  SourceSnapshot,
  ValidationIssue,
  WikiBundle,
  WorkDescriptor,
} from "@scenarioforge/contracts";
import { GENERATION_STEPS, createInitialProjectRuntimeState, generationStepStage, getNextGenerationStep } from "@scenarioforge/contracts";
import { ProjectBootstrapper } from "@scenarioforge/project-runtime";
import { JournalRepository, RuntimeStateCoordinator, WorkStateService, recoverProjectState } from "@scenarioforge/runtime-state";
import { ArtifactWriter, type PersistedArtifact } from "../artifacts/artifact-writer.js";
import {
  applyWikiSemanticPatch,
  applyWikiGoalCorrectionPatch,
  applyBusinessClassificationCorrectionPatch,
  applyScenarioNarrationCorrectionPatch,
  calculateCoverage,
  compileBusinessCatalog,
  compileReachableWorkflowSkeleton,
  compileScenarioSet,
  compileScenarioSkeleton,
  defaultBusinessClassificationPatch,
  createWikiGoalCorrectionScope,
  createBusinessClassificationCorrectionScope,
  createScenarioNarrationCorrectionScope,
  scenarioSetFromSkeleton,
  type BusinessClassificationPatch,
  type BusinessClassificationCorrectionPatch,
  type BusinessClassificationCorrectionScope,
  type ScenarioNarrationCorrectionPatch,
  type ScenarioNarrationCorrectionScope,
  type WikiSemanticPatch,
  type WikiGoalCorrectionPatch,
  type WikiGoalCorrectionScope,
} from "../graph/graph-tools.js";
import { assembleFactBundle, createEdgeLedger, createFactCatalog } from "../facts/edge-ledger-compiler.js";
import { ArtifactIndex, type ArtifactIndexRow } from "../indexing/artifact-index.js";
import { SourceScanner } from "../scanning/source-scanner.js";
import { EvidenceGrantService } from "../security/evidence-grant-service.js";
import { collectFactEvidence, validateFactBundle, validateScenarioSet, validateSourceSnapshot, validateWikiBundle, validateWikiReadiness, type ArtifactValidation } from "../validators/generation-artifact-validators.js";
import { StageCompletionGate } from "../validators/stage-completion-gate.js";
import { createGenerationWorkDescriptor } from "../workflows/work-descriptor.js";
import { generationStepRegistry } from "./generation-step-registry.js";
import { generationPlanTemplate, validateGenerationPlan, validateGenerationPlanEntry } from "./generation-plan.js";

export type SemanticVerdict = { pass: boolean; issueCodes: string[] };
export type GenerationAdvanceOptions = { mode?: "new" | "continue" };
export interface GenerationExecutor {
  bindRuntime?(input: { workStateService: WorkStateService; artifactWriter: ArtifactWriter }): void | Promise<void>;
  disposeStepSessionLanes?(step: GenerationStep | "generation-plan"): void | Promise<void>;
  dispose?(): void | Promise<void>;
  planGeneration?(input: { template: GenerationPlan; work: WorkDescriptor }): Promise<GenerationPlan>;
  extractFacts(input: { snapshot: SourceSnapshot; work: WorkDescriptor }): Promise<FactBundle>;
  extractFactCatalog?(input: { snapshot: SourceSnapshot; work: WorkDescriptor }): Promise<FactCatalog>;
  linkEdges?(input: { snapshot: SourceSnapshot; catalog: FactCatalog; work: WorkDescriptor }): Promise<EdgeLedger>;
  reviewFactCatalog?(input: { artifact: FactCatalog; work: WorkDescriptor }): Promise<SemanticVerdict>;
  reviewEdgeLedger?(input: { catalog: FactCatalog; artifact: EdgeLedger; work: WorkDescriptor }): Promise<SemanticVerdict>;
  repairFactCatalog?(input: { snapshot: SourceSnapshot; catalog: FactCatalog; issueCodes: string[]; work: WorkDescriptor }): Promise<FactCatalog>;
  repairEdgeLedger?(input: { snapshot: SourceSnapshot; catalog: FactCatalog; ledger: EdgeLedger; issueCodes: string[]; validationIssues?: ValidationIssue[]; work: WorkDescriptor }): Promise<EdgeLedger>;
  repairFacts?(input: { snapshot: SourceSnapshot; facts: FactBundle; issueCodes: string[]; validationIssues?: ValidationIssue[]; work: WorkDescriptor }): Promise<FactBundle>;
  composeWiki(input: { snapshot: SourceSnapshot; facts: FactBundle; skeleton: WikiBundle; work: WorkDescriptor }): Promise<WikiSemanticPatch>;
  repairWiki?(input: { snapshot: SourceSnapshot; facts: FactBundle; skeleton: WikiBundle; wiki: WikiBundle; scope: WikiGoalCorrectionScope; issueCodes: string[]; work: WorkDescriptor }): Promise<WikiGoalCorrectionPatch>;
  classifyBusiness?(input: { facts: FactBundle; skeleton: WikiBundle; wiki: WikiBundle; work: WorkDescriptor }): Promise<BusinessClassificationPatch>;
  reviewBusinessCatalog?(input: { artifact: BusinessCatalog; work: WorkDescriptor }): Promise<SemanticVerdict>;
  repairBusinessCatalog?(input: { facts: FactBundle; skeleton: WikiBundle; wiki: WikiBundle; business: BusinessCatalog; scope: BusinessClassificationCorrectionScope; issueCodes: string[]; work: WorkDescriptor }): Promise<BusinessClassificationCorrectionPatch>;
  composeScenarios(input: { snapshot: SourceSnapshot; facts: FactBundle; wiki: WikiBundle; draft: ScenarioSet; work: WorkDescriptor }): Promise<ScenarioSet>;
  repairScenarios?(input: { snapshot: SourceSnapshot; facts: FactBundle; wiki: WikiBundle; draft: ScenarioSet; scenarios: ScenarioSet; scope: ScenarioNarrationCorrectionScope; issueCodes: string[]; work: WorkDescriptor }): Promise<ScenarioNarrationCorrectionPatch>;
  review(input: { stage: Exclude<AnalysisStage, "src">; artifact: FactBundle | WikiBundle | ScenarioSet; work: WorkDescriptor }): Promise<SemanticVerdict>;
}

export type GenerationHarnessOptions = {
  projectRoot: string;
  projectId: string;
  runtimeVersion: string;
  protocolVersion: string;
  templateRoot?: string;
  piSdkVersion?: string;
  executor: GenerationExecutor;
  modelBindings?: Array<{
    role: "author" | "reviewer";
    provider: string;
    api: string;
    modelId: string;
    endpoint?: string;
    apiVersion?: string;
    dataPolicyAccepted: boolean;
  }>;
  assurance?: "single-model" | "independent-reviewer";
  onStage?: (event: { stage: AnalysisStage; status: "started" | "completed"; progress: number }) => void | Promise<void>;
  onPlan?: (event: { status: "started" | "completed"; progress: number; artifactId?: string }) => void | Promise<void>;
  onStep?: (event: { stage: AnalysisStage; step: GenerationStep; role: "deterministic" | "author" | "reviewer" | "repair"; status: "started" | "completed"; progress: number; artifactId?: string }) => void | Promise<void>;
};

export type GenerationRunResult = {
  analysisRunId: string;
  sourceSnapshot: SourceSnapshot;
  facts: FactBundle;
  wiki: WikiBundle;
  scenarios: ScenarioSet;
  coverage: ReturnType<typeof calculateCoverage>;
  finalRevision: number;
};

export type GenerationStageResult = {
  analysisRunId: string;
  stage: AnalysisStage;
  step: GenerationStep;
  artifact: SourceSnapshot | FactCatalog | EdgeLedger | FactBundle | WikiBundle | BusinessCatalog | ScenarioSkeleton | ScenarioSet | CoverageManifest;
  coverage?: ReturnType<typeof calculateCoverage>;
  finalRevision: number;
};

const artifactTypeByStage = { src: "analysis.source-map", fact: "analysis.fact-extract", wiki: "analysis.wiki-compose", scenario: "analysis.scenario-compose" } as const;

const artifactIdForStep = (step: GenerationStep, analysisRunId: string, sourceSnapshotId: string): string => ({
  "source-scan": sourceSnapshotId,
  "fact-catalog": `FACT-CATALOG-${analysisRunId}`,
  "edge-ledger": `EDGE-LEDGER-${analysisRunId}`,
  "assembled-fact": `FACT-${analysisRunId}`,
  "reachable-workflow-skeleton": `WORKFLOW-SKELETON-${analysisRunId}`,
  "common-wiki": `WIKI-${analysisRunId}`,
  "business-catalog": `BUSINESS-CATALOG-${analysisRunId}`,
  "scenario-skeleton": `SCENARIO-SKELETON-${analysisRunId}`,
  "scenario-narration": `SCENARIOS-${analysisRunId}`,
  "coverage-manifest": `COVERAGE-MANIFEST-${analysisRunId}`,
})[step];

export class ScenarioGenerationHarness {
  private repository?: JournalRepository;
  private coordinator?: RuntimeStateCoordinator;
  private workService?: WorkStateService;
  private writer?: ArtifactWriter;
  private index?: ArtifactIndex;

  constructor(private readonly options: GenerationHarnessOptions) {}

  async initialize(): Promise<void> {
    const expectedAssurance = this.options.modelBindings?.some((binding) => binding.role === "reviewer") ? "independent-reviewer" : "single-model";
    if (this.options.assurance && this.options.assurance !== expectedAssurance) throw new Error("ASSURANCE_BINDING_MISMATCH");
    await new ProjectBootstrapper().bootstrap(this.options);
    this.repository = new JournalRepository(this.options.projectRoot);
    const fallback = createInitialProjectRuntimeState(this.options.projectId);
    const state = await recoverProjectState(this.repository, fallback);
    this.coordinator = new RuntimeStateCoordinator(state, this.repository);
    this.workService = new WorkStateService(this.coordinator);
    this.writer = new ArtifactWriter(this.options.projectRoot);
    this.index = new ArtifactIndex(join(this.options.projectRoot, ".scenarioforge", "state", "scenario-index.sqlite"));
    await this.options.executor.bindRuntime?.({ workStateService: this.workService, artifactWriter: this.writer });
    if (state.projectStatus !== "ready") await this.coordinator.commit({ type: "project.ready", projectId: this.options.projectId, operationId: randomUUID(), expectedRevision: state.revision });
    const current = this.coordinator.getState();
    if (current.activeStage && current.stages[current.activeStage] !== "completed") {
      if (current.analysisRunId) {
        const committedHashes = new Set(Object.values(current.artifacts).filter((artifact) => artifact.analysisRunId === current.analysisRunId && artifact.status === "persisted").map((artifact) => artifact.contentHash));
        await this.writer.recoverOrphans(current.analysisRunId, committedHashes);
      }
      await this.coordinator.commit({ type: "analysis.recover", projectId: this.options.projectId, operationId: randomUUID(), expectedRevision: current.revision });
    }
  }

  async run(): Promise<GenerationRunResult> {
    let advanced: GenerationStageResult;
    do advanced = await this.advance(); while (advanced.step !== "coverage-manifest");
    const coverage = (advanced.artifact as CoverageManifest).coverage;
    const result = await this.readRunResult(advanced.analysisRunId, coverage);
    await this.options.executor.dispose?.();
    this.close();
    return result;
  }

  async advance(options: GenerationAdvanceOptions = {}): Promise<GenerationStageResult> {
    if (!this.coordinator) await this.initialize();
    let state = this.coordinator!.getState();
    const hasFailedStep = Object.values(state.generationSteps).some((stepState) => stepState.status === "failed");
    if (options.mode === "new" || !state.analysisRunId || state.generationSteps["coverage-manifest"].status === "completed" || (hasFailedStep && options.mode !== "continue")) {
      const analysisRunId = `RUN-${randomUUID()}`;
      const sourceSnapshotId = `SNAP-${randomUUID()}`;
      const sessionId = `SESSION-${randomUUID()}`;
      await this.commit({ type: "analysis.start", projectId: this.options.projectId, operationId: randomUUID(), expectedRevision: this.revision(), analysisRunId, sourceSnapshotId, sessionId });
      state = this.coordinator!.getState();
    }
    const analysisRunId = state.analysisRunId!;
    const sourceSnapshotId = state.sourceSnapshotId!;
    const sessionId = state.sessionId!;
    let sessionScope: GenerationStep | "generation-plan" = "generation-plan";
    try {
      await this.ensureGenerationPlan(analysisRunId, sourceSnapshotId, sessionId);
      await this.options.executor.disposeStepSessionLanes?.("generation-plan");
      state = this.coordinator!.getState();
      const step = getNextGenerationStep(state.generationSteps);
      if (!step) throw new Error("ANALYSIS_ALREADY_COMPLETED");
      sessionScope = step;
      const stage = generationStepStage(step);
      const result = await this.executeStep(step, analysisRunId, sourceSnapshotId, sessionId);
      return { analysisRunId, stage, step, ...result, finalRevision: this.revision() };
    } catch (error) {
      let failed = this.coordinator!.getState();
      const runningWork = Object.values(failed.works)
        .filter((work) => work.analysisRunId === failed.analysisRunId
          && work.sessionId === failed.sessionId
          && (work.kind === "analysis.generation-plan"
            || work.generationStep === failed.activeStep)
          && work.status === "running")
        .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt))
        .at(-1);
      if (runningWork) {
        const message = error instanceof Error ? error.message : "Unknown generation error";
        await this.workService!.mutate({
          projectId: this.options.projectId,
          sessionId: runningWork.sessionId,
          workId: runningWork.workId,
          operationId: randomUUID(),
          expectedRevision: failed.revision,
          mutation: {
            op: "report-failure",
            error: {
              code: message.match(/^([A-Z][A-Z0-9_]+)/)?.[1] ?? "GENERATION_STEP_FAILED",
              category: this.failureCategory(error),
              message,
              retryable: true,
            },
          },
        });
        failed = this.coordinator!.getState();
      }
      if (failed.activeStep && failed.generationSteps[failed.activeStep].status !== "completed" && failed.generationSteps[failed.activeStep].status !== "failed") {
        await this.commit({ type: "analysis.step.fail", projectId: this.options.projectId, step: failed.activeStep, error: { category: this.failureCategory(error), code: error instanceof Error ? error.message.match(/^([A-Z][A-Z0-9_]+)/)?.[1] : undefined, message: error instanceof Error ? error.message : "Unknown generation error" }, operationId: randomUUID(), expectedRevision: failed.revision });
      }
      throw error;
    } finally {
      await this.options.executor.disposeStepSessionLanes?.(sessionScope);
    }
  }

  getState() { return this.coordinator?.getState(); }
  close(): void { this.index?.close(); this.index = undefined; }

  async dispose(): Promise<void> { await this.options.executor.dispose?.(); }

  private async executeStep(
    step: GenerationStep,
    analysisRunId: string,
    sourceSnapshotId: string,
    sessionId: string,
  ): Promise<{ artifact: GenerationStageResult["artifact"]; coverage?: ReturnType<typeof calculateCoverage> }> {
    const artifactId = artifactIdForStep(step, analysisRunId, sourceSnapshotId);
    if (step === "source-scan") {
      const work = await this.beginStep(step, analysisRunId, sourceSnapshotId, sessionId, []);
      const snapshot = await new SourceScanner().scan({ projectRoot: this.options.projectRoot, projectId: this.options.projectId, analysisRunId, sourceSnapshotId });
      await this.finishStep(step, work, artifactId, snapshot, validateSourceSnapshot(snapshot), { pass: true, issueCodes: [] }, snapshot.files.map((file) => file.source_id));
      return { artifact: snapshot };
    }

    const snapshot = await this.readArtifact<SourceSnapshot>(sourceSnapshotId, analysisRunId);
    if (step === "fact-catalog") {
      const work = await this.beginStep(step, analysisRunId, sourceSnapshotId, sessionId, [sourceSnapshotId]);
      let catalog: FactCatalog;
      if (this.options.executor.extractFactCatalog) {
        catalog = await this.options.executor.extractFactCatalog({ snapshot, work });
      } else {
        const facts = await this.options.executor.extractFacts({ snapshot, work });
        catalog = {
          schema_version: 1,
          project_id: facts?.project_id ?? snapshot.project_id,
          analysis_run_id: facts?.analysis_run_id ?? snapshot.analysis_run_id,
          source_snapshot_id: facts?.source_snapshot_id ?? snapshot.source_snapshot_id,
          screens: Array.isArray(facts?.screens) ? structuredClone(facts.screens) : [],
          predicates: Array.isArray(facts?.predicates) ? structuredClone(facts.predicates) : [],
        };
      }
      const evaluateCatalog = async () => {
        const catalogAsFact: FactBundle = { schema_version: 2, project_id: catalog.project_id, analysis_run_id: catalog.analysis_run_id, source_snapshot_id: catalog.source_snapshot_id, screens: catalog.screens, predicates: catalog.predicates, edges: [] };
        const validation = await this.validateFacts(catalogAsFact, snapshot, work.workId);
        const verdict = validation.valid && this.options.executor.reviewFactCatalog
          ? await this.options.executor.reviewFactCatalog({ artifact: catalog, work })
          : { pass: validation.valid, issueCodes: validation.issues.map((issue) => issue.code) };
        return { catalogAsFact, validation, verdict };
      };
      let { catalogAsFact, validation, verdict } = await evaluateCatalog();
      let sourceRepairs = 0;
      let semanticRepairs = 0;
      const sourceGateRejected = () => !verdict.pass
        && verdict.issueCodes.length > 0
        && verdict.issueCodes.every((code) => code.startsWith("FACT_SOURCE_"));
      const repairAvailable = () => validation.valid
        && this.repairableVerdict(verdict)
        && this.options.executor.repairFactCatalog
        && (sourceGateRejected()
          ? sourceRepairs < generationStepRegistry[step].maxRepairs
          : semanticRepairs < generationStepRegistry[step].maxRepairs);
      while (repairAvailable()) {
        if (sourceGateRejected()) sourceRepairs += 1;
        else semanticRepairs += 1;
        catalog = await this.options.executor.repairFactCatalog!({ snapshot, catalog, issueCodes: [...verdict.issueCodes], work });
        ({ catalogAsFact, validation, verdict } = await evaluateCatalog());
      }
      await this.finishStep(step, work, artifactId, catalog, validation, verdict, validation.valid ? this.factIds(catalogAsFact) : []);
      return { artifact: catalog };
    }

    const catalogId = artifactIdForStep("fact-catalog", analysisRunId, sourceSnapshotId);
    const catalog = await this.readArtifact<FactCatalog>(catalogId, analysisRunId);
    if (step === "edge-ledger") {
      const work = await this.beginStep(step, analysisRunId, sourceSnapshotId, sessionId, [sourceSnapshotId, catalogId]);
      let repairFacts: FactBundle | undefined;
      let ledger: EdgeLedger;
      if (this.options.executor.linkEdges) ledger = await this.options.executor.linkEdges({ snapshot, catalog, work });
      else {
        repairFacts = await this.options.executor.extractFacts({ snapshot, work });
        ledger = createEdgeLedger(repairFacts);
      }
      const evaluate = async (): Promise<{ assembled: FactBundle; validation: ArtifactValidation }> => {
        try {
          const assembled = assembleFactBundle(catalog, ledger);
          const catalogWorkId = this.coordinator!.getState().artifacts[catalogId]!.workId;
          return { assembled, validation: await this.validateFacts(assembled, snapshot, [catalogWorkId, work.workId]) };
        } catch (error) {
          const code = error instanceof Error ? error.message.split(":")[0] : "EDGE_LEDGER_INVALID";
          return {
            assembled: { schema_version: 2, project_id: catalog.project_id, analysis_run_id: catalog.analysis_run_id, source_snapshot_id: catalog.source_snapshot_id, screens: catalog.screens, predicates: catalog.predicates, edges: ledger.edges },
            validation: { valid: false, issues: [{ code, severity: "error", path: "$", message: error instanceof Error ? error.message : "Edge ledger is invalid." }] },
          };
        }
      };
      let { assembled, validation } = await evaluate();
      const reviewLedger = async (): Promise<SemanticVerdict> => validation.valid
        ? this.options.executor.reviewEdgeLedger
          ? this.options.executor.reviewEdgeLedger({ catalog, artifact: ledger, work })
          : this.options.executor.review({ stage: "fact", artifact: assembled, work })
        : { pass: false, issueCodes: validation.issues.map((issue) => issue.code) };
      let verdict = await reviewLedger();
      let semanticRepairs = 0;
      let validationRepairs = 0;
      const repairableValidationCodes = new Set(["EDGE_ELEMENT_SCREEN_MISMATCH", "FACT_ASYNC_TRIGGER_SPLIT", "FACT_ASYNC_TRIGGER_REQUEST_START_ONLY", "FACT_SELF_LOOP_OUTCOME_MISSING"]);
      const repairableValidation = () => !validation.valid && validation.issues.length > 0 && validation.issues.every((issue) => repairableValidationCodes.has(issue.code));
      const fineRepairAvailable = () => this.options.executor.repairEdgeLedger && (repairableValidation() ? validationRepairs < generationStepRegistry[step].maxRepairs : validation.valid && this.repairableVerdict(verdict) && semanticRepairs < generationStepRegistry[step].maxRepairs);
      const legacyRepairAvailable = () => repairFacts && this.options.executor.repairFacts && (repairableValidation()
        ? validationRepairs < generationStepRegistry[step].maxRepairs
        : validation.valid && this.repairableVerdict(verdict) && semanticRepairs < generationStepRegistry[step].maxRepairs);
      const repairAvailable = () => fineRepairAvailable() || legacyRepairAvailable();
      while (repairAvailable()) {
        if (repairableValidation()) validationRepairs += 1;
        else {
          semanticRepairs += 1;
          validationRepairs = 0;
        }
        const issueCodes = validation.valid ? [...verdict.issueCodes] : [...new Set(validation.issues.map((issue) => issue.code))];
        if (this.options.executor.repairEdgeLedger) {
          ledger = await this.options.executor.repairEdgeLedger({ snapshot, catalog, ledger, issueCodes, ...(validation.valid ? {} : { validationIssues: validation.issues }), work });
        } else {
          repairFacts = await this.options.executor.repairFacts!({ snapshot, facts: repairFacts!, issueCodes, ...(validation.valid ? {} : { validationIssues: validation.issues }), work });
          ledger = createEdgeLedger(repairFacts);
        }
        ({ assembled, validation } = await evaluate());
        verdict = await reviewLedger();
      }
      await this.finishStep(step, work, artifactId, ledger, validation, verdict, ledger.edges.flatMap((edge) => [edge.edge_id, edge.from, edge.on, edge.to]));
      return { artifact: ledger };
    }

    const ledgerId = artifactIdForStep("edge-ledger", analysisRunId, sourceSnapshotId);
    const ledger = await this.readArtifact<EdgeLedger>(ledgerId, analysisRunId);
    if (step === "assembled-fact") {
      const work = await this.beginStep(step, analysisRunId, sourceSnapshotId, sessionId, [catalogId, ledgerId]);
      const facts = assembleFactBundle(catalog, ledger);
      const state = this.coordinator!.getState();
      const validation = await this.validateFacts(facts, snapshot, [state.artifacts[catalogId]!.workId, state.artifacts[ledgerId]!.workId]);
      await this.finishStep(step, work, artifactId, facts, validation, { pass: validation.valid, issueCodes: validation.issues.map((issue) => issue.code) }, validation.valid ? this.factIds(facts) : []);
      return { artifact: facts };
    }

    const factId = artifactIdForStep("assembled-fact", analysisRunId, sourceSnapshotId);
    const facts = await this.readArtifact<FactBundle>(factId, analysisRunId);
    if (step === "reachable-workflow-skeleton") {
      const work = await this.beginStep(step, analysisRunId, sourceSnapshotId, sessionId, [factId]);
      const skeleton = compileReachableWorkflowSkeleton(facts);
      const validation = validateWikiBundle(skeleton, facts);
      await this.finishStep(step, work, artifactId, skeleton, validation, { pass: validation.valid, issueCodes: validation.issues.map((issue) => issue.code) }, skeleton.workflows.flatMap((workflow) => [workflow.workflow, ...workflow.cites]));
      return { artifact: skeleton };
    }

    const skeletonId = artifactIdForStep("reachable-workflow-skeleton", analysisRunId, sourceSnapshotId);
    const skeleton = await this.readArtifact<WikiBundle>(skeletonId, analysisRunId);
    if (step === "common-wiki") {
      const work = await this.beginStep(step, analysisRunId, sourceSnapshotId, sessionId, [sourceSnapshotId, factId, skeletonId]);
      let patch = await this.options.executor.composeWiki({ snapshot, facts, skeleton, work });
      let wiki = applyWikiSemanticPatch(skeleton, patch);
      let validation = validateWikiBundle(wiki, facts);
      let verdict = validation.valid ? await this.options.executor.review({ stage: "wiki", artifact: wiki, work }) : { pass: false, issueCodes: validation.issues.map((issue) => issue.code) };
      let repairCount = 0;
      while (validation.valid && this.repairableVerdict(verdict) && this.options.executor.repairWiki && repairCount < generationStepRegistry[step].maxRepairs) {
        repairCount += 1;
        const scope = createWikiGoalCorrectionScope(wiki, verdict.issueCodes);
        const correction = await this.options.executor.repairWiki({ snapshot, facts, skeleton, wiki, scope, issueCodes: [...verdict.issueCodes], work });
        wiki = applyWikiGoalCorrectionPatch(wiki, scope, correction);
        validation = validateWikiBundle(wiki, facts);
        verdict = validation.valid ? await this.options.executor.review({ stage: "wiki", artifact: wiki, work }) : { pass: false, issueCodes: validation.issues.map((issue) => issue.code) };
      }
      if (validation.valid && verdict.pass) {
        wiki = { ...structuredClone(wiki), workflows: wiki.workflows.map((workflow) => ({ ...structuredClone(workflow), status: "verified" as const })) };
        validation = validateWikiReadiness(wiki, facts);
      }
      await this.finishStep(step, work, artifactId, wiki, validation, verdict, validation.valid ? wiki.workflows.flatMap((workflow) => [workflow.workflow, ...workflow.cites]) : []);
      return { artifact: wiki };
    }

    const wikiId = artifactIdForStep("common-wiki", analysisRunId, sourceSnapshotId);
    const wiki = await this.readArtifact<WikiBundle>(wikiId, analysisRunId);
    if (step === "business-catalog") {
      const work = await this.beginStep(step, analysisRunId, sourceSnapshotId, sessionId, [skeletonId, wikiId]);
      let patch = this.options.executor.classifyBusiness
        ? await this.options.executor.classifyBusiness({ facts, skeleton, wiki, work })
        : defaultBusinessClassificationPatch(wiki);
      let business: BusinessCatalog;
      let validation: ArtifactValidation;
      try {
        business = compileBusinessCatalog(wiki, patch);
        validation = { valid: true, issues: [] };
      } catch (error) {
        const code = error instanceof Error ? error.message.split(":")[0] : "BUSINESS_CATALOG_INVALID";
        business = { schema_version: 1, project_id: wiki.project_id, analysis_run_id: wiki.analysis_run_id, source_snapshot_id: wiki.source_snapshot_id, classifications: [] };
        validation = { valid: false, issues: [{ code, severity: "error", path: "$", message: error instanceof Error ? error.message : "Business catalog is invalid." }] };
      }
      let verdict = validation.valid && this.options.executor.reviewBusinessCatalog
        ? await this.options.executor.reviewBusinessCatalog({ artifact: business, work })
        : { pass: validation.valid, issueCodes: validation.issues.map((issue) => issue.code) };
      let repairCount = 0;
      while (validation.valid && this.repairableVerdict(verdict) && this.options.executor.repairBusinessCatalog && repairCount < generationStepRegistry[step].maxRepairs) {
        repairCount += 1;
        const scope = createBusinessClassificationCorrectionScope(business, verdict.issueCodes);
        const correction = await this.options.executor.repairBusinessCatalog({ facts, skeleton, wiki, business, scope, issueCodes: [...verdict.issueCodes], work });
        try {
          business = applyBusinessClassificationCorrectionPatch(wiki, business, scope, correction);
          validation = { valid: true, issues: [] };
        } catch (error) {
          const code = error instanceof Error ? error.message.split(":")[0] : "BUSINESS_CATALOG_INVALID";
          business = { schema_version: 1, project_id: wiki.project_id, analysis_run_id: wiki.analysis_run_id, source_snapshot_id: wiki.source_snapshot_id, classifications: [] };
          validation = { valid: false, issues: [{ code, severity: "error", path: "$", message: error instanceof Error ? error.message : "Business catalog is invalid." }] };
        }
        verdict = validation.valid && this.options.executor.reviewBusinessCatalog
          ? await this.options.executor.reviewBusinessCatalog({ artifact: business, work })
          : { pass: validation.valid, issueCodes: validation.issues.map((issue) => issue.code) };
      }
      await this.finishStep(step, work, artifactId, business, validation, verdict, business.classifications.flatMap((classification) => [classification.classification_id, ...classification.workflow_refs, ...classification.edge_refs]));
      return { artifact: business };
    }

    const businessId = artifactIdForStep("business-catalog", analysisRunId, sourceSnapshotId);
    const business = await this.readArtifact<BusinessCatalog>(businessId, analysisRunId);
    if (step === "scenario-skeleton") {
      const work = await this.beginStep(step, analysisRunId, sourceSnapshotId, sessionId, [factId, skeletonId, wikiId, businessId]);
      const wikiReadiness = validateWikiReadiness(wiki, facts);
      if (!wikiReadiness.valid) throw new Error(`WIKI_NOT_READY_FOR_SCENARIOS:${wikiReadiness.issues.map((issue) => issue.code).join(",")}`);
      const scenarioSkeleton = compileScenarioSkeleton(facts, wiki, business);
      const draft = scenarioSetFromSkeleton(scenarioSkeleton);
      const validation = validateScenarioSet(draft, facts, wiki, draft);
      await this.finishStep(step, work, artifactId, scenarioSkeleton, validation, { pass: validation.valid, issueCodes: validation.issues.map((issue) => issue.code) }, scenarioSkeleton.scenarios.flatMap((scenario) => [scenario.scenario_id, scenario.workflow, scenarioSkeleton.classification_by_scenario[scenario.scenario_id], ...scenario.path]));
      return { artifact: scenarioSkeleton };
    }

    const scenarioSkeletonId = artifactIdForStep("scenario-skeleton", analysisRunId, sourceSnapshotId);
    const scenarioSkeleton = await this.readArtifact<ScenarioSkeleton>(scenarioSkeletonId, analysisRunId);
    if (step === "scenario-narration") {
      const work = await this.beginStep(step, analysisRunId, sourceSnapshotId, sessionId, [sourceSnapshotId, factId, wikiId, businessId, scenarioSkeletonId]);
      const draft = scenarioSetFromSkeleton(scenarioSkeleton);
      let scenarios = await this.options.executor.composeScenarios({ snapshot, facts, wiki, draft, work });
      let validation = validateScenarioSet(scenarios, facts, wiki, draft);
      let verdict = validation.valid ? await this.options.executor.review({ stage: "scenario", artifact: scenarios, work }) : { pass: false, issueCodes: validation.issues.map((issue) => issue.code) };
      let repairCount = 0;
      while (validation.valid && this.repairableVerdict(verdict) && this.options.executor.repairScenarios && repairCount < generationStepRegistry[step].maxRepairs) {
        repairCount += 1;
        const scope = createScenarioNarrationCorrectionScope(scenarios, verdict.issueCodes);
        const correction = await this.options.executor.repairScenarios({ snapshot, facts, wiki, draft, scenarios, scope, issueCodes: [...verdict.issueCodes], work });
        scenarios = applyScenarioNarrationCorrectionPatch(scenarios, scope, correction);
        validation = validateScenarioSet(scenarios, facts, wiki, draft);
        verdict = validation.valid ? await this.options.executor.review({ stage: "scenario", artifact: scenarios, work }) : { pass: false, issueCodes: validation.issues.map((issue) => issue.code) };
      }
      await this.finishStep(step, work, artifactId, scenarios, validation, verdict, validation.valid ? scenarios.scenarios.flatMap((scenario) => [scenario.scenario_id, scenario.workflow, scenarioSkeleton.classification_by_scenario[scenario.scenario_id], ...scenario.path]) : []);
      return { artifact: scenarios };
    }

    const scenarioId = artifactIdForStep("scenario-narration", analysisRunId, sourceSnapshotId);
    const scenarios = await this.readArtifact<ScenarioSet>(scenarioId, analysisRunId);
    const work = await this.beginStep(step, analysisRunId, sourceSnapshotId, sessionId, [factId, scenarioId]);
    const coverage = calculateCoverage(facts, scenarios);
    const coverageManifest: CoverageManifest = {
      schema_version: 1,
      project_id: facts.project_id,
      analysis_run_id: facts.analysis_run_id,
      source_snapshot_id: facts.source_snapshot_id,
      coverage,
      artifact_ids: Object.values(this.coordinator!.getState().artifacts).filter((artifact) => artifact.analysisRunId === analysisRunId && artifact.status === "persisted").map((artifact) => artifact.artifactId).sort(),
    };
    const validation: ArtifactValidation = coverage.coverage_percent === 100 && coverage.uncovered_edge_ids.length === 0
      ? { valid: true, issues: [] }
      : { valid: false, issues: [{ code: "SCENARIO_EDGE_COVERAGE_INCOMPLETE", severity: "error", path: "coverage", message: `Uncovered edges: ${coverage.uncovered_edge_ids.join(",")}` }] };
    await this.finishStep(step, work, artifactId, coverageManifest, validation, { pass: validation.valid, issueCodes: validation.issues.map((issue) => issue.code) }, [...coverageManifest.artifact_ids, ...scenarios.scenarios.flatMap((scenario) => scenario.path)]);
    await this.writer!.writeJson(analysisRunId, "scenario", "coverage", coverage);
    await this.writeFinalManifest(analysisRunId, sourceSnapshotId, snapshot);
    return { artifact: coverageManifest, coverage };
  }

  private async executeFactStage(snapshot: SourceSnapshot, analysisRunId: string, sourceSnapshotId: string, sessionId: string): Promise<FactBundle> {
    const work = await this.beginStage("fact", analysisRunId, sourceSnapshotId, sessionId, [sourceSnapshotId]);
    let facts = await this.options.executor.extractFacts({ snapshot, work });
    let validation = await this.validateFacts(facts, snapshot, work.workId);
    let verdict = validation.valid ? await this.options.executor.review({ stage: "fact", artifact: facts, work }) : { pass: false, issueCodes: validation.issues.map((entry) => entry.code) };
    let semanticRepairs = 0;
    let validationRepairs = 0;
    const repairableValidationCodes = new Set(["EDGE_ELEMENT_SCREEN_MISMATCH", "FACT_ASYNC_TRIGGER_SPLIT", "FACT_ASYNC_TRIGGER_REQUEST_START_ONLY", "FACT_SELF_LOOP_OUTCOME_MISSING"]);
    const repairableValidation = () => !validation.valid && validation.issues.length > 0 && validation.issues.every((entry) => repairableValidationCodes.has(entry.code));
    const repairAvailable = () => repairableValidation() ? validationRepairs < 2 : validation.valid && this.repairableVerdict(verdict) && semanticRepairs < 6;
    while (this.options.executor.repairFacts && repairAvailable()) {
      if (repairableValidation()) validationRepairs += 1;
      else semanticRepairs += 1;
      facts = await this.options.executor.repairFacts({
        snapshot,
        facts,
        issueCodes: validation.valid ? [...verdict.issueCodes] : [...new Set(validation.issues.map((entry) => entry.code))],
        ...(validation.valid ? {} : { validationIssues: validation.issues }),
        work,
      });
      validation = await this.validateFacts(facts, snapshot, work.workId);
      const contractCorrectionCodes = new Set(["EDGE_GUARD_PREDICATE_INVALID", "EDGE_EFFECT_PREDICATE_INVALID"]);
      if (validation.issues.length > 0 && validation.issues.every((entry) => contractCorrectionCodes.has(entry.code))) {
        facts = await this.options.executor.repairFacts({ snapshot, facts, issueCodes: [...new Set(validation.issues.map((entry) => entry.code))], validationIssues: validation.issues, work });
        validation = await this.validateFacts(facts, snapshot, work.workId);
      }
      verdict = validation.valid ? await this.options.executor.review({ stage: "fact", artifact: facts, work }) : { pass: false, issueCodes: validation.issues.map((entry) => entry.code) };
    }
    await this.finishStage("fact", work, `FACT-${analysisRunId}`, facts, validation, verdict, validation.valid ? this.factIds(facts) : []);
    return facts;
  }

  private async executeWikiStage(snapshot: SourceSnapshot, facts: FactBundle, analysisRunId: string, sourceSnapshotId: string, sessionId: string): Promise<WikiBundle> {
    const work = await this.beginStage("wiki", analysisRunId, sourceSnapshotId, sessionId, [sourceSnapshotId, `FACT-${analysisRunId}`]);
    const skeleton = compileReachableWorkflowSkeleton(facts);
    let patch = await this.options.executor.composeWiki({ snapshot, facts, skeleton, work });
    let wiki = applyWikiSemanticPatch(skeleton, patch);
    let validation = validateWikiBundle(wiki, facts);
    let verdict = validation.valid ? await this.options.executor.review({ stage: "wiki", artifact: wiki, work }) : { pass: false, issueCodes: validation.issues.map((entry) => entry.code) };
    if (validation.valid && this.repairableVerdict(verdict) && this.options.executor.repairWiki) {
      const scope = createWikiGoalCorrectionScope(wiki, verdict.issueCodes);
      const correction = await this.options.executor.repairWiki({ snapshot, facts, skeleton, wiki, scope, issueCodes: [...verdict.issueCodes], work });
      wiki = applyWikiGoalCorrectionPatch(wiki, scope, correction);
      validation = validateWikiBundle(wiki, facts);
      verdict = validation.valid ? await this.options.executor.review({ stage: "wiki", artifact: wiki, work }) : { pass: false, issueCodes: validation.issues.map((entry) => entry.code) };
    }
    await this.finishStage("wiki", work, `WIKI-${analysisRunId}`, wiki, validation, verdict, validation.valid ? wiki.workflows.map((workflow) => workflow.workflow) : []);
    return wiki;
  }

  private async executeScenarioStage(snapshot: SourceSnapshot, facts: FactBundle, wiki: WikiBundle, analysisRunId: string, sourceSnapshotId: string, sessionId: string): Promise<{ scenarios: ScenarioSet; coverage: ReturnType<typeof calculateCoverage> }> {
    const work = await this.beginStage("scenario", analysisRunId, sourceSnapshotId, sessionId, [sourceSnapshotId, `FACT-${analysisRunId}`, `WIKI-${analysisRunId}`]);
    const draft = compileScenarioSet(facts, wiki);
    let scenarios = await this.options.executor.composeScenarios({ snapshot, facts, wiki, draft, work });
    let validation = validateScenarioSet(scenarios, facts, wiki, draft);
    let verdict = validation.valid ? await this.options.executor.review({ stage: "scenario", artifact: scenarios, work }) : { pass: false, issueCodes: validation.issues.map((entry) => entry.code) };
    if (validation.valid && this.repairableVerdict(verdict) && this.options.executor.repairScenarios) {
      const scope = createScenarioNarrationCorrectionScope(scenarios, verdict.issueCodes);
      const correction = await this.options.executor.repairScenarios({ snapshot, facts, wiki, draft, scenarios, scope, issueCodes: [...verdict.issueCodes], work });
      scenarios = applyScenarioNarrationCorrectionPatch(scenarios, scope, correction);
      validation = validateScenarioSet(scenarios, facts, wiki, draft);
      verdict = validation.valid ? await this.options.executor.review({ stage: "scenario", artifact: scenarios, work }) : { pass: false, issueCodes: validation.issues.map((entry) => entry.code) };
    }
    const coverage = validation.valid ? calculateCoverage(facts, scenarios) : { total_edges: facts.edges.length, covered_edges: 0, uncovered_edge_ids: facts.edges.map((edge) => edge.edge_id), coverage_percent: 0, assumed_predicates: facts.predicates.filter((predicate) => predicate.source === "assumed").map((predicate) => predicate.pred_id) };
    if (validation.valid && verdict.pass) await this.writer!.writeJson(analysisRunId, "scenario", "coverage", coverage);
    await this.finishStage("scenario", work, `SCENARIOS-${analysisRunId}`, scenarios, validation, verdict, validation.valid ? scenarios.scenarios.flatMap((scenario) => [scenario.scenario_id, scenario.workflow, ...scenario.path]) : [], async () => {
      const artifacts = Object.values(this.coordinator!.getState().artifacts)
        .filter((artifact) => artifact.analysisRunId === analysisRunId && artifact.status === "persisted")
        .sort((left, right) => left.artifactId.localeCompare(right.artifactId))
        .map((artifact) => ({ artifact_id: artifact.artifactId, artifact_type: artifact.artifactType, content_hash: artifact.contentHash, final_path: artifact.finalPath, related_ids: artifact.relatedIds }));
      await this.writer!.writeJson(analysisRunId, "scenario", "manifest", {
        schema_version: 1, project_id: this.options.projectId, analysis_run_id: analysisRunId, created_at: new Date().toISOString(), source_snapshot_id: sourceSnapshotId, source_root_hash: snapshot.root_hash,
        runtime_version: this.options.runtimeVersion, protocol_version: this.options.protocolVersion, pi_sdk_version: this.options.piSdkVersion,
        assurance: this.options.modelBindings?.some((binding) => binding.role === "reviewer") ? "independent-reviewer" : "single-model",
        model_bindings: (this.options.modelBindings ?? []).map((binding) => ({ role: binding.role, provider: binding.provider, api: binding.api, model_id: binding.modelId, endpoint: this.endpointIdentifier(binding.endpoint), ...(binding.apiVersion ? { api_version: binding.apiVersion } : {}), data_policy_accepted: binding.dataPolicyAccepted })),
        artifacts, final_revision: this.revision() + 1,
      });
    });
    return { scenarios, coverage };
  }

  private async readArtifact<T>(artifactId: string, analysisRunId: string): Promise<T> {
    const artifact = this.coordinator!.getState().artifacts[artifactId];
    if (!artifact || artifact.analysisRunId !== analysisRunId || artifact.status !== "persisted" || !artifact.finalPath) throw new Error(`PERSISTED_ARTIFACT_NOT_FOUND:${artifactId}`);
    const content = await readFile(artifact.finalPath);
    if (createHash("sha256").update(content).digest("hex") !== artifact.contentHash) throw new Error(`PERSISTED_ARTIFACT_HASH_MISMATCH:${artifactId}`);
    return JSON.parse(content.toString("utf8")) as T;
  }

  private async readRunResult(analysisRunId: string, coverage: ReturnType<typeof calculateCoverage>): Promise<GenerationRunResult> {
    const state = this.coordinator!.getState();
    return {
      analysisRunId,
      sourceSnapshot: await this.readArtifact<SourceSnapshot>(state.sourceSnapshotId!, analysisRunId),
      facts: await this.readArtifact<FactBundle>(`FACT-${analysisRunId}`, analysisRunId),
      wiki: await this.readArtifact<WikiBundle>(`WIKI-${analysisRunId}`, analysisRunId),
      scenarios: await this.readArtifact<ScenarioSet>(`SCENARIOS-${analysisRunId}`, analysisRunId),
      coverage,
      finalRevision: this.revision(),
    };
  }

  private async beginStep(step: GenerationStep, analysisRunId: string, sourceSnapshotId: string, sessionId: string, inputIds: string[]): Promise<WorkDescriptor> {
    const policy = generationStepRegistry[step];
    const role = policy.executor === "deterministic" ? "deterministic" : "author";
    const planId = `GENERATION-PLAN-${analysisRunId}`;
    const plan = await this.readArtifact<GenerationPlan>(planId, analysisRunId);
    const planEntry = validateGenerationPlanEntry(plan, step, { projectId: this.options.projectId, analysisRunId, sourceSnapshotId });
    const scopedInputIds = [...new Set([planId, ...inputIds])];
    await this.commit({ type: "analysis.step.start", projectId: this.options.projectId, operationId: randomUUID(), expectedRevision: this.revision(), step, role });
    const current = this.coordinator!.getState();
    const inputArtifacts = scopedInputIds.map((artifactId) => {
      const artifact = current.artifacts[artifactId];
      if (!artifact || artifact.analysisRunId !== analysisRunId || artifact.status !== "persisted") throw new Error(`STEP_INPUT_RECEIPT_NOT_PERSISTED:${artifactId}`);
      return { artifactId, analysisRunId, contentHash: artifact.contentHash };
    });
    const descriptor = createGenerationWorkDescriptor({
      projectId: this.options.projectId,
      analysisRunId,
      sourceSnapshotId,
      sessionId,
      kind: policy.workKind,
      role,
      generationStep: step,
      outputArtifactType: policy.outputArtifactType,
      objective: planEntry.objective,
      stepPlan: {
        entryChecks: [...planEntry.entry_checks],
        executionActions: [...planEntry.execution_actions],
        completionChecks: [...planEntry.completion_checks],
        correctionMode: planEntry.correction_mode,
        contextStrategy: planEntry.context_strategy,
      },
      expectedRevision: this.revision(),
      inputIds: scopedInputIds,
      inputArtifacts,
    });
    await this.workService!.register(descriptor);
    const context = await this.workService!.getContext(this.options.projectId, descriptor.workId);
    await this.workService!.begin({ projectId: this.options.projectId, workId: descriptor.workId, operationId: randomUUID(), expectedRevision: context.revision, contextToken: context.contextToken });
    await this.emitStep({ stage: policy.stage, step, role, status: "started", progress: this.coordinator!.getState().progress });
    return { ...descriptor, expectedRevision: this.revision(), status: "running" };
  }

  private async ensureGenerationPlan(analysisRunId: string, sourceSnapshotId: string, sessionId: string): Promise<GenerationPlan> {
    const artifactId = `GENERATION-PLAN-${analysisRunId}`;
    const existing = this.coordinator!.getState().artifacts[artifactId];
    if (existing?.status === "persisted") {
      const plan = await this.readArtifact<GenerationPlan>(artifactId, analysisRunId);
      const validation = validateGenerationPlan(plan, { projectId: this.options.projectId, analysisRunId, sourceSnapshotId });
      if (!validation.valid) throw new Error(`GENERATION_PLAN_REJECTED:${validation.issues.map((entry) => entry.code).join(",")}`);
      await this.ensureGenerationPlanRegistration(analysisRunId, artifactId);
      return plan;
    }

    const template = generationPlanTemplate({ projectId: this.options.projectId, analysisRunId, sourceSnapshotId });
    const descriptor = createGenerationWorkDescriptor({
      projectId: this.options.projectId,
      analysisRunId,
      sourceSnapshotId,
      sessionId,
      kind: "analysis.generation-plan",
      role: "author",
      outputArtifactType: "generation-plan",
      objective: "Plan one source-grounded scenario-generation run before entering SRC.",
      expectedRevision: this.revision(),
      inputIds: [],
      inputArtifacts: [],
    });
    await this.workService!.register(descriptor);
    const context = await this.workService!.getContext(this.options.projectId, descriptor.workId);
    await this.workService!.begin({ projectId: this.options.projectId, workId: descriptor.workId, operationId: randomUUID(), expectedRevision: context.revision, contextToken: context.contextToken });
    await this.emitPlan({ status: "started", progress: this.coordinator!.getState().progress });
    const work = { ...descriptor, expectedRevision: this.revision(), status: "running" as const };
    const plan = this.options.executor.planGeneration
      ? await this.options.executor.planGeneration({ template, work })
      : this.options.modelBindings?.length
        ? (() => { throw new Error("GENERATION_PLAN_EXECUTOR_REQUIRED"); })()
        : {
            ...template,
            objective: "Produce one source-grounded and backend-verifiable scenario set.",
            steps: template.steps.map((entry) => ({
              ...entry,
              objective: `Complete only ${entry.step}.`,
              entry_checks: ["Validate the exact scoped input receipts."],
              execution_actions: ["Produce only the declared output artifact."],
              completion_checks: ["Validate, hash, register, and persist the output receipt."],
            })),
          };
    const validation = validateGenerationPlan(plan, { projectId: this.options.projectId, analysisRunId, sourceSnapshotId });
    if (!validation.valid) throw new Error(`GENERATION_PLAN_REJECTED:${validation.issues.map((entry) => entry.code).join(",")}`);
    const staged = await this.writer!.writeStagingJson(work.workId, artifactId, plan);
    await this.workService!.mutate({
      projectId: this.options.projectId,
      sessionId,
      workId: work.workId,
      operationId: randomUUID(),
      expectedRevision: this.revision(),
      mutation: { op: "submit-artifacts", artifacts: [{ artifactId, artifactType: "generation-plan", stagingPath: `.scenarioforge/staging/${work.workId}/${artifactId}.json`, relatedIds: [...GENERATION_STEPS], contentHash: staged.contentHash }] },
    });
    await this.commit({ type: "work.settle", projectId: this.options.projectId, workId: work.workId, operationId: randomUUID(), expectedRevision: this.revision() });
    const final = await this.writer!.promoteJson(analysisRunId, "src", staged);
    const contextRecords = Object.values(this.coordinator!.getState().artifacts)
      .filter((artifact) => artifact.workId === work.workId && artifact.artifactType === "context-manifest" && artifact.status === "staged");
    const finalContexts = await Promise.all(contextRecords.map((record) => this.writer!.promoteJson(analysisRunId, "src", {
      artifactId: record.artifactId,
      path: join(this.options.projectRoot, record.stagingPath),
      contentHash: record.contentHash,
    })));
    for (const contextArtifact of finalContexts) await this.commit({ type: "artifact.persist", projectId: this.options.projectId, artifactId: contextArtifact.artifactId, finalPath: contextArtifact.path, operationId: randomUUID(), expectedRevision: this.revision() });
    await this.commit({ type: "artifact.persist", projectId: this.options.projectId, artifactId, finalPath: final.path, operationId: randomUUID(), expectedRevision: this.revision() });
    await this.ensureGenerationPlanRegistration(analysisRunId, artifactId);
    await this.emitPlan({ status: "completed", progress: this.coordinator!.getState().progress, artifactId });
    return plan;
  }

  private async ensureGenerationPlanRegistration(analysisRunId: string, artifactId: string): Promise<void> {
    const state = this.coordinator!.getState();
    const artifact = state.artifacts[artifactId];
    if (!artifact || artifact.analysisRunId !== analysisRunId || artifact.status !== "persisted" || !artifact.finalPath || artifact.artifactType !== "generation-plan") {
      throw new Error("GENERATION_PLAN_REGISTRATION_INCOMPLETE");
    }
    await this.readArtifact<GenerationPlan>(artifactId, analysisRunId);
    const contextManifestIds = Object.values(state.artifacts)
      .filter((candidate) => candidate.workId === artifact.workId && candidate.artifactType === "context-manifest" && candidate.status === "persisted")
      .map((candidate) => candidate.artifactId)
      .sort();
    const manifestPath = join(this.options.projectRoot, ".scenarioforge", "runs", analysisRunId, "source", "generation-plan-manifest.json");
    let manifestValid = false;
    try {
      const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
      manifestValid = manifest.schema_version === 1
        && manifest.artifact_id === artifactId
        && manifest.content_hash === artifact.contentHash
        && manifest.producing_work_id === artifact.workId
        && JSON.stringify(manifest.context_manifest_ids) === JSON.stringify(contextManifestIds);
    } catch {}
    if (!manifestValid) {
      await this.writer!.writeJson(analysisRunId, "src", "generation-plan-manifest", {
        schema_version: 1,
        artifact_id: artifactId,
        content_hash: artifact.contentHash,
        producing_work_id: artifact.workId,
        context_manifest_ids: contextManifestIds,
      });
    }
    const missingRelations = GENERATION_STEPS.filter((step) => !this.index!.queryByRelatedId(step, state.revision, () => true).some((row) =>
      row.artifactId === artifactId
      && row.contentHash === artifact.contentHash
      && row.artifactType === "generation-plan"
      && row.artifactPath === artifact.finalPath));
    if (!missingRelations.length) return;
    const journal = await this.repository!.recoverLatest();
    if (!journal || journal.state.artifacts[artifactId]?.status !== "persisted" || journal.state.artifacts[artifactId]?.contentHash !== artifact.contentHash) {
      throw new Error("GENERATION_PLAN_REGISTRATION_INCOMPLETE");
    }
    this.index!.insert(missingRelations.map((step) => ({
      transactionId: journal.transactionId,
      stateRevision: journal.revision,
      artifactId,
      relatedId: step,
      contentHash: artifact.contentHash,
      artifactType: "generation-plan",
      artifactPath: artifact.finalPath,
    })));
  }

  private async finishStep(
    step: GenerationStep,
    work: WorkDescriptor,
    artifactId: string,
    artifact: unknown,
    validation: ArtifactValidation,
    verdict: SemanticVerdict,
    relatedIds: string[],
  ): Promise<void> {
    const policy = generationStepRegistry[step];
    const stage = policy.stage;
    const staged = await this.writer!.writeStagingJson(work.workId, artifactId, artifact);
    const verdictArtifactId = `VERDICT-${step}-${work.workId}`;
    const stagedVerdict = policy.review === "independent" ? await this.writer!.writeStagingJson(work.workId, verdictArtifactId, verdict) : undefined;
    const normalizedRelatedIds = [...new Set(relatedIds.filter(Boolean))].sort();
    const submissions = [
      { artifactId, artifactType: policy.outputArtifactType, generationStep: step, stagingPath: `.scenarioforge/staging/${work.workId}/${artifactId}.json`, relatedIds: normalizedRelatedIds, contentHash: staged.contentHash },
      ...(stagedVerdict ? [{ artifactId: verdictArtifactId, artifactType: "semantic-verdict" as const, generationStep: step, stagingPath: `.scenarioforge/staging/${work.workId}/${verdictArtifactId}.json`, relatedIds: [artifactId], contentHash: stagedVerdict.contentHash }] : []),
    ];
    await this.workService!.mutate({ projectId: this.options.projectId, sessionId: work.sessionId, workId: work.workId, operationId: randomUUID(), expectedRevision: this.revision(), mutation: { op: "submit-artifacts", artifacts: submissions } });
    await this.commit({ type: "work.settle", projectId: this.options.projectId, workId: work.workId, operationId: randomUUID(), expectedRevision: this.revision() });
    const verdictValid = typeof verdict.pass === "boolean" && Array.isArray(verdict.issueCodes) && verdict.issueCodes.every((code) => typeof code === "string" && code.trim());
    if (!validation.valid || !verdictValid || !verdict.pass) {
      throw new Error(`STEP_ARTIFACT_REJECTED:${step}:${[...new Set([...validation.issues.map((entry) => entry.code), ...(verdictValid ? verdict.issueCodes : ["SEMANTIC_VERDICT_INVALID"])])].join(",")}`);
    }
    const final = await this.writer!.promoteJson(work.analysisRunId, stage, staged);
    const finalVerdict = stagedVerdict ? await this.writer!.promoteJson(work.analysisRunId, stage, stagedVerdict) : undefined;
    const contextState = this.coordinator!.getState();
    const roleWorkIds = new Set([work.workId, ...Object.values(contextState.works).filter((candidate) => candidate.parentWorkId === work.workId).map((candidate) => candidate.workId)]);
    const contextRecords = Object.values(contextState.artifacts)
      .filter((candidate) => roleWorkIds.has(candidate.workId) && candidate.generationStep === step && candidate.artifactType === "context-manifest" && candidate.status === "staged")
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.artifactId.localeCompare(right.artifactId));
    const finalContexts = await Promise.all(contextRecords.map((record) => this.writer!.promoteJson(work.analysisRunId, stage, {
      artifactId: record.artifactId,
      path: join(this.options.projectRoot, record.stagingPath),
      contentHash: record.contentHash,
    })));
    const stepManifest = await this.writer!.writeJson(work.analysisRunId, stage, `${step}-manifest`, {
      schema_version: 1,
      step,
      producing_work_id: work.workId,
      input_artifact_ids: work.inputArtifacts?.map((input) => input.artifactId) ?? [],
      artifacts: [
        { artifact_id: artifactId, artifact_type: policy.outputArtifactType, content_hash: final.contentHash, related_ids: normalizedRelatedIds },
        ...(finalVerdict ? [{ artifact_id: verdictArtifactId, artifact_type: "semantic-verdict", content_hash: finalVerdict.contentHash, related_ids: [artifactId] }] : []),
        ...finalContexts.map((context) => ({ artifact_id: context.artifactId, artifact_type: "context-manifest", content_hash: context.contentHash, related_ids: contextRecords.find((record) => record.artifactId === context.artifactId)?.relatedIds ?? [] })),
      ],
    });
    for (const context of finalContexts) await this.commit({ type: "artifact.persist", projectId: this.options.projectId, artifactId: context.artifactId, finalPath: context.path, operationId: randomUUID(), expectedRevision: this.revision() });
    if (finalVerdict) await this.commit({ type: "artifact.persist", projectId: this.options.projectId, artifactId: verdictArtifactId, finalPath: finalVerdict.path, operationId: randomUUID(), expectedRevision: this.revision() });
    await this.commit({ type: "artifact.persist", projectId: this.options.projectId, artifactId, finalPath: final.path, operationId: randomUUID(), expectedRevision: this.revision() });
    const journal = await this.repository!.recoverLatest();
    if (!journal) throw new Error("JOURNAL_COMMIT_MISSING");
    const rows: ArtifactIndexRow[] = normalizedRelatedIds.map((relatedId) => ({ transactionId: journal.transactionId, stateRevision: journal.revision, artifactId, relatedId, contentHash: final.contentHash, artifactType: policy.outputArtifactType, artifactPath: final.path }));
    if (!rows.length) rows.push({ transactionId: journal.transactionId, stateRevision: journal.revision, artifactId, relatedId: artifactId, contentHash: final.contentHash, artifactType: policy.outputArtifactType, artifactPath: final.path });
    this.index!.insert(rows);
    const gateState = this.coordinator!.getState();
    const rootWork = gateState.works[work.workId];
    const childWorkStatuses = Object.values(gateState.works).filter((candidate) => candidate.parentWorkId === work.workId).map((candidate) => candidate.status);
    const activeActivities = Object.values(gateState.activities).filter((activity) => activity.workId === work.workId && ["queued", "running"].includes(activity.status));
    const requiredArtifacts = [artifactId, ...(finalVerdict ? [verdictArtifactId] : []), ...finalContexts.map((context) => context.artifactId)];
    const persisted = requiredArtifacts.every((id) => gateState.artifacts[id]?.status === "persisted");
    const decision = new StageCompletionGate().decide({ stage, sessionStatus: gateState.sessionStatus, rootWorkStatus: rootWork?.status ?? "failed", childWorkStatuses, activeActivities, artifactSchemaValid: validation.valid, requiredRelationsValid: true, finalArtifactPersisted: persisted, indexCandidateValid: rows.length > 0, stageManifestValid: Boolean(stepManifest.contentHash), journalCheckpointCommitted: journal.revision === gateState.revision });
    if (!decision.accepted) throw new Error(`COMPLETION_GATE_REJECTED:${decision.unmetGates.join(",")}`);
    await this.commit({ type: "analysis.step.complete", projectId: this.options.projectId, step, receiptArtifactId: artifactId, ...(finalContexts.at(-1) ? { contextManifestArtifactId: finalContexts.at(-1)!.artifactId } : {}), operationId: randomUUID(), expectedRevision: this.revision() });
    const completedState = this.coordinator!.getState();
    await this.emitStep({ stage, step, role: work.role ?? (policy.executor === "deterministic" ? "deterministic" : "author"), status: "completed", progress: completedState.progress, artifactId });
    if (completedState.stages[stage] === "completed") await this.emitStage({ stage, status: "completed", progress: completedState.progress });
  }

  private async writeFinalManifest(analysisRunId: string, sourceSnapshotId: string, snapshot: SourceSnapshot): Promise<void> {
    const state = this.coordinator!.getState();
    const artifacts = Object.values(state.artifacts)
      .filter((artifact) => artifact.analysisRunId === analysisRunId && artifact.status === "persisted")
      .sort((left, right) => left.artifactId.localeCompare(right.artifactId))
      .map((artifact) => ({ artifact_id: artifact.artifactId, artifact_type: artifact.artifactType, generation_step: artifact.generationStep, content_hash: artifact.contentHash, final_path: artifact.finalPath, related_ids: artifact.relatedIds }));
    await this.writer!.writeJson(analysisRunId, "scenario", "manifest", {
      schema_version: 2,
      project_id: this.options.projectId,
      analysis_run_id: analysisRunId,
      created_at: new Date().toISOString(),
      source_snapshot_id: sourceSnapshotId,
      source_root_hash: snapshot.root_hash,
      runtime_version: this.options.runtimeVersion,
      protocol_version: this.options.protocolVersion,
      pi_sdk_version: this.options.piSdkVersion,
      assurance: this.options.modelBindings?.some((binding) => binding.role === "reviewer") ? "independent-reviewer" : "single-model",
      model_bindings: (this.options.modelBindings ?? []).map((binding) => ({ role: binding.role, provider: binding.provider, api: binding.api, model_id: binding.modelId, endpoint: this.endpointIdentifier(binding.endpoint), ...(binding.apiVersion ? { api_version: binding.apiVersion } : {}), data_policy_accepted: binding.dataPolicyAccepted })),
      artifacts,
      final_revision: state.revision,
    });
  }

  private async beginStage(stage: AnalysisStage, analysisRunId: string, sourceSnapshotId: string, sessionId: string, inputIds: string[]): Promise<WorkDescriptor> {
    await this.commit({ type: "analysis.stage.start", projectId: this.options.projectId, operationId: randomUUID(), expectedRevision: this.revision(), stage });
    const descriptor = createGenerationWorkDescriptor({ projectId: this.options.projectId, analysisRunId, sourceSnapshotId, sessionId, kind: artifactTypeByStage[stage], expectedRevision: this.revision(), inputIds });
    await this.workService!.register(descriptor);
    const context = await this.workService!.getContext(this.options.projectId, descriptor.workId);
    await this.workService!.begin({ projectId: this.options.projectId, workId: descriptor.workId, operationId: randomUUID(), expectedRevision: context.revision, contextToken: context.contextToken });
    await this.emitStage({ stage, status: "started", progress: this.coordinator!.getState().progress });
    return { ...descriptor, expectedRevision: this.revision(), status: "running" };
  }

  private async finishStage(stage: AnalysisStage, work: WorkDescriptor, artifactId: string, artifact: unknown, validation: ArtifactValidation, verdict: SemanticVerdict, relatedIds: string[], beforeComplete?: () => Promise<void>): Promise<void> {
    const staged = await this.writer!.writeStagingJson(work.workId, artifactId, artifact);
    const verdictArtifactId = `VERDICT-${stage}-${work.workId}`;
    const stagedVerdict = stage === "src" ? undefined : await this.writer!.writeStagingJson(work.workId, verdictArtifactId, verdict);
    const submissions = [
      { artifactId, artifactType: stage, stagingPath: `.scenarioforge/staging/${work.workId}/${artifactId}.json`, relatedIds: [...new Set(relatedIds)].sort(), contentHash: staged.contentHash },
      ...(stagedVerdict ? [{ artifactId: verdictArtifactId, artifactType: stage, stagingPath: `.scenarioforge/staging/${work.workId}/${verdictArtifactId}.json`, relatedIds: [artifactId], contentHash: stagedVerdict.contentHash }] : []),
    ];
    await this.workService!.mutate({ projectId: this.options.projectId, sessionId: work.sessionId, workId: work.workId, operationId: randomUUID(), expectedRevision: this.revision(), mutation: { op: "submit-artifacts", artifacts: submissions } });
    await this.commit({ type: "work.settle", projectId: this.options.projectId, workId: work.workId, operationId: randomUUID(), expectedRevision: this.revision() });
    const verdictValid = typeof verdict.pass === "boolean" && Array.isArray(verdict.issueCodes) && verdict.issueCodes.every((code) => typeof code === "string" && code.trim());
    if (!validation.valid || !verdictValid || !verdict.pass) throw new Error(`STAGE_ARTIFACT_REJECTED:${[...new Set([...validation.issues.map((entry) => entry.code), ...(verdictValid ? verdict.issueCodes : ["SEMANTIC_VERDICT_INVALID"])])].join(",")}`);
    const final = await this.writer!.promoteJson(work.analysisRunId, stage, staged);
    const finalVerdict = stagedVerdict ? await this.writer!.promoteJson(work.analysisRunId, stage, stagedVerdict) : undefined;
    const stageManifest = await this.writer!.writeStageManifest(work.analysisRunId, stage, { schema_version: 1, stage, artifacts: [{ artifact_id: artifactId, content_hash: final.contentHash, related_ids: [...new Set(relatedIds)].sort() }, ...(finalVerdict ? [{ artifact_id: verdictArtifactId, content_hash: finalVerdict.contentHash, related_ids: [artifactId] }] : [])] });
    if (finalVerdict) await this.commit({ type: "artifact.persist", projectId: this.options.projectId, artifactId: verdictArtifactId, finalPath: finalVerdict.path, operationId: randomUUID(), expectedRevision: this.revision() });
    await this.commit({ type: "artifact.persist", projectId: this.options.projectId, artifactId, finalPath: final.path, operationId: randomUUID(), expectedRevision: this.revision() });
    const journal = await this.repository!.recoverLatest();
    if (!journal) throw new Error("JOURNAL_COMMIT_MISSING");
    const rows: ArtifactIndexRow[] = [...new Set(relatedIds)].map((relatedId) => ({ transactionId: journal.transactionId, stateRevision: journal.revision, artifactId, relatedId, contentHash: final.contentHash, artifactType: stage, artifactPath: final.path }));
    if (!rows.length) rows.push({ transactionId: journal.transactionId, stateRevision: journal.revision, artifactId, relatedId: artifactId, contentHash: final.contentHash, artifactType: stage, artifactPath: final.path });
    this.index!.insert(rows);
    const gateState = this.coordinator!.getState();
    const rootWork = gateState.works[work.workId];
    const childWorkStatuses = Object.values(gateState.works).filter((candidate) => candidate.parentWorkId === work.workId).map((candidate) => candidate.status);
    const activeActivities = Object.values(gateState.activities).filter((activity) => activity.workId === work.workId && ["queued", "running"].includes(activity.status));
    const requiredArtifacts = [artifactId, ...(finalVerdict ? [verdictArtifactId] : [])];
    const persisted = requiredArtifacts.every((id) => gateState.artifacts[id]?.status === "persisted");
    const decision = new StageCompletionGate().decide({ stage, sessionStatus: gateState.sessionStatus, rootWorkStatus: rootWork?.status ?? "failed", childWorkStatuses, activeActivities, artifactSchemaValid: validation.valid, requiredRelationsValid: true, finalArtifactPersisted: persisted, indexCandidateValid: rows.length > 0, stageManifestValid: Boolean(stageManifest.contentHash), journalCheckpointCommitted: journal.revision === gateState.revision });
    if (!decision.accepted) throw new Error(`COMPLETION_GATE_REJECTED:${decision.unmetGates.join(",")}`);
    await beforeComplete?.();
    await this.commit({ type: "analysis.stage.complete", projectId: this.options.projectId, stage, operationId: randomUUID(), expectedRevision: this.revision() });
    await this.emitStage({ stage, status: "completed", progress: this.coordinator!.getState().progress });
  }

  private factIds(facts: FactBundle): string[] { return [...facts.screens.flatMap((screen) => [screen.screen_id, ...screen.elements.map((element) => element.id), ...screen.apis.map((api) => api.id), ...screen.feedback.map((item) => item.id), ...screen.displays.map((item) => item.id)]), ...facts.edges.map((edge) => edge.edge_id), ...facts.predicates.map((predicate) => predicate.pred_id)]; }
  private async validateFacts(facts: FactBundle, snapshot: SourceSnapshot, workId: string | readonly string[]): Promise<ArtifactValidation> {
    const validation = validateFactBundle(facts);
    if (!validation.valid) return validation;
    const scannerElements = new Set(snapshot.interactions.map((interaction) => interaction.element_id));
    const scannerApis = new Set(snapshot.apis.map((api) => api.api_id));
    const factElements = facts.screens.flatMap((screen) => screen.elements.map((element) => element.id));
    const factApis = facts.screens.flatMap((screen) => screen.apis.map((api) => api.id));
    const foreign = [...factElements.filter((id) => !scannerElements.has(id)), ...factApis.filter((id) => !scannerApis.has(id))];
    const factIds = new Set(this.factIds(facts));
    const missing = [...snapshot.routes.map((route) => route.screen_id), ...scannerElements, ...scannerApis].filter((id) => !factIds.has(id));
    if (facts.project_id !== snapshot.project_id || facts.analysis_run_id !== snapshot.analysis_run_id || facts.source_snapshot_id !== snapshot.source_snapshot_id) validation.issues.push({ code: "FACT_IDENTITY_MISMATCH", severity: "error", path: "$", message: "FACT identity must match the active source snapshot." });
    if (foreign.length) validation.issues.push({ code: "FACT_INVENTORY_ID_INVALID", severity: "error", path: "$", message: `FACT IDs are not owned by the active scanner inventory: ${foreign.slice(0, 20).join(",")}` });
    if (missing.length) validation.issues.push({ code: "FACT_INVENTORY_INCOMPLETE", severity: "error", path: "$", message: `Scanner inventory IDs are missing: ${missing.slice(0, 20).join(",")}` });
    validation.valid = validation.issues.length === 0;
    try {
      await new EvidenceGrantService(this.options.projectRoot).verifyPersistedReferences(snapshot, workId, collectFactEvidence(facts));
      return validation;
    } catch (error) {
      return { valid: false, issues: [...validation.issues, { code: error instanceof Error ? error.message : "EVIDENCE_PROVENANCE_INVALID", severity: "error", path: "$", message: "FACT evidence is not covered by a live, work-scoped evidence grant." }] };
    }
  }
  private endpointIdentifier(endpoint?: string): string | undefined {
    if (!endpoint) return undefined;
    const parsed = new URL(endpoint);
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  }
  private failureCategory(error: unknown): DomainError["category"] {
    const message = error instanceof Error ? error.message : "";
    if (/SCHEMA|ARTIFACT_REJECTED|VERDICT/i.test(message)) return "schema";
    if (/EVIDENCE|PERMISSION|SCOPE/i.test(message)) return "permission";
    if (/PATH|STAGING/i.test(message)) return "path";
    if (/ID|REFERENCE|RELATION/i.test(message)) return "id";
    if (/TIMEOUT|RATE|429|ECONN|NETWORK/i.test(message)) return "provider";
    return "runtime";
  }
  private repairableVerdict(verdict: SemanticVerdict): boolean {
    return verdict.pass === false && Array.isArray(verdict.issueCodes) && verdict.issueCodes.length > 0 && verdict.issueCodes.every((code) => typeof code === "string" && Boolean(code.trim()));
  }
  private async emitStage(event: { stage: AnalysisStage; status: "started" | "completed"; progress: number }): Promise<void> {
    try { await this.options.onStage?.(event); } catch {}
  }
  private async emitPlan(event: { status: "started" | "completed"; progress: number; artifactId?: string }): Promise<void> {
    try { await this.options.onPlan?.(event); } catch {}
  }
  private async emitStep(event: { stage: AnalysisStage; step: GenerationStep; role: "deterministic" | "author" | "reviewer" | "repair"; status: "started" | "completed"; progress: number; artifactId?: string }): Promise<void> {
    try { await this.options.onStep?.(event); } catch {}
  }
  private revision(): number { return this.coordinator!.getState().revision; }
  private commit(command: Parameters<RuntimeStateCoordinator["commit"]>[0]) { return this.coordinator!.commit(command); }
}
