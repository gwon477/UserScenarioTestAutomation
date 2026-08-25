import { contextBridge, ipcRenderer } from "electron";
import {
  IPC_CHANNELS,
  type AnalysisProgressEvent,
  type ModelSettingsWithSecret,
  type ScenarioForgeDesktopApi,
  type ScenarioQuestion,
  type SelectedDirectory,
  type TestExecutionRequest,
} from "../shared/desktop-api";

const desktopApi: ScenarioForgeDesktopApi = {
  selectProjectDirectory: () =>
    ipcRenderer.invoke(IPC_CHANNELS.selectProjectDirectory) as Promise<SelectedDirectory | null>,
  saveModelSettings: (settings: ModelSettingsWithSecret) =>
    ipcRenderer.invoke(IPC_CHANNELS.saveModelSettings, settings),
  startAnalysis: (project: SelectedDirectory) =>
    ipcRenderer.invoke(IPC_CHANNELS.startAnalysis, project),
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
  startScenarioTests: (request: TestExecutionRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.startScenarioTests, request),
};

contextBridge.exposeInMainWorld("scenarioForge", desktopApi);
