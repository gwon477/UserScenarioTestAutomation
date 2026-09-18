import { contextBridge, ipcRenderer } from "electron";
import {
  IPC_CHANNELS,
  type AnalysisDataMeasure,
  type AnalysisProgressEvent,
  type AnalysisStartMode,
  type AnalysisStateSummary,
  type ProjectSummary,
  type RunSummary,
  type ModelSettings,
  type ModelSettingsWithSecret,
  type ScenarioForgeDesktopApi,
  type ScenarioQuestion,
  type SelectedDirectory,
  type TestExecutionRequest,
  type TestExecutionRequirementsRequest,
  type TestExecutionRunRequest,
  type TestExecutionCommandRequest,
  type TestExecutionProgressEvent,
  type StepEvidenceRequest,
  type EvidenceFrameRequest,
  type StepReviewListRequest,
  type StepReviewRequest,
} from "../shared/desktop-api";

const desktopApi: ScenarioForgeDesktopApi = {
  selectProjectDirectory: () =>
    ipcRenderer.invoke(IPC_CHANNELS.selectProjectDirectory) as Promise<SelectedDirectory | null>,
  restoreProjectDirectory: () =>
    ipcRenderer.invoke(IPC_CHANNELS.restoreProjectDirectory) as Promise<SelectedDirectory | null>,
  listProjects: () => ipcRenderer.invoke(IPC_CHANNELS.listProjects) as Promise<ProjectSummary[]>,
  listRuns: (project: SelectedDirectory) =>
    ipcRenderer.invoke(IPC_CHANNELS.listRuns, project) as Promise<RunSummary[]>,
  openProject: (path: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.openProject, path) as Promise<SelectedDirectory | null>,
  revealProject: (path: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.revealProject, path) as Promise<boolean>,
  disconnectProject: (path: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.disconnectProject, path) as Promise<boolean>,
  undoDisconnectProject: () =>
    ipcRenderer.invoke(IPC_CHANNELS.undoDisconnectProject) as Promise<boolean>,
  relinkProject: (path: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.relinkProject, path) as Promise<SelectedDirectory | null>,
  measureAnalysisData: (path: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.measureAnalysisData, path) as Promise<AnalysisDataMeasure | null>,
  deleteAnalysisData: (path: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.deleteAnalysisData, path) as Promise<boolean>,
  getAnalysisState: (project: SelectedDirectory) =>
    ipcRenderer.invoke(IPC_CHANNELS.getAnalysisState, project) as Promise<AnalysisStateSummary | null>,
  saveModelSettings: (settings: ModelSettingsWithSecret) =>
    ipcRenderer.invoke(IPC_CHANNELS.saveModelSettings, settings),
  getModelCredentialStatus: (settings: ModelSettings) =>
    ipcRenderer.invoke(IPC_CHANNELS.getModelCredentialStatus, settings),
  clearModelCredentials: () =>
    ipcRenderer.invoke(IPC_CHANNELS.clearModelCredentials),
  startAnalysis: (project: SelectedDirectory, mode: AnalysisStartMode) =>
    ipcRenderer.invoke(IPC_CHANNELS.startAnalysis, project, mode),
  onAnalysisProgress: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: AnalysisProgressEvent) => {
      listener(progress);
    };
    ipcRenderer.on(IPC_CHANNELS.analysisProgress, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.analysisProgress, handler);
  },
  loadScenarioResult: (project: SelectedDirectory, runId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.loadScenarioResult, project, runId),
  askScenarioQuestion: (question: ScenarioQuestion) =>
    ipcRenderer.invoke(IPC_CHANNELS.askScenarioQuestion, question),
  getTestExecutionRequirements: (request: TestExecutionRequirementsRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.getTestExecutionRequirements, request),
  startScenarioTests: (request: TestExecutionRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.startScenarioTests, request),
  listTestExecutions: (project: SelectedDirectory, runId?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.listTestExecutions, project, runId),
  runQueuedExecution: (request: TestExecutionRunRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.runQueuedExecution, request),
  enqueueScenarioTests: (request: TestExecutionRequest & { executionId: string }) =>
    ipcRenderer.invoke(IPC_CHANNELS.enqueueScenarioTests, request),
  retryScenarioTests: (request: TestExecutionRequest & { retryOfExecutionId: string }) =>
    ipcRenderer.invoke(IPC_CHANNELS.retryScenarioTests, request),
  cancelScenarioTests: (request: TestExecutionCommandRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.cancelScenarioTests, request),
  readStepEvidence: (request: StepEvidenceRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.readStepEvidence, request),
  readEvidenceFrame: (request: EvidenceFrameRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.readEvidenceFrame, request),
  listStepReviews: (request: StepReviewListRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.listStepReviews, request),
  addStepReview: (request: StepReviewRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.addStepReview, request),
  listEvidenceLibrary: (project: SelectedDirectory, runId?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.listEvidenceLibrary, project, runId),
  onTestExecutionProgress: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: TestExecutionProgressEvent) => {
      listener(progress);
    };
    ipcRenderer.on(IPC_CHANNELS.testExecutionProgress, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.testExecutionProgress, handler);
  },
};

contextBridge.exposeInMainWorld("scenarioForge", desktopApi);
