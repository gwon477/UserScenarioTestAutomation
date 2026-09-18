import { randomUUID } from "node:crypto";
import type { ArtifactSubmission, ChildWorkDescriptor, DomainError, VerifiableActivity, WorkMutationCommand } from "@scenarioforge/contracts";
import type { WorkStateService } from "@scenarioforge/runtime-state";

export const workStateToolNames = [
  "work.getContext",
  "work.begin",
  "work.requestChild",
  "work.updateProgress",
  "work.recordActivity",
  "work.submitArtifacts",
  "work.discardDraft",
  "work.reportFailure",
  "work.requestCompletion",
] as const;

export type WorkStateToolName = (typeof workStateToolNames)[number];
export type WorkToolDefinition = { name: WorkStateToolName; inputKeys: readonly string[]; invoke(input: Record<string, unknown>): Promise<unknown> };
export type WorkToolScope = { projectId: string; sessionId: string; workId: string };

const string = (input: Record<string, unknown>, key: string): string => {
  const value = input[key];
  if (typeof value !== "string" || !value.trim()) throw new Error(`INVALID_${key.toUpperCase()}`);
  return value;
};
const revision = (input: Record<string, unknown>): number => {
  const value = input.expectedRevision;
  if (!Number.isInteger(value) || (value as number) < 0) throw new Error("INVALID_EXPECTED_REVISION");
  return value as number;
};
const base = (input: Record<string, unknown>) => ({ projectId: string(input, "projectId"), sessionId: string(input, "sessionId"), workId: string(input, "workId"), operationId: typeof input.operationId === "string" ? input.operationId : randomUUID(), expectedRevision: revision(input) });

export function createWorkStateTools(service: WorkStateService, scope?: WorkToolScope, resolveScope?: () => WorkToolScope | undefined): readonly WorkToolDefinition[] {
  const scoped = (input: Record<string, unknown>): Record<string, unknown> => {
    const currentScope = resolveScope?.() ?? scope;
    if (!currentScope) return input;
    for (const [key, expected] of Object.entries(currentScope)) {
      if (input[key] !== undefined && input[key] !== expected) throw new Error("WORK_SCOPE_VIOLATION");
    }
    return { ...input, ...currentScope };
  };
  const mutate = (input: Record<string, unknown>, mutation: WorkMutationCommand["mutation"]) => service.mutate({ ...base(input), mutation });
  return [
    { name: "work.getContext", inputKeys: ["projectId", "workId"], invoke: (raw) => { const input = scoped(raw); return service.getContext(string(input, "projectId"), string(input, "workId")); } },
    { name: "work.begin", inputKeys: ["projectId", "workId", "operationId", "expectedRevision", "contextToken"], invoke: (raw) => { const input = scoped(raw); return service.begin({ projectId: string(input, "projectId"), workId: string(input, "workId"), operationId: typeof input.operationId === "string" ? input.operationId : randomUUID(), expectedRevision: revision(input), contextToken: string(input, "contextToken") }); } },
    { name: "work.requestChild", inputKeys: ["projectId", "sessionId", "workId", "operationId", "expectedRevision", "descriptor"], invoke: (raw) => { const input = scoped(raw); return mutate(input, { op: "add-child", descriptor: input.descriptor as ChildWorkDescriptor }); } },
    { name: "work.updateProgress", inputKeys: ["projectId", "sessionId", "workId", "operationId", "expectedRevision", "progress", "currentActivity"], invoke: (raw) => { const input = scoped(raw); return mutate(input, { op: "update-progress", patch: { workId: string(input, "workId"), progress: Number(input.progress), currentActivity: typeof input.currentActivity === "string" ? input.currentActivity : undefined } }); } },
    { name: "work.recordActivity", inputKeys: ["projectId", "sessionId", "workId", "operationId", "expectedRevision", "activity"], invoke: (raw) => { const input = scoped(raw); return mutate(input, { op: "record-activity", activity: input.activity as VerifiableActivity }); } },
    { name: "work.submitArtifacts", inputKeys: ["projectId", "sessionId", "workId", "operationId", "expectedRevision", "artifacts"], invoke: (raw) => { const input = scoped(raw); return mutate(input, { op: "submit-artifacts", artifacts: input.artifacts as ArtifactSubmission[] }); } },
    { name: "work.discardDraft", inputKeys: ["projectId", "sessionId", "workId", "operationId", "expectedRevision", "artifactId", "reason"], invoke: (raw) => { const input = scoped(raw); return mutate(input, { op: "tombstone-draft", artifactId: string(input, "artifactId"), reason: string(input, "reason") }); } },
    { name: "work.reportFailure", inputKeys: ["projectId", "sessionId", "workId", "operationId", "expectedRevision", "error"], invoke: (raw) => { const input = scoped(raw); return mutate(input, { op: "report-failure", error: input.error as DomainError }); } },
    { name: "work.requestCompletion", inputKeys: ["projectId", "sessionId", "workId", "operationId", "expectedRevision"], invoke: (raw) => { const input = scoped(raw); return mutate(input, { op: "request-completion" }); } },
  ];
}
