import { describe, expect, it } from "vitest";
import type { FactScreen } from "@scenarioforge/contracts";
import { evaluateAssertions, resolveAssertions } from "./assertion-engine.js";

const identity = { project_id: "P-1", analysis_run_id: "RUN-1", source_snapshot_id: "SS-1" } as const;

const screen: FactScreen = {
  ...identity,
  schema_version: 3,
  screen_id: "SCR-002",
  route: "/dashboard",
  title: "대시보드",
  entry_guards: [],
  elements: [],
  apis: [],
  feedback: [
    { id: "FB-1", kind: "toast", text: "접수 완료", assertion: { kind: "visible-text", expected_shape: "접수번호가 발급되었습니다" }, evidence: [] },
    { id: "FB-2", kind: "chart", text: "", assertion: { kind: "pixel-diff", expected_shape: "" }, evidence: [] },
  ],
  displays: [{ id: "DP-1", shape: "table", assertion: { kind: "visible-text", expected_shape: "총 3건" }, evidence: [] }],
  status: "verified",
};

const frame = (...texts: string[]) => ({ texts });

describe("assertion resolution", () => {
  it("resolves a feedback reference, a display reference, and a destination screen", () => {
    const specs = resolveAssertions(["FB-1", "DP-1", "SCR-002"], [screen]);

    expect(specs).toEqual([
      { ref: "FB-1", kind: "visible-text", expectedShape: "접수번호가 발급되었습니다" },
      { ref: "DP-1", kind: "visible-text", expectedShape: "총 3건" },
      { ref: "SCR-002", kind: "screen-shown", anchorText: "대시보드" },
    ]);
  });

  it("marks an assertion kind it cannot observe from a screenshot as unsupported", () => {
    expect(resolveAssertions(["FB-2"], [screen])[0]).toMatchObject({ kind: "unsupported" });
    expect(resolveAssertions(["FB-missing"], [screen])[0]).toMatchObject({ kind: "unsupported" });
  });
});

describe("assertion evaluation", () => {
  it("passes visible text seen in any observation", () => {
    const specs = resolveAssertions(["FB-1"], [screen]);

    expect(evaluateAssertions(specs, [frame("무언가"), frame("접수번호가 발급되었습니다")]).verdict).toBe("PASSED");
  });

  it("fails visible text absent from every observation", () => {
    const specs = resolveAssertions(["FB-1"], [screen]);

    const result = evaluateAssertions(specs, [frame("오류가 발생했습니다"), frame("오류가 발생했습니다")]);

    expect(result.verdict).toBe("FAILED");
    expect(result.results[0]?.detail).toContain("expected text not observed");
  });

  it("ignores decoration and spacing when matching observed text", () => {
    const specs = resolveAssertions(["DP-1"], [screen]);

    expect(evaluateAssertions(specs, [frame("총  3 건")]).verdict).toBe("PASSED");
  });

  it("confirms a screen transition only across two stable observations", () => {
    const specs = resolveAssertions(["SCR-002"], [screen]);

    expect(evaluateAssertions(specs, [frame("대시보드"), frame("대시보드")]).verdict).toBe("PASSED");
    expect(evaluateAssertions(specs, [frame("대시보드")]).verdict).toBe("INCONCLUSIVE");
    expect(evaluateAssertions(specs, [frame("로그인"), frame("대시보드")]).verdict).toBe("INCONCLUSIVE");
    expect(evaluateAssertions(specs, [frame("로그인"), frame("로그인")]).verdict).toBe("FAILED");
  });

  it("never reports PASSED when anything is unobservable", () => {
    const specs = resolveAssertions(["FB-1", "FB-2"], [screen]);

    const result = evaluateAssertions(specs, [frame("접수번호가 발급되었습니다"), frame("접수번호가 발급되었습니다")]);

    expect(result.verdict).toBe("INCONCLUSIVE");
    expect(result.results.map((entry) => entry.verdict)).toEqual(["PASSED", "INCONCLUSIVE"]);
  });

  it("reports a proven mismatch as FAILED even beside an unobservable assertion", () => {
    const specs = resolveAssertions(["FB-1", "FB-2"], [screen]);

    expect(evaluateAssertions(specs, [frame("오류"), frame("오류")]).verdict).toBe("FAILED");
  });

  it("is inconclusive with no assertion or no observation", () => {
    expect(evaluateAssertions([], [frame("무엇이든")]).verdict).toBe("INCONCLUSIVE");
    expect(evaluateAssertions(resolveAssertions(["FB-1"], [screen]), []).verdict).toBe("INCONCLUSIVE");
  });
});
