import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";

export type RuntimeManifest = {
  schemaVersion: 1;
  runtimeVersion: string;
  protocolVersion: string;
  installedAt: string;
  files: Record<string, string>;
  bundleHash: string;
};

async function collectFiles(root: string, cursor = root): Promise<string[]> {
  const entries = await readdir(cursor, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(cursor, entry.name);
    if (entry.isDirectory()) files.push(...(await collectFiles(root, path)));
    else if (entry.isFile() && entry.name !== "runtime-manifest.json") files.push(path);
  }
  return files;
}

export async function createRuntimeManifest(runtimeRoot: string, runtimeVersion: string, protocolVersion: string): Promise<RuntimeManifest> {
  const files: Record<string, string> = {};
  for (const path of await collectFiles(runtimeRoot)) {
    files[relative(runtimeRoot, path)] = createHash("sha256").update(await readFile(path)).digest("hex");
  }
  const bundleHash = createHash("sha256").update(JSON.stringify(files)).digest("hex");
  return { schemaVersion: 1, runtimeVersion, protocolVersion, installedAt: new Date().toISOString(), files, bundleHash };
}
