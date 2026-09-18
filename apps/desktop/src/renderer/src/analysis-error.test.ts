import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("analysis failure feedback", () => {
  it("keeps the workspace in an explicit error state when analysis rejects", async () => {
    const source = await readFile(new URL("./App.tsx", import.meta.url), "utf8");

    /* 실패한 단계를 알 수 있어야 하므로 진행률은 되돌리지 않는다. 상태가
     * 명시적으로 error 로 가는 것이 요점이고, 표시할 코드는 분류를 거친다. */
    expect(source).toContain('status: "error",');
    expect(source).toContain("progress: current.progress,");
    expect(source).toContain("classifyAnalysisError(error)");
    expect(source).not.toMatch(
      /catch\s*\{\s*setAnalysis\(\{ status: "idle", progress: 0 \}\);\s*\}/,
    );
  });

  it("labels an analysis failure as an analysis failure", async () => {
    const source = await readFile(new URL("./App.tsx", import.meta.url), "utf8");

    expect(source).toContain("ANALYSIS FAILED");
    expect(source).toContain("단계를 완료하지 못했습니다");
  });

  it("keeps fresh analysis available when a verified checkpoint can continue", async () => {
    const source = await readFile(new URL("./App.tsx", import.meta.url), "utf8");

    expect(source).toContain("새 분석 시작");
    expect(source).toContain("onStartAnalysis={() => void handleStartAnalysis()}");
    expect(source).not.toContain("onStartAnalysis={handleStartAnalysis}");
    expect(source).toContain('onStartNewAnalysis={() => void handleStartAnalysis("new")}');
    expect(source).toContain('modeOverride ?? analysis.startMode');
  });

  it("keeps fresh analysis available after the scenario stage completes", async () => {
    const source = await readFile(new URL("./App.tsx", import.meta.url), "utf8");

    expect(source).toMatch(/analysis\.status === "complete"[\s\S]*onClick=\{onStartNewAnalysis\}[\s\S]*새 분석 시작/);
  });
});
