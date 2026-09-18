import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { executionRoot } from "@scenarioforge/test-runtime";
import { loadTestExecutions } from "./test-execution-view";

/* 「테스트 실행」 탭은 프로젝트 범위다. 사람이 읽는 동작·기대 결과는 정본 run 에서
 * 오므로 여기서 정본 run 전체를 위조할 수는 없다. 실제 투영은
 * `tests/e2e/test-execution-requirements.test.ts` 가 하네스로 만든 run 으로 검증한다.
 *
 * 이 파일은 프로젝트 범위로 넓히면서 새로 생긴 두 가지만 본다:
 * run 열거와, run 하나가 깨졌을 때의 격리. */

let projectRoot: string;

beforeEach(async () => {
  projectRoot = await mkdtemp(join(tmpdir(), "scenarioforge-executions-"));
});

afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
});

describe("test execution list view", () => {
  it("returns nothing when the project has no runs", async () => {
    expect(await loadTestExecutions(projectRoot)).toEqual([]);
  });

  it("keeps the other runs when one run's canonical artifacts cannot be read", async () => {
    // 실행 디렉터리는 있지만 정본 run manifest 가 없는 run.
    const broken = executionRoot(projectRoot, "RUN-broken", "EXEC-1");
    await mkdir(broken, { recursive: true });
    await writeFile(join(broken, "manifest.json"), JSON.stringify({ schemaVersion: 1, executionId: "EXEC-1" }));

    // 실행이 아예 없는 정상 run.
    await mkdir(join(projectRoot, ".scenarioforge", "runs", "RUN-empty"), { recursive: true });

    await expect(loadTestExecutions(projectRoot)).resolves.toEqual([]);
    // run 을 지정하면 정본 검증 실패를 감추지 않는다. IPC 계층이 이를 잡는다.
    await expect(loadTestExecutions(projectRoot, "RUN-broken")).rejects.toThrow();
  });
});
