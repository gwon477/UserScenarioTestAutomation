import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import type { RuntimeResourceManifest } from "./resource-manifest.js";
import { hashWorkPolicy } from "./resource-manifest.js";

type RuntimeFileManifest = { runtimeVersion: string; protocolVersion: string; files: Record<string, string> };
type Declaration = {
  schemaVersion: 1;
  protocolVersion: string;
  workKinds: Record<string, Omit<RuntimeResourceManifest["workKinds"][string], "protocolVersion" | "policyHash">>;
};
export type LoadedResourceBundle = { manifest: RuntimeResourceManifest; resources: Record<string, string> };

const sha = (content: Buffer | string): string => createHash("sha256").update(content).digest("hex");
const inside = (root: string, path: string): boolean => { const value = relative(root, path); return value === "" || (value !== ".." && !value.startsWith(`..${sep}`)); };

export class ResourceLoader {
  constructor(private readonly runtimeRoot: string) {}

  async loadGeneration(expectedPolicies: Record<string, unknown>, modelRoles: Array<"author" | "reviewer">): Promise<LoadedResourceBundle> {
    const runtimeRoot = await realpath(this.runtimeRoot);
    const runtimeManifest = JSON.parse(await readFile(join(runtimeRoot, "runtime-manifest.json"), "utf8")) as RuntimeFileManifest;
    const declaration = JSON.parse(await readFile(join(runtimeRoot, "resource-declaration.json"), "utf8")) as Declaration;
    if (declaration.protocolVersion !== runtimeManifest.protocolVersion) throw new Error("PROTOCOL_VERSION_MISMATCH");
    const protocol = await readFile(join(runtimeRoot, "WORK_PROTOCOL.md"));
    if (runtimeManifest.files["WORK_PROTOCOL.md"] !== sha(protocol)) throw new Error("PROTOCOL_HASH_MISMATCH");
    const resources: Record<string, string> = {};
    for (const fixedPath of ["SYSTEM.md", "AGENTS.md", "WORK_PROTOCOL.md"]) {
      const content = await readFile(join(runtimeRoot, fixedPath));
      if (runtimeManifest.files[fixedPath] !== sha(content)) throw new Error("RESOURCE_HASH_MISMATCH");
      resources[fixedPath] = content.toString("utf8");
    }
    const workKinds: RuntimeResourceManifest["workKinds"] = {};
    for (const [workKind, declared] of Object.entries(declaration.workKinds)) {
      if (declared.harnessDomain !== "generation") throw new Error("RESOURCE_DOMAIN_MIXED");
      const policy = expectedPolicies[workKind];
      if (!policy) throw new Error("WORK_POLICY_MISSING");
      const paths = [declared.harnessPath, ...Object.values(declared.roleResources).flatMap((role) => [...role.skillPaths, ...role.agentPaths])];
      for (const resourcePath of paths) {
        const path = await realpath(resolve(runtimeRoot, resourcePath));
        if (!inside(runtimeRoot, path)) throw new Error("RESOURCE_PATH_ESCAPE");
        const content = await readFile(path);
        if (runtimeManifest.files[resourcePath] !== sha(content)) throw new Error("RESOURCE_HASH_MISMATCH");
        resources[resourcePath] = content.toString("utf8");
      }
      workKinds[workKind] = { ...declared, protocolVersion: declaration.protocolVersion, policyHash: hashWorkPolicy(policy) };
    }
    const unexpected = Object.keys(expectedPolicies).filter((kind) => kind.startsWith("analysis.") && !workKinds[kind]);
    if (unexpected.length) throw new Error("RESOURCE_WORK_KIND_MISSING");
    return { manifest: { runtimeVersion: runtimeManifest.runtimeVersion, protocolVersion: declaration.protocolVersion, protocolHash: sha(protocol), modelRoles, workKinds }, resources };
  }
}
