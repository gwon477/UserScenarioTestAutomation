import { randomUUID } from "node:crypto";
import { cp, lstat, mkdir, readFile, readdir, realpath, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createInitialProjectRuntimeState } from "@scenarioforge/contracts";
import { JournalRepository, renderWorkStateMarkdown } from "@scenarioforge/runtime-state";
import { createRuntimeManifest, type RuntimeManifest } from "../manifest/runtime-manifest.js";
import { ProjectPathPolicy } from "../path-policy/project-path-policy.js";

export type BootstrapRequest = {
  projectRoot: string;
  projectId: string;
  runtimeVersion: string;
  protocolVersion: string;
  templateRoot?: string;
};

export type BootstrapResult = {
  projectRoot: string;
  scenarioForgeRoot: string;
  manifest: RuntimeManifest;
};

const runtimeTemplate = fileURLToPath(new URL("../../runtime-template", import.meta.url));

async function atomicJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2), "utf8");
  await rename(temporary, path);
}

async function assertNoSymlinkTree(root: string, recursive = true): Promise<void> {
  try {
    const rootStat = await lstat(root);
    if (rootStat.isSymbolicLink()) throw new Error("RUNTIME_SYMLINK_FORBIDDEN");
    if (!rootStat.isDirectory()) throw new Error("RUNTIME_ROOT_NOT_DIRECTORY");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    const entryStat = await lstat(path);
    if (entryStat.isSymbolicLink()) throw new Error("RUNTIME_SYMLINK_FORBIDDEN");
    if (recursive && entryStat.isDirectory()) await assertNoSymlinkTree(path);
  }
}

export class ProjectBootstrapper {
  async bootstrap(request: BootstrapRequest): Promise<BootstrapResult> {
    if (!request.projectId.trim()) throw new Error("EMPTY_PROJECT_ID");
    const projectRoot = await realpath(request.projectRoot);
    const policy = await ProjectPathPolicy.create(projectRoot);
    await policy.assertReadableProjectPath(projectRoot);
    const scenarioForgeRoot = join(projectRoot, ".scenarioforge");
    await policy.assertManagedRuntimeRoot(scenarioForgeRoot);
    await assertNoSymlinkTree(scenarioForgeRoot, false);
    await assertNoSymlinkTree(join(scenarioForgeRoot, "runtime"));
    await assertNoSymlinkTree(join(scenarioForgeRoot, "state"));
    const runtimeRoot = join(scenarioForgeRoot, "runtime");
    const directories = [
      "runtime/harnesses", "runtime/skills/generation", "runtime/skills/execution", "runtime/extensions", "runtime/agents/generation", "runtime/agents/execution",
      "sessions/analysis", "sessions/chat", "sessions/test-planning", "staging", "state/journal", "state/checkpoints", "state/work-items", "state/orphans",
      "state/evidence-grants", "state/locks", "runs", "logs/bootstrap", "logs/agent", "logs/system",
    ];
    await Promise.all(directories.map((path) => mkdir(join(scenarioForgeRoot, path), { recursive: true })));
    await cp(request.templateRoot ?? runtimeTemplate, runtimeRoot, { recursive: true, force: true });
    const manifest = await createRuntimeManifest(runtimeRoot, request.runtimeVersion, request.protocolVersion);
    await atomicJson(join(runtimeRoot, "runtime-manifest.json"), manifest);
    await atomicJson(join(scenarioForgeRoot, "manifest.json"), {
      schemaVersion: 1,
      projectId: request.projectId,
      runtimeVersion: request.runtimeVersion,
      runtimeBundleHash: manifest.bundleHash,
    });
    const projectPath = join(scenarioForgeRoot, "project.json");
    let existingProject: Record<string, unknown> = {};
    let projectCreatedAt = new Date().toISOString();
    try {
      existingProject = JSON.parse(await readFile(projectPath, "utf8")) as Record<string, unknown>;
      projectCreatedAt = typeof existingProject.createdAt === "string" ? existingProject.createdAt : projectCreatedAt;
    } catch {}
    await atomicJson(projectPath, { ...existingProject, schemaVersion: 1, projectId: request.projectId, projectRoot, createdAt: projectCreatedAt });
    const state = createInitialProjectRuntimeState(request.projectId);
    const statePath = join(scenarioForgeRoot, "state", "project-state.json");
    try {
      await readFile(statePath);
    } catch {
      const repository = new JournalRepository(projectRoot);
      await repository.initialize(state);
      await writeFile(join(scenarioForgeRoot, "state", "WORK_STATE.md"), renderWorkStateMarkdown(state), "utf8");
    }
    return { projectRoot, scenarioForgeRoot, manifest };
  }
}
