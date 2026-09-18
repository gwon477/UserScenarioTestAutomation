# Secure Model Credential Cache and Rate-Limit Retry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist author/reviewer model credentials with Electron OS-protected encryption and make controlled, visible rate-limit retries possible without re-entering keys.

**Architecture:** A focused main-process credential store owns encrypted persistence under Electron `userData`; the renderer receives only cache availability through IPC. `ApplicationOrchestrator` binds secrets to normalized role/endpoint identities, while Pi automatic retry is disabled and `PiGenerationExecutor` becomes the single transient retry owner.

**Tech Stack:** Electron `safeStorage`, Node.js filesystem/crypto, React, TypeScript, Vitest, Pi `SettingsManager`

---

### Task 1: Add an OS-protected model credential store

**Files:**
- Create: `apps/desktop/src/main/security/model-credential-store.ts`
- Create: `apps/desktop/src/main/security/model-credential-store.test.ts`

- [ ] **Step 1: Write failing tests for identity-scoped encrypted persistence**

Define a fake protector and temporary store directory. Assert that saving author/reviewer keys writes no plaintext, matching settings restore both roles, a changed endpoint restores neither mismatched record, unavailable protection writes nothing, malformed data fails closed, and `clear()` removes the encrypted document.

```ts
const protector = {
  isEncryptionAvailable: () => true,
  encryptString: (value: string) => Buffer.from(`protected:${value}`),
  decryptString: (value: Buffer) => value.toString().replace(/^protected:/, ""),
};

await store.save(settings, { author: "author-secret", reviewer: "reviewer-secret" });
expect(await readFile(storePath, "utf8")).not.toContain("author-secret");
expect(await store.load(settings)).toEqual({ author: "author-secret", reviewer: "reviewer-secret" });
```

- [ ] **Step 2: Run the credential-store test and verify RED**

Run: `npm test -- --run apps/desktop/src/main/security/model-credential-store.test.ts`

Expected: FAIL because `ModelCredentialStore` and `modelCredentialIdentity` do not exist.

- [ ] **Step 3: Implement the minimal credential store**

Implement:

```ts
export type SafeStorageAdapter = Pick<typeof safeStorage,
  "isEncryptionAvailable" | "encryptString" | "decryptString">;

export function modelCredentialIdentity(role: "author" | "reviewer", settings: ModelRoleSettings): string;

export class ModelCredentialStore {
  constructor(filePath: string, protection: SafeStorageAdapter);
  status(settings: ModelSettings): Promise<ModelCredentialStatus>;
  load(settings: ModelSettings): Promise<{ author?: string; reviewer?: string }>;
  save(settings: ModelSettings, secrets: { author?: string; reviewer?: string }): Promise<void>;
  clear(): Promise<void>;
}
```

Normalize endpoints with `URL`, strip credentials/query/fragment, hash the role identity, encode encrypted buffers as base64, preserve an omitted matching record, write through a same-directory temporary file followed by `rename`, and use mode `0o600`. Do not fall back to plaintext when encryption is unavailable.

- [ ] **Step 4: Run the credential-store test and verify GREEN**

Run: `npm test -- --run apps/desktop/src/main/security/model-credential-store.test.ts`

Expected: all credential-store tests PASS.

### Task 2: Bind orchestrator memory secrets to credential identity

**Files:**
- Modify: `apps/desktop/src/main/application/application-orchestrator.ts`
- Modify: `apps/desktop/src/main/application/application-orchestrator.test.ts`

- [ ] **Step 1: Write failing endpoint-mismatch and clear tests**

Add tests proving that a key saved for one endpoint can be omitted for the same identity, cannot be omitted after the endpoint changes, and `clearModelCredentials()` makes the current settings require credentials again.

```ts
orchestrator.saveModelSettings({ ...settings, apiKey: "session-key" });
expect(() => orchestrator.saveModelSettings(settings)).not.toThrow();
expect(() => orchestrator.saveModelSettings({ ...settings, endpoint: "https://other.test" }))
  .toThrow("MODEL_CREDENTIAL_REQUIRED");
```

- [ ] **Step 2: Run the orchestrator test and verify RED**

Run: `npm test -- --run apps/desktop/src/main/application/application-orchestrator.test.ts`

Expected: FAIL because secrets are currently keyed only by role and no clear method exists.

- [ ] **Step 3: Implement identity tracking and clearing**

Track the active identity beside each role secret, require an exact identity match when the caller omits a key, delete reviewer state when reviewer is disabled, and add:

```ts
clearModelCredentials(): void {
  this.secrets.clear();
  this.secretIdentities.clear();
}
```

Keep runtime `credentialRef` values unchanged so project configuration continues to contain references rather than secret material.

- [ ] **Step 4: Run the orchestrator test and verify GREEN**

