import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearModelCredentials,
  getProjectAnalysisState,
  getModelCredentialStatus,
  loadScenarioResult,
  restoreProjectDirectory,
  saveModelSettings,
  startProjectAnalysis,
} from "./desktop";

const modelSettings = {
  provider: "azure-openai" as const,
  endpoint: "https://example.test",
  model: "gpt-5.6-luna",
  apiVersion: "2024-12-01-preview",
  dataPolicyAccepted: true,
};

function simulateElectronWithoutPreloadBridge() {
  vi.stubGlobal("window", { scenarioForge: undefined });
  vi.stubGlobal("navigator", { userAgent: "Electron/44.0.0" });
}

describe("Electron desktop bridge", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not silently discard model settings when preload is unavailable", async () => {
    simulateElectronWithoutPreloadBridge();

    await expect(saveModelSettings({
      provider: "azure-openai",
      endpoint: "https://example.test",
      model: "gpt-5.6-luna",
      apiVersion: "2024-12-01-preview",
      dataPolicyAccepted: true,
      apiKey: "secret",
    })).rejects.toThrow("ELECTRON_BRIDGE_UNAVAILABLE");
  });

  it("does not return a demo analysis when preload is unavailable", async () => {
    simulateElectronWithoutPreloadBridge();

    await expect(startProjectAnalysis({ name: "real-project", path: "/real-project" }))
      .rejects.toThrow("ELECTRON_BRIDGE_UNAVAILABLE");
  });

  it("forwards an explicit new-run intent across the preload boundary", async () => {
    const startAnalysis = vi.fn().mockResolvedValue({ analysisRunId: "RUN-fresh", stage: "src", completed: false, progress: 25, factCount: 0, wikiPages: 0, scenarios: 0, durationMs: 1 });
    vi.stubGlobal("window", { scenarioForge: { startAnalysis } });
    const project = { name: "real-project", path: "/real-project" };

    await startProjectAnalysis(project, "new");

    expect(startAnalysis).toHaveBeenCalledWith(project, "new");
  });

  it("restores the canonical stage checkpoint instead of inferring it from renderer memory", async () => {
    const checkpoint = { analysisRunId: "RUN-current", progress: 20, nextStage: "fact" as const, nextStep: "edge-ledger" as const, canContinue: true, completed: false };
    const getAnalysisState = vi.fn().mockResolvedValue(checkpoint);
    vi.stubGlobal("window", { scenarioForge: { getAnalysisState } });
    const project = { name: "real-project", path: "/real-project" };

    await expect(getProjectAnalysisState(project)).resolves.toEqual(checkpoint);
    expect(getAnalysisState).toHaveBeenCalledWith(project);
  });

  it("does not return demo scenarios when preload is unavailable", async () => {
    simulateElectronWithoutPreloadBridge();

    await expect(loadScenarioResult(
      { name: "real-project", path: "/real-project" },
      "RUN-actual",
    )).rejects.toThrow("ELECTRON_BRIDGE_UNAVAILABLE");
  });

  it("does not fabricate cached credential status when preload is unavailable", async () => {
    simulateElectronWithoutPreloadBridge();

    await expect(getModelCredentialStatus(modelSettings)).rejects.toThrow("ELECTRON_BRIDGE_UNAVAILABLE");
  });

  it("does not silently accept credential clearing when preload is unavailable", async () => {
    simulateElectronWithoutPreloadBridge();

    await expect(clearModelCredentials()).rejects.toThrow("ELECTRON_BRIDGE_UNAVAILABLE");
  });

  it("does not trust renderer storage when project restore bridge is unavailable", async () => {
    simulateElectronWithoutPreloadBridge();

    await expect(restoreProjectDirectory()).rejects.toThrow("ELECTRON_BRIDGE_UNAVAILABLE");
  });
});

/* fixture preview 는 backend 를 쓰지 않는다. preload 가 붙어 있어도 표본 화면이
 * 정본 상태를 읽거나 실행 명령을 보내면 안 된다. */
describe("fixture preview bridge", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not reach the preload bridge while previewing", async () => {
    const loadScenarioResultSpy = vi.fn();
    vi.stubGlobal("window", {
      scenarioForge: { loadScenarioResult: loadScenarioResultSpy },
      location: { search: "?preview=demo" },
    });
    vi.stubGlobal("navigator", { userAgent: "Electron/44.0.0" });

    const result = await loadScenarioResult({ name: "RA-DAR", path: "/RA-DAR" }, "RUN-preview-02");

    expect(loadScenarioResultSpy).not.toHaveBeenCalled();
    expect(result?.runId).toBe("RUN-preview-02");
  });

  it("still uses the preload bridge on a normal launch", async () => {
    const loadScenarioResultSpy = vi.fn().mockResolvedValue(null);
    vi.stubGlobal("window", {
      scenarioForge: { loadScenarioResult: loadScenarioResultSpy },
      location: { search: "" },
    });
    vi.stubGlobal("navigator", { userAgent: "Electron/44.0.0" });

    await loadScenarioResult({ name: "RA-DAR", path: "/RA-DAR" }, "RUN-1");

    expect(loadScenarioResultSpy).toHaveBeenCalledOnce();
  });
});
