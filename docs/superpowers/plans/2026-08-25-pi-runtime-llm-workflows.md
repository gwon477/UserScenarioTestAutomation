# Pi Runtime and LLM Workflows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pi 원시 이벤트와 UI를 분리한 복구 가능한 도메인 상태 기반 위에 6개 LLM 기능을 격리하고, 공통 Markdown 계약의 안전한 추가·수정·삭제와 단계별 완료 gate를 구현한다.

**Architecture:** Electron Main의 Application Orchestrator가 project별 single-writer `RuntimeStateCoordinator`를 소유하고 Pi UtilityProcess는 원시 event와 구조화 command candidate만 전달한다. 각 LLM 기능은 immutable `WorkDescriptor`, 독립 `workId`, 제한된 read/write scope, staging artifact를 사용하며 backend validator가 journal·checkpoint·revision을 commit한 뒤 domain event를 발행한다.

**Tech Stack:** Node.js 22.12+, npm workspaces, TypeScript, Electron UtilityProcess, `@earendil-works/pi-coding-agent@0.84.3`, Vitest, JSON/Markdown journal projection, `node:sqlite` artifact relation index

**Spec:** `docs/superpowers/specs/2026-08-25-scenarioforge-pi-runtime-test-execution-design.md`

## Global Constraints

- 실제 역할별 하네스·skill·subagent resource 작성은 Task 10 전에는 수행하지 않는다.
- Pi SDK는 `@earendil-works/pi-coding-agent@0.84.3`으로 고정하고 manifest hash를 기록한다.
- LangGraph를 추가하지 않는다.
- Pi `agent_end`, 모델 완료 문장, tool success는 stage 완료 조건으로 사용하지 않는다.
- 모든 canonical state 변경은 project별 single-writer와 `expectedRevision` compare-and-set을 통과한다.
- 하나의 state commit은 하나의 revision과 하나의 persisted domain event만 생성한다.
- `WORK_PROTOCOL.md`와 `WORK_STATE.md`는 Pi 일반 파일 도구에 read-only다.
- credential, 개인정보 원문, chain-of-thought, raw tool output을 state, event, log, artifact에 저장하지 않는다.
- 분석 stage는 `src → fact → wiki → scenario` 순서로 실행한다.
- analysis, scenario Q&A, test planning session을 분리한다.
- child work는 부모 state를 직접 변경하지 않고 parent integration gate를 통과한다.

## LLM Function Workflow Contract

| Function ID | Session | Required input | Write scope | Validated output |
| --- | --- | --- | --- | --- |
| `analysis.source-map` | analysis | project snapshot, path policy | `staging/{workId}/source-map.json` | source/module/dependency IDs |
| `analysis.fact-extract` | analysis | persisted source IDs and source content | `staging/{workId}/facts/*.json` | FACT IDs with source evidence |
| `analysis.wiki-compose` | analysis | persisted fact/source IDs | `staging/{workId}/wiki/*.md` and relation JSON | WIKI IDs with FACT coverage |
| `analysis.scenario-compose` | analysis | persisted wiki/fact/source IDs | `staging/{workId}/scenario-set.json` | scenario IDs, preconditions, steps, expected results |
| `scenario.answer` | chat conversation | selected scenario IDs and question | append-only conversation record | answer with resolvable cited IDs |
| `test.plan` | execution planning | immutable scenario snapshot and target contract | `staging/{workId}/plan.json` | immutable runner plan with scenario hash |

All six functions execute this outer sequence:

```text
create WorkDescriptor
→ getContext(protocolHash, stateHash, revision, contextToken)
→ begin(contextToken, expectedRevision)
→ run Pi turn under FunctionPolicy
→ request and validate child work when allowed
→ integrate output in staging
→ submitArtifacts(contentHash, relatedIds)
→ settle root and child work tree
→ requestCompletion
→ validate schema/ID/path/index/checkpoint
→ commit revision and domain event
→ publish typed event
```

## Common Contract CRUD Rules

| Operation | API | Permission | Persistence |
| --- | --- | --- | --- |
| Read | `getContext()` | every root/child work before `begin()` | no revision; one-time context token |
| Add | `requestChildWork()`, `recordActivity()`, `submitArtifacts()` | owner work within its function policy | new journal revision |
| Update | `updateProgress()` and activity terminal transition | allowlisted fields on owner work | compare-and-set revision, old value retained |
| Delete | `discardDraftArtifact()` | unsubmitted owner staging draft only | tombstone revision, then physical staging removal |
| Supersede | `submitArtifacts({ supersedesArtifactId })` | new attempt with validator approval | old persisted artifact retained and linked |
| Hard delete | retention command | explicit user action only | relation check, audit record, recoverable backup boundary |

---

