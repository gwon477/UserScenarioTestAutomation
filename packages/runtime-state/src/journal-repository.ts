import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { validateDomainEvent, validateProjectRuntimeState, type ProjectRuntimeState, type ScenarioForgeDomainEvent } from "@scenarioforge/contracts";

export type RuntimeCheckpoint = {
  checkpointId: string;
  revision: number;
  sessionId?: string;
  analysisRunId?: string;
  activeStage?: string;
  activeStep?: string;
  artifactHashes: Record<string, string>;
};

export type JournalCommit = {
  schemaVersion: 1;
  transactionId: string;
  previousRevision: number;
  revision: number;
  state: ProjectRuntimeState;
  checkpoint: RuntimeCheckpoint;
  event: ScenarioForgeDomainEvent;
  previousHash: string;
  hash: string;
};

const hashRecord = (record: Omit<JournalCommit, "hash">): string =>
  createHash("sha256").update(JSON.stringify(record)).digest("hex");

async function atomicWrite(path: string, content: string, transactionId: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${transactionId}.tmp`;
  await writeFile(temporaryPath, content, "utf8");
  const handle = await open(temporaryPath, "r");
  await handle.sync();
  await handle.close();
  await rename(temporaryPath, path);
}

export class JournalRepository {
  readonly stateRoot: string;
  readonly journalRoot: string;
  private latestCache?: JournalCommit;
  private cacheInitialized = false;

  constructor(projectRoot: string) {
    this.stateRoot = join(projectRoot, ".scenarioforge", "state");
    this.journalRoot = join(this.stateRoot, "journal");
  }

  async initialize(state: ProjectRuntimeState): Promise<void> {
    await mkdir(this.journalRoot, { recursive: true });
    await atomicWrite(join(this.stateRoot, "project-state.json"), JSON.stringify(state, null, 2), randomUUID());
    this.latestCache = undefined;
    this.cacheInitialized = true;
  }

  async append(input: Omit<JournalCommit, "schemaVersion" | "transactionId" | "previousHash" | "hash">): Promise<JournalCommit> {
    const latest = await this.recoverLatest();
    if ((latest?.revision ?? 0) !== input.previousRevision) throw new Error("JOURNAL_REVISION_CONFLICT");
    const base = {
      schemaVersion: 1 as const,
      transactionId: randomUUID(),
      ...input,
      previousHash: latest?.hash ?? "GENESIS",
    };
    const record: JournalCommit = { ...base, hash: hashRecord(base) };
    const journalPath = join(this.journalRoot, `${String(record.revision).padStart(12, "0")}.json`);
    await atomicWrite(journalPath, JSON.stringify(record, null, 2), record.transactionId);
    await atomicWrite(join(this.stateRoot, "project-state.json"), JSON.stringify(record.state, null, 2), record.transactionId);
    this.latestCache = record;
    this.cacheInitialized = true;
    return record;
  }

  async recoverLatest(): Promise<JournalCommit | undefined> {
    if (this.cacheInitialized) return this.latestCache;
    let names: string[] = [];
    try {
      names = (await readdir(this.journalRoot)).filter((name) => /^\d+\.json$/.test(name)).sort();
    } catch {
      this.cacheInitialized = true;
      return undefined;
    }
    let previousHash = "GENESIS";
    let previousRevision = 0;
    let latest: JournalCommit | undefined;
    for (const name of names) {
      try {
        const record = JSON.parse(await readFile(join(this.journalRoot, name), "utf8")) as JournalCommit;
        const { hash, ...unsigned } = record;
        const stateValidation = validateProjectRuntimeState(record.state);
        const eventValidation = validateDomainEvent(record.event, record.state.projectId);
        if (record.schemaVersion !== 1 || record.previousHash !== previousHash || record.previousRevision !== previousRevision || record.revision !== previousRevision + 1 || record.state.revision !== record.revision || record.event.revision !== record.revision || record.checkpoint.revision !== record.revision || !stateValidation.ok || !eventValidation.ok || hashRecord(unsigned) !== hash) break;
        latest = record;
        previousHash = record.hash;
        previousRevision = record.revision;
      } catch {
        break;
      }
    }
    this.latestCache = latest;
    this.cacheInitialized = true;
    return latest;
  }
}
