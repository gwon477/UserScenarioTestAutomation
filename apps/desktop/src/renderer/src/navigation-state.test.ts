import { describe, expect, it } from "vitest";
import { appRouteHash, parseAppRoute } from "./navigation-state";

describe("application route state", () => {
  it("round-trips every supported project route", () => {
    const routes = [
      { view: "projects" as const },
      { view: "workspace" as const },
      { view: "runs" as const },
      { view: "executions" as const },
      { view: "scenario" as const },
      { view: "scenario" as const, scenarioId: "SCN-PAY-001" },
      { view: "test" as const, executionId: "EXE-20260826-0001" },
      { view: "evidence-library" as const },
      {
        view: "evidence-detail" as const,
        executionId: "EXE-20260826-0001",
        evidenceId: "EVD/PAY 001",
      },
    ];

    for (const route of routes) {
      expect(parseAppRoute(appRouteHash(route))).toEqual(route);
    }
  });

  it("rejects incomplete and malformed routes", () => {
    expect(parseAppRoute("" )).toBeNull();
    expect(parseAppRoute("#/executions/")).toEqual({ view: "executions" });
    expect(parseAppRoute("#/executions/a/b")).toBeNull();
    expect(parseAppRoute("#/evidence/only-one-id")).toBeNull();
    expect(parseAppRoute("#/scenarios/%E0%A4%A")).toBeNull();
    expect(parseAppRoute("#/unknown/place")).toBeNull();
  });
});
