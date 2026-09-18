import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const source = () => readFile(new URL("./ScenarioSheet.tsx", import.meta.url), "utf8");

describe("scenario sheet readiness", () => {
  it("derives readiness from the backend projection rather than the row itself", async () => {
    const code = await source();

    expect(code).toContain("readiness?: Readonly<Record<string, ScenarioReadinessView>>");
    expect(code).toContain("readinessByScenario?.[scenario.id]");
  });

  it("names every compile blocker in user language", async () => {
    const code = await source();

    for (const reason of [
      "NO_VISUAL_TARGET_EVIDENCE",
      "AMBIGUOUS_VISUAL_TARGET",
      "ACTION_KIND_UNRESOLVED",
      "ACTION_KIND_UNSUPPORTED",
      "MISSING_ASSERTION_REFERENCE",
      "EDGE_NOT_FOUND",
      "ELEMENT_NOT_FOUND",
    ]) {
      expect(code).toContain(`${reason}:`);
    }
  });

  it("shows the reason inline rather than only in a tooltip", async () => {
    const code = await source();

    expect(code).toContain("const tone = state ? readiness[state.state] : undefined;");
    expect(code).toContain('className={`chip ${tone.tone}`}');
    expect(code).toContain("state.blockers.map((blocker) => blockerLabels[blocker.reason])");
  });

  it("disables a blocked case instead of hiding it", async () => {
    const code = await source();

    expect(code).toContain("disabled={blocked}");
  });

  it("selects only runnable cases with the header checkbox", async () => {
    const code = await source();

    expect(code).toContain('(readinessByScenario?.[scenario.id]?.state ?? "ready") !== "blocked"');
    expect(code).toContain("new Set(selectableIds)");
  });

  it("says how many values a data-required case still needs", async () => {
    const code = await source();

    expect(code).toContain("state.missingBindings.length}개 값 필요");
  });
});
