/* 대기열에 올라간 batch 를 순차 실행하고 결과를 기록한다.
 *
 * 이 파일에는 화면도 모델도 파일 시스템도 없다. 전부 port 로 받는다.
 * 그래야 순차 규칙과 중단 규칙을 fake 로 전부 검사할 수 있다.
 *
 * 계약은 docs/architecture/04-test-execution-harness-design.md §10 · §14 를 따른다.
 */

import type { FactScreen } from "@scenarioforge/contracts";
import type { VisionStepEnvelope } from "../types.js";
import type { StepVerdict } from "../execution/assertion-engine.js";
import type { StepEvidenceRecord } from "../execution/step-evidence.js";
import type { StepOutcome } from "../execution/step-runner.js";

export type CaseVerdict = StepVerdict | "CANCELLED";

export type StepResultRecord = {
  stepId: string;
  order: number;
  verdict: StepVerdict | "SKIPPED" | "CANCELLED";
  evidencePath?: string;
  reason?: { code: string; detail: string };
};

export type CaseResultRecord = {
  schemaVersion: 1;
  scenarioId: string;
  title: string;
  verdict: CaseVerdict;
  steps: StepResultRecord[];
  startedAt: string;
  completedAt: string;
};

export type ExecutionRuntimeStatus = "COMPLETED" | "CANCELLED" | "ABORTED";

export type BatchResultRecord = {
  schemaVersion: 1;
  executionId: string;
  batchId: string;
  runtimeStatus: ExecutionRuntimeStatus;
  verdictCounts: Record<"PASSED" | "FAILED" | "INCONCLUSIVE" | "SKIPPED" | "CANCELLED", number>;
  cases: CaseResultRecord[];
  startedAt: string;
  completedAt: string;
};

export type BatchCase = {
  scenarioId: string;
  title: string;
  envelopes: readonly VisionStepEnvelope[];
};

export type BatchExecutorPorts = {
  runStep(envelope: VisionStepEnvelope): Promise<StepOutcome>;
  /** step 증적을 저장하고 상대 경로를 돌려준다. */
  writeStepEvidence(input: { scenarioId: string; stepId: string; record: StepEvidenceRecord }): Promise<string>;
  buildEvidence(input: { envelope: VisionStepEnvelope; outcome: StepOutcome }): StepEvidenceRecord;
  writeCaseResult(record: CaseResultRecord): Promise<void>;
  writeBatchResult(record: BatchResultRecord): Promise<void>;
  now(): string;
  /** 사용자 중단 여부. step 사이에서만 확인한다. */
  isCancelled?(): boolean;
};

/* 실행 자체를 즉시 끝내야 하는 사유. 다음 케이스로 넘어가지 않는다. */
const ABORT_CODES = new Set(["FRAME_MASKING_FAILED", "SCREEN_TEXT_INSTRUCTION_DETECTED"]);

const orderOf = (stepId: string): number => Number(stepId.split("#").at(-1) ?? 0);

function caseVerdictOf(steps: readonly StepResultRecord[]): CaseVerdict {
  if (steps.some((step) => step.verdict === "CANCELLED")) return "CANCELLED";
  if (steps.some((step) => step.verdict === "FAILED")) return "FAILED";
  if (steps.some((step) => step.verdict === "INCONCLUSIVE" || step.verdict === "SKIPPED")) return "INCONCLUSIVE";
  return "PASSED";
}

export async function executeBatch(input: {
  executionId: string;
  batchId: string;
  cases: readonly BatchCase[];
  screens: readonly FactScreen[];
  ports: BatchExecutorPorts;
}): Promise<BatchResultRecord> {
  const { ports } = input;
  const startedAt = ports.now();
  const cases: CaseResultRecord[] = [];
  let runtimeStatus: ExecutionRuntimeStatus = "COMPLETED";
  let stopped = false;

  for (const batchCase of input.cases) {
    const caseStartedAt = ports.now();
    const steps: StepResultRecord[] = [];

    if (stopped) {
      // 이미 멈춘 실행의 남은 케이스는 수행하지 않는다. 증적은 남기지 않는다.
      for (const envelope of batchCase.envelopes) {
        steps.push({ stepId: envelope.stepId, order: orderOf(envelope.stepId), verdict: runtimeStatus === "CANCELLED" ? "CANCELLED" : "SKIPPED" });
      }
      const record: CaseResultRecord = {
        schemaVersion: 1,
        scenarioId: batchCase.scenarioId,
        title: batchCase.title,
        verdict: runtimeStatus === "CANCELLED" ? "CANCELLED" : "INCONCLUSIVE",
        steps,
        startedAt: caseStartedAt,
        completedAt: ports.now(),
      };
      await ports.writeCaseResult(record);
      cases.push(record);
      continue;
    }

    let caseStopped = false;
    for (const envelope of batchCase.envelopes) {
      const order = orderOf(envelope.stepId);

      if (ports.isCancelled?.()) {
        runtimeStatus = "CANCELLED";
        stopped = true;
        caseStopped = true;
      }
      if (caseStopped) {
        steps.push({ stepId: envelope.stepId, order, verdict: runtimeStatus === "CANCELLED" ? "CANCELLED" : "SKIPPED" });
        continue;
      }

      const outcome = await ports.runStep(envelope);
      const evidencePath = await ports.writeStepEvidence({
        scenarioId: batchCase.scenarioId,
        stepId: envelope.stepId,
        record: ports.buildEvidence({ envelope, outcome }),
      });
      const reason = outcome.status === "completed" ? undefined : outcome.reason;
      steps.push({
        stepId: envelope.stepId,
        order,
        verdict: outcome.verdict,
        evidencePath,
        ...(reason ? { reason: { code: reason.code, detail: reason.detail } } : {}),
      });

      if (outcome.status === "aborted" && ABORT_CODES.has(outcome.reason.code)) {
        // 보안·증적 무결성 실패는 실행 전체를 즉시 끝낸다.
        runtimeStatus = "ABORTED";
        stopped = true;
        caseStopped = true;
        continue;
      }
      // 판정이 확정되지 않았거나 실패한 뒤의 후속 step 은 신뢰할 수 없다.
      if (outcome.verdict !== "PASSED") caseStopped = true;
    }

    const record: CaseResultRecord = {
      schemaVersion: 1,
      scenarioId: batchCase.scenarioId,
      title: batchCase.title,
      verdict: caseVerdictOf(steps),
      steps,
      startedAt: caseStartedAt,
      completedAt: ports.now(),
    };
    await ports.writeCaseResult(record);
    cases.push(record);
  }

  const verdictCounts = { PASSED: 0, FAILED: 0, INCONCLUSIVE: 0, SKIPPED: 0, CANCELLED: 0 };
  for (const record of cases) {
    for (const step of record.steps) verdictCounts[step.verdict] += 1;
  }

  const result: BatchResultRecord = {
    schemaVersion: 1,
    executionId: input.executionId,
    batchId: input.batchId,
    runtimeStatus,
    verdictCounts,
    cases,
    startedAt,
    completedAt: ports.now(),
  };
  await ports.writeBatchResult(result);
  return result;
}
