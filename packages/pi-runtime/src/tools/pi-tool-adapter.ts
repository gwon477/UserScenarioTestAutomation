import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { ArtifactSubmission } from "@scenarioforge/contracts";
import type { WorkToolDefinition } from "./work-state-tools.js";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function compactWorkToolResult(toolName: WorkToolDefinition["name"], result: unknown): unknown {
  if (toolName === "work.getContext" || !isRecord(result) || !isRecord(result.state)) return result;
  const revision = result.state.revision;
  if (!Number.isInteger(revision)) return result;

  const eventType = isRecord(result.event) && typeof result.event.eventType === "string"
    ? result.event.eventType
    : undefined;
  const workStateHash = typeof result.workStateHash === "string" ? result.workStateHash : undefined;
  return {
    ok: true,
    revision,
    ...(eventType ? { eventType } : {}),
    ...(workStateHash ? { workStateHash } : {}),
  };
}

const inputSchema = Type.Object({
  projectId: Type.Optional(Type.String()),
  sessionId: Type.Optional(Type.String()),
  workId: Type.Optional(Type.String()),
  expectedRevision: Type.Optional(Type.Number()),
  contextToken: Type.Optional(Type.String()),
  descriptor: Type.Optional(Type.Unknown()),
  progress: Type.Optional(Type.Number()),
  currentActivity: Type.Optional(Type.String()),
  activity: Type.Optional(Type.Unknown()),
  artifacts: Type.Optional(Type.Array(Type.Unknown())),
  artifactId: Type.Optional(Type.String()),
  reason: Type.Optional(Type.String()),
  error: Type.Optional(Type.Unknown()),
});

const serverScopedSubmissionSchema = Type.Object({
  projectId: Type.Optional(Type.String()),
  sessionId: Type.Optional(Type.String()),
  workId: Type.Optional(Type.String()),
  expectedRevision: Type.Optional(Type.Number()),
});

type PiWorkToolAdapterOptions = {
  latestArtifactSubmission?: () => ArtifactSubmission | undefined;
};

function piOwnedOperationId(tool: WorkToolDefinition["name"], toolCallId: string, params: Record<string, unknown>): string {
  const scope = ["projectId", "sessionId", "workId"]
    .map((key) => encodeURIComponent(typeof params[key] === "string" ? params[key] : "scoped"))
    .join(":");
  return `pi:${scope}:${tool}:${encodeURIComponent(toolCallId)}`;
}

export function adaptWorkToolsForPi(tools: readonly WorkToolDefinition[], options: PiWorkToolAdapterOptions = {}): ToolDefinition[] {
  return tools.map((tool) => defineTool({
    name: tool.name,
    label: tool.name,
    description: `ScenarioForge structured lifecycle operation ${tool.name}. Canonical state cannot be patched directly.`,
    parameters: tool.name === "work.submitArtifacts" && options.latestArtifactSubmission
      ? serverScopedSubmissionSchema
      : inputSchema,
    executionMode: "sequential",
    async execute(toolCallId, params) {
      try {
        const modelInput = params as Record<string, unknown>;
        let scopedInput = modelInput;
        if (tool.name === "work.submitArtifacts" && options.latestArtifactSubmission) {
          const submission = options.latestArtifactSubmission();
          if (!submission) throw new Error("STAGING_ARTIFACT_NOT_WRITTEN");
          scopedInput = { ...modelInput, artifacts: [submission] };
        }
        const input = tool.name === "work.getContext"
          ? scopedInput
          : { ...scopedInput, operationId: piOwnedOperationId(tool.name, toolCallId, scopedInput) };
        const result = await tool.invoke(input);
        return { content: [{ type: "text", text: JSON.stringify(compactWorkToolResult(tool.name, result)) }], details: { ok: true } };
      } catch (error) {
        return { content: [{ type: "text", text: JSON.stringify({ ok: false, code: error instanceof Error && "code" in error ? String((error as Error & { code: unknown }).code) : "TOOL_ERROR", message: error instanceof Error ? error.message : "Unknown tool error" }) }], details: { ok: false } };
      }
    },
  }));
}
