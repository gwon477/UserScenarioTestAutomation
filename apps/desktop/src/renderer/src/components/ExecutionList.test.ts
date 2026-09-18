import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const source = () => readFile(new URL("./ExecutionList.tsx", import.meta.url), "utf8");

/* 목록 단위는 실행이 아니라 실행 안의 시나리오 케이스다. 실행 ID 만 늘어놓으면
 * 「어느 케이스가 어떻게 됐나」를 보려고 한 단계 더 들어가야 한다. */
describe("execution list structure", () => {
  it("lists the scenario cases inside each execution", async () => {
    const code = await source();

    expect(code).toContain("execution.cases.map");
    expect(code).toContain("testCase.scenarioId");
    expect(code).toContain("testCase.steps.map");
  });

  it("reaches step evidence from the case it belongs to", async () => {
    const code = await source();

    expect(code).toContain("onOpenStepEvidence(");
    expect(code).toContain("execution.scenarioRunId");
    expect(code).toContain("step.order");
  });

  // 증적이 없는 단계에 버튼을 두지 않는다. 눌러 보고 나서야 없다는 것을 알게 된다.
  it("only offers the evidence button when the step actually has evidence", async () => {
    const code = await source();

    expect(code).toContain("evidenceSteps");
    expect(code).toContain("hasEvidence ?");
    expect(code).toContain("증적 없음");
  });
});
