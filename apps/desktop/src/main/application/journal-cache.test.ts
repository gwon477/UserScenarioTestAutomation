import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createInitialProjectRuntimeState } from "@scenarioforge/contracts";
import { JournalRepository, RuntimeStateCoordinator } from "@scenarioforge/runtime-state";
import { getVerifiedJournal, resetJournalCache } from "./journal-cache";

let projectRoot: string;

beforeEach(async () => {
  projectRoot = await mkdtemp(join(tmpdir(), "scenarioforge-journal-"));
  resetJournalCache();
});

afterEach(async () => {
  resetJournalCache();
  await rm(projectRoot, { recursive: true, force: true });
});

/** 커밋 하나를 실제 journal 에 남긴다. */
async function commitOnce(projectId: string) {
  const repository = new JournalRepository(projectRoot);
  const coordinator = new RuntimeStateCoordinator(createInitialProjectRuntimeState(projectId), repository);
  await coordinator.commit({ type: "project.ready", projectId, operationId: randomUUID(), expectedRevision: 0 });
}

describe("verified journal cache", () => {
  it("returns nothing when the project has no journal", async () => {
    await expect(getVerifiedJournal(projectRoot)).resolves.toBeUndefined();
  });

  /* chain 검증은 genesis 부터 전체를 다시 읽는다. 화면마다 다시 검증하면
   * revision 이 쌓일수록 탭 진입이 느려진다. 같은 chain 은 한 번만 검증한다. */
  it("verifies an unchanged chain only once", async () => {
    await commitOnce("PRJ-1");
    const spy = vi.spyOn(JournalRepository.prototype, "recoverLatest");

    const first = await getVerifiedJournal(projectRoot);
    const second = await getVerifiedJournal(projectRoot);

    expect(first?.revision).toBe(1);
    expect(second).toBe(first);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  // 새 커밋이 붙으면 캐시된 head 는 낡은 값이다. 다시 검증해야 한다.
  it("re-verifies after a new commit is appended", async () => {
    await commitOnce("PRJ-1");
    expect((await getVerifiedJournal(projectRoot))?.revision).toBe(1);

    const repository = new JournalRepository(projectRoot);
    const latest = await repository.recoverLatest();
    const coordinator = new RuntimeStateCoordinator(latest!.state, repository);
    await coordinator.commit({ type: "analysis.recover", projectId: "PRJ-1", operationId: randomUUID(), expectedRevision: 1 });

    expect((await getVerifiedJournal(projectRoot))?.revision).toBe(2);
  });
});
