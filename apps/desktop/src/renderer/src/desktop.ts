import { createDemoScenarioResult, type ScenarioResult } from "./scenario-result";
import type { HumanReviewView, StepEvidenceView } from "../../shared/evidence";
import type { EvidenceLibraryView } from "../../shared/evidence-library";
import type { TestExecution } from "../../shared/test-execution";
import type { TestExecutionRequirements } from "../../shared/test-requirements";
import type {
  AnalysisProgressEvent,
  AnalysisRunSummary,
  AnalysisStartMode,
  AnalysisStateSummary,
  ModelCredentialStatus,
  ModelSettings,
  ModelSettingsWithSecret,
  AnalysisDataMeasure,
  ProjectSummary,
  RunSummary,
  ScenarioForgeDesktopApi,
  ScenarioQuestion,
  SelectedDirectory,
  TestExecutionAcceptance,
  TestExecutionRequest,
  TestExecutionRequirementsRequest,
  TestExecutionRunRequest,
  TestExecutionRunResult,
  TestExecutionCommandRequest,
  TestExecutionProgressEvent,
  StepEvidenceRequest,
  EvidenceFrameRequest,
  StepReviewListRequest,
  StepReviewRequest,
} from "../../shared/desktop-api";

export type {
  AnalysisProgressEvent,
  AnalysisRunSummary,
  AnalysisStartMode,
  AnalysisStateSummary,
  ModelCredentialStatus,
  ModelSettings,
  ModelSettingsWithSecret,
  ScenarioQuestion,
  SelectedDirectory,
  TestExecutionAcceptance,
  TestExecutionRequest,
  TestExecutionRequirementsRequest,
  TestExecutionRunRequest,
  TestExecutionRunResult,
  TestExecutionCommandRequest,
  TestExecutionProgressEvent,
  StepEvidenceRequest,
  EvidenceFrameRequest,
  StepReviewListRequest,
  StepReviewRequest,
  AnalysisDataMeasure,
  ProjectSummary,
  RunSummary,
} from "../../shared/desktop-api";

declare global {
  interface Window {
    scenarioForge?: ScenarioForgeDesktopApi;
    showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>;
  }
}

/* fixture preview 는 backend 를 쓰지 않는다. preload 가 있어도 IPC 를 타지
 * 않게 막아, 표본 화면이 정본 상태를 읽거나 실행 명령을 보내지 않도록 한다. */
const isPreview = (): boolean => {
  const search = typeof window !== "undefined" ? window.location?.search : undefined;
  return typeof search === "string" && new URLSearchParams(search).has("preview");
};

function getDesktopApi(): ScenarioForgeDesktopApi | undefined {
  if (isPreview()) return undefined;
  if (window.scenarioForge) return window.scenarioForge;

  if (typeof navigator !== "undefined" && /\bElectron\//.test(navigator.userAgent)) {
    throw new Error(
      "ELECTRON_BRIDGE_UNAVAILABLE: 데스크톱 연결을 초기화하지 못했습니다. 앱을 다시 시작해 주세요.",
    );
  }

  return undefined;
}

export async function saveModelSettings(
  settings: ModelSettingsWithSecret,
): Promise<void> {
  const desktopApi = getDesktopApi();
  if (desktopApi) {
    await desktopApi.saveModelSettings(settings);
  }
}

export async function getModelCredentialStatus(
  settings: ModelSettings,
): Promise<ModelCredentialStatus> {
  const desktopApi = getDesktopApi();
  if (desktopApi) return desktopApi.getModelCredentialStatus(settings);
  return { storageAvailable: false, hasAuthorCredential: false, hasReviewerCredential: false };
}

export async function clearModelCredentials(): Promise<void> {
  const desktopApi = getDesktopApi();
  if (desktopApi) await desktopApi.clearModelCredentials();
}

/* 프로젝트 목록. 데스크톱 브리지가 없으면(브라우저 preview) 빈 목록이다.
 * fixture 프로젝트를 만들어 실제 목록처럼 흘리지 않는다. */
export async function listProjects(): Promise<ProjectSummary[]> {
  return (await getDesktopApi()?.listProjects()) ?? [];
}

