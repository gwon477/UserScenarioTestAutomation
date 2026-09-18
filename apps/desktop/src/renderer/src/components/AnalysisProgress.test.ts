import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("analysis retry progress", () => {
  it("renders a sanitized harness message in the live operation region", async () => {
    const source = await readFile(new URL("./AnalysisProgress.tsx", import.meta.url), "utf8");

    expect(source).toContain("message?: string");
    expect(source).toContain("message ??");
    expect(source).toContain('className="card flat actrow" role="status" aria-live="polite"');
    expect(source).toContain('aria-label="세부 생성 단계"');
    expect(source).toContain("GENERATION_STEPS");
    expect(source).toContain("index < completedSteps");
    expect(source).toContain('["src", "fact", "wiki", "scenario"].indexOf(stage)');
    expect(source).not.toContain("index < currentIndex ||");
  });
});
