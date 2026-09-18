import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type ArtifactIndexRow = {
  transactionId: string;
  stateRevision: number;
  artifactId: string;
  relatedId: string;
  contentHash: string;
  artifactType?: string;
  artifactPath?: string;
};

export type CanonicalCommitLookup = (transactionId: string, stateRevision: number, contentHash: string) => boolean;

export class ArtifactIndex {
  private readonly database: DatabaseSync;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.database = new DatabaseSync(path);
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS artifact_relations (
        transaction_id TEXT NOT NULL,
        state_revision INTEGER NOT NULL,
        artifact_id TEXT NOT NULL,
        related_id TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        artifact_type TEXT,
        artifact_path TEXT,
        PRIMARY KEY (transaction_id, artifact_id, related_id)
      );
      CREATE INDEX IF NOT EXISTS artifact_related_revision ON artifact_relations (related_id, state_revision);
    `);
  }

  insert(rows: ArtifactIndexRow[]): void {
    const statement = this.database.prepare(`
      INSERT OR REPLACE INTO artifact_relations
        (transaction_id, state_revision, artifact_id, related_id, content_hash, artifact_type, artifact_path)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    this.database.exec("BEGIN IMMEDIATE");
    try {
      for (const row of rows) statement.run(row.transactionId, row.stateRevision, row.artifactId, row.relatedId, row.contentHash, row.artifactType ?? null, row.artifactPath ?? null);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  queryByRelatedId(relatedId: string, canonicalRevision: number, isCanonicalCommit: CanonicalCommitLookup): ArtifactIndexRow[] {
    const rows = this.database.prepare(`
      SELECT transaction_id, state_revision, artifact_id, related_id, content_hash, artifact_type, artifact_path
      FROM artifact_relations WHERE related_id = ? AND state_revision <= ? ORDER BY state_revision, artifact_id
    `).all(relatedId, canonicalRevision) as Array<Record<string, string | number | null>>;
    return rows.map((row) => ({
      transactionId: String(row.transaction_id), stateRevision: Number(row.state_revision), artifactId: String(row.artifact_id),
      relatedId: String(row.related_id), contentHash: String(row.content_hash), artifactType: row.artifact_type ? String(row.artifact_type) : undefined,
      artifactPath: row.artifact_path ? String(row.artifact_path) : undefined,
    })).filter((row) => isCanonicalCommit(row.transactionId, row.stateRevision, row.contentHash));
  }

  close(): void { this.database.close(); }
}
