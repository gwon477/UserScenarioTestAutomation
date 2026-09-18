export type AppRoute =
  | { view: "projects" }
  | { view: "workspace" }
  | { view: "runs" }
  | { view: "scenario"; scenarioId?: string }
  | { view: "executions" }
  | { view: "test"; executionId: string }
  | { view: "evidence-library" }
  | { view: "evidence-detail"; executionId: string; evidenceId: string };

function decodeSegment(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

export function parseAppRoute(hash: string): AppRoute | null {
  const path = hash.replace(/^#\/?/, "").replace(/\/$/, "");
  if (!path) return null;

  const segments = path.split("/");
  if (segments[0] === "workspace" && segments.length === 1) {
    return { view: "workspace" };
  }

  if (segments[0] === "projects" && segments.length === 1) {
    return { view: "projects" };
  }

  if (segments[0] === "runs" && segments.length === 1) {
    return { view: "runs" };
  }

  if (segments[0] === "executions" && segments.length === 1) {
    return { view: "executions" };
  }

  if (segments[0] === "scenarios" && segments.length <= 2) {
    const scenarioId = segments[1] ? decodeSegment(segments[1]) : undefined;
    if (segments[1] && !scenarioId) return null;
    return scenarioId ? { view: "scenario", scenarioId } : { view: "scenario" };
  }

  if (segments[0] === "executions" && segments.length === 2) {
    const executionId = decodeSegment(segments[1]);
    return executionId ? { view: "test", executionId } : null;
  }

  if (segments[0] === "evidence" && segments.length === 1) {
    return { view: "evidence-library" };
  }

  if (segments[0] === "evidence" && segments.length === 3) {
    const executionId = decodeSegment(segments[1]);
    const evidenceId = decodeSegment(segments[2]);
    return executionId && evidenceId
      ? { view: "evidence-detail", executionId, evidenceId }
      : null;
  }

  return null;
}

export function appRouteHash(route: AppRoute) {
  if (route.view === "projects") return "#/projects";
  if (route.view === "workspace") return "#/workspace";
  if (route.view === "runs") return "#/runs";
  if (route.view === "executions") return "#/executions";
  if (route.view === "scenario") {
    return route.scenarioId
      ? `#/scenarios/${encodeURIComponent(route.scenarioId)}`
      : "#/scenarios";
  }
  if (route.view === "test") {
    return `#/executions/${encodeURIComponent(route.executionId)}`;
  }
  if (route.view === "evidence-library") return "#/evidence";
  return `#/evidence/${encodeURIComponent(route.executionId)}/${encodeURIComponent(route.evidenceId)}`;
}
