import { join, resolve } from "node:path";
import { DefaultResourceLoader, loadSkills, type ResourceLoader as PiSdkResourceLoader } from "@earendil-works/pi-coding-agent";
import { ResourceLoader } from "./resource-loader.js";

export async function createGenerationPiResourceLoader(input: {
  projectRoot: string;
  runtimeRoot: string;
  expectedPolicies: Record<string, unknown>;
  modelRoles: Array<"author" | "reviewer">;
  modelRole: "author" | "reviewer";
  workKind: string;
}): Promise<PiSdkResourceLoader> {
  const bundle = await new ResourceLoader(input.runtimeRoot).loadGeneration(input.expectedPolicies, input.modelRoles);
  const resource = bundle.manifest.workKinds[input.workKind];
  if (!resource || resource.harnessDomain !== "generation") throw new Error("GENERATION_RESOURCE_NOT_FOUND");
  const systemPrompt = [bundle.resources["SYSTEM.md"], bundle.resources["AGENTS.md"], bundle.resources["WORK_PROTOCOL.md"], bundle.resources[resource.harnessPath]].filter(Boolean).join("\n\n");
  const roleResources = resource.roleResources[input.modelRole];
  if (!roleResources) throw new Error("GENERATION_ROLE_RESOURCE_NOT_FOUND");
  const skillPaths = roleResources.skillPaths.map((path) => resolve(input.runtimeRoot, path));
  const declaredSkills = loadSkills({ cwd: input.projectRoot, agentDir: input.runtimeRoot, skillPaths, includeDefaults: false });
  const loader = new DefaultResourceLoader({
    cwd: input.projectRoot,
    agentDir: input.runtimeRoot,
    additionalSkillPaths: skillPaths,
    noExtensions: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    systemPrompt,
    skillsOverride: () => declaredSkills,
    agentsFilesOverride: () => ({ agentsFiles: roleResources.agentPaths.map((path) => ({ path: join(input.runtimeRoot, path), content: bundle.resources[path] })) }),
  });
  await loader.reload();
  return loader;
}
