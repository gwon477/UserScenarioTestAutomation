import type { GenerationArtifactType, GenerationControlWorkKind, GenerationStepWorkKind, LegacyGenerationHarnessWorkKind, ScenarioQueryWorkKind } from "@scenarioforge/contracts";

export type GenerationOwnedWorkKind = LegacyGenerationHarnessWorkKind | GenerationStepWorkKind | GenerationControlWorkKind | ScenarioQueryWorkKind;
export type WorkPolicy = Readonly<{
  workKind: GenerationOwnedWorkKind;
  executors: readonly ("deterministic" | "author" | "reviewer")[];
  sessionKind: "analysis" | "chat";
  readableEntities: readonly string[];
  writableEntities: readonly string[];
  childWork: "forbidden" | "module-batch" | "scenario-batch";
  outputArtifactType: GenerationArtifactType | "source" | "chat-response";
  resourceProfile: "generation" | "scenario-chat";
}>;

export const generationWorkPolicies: Readonly<Record<GenerationOwnedWorkKind, WorkPolicy>> = Object.freeze({
  "analysis.generation-plan": Object.freeze({
    workKind: "analysis.generation-plan", executors: ["author"] as const, sessionKind: "analysis",
    readableEntities: ["generation-step-registry", "project-configuration"] as const, writableEntities: ["generation-plan"] as const,
    childWork: "forbidden", outputArtifactType: "generation-plan", resourceProfile: "generation",
  }),
  "analysis.source-map": Object.freeze({
    workKind: "analysis.source-map", executors: ["deterministic"] as const, sessionKind: "analysis",
    readableEntities: ["project-source", "scan-policy"] as const, writableEntities: ["staging-source-snapshot"] as const,
    childWork: "module-batch", outputArtifactType: "source", resourceProfile: "generation",
  }),
  "analysis.fact-extract": Object.freeze({
    workKind: "analysis.fact-extract", executors: ["author", "reviewer"] as const, sessionKind: "analysis",
    readableEntities: ["persisted-source", "evidence-grant"] as const, writableEntities: ["staging-fact"] as const,
    childWork: "module-batch", outputArtifactType: "fact", resourceProfile: "generation",
  }),
  "analysis.wiki-compose": Object.freeze({
    workKind: "analysis.wiki-compose", executors: ["author", "reviewer"] as const, sessionKind: "analysis",
    readableEntities: ["persisted-source", "persisted-fact"] as const, writableEntities: ["staging-wiki"] as const,
    childWork: "module-batch", outputArtifactType: "wiki", resourceProfile: "generation",
  }),
  "analysis.scenario-compose": Object.freeze({
    workKind: "analysis.scenario-compose", executors: ["deterministic", "author", "reviewer"] as const, sessionKind: "analysis",
    readableEntities: ["persisted-source", "persisted-fact", "persisted-wiki"] as const, writableEntities: ["staging-scenario"] as const,
    childWork: "scenario-batch", outputArtifactType: "scenario", resourceProfile: "generation",
  }),
  "analysis.source-scan": Object.freeze({
    workKind: "analysis.source-scan", executors: ["deterministic"] as const, sessionKind: "analysis",
    readableEntities: ["project-source", "scan-policy"] as const, writableEntities: ["source-snapshot"] as const,
    childWork: "forbidden", outputArtifactType: "source-snapshot", resourceProfile: "generation",
  }),
  "analysis.fact-catalog": Object.freeze({
    workKind: "analysis.fact-catalog", executors: ["author", "reviewer"] as const, sessionKind: "analysis",
    readableEntities: ["source-snapshot", "evidence-grant"] as const, writableEntities: ["fact-catalog"] as const,
    childWork: "forbidden", outputArtifactType: "fact-catalog", resourceProfile: "generation",
  }),
  "analysis.edge-ledger": Object.freeze({
    workKind: "analysis.edge-ledger", executors: ["author", "reviewer"] as const, sessionKind: "analysis",
    readableEntities: ["source-snapshot", "fact-catalog", "evidence-grant"] as const, writableEntities: ["edge-ledger"] as const,
    childWork: "forbidden", outputArtifactType: "edge-ledger", resourceProfile: "generation",
  }),
  "analysis.fact-assemble": Object.freeze({
    workKind: "analysis.fact-assemble", executors: ["deterministic"] as const, sessionKind: "analysis",
    readableEntities: ["fact-catalog", "edge-ledger"] as const, writableEntities: ["fact-bundle"] as const,
    childWork: "forbidden", outputArtifactType: "fact-bundle", resourceProfile: "generation",
  }),
  "analysis.workflow-skeleton": Object.freeze({
    workKind: "analysis.workflow-skeleton", executors: ["deterministic"] as const, sessionKind: "analysis",
    readableEntities: ["fact-bundle"] as const, writableEntities: ["workflow-skeleton"] as const,
    childWork: "forbidden", outputArtifactType: "workflow-skeleton", resourceProfile: "generation",
  }),
  "analysis.common-wiki": Object.freeze({
    workKind: "analysis.common-wiki", executors: ["author", "reviewer"] as const, sessionKind: "analysis",
    readableEntities: ["fact-bundle", "workflow-skeleton"] as const, writableEntities: ["wiki-bundle"] as const,
    childWork: "forbidden", outputArtifactType: "wiki-bundle", resourceProfile: "generation",
  }),
  "analysis.business-catalog": Object.freeze({
    workKind: "analysis.business-catalog", executors: ["author", "reviewer"] as const, sessionKind: "analysis",
    readableEntities: ["workflow-skeleton", "wiki-bundle"] as const, writableEntities: ["business-catalog"] as const,
    childWork: "forbidden", outputArtifactType: "business-catalog", resourceProfile: "generation",
  }),
  "analysis.scenario-skeleton": Object.freeze({
    workKind: "analysis.scenario-skeleton", executors: ["deterministic"] as const, sessionKind: "analysis",
    readableEntities: ["fact-bundle", "workflow-skeleton", "wiki-bundle", "business-catalog"] as const, writableEntities: ["scenario-skeleton"] as const,
    childWork: "forbidden", outputArtifactType: "scenario-skeleton", resourceProfile: "generation",
  }),
  "analysis.scenario-narration": Object.freeze({
    workKind: "analysis.scenario-narration", executors: ["author", "reviewer"] as const, sessionKind: "analysis",
    readableEntities: ["scenario-skeleton", "wiki-bundle"] as const, writableEntities: ["scenario-set"] as const,
    childWork: "forbidden", outputArtifactType: "scenario-set", resourceProfile: "generation",
  }),
  "analysis.coverage-manifest": Object.freeze({
    workKind: "analysis.coverage-manifest", executors: ["deterministic"] as const, sessionKind: "analysis",
    readableEntities: ["fact-bundle", "scenario-set"] as const, writableEntities: ["coverage-manifest"] as const,
    childWork: "forbidden", outputArtifactType: "coverage-manifest", resourceProfile: "generation",
  }),
  "scenario.answer": Object.freeze({
    workKind: "scenario.answer", executors: ["author"] as const, sessionKind: "chat",
    readableEntities: ["selected-scenario-view"] as const, writableEntities: ["conversation-record"] as const,
    childWork: "forbidden", outputArtifactType: "chat-response", resourceProfile: "scenario-chat",
  }),
});
