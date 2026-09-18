/* 실행 결과와 증적을 정본 실행 트리에 쓴다.
 *
 * 배치는 docs/architecture/04-test-execution-harness-design.md §5 를 따른다.
 *   tests/{executionId}/cases/{scenarioId}/result.json
 *   tests/{executionId}/cases/{scenarioId}/{stepId}/evidence.json
 *   tests/{executionId}/cases/{scenarioId}/{stepId}/frames/*.png
 *   tests/{executionId}/execution-result.json
 *
 * 생성 트랙의 manifest, journal, artifact 는 건드리지 않는다.
 */

import { randomUUID } from "node:crypto";
import { mkdir, open, rename, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import type { StepEvidenceRecord } from "../execution/step-evidence.js";
import type { FrameCapture } from "../execution/step-runner.js";
import type { BatchResultRecord, CaseResultRecord } from "./batch-executor.js";
import { assertWithinExecutionTree, executionRoot } from "./execution-paths.js";

async function atomicWrite(path: string, content: string | Buffer): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, content);
  const handle = await open(temporary, "r");
  await handle.sync();
  await handle.close();
  await rename(temporary, path);
}

/** stepId 는 `SCN-x#3` 형태다. 경로 segment 로 쓸 수 있게 바꾼다. */
export const stepDirectoryName = (stepId: string): string => stepId.replace(/#/g, "-step-").replace(/[^A-Za-z0-9_-]/g, "_");

export class ExecutionWriter {
  private readonly projectRoot: string;
  private readonly runId: string;
  private readonly root: string;

  /* parameter property 를 쓰지 않는다. Node 의 type-stripping 이 지원하지 않아
   * TS 를 직접 불러 쓰는 실행 경로에서 로드가 깨진다. */
  constructor(projectRoot: string, runId: string, executionId: string) {
    this.projectRoot = projectRoot;
    this.runId = runId;
    this.root = executionRoot(projectRoot, runId, executionId);
  }

  private resolveInside(...segments: string[]): string {
    return assertWithinExecutionTree(this.projectRoot, this.runId, join(this.root, ...segments));
  }

  private caseDirectory(scenarioId: string): string {
    // scenarioId 는 정본 ID 지만 경로로 쓰기 전에 다시 정규화한다.
    return this.resolveInside("cases", scenarioId.replace(/[^A-Za-z0-9_-]/g, "_"));
  }

  private stepDirectory(scenarioId: string, stepId: string): string {
    return join(this.caseDirectory(scenarioId), stepDirectoryName(stepId));
  }

  /** 모델에 보낸 프레임과 관측 프레임을 저장하고 실행 트리 기준 상대 경로를 돌려준다. */
  async writeFrame(input: {
    scenarioId: string;
    stepId: string;
    id: string;
    capture: FrameCapture;
  }): Promise<string> {
    const directory = join(this.stepDirectory(input.scenarioId, input.stepId), "frames");
    await mkdir(directory, { recursive: true });
    const path = join(directory, `${input.id}.png`);
    await atomicWrite(path, Buffer.from(input.capture.pngBase64, "base64"));
    return relative(this.root, path);
  }

  async writeStepEvidence(input: { scenarioId: string; stepId: string; record: StepEvidenceRecord }): Promise<string> {
    const directory = this.stepDirectory(input.scenarioId, input.stepId);
    await mkdir(directory, { recursive: true });
    const path = join(directory, "evidence.json");
    await atomicWrite(path, `${JSON.stringify(input.record, null, 2)}\n`);
    return relative(this.root, path);
  }

  async writeCaseResult(record: CaseResultRecord): Promise<void> {
    const directory = this.caseDirectory(record.scenarioId);
    await mkdir(directory, { recursive: true });
    await atomicWrite(join(directory, "result.json"), `${JSON.stringify(record, null, 2)}\n`);
  }

  async writeBatchResult(record: BatchResultRecord): Promise<void> {
    await mkdir(this.root, { recursive: true });
    await atomicWrite(this.resolveInside("execution-result.json"), `${JSON.stringify(record, null, 2)}\n`);
  }
}
