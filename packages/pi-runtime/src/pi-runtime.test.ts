import { describe, expect, it } from "vitest";
import { Type } from "@earendil-works/pi-ai";
import * as PiRuntime from "./index.js";
import { adaptPiEvent, adaptWorkToolsForPi, assertModelBinding, compactWorkToolResult, createAnalysisArtifactTool, createArtifactQueryTools, createConfiguredModelRuntime, createGenerationSettingsManager, createPiSessionManager, createStagingJsonTool, FakePiSessionDriver, PiRuntimeHost, type ModelBinding } from "./index.js";

const context = { projectId: "project-1", sessionId: "session-1", workId: "work-1", occurredAt: "2026-08-26T00:00:00.000Z" };

describe("Pi runtime isolation", () => {
  it("server-scopes the expected artifact ID instead of accepting a model-authored ID", async () => {
    const writes: Array<{ workId: string; artifactId: string; value: unknown }> = [];
    const tool = createStagingJsonTool("work-1", async (workId, artifactId, value) => {
      writes.push({ workId, artifactId, value });
      return { path: "unused", contentHash: "hash" };
    }, "FACT-RUN-canonical");

    const result = await tool.execute("call-1", { artifactId: "FACT-RUN-typo", value: { pass: true } }, undefined, undefined, {} as never);

    expect(writes).toEqual([{ workId: "work-1", artifactId: "FACT-RUN-canonical", value: { pass: true } }]);
    expect(result.details).toMatchObject({ artifactId: "FACT-RUN-canonical" });
    expect(JSON.stringify(tool.parameters)).not.toContain("artifactId");
  });

  it("reports the real path for a non-canonical analysis artifact without claiming staging submission", async () => {
    const tool = createAnalysisArtifactTool("work-1", "01-source-survey", async () => ({
      path: "docs/validation/run/01-source-survey.agent.json",
      contentHash: "sha256:artifact",
    }));

    const result = await tool.execute("call-1", { value: { stage: "source-survey" } }, undefined, undefined, {} as never);

    expect(result.details).toEqual({
      artifactId: "01-source-survey",
      path: "docs/validation/run/01-source-survey.agent.json",
      contentHash: "sha256:artifact",
      canonical: false,
    });
    expect(JSON.stringify(result.details)).not.toContain(".scenarioforge/staging");
  });

  it("allows an analysis stage to require its structured value before the write callback", () => {
    const tool = createAnalysisArtifactTool("work-1", "02-source-gap-review", async () => ({
      path: "docs/validation/run/02-source-gap-review.agent.json",
      contentHash: "sha256:artifact",
    }), Type.Object({
      stage: Type.Literal("source-gap-review"),
      additional_source_gaps: Type.Array(Type.Unknown()),
    }));

    expect(tool.parameters).toMatchObject({
      required: ["value"],
      properties: {
        value: { required: ["stage", "additional_source_gaps"] },
      },
    });
  });

  it("server-scopes artifact submission to the latest staging receipt", async () => {
    const canonicalSubmission = {
      artifactId: "FACT-RUN-canonical",
      artifactType: "fact" as const,
      stagingPath: ".scenarioforge/staging/work-1/FACT-RUN-canonical.json",
      contentHash: "a".repeat(64),
      relatedIds: [],
    };
    const received: Record<string, unknown>[] = [];
    const adapted = adaptWorkToolsForPi([{
      name: "work.submitArtifacts",
      inputKeys: [],
      async invoke(input) {
        received.push(input);
        return { state: { revision: 2 }, event: { eventType: "work.updated" } };
      },
    }], { latestArtifactSubmission: () => canonicalSubmission })[0];

    expect(JSON.stringify(adapted.parameters)).not.toContain("artifacts");
    await adapted.execute("call-submit", {
      expectedRevision: 1,
      artifacts: [{
        artifactId: "FACT-RUN-typo",
        artifactType: "fact",
        stagingPath: ".scenarioforge/staging/work-1/FACT-RUN-typo.json",
        contentHash: "b".repeat(64),
        relatedIds: ["invented"],
      }],
    } as never, undefined, undefined, {} as never);

    expect(received).toHaveLength(1);
    expect(received[0].artifacts).toEqual([canonicalSubmission]);
  });

  it("returns a compact mutation receipt instead of echoing the full runtime state to the model", () => {
    const result = compactWorkToolResult("work.begin", {
      state: {
        revision: 203,
        artifacts: { large: { payload: "x".repeat(140_000) } },
      },
      event: { eventType: "work.started" },
      workStateHash: "sha256:state",
    });

    expect(result).toEqual({
      ok: true,
      revision: 203,
      eventType: "work.started",
      workStateHash: "sha256:state",
    });
    expect(JSON.stringify(result)).not.toContain("artifacts");
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(512);
  });

  it("keeps work.getContext intact because the agent needs its one-time token", () => {
    const context = { revision: 202, contextToken: "one-time-token", allowedActions: ["begin"] };

    expect(compactWorkToolResult("work.getContext", context)).toEqual(context);
  });

  it("replaces model-supplied mutation operation IDs with unique Pi tool-call IDs", async () => {
    const receivedOperationIds: string[] = [];
    const adapted = adaptWorkToolsForPi([{
      name: "work.submitArtifacts",
      inputKeys: [],
      async invoke(input) {
        receivedOperationIds.push(String(input.operationId));
        return { state: { revision: receivedOperationIds.length }, event: { eventType: "work.updated" }, workStateHash: "sha256:state" };
      },
    }])[0];
    const modelParams = {
      projectId: "PRJ-test",
      sessionId: "SESSION-test",
      workId: "WORK-test",
      operationId: "analysis.fact-extract",
    };

    expect(adapted.parameters).not.toHaveProperty("properties.operationId");
    await adapted.execute("call-first", modelParams as never, undefined, undefined, {} as never);
    await adapted.execute("call-second", modelParams as never, undefined, undefined, {} as never);

    expect(receivedOperationIds).toHaveLength(2);
    expect(new Set(receivedOperationIds)).toHaveProperty("size", 2);
    expect(receivedOperationIds).not.toContain("analysis.fact-extract");
    expect(receivedOperationIds[0]).toContain("call-first");
    expect(receivedOperationIds[1]).toContain("call-second");
  });

  it("disables Pi automatic retry for harness-owned generation retries", () => {
    expect(createGenerationSettingsManager().getRetrySettings()).toMatchObject({ enabled: false });
  });

  it("uses an in-memory Pi session for probes that must not persist raw transcripts", () => {
    const manager = createPiSessionManager({ cwd: "/project", persistence: "memory" });
    expect(manager.isPersisted()).toBe(false);
    expect(manager.getSessionFile()).toBeUndefined();
  });

  it("allows a single bounded Pi retry owner for standalone probes", () => {
    const manager = createGenerationSettingsManager({ enabled: true, maxRetries: 2, baseDelayMs: 250, provider: { timeoutMs: 180_000, maxRetries: 2, maxRetryDelayMs: 2_000 } });
    expect(manager.getRetrySettings()).toEqual({
      enabled: true,
      maxRetries: 2,
      baseDelayMs: 250,
    });
    expect(manager.getProviderRetrySettings()).toEqual({ timeoutMs: 180_000, maxRetries: 2, maxRetryDelayMs: 2_000 });
  });

  it("propagates a terminal assistant provider error after Pi exhausts its internal retries", async () => {
    const promptWithFailurePropagation = (PiRuntime as unknown as {
      promptWithFailurePropagation?: (session: { messages: unknown[]; prompt: (text: string) => Promise<void> }, text: string) => Promise<void>;
    }).promptWithFailurePropagation;
    expect(promptWithFailurePropagation).toBeTypeOf("function");

    const session = {
      messages: [] as unknown[],
      async prompt() {
        this.messages.push({ role: "assistant", stopReason: "error", errorMessage: '429: {"code":"rate_limit_tpm"}' });
      },
    };

    await expect(promptWithFailurePropagation!(session, "review FACT")).rejects.toThrow("429");
  });

  it("requires an API version for Azure OpenAI Chat Completions", () => {
    const binding = {
      role: "author",
      provider: "scenarioforge-author",
      api: "azure-openai-chat-completions",
      modelId: "gpt-4.1",
      endpoint: "https://skax.ai-talentlab.com",
      credentialRef: "session:model:author",
      dataPolicyAccepted: true,
    } as unknown as ModelBinding;

    expect(() => assertModelBinding(binding)).toThrow("AZURE_OPENAI_API_VERSION_REQUIRED");
  });

  it("translates Azure Chat Completions authentication and API version", async () => {
    const factory = (PiRuntime as unknown as {
      createAzureOpenAIChatCompletionsFetch?: (input: {
        apiKey: string;
        apiVersion: string;
        upstreamFetch: typeof fetch;
      }) => typeof fetch;
    }).createAzureOpenAIChatCompletionsFetch;
    expect(factory).toBeTypeOf("function");

    let capturedUrl = "";
    let capturedHeaders = new Headers();
    const azureFetch = factory!({
      apiKey: "atl-session-key",
      apiVersion: "2024-12-01-preview",
      upstreamFetch: async (input, init) => {
        capturedUrl = input instanceof Request ? input.url : String(input);
        capturedHeaders = new Headers(input instanceof Request ? input.headers : init?.headers);
        return new Response("{}", { status: 200 });
      },
    });

    await azureFetch("https://skax.ai-talentlab.com/openai/deployments/gpt-4.1/chat/completions", {
      method: "POST",
      headers: { authorization: "Bearer atl-session-key", "content-type": "application/json" },
      body: "{}",
    });

    expect(capturedUrl).toBe("https://skax.ai-talentlab.com/openai/deployments/gpt-4.1/chat/completions?api-version=2024-12-01-preview");
    expect(capturedHeaders.get("api-key")).toBe("atl-session-key");
    expect(capturedHeaders.get("authorization")).toBeNull();
  });

  it("adds a stable GPT-5.6 cache namespace and an explicit breakpoint without changing tools", async () => {
    const factory = (PiRuntime as unknown as {
      createAzureOpenAIChatCompletionsFetch?: (input: {
        apiKey: string;
        apiVersion: string;
        upstreamFetch: typeof fetch;
        promptCache?: { key: string; explicit: boolean };
      }) => typeof fetch;
    }).createAzureOpenAIChatCompletionsFetch!;
    let capturedBody: Record<string, unknown> = {};
    const azureFetch = factory({
      apiKey: "atl-session-key",
      apiVersion: "2024-12-01-preview",
      promptCache: { key: "scenarioforge:author:gpt-5.6-luna:generation-v2", explicit: true },
      upstreamFetch: async (_input, init) => {
        capturedBody = JSON.parse(String(init?.body));
        return new Response("{}", { status: 200 });
      },
    });
    const tools = [{ type: "function", function: { name: "work_get", parameters: { type: "object" } } }];

    await azureFetch("https://skax.ai-talentlab.com/openai/deployments/gpt-5.6-luna/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "system", content: "stable rules" }, { role: "user", content: "dynamic work" }], tools, tool_choice: "none" }),
    });

    expect(capturedBody).toMatchObject({
      prompt_cache_key: "scenarioforge:author:gpt-5.6-luna:generation-v2",
      prompt_cache_options: { mode: "explicit", ttl: "30m" },
      tools,
      tool_choice: "none",
      messages: [{ role: "system", content: [{ type: "text", text: "stable rules", prompt_cache_breakpoint: { mode: "explicit" } }] }, { role: "user", content: "dynamic work" }],
    });
  });

  it("registers Azure deployments on the OpenAI Chat Completions transport", async () => {
    const runtime = await createConfiguredModelRuntime([{
      role: "author",
      provider: "scenarioforge-author",
      api: "azure-openai-chat-completions",
      modelId: "gpt-4.1",
      endpoint: "https://skax.ai-talentlab.com",
      apiVersion: "2024-12-01-preview",
      credentialRef: "session:model:author",
      dataPolicyAccepted: true,
    }], () => "atl-session-key");

    const model = runtime.getModel("scenarioforge-author", "gpt-4.1");
    expect(model?.api).toBe("openai-completions");
    expect(model?.baseUrl).toBe("https://skax.ai-talentlab.com/openai/deployments/gpt-4.1");
    expect(model?.reasoning).toBe(false);
    expect(runtime.getRegisteredProviderConfig("scenarioforge-author")?.streamSimple).toBeTypeOf("function");
  });

  it("maps agent_end to a settled candidate without completing a stage", () => {
    const candidate = adaptPiEvent({ type: "agent_end", messages: [] }, context);
    expect(candidate).toEqual({ kind: "session-status-candidate", status: "settled" });
    expect(JSON.stringify(candidate)).not.toContain("analysis.stage.completed");
  });

  it("drops raw message and thinking updates", () => {
    expect(adaptPiEvent({ type: "message_update", delta: "secret" }, context)).toBeNull();
    expect(adaptPiEvent({ type: "thinking_update", delta: "secret" }, context)).toBeNull();
  });

  it("keeps analysis sessions on generation resources", async () => {
    const host = new PiRuntimeHost(new FakePiSessionDriver(), () => undefined);
    await expect(host.create({
      projectId: "project-1",
      workId: "work-1",
      cwd: "/project",
      agentDir: "/project/.scenarioforge/runtime/agents/generation",
      source: "analysis",
      models: [{ role: "author", provider: "local", modelId: "model", endpoint: "http://127.0.0.1:11434", credentialRef: "keychain:model", dataPolicyAccepted: true }],
      resourceProfile: "execution-planning",
    })).rejects.toThrow("RESOURCE_PROFILE_MISMATCH");
  });

  it("rejects unbounded artifact closure requests before reaching storage", async () => {
    let called = false;
    const closure = createArtifactQueryTools({ getById: async () => null, verify: async () => null, getClosure: async () => { called = true; return null; } }).find((tool) => tool.name === "artifact.closure")!;
    await expect(Promise.resolve().then(() => closure.invoke({ sourceIds: ["SRC-1"], budget: Number.NaN }))).rejects.toThrow("INVALID_CLOSURE_REQUEST");
    expect(called).toBe(false);
  });
});
