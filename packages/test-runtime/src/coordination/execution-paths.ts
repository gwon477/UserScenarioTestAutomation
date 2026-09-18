/* 실행 산출물의 저장 경로.
 *
 * 배치는 docs/architecture/04-test-execution-harness-design.md §5 를 따른다.
 * 실행 산출물은 run 디렉터리 아래 별도 `tests/` 하위 트리에만 쓴다.
 * 생성 트랙의 manifest, journal, artifact 는 읽지도 쓰지도 않는다.
 */

import { join, resolve, sep } from "node:path";

const SAFE_SEGMENT = /^[A-Za-z0-9_-]+$/;

export function assertSafeSegment(value: string, code: string): void {
  if (!SAFE_SEGMENT.test(value)) throw new Error(code);
}

export function testsRoot(projectRoot: string, runId: string): string {
  assertSafeSegment(runId, "RUN_ID_INVALID");
  return join(projectRoot, ".scenarioforge", "runs", runId, "tests");
}

export function executionRoot(projectRoot: string, runId: string, executionId: string): string {
  assertSafeSegment(executionId, "EXECUTION_ID_INVALID");
  return join(testsRoot(projectRoot, runId), executionId);
}

export function batchRoot(projectRoot: string, runId: string, executionId: string, batchId: string): string {
  assertSafeSegment(batchId, "BATCH_ID_INVALID");
  return join(executionRoot(projectRoot, runId, executionId), "batches", batchId);
}

/** 실행 산출물 트리를 벗어나는 경로를 만들지 않는다. */
export function assertWithinExecutionTree(projectRoot: string, runId: string, candidate: string): string {
  const root = resolve(testsRoot(projectRoot, runId));
  const target = resolve(candidate);
  if (target !== root && !target.startsWith(`${root}${sep}`)) throw new Error("EXECUTION_PATH_ESCAPE");
  return target;
}
