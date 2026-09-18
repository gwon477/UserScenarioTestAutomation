import { describe, expect, it } from "vitest";
import { formatBytes, formatDateTime } from "./format";

describe("list formatting", () => {
  it("shows a 24-hour time without seconds, like the mockup", () => {
    // 오전/오후와 초는 목록에서 결정에 쓰이지 않고 컬럼 폭만 먹는다.
    const shown = formatDateTime("2026-09-07T06:42:00.000Z");

    expect(shown).not.toMatch(/오전|오후/);
    expect(shown).not.toMatch(/:\d\d:\d\d/);
    expect(shown).toMatch(/2026/);
  });

  it("says so instead of inventing a time", () => {
    expect(formatDateTime(undefined)).toBe("시각 미기록");
    expect(formatDateTime(undefined, "생성 시각 미기록")).toBe("생성 시각 미기록");
    // 파싱할 수 없으면 원문을 그대로 보여준다. 날짜를 만들어내지 않는다.
    expect(formatDateTime("not-a-date")).toBe("not-a-date");
  });

  it("scales the byte unit so a small value is not shown as zero", () => {
    // 201 B 를 「0 KB」로 내리면 증적이 없다고 읽힌다.
    expect(formatBytes(201)).toBe("201 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(52_428_800)).toBe("50.0 MB");
    expect(formatBytes(1_288_490_189)).toBe("1.2 GB");
  });
});
