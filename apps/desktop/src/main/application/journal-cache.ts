import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { JournalRepository, type JournalCommit } from "@scenarioforge/runtime-state";

/* 검증된 journal chain head 를 프로젝트당 한 번만 만든다.
 *
 * `recoverLatest` 는 genesis 부터 전체 chain 을 다시 읽어 해시를 검증한다.
 * 커밋마다 프로젝트 상태 전체를 적으므로 revision 이 쌓이면 chain 이 GB 단위가
 * 되고, 화면마다 새 repository 를 만들면 그 비용을 화면 수만큼 다시 낸다.
 * 실측: RA-DAR 2629 revision · 3.2 GB 에서 호출당 15초.
 *
 * 검증 자체는 줄이지 않는다. 같은 chain 을 두 번 검증하지 않을 뿐이다.
 * 마지막 journal 파일의 이름·크기·수정 시각이 달라지면 다시 검증한다.
 *
 * ponytail: 근본 비용은 커밋마다 상태 전체를 적는 journal 형식에 있다.
 * revision 이 수만 건이 되거나 첫 검증 시간이 사용자를 막으면, 검증된
 * 체크포인트부터 이어 검증하는 형식으로 바꿔야 한다.
 */

type CacheEntry = {
  fingerprint: string;
  pending: Promise<JournalCommit | undefined>;
};

const cache = new Map<string, CacheEntry>();

/** 마지막 journal 파일의 이름·크기·수정 시각. 하나라도 달라지면 다시 검증한다. */
async function fingerprint(projectRoot: string): Promise<string> {
  const journalRoot = join(projectRoot, ".scenarioforge", "state", "journal");
  let names: string[];
  try {
    names = (await readdir(journalRoot)).filter((name) => /^\d+\.json$/.test(name)).sort();
  } catch {
    return "absent";
  }
  const last = names.at(-1);
  if (!last) return "empty";
  const info = await stat(join(journalRoot, last));
  return `${names.length}:${last}:${info.size}:${info.mtimeMs}`;
}

export async function getVerifiedJournal(projectRoot: string): Promise<JournalCommit | undefined> {
  const current = await fingerprint(projectRoot);
  const cached = cache.get(projectRoot);
  if (cached?.fingerprint === current) return cached.pending;
  const pending = new JournalRepository(projectRoot).recoverLatest();
  cache.set(projectRoot, { fingerprint: current, pending });
  // 검증이 실패하면 다음 호출이 다시 시도하도록 캐시를 비운다.
  pending.catch(() => {
    if (cache.get(projectRoot)?.pending === pending) cache.delete(projectRoot);
  });
  return pending;
}

/* 프로젝트를 열 때 미리 검증해 둔다. 사용자가 탭을 누를 때에는 이미 끝나 있다.
 * 실패는 여기서 보고하지 않는다. 실제로 읽는 화면이 같은 오류를 다시 만난다. */
export function warmJournal(projectRoot: string): void {
  void getVerifiedJournal(projectRoot).catch(() => undefined);
}

/** 테스트 전용. 프로세스 안에서 캐시를 비운다. */
export function resetJournalCache(): void {
  cache.clear();
}
