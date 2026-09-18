import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ModelSettings } from "../../shared/desktop-api";
import {
  ModelCredentialStore,
  modelCredentialIdentity,
  type SafeStorageAdapter,
} from "./model-credential-store";

const settings: ModelSettings = {
  provider: "azure-openai",
  endpoint: "https://skax.ai-talentlab.com/?ignored=true#fragment",
  model: "gpt-5.6-luna",
  apiVersion: "2024-12-01-preview",
  dataPolicyAccepted: true,
  reviewer: {
    provider: "azure-openai",
    endpoint: "https://reviewer.example.test/",
    model: "reviewer-deployment",
    apiVersion: "2024-12-01-preview",
    dataPolicyAccepted: true,
  },
};

const protector: SafeStorageAdapter = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(`protected:${value}`, "utf8"),
  decryptString: (value) => value.toString("utf8").replace(/^protected:/, ""),
};

describe("model credential store", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  async function createStore(protection: SafeStorageAdapter = protector) {
    const root = await mkdtemp(join(tmpdir(), "scenarioforge-credentials-"));
    roots.push(root);
    const filePath = join(root, "model-credentials.v1.json");
    return { filePath, store: new ModelCredentialStore(filePath, protection) };
  }

  it("encrypts role credentials and restores only matching identities", async () => {
    const { filePath, store } = await createStore();

    await store.save(settings, { author: "author-secret", reviewer: "reviewer-secret" });

    const stored = await readFile(filePath, "utf8");
    expect(stored).not.toContain("author-secret");
    expect(stored).not.toContain("reviewer-secret");
    await expect(store.load(settings)).resolves.toEqual({ author: "author-secret", reviewer: "reviewer-secret" });
    await expect(store.status(settings)).resolves.toEqual({ storageAvailable: true, hasAuthorCredential: true, hasReviewerCredential: true });

    const changed: ModelSettings = {
      ...settings,
      endpoint: "https://changed-author.example.test",
      reviewer: { ...settings.reviewer!, endpoint: "https://changed-reviewer.example.test" },
    };
    await expect(store.load(changed)).resolves.toEqual({});
  });

  it("normalizes endpoint decorations and ignores deployment changes in the identity", () => {
    const original = modelCredentialIdentity("author", settings);
    expect(modelCredentialIdentity("author", {
      ...settings,
      endpoint: "https://user:password@skax.ai-talentlab.com/",
      model: "another-deployment",
    })).toBe(original);
    expect(modelCredentialIdentity("reviewer", settings.reviewer!)).not.toBe(original);
  });

  it("preserves an omitted credential only for the same identity", async () => {
    const { store } = await createStore();
    await store.save(settings, { author: "author-secret", reviewer: "reviewer-secret" });

    await store.save({ ...settings, model: "another-deployment" }, {});
    await expect(store.load(settings)).resolves.toEqual({ author: "author-secret", reviewer: "reviewer-secret" });

    await store.save({ ...settings, endpoint: "https://changed.example.test" }, {});
    await expect(store.load(settings)).resolves.toEqual({ reviewer: "reviewer-secret" });
  });

  it("does not write a plaintext fallback when OS encryption is unavailable", async () => {
    const unavailable: SafeStorageAdapter = {
      ...protector,
      isEncryptionAvailable: () => false,
    };
    const { filePath, store } = await createStore(unavailable);

    await store.save(settings, { author: "author-secret" });

    await expect(access(filePath)).rejects.toThrow();
    await expect(store.status(settings)).resolves.toEqual({ storageAvailable: false, hasAuthorCredential: false, hasReviewerCredential: false });
  });

  it("fails closed for malformed documents and undecryptable records", async () => {
    const broken: SafeStorageAdapter = {
      ...protector,
      decryptString: () => { throw new Error("cannot decrypt"); },
    };
    const { filePath, store } = await createStore(broken);
    await writeFile(filePath, "not json", "utf8");
    await expect(store.load(settings)).resolves.toEqual({});

    const validStore = new ModelCredentialStore(filePath, protector);
    await validStore.save(settings, { author: "author-secret" });
    await expect(store.load(settings)).resolves.toEqual({});
  });

  it("clears the encrypted credential document", async () => {
    const { filePath, store } = await createStore();
    await store.save(settings, { author: "author-secret" });

    await store.clear();

    await expect(access(filePath)).rejects.toThrow();
    await expect(store.load(settings)).resolves.toEqual({});
  });
});
