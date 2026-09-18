export const DOMAIN_EVENT_TYPES = [
  "project.runtime.updated",
  "analysis.session.updated",
  "analysis.stage.started",
  "analysis.stage.progress",
  "analysis.artifact.persisted",
  "analysis.stage.completed",
  "analysis.stage.failed",
  "analysis.step.started",
  "analysis.step.completed",
  "analysis.step.failed",
  "work.updated",
] as const;

export type ScenarioForgeDomainEventType = (typeof DOMAIN_EVENT_TYPES)[number];

export type ScenarioForgeDomainEvent<TPayload = Record<string, unknown>> = {
  schemaVersion: 1;
  eventId: string;
  eventType: ScenarioForgeDomainEventType;
  projectId: string;
  revision: number;
  occurredAt: string;
  sessionId?: string;
  analysisRunId?: string;
  workId?: string;
  payload: TPayload;
};
