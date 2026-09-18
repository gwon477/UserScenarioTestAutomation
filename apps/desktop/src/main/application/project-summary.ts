import { rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { ProjectSummary } from "../../shared/projects";
import { loadEvidenceLibrary } from "./evidence-library-view";
import { listRunIds } from "./run-inventory";
import { loadRunSummaries } from "./run-summary";
import { loadTestExecutions } from "./test-execution-view";

/* 프로젝트 목록 카드에 쓰는 요약.
 *
 * 전부 디스크에서 읽는다. 카드에 보이는 숫자는 renderer 가 기억한 값이 아니라
 * `.scenarioforge` 트리의 현재 상태다.
 *
 * ponytail: 프로젝트마다 모든 run 의 tests 트리를 걷는다. 연결한 프로젝트가
 * 수십 개가 되거나 실행 수가 수천 건이 되면 홈 화면 진입이 눈에 띄게 느려진다.
 * 그때는 run 단위 요약을 `.scenarioforge` 안에 캐시하고 mtime 으로 무효화한다.
 */

const ANALYSIS_DIRECTORY = ".scenarioforge";

async function directoryBytes(path: string): Promise<number> {
  const { readdir } = await import("node:fs/promises");
  let total = 0;
  let entries;
  try {
    entries = await readdir(path, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) total += await directoryBytes(child);
    else if (entry.isFile()) total += (await stat(child)).size;
  }
  return total;
}

export async function loadProjectSummary(
  projectRoot: string,
  entry: { path: string; addedAt: string; lastOpenedAt?: string },
): Promise<ProjectSummary> {
  const runIds = await listRunIds(projectRoot);
  const executions = await loadTestExecutions(projectRoot);
  const library = await loadEvidenceLibrary(projectRoot);
  /* 「열기」가 바로 들어갈 run. 디렉터리 이름 순서가 아니라 최신순이며, 시나리오
   * 산출물이 등록된 run 만이다. 등록 전 run 을 가리키면 열기가 실패한다. */
  const latestRunId = (await loadRunSummaries(projectRoot)).find((summary) => summary.complete)?.runId;
  return {
    path: entry.path,
    name: entry.path.split("/").filter(Boolean).at(-1) ?? entry.path,
    reachable: true,
    addedAt: entry.addedAt,
    ...(entry.lastOpenedAt ? { lastOpenedAt: entry.lastOpenedAt } : {}),
    runs: runIds.length,
    ...(latestRunId ? { latestRunId } : {}),
    executions: executions.length,
    failedExecutions: executions.filter((execution) => execution.status === "failed").length,
    frames: library.totals.frames,
    bytes: library.totals.bytes,
  };
}

/** 경로를 열 수 없는 항목. 목록에서 지우지 않고 이 형태로 보여준다. */
export function unreachableSummary(entry: {
  path: string;
  addedAt: string;
  lastOpenedAt?: string;
}): ProjectSummary {
  return {
    path: entry.path,
    name: entry.path.split("/").filter(Boolean).at(-1) ?? entry.path,
    reachable: false,
    addedAt: entry.addedAt,
    ...(entry.lastOpenedAt ? { lastOpenedAt: entry.lastOpenedAt } : {}),
    runs: 0,
    executions: 0,
    failedExecutions: 0,
    frames: 0,
    bytes: 0,
  };
}

/* 삭제 전에 무엇이 지워지는지 센다. 확인 대화상자가 이 값을 먼저 보여준다. */
export async function measureAnalysisData(projectRoot: string): Promise<{
  runs: number;
  executions: number;
  frames: number;
  bytes: number;
}> {
  const [runIds, executions, library] = await Promise.all([
    listRunIds(projectRoot),
    loadTestExecutions(projectRoot),
    loadEvidenceLibrary(projectRoot),
  ]);
  return {
    runs: runIds.length,
    executions: executions.length,
    frames: library.totals.frames,
    bytes: await directoryBytes(join(projectRoot, ANALYSIS_DIRECTORY)).catch(() => library.totals.bytes),
  };
}

/* 프로젝트의 분석 결과를 지운다.
 *
 * 되돌릴 수 없다. 지우는 대상은 프로젝트 루트 바로 아래의 `.scenarioforge`
 * 디렉터리 하나뿐이고, 그 경로가 루트 안에 있음을 다시 확인한 뒤에 지운다.
 * 원본 소스코드는 건드리지 않는다.
 */
export async function deleteAnalysisData(projectRoot: string): Promise<void> {
  const root = resolve(projectRoot);
  const target = resolve(root, ANALYSIS_DIRECTORY);
  if (target !== join(root, ANALYSIS_DIRECTORY)) throw new Error("ANALYSIS_PATH_ESCAPE");
  if (!target.startsWith(`${root}/`)) throw new Error("ANALYSIS_PATH_ESCAPE");
  const metadata = await stat(target).catch(() => null);
  if (metadata === null) return;
  if (!metadata.isDirectory()) throw new Error("ANALYSIS_PATH_NOT_DIRECTORY");
  await rm(target, { recursive: true, force: true });
}
