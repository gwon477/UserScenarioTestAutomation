import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

/* 목업이 못으로 박은 정렬선. 세부 패널과 단계 목록은 상위 행의 특정 컬럼
 * 시작선에 맞춰야 하고, 그 값은 `padding + 첫 컬럼 + gap` 의 합이다.
 *
 * 컬럼 축을 바꾸면 이 합이 어긋나 화면이 조용히 틀어진다. 실측으로 맞는 것을
 * 확인한 뒤 여기서 고정한다.
 */

const system = () => readFile(new URL("./system.css", import.meta.url), "utf8");
const sheet = () =>
  readFile(new URL("../components/ScenarioSheet.tsx", import.meta.url), "utf8");

/* ID 컬럼 시작선 = padding + (앞선 컬럼 폭 + gap) 의 합.
 * 끌기 손잡이가 앞에 붙으면서 앞선 컬럼이 둘이 됐다. */
function columnStart(axis: string, index: number, padding: number, gap: number) {
  const columns = axis.trim().split(/\s+/).slice(0, index);
  return columns.reduce((left, column) => left + Number.parseFloat(column.replace("px", "")) + gap, padding);
}

describe("alignment contract", () => {
  it("aligns the scenario detail panel to the ID column start", async () => {
    const css = await system();
    const tsx = await sheet();

    const padding = Number.parseFloat(/--sp:\s*(\d+)px/.exec(css)![1]!);
    const gap = Number.parseFloat(/\.sheet-hd,\.sheet-rw\{[^}]*gap:(\d+)px/.exec(css)![1]!);
    // 세부 패널과 그룹 머리말은 같은 들여쓰기 토큰을 쓴다.
    const indent = Number.parseFloat(/--sc-ind:\s*(\d+)px/.exec(css)![1]!);
    expect(css).toContain(".sheet-dt{padding:12px 20px 16px var(--sc-ind)");
    expect(css).toContain("padding:0 var(--sp) 0 var(--sc-ind)");
    // 컬럼 축은 컴포넌트가 인라인으로 넘긴다. 목업과 같은 컬럼 리듬을 지켜야 한다.
    const axis = /"--sc":\s*"([^"]+)"/.exec(tsx)![1]!;

    // ID 는 세 번째 컬럼이다. 앞의 둘은 끌기 손잡이와 선택 체크박스다.
    expect(columnStart(axis, 2, padding, gap)).toBe(indent);
  });

  it("aligns the queue step list to the case title column start", async () => {
    const css = await system();

    const header = /\.qhd\{[^}]*grid-template-columns:(\d+)px[^;]*;gap:(\d+)px[^}]*padding:0 (\d+)px/.exec(css)!;
    const checkbox = Number.parseFloat(header[1]!);
    const gap = Number.parseFloat(header[2]!);
    const padding = Number.parseFloat(header[3]!);
    const stepsLeft = Number.parseFloat(/\.qsteps\{padding:0 [\d.]+px [\d.]+px (\d+)px/.exec(css)![1]!);

    expect(stepsLeft).toBe(padding + checkbox + gap);
  });

  it("keeps every list on one column axis so cells line up across rows", async () => {
    const css = await system();

    // `--cols` 없이는 행마다 폭이 달라져 세로 정렬이 깨진다.
    expect(css).toContain(".rows.tbl .row{display:grid;grid-template-columns:var(--cols)");
    expect(css).toMatch(/\.sheet-hd,\.sheet-rw\{display:grid;grid-template-columns:var\(--sc\)/);
  });

  it("fixes the summary number column so labels start at one line", async () => {
    const css = await system();

    expect(css).toMatch(/\.stat-row\{display:grid;grid-template-columns:\d+px \d+px minmax\(0,1fr\)/);
  });
});
