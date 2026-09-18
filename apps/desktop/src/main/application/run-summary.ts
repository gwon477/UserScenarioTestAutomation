import { readFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import type { RunSummary } from "../../shared/runs";
import { listRunIds } from "./run-inventory";

/* 생성 이력 목록을 디스크에서 만든다.
 *
 * manifest 를 못 읽는 run 도 목록에 남긴다. 조용히 숨기면 디스크에 있는 run 을
 * 사용자가 볼 수 없다. 그런 run 은 `complete: false` 로 표시하고 열기를 막는다.
 *
 * ponytail: 여기서는 등록 여부만 보고 content hash 는 검증하지 않는다. run 을
 * 실제로 열 때 `loadCanonicalRun` 이 manifest, journal revision, 등록, hash 를
 * 모두 확인한다. 목록마다 전체 hash 를 다시 계산하면 run 이 늘수록 탭 진입이
 * 느려진다. 목록에서 위조를 걸러야 하는 요구가 생기면 그때 옮긴다.
 */

type ManifestArtifact = {
  artifact_id: string;
  artifact_type: string;
  content_hash: string;
  final_path?: string;
};

type RunManifest = {
  schema_version: 1 | 2;
  analysis_run_id: string;
  created_at: string;
  artifacts: ManifestArtifact[];
};

function artifactPath(runRoot: string, artifact: ManifestArtifact, fallback: string): string {
  const candidate = artifact.final_path ? resolve(artifact.final_path) : join(runRoot, fallback);
  if (candidate !== runRoot && !candidate.startsWith(`${runRoot}${sep}`)) throw new Error("ARTIFACT_PATH_ESCAPE");
  return candidate;
}

async function countFrom(path: string, count: (document: unknown) => number): Promise<number | undefined> {
  try {
    return count(JSON.parse(await readFile(path, "utf8")));
  } catch {
    return undefined;
  }
}

const lengthOf = (value: unknown): number => (Array.isArray(value) ? value.length : 0);

async function summarize(projectRoot: string, runId: string): Promise<RunSummary> {
  const runRoot = join(projectRoot, ".scenarioforge", "runs", runId);
  let manifest: RunManifest;
  try {
    manifest = JSON.parse(await readFile(join(runRoot, "manifest.json"), "utf8")) as RunManifest;
  } catch {
    return { runId, complete: false };
  }
  if (
    (manifest.schema_version !== 1 && manifest.schema_version !== 2) ||
    manifest.analysis_run_id !== runId ||
    !Array.isArray(manifest.artifacts)
  ) {
    return { runId, complete: false };
  }

  const find = (type: string, prefix: string) =>
    manifest.artifacts.find(
      (artifact) => artifact.artifact_type === type && artifact.artifact_id.startsWith(prefix),
    );
  const scenarioRecord = find("scenario-set", "SCENARIOS-");
  const factRecord = find("fact-bundle", "FACT-");
  const wikiRecord = find("wiki-bundle", "WIKI-");

  const [scenarios, facts, wikiPages] = await Promise.all([
    scenarioRecord
      ? countFrom(artifactPath(runRoot, scenarioRecord, "scenario-set.json"), (document) =>
          lengthOf((document as { scenarios?: unknown }).scenarios),
        )
      : Promise.resolve(undefined),
    factRecord
      ? countFrom(artifactPath(runRoot, factRecord, join("facts", `${factRecord.artifact_id}.json`)), (document) => {
          const bundle = document as { screens?: unknown; edges?: unknown; predicates?: unknown };
          return lengthOf(bundle.screens) + lengthOf(bundle.edges) + lengthOf(bundle.predicates);
        })
      : Promise.resolve(undefined),
    wikiRecord
      ? countFrom(artifactPath(runRoot, wikiRecord, "wiki-bundle.json"), (document) =>
          lengthOf((document as { workflows?: unknown }).workflows),
        )
      : Promise.resolve(undefined),
  ]);

  return {
    runId,
    createdAt: manifest.created_at,
    complete: scenarioRecord !== undefined && scenarios !== undefined,
    ...(facts !== undefined ? { facts } : {}),
    ...(wikiPages !== undefined ? { wikiPages } : {}),
    ...(scenarios !== undefined ? { scenarios } : {}),
  };
}

/** 최신 run 이 위로 온다. manifest 를 못 읽는 run 은 ID 순서로 뒤에 붙는다. */
export async function loadRunSummaries(projectRoot: string): Promise<RunSummary[]> {
  const summaries: RunSummary[] = await Promise.all(
    (await listRunIds(projectRoot)).map((runId) =>
      summarize(projectRoot, runId).catch((): RunSummary => ({ runId, complete: false })),
    ),
  );
  return summaries.sort((left, right) => {
    if (left.createdAt && right.createdAt) return right.createdAt.localeCompare(left.createdAt);
    if (left.createdAt) return -1;
    if (right.createdAt) return 1;
    return right.runId.localeCompare(left.runId);
  });
}
