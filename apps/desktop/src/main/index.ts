import { app, BrowserWindow, dialog, ipcMain, nativeImage, safeStorage, shell } from "electron";
import type { IpcMainInvokeEvent } from "electron";
import { readFile, realpath } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { GENERATION_STEPS } from "@scenarioforge/contracts";
import {
  IPC_CHANNELS,
  type AnalysisStartMode,
  type AnalysisStateSummary,
  type ModelCredentialStatus,
  type ModelSettings,
  type ModelSettingsWithSecret,
  type ProjectSummary,
  type RunSummary,
  type ScenarioQuestion,
  type SelectedDirectory,
  type TestExecutionAcceptance,
  type TestExecutionRequest,
  type TestExecutionRequirementsRequest,
  type TestExecutionRunRequest,
  type TestExecutionRunResult,
  type TestExecutionCommandRequest,
  type StepEvidenceRequest,
  type EvidenceFrameRequest,
  type StepReviewListRequest,
  type StepReviewRequest,
} from "../shared/desktop-api";
import { isScenarioResult } from "../shared/scenario";
import { ApplicationOrchestrator } from "./application/application-orchestrator";
import { summarizeGenerationCheckpoint } from "./application/generation-checkpoint";
import { summarizeGenerationStageResult } from "./application/generation-stage-summary";
import { loadScenarioView } from "./application/scenario-view";
import { loadCanonicalRun, loadExecutionPlan, loadTestExecutionRequirements } from "./application/test-requirements-view";
import { warmJournal } from "./application/journal-cache";
import { toAnalysisFailure } from "./application/analysis-failure";
import { answerScenarioQuestion } from "./application/scenario-answer";
import { loadTestExecutions } from "./application/test-execution-view";
import { loadEvidenceFrame, loadStepEvidence } from "./application/evidence-view";
import { loadEvidenceLibrary } from "./application/evidence-library-view";
import { runQueuedExecution, watchCancelRequest } from "./application/test-vista-service";
import { createAzureVisionTransport, createVisionModels } from "./application/vision-model-client";
import { validateExecutionCommand } from "./application/test-execution-command";
import { executionRoot, ReviewStore, TestCoordinator } from "@scenarioforge/test-runtime";
import { ModelCredentialStore } from "./security/model-credential-store";
import { ProjectRegistry, type ProjectRegistryEntry } from "./security/project-registry";
import { loadRunSummaries } from "./application/run-summary";
import {
  deleteAnalysisData,
  loadProjectSummary,
  measureAnalysisData,
  unreachableSummary,
} from "./application/project-summary";

let mainWindow: BrowserWindow | null = null;
const mainDirectory = dirname(fileURLToPath(import.meta.url));
const orchestrator = new ApplicationOrchestrator({
  runtimeTemplateRoot: join(mainDirectory, "runtime-template"),
});
let credentialStore: ModelCredentialStore | undefined;
/* 수행 모델 binding. 저장된 설정에서 비밀값을 제외한 부분만 들고 있는다.
 * 이번 세션에 설정이 저장되지 않았으면 실행을 거절한다. 추측하지 않는다. */
let visionModelSettings: ModelSettings | undefined;
let projectRegistry: ProjectRegistry | undefined;
/* 연결 해제를 되돌리기 위해 이 세션에서 마지막으로 해제한 항목을 들고 있는다.
 * 되돌릴 경로를 renderer 가 보내지 않게 하려는 것이다. */
let lastDisconnected: ProjectRegistryEntry | undefined;
const selectedProjectRoots = new Set<string>();

function requireCredentialStore(): ModelCredentialStore {
  if (!credentialStore) throw new Error("MODEL_CREDENTIAL_STORE_NOT_READY");
  return credentialStore;
}

function requireProjectRegistry(): ProjectRegistry {
  if (!projectRegistry) throw new Error("PROJECT_REGISTRY_NOT_READY");
  return projectRegistry;
}

/* 레지스트리에 등록된 경로는 사용자가 대화상자로 고른 것이다. 읽기 권한을 그
 * 목록 범위로 되살린다. renderer 가 준 경로를 그대로 신뢰하지 않는다. */
