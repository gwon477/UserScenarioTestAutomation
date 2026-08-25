import { createDemoScenarioResult, type ScenarioResult } from "./scenario-result";
import type {
  AnalysisProgressEvent,
  ModelSettings,
  ModelSettingsWithSecret,
  ScenarioForgeDesktopApi,
  ScenarioQuestion,
  SelectedDirectory,
  TestExecutionRequest,
} from "../../shared/desktop-api";

export type {
  AnalysisProgressEvent,
  ModelSettings,
  ModelSettingsWithSecret,
  ScenarioQuestion,
  SelectedDirectory,
  TestExecutionRequest,
} from "../../shared/desktop-api";

declare global {
  interface Window {
    scenarioForge?: ScenarioForgeDesktopApi;
    showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>;
  }
}

export async function saveModelSettings(
  settings: ModelSettingsWithSecret,
): Promise<void> {
  if (window.scenarioForge) {
    await window.scenarioForge.saveModelSettings(settings);
  }
}

export async function startProjectAnalysis(
  project: SelectedDirectory,
): Promise<void> {
  if (window.scenarioForge) {
    await window.scenarioForge.startAnalysis(project);
  }
}

export async function loadScenarioResult(
  project: SelectedDirectory,
  runId: string,
): Promise<ScenarioResult | null> {
  if (window.scenarioForge) {
    return window.scenarioForge.loadScenarioResult(project, runId);
  }
  return createDemoScenarioResult(runId);
}

export async function askScenarioQuestion(
  question: ScenarioQuestion,
): Promise<string> {
  if (window.scenarioForge) {
    return window.scenarioForge.askScenarioQuestion(question);
  }
  const target = question.scenarioIds.length
    ? question.scenarioIds.map((id) => `\`${id}\``).join(", ")
    : "현재 시나리오 정보 셋";
  return `${target}의 전제 조건과 세부 스텝을 기준으로 확인했습니다. 질문하신 항목은 기대 결과와 원천 코드까지 함께 비교할 수 있습니다.`;
}

export async function startScenarioTests(
  request: TestExecutionRequest,
): Promise<void> {
  if (window.scenarioForge) {
    await window.scenarioForge.startScenarioTests(request);
  }
}

export async function selectProjectDirectory(): Promise<SelectedDirectory | null> {
  if (window.scenarioForge) {
    return window.scenarioForge.selectProjectDirectory();
  }

  if (window.showDirectoryPicker) {
    const directory = await window.showDirectoryPicker();
    return { name: directory.name };
  }

  return { name: "scenarioforge-sample" };
}
