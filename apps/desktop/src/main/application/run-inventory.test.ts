import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listRunIds } from "./run-inventory";

let projectRoot: string;
const runsRoot = () => join(projectRoot, ".scenarioforge", "runs");

beforeEach(async () => {
  projectRoot = await mkdtemp(join(tmpdir(), "scenarioforge-runs-"));
});

afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
});

describe("run inventory", () => {
  it("returns nothing when the project has never been analyzed", async () => {
    expect(await listRunIds(projectRoot)).toEqual([]);
  });

  it("lists run directories and ignores files", async () => {
    await mkdir(join(runsRoot(), "RUN-b"), { recursive: true });
    await mkdir(join(runsRoot(), "RUN-a"), { recursive: true });
    await writeFile(join(runsRoot(), "notes.txt"), "x");

    expect(await listRunIds(projectRoot)).toEqual(["RUN-a", "RUN-b"]);
  });

  it("drops names that cannot be a run ID", async () => {
    await mkdir(join(runsRoot(), "RUN-ok"), { recursive: true });
    await mkdir(join(runsRoot(), "run with space"), { recursive: true });
    await mkdir(join(runsRoot(), "run.dot"), { recursive: true });

    expect(await listRunIds(projectRoot)).toEqual(["RUN-ok"]);
  });
});
