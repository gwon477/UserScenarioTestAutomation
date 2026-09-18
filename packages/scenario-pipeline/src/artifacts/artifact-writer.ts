import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { AnalysisStage } from "@scenarioforge/contracts";

export type PersistedArtifact = { artifactId: string; path: string; contentHash: string };

async function atomicWrite(path: string, content: string | Buffer): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, content);
  const handle = await open(temporary, "r");
  await handle.sync();
  await handle.close();
  await rename(temporary, path);
}

export class ArtifactWriter {
  constructor(private readonly projectRoot: string) {}

  async writeStagingJson(workId: string, artifactId: string, value: unknown): Promise<PersistedArtifact> {
    this.assertSafeSegment(workId, "WORK_ID");
    this.assertSafeSegment(artifactId, "ARTIFACT_ID");
    const directory = join(this.projectRoot, ".scenarioforge", "staging", workId);
    await mkdir(directory, { recursive: true });
    const content = `${JSON.stringify(value, null, 2)}\n`;
    const contentHash = createHash("sha256").update(content).digest("hex");
    const path = join(directory, `${artifactId}.json`);
    await atomicWrite(path, content);
    return { artifactId, path, contentHash };
  }

  async promoteJson(analysisRunId: string, stage: AnalysisStage, staged: PersistedArtifact): Promise<PersistedArtifact> {
    const stagingRoot = join(this.projectRoot, ".scenarioforge", "staging");
    if (!staged.path.startsWith(`${stagingRoot}/`)) throw new Error("STAGING_SCOPE_VIOLATION");
    const directory = stage === "scenario"
      ? join(this.projectRoot, ".scenarioforge", "runs", analysisRunId)
      : join(this.projectRoot, ".scenarioforge", "runs", analysisRunId, stage === "src" ? "source" : stage === "fact" ? "facts" : "wiki");
    await mkdir(directory, { recursive: true });
    const path = join(directory, stage === "scenario" && staged.artifactId.startsWith("SCENARIOS-") ? "scenario-set.json" : `${staged.artifactId}.json`);
    const content = await readFile(staged.path);
    if (createHash("sha256").update(content).digest("hex") !== staged.contentHash) throw new Error("STAGING_HASH_MISMATCH");
    await atomicWrite(path, content);
    return { ...staged, path };
  }

  async writeStageManifest(analysisRunId: string, stage: AnalysisStage, value: unknown): Promise<PersistedArtifact> {
    const directory = stage === "scenario"
      ? join(this.projectRoot, ".scenarioforge", "runs", analysisRunId)
      : join(this.projectRoot, ".scenarioforge", "runs", analysisRunId, stage === "src" ? "source" : stage === "fact" ? "facts" : "wiki");
    await mkdir(directory, { recursive: true });
    const path = join(directory, stage === "scenario" ? "scenario-manifest.json" : "manifest.json");
    const content = `${JSON.stringify(value, null, 2)}\n`;
    const contentHash = createHash("sha256").update(content).digest("hex");
    await atomicWrite(path, content);
    return { artifactId: `${stage}-manifest`, path, contentHash };
  }

  async writeJson(analysisRunId: string, stage: AnalysisStage, artifactId: string, value: unknown): Promise<PersistedArtifact> {
    this.assertSafeSegment(analysisRunId, "ANALYSIS_RUN_ID");
    this.assertSafeSegment(artifactId, "ARTIFACT_ID");
    const directory = stage === "scenario"
      ? join(this.projectRoot, ".scenarioforge", "runs", analysisRunId)
      : join(this.projectRoot, ".scenarioforge", "runs", analysisRunId, stage === "src" ? "source" : stage === "fact" ? "facts" : "wiki");
    await mkdir(directory, { recursive: true });
    const content = `${JSON.stringify(value, null, 2)}\n`;
    const contentHash = createHash("sha256").update(content).digest("hex");
    const path = join(directory, `${artifactId}.json`);
    await atomicWrite(path, content);
    return { artifactId, path, contentHash };
  }

  async recoverOrphans(analysisRunId: string, committedHashes: ReadonlySet<string>): Promise<string[]> {
    const runRoot = join(this.projectRoot, ".scenarioforge", "runs", analysisRunId);
    const orphanRoot = join(this.projectRoot, ".scenarioforge", "state", "orphans");
    await mkdir(orphanRoot, { recursive: true });
    const moved: string[] = [];
    const candidates: Array<{ directory: string; names?: ReadonlySet<string>; prefix?: string }> = [
      { directory: join(runRoot, "source") },
      { directory: join(runRoot, "facts") },
      { directory: join(runRoot, "wiki") },
      { directory: runRoot, names: new Set(["scenario-set.json", "coverage.json"]), prefix: "VERDICT-scenario-" },
    ];
    for (const candidate of candidates) {
      const directory = candidate.directory;
      try { await stat(directory); } catch { continue; }
      for (const name of (await readdir(directory)).filter((entry) => {
        if (!entry.endsWith(".json") || entry === "manifest.json") return false;
        if (!candidate.names && !candidate.prefix) return true;
        return candidate.names?.has(entry) || entry.startsWith(candidate.prefix!);
      }).sort()) {
        const path = join(directory, name);
        const hash = createHash("sha256").update(await readFile(path)).digest("hex");
        if (committedHashes.has(hash)) continue;
        let destination = join(orphanRoot, `${analysisRunId}-${basename(path)}`);
        try {
          await stat(destination);
          destination = join(orphanRoot, `${analysisRunId}-${randomUUID()}-${basename(path)}`);
        } catch {}
        await rename(path, destination);
        moved.push(destination);
      }
    }
    return moved;
  }

  private assertSafeSegment(value: string, label: string): void {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value) || value === "." || value === "..") throw new Error(`INVALID_${label}`);
  }
}
