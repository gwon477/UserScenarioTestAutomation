import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ModelRoleSettings, ModelSettings } from "../../shared/desktop-api";

export type SafeStorageAdapter = {
  isEncryptionAvailable: () => boolean;
  encryptString: (plainText: string) => Buffer;
  decryptString: (encrypted: Buffer) => string;
};

export type ModelCredentialStatus = {
  storageAvailable: boolean;
  hasAuthorCredential: boolean;
  hasReviewerCredential: boolean;
};

type CredentialRole = "author" | "reviewer";
type StoredCredential = { identity: string; ciphertext: string };
type CredentialDocument = {
  schemaVersion: 1;
  author?: StoredCredential;
  reviewer?: StoredCredential;
};

function normalizedEndpoint(value: string): string {
  const endpoint = new URL(value);
  endpoint.username = "";
  endpoint.password = "";
  endpoint.search = "";
  endpoint.hash = "";
  return endpoint.toString().replace(/\/$/, "");
}

export function modelCredentialIdentity(role: CredentialRole, settings: ModelRoleSettings): string {
  const identity = JSON.stringify({
    role,
    provider: settings.provider,
    endpoint: normalizedEndpoint(settings.endpoint),
    ...(settings.provider === "azure-openai" ? { apiVersion: settings.apiVersion ?? "" } : {}),
  });
  return createHash("sha256").update(identity).digest("hex");
}

function isStoredCredential(value: unknown): value is StoredCredential {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<StoredCredential>;
  return typeof record.identity === "string" && Boolean(record.identity) && typeof record.ciphertext === "string" && Boolean(record.ciphertext);
}

function roleSettings(settings: ModelSettings, role: CredentialRole): ModelRoleSettings | undefined {
  return role === "author" ? settings : settings.reviewer;
}

export class ModelCredentialStore {
  constructor(
    private readonly filePath: string,
    private readonly protection: SafeStorageAdapter,
  ) {}

  async status(settings: ModelSettings): Promise<ModelCredentialStatus> {
    if (!this.protection.isEncryptionAvailable()) {
      return { storageAvailable: false, hasAuthorCredential: false, hasReviewerCredential: false };
    }
    const loaded = await this.load(settings);
    return {
      storageAvailable: true,
      hasAuthorCredential: Boolean(loaded.author),
      hasReviewerCredential: Boolean(loaded.reviewer),
    };
  }

  async load(settings: ModelSettings): Promise<{ author?: string; reviewer?: string }> {
    if (!this.protection.isEncryptionAvailable()) return {};
    const document = await this.readDocument();
    const result: { author?: string; reviewer?: string } = {};

    for (const role of ["author", "reviewer"] as const) {
      const configured = roleSettings(settings, role);
      const record = document[role];
      if (!configured || !record || record.identity !== modelCredentialIdentity(role, configured)) continue;
      try {
        const decrypted = this.protection.decryptString(Buffer.from(record.ciphertext, "base64"));
        if (decrypted.trim()) result[role] = decrypted;
      } catch {
        // Corrupt or platform-incompatible ciphertext is treated as a cache miss.
      }
    }
    return result;
  }

  async save(settings: ModelSettings, secrets: { author?: string; reviewer?: string }): Promise<void> {
    if (!this.protection.isEncryptionAvailable()) return;
    const current = await this.readDocument();
    const next: CredentialDocument = { schemaVersion: 1 };

    for (const role of ["author", "reviewer"] as const) {
      const configured = roleSettings(settings, role);
      if (!configured) continue;
      const identity = modelCredentialIdentity(role, configured);
      const secret = secrets[role];
      if (secret?.trim()) {
        next[role] = {
          identity,
          ciphertext: this.protection.encryptString(secret).toString("base64"),
        };
      } else if (current[role]?.identity === identity) {
        next[role] = current[role];
      }
    }

    await mkdir(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, `${JSON.stringify(next, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
      await rename(temporaryPath, this.filePath);
    } finally {
      await rm(temporaryPath, { force: true });
    }
  }

  async clear(): Promise<void> {
    await rm(this.filePath, { force: true });
  }

  private async readDocument(): Promise<CredentialDocument> {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, "utf8")) as unknown;
      if (!parsed || typeof parsed !== "object" || (parsed as { schemaVersion?: unknown }).schemaVersion !== 1) return { schemaVersion: 1 };
      const value = parsed as { author?: unknown; reviewer?: unknown };
      return {
        schemaVersion: 1,
        ...(isStoredCredential(value.author) ? { author: value.author } : {}),
        ...(isStoredCredential(value.reviewer) ? { reviewer: value.reviewer } : {}),
      };
    } catch {
      return { schemaVersion: 1 };
    }
  }
}
