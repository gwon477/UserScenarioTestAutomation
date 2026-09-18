import type { AgentWorkStatus, AnalysisStage, VerifiableActivity, WorkStatus } from "@scenarioforge/contracts";

export type StageCompletionInput = {
  stage: AnalysisStage;
  sessionStatus: AgentWorkStatus;
  rootWorkStatus: WorkStatus;
  childWorkStatuses: WorkStatus[];
  activeActivities: VerifiableActivity[];
  artifactSchemaValid: boolean;
  requiredRelationsValid: boolean;
  finalArtifactPersisted: boolean;
  indexCandidateValid: boolean;
  stageManifestValid: boolean;
  journalCheckpointCommitted?: boolean;
};

export type StageCompletionDecision = { accepted: true; unmetGates: [] } | { accepted: false; unmetGates: string[] };

export class StageCompletionGate {
  decide(input: StageCompletionInput): StageCompletionDecision {
    const code = input.stage.toUpperCase();
    if (input.sessionStatus !== "settled" || input.rootWorkStatus !== "settled" || input.childWorkStatuses.some((status) => status !== "settled")) {
      return { accepted: false, unmetGates: ["WORK_TREE_NOT_SETTLED"] };
    }
    if (input.activeActivities.some((activity) => activity.status === "queued" || activity.status === "running")) {
      return { accepted: false, unmetGates: ["ACTIVE_ACTIVITY_REMAINS"] };
    }
    if (!input.artifactSchemaValid) return { accepted: false, unmetGates: [`${code}_SCHEMA_INVALID`] };
    if (!input.requiredRelationsValid) return { accepted: false, unmetGates: [`${code}_RELATIONS_INVALID`] };
    if (!input.finalArtifactPersisted) return { accepted: false, unmetGates: [`${code}_FINAL_ARTIFACT_NOT_PERSISTED`] };
    if (!input.indexCandidateValid) return { accepted: false, unmetGates: [`${code}_INDEX_CANDIDATE_INVALID`] };
    if (!input.stageManifestValid) return { accepted: false, unmetGates: [`${code}_MANIFEST_INVALID`] };
    if (input.journalCheckpointCommitted === false) return { accepted: false, unmetGates: ["JOURNAL_CHECKPOINT_NOT_COMMITTED"] };
    return { accepted: true, unmetGates: [] };
  }
}
