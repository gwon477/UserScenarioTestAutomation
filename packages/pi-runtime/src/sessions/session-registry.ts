export type SessionRecord = {
  sessionId: string;
  projectId: string;
  workId: string;
  source: "analysis" | "scenario-chat" | "test-planning";
  status: "created" | "disposed";
};

export class SessionRegistry {
  private readonly records = new Map<string, SessionRecord>();

  add(record: SessionRecord): void {
    if (this.records.has(record.sessionId)) throw new Error("SESSION_ALREADY_REGISTERED");
    this.records.set(record.sessionId, Object.freeze({ ...record }));
  }

  get(sessionId: string): SessionRecord | undefined {
    const record = this.records.get(sessionId);
    return record ? { ...record } : undefined;
  }

  dispose(sessionId: string): void {
    const record = this.records.get(sessionId);
    if (!record) throw new Error("SESSION_NOT_FOUND");
    this.records.set(sessionId, { ...record, status: "disposed" });
  }
}
