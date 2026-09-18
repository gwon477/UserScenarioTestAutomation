import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const source = () => readFile(new URL("./EvidenceLibraryTable.tsx", import.meta.url), "utf8");
/* 저장 용량 합계는 목업 S11 처럼 페이지 헤더가 소유한다. 표 안에서 한 번 더
 * 보여주면 같은 숫자가 두 곳에 생긴다. */
const page = () => readFile(new URL("./EvidenceLibrary.tsx", import.meta.url), "utf8");

describe("evidence library table", () => {
  it("filters on every axis the spec requires", async () => {
    const code = await source();

    for (const axis of ["verdict", "review", "reasonCode", "causeTag", "scenarioQuery"]) {
      expect(code).toContain(axis);
    }
  });

  it("aggregates cause tags and says what a repeat means", async () => {
    const code = await source();

    expect(code).toContain("library.totals.causeTags");
    expect(code).toContain("같은 원인이 반복되면 개별 케이스가 아니라 생성 산출물을 고쳐야 합니다");
  });

  it("lets a cause tag chip drive the filter", async () => {
    const code = await source();

    expect(code).toContain('setCauseTag(tag === causeTag ? "all" : tag)');
    expect(code).toContain("aria-pressed");
  });

  it("shows the storage size so growth is visible", async () => {
    const code = await page();

    expect(code).toContain("용량");
    expect(code).toContain("library.totals.bytes");
  });

  it("marks unreviewed evidence so review progress is visible", async () => {
    const code = await source();

    expect(code).toContain("미검토");
    expect(code).toContain("library.totals.reviewed");
  });

  it("says so when a filter matches nothing", async () => {
    const code = await source();

    expect(code).toContain("조건에 맞는 증적이 없습니다");
  });
});

/* 증적은 한 번의 실행에 속한다. 평평한 목록은 그 소속을 지운다. */
describe("evidence library grouping", () => {
  const source = () => readFile(new URL("./EvidenceLibraryTable.tsx", import.meta.url), "utf8");

  it("groups the evidence by execution and then by scenario case", async () => {
    const code = await source();

    expect(code).toContain("byExecution");
    expect(code).toContain("group.cases");
    expect(code).toContain("caseGroup.entries.map");
    expect(code).toContain("group.executionId");
    expect(code).toContain("caseGroup.scenarioId");
  });

  // 묶음은 필터를 통과한 행으로만 만든다.
  it("keeps the filters applied above the grouping", async () => {
    const code = await source();

    expect(code).toContain("for (const entry of rows)");
  });

  it("orders the steps inside a case by their step order", async () => {
    const code = await source();

    expect(code).toContain("caseGroup.entries.sort((left, right) => left.order - right.order)");
  });
});