async function authorizeRegisteredRoot(pathInput: string): Promise<string> {
  const entries = await requireProjectRegistry().list();
  const match = entries.find((entry) => entry.path === pathInput);
  if (!match) throw new Error("PROJECT_DIRECTORY_NOT_REGISTERED");
  const canonical = await realpath(resolve(match.path));
  selectedProjectRoots.add(canonical);
  return canonical;
}

function assertTrustedSender(event: IpcMainInvokeEvent) {
  if (!mainWindow || event.sender.id !== mainWindow.webContents.id) {
    throw new Error("허용되지 않은 렌더러 요청입니다.");
  }
}

async function requireSelectedProjectRoot(path: string): Promise<string> {
  const canonical = await realpath(resolve(path));
  if (!selectedProjectRoots.has(canonical)) throw new Error("PROJECT_DIRECTORY_NOT_AUTHORIZED");
  return canonical;
}

function registerIpcHandlers() {
  ipcMain.handle(IPC_CHANNELS.restoreProjectDirectory, async (event) => {
    assertTrustedSender(event);
    const canonical = await requireProjectRegistry().load();
    if (!canonical) return null;
    selectedProjectRoots.add(canonical);
    // 앱을 띄우자마자 chain 검증을 시작한다. 첫 화면을 보는 동안 끝난다.
    warmJournal(canonical);
    return { name: basename(canonical), path: canonical } satisfies SelectedDirectory;
  });

  ipcMain.handle(IPC_CHANNELS.listProjects, async (event): Promise<ProjectSummary[]> => {
    assertTrustedSender(event);
    const entries = await requireProjectRegistry().list();
    return Promise.all(
      entries.map(async (entry) => {
        try {
          const canonical = await realpath(resolve(entry.path));
          selectedProjectRoots.add(canonical);
          return await loadProjectSummary(canonical, entry);
        } catch {
          // 경로가 사라진 항목도 목록에 남긴다. 조용히 지우지 않는다.
          return unreachableSummary(entry);
        }
      }),
    );
  });

  /* 생성 이력 목록의 원천은 디스크다. renderer 저장소를 쓰지 않으므로 다른
   * 기기나 새 프로필에서도 같은 목록이 보인다. */
  ipcMain.handle(IPC_CHANNELS.listRuns, async (event, project: SelectedDirectory): Promise<RunSummary[]> => {
    assertTrustedSender(event);
    if (!project.path) return [];
    try {
      return await loadRunSummaries(await requireSelectedProjectRoot(project.path));
    } catch {
      return [];
    }
  });

  ipcMain.handle(IPC_CHANNELS.openProject, async (event, path: string) => {
    assertTrustedSender(event);
    const canonical = await authorizeRegisteredRoot(path);
    await requireProjectRegistry().touch(canonical, new Date().toISOString());
    /* chain 검증을 미리 시작한다. 프로젝트를 연 직후에 탭을 누르므로 그때
     * 검증이 끝나 있을 확률이 높다. 실패는 여기서 보고하지 않는다. */
    warmJournal(canonical);
    return { name: basename(canonical), path: canonical } satisfies SelectedDirectory;
  });

  ipcMain.handle(IPC_CHANNELS.revealProject, async (event, path: string) => {
    assertTrustedSender(event);
    const canonical = await authorizeRegisteredRoot(path);
    // openPath 는 실패 사유를 문자열로 준다. 그 문자열을 화면에 흘리지 않는다.
    return (await shell.openPath(canonical)) === "";
  });

  ipcMain.handle(IPC_CHANNELS.disconnectProject, async (event, path: string) => {
    assertTrustedSender(event);
    const entries = await requireProjectRegistry().list();
    const match = entries.find((entry) => entry.path === path);
    if (!match) return false;
    lastDisconnected = (await requireProjectRegistry().remove(match.path)) ?? undefined;
    return lastDisconnected !== undefined;
  });

  ipcMain.handle(IPC_CHANNELS.undoDisconnectProject, async (event) => {
    assertTrustedSender(event);
    if (!lastDisconnected) return false;
    await requireProjectRegistry().restore(lastDisconnected);
    lastDisconnected = undefined;
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.relinkProject, async (event, path: string) => {
    assertTrustedSender(event);
    if (!mainWindow) return null;
    const entries = await requireProjectRegistry().list();
    if (!entries.some((entry) => entry.path === path)) throw new Error("PROJECT_DIRECTORY_NOT_REGISTERED");

    const selection = await dialog.showOpenDialog(mainWindow, {
      title: "이동한 프로젝트 디렉터리 다시 지정",
      buttonLabel: "이 디렉터리 선택",
      properties: ["openDirectory"],
    });
    const selectedPath = selection.filePaths[0];
    if (selection.canceled || !selectedPath) return null;

    const canonical = await requireProjectRegistry().relink(
      path,
      await realpath(selectedPath),
      new Date().toISOString(),
    );
    selectedProjectRoots.add(canonical);
    return { name: basename(canonical), path: canonical } satisfies SelectedDirectory;
  });

  ipcMain.handle(IPC_CHANNELS.measureAnalysisData, async (event, path: string) => {
    assertTrustedSender(event);
    try {
      return await measureAnalysisData(await authorizeRegisteredRoot(path));
    } catch {
      return null;
    }
  });

  /* 되돌릴 수 없는 삭제다. 등록된 프로젝트인지 다시 확인하고, 그 프로젝트의
   * 분석이 진행 중이면 거절한다. 원본 소스코드는 건드리지 않는다. */
  ipcMain.handle(IPC_CHANNELS.deleteAnalysisData, async (event, path: string) => {
    assertTrustedSender(event);
    const canonical = await authorizeRegisteredRoot(path);
    if (orchestrator.isAnalysisRunning(canonical)) throw new Error("ANALYSIS_ALREADY_RUNNING");
    await deleteAnalysisData(canonical);
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.getAnalysisState, async (event, project: SelectedDirectory): Promise<AnalysisStateSummary | null> => {
    assertTrustedSender(event);
    if (!project.path) throw new Error("프로젝트 경로가 필요합니다.");
    const projectRoot = await requireSelectedProjectRoot(project.path);
    const state = await orchestrator.restoreProject(projectRoot);
    return state ? summarizeGenerationCheckpoint(state) : null;
  });

  ipcMain.handle(IPC_CHANNELS.selectProjectDirectory, async (event) => {
    assertTrustedSender(event);
    if (!mainWindow) return null;

    const selection = await dialog.showOpenDialog(mainWindow, {
      title: "ScenarioForge 분석 프로젝트 선택",
      buttonLabel: "이 디렉터리 선택",
      properties: ["openDirectory", "createDirectory"],
    });

    const selectedPath = selection.filePaths[0];
    if (selection.canceled || !selectedPath) return null;

    const canonical = await realpath(selectedPath);
    await requireProjectRegistry().add(canonical, new Date().toISOString());
    selectedProjectRoots.add(canonical);
    return {
      name: basename(canonical),
      path: canonical,
    } satisfies SelectedDirectory;
  });

  ipcMain.handle(
    IPC_CHANNELS.saveModelSettings,
    async (event, settings: ModelSettingsWithSecret) => {
      assertTrustedSender(event);
      orchestrator.saveModelSettings(settings);
      const { apiKey: _apiKey, reviewerApiKey: _reviewerApiKey, ...withoutSecrets } = settings;
      visionModelSettings = withoutSecrets;
      await requireCredentialStore().save(settings, {
        ...(settings.apiKey ? { author: settings.apiKey } : {}),
        ...(settings.reviewerApiKey ? { reviewer: settings.reviewerApiKey } : {}),
      });
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.getModelCredentialStatus,
    async (event, settings: ModelSettings): Promise<ModelCredentialStatus> => {
      assertTrustedSender(event);
      const store = requireCredentialStore();
      try {
        const status = await store.status(settings);
        const secrets = await store.load(settings);
        orchestrator.restoreModelCredentials(settings, secrets);
        const available = orchestrator.modelCredentialStatus(settings);
        if (available.hasAuthorCredential && (!settings.reviewer || available.hasReviewerCredential)) {
          orchestrator.saveModelSettings(settings);
        }
        return { storageAvailable: status.storageAvailable, ...available };
      } catch {
        orchestrator.clearModelCredentials();
        return { storageAvailable: safeStorage.isEncryptionAvailable(), hasAuthorCredential: false, hasReviewerCredential: false };
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.clearModelCredentials,
    async (event) => {
      assertTrustedSender(event);
      await requireCredentialStore().clear();
      orchestrator.clearModelCredentials();
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.startAnalysis,
    async (event, project: SelectedDirectory, mode: AnalysisStartMode) => {
      assertTrustedSender(event);
      if (!project.path) throw new Error("프로젝트 경로가 필요합니다.");
      if (mode !== "new" && mode !== "continue") throw new Error("ANALYSIS_START_MODE_INVALID");
      const projectRoot = await requireSelectedProjectRoot(project.path);
      const startedAt = Date.now();
      /* orchestrator 와 Pi SDK 오류는 provider 응답 본문과 stack trace 를 달고
       * 온다. 분류된 코드 하나로 좁혀서 던진다 - 원문이 IPC 를 건너가지 않게
       * 하는 경계다. */
      let result;
      try {
        result = await orchestrator.startAnalysis(projectRoot, mode, (progress) => mainWindow?.webContents.send(IPC_CHANNELS.analysisProgress, progress));
      } catch (error) {
        throw toAnalysisFailure(error);
      }
      const summary = summarizeGenerationStageResult(result);
      return {
        analysisRunId: result.analysisRunId,
        stage: result.stage,
        ...summary,
        durationMs: Date.now() - startedAt,
      };
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.loadScenarioResult,
    async (event, project: SelectedDirectory, runId: string) => {
      assertTrustedSender(event);
      if (!project.path || !/^[a-zA-Z0-9_-]+$/.test(runId)) return null;

      const projectRoot = await requireSelectedProjectRoot(project.path);
      const resultPath = resolve(
        projectRoot,
        ".scenarioforge",
        "runs",
        runId,
        "scenario-set.json",
      );
      if (!resultPath.startsWith(`${projectRoot}${sep}`)) return null;

      try {
        const result: unknown = await loadScenarioView(projectRoot, runId);
        return isScenarioResult(result) ? result : null;
      } catch {
        return null;
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.askScenarioQuestion,
    async (event, question: ScenarioQuestion) => {
      assertTrustedSender(event);
      if (!question.project.path || !/^[a-zA-Z0-9_-]+$/.test(question.runId)) {
        return "질의할 run 을 확인할 수 없습니다.";
      }
      const projectRoot = await requireSelectedProjectRoot(question.project.path);
      try {
        /* 답변은 정본 run 을 읽는 tool 의 결과로만 만든다. 실패 사유 원문은
         * 흘리지 않는다. */
        return await answerScenarioQuestion({
          projectRoot,
          runId: question.runId,
          scenarioIds: question.scenarioIds,
          question: question.question,
        });
      } catch {
        return "정본 시나리오 정보 셋을 읽지 못했습니다. 생성 이력에서 run 상태를 확인하세요.";
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.getTestExecutionRequirements,
    async (event, request: TestExecutionRequirementsRequest) => {
      assertTrustedSender(event);
      if (!request.project.path || !/^[a-zA-Z0-9_-]+$/.test(request.runId)) return null;
      if (!Array.isArray(request.scenarioIds) || request.scenarioIds.length === 0) return null;

      const projectRoot = await requireSelectedProjectRoot(request.project.path);
      try {
        return await loadTestExecutionRequirements(
          projectRoot,
          request.runId,
          request.scenarioIds,
          request.providedBindingKeys ?? [],
        );
      } catch {
        // 정본 검증 실패는 폼을 만들지 않는다. 부분 결과를 돌려주지 않는다.
        return null;
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.readStepEvidence,
    async (event, request: StepEvidenceRequest) => {
      assertTrustedSender(event);
      if (!request.project.path || !/^[a-zA-Z0-9_-]+$/.test(request.runId)) return null;
      const projectRoot = await requireSelectedProjectRoot(request.project.path);
      try {
        return await loadStepEvidence({ ...request, projectRoot });
      } catch {
        return null;
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.readEvidenceFrame,
    async (event, request: EvidenceFrameRequest) => {
      assertTrustedSender(event);
      if (!request.project.path || !/^[a-zA-Z0-9_-]+$/.test(request.runId)) return null;
      const projectRoot = await requireSelectedProjectRoot(request.project.path);
      try {
        return await loadEvidenceFrame({ ...request, projectRoot });
      } catch {
        return null;
      }
    },
  );

  /* enqueue 와 retry 는 create 와 같은 검증을 거친다. 다른 점은
   * enqueue 가 기존 execution 의 target profile 을 그대로 써야 한다는 것뿐이다.
   * target profile hash 는 renderer 가 주지 않고 main 이 정본에서 읽는다. */
  async function prepareCommand(
    request: TestExecutionRequest,
  ): Promise<
    | { outcome: "rejected"; stage: "request" | "environment" | "planning"; code: string; detail?: string; scenarioIds?: string[] }
    | { outcome: "ready"; projectRoot: string; source: Awaited<ReturnType<typeof loadExecutionPlan>>; secretByKey: Map<string, boolean> }
  > {
    if (!request.project.path || !/^[a-zA-Z0-9_-]+$/.test(request.runId)) {
      return { outcome: "rejected", stage: "request", code: "PROJECT_OR_RUN_INVALID" };
    }
    const projectRoot = await requireSelectedProjectRoot(request.project.path);
    let source;
    try {
      source = await loadExecutionPlan(projectRoot, request.runId, request.scenarioIds, Object.keys(request.dataBindings ?? {}));
    } catch (error) {
      return { outcome: "rejected", stage: "request", code: error instanceof Error ? error.message : "REQUIREMENTS_UNAVAILABLE" };
    }
    const rejection = validateExecutionCommand({ requirements: source.requirements, request });
    if (rejection) return { outcome: "rejected", ...rejection };
    if (source.plans.length === 0) return { outcome: "rejected", stage: "planning", code: "NO_RUNNABLE_SCENARIO" };
    return {
      outcome: "ready",
      projectRoot,
      source,
      secretByKey: new Map(source.requirements.dataBindings.map((field) => [field.bindingKey, field.secret])),
    };
  }

  const coordinatorInput = (
    request: TestExecutionRequest,
    prepared: Extract<Awaited<ReturnType<typeof prepareCommand>>, { outcome: "ready" }>,
  ) => ({
    projectRoot: prepared.projectRoot,
    runId: request.runId,
    projectId: request.project.name,
    operationId: request.operationId,
    sourceSnapshotId: prepared.source.sourceSnapshotId,
    scenarioArtifactHash: prepared.source.scenarioArtifactHash,
    factArtifactHash: prepared.source.factArtifactHash,
    target: {
      kind: "web" as const,
      entryUrl: request.targetUrl,
      maskElementRefs: request.maskElementRefs,
      destructiveAllowed: request.destructiveAllowed,
    },
    dataBindingKeys: Object.keys(request.dataBindings ?? {}).map((bindingKey) => ({
      bindingKey,
      secret: prepared.secretByKey.get(bindingKey) ?? true,
    })),
    plans: prepared.source.plans,
    createdAt: new Date().toISOString(),
  });

  ipcMain.handle(
    IPC_CHANNELS.enqueueScenarioTests,
    async (event, request: TestExecutionRequest & { executionId: string }): Promise<TestExecutionAcceptance> => {
      assertTrustedSender(event);
      const prepared = await prepareCommand(request);
      if (prepared.outcome === "rejected") return prepared;
      try {
        const manifest = JSON.parse(
          await readFile(
            join(executionRoot(prepared.projectRoot, request.runId, request.executionId), "manifest.json"),
            "utf8",
          ),
        ) as { targetProfileHash: string };
        const queued = await new TestCoordinator().enqueueScenarios({
          ...coordinatorInput(request, prepared),
          executionId: request.executionId,
          targetProfileHash: manifest.targetProfileHash,
        });
        return { outcome: "queued", executionId: queued.executionId, batchId: queued.batchId };
      } catch (error) {
        return { outcome: "rejected", stage: "planning", code: error instanceof Error ? error.message : "ENQUEUE_FAILED" };
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.retryScenarioTests,
    async (event, request: TestExecutionRequest & { retryOfExecutionId: string }): Promise<TestExecutionAcceptance> => {
      assertTrustedSender(event);
      const prepared = await prepareCommand(request);
      if (prepared.outcome === "rejected") return prepared;
      try {
        const queued = await new TestCoordinator().retryCases({
          ...coordinatorInput(request, prepared),
          retryOfExecutionId: request.retryOfExecutionId,
        });
        return { outcome: "queued", executionId: queued.executionId, batchId: queued.batchId };
      } catch (error) {
        return { outcome: "rejected", stage: "planning", code: error instanceof Error ? error.message : "RETRY_FAILED" };
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.listEvidenceLibrary,
    async (event, project: SelectedDirectory, runId?: string) => {
      assertTrustedSender(event);
      if (!project.path) return null;
      if (runId !== undefined && !/^[a-zA-Z0-9_-]+$/.test(runId)) return null;
      const projectRoot = await requireSelectedProjectRoot(project.path);
      try {
        return await loadEvidenceLibrary(projectRoot, runId);
      } catch {
        return null;
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.listStepReviews,
    async (event, request: StepReviewListRequest) => {
      assertTrustedSender(event);
      if (!request.project.path || !/^[a-zA-Z0-9_-]+$/.test(request.runId)) return [];
      const projectRoot = await requireSelectedProjectRoot(request.project.path);
      try {
        return await new ReviewStore(projectRoot, request.runId, request.executionId).list(
          request.scenarioId,
          request.stepId,
        );
      } catch {
        return [];
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.addStepReview,
    async (event, request: StepReviewRequest) => {
      assertTrustedSender(event);
      if (!request.project.path || !/^[a-zA-Z0-9_-]+$/.test(request.runId)) return null;
      const projectRoot = await requireSelectedProjectRoot(request.project.path);
      try {
        return await new ReviewStore(projectRoot, request.runId, request.executionId).append({
          scenarioId: request.scenarioId,
          stepId: request.stepId,
          decision: request.decision,
          ...(request.causeTag ? { causeTag: request.causeTag } : {}),
          note: request.note,
          author: request.author,
          at: new Date().toISOString(),
        });
      } catch {
        return null;
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.runQueuedExecution,
    async (event, request: TestExecutionRunRequest): Promise<TestExecutionRunResult> => {
      assertTrustedSender(event);
      if (!request.project.path || !/^[a-zA-Z0-9_-]+$/.test(request.runId)) {
        return { outcome: "rejected", code: "PROJECT_OR_RUN_INVALID" };
      }
      const projectRoot = await requireSelectedProjectRoot(request.project.path);

      const settings = visionModelSettings;
      if (!settings || settings.provider !== "azure-openai" || !settings.apiVersion) {
        return { outcome: "rejected", code: "VISION_MODEL_BINDING_UNAVAILABLE" };
      }
      const secrets = await requireCredentialStore().load(settings);
      if (!secrets.author) return { outcome: "rejected", code: "MODEL_CREDENTIAL_UNAVAILABLE" };
      const authorSecret = secrets.author;

      let facts;
      try {
        facts = (await loadCanonicalRun(projectRoot, request.runId)).facts;
      } catch (error) {
        return { outcome: "rejected", code: error instanceof Error ? error.message : "CANONICAL_RUN_UNAVAILABLE" };
      }

      const cancel = watchCancelRequest({ projectRoot, runId: request.runId, executionId: request.executionId });
      try {
        const result = await runQueuedExecution({
          projectRoot,
          runId: request.runId,
          executionId: request.executionId,
          screens: facts.screens,
          values: request.dataBindings ?? {},
          isCancelled: cancel.isCancelled,
          models: createVisionModels({
            binding: { endpoint: settings.endpoint, modelId: settings.model, apiVersion: settings.apiVersion },
            transport: createAzureVisionTransport(() => authorSecret),
          }),
          onStep: (progress) => {
            // 진행 상태는 backend event 로만 전달한다. renderer 가 추정하지 않는다.
            event.sender.send(IPC_CHANNELS.testExecutionProgress, { executionId: request.executionId, ...progress });
          },
        });
        return { outcome: "completed", executionId: request.executionId, runtimeStatus: result.runtimeStatus };
      } catch (error) {
        return { outcome: "rejected", code: error instanceof Error ? error.message : "EXECUTION_FAILED" };
      } finally {
        cancel.stop();
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.cancelScenarioTests,
    async (event, request: TestExecutionCommandRequest) => {
      assertTrustedSender(event);
      if (!request.project.path || !/^[a-zA-Z0-9_-]+$/.test(request.runId)) return;
      const projectRoot = await requireSelectedProjectRoot(request.project.path);
      await new TestCoordinator().cancelExecution({
        projectRoot,
        runId: request.runId,
        executionId: request.executionId,
        requestedAt: new Date().toISOString(),
      });
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.listTestExecutions,
    async (event, project: SelectedDirectory, runId?: string) => {
      assertTrustedSender(event);
      if (!project.path) return [];
      if (runId !== undefined && !/^[a-zA-Z0-9_-]+$/.test(runId)) return [];
      const projectRoot = await requireSelectedProjectRoot(project.path);
      try {
        return await loadTestExecutions(projectRoot, runId);
      } catch {
        return [];
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.startScenarioTests,
    async (event, request: TestExecutionRequest): Promise<TestExecutionAcceptance> => {
      assertTrustedSender(event);
      if (!request.project.path || !/^[a-zA-Z0-9_-]+$/.test(request.runId)) {
        return { outcome: "rejected", stage: "request", code: "PROJECT_OR_RUN_INVALID" };
      }

      const projectRoot = await requireSelectedProjectRoot(request.project.path);
      let source;
      try {
        source = await loadExecutionPlan(
          projectRoot,
          request.runId,
          request.scenarioIds,
          Object.keys(request.dataBindings ?? {}),
        );
      } catch (error) {
        return {
          outcome: "rejected",
          stage: "request",
          code: error instanceof Error ? error.message : "REQUIREMENTS_UNAVAILABLE",
        };
      }

      const rejection = validateExecutionCommand({ requirements: source.requirements, request });
      if (rejection) return { outcome: "rejected", ...rejection };
      if (source.plans.length === 0) {
        return { outcome: "rejected", stage: "planning", code: "NO_RUNNABLE_SCENARIO" };
      }

      /* 대기열 등록. batch artifact 가 durable 하게 기록된 뒤에만 queued 를 돌려준다.
       * 원문 데이터 값은 coordinator 에 넘기지 않는다. key 와 secret 여부만 넘긴다. */
      const secretByKey = new Map(source.requirements.dataBindings.map((field) => [field.bindingKey, field.secret]));
      try {
        const queued = await new TestCoordinator().createExecution({
          projectRoot,
          runId: request.runId,
          projectId: request.project.name,
          operationId: request.operationId,
          sourceSnapshotId: source.sourceSnapshotId,
          scenarioArtifactHash: source.scenarioArtifactHash,
          factArtifactHash: source.factArtifactHash,
          target: {
            kind: "web",
            entryUrl: request.targetUrl,
            maskElementRefs: request.maskElementRefs,
            destructiveAllowed: request.destructiveAllowed,
          },
          dataBindingKeys: Object.keys(request.dataBindings ?? {}).map((bindingKey) => ({
            bindingKey,
            secret: secretByKey.get(bindingKey) ?? true,
          })),
          plans: source.plans,
          createdAt: new Date().toISOString(),
        });
        return { outcome: "queued", executionId: queued.executionId, batchId: queued.batchId };
      } catch (error) {
        return {
          outcome: "rejected",
          stage: "planning",
          code: error instanceof Error ? error.message : "QUEUE_COMMIT_FAILED",
        };
      }
    },
  );
}

/* 앱 아이콘. `resources/brand` 의 브랜드 마크가 정본이고 앱 안의 `i-forge`
 * 글리프와 같은 원천이다. 패키징 설정이 아직 없으므로 소스 트리에서 읽는다.
 * 아이콘 하나 때문에 앱이 못 뜨면 안 되므로 실패는 조용히 넘긴다. */
function brandIcon() {
  const image = nativeImage.createFromPath(
    join(mainDirectory, "../../resources/brand/png/icon-512.png"),
  );
  return image.isEmpty() ? undefined : image;
}

const PREVIEW_MODES = new Set([
  "modal",
  "workspace",
  "progress",
  "result",
  "result-selected",
  "test-running",
  "test-failed",
  "evidence-library",
  "evidence-failure",
  "demo",
]);

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 1024,
    minWidth: 960,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#f9f7f7",
    title: "ScenarioForge",
    /* macOS 는 창 아이콘을 쓰지 않는다. dock 아이콘은 whenReady 에서 세운다. */
    ...(process.platform === "darwin"
      ? { titleBarStyle: "hiddenInset" as const }
      : (() => {
          const icon = brandIcon();
          return icon ? { icon } : {};
        })()),
    webPreferences: {
      preload: join(mainDirectory, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event) => event.preventDefault());
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  /* 시연·스크린샷용 fixture 화면. 기본값은 꺼짐이고, 알려진 모드 이름만
   * 통과시킨다. renderer 는 이 값이 있을 때 표본 데이터임을 화면에 표시한다. */
  const preview = PREVIEW_MODES.has(process.env.SCENARIOFORGE_PREVIEW ?? "")
    ? process.env.SCENARIOFORGE_PREVIEW!
    : undefined;

  if (process.env.ELECTRON_RENDERER_URL) {
    const url = new URL(process.env.ELECTRON_RENDERER_URL);
    if (preview) url.searchParams.set("preview", preview);
    void mainWindow.loadURL(url.toString());
  } else {
    void mainWindow.loadFile(
      join(mainDirectory, "../renderer/index.html"),
      preview ? { query: { preview } } : {},
    );
  }
}

registerIpcHandlers();

void app.whenReady().then(() => {
  credentialStore = new ModelCredentialStore(
    join(app.getPath("userData"), "model-credentials.v1.json"),
    safeStorage,
  );
  /* v1 문서를 그대로 읽어 첫 항목으로 옮긴다. 파일 이름을 유지해 기존 설치가
   * 프로젝트를 잃지 않게 한다. */
  projectRegistry = new ProjectRegistry(
    join(app.getPath("userData"), "project-directory.v1.json"),
  );
  if (process.platform === "win32") {
    app.setAppUserModelId("com.scenarioforge.desktop");
  }
  /* 패키징하지 않고 실행하면 dock 에 Electron 기본 아이콘이 뜬다. */
  if (process.platform === "darwin") {
    const icon = brandIcon();
    if (icon) app.dock?.setIcon(icon);
  }

  const headlessProject = process.env.SCENARIOFORGE_HEADLESS_PROJECT;
  if (headlessProject) {
    const settings: ModelSettings = {
      provider: "azure-openai",
      endpoint: "https://skax.ai-talentlab.com",
      model: "gpt-5.6-luna",
      apiVersion: "2024-12-01-preview",
      dataPolicyAccepted: true,
    };
    void (async () => {
      try {
        const projectRoot = await realpath(resolve(headlessProject));
        const secrets = await requireCredentialStore().load(settings);
        if (!secrets.author) throw new Error("MODEL_CREDENTIAL_NOT_AVAILABLE");
        orchestrator.restoreModelCredentials(settings, secrets);
        orchestrator.saveModelSettings(settings);
        const mode = process.env.SCENARIOFORGE_HEADLESS_MODE === "continue" ? "continue" : "new";
        const requestedStopStep = process.env.SCENARIOFORGE_HEADLESS_STOP_AFTER_STEP;
        if (requestedStopStep && !GENERATION_STEPS.includes(requestedStopStep as (typeof GENERATION_STEPS)[number])) throw new Error("HEADLESS_STOP_STEP_INVALID");
        const stopAfterStep = requestedStopStep as (typeof GENERATION_STEPS)[number] | undefined ?? "coverage-manifest";
        const result = await orchestrator.startAnalysis(projectRoot, mode, (event) => {
          process.stdout.write(`${JSON.stringify({ stage: event.stage, step: event.step, status: event.stepStatus ?? event.planningStatus, progress: event.progress })}\n`);
        }, stopAfterStep);
        process.stdout.write(`${JSON.stringify({ outcome: "completed", analysisRunId: result.analysisRunId, stage: result.stage, step: result.step })}\n`);
      } catch (error) {
        const code = error instanceof Error ? error.message.match(/^([A-Z][A-Z0-9_:-]*)/)?.[1] ?? "HEADLESS_ANALYSIS_FAILED" : "HEADLESS_ANALYSIS_FAILED";
        process.stderr.write(`${JSON.stringify({ outcome: "failed", code })}\n`);
        process.exitCode = 1;
      } finally {
        app.quit();
      }
    })();
    return;
  }

  createMainWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
