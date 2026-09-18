import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import { GENERATION_STEPS, type GenerationStep, type ProjectRuntimeState } from "@scenarioforge/contracts";
import { assertModelBinding, PI_CODING_AGENT_VERSION, type ModelBinding } from "@scenarioforge/pi-runtime";
import { updateProjectConfiguration } from "@scenarioforge/project-runtime";
import { JournalRepository } from "@scenarioforge/runtime-state";
import { ScenarioGenerationHarness, type GenerationStageResult } from "@scenarioforge/scenario-pipeline";
import type { AnalysisProgressEvent, AnalysisStartMode, ModelSettingsWithSecret } from "../../shared/desktop-api";
import { modelCredentialIdentity } from "../security/model-credential-store";
import { PiGenerationExecutor, type GenerationRetryEvent } from "./pi-generation-executor";

const projectIdFor = (path: string): string => `PRJ-${createHash("sha256").update(path).digest("hex").slice(0, 12)}`;

const retryProgressByStage = { src: 0, fact: 25, wiki: 50, scenario: 75 } as const;

export function analysisRetryProgress(event: GenerationRetryEvent): AnalysisProgressEvent {
  const seconds = Math.ceil(event.delayMs / 1000);
  return {
    stage: event.stage,
    progress: retryProgressByStage[event.stage],
    message: event.category === "provider-rate-limit"
      ? `${event.stage.toUpperCase()} 단계: 요청 한도 회복 대기 (${seconds}초 후 재시도)`
      : `${event.stage.toUpperCase()} 단계: 일시적 연결 오류 대기 (${seconds}초 후 재시도)`,
  };
}

export type ApplicationOrchestratorOptions = {
  runtimeTemplateRoot?: string;
};

export class ApplicationOrchestrator {
  private settings?: ModelSettingsWithSecret;
  private readonly secrets = new Map<string, string>();
  private readonly secretIdentities = new Map<string, string>();
  private readonly activeAnalyses = new Set<string>();

  /* 이 프로젝트에서 분석이 돌고 있는지. 진행 중인 산출물을 지우려는 요청을
   * 막기 위해 필요하다. */
  isAnalysisRunning(projectRoot: string): boolean {
    return this.activeAnalyses.has(projectRoot);
  }

  constructor(private readonly options: ApplicationOrchestratorOptions = {}) {}

  saveModelSettings(settings: ModelSettingsWithSecret): void {
    if (!settings.dataPolicyAccepted) throw new Error("DATA_POLICY_CONSENT_REQUIRED");
    this.modelBindings(settings).forEach(assertModelBinding);
    const authorReference = "session:model:author";
    const authorIdentity = modelCredentialIdentity("author", settings);
    if (!settings.apiKey && (!this.secrets.has(authorReference) || this.secretIdentities.get(authorReference) !== authorIdentity)) throw new Error("MODEL_CREDENTIAL_REQUIRED");
    if (settings.reviewer) {
      if (!settings.reviewer.dataPolicyAccepted) throw new Error("REVIEWER_DATA_POLICY_CONSENT_REQUIRED");
      const reviewerReference = "session:model:reviewer";
      const reviewerIdentity = modelCredentialIdentity("reviewer", settings.reviewer);
      if (!settings.reviewerApiKey && (!this.secrets.has(reviewerReference) || this.secretIdentities.get(reviewerReference) !== reviewerIdentity)) throw new Error("REVIEWER_MODEL_CREDENTIAL_REQUIRED");
    }
    if (settings.apiKey) {
      this.secrets.set(authorReference, settings.apiKey);
      this.secretIdentities.set(authorReference, authorIdentity);
    }
    if (settings.reviewerApiKey && settings.reviewer) {
      const reviewerReference = "session:model:reviewer";
      this.secrets.set(reviewerReference, settings.reviewerApiKey);
      this.secretIdentities.set(reviewerReference, modelCredentialIdentity("reviewer", settings.reviewer));
    }
    if (!settings.reviewer) {
      this.secrets.delete("session:model:reviewer");
      this.secretIdentities.delete("session:model:reviewer");
    }
    this.settings = { ...settings, apiKey: undefined, reviewerApiKey: undefined };
  }

  clearModelCredentials(): void {
    this.secrets.clear();
    this.secretIdentities.clear();
  }

  restoreModelCredentials(settings: ModelSettingsWithSecret, secrets: { author?: string; reviewer?: string }): void {
    if (secrets.author?.trim()) {
      const reference = "session:model:author";
      this.secrets.set(reference, secrets.author);
      this.secretIdentities.set(reference, modelCredentialIdentity("author", settings));
    }
    if (settings.reviewer && secrets.reviewer?.trim()) {
      const reference = "session:model:reviewer";
      this.secrets.set(reference, secrets.reviewer);
      this.secretIdentities.set(reference, modelCredentialIdentity("reviewer", settings.reviewer));
    }
  }

  modelCredentialStatus(settings: ModelSettingsWithSecret): { hasAuthorCredential: boolean; hasReviewerCredential: boolean } {
    const authorReference = "session:model:author";
    const hasAuthorCredential = this.secrets.has(authorReference)
      && this.secretIdentities.get(authorReference) === modelCredentialIdentity("author", settings);
    const reviewerReference = "session:model:reviewer";
    const hasReviewerCredential = Boolean(settings.reviewer)
      && this.secrets.has(reviewerReference)
      && this.secretIdentities.get(reviewerReference) === modelCredentialIdentity("reviewer", settings.reviewer!);
    return { hasAuthorCredential, hasReviewerCredential };
  }