Run: `npm test -- --run apps/desktop/src/main/application/application-orchestrator.test.ts`

Expected: all orchestrator tests PASS.

### Task 3: Expose cache status and clearing through the desktop boundary

**Files:**
- Modify: `apps/desktop/src/shared/desktop-api.ts`
- Modify: `apps/desktop/src/preload/index.ts`
- Modify: `apps/desktop/src/main/index.ts`
- Modify: `apps/desktop/src/renderer/src/desktop.ts`
- Modify: `apps/desktop/src/renderer/src/desktop.test.ts`

- [ ] **Step 1: Write failing bridge contract tests**

Extend renderer bridge tests to require `getModelCredentialStatus(settings)` and `clearModelCredentials()`, and verify Electron without preload rejects instead of returning a false success.

```ts
await expect(getModelCredentialStatus(settings)).rejects.toThrow("ELECTRON_BRIDGE_UNAVAILABLE");
await expect(clearModelCredentials()).rejects.toThrow("ELECTRON_BRIDGE_UNAVAILABLE");
```

- [ ] **Step 2: Run the desktop bridge test and verify RED**

Run: `npm test -- --run apps/desktop/src/renderer/src/desktop.test.ts`

Expected: FAIL because the cache bridge methods and IPC channel names are absent.

- [ ] **Step 3: Implement the main/preload/renderer cache boundary**

Add `settings:get-model-credential-status` and `settings:clear-model-credentials`. After `app.whenReady()`, construct `ModelCredentialStore` at:

```ts
join(app.getPath("userData"), "model-credentials.v1.json")
```

Status handling decrypts matching records, calls `orchestrator.saveModelSettings()` with recovered keys, and returns only booleans. Save handling validates the orchestrator first and then persists newly supplied keys or exact-identity cached keys. Clear handling removes ciphertext and main-process memory secrets.

- [ ] **Step 4: Run the desktop bridge test and verify GREEN**

Run: `npm test -- --run apps/desktop/src/renderer/src/desktop.test.ts`

Expected: all desktop bridge tests PASS.

### Task 4: Hydrate cached-key status and support secure deletion in the UI

**Files:**
- Modify: `apps/desktop/src/renderer/src/App.tsx`
- Modify: `apps/desktop/src/renderer/src/components/ModelSettingsModal.tsx`
- Modify: `apps/desktop/src/renderer/src/components/ModelSettingsModal.test.ts`
- Modify: `apps/desktop/src/renderer/src/styles/workspace.css`

- [ ] **Step 1: Write failing renderer source/behavior tests**

Require startup cache hydration, cached-key-aware project selection, the secure-storage explanation, and the delete action. Assert the modal does not imply that every key is session-only.

```ts
expect(source).toContain("getModelCredentialStatus");
expect(source).toContain("clearModelCredentials");
expect(source).toContain("저장된 키 삭제");
expect(source).toContain("운영체제 보호 저장소");
```

- [ ] **Step 2: Run the model settings test and verify RED**

Run: `npm test -- --run apps/desktop/src/renderer/src/components/ModelSettingsModal.test.ts`

Expected: FAIL because persistent cache UI and hydration are absent.

- [ ] **Step 3: Implement cache hydration and deletion**

On initial non-preview settings load, call `getModelCredentialStatus`; update only `hasSessionApiKey`, `hasSessionReviewerApiKey`, and a `secureStorageAvailable` flag. After directory selection, open settings only when settings or required credentials are missing. Pass a deletion callback to the modal that clears main storage and resets both availability flags.

Keep the existing failed-state `다시 분석` button. With hydrated flags it calls `startProjectAnalysis` directly instead of reopening the modal.

- [ ] **Step 4: Run the renderer tests and verify GREEN**

Run: `npm test -- --run apps/desktop/src/renderer/src/components/ModelSettingsModal.test.ts apps/desktop/src/renderer/src/desktop.test.ts`

Expected: all selected renderer tests PASS.

### Task 5: Make the generation executor the single retry owner

**Files:**
- Modify: `packages/pi-runtime/src/host/pi-sdk-driver.ts`
- Modify: `packages/pi-runtime/src/pi-runtime.test.ts`
- Modify: `packages/scenario-pipeline/src/workflows/retry-policy.ts`
- Modify: `packages/scenario-pipeline/src/workflows/work-policies.test.ts`
- Modify: `apps/desktop/src/main/application/pi-generation-executor.ts`
- Modify: `apps/desktop/src/main/application/pi-generation-executor.test.ts`

- [ ] **Step 1: Write failing retry ownership and schedule tests**

Assert Pi session creation receives `SettingsManager.inMemory({ retry: { enabled: false } })`, rate limits use 60 and 120 seconds, timeout/network retain 1 and 3 seconds, and a retry callback receives only stage/category/attempt/delay metadata.

