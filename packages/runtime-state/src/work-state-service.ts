import { randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { GenerationStep, GenerationWorkRole, ProjectRuntimeState, WorkContext, WorkDescriptor, WorkMutationCommand, WorkStateMutation } from "@scenarioforge/contracts";
import { JournalRepository, type RuntimeCheckpoint } from "./journal-repository.js";
import { reduceState, StateInvariantError, type StateCommand, type StateCommit } from "./reducer.js";
import { hashWorkStateMarkdown, renderWorkStateMarkdown } from "./work-state-markdown.js";

type Listener = (commit: StateCommit) => void | Promise<void>;

class ProjectQueue {
  private readonly tails = new Map<string, Promise<unknown>>();

  async run<T>(projectId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(projectId) ?? Promise.resolve();
    const current = previous.then(task, task);
    this.tails.set(projectId, current);
    try {
      return await current;
    } finally {
      if (this.tails.get(projectId) === current) this.tails.delete(projectId);
    }
  }
}

export class RuntimeStateCoordinator {
  private state: ProjectRuntimeState;
  private readonly queue = new ProjectQueue();
  private readonly listeners = new Set<Listener>();

  constructor(initialState: ProjectRuntimeState, private readonly repository: JournalRepository) {
    this.state = initialState;
  }

  getState(): ProjectRuntimeState {
    return structuredClone(this.state);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async commit(command: StateCommand): Promise<StateCommit & { workStateHash: string }> {
    return this.queue.run(command.projectId, async () => {
      const result = reduceState(this.state, command);
      const checkpoint: RuntimeCheckpoint = {
        checkpointId: randomUUID(),
        revision: result.state.revision,
        sessionId: result.state.sessionId,
        analysisRunId: result.state.analysisRunId,
        activeStage: result.state.activeStage,
        activeStep: result.state.activeStep,
        artifactHashes: Object.fromEntries(Object.values(result.state.artifacts).map((a) => [a.artifactId, a.contentHash])),
      };
      await this.repository.append({
        previousRevision: this.state.revision,
        revision: result.state.revision,
        state: result.state,
        checkpoint,
        event: result.event,
      });
      this.state = result.state;
      const markdown = renderWorkStateMarkdown(this.state);
      const path = join(this.repository.stateRoot, "WORK_STATE.md");
      await mkdir(dirname(path), { recursive: true });
      const temporary = `${path}.${randomUUID()}.tmp`;
      await writeFile(temporary, markdown, "utf8");
      await rename(temporary, path);
      await Promise.allSettled([...this.listeners].map((listener) => listener(result)));
      return { ...result, workStateHash: hashWorkStateMarkdown(markdown) };
    });
  }
}

type BeginRequest = {
  projectId: string;
  workId: string;
  operationId: string;
  expectedRevision: number;
  contextToken: string;
};

export class WorkStateService {
  private readonly contextTokens = new Map<string, { projectId: string; workId: string; revision: number }>();

  constructor(private readonly coordinator: RuntimeStateCoordinator) {}

  getState(): ProjectRuntimeState {
    return this.coordinator.getState();
  }

  async register(descriptor: WorkDescriptor, operationId: string = randomUUID()): Promise<StateCommit> {
    return this.coordinator.commit({ type: "work.register", projectId: descriptor.projectId, operationId, expectedRevision: descriptor.expectedRevision, descriptor });
  }

  async getContext(projectId: string, workId: string): Promise<WorkContext> {
    const state = this.coordinator.getState();
    if (state.projectId !== projectId) throw new StateInvariantError("PROJECT_ID_MISMATCH");
    const descriptor = state.works[workId];
    if (!descriptor) throw new StateInvariantError("WORK_NOT_FOUND");
    const contextToken = randomUUID();
    this.contextTokens.set(contextToken, { projectId, workId, revision: state.revision });
    return { projectId, sessionId: descriptor.sessionId, workId, revision: state.revision, contextToken, descriptor, allowedActions: ["begin"] };
  }

  async begin(request: BeginRequest): Promise<StateCommit> {
    if (!request.contextToken) throw new StateInvariantError("CONTEXT_REQUIRED");
    const context = this.contextTokens.get(request.contextToken);
    if (!context) throw new StateInvariantError("INVALID_CONTEXT_TOKEN");
    this.contextTokens.delete(request.contextToken);
    if (context.projectId !== request.projectId || context.workId !== request.workId || context.revision !== request.expectedRevision) {
      throw new StateInvariantError("CONTEXT_MISMATCH");
    }
    return this.coordinator.commit({ type: "work.begin", ...request });
  }

  async mutate(command: WorkMutationCommand): Promise<StateCommit> {
    return this.coordinator.commit({ type: "work.mutate", ...command });
  }

  async transitionStepRole(request: { projectId: string; step: GenerationStep; role: GenerationWorkRole; operationId?: string }): Promise<StateCommit> {
    const state = this.coordinator.getState();
    return this.coordinator.commit({ type: "analysis.step.role", ...request, operationId: request.operationId ?? randomUUID(), expectedRevision: state.revision });
  }

  async settle(request: { projectId: string; workId: string; operationId?: string }): Promise<StateCommit> {
    const state = this.coordinator.getState();
    return this.coordinator.commit({ type: "work.settle", ...request, operationId: request.operationId ?? randomUUID(), expectedRevision: state.revision });
  }

  async discardDraftArtifact(request: Omit<WorkMutationCommand, "sessionId" | "mutation" | "operationId"> & { artifactId: string; reason: string; operationId?: string }): Promise<StateCommit> {
    const state = this.coordinator.getState();
    const work = state.works[request.workId];
    if (!work) throw new StateInvariantError("WORK_NOT_FOUND");
    const mutation: WorkStateMutation = { op: "tombstone-draft", artifactId: request.artifactId, reason: request.reason };
    return this.mutate({ ...request, sessionId: work.sessionId, operationId: request.operationId ?? randomUUID(), mutation });
  }

  async releaseCheckpointedArtifacts(request: Omit<WorkMutationCommand, "sessionId" | "mutation" | "operationId"> & { artifactIds: string[]; operationId?: string }): Promise<StateCommit> {
    const state = this.coordinator.getState();
    const work = state.works[request.workId];
    if (!work) throw new StateInvariantError("WORK_NOT_FOUND");
    const mutation: WorkStateMutation = { op: "release-checkpointed-artifacts", artifactIds: request.artifactIds };
    return this.mutate({ ...request, sessionId: work.sessionId, operationId: request.operationId ?? randomUUID(), mutation });
  }

  async releaseCheckpointedWork(request: Omit<WorkMutationCommand, "sessionId" | "mutation" | "operationId"> & { operationId?: string }): Promise<StateCommit> {
    const state = this.coordinator.getState();
    const work = state.works[request.workId];
    if (!work) throw new StateInvariantError("WORK_NOT_FOUND");
    return this.mutate({ ...request, sessionId: work.sessionId, operationId: request.operationId ?? randomUUID(), mutation: { op: "release-checkpointed-work" } });
  }
}
