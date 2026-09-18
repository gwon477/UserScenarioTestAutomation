import type { AgentWorkStatus, VerifiableActivity } from "@scenarioforge/contracts";

export type PiRawEvent =
  | { type: "agent_start" }
  | { type: "agent_end"; messages?: unknown[]; willRetry?: boolean }
  | { type: "agent_settled" }
  | { type: "message_update"; delta?: unknown }
  | { type: "thinking_update"; delta?: unknown }
  | { type: "compaction_start" }
  | { type: "compaction_end" }
  | { type: "abort" }
  | { type: "process_error"; message: string }
  | { type: "tool_execution_start"; toolCallId: string; toolName: string }
  | { type: "tool_execution_end"; toolCallId: string; toolName: string; isError?: boolean }
  | { type: "tool_execution_update"; toolCallId: string; toolName: string }
  | { type: "auto_retry_start"; attempt: number }
  | { type: "auto_retry_end"; success: boolean; finalError?: string };

export type PiEventContext = { projectId: string; sessionId: string; workId: string; occurredAt?: string };
export type PiEventCandidate =
  | { kind: "session-status-candidate"; status: AgentWorkStatus; error?: string }
  | { kind: "activity-candidate"; activity: VerifiableActivity };

export function adaptPiEvent(raw: unknown, context: PiEventContext): PiEventCandidate | null {
  if (!raw || typeof raw !== "object" || typeof (raw as { type?: unknown }).type !== "string") return null;
  const event = raw as PiRawEvent;
  if (["message_update", "thinking_update", "message_start", "message_end", "turn_start", "turn_end", "tool_execution_update", "queue_update", "entry_appended"].includes(event.type)) return null;
  if (event.type === "agent_end") return { kind: "session-status-candidate", status: event.willRetry ? "retrying" : "settled" };
  if (event.type === "agent_settled") return { kind: "session-status-candidate", status: "settled" };
  if (event.type === "agent_start") return { kind: "session-status-candidate", status: "running" };
  if (event.type === "compaction_start") return { kind: "session-status-candidate", status: "compacting" };
  if (event.type === "compaction_end") return { kind: "session-status-candidate", status: "running" };
  if (event.type === "abort") return { kind: "session-status-candidate", status: "settled" };
  if (event.type === "process_error") return { kind: "session-status-candidate", status: "failed", error: event.message };
  if (event.type === "auto_retry_start") return { kind: "session-status-candidate", status: "retrying" };
  if (event.type === "auto_retry_end") return { kind: "session-status-candidate", status: event.success ? "running" : "failed", error: event.finalError };
  if (event.type !== "tool_execution_start" && event.type !== "tool_execution_end") return null;
  return {
    kind: "activity-candidate",
    activity: {
      activityId: event.toolCallId,
      projectId: context.projectId,
      sessionId: context.sessionId,
      workId: context.workId,
      kind: "tool",
      name: event.toolName,
      status: event.type === "tool_execution_start" ? "running" : event.isError ? "failed" : "succeeded",
      ...(event.type === "tool_execution_start"
        ? { startedAt: context.occurredAt ?? new Date().toISOString() }
        : { endedAt: context.occurredAt ?? new Date().toISOString() }),
    },
  };
}