  async startAnalysis(
    projectRootInput: string,
    mode: AnalysisStartMode,
    onProgress?: (event: AnalysisProgressEvent) => void,
    stopAfterStep: GenerationStep = "coverage-manifest",
  ): Promise<GenerationStageResult> {
    if (!this.settings) throw new Error("MODEL_SETTINGS_REQUIRED");
    const projectRoot = await realpath(projectRootInput);
    if (this.activeAnalyses.has(projectRoot)) throw new Error("ANALYSIS_ALREADY_RUNNING");
    this.activeAnalyses.add(projectRoot);
    const settings = this.settings;
    const runSecrets = new Map(this.secrets);
    const projectId = projectIdFor(projectRoot);
    let harness: ScenarioGenerationHarness | undefined;
    try {
    const models = this.modelBindings(settings);
    const author = models.find((model) => model.role === "author")!;
    const reviewer = models.find((model) => model.role === "reviewer");
    const executor = new PiGenerationExecutor({
      projectRoot,
      models,
      secretFor: (reference) => runSecrets.get(reference),
      onRetry: (event) => onProgress?.(analysisRetryProgress(event)),
    });
    harness = new ScenarioGenerationHarness({
      projectRoot, projectId, runtimeVersion: "1.0.0", protocolVersion: "1", piSdkVersion: PI_CODING_AGENT_VERSION, executor,
      ...(this.options.runtimeTemplateRoot ? { templateRoot: this.options.runtimeTemplateRoot } : {}),
      modelBindings: [
        { role: "author", provider: settings.provider, api: author.api!, modelId: author.modelId, endpoint: author.endpoint, ...(author.apiVersion ? { apiVersion: author.apiVersion } : {}), dataPolicyAccepted: author.dataPolicyAccepted },
        ...(reviewer && settings.reviewer ? [{ role: "reviewer" as const, provider: settings.reviewer.provider, api: reviewer.api!, modelId: reviewer.modelId, endpoint: reviewer.endpoint, ...(reviewer.apiVersion ? { apiVersion: reviewer.apiVersion } : {}), dataPolicyAccepted: reviewer.dataPolicyAccepted }] : []),
      ],
      assurance: reviewer ? "independent-reviewer" : "single-model",
      onPlan: ({ status, progress }) => onProgress?.({
        stage: "src",
        progress,
        planningStatus: status,
        message: status === "started" ? "Luna 생성 계획 작성 중" : "Luna 생성 계획 검증·저장 완료",
      }),
      onStep: ({ stage, step, role, status, progress }) => {
        const index = GENERATION_STEPS.indexOf(step);
        onProgress?.({
          stage,
          step,
          role,
          stepStatus: status,
          progress,
          completedSteps: status === "completed" ? index + 1 : index,
          totalSteps: GENERATION_STEPS.length,
          message: status === "started" ? `${step.toUpperCase()} 세부 단계 시작` : `${step.toUpperCase()} 세부 단계 검증·저장 완료`,
        });
      },
      onStage: ({ stage, status, progress }) => onProgress?.({ stage, progress, message: status === "started" ? `${stage.toUpperCase()} 단계 시작` : `${stage.toUpperCase()} 단계 검증 및 저장 완료` }),
    });
    await harness.initialize();
      await updateProjectConfiguration(projectRoot, {
        modelRoles: {
          author: { provider: settings.provider, api: author.api!, modelId: author.modelId, endpoint: this.endpointIdentifier(author.endpoint), ...(author.apiVersion ? { apiVersion: author.apiVersion } : {}), credentialRef: author.credentialRef, dataPolicyAccepted: author.dataPolicyAccepted },
          ...(reviewer && settings.reviewer ? { reviewer: { provider: settings.reviewer.provider, api: reviewer.api!, modelId: reviewer.modelId, endpoint: this.endpointIdentifier(reviewer.endpoint), ...(reviewer.apiVersion ? { apiVersion: reviewer.apiVersion } : {}), credentialRef: reviewer.credentialRef, dataPolicyAccepted: reviewer.dataPolicyAccepted } } : {}),
        },
        sourcePolicy: { include: ["**/*"], exclude: [".git/**", ".scenarioforge/**", "node_modules/**", "dist/**", "build/**"] },
      });
      let result = await harness.advance({ mode });
      while ((await harness.getState())?.generationSteps[stopAfterStep]?.status !== "completed") {
        result = await harness.advance({ mode: "continue" });
      }
      return result;
    } finally {
      await harness?.dispose();
      harness?.close();
      this.activeAnalyses.delete(projectRoot);
    }
  }

  async restoreProject(projectRootInput: string): Promise<ProjectRuntimeState | null> {
    const projectRoot = await realpath(projectRootInput);
    return (await new JournalRepository(projectRoot).recoverLatest())?.state ?? null;
  }

  private modelBindings(settings: ModelSettingsWithSecret): ModelBinding[] {
    const binding = (role: "author" | "reviewer", value: Pick<ModelSettingsWithSecret, "provider" | "endpoint" | "model" | "apiVersion" | "dataPolicyAccepted">): ModelBinding => ({
      role,
      provider: `scenarioforge-${role}`,
      api: value.provider === "anthropic" ? "anthropic-messages" : value.provider === "azure-openai" ? "azure-openai-chat-completions" : "openai-completions",
      modelId: value.model,
      endpoint: value.endpoint,
      ...(value.provider === "azure-openai" ? { apiVersion: value.apiVersion } : {}),
      credentialRef: `session:model:${role}`,
      dataPolicyAccepted: value.dataPolicyAccepted,
    });
    return [binding("author", settings), ...(settings.reviewer ? [binding("reviewer", settings.reviewer)] : [])];
  }

  private endpointIdentifier(endpoint: string): string {
    const parsed = new URL(endpoint);
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  }
}
