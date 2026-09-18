import type { FactScreen } from "@scenarioforge/contracts";
import {
  buildStepEvidence,
  createFrameCoordinateSpace,
  executeBatch,
  ExecutionWriter,
  runStep,
  type BatchCase,
  type BatchResultRecord,
  type FrameCapture,
  type FrameCoordinateSpace,
  type MaskedRegionRecord,
  type ObservedFrame,
  type Point,
  type VisionActionProposal,
  type VisionStepEnvelope,
} from "@scenarioforge/test-runtime";

/* 대기열에 올라간 batch 를 실제로 수행한다.
 *
 * 화면과 모델은 port 로 주입한다. IPC 핸들러와 검증 harness 가 같은 함수를
 * 쓰므로, harness 로 확인한 것이 제품 경로다.
 *
 * 계약은 docs/architecture/07-vision-first-execution-design.md §4 를 따른다.
 */

export type VisionSurface = {
  /** 마스크를 덮은 뒤 캡처한다. 마스크 적용 실패는 false 로 알린다. */
  capture(): Promise<{ capture: FrameCapture; maskApplied: boolean }>;
  click(point: Point): Promise<void>;
  type(point: Point, value: string): Promise<void>;
  resize(capture: FrameCapture, space: FrameCoordinateSpace): Promise<FrameCapture>;
};

export type VisionModels = {
  propose(input: { pngBase64: string; frameSize: FrameCapture["size"]; envelope: VisionStepEnvelope }): Promise<VisionActionProposal | null>;
  observe(input: { pngBase64: string; frameSize: FrameCapture["size"]; questions: readonly string[] }): Promise<ObservedFrame>;
};

export type RunQueuedBatchInput = {
  projectRoot: string;
  runId: string;
  executionId: string;
  batchId: string;
  cases: readonly BatchCase[];
  screens: readonly FactScreen[];
  /** binding key 별 원문 값. 메모리에만 존재하고 기록되지 않는다. */
  values: Readonly<Record<string, string>>;
  maskedRegions: readonly MaskedRegionRecord[];
  viewport: { width: number; height: number };
  surface: VisionSurface;
  models: VisionModels;
  destructiveAllowed?: boolean;
  isCancelled?: () => boolean;
  now?: () => string;
  onStep?: (event: { scenarioId: string; stepId: string; verdict: string }) => void;
};

export async function runQueuedBatch(input: RunQueuedBatchInput): Promise<BatchResultRecord> {
  const space = createFrameCoordinateSpace(input.viewport);
  const writer = new ExecutionWriter(input.projectRoot, input.runId, input.executionId);
  const now = input.now ?? (() => new Date().toISOString());

  /* 현재 수행 중인 케이스. 증적 경로를 만들 때 쓴다.
   * executeBatch 가 케이스를 순차로 넘기므로 한 번에 하나만 유효하다. */
  let currentScenarioId = "";

  const stepPorts = (envelope: VisionStepEnvelope) => ({
    surface: {
      capture: async () => (await input.surface.capture()).capture,
      click: (point: Point) => input.surface.click(point),
      type: (point: Point, value: string) => input.surface.type(point, value),
    },
    operator: { propose: input.models.propose },
    observer: { observe: input.models.observe },
    // 마스크가 적용되지 않은 프레임은 모델에 보내지 않는다.
    maskFrame: async (frame: FrameCapture) => frame,
    resizeFrame: (frame: FrameCapture, target: FrameCoordinateSpace) => input.surface.resize(frame, target),
    resolveValue: async (valueRef: string) => {
      const value = input.values[valueRef];
      if (value === undefined) throw new Error("DATA_BINDING_VALUE_MISSING");
      return value;
    },
    recordFrame: async (frame: { kind: string; round: number; capture: FrameCapture }) => {
      const id = `${frame.kind}-${frame.round}`;
      const relativePath = await writer.writeFrame({
        scenarioId: currentScenarioId,
        stepId: envelope.stepId,
        id,
        capture: frame.capture,
      });
      return { id, kind: frame.kind as never, round: frame.round, relativePath, size: frame.capture.size };
    },
  });

  return executeBatch({
    executionId: input.executionId,
    batchId: input.batchId,
    cases: input.cases,
    screens: input.screens,
    ports: {
      async runStep(envelope) {
        currentScenarioId = input.cases.find((entry) => entry.envelopes.some((candidate) => candidate.stepId === envelope.stepId))?.scenarioId ?? "";
        /* 마스크 적용 여부는 캡처 시점에만 알 수 있다. 실패하면 프레임을 넘기지
         * 않고 maskFrame 이 null 을 반환하도록 감싼다. */
        let maskFailed = false;
        const ports = stepPorts(envelope);
        const outcome = await runStep(
          envelope,
          input.screens,
          {
            ...ports,
            surface: {
              ...ports.surface,
              capture: async () => {
                const taken = await input.surface.capture();
                if (!taken.maskApplied) maskFailed = true;
                return taken.capture;
              },
            },
            maskFrame: async (frame) => (maskFailed ? null : frame),
          },
          input.destructiveAllowed === undefined ? undefined : { destructiveAllowed: input.destructiveAllowed },
        );
        input.onStep?.({ scenarioId: currentScenarioId, stepId: envelope.stepId, verdict: outcome.verdict });
        return outcome;
      },
      buildEvidence: ({ envelope, outcome }) => buildStepEvidence({ envelope, outcome, space, maskedRegions: input.maskedRegions }),
      writeStepEvidence: (record) => writer.writeStepEvidence(record),
      writeCaseResult: (record) => writer.writeCaseResult(record),
      writeBatchResult: (record) => writer.writeBatchResult(record),
      now,
      ...(input.isCancelled ? { isCancelled: input.isCancelled } : {}),
    },
  });
}
