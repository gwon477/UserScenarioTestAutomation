import { Type, type TSchema } from "@earendil-works/pi-ai";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";

export type StagingJsonToolOptions = { resolveWorkId?: () => string; resolveExpectedArtifactId?: () => string | undefined };
export function createStagingJsonTool(workId: string, write: (workId: string, artifactId: string, value: unknown) => Promise<{ path: string; contentHash: string }>, expectedArtifactId?: string, options?: StagingJsonToolOptions): ToolDefinition {
  return defineTool({
    name: "staging.writeJson",
    label: "Write staging JSON",
    description: "Write one structured JSON artifact inside the current work staging scope. Returns its content hash for work.submitArtifacts.",
    parameters: expectedArtifactId ? Type.Object({ value: Type.Unknown() }) : Type.Object({ artifactId: Type.String(), value: Type.Unknown() }),
    executionMode: "sequential",
    async execute(_toolCallId, params) {
      const currentWorkId = options?.resolveWorkId?.() ?? workId;
      const artifactId = options?.resolveExpectedArtifactId?.() ?? expectedArtifactId ?? (params as { artifactId?: unknown }).artifactId;
      if (typeof artifactId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(artifactId)) throw new Error("INVALID_ARTIFACT_ID");
      const result = await write(currentWorkId, artifactId, params.value);
      const submission = { artifactId, stagingPath: `.scenarioforge/staging/${currentWorkId}/${artifactId}.json`, contentHash: result.contentHash };
      return { content: [{ type: "text", text: JSON.stringify(submission) }], details: submission };
    },
  });
}

export function createAnalysisArtifactTool(
  workId: string,
  artifactId: string,
  write: (workId: string, artifactId: string, value: unknown) => Promise<{ path: string; contentHash: string }>,
  valueSchema: TSchema = Type.Unknown(),
): ToolDefinition {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(artifactId)) throw new Error("INVALID_ARTIFACT_ID");
  return defineTool({
    name: "analysis.writeArtifact",
    label: "Write analysis artifact",
    description: "Write one locally validated, non-canonical analysis artifact. This does not submit or register a product artifact.",
    parameters: Type.Object({ value: valueSchema }),
    executionMode: "sequential",
    async execute(_toolCallId, params) {
      const result = await write(workId, artifactId, params.value);
      const receipt = { artifactId, path: result.path, contentHash: result.contentHash, canonical: false };
      return { content: [{ type: "text", text: JSON.stringify(receipt) }], details: receipt };
    },
  });
}
