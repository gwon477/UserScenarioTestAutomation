import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ProjectRegistry } from "./project-registry";

let workspace: string;
let registryFile: string;
const AT = "2026-09-07T10:00:00.000Z";

/* 레지스트리는 경로를 정규화해 저장한다. macOS 의 /var -> /private/var 처럼
 * 심볼릭 링크가 걸린 임시 디렉터리에서는 기댓값도 정규화해야 한다. */
async function directory(name: string) {
  const path = join(workspace, name);
  await mkdir(path, { recursive: true });
  return await realpath(path);
}

beforeEach(async () => {
  workspace = await realpath(await mkdtemp(join(tmpdir(), "scenarioforge-registry-")));
  registryFile = join(workspace, "state", "projects.v2.json");
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

describe("project registry", () => {
  it("starts empty and never throws on a missing file", async () => {
    const registry = new ProjectRegistry(registryFile);

    expect(await registry.list()).toEqual([]);
    expect(await registry.load()).toBeNull();
  });

  it("reads a v1 single-path document as the first entry", async () => {
    const alpha = await directory("alpha");
    await mkdir(join(workspace, "state"), { recursive: true });
    await writeFile(registryFile, JSON.stringify({ schemaVersion: 1, path: alpha }));

    const registry = new ProjectRegistry(registryFile);

    expect((await registry.list()).map((entry) => entry.path)).toEqual([alpha]);
    expect(await registry.load()).toBe(alpha);
  });

  it("puts the most recently opened project first", async () => {
    const registry = new ProjectRegistry(registryFile);
    const alpha = await directory("alpha");
    const beta = await directory("beta");
    await registry.add(alpha, "2026-09-01T00:00:00.000Z");
    await registry.add(beta, "2026-09-02T00:00:00.000Z");
    await registry.touch(alpha, "2026-09-03T00:00:00.000Z");

    expect((await registry.list()).map((entry) => entry.path)).toEqual([alpha, beta]);
  });

  it("adding the same directory twice does not duplicate it", async () => {
    const registry = new ProjectRegistry(registryFile);
    const alpha = await directory("alpha");
    await registry.add(alpha, AT);
    await registry.add(alpha, "2026-09-08T00:00:00.000Z");

    expect(await registry.list()).toHaveLength(1);
  });

  it("refuses a path that is not a directory", async () => {
    const registry = new ProjectRegistry(registryFile);
    const file = join(workspace, "note.txt");
    await writeFile(file, "x");

    await expect(registry.add(file, AT)).rejects.toThrow("PROJECT_DIRECTORY_INVALID");
  });

  it("keeps an entry whose directory disappeared so the user can relink it", async () => {
    const registry = new ProjectRegistry(registryFile);
    const gone = await directory("gone");
    await registry.add(gone, AT);
    await rm(gone, { recursive: true, force: true });

    // 목록에는 남고, 마지막 열람 복원만 실패한다.
    expect((await registry.list()).map((entry) => entry.path)).toEqual([gone]);
    expect(await registry.load()).toBeNull();
  });

  it("disconnect returns the entry so it can be restored unchanged", async () => {
    const registry = new ProjectRegistry(registryFile);
    const alpha = await directory("alpha");
    await registry.add(alpha, AT);

    const removed = await registry.remove(alpha);
    expect(removed).toMatchObject({ path: alpha, addedAt: AT });
    expect(await registry.list()).toEqual([]);

    await registry.restore(removed!);
    expect(await registry.list()).toEqual([removed]);
  });

  it("relink moves the entry and keeps when it was added", async () => {
    const registry = new ProjectRegistry(registryFile);
    const before = await directory("before");
    const after = await directory("after");
    await registry.add(before, AT);
    await rm(before, { recursive: true, force: true });

    await registry.relink(before, after, "2026-09-09T00:00:00.000Z");

    expect(await registry.list()).toEqual([
      { path: after, addedAt: AT, lastOpenedAt: "2026-09-09T00:00:00.000Z" },
    ]);
  });

  it("writes the registry with owner-only permissions", async () => {
    const registry = new ProjectRegistry(registryFile);
    await registry.add(await directory("alpha"), AT);

    const document = JSON.parse(await readFile(registryFile, "utf8"));
    expect(document.schemaVersion).toBe(2);
  });
});