```ts
expect(retryDelay("provider-rate-limit", 1)).toBe(60_000);
expect(retryDelay("provider-rate-limit", 2)).toBe(120_000);
expect(retryDelay("provider-rate-limit", 3)).toBeNull();
```

- [ ] **Step 2: Run focused retry tests and verify RED**

Run: `npm test -- --run packages/pi-runtime/src/pi-runtime.test.ts packages/scenario-pipeline/src/workflows/work-policies.test.ts apps/desktop/src/main/application/pi-generation-executor.test.ts`

Expected: FAIL because Pi retry is enabled by default and rate-limit delays are 1/3 seconds.

- [ ] **Step 3: Disable Pi retry and implement executor progress callbacks**

Pass an in-memory `SettingsManager` with retry disabled to every generation `createAgentSession` call. Change `retryDelay` to use category-specific schedules. Extend executor options with:

```ts
onRetry?: (event: {
  stage: "src" | "fact" | "wiki" | "scenario";
  role: "author" | "reviewer";
  category: "provider-rate-limit" | "provider-timeout" | "network-transient";
  attempt: number;
  delayMs: number;
}) => void;
```

Invoke it before the abortable delay. Do not include exception text, payloads, endpoints, or credentials.

- [ ] **Step 4: Run focused retry tests and verify GREEN**

Run: `npm test -- --run packages/pi-runtime/src/pi-runtime.test.ts packages/scenario-pipeline/src/workflows/work-policies.test.ts apps/desktop/src/main/application/pi-generation-executor.test.ts`

Expected: all focused retry tests PASS.

### Task 6: Display sanitized rate-limit wait progress

**Files:**
- Modify: `apps/desktop/src/main/application/application-orchestrator.ts`
- Modify: `apps/desktop/src/renderer/src/App.tsx`
- Modify: `apps/desktop/src/renderer/src/components/AnalysisProgress.tsx`
- Create: `apps/desktop/src/renderer/src/components/AnalysisProgress.test.ts`

- [ ] **Step 1: Write a failing progress-message test**

Render or source-test `AnalysisProgress` with a retry message and assert the accessible live region contains it while the progress percentage remains the stage percentage.

```tsx
<AnalysisProgress status="running" progress={25} message="FACT 단계: 요청 한도 회복 대기 (60초 후 재시도)" />
```

- [ ] **Step 2: Run the progress test and verify RED**

Run: `npm test -- --run apps/desktop/src/renderer/src/components/AnalysisProgress.test.ts`

Expected: FAIL because `AnalysisProgress` has no message prop.

- [ ] **Step 3: Wire sanitized retry status end to end**

Map executor retry events to the existing `AnalysisProgressEvent` with the active stage's base progress and a Korean wait message. Store `event.message` in renderer analysis state and display it in the `aria-live` current-operation region. Reset the message on a new start, completion, or final error.

- [ ] **Step 4: Run the progress and orchestrator tests and verify GREEN**

Run: `npm test -- --run apps/desktop/src/renderer/src/components/AnalysisProgress.test.ts apps/desktop/src/main/application/application-orchestrator.test.ts`

Expected: all selected tests PASS.

### Task 7: Update failure history and verify the whole application

**Files:**
- Modify: `docs/solutions/integration-issues/fact-patch-canonical-id-reference-drift.md`
- Modify: `docs/screens/02-model-settings-modal.md`
- Modify: `docs/screens/03-project-workspace.md`

- [ ] **Step 1: Record the new live failure classification**

Document run `RUN-f7710a2d-3ee3-42a7-829d-987e5e39429e`, FACT author submission recovery, reviewer call timestamps, the nested retry amplification, the distinction from runtime-template/ENOENT/canonical-ID failures, and the new single-owner schedule with test references.

- [ ] **Step 2: Update screen contracts**

Document OS-protected cache availability, secret deletion, main-owned revalidation of a previously explicit directory selection after restart, direct failed-analysis retry, and the rate-limit wait message.

- [ ] **Step 3: Run all tests**

Run: `npm test -- --run`

Expected: all workspace test files PASS with no unhandled rejection.

- [ ] **Step 4: Run TypeScript checks**

Run: `npm run typecheck`

Expected: all workspace TypeScript projects PASS.

- [ ] **Step 5: Build the Electron app**

Run: `npm run build`

Expected: Electron main, preload, renderer, and runtime-template assets build successfully.

- [ ] **Step 6: Restart and perform a live smoke check**

Restart the existing Electron development process, select the authorized project, confirm the model modal does not require cached keys, and launch a new analysis. Monitor state journal and sanitized session metadata; do not use coordinate-based GUI automation.
