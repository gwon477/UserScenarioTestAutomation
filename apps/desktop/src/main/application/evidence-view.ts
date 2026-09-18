import { readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { assertWithinExecutionTree, executionRoot, stepDirectoryName } from "@scenarioforge/test-runtime";
import type { StepEvidenceView } from "../../shared/evidence";

/* 증적을 화면에 읽어 준다.
 *
 * 프레임 파일은 renderer 가 직접 열 수 없으므로 main 이 data URL 로 넘긴다.
 * 모든 경로는 실행 트리 안에 있어야 한다.
 */

const MAX_FRAME_BYTES = 8 * 1024 * 1024;

export async function loadStepEvidence(input: {
  projectRoot: string;
  runId: string;
  executionId: string;
  scenarioId: string;
  stepId: string;
}): Promise<StepEvidenceView> {
  const directory = join(
    executionRoot(input.projectRoot, input.runId, input.executionId),
    "cases",
    input.scenarioId.replace(/[^A-Za-z0-9_-]/g, "_"),
    stepDirectoryName(input.stepId),
  );
  assertWithinExecutionTree(input.projectRoot, input.runId, directory);
  const record = JSON.parse(await readFile(join(directory, "evidence.json"), "utf8")) as StepEvidenceView;
  if (record.schemaVersion !== 1) throw new Error("EVIDENCE_SCHEMA_UNSUPPORTED");
  return record;
}

/** 프레임 하나를 data URL 로 읽는다. 실행 트리 밖 경로는 읽지 않는다. */
export async function loadEvidenceFrame(input: {
  projectRoot: string;
  runId: string;
  executionId: string;
  relativePath: string;
}): Promise<string> {
  const root = executionRoot(input.projectRoot, input.runId, input.executionId);
  const path = assertWithinExecutionTree(input.projectRoot, input.runId, join(root, input.relativePath));
  if (!relative(root, path).endsWith(".png")) throw new Error("EVIDENCE_FRAME_TYPE_UNSUPPORTED");
  const content = await readFile(path);
  // 화면에 넘기는 크기를 제한한다. 큰 프레임은 잘라내지 않고 거절한다.
  if (content.byteLength > MAX_FRAME_BYTES) throw new Error("EVIDENCE_FRAME_TOO_LARGE");
  return `data:image/png;base64,${content.toString("base64")}`;
}
