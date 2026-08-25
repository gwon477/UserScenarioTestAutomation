import type { ScenarioResult } from "./scenario";

export const IPC_CHANNELS = {
  selectProjectDirectory: "project:select-directory",
  saveModelSettings: "settings:save-model",
  startAnalysis: "analysis:start",
  analysisProgress: "analysis:progress",
  loadScenarioResult: "scenario:load-result",
  askScenarioQuestion: "scenario:ask-question",
  startScenarioTests: "test:start",
} as const;

export type SelectedDirectory = {
  name: string;
  path?: string;
};

export type ModelSettings = {
  provider: "openai-compatible" | "anthropic" | "custom";
  endpoint: string;
  model: string;
};

export type ModelSettingsWithSecret = ModelSettings & {
  apiKey?: string;
};

export type AnalysisProgressEvent = {
  stage: "src" | "fact" | "wiki" | "scenario";
  progress: number;
  message: string;
};

export type ScenarioQuestion = {
  project: SelectedDirectory;
  runId: string;
  scenarioIds: string[];
  question: string;
};

export type TestExecutionRequest = {
  project: SelectedDirectory;
  runId: string;
  scenarioIds: string[];
  targetUrl: string;
  personalData: Record<string, unknown>;
};

export type ScenarioForgeDesktopApi = {
  selectProjectDirectory: () => Promise<SelectedDirectory | null>;
  saveModelSettings: (settings: ModelSettingsWithSecret) => Promise<void>;
  startAnalysis: (project: SelectedDirectory) => Promise<void>;
  onAnalysisProgress: (
    listener: (event: AnalysisProgressEvent) => void,
  ) => () => void;
  loadScenarioResult: (
    project: SelectedDirectory,
    runId: string,
  ) => Promise<ScenarioResult | null>;
  askScenarioQuestion: (question: ScenarioQuestion) => Promise<string>;
  startScenarioTests: (request: TestExecutionRequest) => Promise<void>;
};
