import type { AnalysisStage } from "@scenarioforge/contracts";
import { ANALYSIS_STAGES } from "@scenarioforge/contracts";
import { StageCompletionGate, type StageCompletionDecision, type StageCompletionInput } from "../validators/stage-completion-gate.js";

export type AnalysisStageRecord = { stage: AnalysisStage; status: "pending" | "running" | "validating" | "completed" | "failed"; attempt: number };

export class AnalysisCoordinator {
  private readonly records = new Map<AnalysisStage, AnalysisStageRecord>(ANALYSIS_STAGES.map((stage) => [stage, { stage, status: "pending", attempt: 0 }]));
  constructor(private readonly gate = new StageCompletionGate()) {}

  start(stage: AnalysisStage): AnalysisStageRecord {
    const index = ANALYSIS_STAGES.indexOf(stage);
    if (index > 0 && this.records.get(ANALYSIS_STAGES[index - 1])?.status !== "completed") throw new Error("ANALYSIS_STAGE_ORDER_VIOLATION");
    const current = this.records.get(stage)!;
    if (current.status === "completed") throw new Error("COMPLETED_STAGE_IMMUTABLE");
    if (!["pending", "failed"].includes(current.status)) throw new Error("ANALYSIS_STAGE_ALREADY_ACTIVE");
    const next = { ...current, status: "running" as const, attempt: current.attempt + 1 };
    this.records.set(stage, next);
    return next;
  }

  requestCompletion(input: StageCompletionInput): StageCompletionDecision {
    const current = this.records.get(input.stage)!;
    if (current.status !== "running" && current.status !== "validating") throw new Error("ANALYSIS_STAGE_NOT_RUNNING");
    this.records.set(input.stage, { ...current, status: "validating" });
    const decision = this.gate.decide(input);
    this.records.set(input.stage, { ...current, status: decision.accepted ? "completed" : "running" });
    return decision;
  }

  get(stage: AnalysisStage): AnalysisStageRecord { return { ...this.records.get(stage)! }; }
}
