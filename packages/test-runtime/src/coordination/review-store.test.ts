import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { executionRoot } from "./execution-paths.js";
import { stepDirectoryName } from "./execution-writer.js";
import { ReviewStore } from "./review-store.js";

const RUN_ID = "RUN-review-01";
const EXECUTION_ID = "EXEC-review-01";
let projectRoot: string;
let store: ReviewStore;

const entry = {
  scenarioId: "SCN-1",
  stepId: "SCN-1#1",
  decision: "오탐" as const,
  causeTag: "앵커 부적절" as const,
  note: "앵커가 본문 문단에 묻혀 있었다",
  author: "이수민",
  at: "2026-09-07T00:00:00.000Z",
};

const ledgerPath = () =>
  join(executionRoot(projectRoot, RUN_ID, EXECUTION_ID), "cases", "SCN-1", stepDirectoryName("SCN-1#1"), "reviews.json");

beforeEach(async () => {
  projectRoot = await mkdtemp(join(tmpdir(), "scenarioforge-review-"));
  store = new ReviewStore(projectRoot, RUN_ID, EXECUTION_ID);
});

afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
});

describe("human review store", () => {
  it("records a review next to the step evidence", async () => {
    const review = await store.append(entry);

    expect(review).toMatchObject({ executionId: EXECUTION_ID, decision: "오탐", causeTag: "앵커 부적절", author: "이수민" });
    expect(review.reviewId).toMatch(/[0-9a-f-]{36}/);
    const ledger = JSON.parse(await readFile(ledgerPath(), "utf8"));
    expect(ledger).toMatchObject({ schemaVersion: 1, reviews: [{ reviewId: review.reviewId }] });
  });

  it("appends without touching earlier records", async () => {
    const first = await store.append(entry);
    const second = await store.append({ ...entry, decision: "동의", note: "확인했다", author: "박규제" });

    const reviews = await store.list("SCN-1", "SCN-1#1");
    expect(reviews.map((review) => review.reviewId)).toEqual([first.reviewId, second.reviewId]);
    expect(reviews[0]?.note).toBe("앵커가 본문 문단에 묻혀 있었다");
  });

  it("never writes a verdict field so the deterministic judgement stays untouched", async () => {
    await store.append(entry);

    const raw = await readFile(ledgerPath(), "utf8");
    expect(raw).not.toContain("verdict");
    expect(raw).not.toContain("PASSED");
  });

  it("returns an empty list when nothing has been reviewed", async () => {
    expect(await store.list("SCN-1", "SCN-1#1")).toEqual([]);
  });

  it("rejects an unknown decision or cause tag instead of storing it", async () => {
    await expect(store.append({ ...entry, decision: "좋음" as never })).rejects.toThrow("REVIEW_DECISION_INVALID");
    await expect(store.append({ ...entry, causeTag: "느낌" as never })).rejects.toThrow("REVIEW_CAUSE_TAG_INVALID");
  });

  it("requires an author so a record is attributable", async () => {
    await expect(store.append({ ...entry, author: "   " })).rejects.toThrow("REVIEW_AUTHOR_REQUIRED");
  });

  it("refuses an oversized note rather than truncating it", async () => {
    await expect(store.append({ ...entry, note: "가".repeat(2001) })).rejects.toThrow("REVIEW_NOTE_TOO_LONG");
  });

  it("keeps the record inside the execution tree even for a hostile scenario id", async () => {
    const review = await store.append({ ...entry, scenarioId: "../../escape" });

    expect(review.scenarioId).toBe("../../escape");
    const reviews = await store.list("../../escape", "SCN-1#1");
    expect(reviews).toHaveLength(1);
  });

  it("fails closed on a corrupted ledger instead of dropping records", async () => {
    const directory = join(executionRoot(projectRoot, RUN_ID, EXECUTION_ID), "cases", "SCN-1", stepDirectoryName("SCN-1#1"));
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "reviews.json"), JSON.stringify({ schemaVersion: 2, reviews: [] }));

    await expect(store.list("SCN-1", "SCN-1#1")).rejects.toThrow("REVIEW_LEDGER_INVALID");
  });
});
