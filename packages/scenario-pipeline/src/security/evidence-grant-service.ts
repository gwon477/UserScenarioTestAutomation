import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { EvidenceReference, SourceSnapshot } from "@scenarioforge/contracts";
import { containsPotentialSecret } from "./secret-classifier.js";

export type EvidenceGrant = {
  schema_version: 1;
  evidence_grant_id: string;
  project_id: string;
  work_id: string;
  source_snapshot_id: string;
  evidence: EvidenceReference[];
  created_at: string;
};

export type GrantedEvidenceSlice = { evidence: EvidenceReference; content: string };
export type EvidenceGrantServiceOptions = { grantDirectory?: string };
export type FileEvidenceGrantOptions = { secretPolicy?: "reject" | "omit-source" };

export class EvidenceGrantService {
  private readonly grantDirectory: string;

  constructor(private readonly projectRoot: string, options: EvidenceGrantServiceOptions = {}) {
    this.grantDirectory = options.grantDirectory ?? join(this.projectRoot, ".scenarioforge", "state", "evidence-grants");
  }

  async create(snapshot: SourceSnapshot, workId: string, requests: Array<{ source_id: string; start_line: number; end_line: number }>): Promise<EvidenceGrant> {
    const grantId = `EVG-${workId}-${randomUUID().slice(0, 8)}`;
    const evidence: EvidenceReference[] = [];
    for (const request of requests) {
      const source = snapshot.files.find((file) => file.source_id === request.source_id);
      if (!source) throw new Error("SOURCE_ID_NOT_FOUND");
      const path = resolve(this.projectRoot, source.path);
      const relation = relative(resolve(this.projectRoot), path);
      if (relation === ".." || relation.startsWith(`..${sep}`) || isAbsolute(relation)) throw new Error("PROJECT_PATH_ESCAPE");
      const content = await readFile(path, "utf8");
      const currentHash = `sha256:${createHash("sha256").update(content).digest("hex")}`;
      if (currentHash !== source.content_hash) throw new Error("SOURCE_SNAPSHOT_HASH_MISMATCH");
      const lines = content.split(/\r?\n/);
      if (request.start_line < 1 || request.end_line < request.start_line || request.end_line > lines.length) throw new Error("EVIDENCE_RANGE_INVALID");
      const slice = lines.slice(request.start_line - 1, request.end_line).join("\n");
      if (containsPotentialSecret(slice)) throw new Error("EVIDENCE_SECRET_DETECTED");
      evidence.push({ source_id: source.source_id, source_snapshot_id: snapshot.source_snapshot_id, path: source.path, start_line: request.start_line, end_line: request.end_line, content_hash: `sha256:${createHash("sha256").update(slice).digest("hex")}`, evidence_grant_id: grantId });
    }
    const grant: EvidenceGrant = { schema_version: 1, evidence_grant_id: grantId, project_id: snapshot.project_id, work_id: workId, source_snapshot_id: snapshot.source_snapshot_id, evidence, created_at: new Date().toISOString() };
    await mkdir(this.grantDirectory, { recursive: true, mode: 0o700 });
    const path = join(this.grantDirectory, `${grantId}.json`);
    const temporary = `${path}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(grant, null, 2), { encoding: "utf8", mode: 0o600 });
    const handle = await open(temporary, "r");
    await handle.sync();
    await handle.close();
    await rename(temporary, path);
    return grant;
  }

  async createFileGrant(
    snapshot: SourceSnapshot,
    workId: string,
    sourceIds: readonly string[],
    byteBudget = 120_000,
    options: FileEvidenceGrantOptions = {},
  ): Promise<{ grant: EvidenceGrant; slices: GrantedEvidenceSlice[]; omitted: Array<{ source_id: string; reason: "EVIDENCE_SECRET_DETECTED" }> }> {
    const uniqueSourceIds = [...new Set(sourceIds)];
    const requests: Array<{ source_id: string; start_line: number; end_line: number }> = [];
    const omitted: Array<{ source_id: string; reason: "EVIDENCE_SECRET_DETECTED" }> = [];
    let selectedBytes = 0;
    for (const sourceId of uniqueSourceIds) {
      const source = snapshot.files.find((file) => file.source_id === sourceId);
      if (!source) throw new Error("SOURCE_ID_NOT_FOUND");
      const path = resolve(this.projectRoot, source.path);
      const relation = relative(resolve(this.projectRoot), path);
      if (relation === ".." || relation.startsWith(`..${sep}`) || isAbsolute(relation)) throw new Error("PROJECT_PATH_ESCAPE");
      const content = await readFile(path, "utf8");
      if (containsPotentialSecret(content)) {
        if (options.secretPolicy !== "omit-source") throw new Error("EVIDENCE_SECRET_DETECTED");
        omitted.push({ source_id: sourceId, reason: "EVIDENCE_SECRET_DETECTED" });
        continue;
      }
      selectedBytes += source.size_bytes;
      if (selectedBytes > byteBudget) throw new Error("SOURCE_EVIDENCE_BUDGET_EXCEEDED");
      requests.push({ source_id: sourceId, start_line: 1, end_line: content.split(/\r?\n/).length });
    }
    const grant = await this.create(snapshot, workId, requests);
    return { grant, slices: await this.readGrantedSlices(snapshot, grant), omitted };
  }

  async readGrantedSlices(snapshot: SourceSnapshot, grant: EvidenceGrant): Promise<GrantedEvidenceSlice[]> {
    if (grant.project_id !== snapshot.project_id || grant.source_snapshot_id !== snapshot.source_snapshot_id) throw new Error("EVIDENCE_GRANT_SCOPE_VIOLATION");
    const slices: GrantedEvidenceSlice[] = [];
    for (const evidence of grant.evidence) {
      this.assertEvidenceAllowed(grant, [evidence]);
      const source = snapshot.files.find((file) => file.source_id === evidence.source_id);
      if (!source || evidence.path !== source.path) throw new Error("EVIDENCE_SOURCE_MISMATCH");
      const path = resolve(this.projectRoot, source.path);
      const relation = relative(resolve(this.projectRoot), path);
      if (relation === ".." || relation.startsWith(`..${sep}`) || isAbsolute(relation)) throw new Error("PROJECT_PATH_ESCAPE");
      const content = await readFile(path, "utf8");
      if (`sha256:${createHash("sha256").update(content).digest("hex")}` !== source.content_hash) throw new Error("SOURCE_SNAPSHOT_HASH_MISMATCH");
      const lines = content.split(/\r?\n/);
      const slice = lines.slice(evidence.start_line - 1, evidence.end_line).join("\n");
      if (`sha256:${createHash("sha256").update(slice).digest("hex")}` !== evidence.content_hash) throw new Error("EVIDENCE_HASH_MISMATCH");
      if (containsPotentialSecret(slice)) throw new Error("EVIDENCE_SECRET_DETECTED");
      slices.push({ evidence, content: slice });
    }
    return slices;
  }

  assertEvidenceAllowed(grant: EvidenceGrant, references: EvidenceReference[]): void {
    const allowed = new Set(grant.evidence.map((item) => `${item.source_id}:${item.start_line}:${item.end_line}:${item.content_hash}`));
    for (const reference of references) {
      if (reference.evidence_grant_id !== grant.evidence_grant_id || !allowed.has(`${reference.source_id}:${reference.start_line}:${reference.end_line}:${reference.content_hash}`)) throw new Error("EVIDENCE_GRANT_VIOLATION");
    }
  }

  async verifyPersistedReferences(snapshot: SourceSnapshot, workId: string | readonly string[], references: EvidenceReference[]): Promise<void> {
    const allowedWorkIds = new Set(Array.isArray(workId) ? workId : [workId]);
    const byGrant = new Map<string, EvidenceReference[]>();
    for (const reference of references) {
      if (!/^EVG-[A-Za-z0-9._-]+$/.test(reference.evidence_grant_id)) throw new Error("EVIDENCE_GRANT_ID_INVALID");
      byGrant.set(reference.evidence_grant_id, [...(byGrant.get(reference.evidence_grant_id) ?? []), reference]);
    }
    for (const [grantId, grantedReferences] of byGrant) {
      const grant = JSON.parse(await readFile(join(this.grantDirectory, `${grantId}.json`), "utf8")) as EvidenceGrant;
      if (grant.schema_version !== 1 || grant.evidence_grant_id !== grantId || grant.project_id !== snapshot.project_id || grant.source_snapshot_id !== snapshot.source_snapshot_id || !allowedWorkIds.has(grant.work_id)) throw new Error("EVIDENCE_GRANT_SCOPE_VIOLATION");
      this.assertEvidenceAllowed(grant, grantedReferences);
      for (const reference of grantedReferences) {
        const source = snapshot.files.find((file) => file.source_id === reference.source_id);
        if (!source || reference.path !== source.path) throw new Error("EVIDENCE_SOURCE_MISMATCH");
        const path = resolve(this.projectRoot, source.path);
        const content = await readFile(path, "utf8");
        if (`sha256:${createHash("sha256").update(content).digest("hex")}` !== source.content_hash) throw new Error("SOURCE_SNAPSHOT_HASH_MISMATCH");
        const lines = content.split(/\r?\n/);
        if (reference.start_line < 1 || reference.end_line < reference.start_line || reference.end_line > lines.length) throw new Error("EVIDENCE_RANGE_INVALID");
        const slice = lines.slice(reference.start_line - 1, reference.end_line).join("\n");
        if (`sha256:${createHash("sha256").update(slice).digest("hex")}` !== reference.content_hash) throw new Error("EVIDENCE_HASH_MISMATCH");
      }
    }
  }
}
