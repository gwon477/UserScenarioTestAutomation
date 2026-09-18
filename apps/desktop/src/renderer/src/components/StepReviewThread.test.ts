import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const source = () => readFile(new URL("./StepReviewThread.tsx", import.meta.url), "utf8");

describe("step review thread", () => {
  it("states that the automatic verdict is not replaced", async () => {
    const code = await source();

    expect(code).toContain("자동 판정은 그대로 남습니다");
    expect(code).not.toContain("verdict");
  });

  it("offers the four review decisions as radios", async () => {
    const code = await source();

    expect(code).toContain("REVIEW_DECISION_OPTIONS.map");
    expect(code).toContain('name="review-decision"');
  });

  it("offers the measured cause tags so they can be aggregated", async () => {
    const code = await source();

    expect(code).toContain("REVIEW_CAUSE_TAG_OPTIONS.map");
  });

  it("requires an author so a record is attributable", async () => {
    const code = await source();

    expect(code).toContain("author.trim().length > 0");
    expect(code).toContain("검토자를 입력하세요");
  });

  it("is not a modal so the evidence stays visible while writing", async () => {
    const code = await source();

    expect(code).not.toContain('role="dialog"');
    expect(code).not.toContain("aria-modal");
  });

  it("confirms a save with a status message rather than silently closing", async () => {
    const code = await source();

    expect(code).toContain('role="status"');
    expect(code).toContain("검토를 기록했습니다");
  });
});
