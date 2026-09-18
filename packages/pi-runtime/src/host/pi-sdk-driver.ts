import { join } from "node:path";
import {
  createAgentSession,
  SessionManager,
  SettingsManager,
  type AgentSession,
  type ModelRuntime,
  type RetrySettings,
  type ResourceLoader as PiResourceLoader,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { PiSessionDriver, SessionCreateInput, SessionHandle, StructuredPrompt } from "./pi-runtime-host.js";

export type RestoredSessionMetadata = SessionCreateInput & { sessionFile: string };

type PromptSession = {
  messages: unknown[];
  prompt: (text: string) => Promise<void>;
};

export function createGenerationSettingsManager(retry: RetrySettings = { enabled: false }): SettingsManager {
  return SettingsManager.inMemory({ retry });
}

export function createPiSessionManager(input: { cwd: string; sessionDir?: string; persistence?: "durable" | "memory" }): SessionManager {
  return input.persistence === "memory"
    ? SessionManager.inMemory(input.cwd)
    : SessionManager.create(input.cwd, input.sessionDir);
}

export async function promptWithFailurePropagation(session: PromptSession, text: string): Promise<void> {
  const firstNewMessage = session.messages.length;
  await session.prompt(text);
  const newMessages = session.messages.slice(firstNewMessage);
  for (let index = newMessages.length - 1; index >= 0; index -= 1) {
    const message = newMessages[index];
    if (!message || typeof message !== "object" || (message as { role?: unknown }).role !== "assistant") continue;
    const assistant = message as { stopReason?: unknown; errorMessage?: unknown };
    if (assistant.stopReason === "error") throw new Error(typeof assistant.errorMessage === "string" && assistant.errorMessage.trim() ? assistant.errorMessage : "PI_MODEL_ERROR");
    return;
  }
}

export class PiSdkDriver implements PiSessionDriver {
  private readonly sessions = new Map<string, AgentSession>();
  private readonly unsubscribers = new Map<string, () => void>();

  constructor(
    private readonly modelRuntime: ModelRuntime,
    private readonly resourceLoaderFor: (input: SessionCreateInput) => Promise<PiResourceLoader>,
    private readonly sessionMetadataFor: (sessionId: string) => RestoredSessionMetadata,
    private readonly onRawEvent: (sessionId: string, event: unknown) => void | Promise<void>,
    private readonly customToolsFor: (input: SessionCreateInput) => ToolDefinition[] = () => [],
  ) {}

  async create(input: SessionCreateInput): Promise<SessionHandle> {
    const binding = input.models.find((model) => model.role === (input.modelRole ?? "author"));
    if (!binding) throw new Error("MODEL_ROLE_BINDING_NOT_FOUND");
    const model = this.modelRuntime.getModel(binding.provider, binding.modelId);
    if (!model) throw new Error("PI_MODEL_NOT_FOUND");
    const resourceLoader = await this.resourceLoaderFor(input);
    const sessionDir = input.sessionDir ?? join(input.cwd, ".scenarioforge", "sessions", input.source === "analysis" ? "analysis" : input.source === "scenario-chat" ? "chat" : "test-planning");
    const { session } = await createAgentSession({
      cwd: input.cwd,
      agentDir: input.agentDir,
      modelRuntime: this.modelRuntime,
      model,
      resourceLoader,
      sessionManager: createPiSessionManager({ cwd: input.cwd, sessionDir, persistence: input.sessionPersistence }),
      settingsManager: createGenerationSettingsManager(input.retrySettings),
      noTools: "builtin",
      customTools: this.customToolsFor(input),
    });
    this.register(session);
    return { sessionId: session.sessionId, sessionFile: session.sessionFile };
  }

  async restore(sessionId: string): Promise<SessionHandle> {
    const metadata = this.sessionMetadataFor(sessionId);
    if (metadata.sessionPersistence === "memory") throw new Error("PI_SESSION_NOT_PERSISTED");
    const binding = metadata.models.find((entry) => entry.role === (metadata.modelRole ?? "author"));
    if (!binding) throw new Error("MODEL_ROLE_BINDING_NOT_FOUND");
    const model = this.modelRuntime.getModel(binding.provider, binding.modelId);
    if (!model) throw new Error("PI_MODEL_NOT_FOUND");
    const { sessionFile, ...input } = metadata;
    const resourceLoader = await this.resourceLoaderFor(input);
    const { session } = await createAgentSession({ cwd: metadata.cwd, agentDir: metadata.agentDir, modelRuntime: this.modelRuntime, model, resourceLoader, sessionManager: SessionManager.open(sessionFile, metadata.sessionDir, metadata.cwd), settingsManager: createGenerationSettingsManager(metadata.retrySettings), noTools: "builtin", customTools: this.customToolsFor(input) });
    this.register(session);
    return { sessionId: session.sessionId, sessionFile: session.sessionFile };
  }

  async prompt(sessionId: string, input: StructuredPrompt): Promise<void> { await promptWithFailurePropagation(this.requireSession(sessionId), input.text); }
  async abort(sessionId: string): Promise<void> { await this.requireSession(sessionId).abort(); }
  async compact(sessionId: string): Promise<void> { await this.requireSession(sessionId).compact(); }
  async dispose(sessionId: string): Promise<void> { this.unsubscribers.get(sessionId)?.(); this.unsubscribers.delete(sessionId); this.requireSession(sessionId).dispose(); this.sessions.delete(sessionId); }

  private register(session: AgentSession): void {
    const unsubscribe = session.subscribe((event) => { void this.onRawEvent(session.sessionId, event); });
    this.sessions.set(session.sessionId, session);
    this.unsubscribers.set(session.sessionId, unsubscribe);
  }

  private requireSession(sessionId: string): AgentSession {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Unknown Pi session: ${sessionId}`);
    return session;
  }
}
