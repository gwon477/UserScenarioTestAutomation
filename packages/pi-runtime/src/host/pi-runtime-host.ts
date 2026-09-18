import { randomUUID } from "node:crypto";
import type { RetrySettings } from "@earendil-works/pi-coding-agent";
import type { GenerationArtifactType, GenerationStep } from "@scenarioforge/contracts";
import type { ModelBinding } from "../models/model-binding.js";
import { assertModelBinding } from "../models/model-binding.js";
import type { PiEventCandidate, PiRawEvent } from "../event-adapter/pi-event-adapter.js";
import { adaptPiEvent } from "../event-adapter/pi-event-adapter.js";
import { SessionRegistry } from "../sessions/session-registry.js";

export type SessionCreateInput = {
  projectId: string;
  workId: string;
  cwd: string;
  agentDir: string;
  source: "analysis" | "scenario-chat" | "test-planning";
  models: ModelBinding[];
  resourceProfile: "generation" | "scenario-chat" | "execution-planning";
  workKind?: string;
  stateSessionId?: string;
  modelRole?: "author" | "reviewer";
  resourceRole?: "author" | "reviewer";
  expectedArtifactId?: string;
  expectedArtifactType?: GenerationArtifactType;
  generationStep?: GenerationStep;
  allowedArtifactIds?: string[];
  sessionDir?: string;
  sessionPersistence?: "durable" | "memory";
  retrySettings?: RetrySettings;
};
export type SessionHandle = { sessionId: string; sessionFile?: string };
export type StructuredPrompt = { text: string; source: SessionCreateInput["source"] };

export interface PiSessionDriver {
  create(input: SessionCreateInput): Promise<SessionHandle>;
  restore(sessionId: string): Promise<SessionHandle>;
  prompt(sessionId: string, input: StructuredPrompt): Promise<void>;
  abort(sessionId: string): Promise<void>;
  compact(sessionId: string): Promise<void>;
  dispose(sessionId: string): Promise<void>;
}

export class FakePiSessionDriver implements PiSessionDriver {
  readonly prompts: Array<{ sessionId: string; input: StructuredPrompt }> = [];
  async create(): Promise<SessionHandle> { return { sessionId: randomUUID() }; }
  async restore(sessionId: string): Promise<SessionHandle> { return { sessionId }; }
  async prompt(sessionId: string, input: StructuredPrompt): Promise<void> { this.prompts.push({ sessionId, input }); }
  async abort(): Promise<void> {}
  async compact(): Promise<void> {}
  async dispose(): Promise<void> {}
}

export class PiRuntimeHost {
  private readonly sessions = new SessionRegistry();
  private readonly inputs = new Map<string, SessionCreateInput>();

  constructor(private readonly driver: PiSessionDriver, private readonly onCandidate: (candidate: PiEventCandidate) => void | Promise<void>) {}

  async create(input: SessionCreateInput): Promise<SessionHandle> {
    input.models.forEach(assertModelBinding);
    if (input.source === "analysis" && input.resourceProfile !== "generation") throw new Error("RESOURCE_PROFILE_MISMATCH");
    if (input.source === "test-planning" && input.resourceProfile !== "execution-planning") throw new Error("RESOURCE_PROFILE_MISMATCH");
    const handle = await this.driver.create(input);
    this.inputs.set(handle.sessionId, input);
    this.sessions.add({ sessionId: handle.sessionId, projectId: input.projectId, workId: input.workId, source: input.source, status: "created" });
    return handle;
  }

  async acceptRawEvent(sessionId: string, event: unknown): Promise<void> {
    const input = this.inputs.get(sessionId);
    if (!input) throw new Error("SESSION_NOT_FOUND");
    const candidate = adaptPiEvent(event, { projectId: input.projectId, sessionId, workId: input.workId });
    if (candidate) await this.onCandidate(candidate);
  }

  rebind(sessionId: string, input: SessionCreateInput): void {
    if (!this.inputs.has(sessionId)) throw new Error("SESSION_NOT_FOUND");
    this.inputs.set(sessionId, input);
  }

  prompt(sessionId: string, input: StructuredPrompt): Promise<void> { return this.driver.prompt(sessionId, input); }
  abort(sessionId: string): Promise<void> { return this.driver.abort(sessionId); }
  compact(sessionId: string): Promise<void> { return this.driver.compact(sessionId); }
  async dispose(sessionId: string): Promise<void> { await this.driver.dispose(sessionId); this.sessions.dispose(sessionId); this.inputs.delete(sessionId); }
}
