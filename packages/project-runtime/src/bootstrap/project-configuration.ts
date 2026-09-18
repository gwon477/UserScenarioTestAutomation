import { randomUUID } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type PersistedModelRole = {
  provider: string;
  api: string;
  modelId: string;
  endpoint: string;
  apiVersion?: string;
  credentialRef: string;
  dataPolicyAccepted: boolean;
};

export type ProjectConfiguration = {
  schemaVersion: 1;
  projectId: string;
  projectRoot: string;
  createdAt: string;
  modelRoles?: { author: PersistedModelRole; reviewer?: PersistedModelRole };
  sourcePolicy?: { include: string[]; exclude: string[] };
};

export async function readProjectConfiguration(projectRoot: string): Promise<ProjectConfiguration> {
  return JSON.parse(await readFile(join(projectRoot, ".scenarioforge", "project.json"), "utf8")) as ProjectConfiguration;
}

export async function updateProjectConfiguration(projectRoot: string, patch: Pick<ProjectConfiguration, "modelRoles" | "sourcePolicy">): Promise<ProjectConfiguration> {
  const path = join(projectRoot, ".scenarioforge", "project.json");
  const current = await readProjectConfiguration(projectRoot);
  const next = { ...current, ...patch };
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(next, null, 2), "utf8");
  await rename(temporary, path);
  return next;
}
