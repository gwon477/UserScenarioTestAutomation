export type ActivityKind = "tool" | "skill" | "subagent" | "validator";
export type ActivityStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export type VerifiableActivity = {
  activityId: string;
  projectId: string;
  sessionId: string;
  workId: string;
  kind: ActivityKind;
  name: string;
  status: ActivityStatus;
  startedAt?: string;
  endedAt?: string;
  inputHash?: string;
  outputSummary?: string;
  errorCode?: string;
};
