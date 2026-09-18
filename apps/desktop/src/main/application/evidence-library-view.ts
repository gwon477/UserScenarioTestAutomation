import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { executionRoot, testsRoot } from "@scenarioforge/test-runtime";
import { listRunIds } from "./run-inventory";
import type { HumanReviewView, StepEvidenceView } from "../../shared/evidence";
import type { EvidenceLibraryEntry, EvidenceLibraryView } from "../../shared/evidence-library";

/* 정본 실행 트리를 걸어 라이브러리 목록을 만든다.
 *
 * 실행이 반복되면 목록만으로는 찾을 수 없으므로 필터에 필요한 축을 모두
 * 담는다. 판정, 케이스, 사유 코드, 검토 상태, causeTag.
 */

type ExecutionManifest = { schemaVersion: 1; executionId: string; createdAt: string };

async function directoryNames(path: string): Promise<string[]> {
  try {
    return (await readdir(path, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return [];
  }
}

async function frameBytes(directory: string): Promise<{ count: number; bytes: number }> {
  let count = 0;
  let bytes = 0;
  try {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".png")) continue;
      count += 1;
      bytes += (await stat(join(directory, entry.name))).size;
    }
  } catch {
    return { count: 0, bytes: 0 };
  }
  return { count, bytes };
}

const EMPTY_TOTALS: EvidenceLibraryView["totals"] = {
  steps: 0,
  frames: 0,
  bytes: 0,
  verdicts: { PASSED: 0, FAILED: 0, INCONCLUSIVE: 0 },
  reasonCodes: {},
  causeTags: {},
  reviewed: 0,
};

function mergeTotals(views: readonly EvidenceLibraryView[]): EvidenceLibraryView["totals"] {
  const totals = {
    steps: 0,
    frames: 0,
    bytes: 0,
    verdicts: { PASSED: 0, FAILED: 0, INCONCLUSIVE: 0 },
    reasonCodes: {} as Record<string, number>,
    causeTags: {} as Record<string, number>,
    reviewed: 0,
  };
  for (const view of views) {
    totals.steps += view.totals.steps;
    totals.frames += view.totals.frames;
    totals.bytes += view.totals.bytes;
    totals.reviewed += view.totals.reviewed;
    for (const key of ["PASSED", "FAILED", "INCONCLUSIVE"] as const) totals.verdicts[key] += view.totals.verdicts[key];
    for (const [code, count] of Object.entries(view.totals.reasonCodes)) totals.reasonCodes[code] = (totals.reasonCodes[code] ?? 0) + count;
    for (const [tag, count] of Object.entries(view.totals.causeTags)) totals.causeTags[tag] = (totals.causeTags[tag] ?? 0) + count;
  }
  return totals;
}

/* runId 를 생략하면 프로젝트 전체 증적을 모은다. causeTag 집계도 함께 합친다.
 * 같은 원인이 여러 run 에 걸쳐 반복되는 것이 바로 계약 요청 신호다. */
export async function loadEvidenceLibrary(projectRoot: string, runId?: string): Promise<EvidenceLibraryView> {
  if (runId === undefined) {
    const views = await Promise.all(
      (await listRunIds(projectRoot)).map((id) =>
        // run 하나가 읽히지 않아도 나머지 증적을 지우지 않는다.
        loadEvidenceLibrary(projectRoot, id).catch(() => ({ entries: [], totals: EMPTY_TOTALS })),
      ),
    );
    const entries = views
      .flatMap((view) => view.entries)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || left.scenarioId.localeCompare(right.scenarioId) || left.order - right.order);
    return { entries, totals: mergeTotals(views) };
  }
  const root = testsRoot(projectRoot, runId);
  const entries: EvidenceLibraryEntry[] = [];

  for (const executionId of await directoryNames(root)) {
    const executionDirectory = executionRoot(projectRoot, runId, executionId);
    let createdAt = "";
    try {
      const manifest = JSON.parse(await readFile(join(executionDirectory, "manifest.json"), "utf8")) as ExecutionManifest;
      if (manifest.schemaVersion !== 1 || manifest.executionId !== executionId) continue;
      createdAt = manifest.createdAt;
    } catch {
      continue;
    }

    const casesRoot = join(executionDirectory, "cases");
    for (const scenarioDirectory of await directoryNames(casesRoot)) {
      for (const stepDirectory of await directoryNames(join(casesRoot, scenarioDirectory))) {
        const directory = join(casesRoot, scenarioDirectory, stepDirectory);
        let evidence: StepEvidenceView;
        try {
          evidence = JSON.parse(await readFile(join(directory, "evidence.json"), "utf8")) as StepEvidenceView;
          if (evidence.schemaVersion !== 1) continue;
        } catch {
          continue;
        }

        let reviews: HumanReviewView[] = [];
        try {
          const ledger = JSON.parse(await readFile(join(directory, "reviews.json"), "utf8")) as { reviews?: HumanReviewView[] };
          reviews = Array.isArray(ledger.reviews) ? ledger.reviews : [];
        } catch {
          // 검토 기록이 없으면 미검토 항목이다.
        }

        const frames = await frameBytes(join(directory, "frames"));
        entries.push({
          runId,
          executionId,
          scenarioId: evidence.stepId.split("#")[0] ?? scenarioDirectory,
          stepId: evidence.stepId,
          order: Number(evidence.stepId.split("#").at(-1) ?? 0),
          verdict: evidence.verdict,
          ...(evidence.reason ? { reasonCode: evidence.reason.code } : {}),
          frameCount: frames.count,
          bytes: frames.bytes,
          reviewCount: reviews.length,
          causeTags: [...new Set(reviews.flatMap((review) => (review.causeTag ? [review.causeTag] : [])))],
          decisions: [...new Set(reviews.map((review) => review.decision))],
          createdAt,
        });
      }
    }
  }

  entries.sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt) ||
    left.scenarioId.localeCompare(right.scenarioId) ||
    left.order - right.order,
  );

  const verdicts = { PASSED: 0, FAILED: 0, INCONCLUSIVE: 0 };
  const reasonCodes: Record<string, number> = {};
  const causeTags: Record<string, number> = {};
  let frames = 0;
  let bytes = 0;
  let reviewed = 0;
  for (const entry of entries) {
    verdicts[entry.verdict] += 1;
    frames += entry.frameCount;
    bytes += entry.bytes;
    if (entry.reviewCount > 0) reviewed += 1;
    if (entry.reasonCode) reasonCodes[entry.reasonCode] = (reasonCodes[entry.reasonCode] ?? 0) + 1;
    for (const tag of entry.causeTags) causeTags[tag] = (causeTags[tag] ?? 0) + 1;
  }

  return {
    runId,
    entries,
    totals: { steps: entries.length, frames, bytes, verdicts, reasonCodes, causeTags, reviewed },
  };
}
