import { describe, expect, it } from "vitest";
import type { ModelSettingsWithSecret } from "../../shared/desktop-api";
import { ApplicationOrchestrator, analysisRetryProgress } from "./application-orchestrator";

const azureSettings: ModelSettingsWithSecret = {
  provider: "azure-openai",
  endpoint: "https://skax.ai-talentlab.com",
  model: "gpt-5.6-luna",
  apiVersion: "2024-12-01-preview",
  dataPolicyAccepted: true,
};

describe("application model role settings", () => {
  it("maps retry metadata to a sanitized stage progress message", () => {
    expect(analysisRetryProgress({ stage: "fact", role: "reviewer", category: "provider-rate-limit", attempt: 1, delayMs: 60_000 })).toEqual({
      stage: "fact",
      progress: 25,
      message: "FACT 단계: 요청 한도 회복 대기 (60초 후 재시도)",
    });
  });

  it("rejects Azure OpenAI settings without an API version", () => {
    const orchestrator = new ApplicationOrchestrator();
    expect(() => orchestrator.saveModelSettings({ provider: "azure-openai", endpoint: "https://skax.ai-talentlab.com", model: "gpt-4.1", dataPolicyAccepted: true, apiKey: "session-key" } as never)).toThrow("AZURE_OPENAI_API_VERSION_REQUIRED");
  });

  it("rejects credentials embedded in a model endpoint", () => {
    const orchestrator = new ApplicationOrchestrator();
    expect(() => orchestrator.saveModelSettings({ provider: "custom", endpoint: "https://user:secret@example.com/v1", model: "author", dataPolicyAccepted: true, apiKey: "session-key" })).toThrow("MODEL_ENDPOINT_CREDENTIAL_FORBIDDEN");
  });

  it("requires a separate reviewer session credential when reviewer is enabled", () => {
    const orchestrator = new ApplicationOrchestrator();
    expect(() => orchestrator.saveModelSettings({ provider: "custom", endpoint: "https://author.example.com/v1", model: "author", dataPolicyAccepted: true, apiKey: "author-key", reviewer: { provider: "custom", endpoint: "https://reviewer.example.com/v1", model: "reviewer", dataPolicyAccepted: true } })).toThrow("REVIEWER_MODEL_CREDENTIAL_REQUIRED");
  });

  it("reuses a session credential only for the same provider endpoint identity", () => {
    const orchestrator = new ApplicationOrchestrator();
    orchestrator.saveModelSettings({ ...azureSettings, apiKey: "session-key" });

    expect(() => orchestrator.saveModelSettings({ ...azureSettings, model: "another-deployment" })).not.toThrow();
    expect(() => orchestrator.saveModelSettings({ ...azureSettings, endpoint: "https://other.example.test" }))
      .toThrow("MODEL_CREDENTIAL_REQUIRED");
  });

  it("clears in-memory model credentials", () => {
    const orchestrator = new ApplicationOrchestrator();
    orchestrator.saveModelSettings({ ...azureSettings, apiKey: "session-key" });

    orchestrator.clearModelCredentials();

    expect(() => orchestrator.saveModelSettings(azureSettings)).toThrow("MODEL_CREDENTIAL_REQUIRED");
  });

  it("hydrates role credentials from the secure cache without exposing them as settings", () => {
    const orchestrator = new ApplicationOrchestrator();
    const reviewer = { ...azureSettings, endpoint: "https://reviewer.example.test" };
    const withReviewer = { ...azureSettings, reviewer };

    orchestrator.restoreModelCredentials(withReviewer, { author: "cached-author" });

    expect(() => orchestrator.saveModelSettings({ ...withReviewer, reviewerApiKey: "new-reviewer" })).not.toThrow();
  });
});