/* 생성 이력. 데스크톱 브리지가 없으면 빈 목록이다. */
export async function listRuns(project: SelectedDirectory): Promise<RunSummary[]> {
  return (await getDesktopApi()?.listRuns(project)) ?? [];
}

export async function openProject(path: string): Promise<SelectedDirectory | null> {
  return (await getDesktopApi()?.openProject(path)) ?? null;
}

export async function revealProject(path: string): Promise<boolean> {
  return (await getDesktopApi()?.revealProject(path)) ?? false;
}

export async function disconnectProject(path: string): Promise<boolean> {
  return (await getDesktopApi()?.disconnectProject(path)) ?? false;
}

export async function undoDisconnectProject(): Promise<boolean> {
  return (await getDesktopApi()?.undoDisconnectProject()) ?? false;
}

export async function relinkProject(path: string): Promise<SelectedDirectory | null> {
  return (await getDesktopApi()?.relinkProject(path)) ?? null;
}

export async function measureAnalysisData(path: string): Promise<AnalysisDataMeasure | null> {
  return (await getDesktopApi()?.measureAnalysisData(path)) ?? null;
}

export async function deleteAnalysisData(path: string): Promise<boolean> {
  return (await getDesktopApi()?.deleteAnalysisData(path)) ?? false;
}

export async function startProjectAnalysis(
  project: SelectedDirectory,
  mode: AnalysisStartMode = "new",
): Promise<AnalysisRunSummary> {
  const desktopApi = getDesktopApi();
  if (desktopApi) {
    return desktopApi.startAnalysis(project, mode);
  }
  return { analysisRunId: crypto.randomUUID(), stage: "scenario", completed: true, progress: 100, factCount: 428, wikiPages: 36, scenarios: 24, durationMs: 13_000 };
}

export async function getProjectAnalysisState(
  project: SelectedDirectory,
): Promise<AnalysisStateSummary | null> {
  const desktopApi = getDesktopApi();
  if (desktopApi) return desktopApi.getAnalysisState(project);
  return null;
}

export function onProjectAnalysisProgress(listener: (event: AnalysisProgressEvent) => void): () => void {
  return getDesktopApi()?.onAnalysisProgress(listener) ?? (() => undefined);
}

export async function loadScenarioResult(
  project: SelectedDirectory,
  runId: string,
): Promise<ScenarioResult | null> {
  const desktopApi = getDesktopApi();
  if (desktopApi) {
    return desktopApi.loadScenarioResult(project, runId);
  }
  return createDemoScenarioResult(runId);
}

export async function askScenarioQuestion(
  question: ScenarioQuestion,
): Promise<string> {
  const desktopApi = getDesktopApi();
  if (desktopApi) {
    return desktopApi.askScenarioQuestion(question);
  }
  const target = question.scenarioIds.length
    ? question.scenarioIds.map((id) => `\`${id}\``).join(", ")
    : "현재 시나리오 정보 셋";
  return `${target}의 전제 조건과 세부 스텝을 기준으로 확인했습니다. 질문하신 항목은 기대 결과와 원천 코드까지 함께 비교할 수 있습니다.`;
}

/* 요구사항은 main 이 정본 artifact 에서 도출한다. renderer 는 필드 목록을 정하지 않는다.
 * 브라우저 프로토타입에는 정본이 없으므로 null 이며, 화면은 그때 폼을 만들지 않는다. */
export async function getTestExecutionRequirements(
  request: TestExecutionRequirementsRequest,
): Promise<TestExecutionRequirements | null> {
  const desktopApi = getDesktopApi();
  if (!desktopApi) return null;
  return desktopApi.getTestExecutionRequirements(request);
}

export async function startScenarioTests(
  request: TestExecutionRequest,
): Promise<TestExecutionAcceptance> {
  const desktopApi = getDesktopApi();
  if (desktopApi) {
    return desktopApi.startScenarioTests(request);
  }
  // 브라우저 프로토타입에는 수행 backend 가 없다. 성공처럼 보이게 하지 않는다.
  return { outcome: "rejected", stage: "request", code: "DESKTOP_BRIDGE_UNAVAILABLE" };
}

