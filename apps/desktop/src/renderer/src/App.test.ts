import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const source = () => readFile(new URL("./App.tsx", import.meta.url), "utf8");

describe("execution state ownership", () => {
  it("no longer assembles an execution in the renderer when a test is requested", async () => {
    const code = await source();

    expect(code).not.toContain("handleExecutionStarted");
    expect(code).not.toContain("onExecutionStarted");
  });

  it("keeps fixture execution assembly on the explicit preview path only", async () => {
    const code = await source();

    expect(code).toContain("if (previewMode === null) return;");
  });
});

describe("queued execution hydration", () => {
  it("reads the execution from the backend projection instead of building it", async () => {
    const code = await source();

    expect(code).toContain("await listTestExecutions(project, scenarioResult.runId)");
    expect(code).toContain("handleExecutionQueued");
    expect(code).not.toContain("createRendererExecutionId()\n      ),\n      targetUrl,");
  });

  it("does not navigate to the test center when the execution is not found", async () => {
    const code = await source();

    expect(code).toContain("if (!queued) return;");
  });
});

describe("demo preview", () => {
  it("starts on the launcher so the analyzed project can be opened", async () => {
    const code = await source();

    expect(code).toContain('if (mode === "demo") return "projects";');
  });

  it("seeds the launcher with one analyzed project card", async () => {
    const code = await source();

    expect(code).toContain("useState<ProjectSummary[]>(previewProjects)");
    expect(code).toContain("createDemoProjectSummary(");
  });

  it("fills the evidence tab from the same fixture executions", async () => {
    const code = await source();

    expect(code).toContain("createDemoEvidenceLibrary(previewHistory[0].runId)");
  });

  it("opens the analyzed project straight into the scenario cases", async () => {
    const code = await source();

    expect(code).toContain('setViewMode("result");\n      updateAppRoute({ view: "scenario" });');
  });

  it("carries the fixture execution history into the demo flow", async () => {
    const code = await source();

    expect(code).toMatch(/executionPreviewModes: PreviewMode\[\] = \[[^\]]*"demo",/s);
  });

  it("serves fixture cases instead of a canonical run while previewing", async () => {
    const code = await source();

    expect(code).toContain("setScenarioResult(createDemoScenarioResult(run.runId));");
  });

  /* 표본 화면을 실제 수행 결과로 제시하지 않는다. 배너를 지우면 이 검사가 깨진다. */
  it("marks every preview screen as sample data", async () => {
    const code = await source();

    expect(code).toContain("표본 데이터 (preview)");
    // 셸 배너 슬롯으로 전달해야 모든 화면에 걸린다.
    expect(code).toMatch(/banner: \(\s*<div className="notice warn"/);
  });
});
