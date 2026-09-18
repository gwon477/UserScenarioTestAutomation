import { createHash } from "node:crypto";
import type { ProjectRuntimeState } from "@scenarioforge/contracts";

export const WORK_STATE_HEADINGS = [
  "State Identity",
  "Current Assignment",
  "Required Input IDs",
  "Verified Artifacts",
  "Pending Completion Gates",
  "Recent Verifiable Activities",
  "Recovery and Error",
  "Allowed Next Actions",
] as const;

const list = (values: string[]): string => (values.length ? values.map((value) => `- ${value}`).join("\n") : "- none");

export function renderWorkStateMarkdown(state: ProjectRuntimeState): string {
  const activeWork = Object.values(state.works)
    .filter((work) =>
      work.status === "running"
      && work.analysisRunId === state.analysisRunId
      && work.sessionId === state.sessionId
      && work.stage === state.activeStage
      && (state.activeStep === undefined || work.generationStep === state.activeStep)
      && (state.activeRole === undefined || work.role === state.activeRole),
    )
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || right.createdAt.localeCompare(left.createdAt))[0];
  const verified = Object.values(state.artifacts)
    .filter((artifact) => artifact.status === "verified" || artifact.status === "persisted")
    .map((artifact) => artifact.artifactId)
    .sort();
  const activities = Object.values(state.activities)
    .sort((a, b) => a.activityId.localeCompare(b.activityId))
    .slice(-20)
    .map((activity) => `${activity.activityId}: ${activity.status}`);
  const pendingGates = activeWork?.completionRequested ? ["backend completion gate"] : ["completion not requested"];
  return `# ScenarioForge Work State

## State Identity
- schemaVersion: ${state.schemaVersion}
- revision: ${state.revision}
- projectId: ${state.projectId ?? "none"}
- sessionId: ${state.sessionId ?? activeWork?.sessionId ?? "none"}
- analysisRunId: ${state.analysisRunId ?? activeWork?.analysisRunId ?? "none"}

## Current Assignment
- workId: ${activeWork?.workId ?? "none"}
- stage: ${activeWork?.stage ?? state.activeStage ?? "none"}
- step: ${activeWork?.generationStep ?? state.activeStep ?? "none"}
- role: ${activeWork?.role ?? state.activeRole ?? "none"}
- status: ${activeWork?.status ?? "none"}
- activity: ${state.currentActivity ?? "none"}

## Required Input IDs
${list([...(activeWork?.inputIds ?? [])].sort())}

## Verified Artifacts
${list(verified)}

## Pending Completion Gates
${list(pendingGates)}

## Recent Verifiable Activities
${list(activities)}

## Recovery and Error
- recoverable: ${state.recoverable}
- checkpointId: ${state.lastCheckpointId ?? "none"}
- error: ${state.lastError ? `${state.lastError.category}: ${state.lastError.message}` : "none"}

## Allowed Next Actions
${list(activeWork ? ["record activity", "submit staging artifact", "request completion"] : ["request work context"])}
`;
}

export function hashWorkStateMarkdown(markdown: string): string {
  return createHash("sha256").update(markdown, "utf8").digest("hex");
}
