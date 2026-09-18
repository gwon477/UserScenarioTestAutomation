import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { createInitialProjectRuntimeState, type ProjectRuntimeState } from "@scenarioforge/contracts";
import { JournalRepository, renderWorkStateMarkdown } from "@scenarioforge/runtime-state";
import { writeFile } from "node:fs/promises";
import { ProjectPathPolicy } from "../path-policy/project-path-policy.js";

const disposableDirectories = ["runs", "sessions", "staging", "logs", "state"] as const;

async function exists(path: string): Promise<boolean> {
  try { await lstat(path); return true; } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function countFiles(path: string): Promise<number> {
  if (!(await exists(path))) return 0;
  const entries = await readdir(path, { withFileTypes: true });
  let count = 0;
  for (const entry of entries) count += entry.isDirectory() ? await countFiles(join(path, entry.name)) : entry.isFile() ? 1 : 0;
  return count;
}

export type ProjectHistoryResetResult = { removedFiles: number; resetDirectories: string[] };

export class ProjectHistoryReset {
  constructor(private readonly hooks: { afterQuarantine?: () => void | Promise<void> } = {}) {}

  async reset(projectRoot: string): Promise<ProjectHistoryResetResult> {
    const policy = await ProjectPathPolicy.create(projectRoot);
    const scenarioRoot = join(projectRoot, ".scenarioforge");
    await policy.assertManagedRuntimeRoot(scenarioRoot);
    const statePath = join(scenarioRoot, "state", "project-state.json");
    const project = JSON.parse(await readFile(join(scenarioRoot, "project.json"), "utf8")) as { projectId?: string };
    let previousState: Partial<ProjectRuntimeState> = {};
    try { previousState = JSON.parse(await readFile(statePath, "utf8")) as Partial<ProjectRuntimeState>; } catch {}
    const activeSession = Boolean(previousState.analysisRunId) && ["creating", "running", "retrying", "compacting", "cancelling"].includes(previousState.sessionStatus ?? "");
    if (activeSession || (previousState.activeStep && previousState.generationSteps?.[previousState.activeStep]?.status === "running")) throw new Error("HISTORY_RESET_ACTIVE_ANALYSIS");
    if (!project.projectId?.trim()) throw new Error("HISTORY_RESET_PROJECT_ID_MISSING");

    const removedFiles = (await Promise.all(disposableDirectories.map((name) => countFiles(join(scenarioRoot, name))))).reduce((sum, count) => sum + count, 0);
    const quarantine = join(scenarioRoot, `.history-reset-${randomUUID()}`);
    await mkdir(quarantine, { recursive: true });
    const moved: string[] = [];
    try {
      for (const name of disposableDirectories) {
        const source = join(scenarioRoot, name);
        if (!(await exists(source))) continue;
        await rename(source, join(quarantine, name));
        moved.push(name);
      }
      await this.hooks.afterQuarantine?.();
      await Promise.all([
        mkdir(join(scenarioRoot, "runs"), { recursive: true }),
        mkdir(join(scenarioRoot, "sessions", "analysis"), { recursive: true }),
        mkdir(join(scenarioRoot, "sessions", "chat"), { recursive: true }),
        mkdir(join(scenarioRoot, "sessions", "test-planning"), { recursive: true }),
        mkdir(join(scenarioRoot, "staging"), { recursive: true }),
        mkdir(join(scenarioRoot, "logs", "bootstrap"), { recursive: true }),
        mkdir(join(scenarioRoot, "logs", "agent"), { recursive: true }),
        mkdir(join(scenarioRoot, "logs", "system"), { recursive: true }),
        mkdir(join(scenarioRoot, "state", "checkpoints"), { recursive: true }),
        mkdir(join(scenarioRoot, "state", "work-items"), { recursive: true }),
        mkdir(join(scenarioRoot, "state", "orphans"), { recursive: true }),
        mkdir(join(scenarioRoot, "state", "evidence-grants"), { recursive: true }),
        mkdir(join(scenarioRoot, "state", "locks"), { recursive: true }),
      ]);
      const initial = {
        ...createInitialProjectRuntimeState(project.projectId),
        projectStatus: "ready" as const,
        runtimeStatus: "ready" as const,
        sessionStatus: "idle" as const,
        recoverable: false,
      };
      await new JournalRepository(projectRoot).initialize(initial);
      await writeFile(join(scenarioRoot, "state", "WORK_STATE.md"), renderWorkStateMarkdown(initial), "utf8");
      await rm(quarantine, { recursive: true, force: true });
      return { removedFiles, resetDirectories: [...moved] };
    } catch (error) {
      for (const name of disposableDirectories) await rm(join(scenarioRoot, name), { recursive: true, force: true });
      for (const name of moved) await rename(join(quarantine, name), join(scenarioRoot, name));
      await rm(quarantine, { recursive: true, force: true });
      throw error;
    }
  }
}
