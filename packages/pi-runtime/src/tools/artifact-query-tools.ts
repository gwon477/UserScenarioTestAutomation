export interface BoundedArtifactQuery {
  getById(id: string): Promise<unknown | null>;
  getClosure(sourceIds: string[], budget: number): Promise<unknown>;
  verify(id: string): Promise<unknown>;
}

export type ArtifactQueryTool = { name: string; invoke(input: Record<string, unknown>): Promise<unknown> };

export function createArtifactQueryTools(query: BoundedArtifactQuery): readonly ArtifactQueryTool[] {
  return [
    { name: "artifact.get", invoke: (input) => query.getById(requiredId(input)) },
    { name: "artifact.closure", invoke: (input) => {
      const budget = Number(input.budget ?? 120_000);
      if (!Array.isArray(input.sourceIds) || input.sourceIds.length === 0 || input.sourceIds.length > 64 || !Number.isFinite(budget) || budget < 1) throw new Error("INVALID_CLOSURE_REQUEST");
      return query.getClosure(input.sourceIds.map(String), Math.min(Math.floor(budget), 120_000));
    } },
    { name: "artifact.verify", invoke: (input) => query.verify(requiredId(input)) },
  ];
}

const requiredId = (input: Record<string, unknown>): string => {
  const id = input.id;
  if (typeof id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id)) throw new Error("INVALID_ARTIFACT_ID");
  return id;
};

const parameters = Type.Object({
  id: Type.Optional(Type.String()),
  sourceIds: Type.Optional(Type.Array(Type.String())),
  budget: Type.Optional(Type.Number()),
});

export function adaptArtifactQueryToolsForPi(tools: readonly ArtifactQueryTool[]): ToolDefinition[] {
  return tools.map((tool) => defineTool({
    name: tool.name,
    label: tool.name,
    description: `${tool.name} returns only a bounded, work-scoped ScenarioForge artifact view.`,
    parameters,
    executionMode: "sequential",
    async execute(_toolCallId, params) {
      try {
        const result = await tool.invoke(params as Record<string, unknown>);
        return { content: [{ type: "text", text: JSON.stringify(result) }], details: { ok: true } };
      } catch (error) {
        return { content: [{ type: "text", text: JSON.stringify({ ok: false, code: error instanceof Error ? error.message : "ARTIFACT_QUERY_FAILED" }) }], details: { ok: false } };
      }
    },
  }));
}
import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
