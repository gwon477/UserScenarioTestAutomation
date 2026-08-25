import { describe, expect, it } from "vitest";
import { isScenarioResult, type ScenarioResult } from "./scenario";

const validResult: ScenarioResult = {
  runId: "run-001",
  generatedAt: "2026-08-25T08:00:00.000Z",
  storagePath: ".scenarioforge/runs/run-001/scenario-set.json",
  wikiPages: 1,
  groups: [
    {
      code: "ORD",
      name: "주문",
      scenarios: [
        {
          id: "SCN-ORD-001",
          title: "주문 완료",
          summary: "사용자가 주문을 완료한다.",
          precondition: "상품 재고가 있다.",
          source: "src/order.ts",
          steps: [
            {
              order: 1,
              action: "주문 버튼을 누른다.",
              expected: "주문 번호가 표시된다.",
            },
          ],
        },
      ],
    },
  ],
};

describe("isScenarioResult", () => {
  it("accepts a complete scenario result", () => {
    expect(isScenarioResult(validResult)).toBe(true);
  });

  it("rejects a result without scenario groups", () => {
    const { groups: _groups, ...incompleteResult } = validResult;

    expect(isScenarioResult(incompleteResult)).toBe(false);
  });

  it("rejects malformed scenario steps", () => {
    const malformedResult = {
      ...validResult,
      groups: validResult.groups.map((group) => ({
        ...group,
        scenarios: group.scenarios.map((scenario) => ({
          ...scenario,
          steps: scenario.steps.map((step) => ({ ...step, order: "first" })),
        })),
      })),
    };

    expect(isScenarioResult(malformedResult)).toBe(false);
  });
});