/* 실행 상태는 main 이 정본 실행 산출물에서 투영한다.
 * 데스크톱 브리지가 없으면 빈 목록이며, 화면은 fixture 로 채우지 않는다. */
export async function listTestExecutions(
  project: SelectedDirectory,
  runId?: string,
): Promise<TestExecution[]> {
  const desktopApi = getDesktopApi();
  if (!desktopApi) return [];
  return desktopApi.listTestExecutions(project, runId);
}

/* 실행 구동과 중단은 main 이 소유한다. renderer 는 의도만 전달한다. */
export async function runQueuedExecution(
  request: TestExecutionRunRequest,
): Promise<TestExecutionRunResult> {
  const desktopApi = getDesktopApi();
  if (!desktopApi) return { outcome: "rejected", code: "DESKTOP_BRIDGE_UNAVAILABLE" };
  return desktopApi.runQueuedExecution(request);
}

export async function enqueueScenarioTests(
  request: TestExecutionRequest & { executionId: string },
): Promise<TestExecutionAcceptance> {
  const desktopApi = getDesktopApi();
  if (!desktopApi) return { outcome: "rejected", stage: "request", code: "DESKTOP_BRIDGE_UNAVAILABLE" };
  return desktopApi.enqueueScenarioTests(request);
}

export async function retryScenarioTests(
  request: TestExecutionRequest & { retryOfExecutionId: string },
): Promise<TestExecutionAcceptance> {
  const desktopApi = getDesktopApi();
  if (!desktopApi) return { outcome: "rejected", stage: "request", code: "DESKTOP_BRIDGE_UNAVAILABLE" };
  return desktopApi.retryScenarioTests(request);
}

export async function cancelScenarioTests(request: TestExecutionCommandRequest): Promise<void> {
  const desktopApi = getDesktopApi();
  if (!desktopApi) return;
  await desktopApi.cancelScenarioTests(request);
}

export function onTestExecutionProgress(
  listener: (event: TestExecutionProgressEvent) => void,
): () => void {
  const desktopApi = getDesktopApi();
  if (!desktopApi) return () => undefined;
  return desktopApi.onTestExecutionProgress(listener);
}

/* 증적은 main 이 정본 실행 트리에서만 읽는다. renderer 는 파일을 열지 않는다. */
export async function readStepEvidence(request: StepEvidenceRequest): Promise<StepEvidenceView | null> {
  const desktopApi = getDesktopApi();
  if (!desktopApi) return null;
  return desktopApi.readStepEvidence(request);
}

export async function readEvidenceFrame(request: EvidenceFrameRequest): Promise<string | null> {
  const desktopApi = getDesktopApi();
  if (!desktopApi) return null;
  return desktopApi.readEvidenceFrame(request);
}

export async function listStepReviews(request: StepReviewListRequest): Promise<HumanReviewView[]> {
  const desktopApi = getDesktopApi();
  if (!desktopApi) return [];
  return desktopApi.listStepReviews(request);
}

export async function addStepReview(request: StepReviewRequest): Promise<HumanReviewView | null> {
  const desktopApi = getDesktopApi();
  if (!desktopApi) return null;
  return desktopApi.addStepReview(request);
}

export async function listEvidenceLibrary(
  project: SelectedDirectory,
  runId?: string,
): Promise<EvidenceLibraryView | null> {
  const desktopApi = getDesktopApi();
  if (!desktopApi) return null;
  return desktopApi.listEvidenceLibrary(project, runId);
}

export async function selectProjectDirectory(): Promise<SelectedDirectory | null> {
  const desktopApi = getDesktopApi();
  if (desktopApi) {
    return desktopApi.selectProjectDirectory();
  }

  if (window.showDirectoryPicker) {
    const directory = await window.showDirectoryPicker();
    return { name: directory.name };
  }

  return { name: "scenarioforge-sample" };
}

export async function restoreProjectDirectory(): Promise<SelectedDirectory | null> {
  const desktopApi = getDesktopApi();
  if (desktopApi) return desktopApi.restoreProjectDirectory();
  return null;
}
