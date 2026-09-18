import { createHash } from "node:crypto";

export type RuntimeResourceManifest = {
  runtimeVersion: string;
  protocolVersion: string;
  protocolHash: string;
  modelRoles: Array<"author" | "reviewer">;
  workKinds: Record<string, {
    harnessDomain: "generation" | "scenario-query" | "execution-planning";
    protocolVersion: string;
    executors: Array<"deterministic" | "author" | "reviewer" | "compiler">;
    policyHash: string;
    harnessPath: string;
    roleResources: Partial<Record<"author" | "reviewer", { skillPaths: string[]; agentPaths: string[] }>>;
  }>;
};

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, stable(entry)]));
  return value;
}

export function hashWorkPolicy(policy: unknown): string {
  return createHash("sha256").update(JSON.stringify(stable(policy))).digest("hex");
}
