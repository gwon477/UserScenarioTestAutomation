import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { executionRoot, stepDirectoryName } from "@scenarioforge/test-runtime";
import { loadEvidenceLibrary } from "./evidence-library-view";

const RUN_ID = "RUN-library-01";
let projectRoot: string;

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==",
  "base64",
);

async function seedStep(input: {
  executionId: string;
  scenarioId: string;
  stepId: string;
  verdict: "PASSED" | "FAILED" | "INCONCLUSIVE";
  reasonCode?: string;
  reviews?: Array<{ decision: string; causeTag?: string }>;
  createdAt?: string;
  runId?: string;
}) {
  const runId = input.runId ?? RUN_ID;
  const directory = join(
    executionRoot(projectRoot, runId, input.executionId),
    "cases",
    input.scenarioId,
    stepDirectoryName(input.stepId),
  );
  await mkdir(join(directory, "frames"), { recursive: true });
  await writeFile(join(directory, "frames", "model-input-1.png"), PNG);
  await writeFile(
    join(directory, "evidence.json"),
    JSON.stringify({
      schemaVersion: 1,
      stepId: input.stepId,
      verdict: input.verdict,
      ...(input.reasonCode ? { reason: { code: input.reasonCode, detail: "d" } } : {}),
      frameSpace: { captureSize: { width: 1, height: 1 }, modelSize: { width: 1, height: 1 }, scale: 1 },
      maskedRegions: [],
      attempts: [],
      assertions: [],
      observations: 1,
      frames: [],
    }),
  );
  if (input.reviews) {
    await writeFile(
      join(directory, "reviews.json"),
      JSON.stringify({
        schemaVersion: 1,
        reviews: input.reviews.map((review, index) => ({
          reviewId: `r${index}`,
          executionId: input.executionId,
          scenarioId: input.scenarioId,
          stepId: input.stepId,
          decision: review.decision,
          ...(review.causeTag ? { causeTag: review.causeTag } : {}),
          note: "",
          author: "이수민",
          at: "2026-09-07T00:00:00.000Z",
        })),
      }),
    );
  }
  await mkdir(executionRoot(projectRoot, runId, input.executionId), { recursive: true });
  await writeFile(
    join(executionRoot(projectRoot, runId, input.executionId), "manifest.json"),
    JSON.stringify({ schemaVersion: 1, executionId: input.executionId, createdAt: input.createdAt ?? "2026-09-07T00:00:00.000Z" }),
  );
}

beforeEach(async () => {
  projectRoot = await mkdtemp(join(tmpdir(), "scenarioforge-library-"));
});

afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
});

