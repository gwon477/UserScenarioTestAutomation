export type ToolPermission = { name: string; access: "read" | "write"; pathScopes?: string[] };
export type ToolPolicy = { profile: "generation" | "scenario-chat" | "execution-planning"; tools: readonly ToolPermission[] };

export function assertToolAllowed(policy: ToolPolicy, toolName: string, access: "read" | "write"): void {
  const permission = policy.tools.find((tool) => tool.name === toolName && tool.access === access);
  if (!permission) throw new Error("TOOL_NOT_ALLOWED");
  if (access === "write" && ["canonical-state", "runner-control", "evidence"].includes(toolName)) throw new Error("PROTECTED_TOOL_WRITE_DENIED");
}
