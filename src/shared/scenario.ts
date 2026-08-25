export type ScenarioStep = {
  order: number;
  action: string;
  expected: string;
};

export type ScenarioCase = {
  id: string;
  title: string;
  summary: string;
  precondition: string;
  source: string;
  steps: ScenarioStep[];
};

export type ScenarioGroup = {
  code: string;
  name: string;
  scenarios: ScenarioCase[];
};

export type ScenarioResult = {
  runId: string;
  generatedAt: string;
  storagePath: string;
  wikiPages: number;
  groups: ScenarioGroup[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isScenarioResult(value: unknown): value is ScenarioResult {
  if (
    !isRecord(value) ||
    typeof value.runId !== "string" ||
    typeof value.generatedAt !== "string" ||
    typeof value.storagePath !== "string" ||
    typeof value.wikiPages !== "number" ||
    !Array.isArray(value.groups)
  ) {
    return false;
  }

  return value.groups.every(
    (group) =>
      isRecord(group) &&
      typeof group.code === "string" &&
      typeof group.name === "string" &&
      Array.isArray(group.scenarios) &&
      group.scenarios.every(
        (scenario) =>
          isRecord(scenario) &&
          typeof scenario.id === "string" &&
          typeof scenario.title === "string" &&
          typeof scenario.summary === "string" &&
          typeof scenario.precondition === "string" &&
          typeof scenario.source === "string" &&
          Array.isArray(scenario.steps) &&
          scenario.steps.every(
            (step) =>
              isRecord(step) &&
              typeof step.order === "number" &&
              typeof step.action === "string" &&
              typeof step.expected === "string",
          ),
      ),
  );
}