describe("evidence library view", () => {
  it("returns an empty view when nothing has run", async () => {
    const library = await loadEvidenceLibrary(projectRoot, RUN_ID);

    expect(library).toMatchObject({ runId: RUN_ID, entries: [], totals: { steps: 0, bytes: 0 } });
  });

  it("lists every recorded step with the axes a filter needs", async () => {
    await seedStep({ executionId: "EXEC-1", scenarioId: "SCN-1", stepId: "SCN-1#1", verdict: "PASSED" });
    await seedStep({
      executionId: "EXEC-1",
      scenarioId: "SCN-1",
      stepId: "SCN-1#2",
      verdict: "INCONCLUSIVE",
      reasonCode: "TARGET_NOT_FOUND",
      reviews: [{ decision: "오탐", causeTag: "라벨 화면 미표시" }],
    });

    const library = await loadEvidenceLibrary(projectRoot, RUN_ID);

    expect(library.entries).toHaveLength(2);
    expect(library.entries.map((entry) => entry.order)).toEqual([1, 2]);
    expect(library.entries[1]).toMatchObject({
      verdict: "INCONCLUSIVE",
      reasonCode: "TARGET_NOT_FOUND",
      reviewCount: 1,
      causeTags: ["라벨 화면 미표시"],
      decisions: ["오탐"],
      frameCount: 1,
    });
    expect(library.entries[1]?.bytes).toBeGreaterThan(0);
  });

  it("aggregates verdicts, reason codes and cause tags", async () => {
    await seedStep({ executionId: "EXEC-1", scenarioId: "SCN-1", stepId: "SCN-1#1", verdict: "PASSED" });
    await seedStep({
      executionId: "EXEC-1",
      scenarioId: "SCN-1",
      stepId: "SCN-1#2",
      verdict: "INCONCLUSIVE",
      reasonCode: "TARGET_NOT_FOUND",
      reviews: [{ decision: "오탐", causeTag: "라벨 화면 미표시" }],
    });
    await seedStep({
      executionId: "EXEC-2",
      scenarioId: "SCN-2",
      stepId: "SCN-2#1",
      verdict: "INCONCLUSIVE",
      reasonCode: "TARGET_NOT_FOUND",
      reviews: [{ decision: "오탐", causeTag: "라벨 화면 미표시" }],
      createdAt: "2026-09-08T00:00:00.000Z",
    });

    const library = await loadEvidenceLibrary(projectRoot, RUN_ID);

    expect(library.totals).toMatchObject({
      steps: 3,
      verdicts: { PASSED: 1, FAILED: 0, INCONCLUSIVE: 2 },
      reasonCodes: { TARGET_NOT_FOUND: 2 },
      // 같은 원인이 반복되면 생성 산출물을 고쳐야 한다는 신호다.
      causeTags: { "라벨 화면 미표시": 2 },
      reviewed: 2,
    });
  });

  it("puts the newest execution first", async () => {
    await seedStep({ executionId: "EXEC-old", scenarioId: "SCN-1", stepId: "SCN-1#1", verdict: "PASSED", createdAt: "2026-09-01T00:00:00.000Z" });
    await seedStep({ executionId: "EXEC-new", scenarioId: "SCN-1", stepId: "SCN-1#1", verdict: "PASSED", createdAt: "2026-09-09T00:00:00.000Z" });

    const library = await loadEvidenceLibrary(projectRoot, RUN_ID);

    expect(library.entries.map((entry) => entry.executionId)).toEqual(["EXEC-new", "EXEC-old"]);
  });

  /* 「증적」 탭은 프로젝트 범위다. 사용자가 보는 단위는 「내가 남긴 증적 전부」이고
   * 「run X의 증적」이 아니다. run 을 생략하면 모든 run 을 걸어 합쳐야 한다. */
  it("merges every run when no run is given", async () => {
    await seedStep({ runId: "RUN-a", executionId: "EXEC-a", scenarioId: "SCN-1", stepId: "SCN-1#1", verdict: "PASSED", createdAt: "2026-09-01T00:00:00.000Z" });
    await seedStep({
      runId: "RUN-b",
      executionId: "EXEC-b",
      scenarioId: "SCN-2",
      stepId: "SCN-2#1",
      verdict: "INCONCLUSIVE",
      reasonCode: "TARGET_NOT_FOUND",
      reviews: [{ decision: "오탐", causeTag: "라벨 화면 미표시" }],
      createdAt: "2026-09-09T00:00:00.000Z",
    });

    const library = await loadEvidenceLibrary(projectRoot);

    expect(library.runId).toBeUndefined();
    // 항목마다 소속 run 이 있어야 정본 증적을 어느 트리에서 읽을지 정할 수 있다.
    expect(library.entries.map((entry) => [entry.runId, entry.executionId])).toEqual([
      ["RUN-b", "EXEC-b"],
      ["RUN-a", "EXEC-a"],
    ]);
    expect(library.totals).toMatchObject({
      steps: 2,
      verdicts: { PASSED: 1, FAILED: 0, INCONCLUSIVE: 1 },
      reasonCodes: { TARGET_NOT_FOUND: 1 },
      causeTags: { "라벨 화면 미표시": 1 },
      reviewed: 1,
    });
  });

  it("skips an execution whose manifest does not match its directory", async () => {
    await seedStep({ executionId: "EXEC-1", scenarioId: "SCN-1", stepId: "SCN-1#1", verdict: "PASSED" });
    await writeFile(
      join(executionRoot(projectRoot, RUN_ID, "EXEC-1"), "manifest.json"),
      JSON.stringify({ schemaVersion: 1, executionId: "EXEC-other", createdAt: "2026-09-07T00:00:00.000Z" }),
    );

    expect((await loadEvidenceLibrary(projectRoot, RUN_ID)).entries).toEqual([]);
  });
});
