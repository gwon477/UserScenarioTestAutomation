# Secure Model Credential Cache and Rate-Limit Retry Design

## Context

ScenarioForge Desktop currently keeps author and reviewer API keys only in the Electron main process `ApplicationOrchestrator` memory. Non-secret model settings are stored in renderer `localStorage`, but an app rebuild or restart clears the main-process key map. The next analysis therefore opens the model settings modal and requires both keys again.

The 2026-08-27 live run `RUN-f7710a2d-3ee3-42a7-829d-987e5e39429e` also exposed a retry ownership problem. The FACT author submitted its artifact successfully and the existing submitted-artifact recovery preserved it after a terminal Azure 429. The FACT reviewer then hit `rate_limit_tpm`. Pi retried each prompt internally and `PiGenerationExecutor` retried the complete session twice more after 1 and 3 seconds. One reviewer operation therefore expanded to as many as twelve provider requests before the TPM window could recover.

## Goals

- Cache author and reviewer API keys across Electron restarts without placing plaintext secrets in renderer storage, the selected project, ScenarioForge artifacts, or logs.
- Reuse a cached key only for the same model role and normalized provider endpoint identity.
- Allow a failed analysis to be started again through the existing `다시 분석` action without reopening model settings merely to re-enter keys.
- Make the generation executor the single owner of transient provider retry behavior.
- Use a rate-limit backoff long enough for a minute-based TPM window to recover and expose the wait state in the analysis progress UI.
- Preserve all existing source scope, runtime-template, artifact handoff, and reviewer assurance boundaries.

## Non-goals

- Authorize a project path supplied only by renderer storage or an arbitrary IPC payload. Initial native picker selection remains the explicit Electron trust boundary; only that canonical selection may be remembered across restarts.
- Resume the exact failed run or reuse an invalid stage as canonical output. A user-triggered retry starts a new analysis run.
- Persist data-policy consent inside the secret ciphertext. Non-secret model settings and consent remain renderer settings.
- Add a native `keytar` dependency.

## Selected Approach

### Electron secure storage

Use Electron `safeStorage` in the main process. The encrypted records live under `app.getPath("userData")`, never under the selected project. The on-disk document contains only a schema version, a deterministic credential identity, and base64 ciphertext.

Each credential identity is derived from:

- role: `author` or `reviewer`
- configured provider type
- normalized endpoint with credentials, query, and fragment removed
- Azure API version when applicable

The deployment/model ID is intentionally excluded because a provider key commonly authorizes multiple deployments on the same endpoint. A provider or endpoint change invalidates reuse. Author and reviewer records remain separate even when they contain the same key.

If OS encryption is unavailable, analysis still works with session-memory keys, but the application reports that persistent caching is unavailable and does not write plaintext fallback data.

### Process boundaries

The renderer never receives a cached secret. It asks the main process for credential availability for the current non-secret `ModelSettings`. The main process decrypts matching records, hydrates the orchestrator's in-memory secret map, and returns only:

```ts
type ModelCredentialStatus = {
  storageAvailable: boolean;
  hasAuthorCredential: boolean;
  hasReviewerCredential: boolean;
};
```

Saving model settings first validates and hydrates the orchestrator, then updates encrypted records atomically. Omitting a key preserves only an existing record with the exact same credential identity. A mismatched identity cannot silently reuse a previous in-memory key.

The settings modal provides a `저장된 키 삭제` action. Clearing removes both encrypted records and the corresponding in-memory orchestrator secrets, then updates the renderer availability flags.

### Startup and retry user flow

1. Renderer restores non-secret `ModelSettings` from its existing storage.
2. Renderer calls the credential-status IPC operation.
3. Main decrypts matching credentials and hydrates `ApplicationOrchestrator`.
4. Renderer records only author/reviewer availability booleans.
5. Main loads the app-scoped last selection, resolves it through `realpath`, verifies that it is still a directory, and only then restores it to the current process allowlist.
6. If no valid remembered selection exists, the user explicitly selects a project directory through the native picker, preserving the authorization boundary.
7. If settings and required cached credentials are present, project restoration or selection does not reopen the settings modal.
8. `분석 시작` or `다시 분석` starts a new run immediately.
9. Missing, corrupt, undecryptable, or identity-mismatched credential records fail closed and reopen model settings. Invalid project records fail closed and reopen project selection.

### Single retry owner

Generation Pi sessions use an in-memory `SettingsManager` with Pi automatic retry disabled. `PiGenerationExecutor` remains the only retry owner:

- provider timeout: 1 second, then 3 seconds
- transient network failure: 1 second, then 3 seconds
- provider rate limit: 60 seconds, then 120 seconds
- contract, schema, permission, path, identity, and other non-transient failures: no retry

During a rate-limit wait, the executor emits a sanitized progress event such as `FACT 단계: 요청 한도 회복 대기 (60초 후 재시도)`. No request content, key, or provider response body is placed in that UI event.

## Failure Handling

- Secure-store JSON missing: report no cached credentials.
- Secure-store JSON malformed or wrong schema: ignore it without exposing its content; require key entry.
- Ciphertext cannot be decrypted: ignore that role record; require key entry.
- `safeStorage` unavailable: keep session-only behavior and do not persist.
- Atomic persistence fails: model settings save fails visibly; the existing encrypted file remains intact.
- Final 429 after all controlled backoffs: retain the provider error as the canonical failure and keep the analysis recoverable.
- Artifact submitted before a terminal provider error: retain the existing scope/path/hash-verified artifact recovery behavior.
- Remembered project document malformed, stale, or no longer a directory: do not authorize it and require native selection.

## Security Properties

- Plaintext keys exist only in the settings input, Electron IPC invocation payload, main-process memory, and provider request header for the duration required.
- Plaintext keys are never written to project storage, renderer `localStorage`, session JSONL, state journals, generated manifests, or console logs.
- Ciphertext storage is app-scoped and written with owner-only file permissions where the platform honors POSIX modes.
- Renderer receives availability booleans, not secrets or ciphertext.
- Endpoint normalization strips embedded username, password, query, and fragment before identity calculation.

## Verification

- Unit-test credential identity normalization, encryption/decryption, exact-identity reuse, mismatch rejection, unavailable encryption, corruption, clearing, and plaintext absence.
- Unit-test orchestrator rejection of a cached/session key after endpoint identity changes.
- Unit-test IPC-facing credential status contracts and renderer hydration behavior.
- Unit-test Pi sessions with automatic retry disabled.
- Unit-test separate timeout/network and rate-limit retry schedules.
- Unit-test sanitized retry progress messages.
- Run all workspace tests, TypeScript checks, and the Electron production build.
- Restart the Electron app, select the project, verify cached credential status, and run a new analysis without re-entering keys.
- Restart again and verify that only the main-owned, revalidated canonical project selection is restored without trusting renderer localStorage.

## Rejected Alternatives

### Session-memory cache only

This is the current behavior. It supports `다시 분석` only until the Electron main process restarts and therefore does not satisfy rebuild/restart workflows.

### `keytar`

Direct keychain entries are viable but add a native dependency and packaging complexity. Electron `safeStorage` already provides the required app-level OS-protected encryption surface without expanding the native build matrix.

### Renderer localStorage

Storing plaintext or reversible application-managed ciphertext in renderer storage violates the process boundary and makes a renderer compromise sufficient to read provider credentials.