### Task 1: npm Workspace와 패키지 경계

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/shared/workspace.test.ts`
- Create: `apps/desktop/package.json`
- Move: `src/` to `apps/desktop/src/`
- Move: `electron.vite.config.ts` to `apps/desktop/electron.vite.config.ts`
- Move: `vite.config.ts` to `apps/desktop/vite.config.ts`
- Create: `packages/contracts/package.json`
- Create: `packages/runtime-state/package.json`
- Create: `packages/project-runtime/package.json`
- Create: `packages/pi-runtime/package.json`
- Create: `packages/scenario-pipeline/package.json`
- Create: `packages/test-runtime/package.json`
- Create: `packages/evidence-store/package.json`

**Interfaces:**
- Consumes: current root Electron application
- Produces: `@scenarioforge/*` workspace package names and unchanged root commands

- [ ] **Step 1: Root script resolution test 작성**

```ts
import { describe, expect, it } from "vitest";
import packageJson from "../../package.json";

describe("workspace scripts", () => {
  it("delegates desktop build and tests from the repository root", () => {
    expect(packageJson.workspaces).toEqual(["apps/*", "packages/*"]);
    expect(packageJson.scripts.build).toContain("@scenarioforge/desktop");
  });
});
```

- [ ] **Step 2: Workspace test가 현재 구조에서 실패하는지 확인**

Run: `npm test -- src/shared/workspace.test.ts`

Expected: FAIL because root package has no workspaces.

- [ ] **Step 3: Root workspace와 desktop package 선언**

```json
{
  "name": "scenarioforge",
  "private": true,
  "workspaces": ["apps/*", "packages/*"],
  "scripts": {
    "dev": "npm run dev --workspace @scenarioforge/desktop",
    "test": "npm run test --workspaces --if-present",
    "typecheck": "npm run typecheck --workspaces --if-present",
    "build": "npm run build --workspace @scenarioforge/desktop",
    "build:web": "npm run build:web --workspace @scenarioforge/desktop"
  }
}
```

- [ ] **Step 4: 기존 desktop 파일 이동과 import path 수정**

Run: `git mv src apps/desktop/src`

Move the Electron/Vite configs to `apps/desktop/`, update their relative output paths, and keep the renderer URL behavior unchanged.

- [ ] **Step 5: Package manifest 최소 구현**

Every internal package uses this shape with its own name:

```json
{
  "name": "@scenarioforge/runtime-state",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "exports": "./src/index.ts",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  }
}
```

- [ ] **Step 6: Root test/typecheck/build 실행**

Run: `npm install && npm test && npm run typecheck && npm run build`

Expected: existing UI and tests PASS after relocation.

- [ ] **Step 7: Workspace 커밋**

```bash
git add package.json package-lock.json apps packages tsconfig.json
git commit -m "refactor: organize ScenarioForge workspaces"
```

### Task 2: 공유 상태·작업·이벤트 계약 패키지

**Files:**
- Create: `packages/contracts/src/state.ts`
- Create: `packages/contracts/src/work.ts`
- Create: `packages/contracts/src/events.ts`
- Create: `packages/contracts/src/activities.ts`
- Create: `packages/contracts/src/artifacts.ts`
- Create: `packages/contracts/src/validators.ts`
- Create: `packages/contracts/src/validators.test.ts`
- Create: `packages/contracts/src/index.ts`

**Interfaces:**
- Consumes: UI plan의 shared contract names
- Produces: `ProjectRuntimeState`, `WorkDescriptor`, `WorkStateMutation`, `ScenarioForgeDomainEvent`, runtime validators

- [ ] **Step 1: 금지 상태와 잘못된 event envelope test 작성**

```ts
it("rejects completed scenario without a persisted artifact", () => {
  const initial = createInitialProjectRuntimeState();
  const state = {
    ...initial,
    stages: { src: "completed", fact: "completed", wiki: "completed", scenario: "completed" },
    artifactStatus: { src: "persisted", fact: "persisted", wiki: "persisted", scenario: "verified" },
  };
  expect(validateProjectRuntimeState(state)).toEqual({
    ok: false,
    code: "SCENARIO_ARTIFACT_NOT_PERSISTED",
  });
});
```

- [ ] **Step 2: Contract validator test 실패 확인**

Run: `npm test --workspace @scenarioforge/contracts`

Expected: FAIL because validator exports are absent.

- [ ] **Step 3: Work descriptor와 mutation union 구현**

```ts
export type LlmFunctionId =
  | "analysis.source-map"
  | "analysis.fact-extract"
  | "analysis.wiki-compose"
  | "analysis.scenario-compose"
  | "scenario.answer"
  | "test.plan";

export type WorkStateMutation =
  | { op: "add-child"; descriptor: ChildWorkDescriptor }
  | { op: "update-progress"; patch: WorkProgressPatch }
  | { op: "record-activity"; activity: VerifiableActivity }
  | { op: "submit-artifacts"; artifacts: ArtifactSubmission[] }
  | { op: "tombstone-draft"; artifactId: string; reason: string }
  | { op: "report-failure"; error: DomainError }
  | { op: "request-completion" };

export type ArtifactSubmission = {
  artifactId: string;
  artifactType: AnalysisStage;
  stagingPath: string;
  relatedIds: string[];
  contentHash: string;
  supersedesArtifactId?: string;
};
```

- [ ] **Step 4: Event envelope와 exhaustive validators 구현**

`validateProjectRuntimeState`, `validateWorkDescriptor`, `validateDomainEvent`, `validateArtifactSubmission` return `{ ok: true, value } | { ok: false, code }` and reject unknown enum values, negative revisions, empty IDs, and project ID mismatches.

- [ ] **Step 5: Contract package test/typecheck 실행**

Run: `npm test --workspace @scenarioforge/contracts && npm run typecheck --workspace @scenarioforge/contracts`

Expected: PASS.

- [ ] **Step 6: 계약 패키지 커밋**

```bash
git add packages/contracts apps/desktop/src/shared
git commit -m "feat: centralize domain contracts"
```

### Task 3: Journal 상태 저장소와 Markdown projection

**Files:**
- Create: `packages/runtime-state/src/reducer.ts`
- Create: `packages/runtime-state/src/reducer.test.ts`
- Create: `packages/runtime-state/src/journal-repository.ts`
- Create: `packages/runtime-state/src/journal-repository.test.ts`
- Create: `packages/runtime-state/src/work-state-service.ts`
- Create: `packages/runtime-state/src/work-state-service.test.ts`
- Create: `packages/runtime-state/src/work-state-markdown.ts`
- Create: `packages/runtime-state/src/work-state-markdown.test.ts`
- Create: `packages/runtime-state/src/recovery.ts`
- Create: `packages/runtime-state/src/index.ts`

**Interfaces:**
- Consumes: `WorkStateMutation`, `ProjectRuntimeState`
- Produces: `RuntimeStateCoordinator`, `JournalRepository`, `WorkStateService`, deterministic `WORK_STATE.md`

- [ ] **Step 1: revision·one-event-per-commit reducer test 작성**

```ts
it("creates exactly one next revision and one domain event", () => {
  const state = { ...createInitialProjectRuntimeState(), revision: 7 };
  const command = {
    type: "work.begin",
    projectId: "project-1",
    workId: "work-1",
    operationId: "operation-1",
    expectedRevision: 7,
  } as const;
  const result = reduceState(state, command);
  expect(result.state.revision).toBe(8);
  expect(result.event.revision).toBe(8);
  expect(Array.isArray(result.event)).toBe(false);
});
```

- [ ] **Step 2: stale revision과 context 없는 begin test 작성**

```ts
await expect(service.begin({
  projectId: "project-1",
  workId: "work-1",
  operationId: "operation-1",
  expectedRevision: 3,
  contextToken: "",
})).rejects.toMatchObject({ code: "CONTEXT_REQUIRED" });
```

- [ ] **Step 3: 순수 reducer와 project별 single-writer queue 구현**

```ts
export class RuntimeStateCoordinator {
  async commit(command: StateCommand): Promise<StateCommit> {
    return this.queue.forProject(command.projectId, () => this.commitOne(command));
  }
}
```

`commitOne` validates `expectedRevision`, reduces once, writes one journal record, refreshes snapshots, then publishes one event.

- [ ] **Step 4: 원자적 journal repository 구현**

```ts
type JournalCommit = {
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
```

Write JSON to a sibling temporary file, `fsync`, rename to `{revision}.json`, then atomically replace `project-state.json`. Recovery selects the highest continuous hash-valid journal record.

```ts
async function commitJournal(path: string, record: JournalCommit) {
  const temporaryPath = `${path}.${record.transactionId}.tmp`;
  await writeFile(temporaryPath, JSON.stringify(record));
  const handle = await open(temporaryPath, "r");
  await handle.sync();
  await handle.close();
  await rename(temporaryPath, path);
}
```

- [ ] **Step 5: 고정 heading Markdown projection 구현**

```ts
const headings = [
  "State Identity",
  "Current Assignment",
  "Required Input IDs",
  "Verified Artifacts",
  "Pending Completion Gates",
  "Recent Verifiable Activities",
  "Recovery and Error",
  "Allowed Next Actions",
] as const;
```

Sort IDs and activities before rendering, omit secrets, and hash the final UTF-8 bytes into `StateCommit.workStateHash`.

- [ ] **Step 6: ADD/UPDATE/TOMBSTONE ownership test와 구현**

```ts
await expect(
  service.discardDraftArtifact({
    projectId: "project-1",
    workId: "child-b",
    expectedRevision: 9,
    artifactId: "draft-owned-by-child-a",
    reason: "replace malformed draft",
  }),
).rejects.toMatchObject({ code: "WORK_SCOPE_VIOLATION" });
```

Only owner work can update progress or tombstone an unsubmitted draft. Persisted artifacts return `PERSISTED_ARTIFACT_IMMUTABLE`.

- [ ] **Step 7: Crash-point recovery tests 실행**

Run: `npm test --workspace @scenarioforge/runtime-state`

Expected: PASS for crashes before journal rename, after journal rename, before projection replace, and before event publish.

- [ ] **Step 8: Runtime state 커밋**

```bash
git add packages/runtime-state
git commit -m "feat: persist recoverable runtime state"
```

### Task 4: Project bootstrap과 공통 문서 설치

**Files:**
- Create: `packages/project-runtime/src/bootstrap/project-bootstrapper.ts`
- Create: `packages/project-runtime/src/bootstrap/project-bootstrapper.test.ts`
- Create: `packages/project-runtime/src/path-policy/project-path-policy.ts`
- Create: `packages/project-runtime/src/path-policy/project-path-policy.test.ts`
- Create: `packages/project-runtime/src/manifest/runtime-manifest.ts`
- Create: `packages/project-runtime/runtime-template/WORK_PROTOCOL.md`
- Create: `packages/project-runtime/src/index.ts`

**Interfaces:**
- Consumes: selected project path and bundled runtime version
- Produces: `.scenarioforge/` directories, manifest, protocol hash, initialized revision 0 state

- [ ] **Step 1: 멱등 bootstrap과 symlink escape test 작성**

```ts
it("does not modify project source files on a repeated bootstrap", async () => {
  const sourcePath = join(projectRoot, "src", "index.ts");
  const before = await readFile(sourcePath, "utf8");
  await bootstrapper.bootstrap(request);
  await bootstrapper.bootstrap(request);
  expect(await readFile(sourcePath, "utf8")).toBe(before);
});
```

- [ ] **Step 2: Bootstrap test 실패 확인**

Run: `npm test --workspace @scenarioforge/project-runtime`

Expected: FAIL because bootstrapper is absent.

- [ ] **Step 3: canonical path와 protected state path 구현**

The path policy exposes `assertReadableProjectPath`, `assertWritableStagingPath`, and `assertRuntimeStateWriteDenied`. General Pi tools may read protocol/state projections but may only write under the assigned `staging/{workId}`.

```ts
export interface ProjectPathPolicy {
  assertReadableProjectPath(path: string): string;
  assertWritableStagingPath(workId: string, path: string): string;
  assertRuntimeStateWriteDenied(path: string): void;
}
```

- [ ] **Step 4: Runtime manifest와 minimal protocol 설치 구현**

```md
# ScenarioForge Work Protocol

- Protocol version and hash must match the active WorkContext.
- Read the current WorkContext before beginning each root or child work.
- Submit structured artifacts and request completion; never mark a stage complete directly.
- Canonical state files are read-only to agent file tools.
```

This file contains only the common safety contract. Role instructions are added in Task 10.

- [ ] **Step 5: Bootstrap test/typecheck 실행**

Run: `npm test --workspace @scenarioforge/project-runtime && npm run typecheck --workspace @scenarioforge/project-runtime`

Expected: PASS.

- [ ] **Step 6: Project runtime 커밋**

```bash
git add packages/project-runtime
git commit -m "feat: bootstrap project runtime state"
```

### Task 5: Pi 원시 이벤트 Adapter와 process 경계

**Files:**
- Create: `packages/pi-runtime/src/event-adapter/pi-event-adapter.ts`
- Create: `packages/pi-runtime/src/event-adapter/pi-event-adapter.test.ts`
- Create: `packages/pi-runtime/src/host/pi-runtime-host.ts`
- Create: `packages/pi-runtime/src/host/pi-runtime-host.test.ts`
- Create: `packages/pi-runtime/src/sessions/session-registry.ts`
- Create: `packages/pi-runtime/src/security/tool-policy.ts`
- Create: `packages/pi-runtime/src/index.ts`
- Create: `apps/desktop/src/main/processes/pi-utility-entry.ts`

**Interfaces:**
- Consumes: Pi-compatible raw event fixture
- Produces: `SessionCommandCandidate | ActivityCommandCandidate | null`; never a UI event

- [ ] **Step 1: `agent_end` 격리 test 작성**

```ts
it("maps agent_end to settled candidate without completing a stage", () => {
  expect(adapter.adapt({ type: "agent_end", messages: [] })).toEqual({
    kind: "session-status-candidate",
    status: "settled",
  });
  expect(JSON.stringify(adapter.adapt({ type: "agent_end", messages: [] }))).not.toContain(
    "analysis.stage.completed",
  );
});
```

- [ ] **Step 2: Adapter test 실패 확인**

Run: `npm test --workspace @scenarioforge/pi-runtime`

Expected: FAIL because adapter is absent.

- [ ] **Step 3: Exhaustive event adapter 구현**

Map agent lifecycle, compaction, tool start/end, abort, and process error into candidate unions. Return `null` for text chunks and chain-of-thought data.

```ts
export type PiEventCandidate =
  | { kind: "session-status-candidate"; status: AgentWorkStatus }
  | { kind: "activity-candidate"; activity: VerifiableActivity };

export function adaptPiEvent(event: PiRawEvent): PiEventCandidate | null {
  if (event.type === "message_update") return null;
  if (event.type === "agent_end") return { kind: "session-status-candidate", status: "settled" };
  return adaptLifecycleOrToolEvent(event);
}
```

- [ ] **Step 4: PiRuntimeHost interface와 fake SDK driver 구현**

```ts
export interface PiSessionDriver {
  create(input: SessionCreateInput): Promise<SessionHandle>;
  restore(sessionId: string): Promise<SessionHandle>;
  prompt(sessionId: string, input: StructuredPrompt): Promise<void>;
  abort(sessionId: string): Promise<void>;
  compact(sessionId: string): Promise<void>;
  dispose(sessionId: string): Promise<void>;
}

export type SessionCreateInput = {
  projectId: string;
  cwd: string;
  agentDir: string;
};

export type SessionHandle = {
  sessionId: string;
  sessionFile?: string;
};

export type StructuredPrompt = {
  text: string;
  source: "analysis" | "scenario-chat" | "test-planning";
};
```

Use a fake driver until Task 10; UtilityProcess IPC accepts typed commands and returns candidates to Electron Main.

- [ ] **Step 5: Renderer raw-event leakage test 추가**

Search built preload and shared API exports and assert no `PiRawEvent`, `agent_end`, message chunk, or raw tool payload type is exported.

```ts
expect(Object.keys(IPC_CHANNELS)).not.toContain("piRawEvent");
expect(readFileSync(preloadDeclarationPath, "utf8")).not.toMatch(/PiRawEvent|agent_end|message_update/);
```

- [ ] **Step 6: Pi runtime test/typecheck 실행**

Run: `npm test --workspace @scenarioforge/pi-runtime && npm run typecheck --workspace @scenarioforge/pi-runtime`

Expected: PASS.

- [ ] **Step 7: Pi adapter 커밋**

```bash
git add packages/pi-runtime apps/desktop/src/main/processes/pi-utility-entry.ts
git commit -m "feat: isolate Pi runtime events"
```

### Task 6: 6개 LLM 기능 policy와 child work 격리

**Files:**
- Create: `packages/scenario-pipeline/src/workflows/function-policies.ts`
- Create: `packages/scenario-pipeline/src/workflows/function-policies.test.ts`
- Create: `packages/scenario-pipeline/src/workflows/work-descriptor.ts`
- Create: `packages/scenario-pipeline/src/workflows/work-scope-guard.ts`
- Create: `packages/scenario-pipeline/src/workflows/work-scope-guard.test.ts`
- Create: `packages/scenario-pipeline/src/workflows/retry-policy.ts`
- Create: `packages/scenario-pipeline/src/index.ts`

**Interfaces:**
- Consumes: `LlmFunctionId`, project snapshot, persisted input IDs
- Produces: immutable `WorkDescriptor`, `FunctionPolicy`, child ownership checks, exact retry decisions

- [ ] **Step 1: 기능 policy snapshot test 작성**

```ts
expect(functionPolicies["scenario.answer"]).toMatchObject({
  sessionKind: "chat",
  childWork: "forbidden",
  writableEntities: ["conversation-record"],
});
expect(functionPolicies["test.plan"].writableEntities).not.toContain("test-execution");
```

- [ ] **Step 2: 기능 policy test 실패 확인**

Run: `npm test --workspace @scenarioforge/scenario-pipeline`

Expected: FAIL because policies are absent.

- [ ] **Step 3: 6개 exact policy 구현**

```ts
export type FunctionPolicy = {
  functionId: LlmFunctionId;
  sessionKind: "analysis" | "chat" | "test-planning";
  readableEntities: string[];
  writableEntities: string[];
  childWork: "forbidden" | "module-batch" | "scenario-batch";
  outputArtifactType: "source" | "fact" | "wiki" | "scenario" | "chat-response" | "test-plan";
};
```

Encode the table in the plan header exactly. No policy may include canonical state, another session's conversation, Runner queue, or evidence as a writable entity.

- [ ] **Step 4: Immutable WorkDescriptor와 staging scope 구현**

```ts
export type WorkDescriptor = Readonly<{
  projectId: string;
  sessionId: string;
  workId: string;
  parentWorkId?: string;
  functionId: LlmFunctionId;
  attemptId: string;
  inputIds: readonly string[];
  readScopes: readonly string[];
  writeScope: string;
  createdAt: string;
}>;
```

`writeScope` must equal `.scenarioforge/staging/{workId}` after canonicalization.

- [ ] **Step 5: Child 격리와 parent integration test 구현**

```ts
const settledChildResult = { workId: "child-1", parentWorkId: "parent-1", status: "settled" } as const;
const runningChildResult = { ...settledChildResult, status: "running" } as const;
expect(() => guard.assertMutation(childDescriptor, {
  entityOwnerWorkId: parentDescriptor.workId,
})).toThrowError("WORK_SCOPE_VIOLATION");
expect(canIntegrateChild(parentDescriptor, settledChildResult)).toBe(true);
expect(canIntegrateChild(parentDescriptor, runningChildResult)).toBe(false);
```

- [ ] **Step 6: Retry policy 구현**

Only `provider-timeout`, `provider-rate-limit`, and `network-transient` retry. Attempts 1 and 2 return delays `1000` and `3000`; attempt 3 and validation/security errors return no retry.

```ts
export function retryDelay(category: string, attempt: number): number | null {
  if (!["provider-timeout", "provider-rate-limit", "network-transient"].includes(category)) return null;
  return [1000, 3000][attempt - 1] ?? null;
}
```

- [ ] **Step 7: Workflow policy test/typecheck 실행**

Run: `npm test --workspace @scenarioforge/scenario-pipeline && npm run typecheck --workspace @scenarioforge/scenario-pipeline`

Expected: PASS.

- [ ] **Step 8: LLM workflow policy 커밋**

```bash
git add packages/scenario-pipeline/src/workflows
git commit -m "feat: define isolated LLM workflows"
```

### Task 7: 분석 completion gate와 artifact index

**Files:**
- Create: `packages/scenario-pipeline/src/stages/analysis-coordinator.ts`
- Create: `packages/scenario-pipeline/src/stages/analysis-coordinator.test.ts`
- Create: `packages/scenario-pipeline/src/validators/stage-completion-gate.ts`
- Create: `packages/scenario-pipeline/src/validators/stage-completion-gate.test.ts`
- Create: `packages/scenario-pipeline/src/indexing/artifact-index.ts`
- Create: `packages/scenario-pipeline/src/indexing/artifact-index.test.ts`
- Create: `packages/scenario-pipeline/src/artifacts/artifact-writer.ts`

**Interfaces:**
- Consumes: settled work tree, staging artifact submissions, function policy
- Produces: persisted artifact, revision-tagged index rows, accepted/rejected `CompletionDecision`

- [ ] **Step 1: `agent_end`만으로 FACT가 완료되지 않는 test 작성**

```ts
const decision = await gate.decide({
  stage: "fact",
  sessionStatus: "settled",
  rootWorkStatus: "settled",
  childWorkStatuses: [],
  activeActivities: [],
  artifactSchemaValid: false,
  requiredRelationsValid: true,
  finalArtifactPersisted: false,
  indexCandidateValid: false,
  stageManifestValid: false,
});
expect(decision).toEqual({
  accepted: false,
  unmetGates: ["FACT_SCHEMA_INVALID"],
});
```

- [ ] **Step 2: Completion gate test 실패 확인**

Run: `npm test --workspace @scenarioforge/scenario-pipeline -- stage-completion-gate`

Expected: FAIL because gate is absent.

- [ ] **Step 3: 8개 완료 조건을 순서대로 구현**

Check settled root/children, no active activity, schema, required ID/source relation, atomic final file, index candidate rows, stage manifest, journal/checkpoint commit. Return exact `unmetGates` codes without completing the stage.

```ts
export type StageCompletionInput = {
  stage: AnalysisStage;
  sessionStatus: AgentWorkStatus;
  rootWorkStatus: AgentWorkStatus;
  childWorkStatuses: AgentWorkStatus[];
  activeActivities: VerifiableActivity[];
  artifactSchemaValid: boolean;
  requiredRelationsValid: boolean;
  finalArtifactPersisted: boolean;
  indexCandidateValid: boolean;
  stageManifestValid: boolean;
};
```

- [ ] **Step 4: revision-tagged artifact index 구현**

Index rows include `transactionId`, `stateRevision`, `artifactId`, `relatedId`, and `contentHash`. Query exposes rows only when `stateRevision <= canonicalRevision` and the journal commit contains the same hash.

```ts
export type ArtifactIndexRow = {
  transactionId: string;
  stateRevision: number;
  artifactId: string;
  relatedId: string;
  contentHash: string;
};
```

- [ ] **Step 5: Orphan recovery test 구현**

Crash after final artifact write but before journal commit, then assert recovery moves the file under `.scenarioforge/state/orphans/` and does not expose it through `ArtifactQueryService`.

```ts
await expect(query.getArtifactById("FACT-ORPHAN-1")).resolves.toBeNull();
await expect(stat(join(projectRoot, ".scenarioforge/state/orphans/FACT-ORPHAN-1.json"))).resolves.toBeDefined();
```

- [ ] **Step 6: Stage pipeline test 실행**

Run: `npm test --workspace @scenarioforge/scenario-pipeline`

Expected: PASS for SRC→FACT→WIKI→SCENARIO order, completion rejection, retry attempt, and immutable completed stage.

- [ ] **Step 7: Analysis domain 커밋**

```bash
git add packages/scenario-pipeline
git commit -m "feat: gate analysis stage completion"
```

### Task 8: Q&A와 test planning session 격리

**Files:**
- Create: `packages/scenario-pipeline/src/query/artifact-query-service.ts`
- Create: `packages/scenario-pipeline/src/query/artifact-query-service.test.ts`
- Create: `packages/scenario-pipeline/src/workflows/scenario-answer-workflow.ts`
- Create: `packages/scenario-pipeline/src/workflows/scenario-answer-workflow.test.ts`
- Create: `packages/scenario-pipeline/src/workflows/test-plan-workflow.ts`
- Create: `packages/scenario-pipeline/src/workflows/test-plan-workflow.test.ts`

**Interfaces:**
- Consumes: selected scenario IDs, canonical revision, immutable scenario snapshot
- Produces: cited chat record or validated immutable test plan; never analysis or execution mutation

- [ ] **Step 1: ID graph 전체 조회 test 작성**

```ts
expect(await query.getScenarioContext("SCN-ORD-001")).toEqual({
  scenario: expect.objectContaining({ id: "SCN-ORD-001" }),
  sourceIds: ["SRC-CHECKOUT-001"],
  factIds: ["FACT-ORD-014", "FACT-PAY-021"],
  wikiIds: ["WIKI-CHECKOUT-003"],
  executionIds: [],
  evidenceIds: [],
});
```

- [ ] **Step 2: Query service test 실패 확인**

Run: `npm test --workspace @scenarioforge/scenario-pipeline -- artifact-query-service`

Expected: FAIL because service is absent.

- [ ] **Step 3: Canonical revision-filtered ID graph 조회 구현**

Implement `scenario.getById`, `source.listByScenarioId`, `fact.listByScenarioId`, `wiki.listByScenarioId`, `execution.listByScenarioId`, and `evidence.listByScenarioId` through one query service.

```ts
export interface ArtifactQueryService {
  getScenarioById(id: string, revision: number): Promise<ScenarioArtifact | null>;
  listSourcesByScenarioId(id: string, revision: number): Promise<SourceArtifact[]>;
  listFactsByScenarioId(id: string, revision: number): Promise<FactArtifact[]>;
  listWikiByScenarioId(id: string, revision: number): Promise<WikiArtifact[]>;
  listExecutionsByScenarioId(id: string): Promise<TestExecution[]>;
  listEvidenceByScenarioId(id: string): Promise<StepEvidence[]>;
}
```

- [ ] **Step 4: Scenario answer validator 구현**

Reject responses whose `citedIds` contain an ID absent from the query result. Append accepted response to its conversation only; assert analysis state revision changes only through a conversation-record event.

```ts
export type ScenarioAnswerRecord = {
  conversationId: string;
  question: string;
  scenarioIds: string[];
  citedIds: string[];
  answer: string;
  createdAt: string;
};
```

- [ ] **Step 5: Test plan snapshot validator 구현**

The plan contains `executionId`, `scenarioSnapshotHash`, ordered cases, ordered steps, allowed actions, selectors/assertions, and redacted data references. Reject plan requests that mutate Runner queue or evidence.

```ts
export type ImmutableTestPlan = Readonly<{
  executionId: string;
  scenarioSnapshotHash: string;
  cases: readonly TestPlanCase[];
  createdByWorkId: string;
}>;
```

- [ ] **Step 6: Session isolation tests 실행**

Run: `npm test --workspace @scenarioforge/scenario-pipeline`

Expected: chat cannot write analysis artifacts; test planning cannot write execution state; all cited IDs resolve at the captured revision.

- [ ] **Step 7: Query/planning 커밋**

```bash
git add packages/scenario-pipeline/src/query packages/scenario-pipeline/src/workflows
git commit -m "feat: isolate query and test planning sessions"
```

### Task 9: 결정론적 Test Runtime과 evidence store

**Files:**
- Create: `packages/test-runtime/src/coordinator/test-coordinator.ts`
- Create: `packages/test-runtime/src/coordinator/test-coordinator.test.ts`
- Create: `packages/test-runtime/src/runner/testvista-driver.ts`
- Create: `packages/test-runtime/src/verdict/classify-verdict.ts`
- Create: `packages/evidence-store/src/writer/evidence-writer.ts`
- Create: `packages/evidence-store/src/writer/evidence-writer.test.ts`
- Create: `packages/evidence-store/src/masking/mask-sensitive-fields.ts`
- Create: `packages/evidence-store/src/integrity/evidence-hash.ts`

**Interfaces:**
- Consumes: immutable validated test plan
- Produces: sequential case/step events and immutable screenshot/error evidence

- [ ] **Step 1: 실패 후 다음 case 계속 test 작성**

```ts
const execution = {
  executionId: "execution-1",
  scenarioIds: ["SCN-ORD-001", "SCN-PAY-001"],
} as const;
expect(await coordinator.run(execution)).toMatchObject({
  cases: [
    { scenarioId: "SCN-ORD-001", status: "failed", steps: [{ status: "failed" }, { status: "skipped" }] },
    { scenarioId: "SCN-PAY-001", status: "passed" },
  ],
});
```

- [ ] **Step 2: Sequential coordinator test 실패 확인**

Run: `npm test --workspace @scenarioforge/test-runtime`

Expected: FAIL because coordinator is absent.

- [ ] **Step 3: Project별 단일 queue와 cancel/retry 구현**

One case runs at a time. Cancel preserves written evidence and marks current/remaining cases cancelled. Retry creates a new execution ID and `retryOfExecutionId`.

```ts
export interface TestCoordinator {
  createExecution(plan: ImmutableTestPlan): Promise<TestExecution>;
  enqueueScenarios(executionId: string, scenarioIds: string[]): Promise<TestExecution>;
  cancelExecution(executionId: string): Promise<TestExecution>;
  retryCases(executionId: string, scenarioIds: string[]): Promise<TestExecution>;
}
```

- [ ] **Step 4: Capture policy와 fail-closed masking 구현**

Passed step writes one `action-complete.png`. Failed step writes `action-complete.png`, `before-failure.png`, `failure.png`, and `failure-context.json`. If masking or storage fails, stop the whole execution.

```ts
const requiredCaptureKinds = {
  passed: ["action-complete"],
  failed: ["action-complete", "before-failure", "failure"],
} as const;
```

- [ ] **Step 5: Evidence hash와 immutable manifest test 구현**

Write SHA-256 hashes for every capture/context file. Reject overwrite when execution manifest is final; user retry creates a new directory.

```ts
export type EvidenceFileRecord = {
  relativePath: string;
  sha256: string;
  size: number;
  createdAt: string;
};
```

- [ ] **Step 6: Test/evidence package 검증**

Run: `npm test --workspace @scenarioforge/test-runtime && npm test --workspace @scenarioforge/evidence-store`

Expected: PASS.

- [ ] **Step 7: Test runtime 커밋**

```bash
git add packages/test-runtime packages/evidence-store
git commit -m "feat: persist sequential test evidence"
```

### Task 10: 실제 Pi 하네스·skill·agent resource 연결 — 마지막 기능 작업

**Files:**
- Create: `packages/project-runtime/runtime-template/AGENTS.md`
- Create: `packages/project-runtime/runtime-template/SYSTEM.md`
- Modify: `packages/project-runtime/runtime-template/WORK_PROTOCOL.md`
- Create: `packages/project-runtime/runtime-template/skills/source-map/SKILL.md`
- Create: `packages/project-runtime/runtime-template/skills/fact-extract/SKILL.md`
- Create: `packages/project-runtime/runtime-template/skills/wiki-compose/SKILL.md`
- Create: `packages/project-runtime/runtime-template/skills/scenario-compose/SKILL.md`
- Create: `packages/project-runtime/runtime-template/agents/fact-analyst.md`
- Create: `packages/project-runtime/runtime-template/agents/source-mapper.md`
- Create: `packages/project-runtime/runtime-template/agents/wiki-writer.md`
- Create: `packages/project-runtime/runtime-template/agents/scenario-designer.md`
- Create: `packages/pi-runtime/src/tools/work-state-tools.ts`
- Create: `packages/pi-runtime/src/tools/artifact-query-tools.ts`
- Create: `packages/pi-runtime/src/resources/resource-loader.ts`
- Create: `packages/pi-runtime/src/resources/resource-loader.test.ts`

**Interfaces:**
- Consumes: all function policies, WorkStateService, query service, validators
- Produces: versioned Resource Bundle whose instructions can only invoke existing backend contracts

- [ ] **Step 1: Resource manifest coverage test 작성**

```ts
for (const functionId of Object.keys(functionPolicies)) {
  expect(resourceManifest.functions[functionId]).toMatchObject({
    protocolVersion: resourceManifest.protocolVersion,
    policyHash: hashFunctionPolicy(functionPolicies[functionId]),
  });
}
```

Implement `hashFunctionPolicy()` in `packages/pi-runtime/src/resources/resource-manifest.ts` using stable key ordering and SHA-256 before this assertion.

- [ ] **Step 2: Tool schema parity test 작성**

Assert every work-state tool input validates against the same contract used by `WorkStateService`; no tool accepts arbitrary project paths, canonical state patches, completion booleans, or hard-delete operations.

```ts
expect(workStateToolNames).toEqual([
  "work.getContext",
  "work.begin",
  "work.requestChild",
  "work.updateProgress",
  "work.recordActivity",
  "work.submitArtifacts",
  "work.discardDraft",
  "work.reportFailure",
  "work.requestCompletion",
]);
```

- [ ] **Step 3: 공통 harness 작성**

The harness requires `getContext → begin`, ID query before claims, staging-only writes, structured failure reporting, and `requestCompletion`. It explicitly states that a natural-language completion response does not complete a stage.

```md
## Required work lifecycle

1. Call `work.getContext` for this work ID.
2. Start with the returned context token and revision.
3. Use ID query tools before making repository or artifact claims.
4. Write only to the assigned staging scope.
5. Submit structured artifacts, then request completion.
6. Continue when completion is rejected; do not claim domain completion yourself.
```

- [ ] **Step 4: 기능별 skill과 agent instruction 작성**

Each resource names its exact `LlmFunctionId`, required input IDs, allowed tools, child delegation rule, output schema, and prohibited writes from Task 6. `scenario.answer` remains in the scenario route and `test.plan` cannot control Runner execution.

```yaml
function_id: analysis.fact-extract
required_inputs: [source_ids]
allowed_tools: [work.getContext, work.begin, artifact.source.read, work.recordActivity, work.submitArtifacts, work.requestCompletion]
child_delegation: module-batch
output_schema: fact-artifact-v1
prohibited_writes: [canonical-state, wiki, scenario, test-execution, evidence]
```

- [ ] **Step 5: Resource loader hash/version 검증 구현**

Reject a bundle whose protocol hash, function policy hash, skill list, or agent list differs from `runtime-manifest.json`. Existing runs retain their original resource version.

```ts
export type RuntimeResourceManifest = {
  runtimeVersion: string;
  protocolVersion: string;
  protocolHash: string;
  functions: Record<LlmFunctionId, { policyHash: string; skillPaths: string[]; agentPaths: string[] }>;
};
```

- [ ] **Step 6: Harness/resource test 실행**

Run: `npm test --workspace @scenarioforge/pi-runtime && npm test --workspace @scenarioforge/project-runtime`

Expected: PASS.

- [ ] **Step 7: Harness 커밋**

```bash
git add packages/project-runtime/runtime-template packages/pi-runtime/src/tools packages/pi-runtime/src/resources
git commit -m "feat: add ScenarioForge Pi resources"
```

### Task 11: 실제 Pi 통합과 복구 E2E

**Files:**
- Modify: `packages/pi-runtime/src/host/pi-runtime-host.ts`
- Create: `packages/pi-runtime/src/host/pi-sdk-driver.ts`
- Create: `apps/desktop/src/main/app/application-orchestrator.ts`
- Create: `apps/desktop/src/main/ipc/project-ipc.ts`
- Create: `apps/desktop/src/main/ipc/analysis-ipc.ts`
- Create: `apps/desktop/src/main/ipc/test-ipc.ts`
- Create: `tests/e2e/pi-analysis-recovery.test.ts`
- Create: `tests/e2e/test-evidence.test.ts`

**Interfaces:**
- Consumes: configured LLM provider, bundled Pi SDK, all backend packages
- Produces: real project analysis, restart recovery, scenario Q&A, sequential test/evidence IPC

- [ ] **Step 1: Fake-driver E2E baseline 작성**

Select a fixture project, bootstrap it, complete SRC→FACT→WIKI→SCENARIO through fake Pi events, restart the orchestrator at FACT validating, and assert recovery resumes from the last valid revision.

```ts
await orchestrator.startAnalysis(projectId);
await fakePi.settleStage("src", validSourceArtifact());
await fakePi.settleStage("fact", validFactArtifact());
await orchestrator.crashForTest("after-journal-before-publish");
const restored = await createOrchestrator().restoreProject(projectId);
expect(restored.runtimeStatus).toBe("recovering");
```

- [ ] **Step 2: Actual Pi SDK driver 연결**

Implement create, restore, prompt, abort, compact, and dispose using the pinned Pi version. Pass raw events only to `PiEventAdapter`.

```ts
import {
  createAgentSession,
  SessionManager,
  type ModelRuntime,
  type ResourceLoader,
} from "@earendil-works/pi-coding-agent";

type AgentSession = Awaited<ReturnType<typeof createAgentSession>>["session"];

export class PiSdkDriver implements PiSessionDriver {
  private readonly sessions = new Map<string, AgentSession>();
  private readonly unsubscribers = new Map<string, () => void>();

  constructor(
    private readonly modelRuntime: ModelRuntime,
    private readonly resourceLoaderFor: (cwd: string) => Promise<ResourceLoader>,
    private readonly sessionMetadataFor: (sessionId: string) => {
      sessionFile: string;
      cwd: string;
      agentDir: string;
    },
    private readonly onRawEvent: (sessionId: string, event: unknown) => void,
  ) {}

  async create(input: SessionCreateInput): Promise<SessionHandle> {
    const resourceLoader = await this.resourceLoaderFor(input.cwd);
    const { session } = await createAgentSession({
      cwd: input.cwd,
      agentDir: input.agentDir,
      modelRuntime: this.modelRuntime,
      resourceLoader,
      sessionManager: SessionManager.create(input.cwd),
    });
    const unsubscribe = session.subscribe((event) => this.onRawEvent(session.sessionId, event));
    this.sessions.set(session.sessionId, session);
    this.unsubscribers.set(session.sessionId, unsubscribe);
    return { sessionId: session.sessionId, sessionFile: session.sessionFile };
  }

  async restore(sessionId: string): Promise<SessionHandle> {
    const metadata = this.sessionMetadataFor(sessionId);
    const resourceLoader = await this.resourceLoaderFor(metadata.cwd);
    const { session } = await createAgentSession({
      cwd: metadata.cwd,
      agentDir: metadata.agentDir,
      sessionManager: SessionManager.open(metadata.sessionFile),
      modelRuntime: this.modelRuntime,
      resourceLoader,
    });
    const unsubscribe = session.subscribe((event) => this.onRawEvent(session.sessionId, event));
    this.sessions.set(session.sessionId, session);
    this.unsubscribers.set(session.sessionId, unsubscribe);
    return { sessionId: session.sessionId, sessionFile: session.sessionFile };
  }

  async prompt(sessionId: string, input: StructuredPrompt): Promise<void> {
    await this.requireSession(sessionId).prompt(input.text);
  }

  async abort(sessionId: string): Promise<void> {
    await this.requireSession(sessionId).abort();
  }

  async compact(sessionId: string): Promise<void> {
    await this.requireSession(sessionId).compact();
  }

  async dispose(sessionId: string): Promise<void> {
    this.unsubscribers.get(sessionId)?.();
    this.unsubscribers.delete(sessionId);
    this.requireSession(sessionId).dispose();
    this.sessions.delete(sessionId);
  }

  private requireSession(sessionId: string): AgentSession {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Unknown Pi session: ${sessionId}`);
    return session;
  }
}
```

- [ ] **Step 3: Renderer IPC snapshot/event bridge 구현**

Expose `project.getState`, `project.getEventsSince`, activities, analysis commands, scenario query, test execution, and evidence reads through allowlisted preload methods. Main validates every project/run/scenario/execution relation.

```ts
export type MainCommandHandlers = {
  getProjectState(projectId: string): Promise<ProjectRuntimeState>;
  getProjectEventsSince(projectId: string, revision: number): Promise<ScenarioForgeDomainEvent[]>;
  startAnalysis(projectId: string): Promise<{ analysisRunId: string }>;
  askScenario(input: ScenarioQuestion): Promise<ScenarioAnswerRecord>;
  createExecution(input: TestExecutionRequest): Promise<{ executionId: string }>;
  getStepEvidence(input: EvidenceStepRequest): Promise<StepEvidence>;
};
```

- [ ] **Step 4: Recovery and evidence E2E 실행**

Run: `npm test && npm run typecheck && npm run build`

Expected: all packages and desktop build PASS; restart never restores an active state directly as running; every successful and failed test step has the required evidence files.

- [ ] **Step 5: Final integration 커밋**

```bash
git add apps packages tests package.json package-lock.json
git commit -m "feat: integrate Pi runtime and test evidence"
```
