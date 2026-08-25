# State-driven Test Center UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pi/LLM 하네스 없이도 영속 도메인 상태 계약을 사용해 프로젝트 준비, 분석, 복구, 시나리오, 순차 테스트 수행, 증적 보관함과 상세 화면을 모두 재현하고 검증한다.

**Architecture:** Renderer는 preview fixture 또는 typed IPC snapshot을 동일한 reducer에 공급하고, hash route와 `ProjectStore`·`AnalysisExecutionStore`·`ActivityStore`·`TestExecutionStore`가 화면을 결정한다. 기존 디자인 토큰과 시나리오 화면을 유지하면서 테스트 센터와 증적 화면을 독립 상위 route로 추가한다.

**Tech Stack:** Electron 44, React, TypeScript, Vite 7, Vitest 4, CSS, lucide-react

**Spec:** `docs/superpowers/specs/2026-08-25-scenarioforge-pi-runtime-test-execution-design.md`

## Global Constraints

- Node.js는 `>=22.12.0`, npm은 `>=10.0.0`을 사용한다.
- Pi 원시 이벤트와 모델 텍스트를 Renderer에 전달하지 않는다.
- 화면 fixture도 production과 같은 `ProjectRuntimeState`와 `DomainEvent` schema를 사용한다.
- 질의 입력은 시나리오 도출 화면에만 둔다.
- 테스트는 시나리오 순서대로 실행하며 실패 케이스의 후속 step은 `skipped`로 표시한다.
- 성공 step은 완료 화면 1장, 실패 step은 완료 화면·실패 직전·실패 시점·오류 정보를 표현한다.
- Renderer에는 Node.js, 파일 시스템, process 실행 권한을 추가하지 않는다.
- API key와 테스트 개인정보 원문을 fixture, event, 화면 캡처, README에 포함하지 않는다.
- 실제 Pi/LLM 하네스, skill, subagent prompt는 이 계획에서 구현하지 않는다.

## File Structure

| 파일 | 책임 |
| --- | --- |
| `src/shared/runtime-state.ts` | 프로젝트·runtime·session·stage·artifact·activity 상태와 domain event 계약 |
| `src/shared/test-execution.ts` | execution·case·step·evidence 계약과 결과 집계 함수 |
| `src/renderer/src/app/routes.ts` | hash route parse/format과 preview mode parse |
| `src/renderer/src/stores/project-store.ts` | snapshot/event revision 적용과 주 화면 selector |
| `src/renderer/src/stores/test-execution-store.ts` | 순차 execution event reducer와 선택 상태 |
| `src/renderer/src/demo/preview-fixtures.ts` | backend 없이 각 화면 상태를 재현하는 schema-valid fixture |
| `src/renderer/src/components/ProjectNavigation.tsx` | 작업대·시나리오·테스트 수행·증적 보관함 상위 탐색 |
| `src/renderer/src/components/RuntimeStatePanel.tsx` | 준비·분석·복구·오류 상태와 검증된 진행률 |
| `src/renderer/src/components/ActivityPanel.tsx` | tool·skill·subagent·validator의 검증 가능한 활동 |
| `src/renderer/src/components/TestCenter.tsx` | 실행 이력·순차 case queue·선택 case 증적 preview |
| `src/renderer/src/components/EvidenceLibrary.tsx` | execution별 증적 이력과 저장 용량 안내 |
| `src/renderer/src/components/EvidenceDetail.tsx` | step timeline·capture filmstrip·판정 근거와 오류 정보 |
| `src/renderer/src/styles/test-center.css` | 테스트 센터와 증적 화면 레이아웃 |
| `src/renderer/src/App.tsx` | Store hydration, route 전환, 기존 화면 조합 |
| `README.md` | 구현 상태와 실제 화면 캡처 설명 |

---

### Task 1: Runtime 및 테스트 수행 계약

**Files:**
- Create: `src/shared/runtime-state.ts`
- Create: `src/shared/runtime-state.test.ts`
- Create: `src/shared/test-execution.ts`
- Create: `src/shared/test-execution.test.ts`
- Modify: `src/shared/desktop-api.ts`

**Interfaces:**
- Consumes: 설계 문서 5.3의 상태 이름과 5.6의 event envelope
- Produces: `ProjectRuntimeState`, `ScenarioForgeDomainEvent`, `TestExecution`, `StepEvidence`, `deriveExecutionResult()`, `TestExecutionAccepted`

- [ ] **Step 1: Runtime 상태 validator의 실패 테스트 작성**

```ts
import { describe, expect, it } from "vitest";
import {
  createInitialProjectRuntimeState,
  isProjectRuntimeState,
} from "./runtime-state";

describe("isProjectRuntimeState", () => {
  it("accepts the complete initial state", () => {
    expect(isProjectRuntimeState(createInitialProjectRuntimeState())).toBe(true);
  });

  it("rejects a state without a monotonic revision", () => {
    expect(
      isProjectRuntimeState({
        ...createInitialProjectRuntimeState(),
        revision: -1,
      }),
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Runtime 계약 테스트가 구현 부재로 실패하는지 확인**

Run: `npm test -- src/shared/runtime-state.test.ts`

Expected: FAIL because `./runtime-state` does not exist.

- [ ] **Step 3: Runtime 상태와 event envelope 최소 구현**

```ts
export type AnalysisStage = "src" | "fact" | "wiki" | "scenario";
export type AgentWorkStatus =
  | "creating"
  | "idle"
  | "running"
  | "retrying"
  | "compacting"
  | "cancelling"
  | "settled"
  | "recovering"
  | "failed";

export type ProjectRuntimeState = {
  schemaVersion: 1;
  projectId?: string;
  revision: number;
  projectStatus: "unselected" | "configuring" | "ready" | "error";
  runtimeStatus:
    | "unconfigured"
    | "preparing"
    | "ready"
    | "recovering"
    | "stopped"
    | "error";
  sessionStatus: AgentWorkStatus;
  sessionId?: string;
  analysisRunId?: string;
  activeStage?: AnalysisStage;
  stages: Record<AnalysisStage, "pending" | "running" | "validating" | "completed" | "failed">;
  artifactStatus: Record<AnalysisStage, "absent" | "generating" | "validating" | "verified" | "persisted" | "invalid">;
  progress: number;
  currentActivity?: string;
  recoverable: boolean;
  lastCheckpointId?: string;
  lastError?: { category: string; message: string };
};

export type ScenarioForgeDomainEvent<TType extends string = string, TPayload = unknown> = {
  schemaVersion: 1;
  eventId: string;
  projectId: string;
  revision: number;
  occurredAt: string;
  type: TType;
  payload: TPayload;
};

export type VerifiableActivity = {
  activityId: string;
  kind: "tool" | "skill" | "subagent" | "validator";
  name: string;
  targetIds: string[];
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  startedAt: string;
  finishedAt?: string;
  summary?: string;
};

export function createInitialProjectRuntimeState(): ProjectRuntimeState {
  return {
    schemaVersion: 1,
    revision: 0,
    projectStatus: "unselected",
    runtimeStatus: "unconfigured",
    sessionStatus: "idle",
    stages: { src: "pending", fact: "pending", wiki: "pending", scenario: "pending" },
    artifactStatus: { src: "absent", fact: "absent", wiki: "absent", scenario: "absent" },
    progress: 0,
    recoverable: false,
  };
}

export function createReadyProjectRuntimeState(): ProjectRuntimeState {
  return {
    ...createInitialProjectRuntimeState(),
    projectId: "project-1",
    projectStatus: "ready",
    runtimeStatus: "ready",
  };
}

export function isProjectRuntimeState(value: unknown): value is ProjectRuntimeState {
  if (!value || typeof value !== "object") return false;
  const state = value as Partial<ProjectRuntimeState>;
  return state.schemaVersion === 1 &&
    Number.isInteger(state.revision) &&
    (state.revision ?? -1) >= 0 &&
    typeof state.progress === "number" &&
    state.progress >= 0 &&
    state.progress <= 100 &&
    typeof state.stages === "object" &&
    typeof state.artifactStatus === "object";
}
```

- [ ] **Step 4: 테스트 결과 집계 실패 테스트 작성**

```ts
import { describe, expect, it } from "vitest";
import { deriveExecutionResult, type TestCaseResult } from "./test-execution";

describe("deriveExecutionResult", () => {
  it("keeps failed above inconclusive and cancelled", () => {
    const cases = [
      { status: "passed" },
      { status: "inconclusive" },
      { status: "failed" },
    ] as TestCaseResult[];
    expect(deriveExecutionResult(cases)).toBe("failed");
  });
});
```

- [ ] **Step 5: Test execution과 evidence 계약 최소 구현**

```ts
export type TestResultStatus = "passed" | "failed" | "inconclusive" | "cancelled";
export type TestStepStatus = "queued" | "running" | TestResultStatus | "skipped";

export type EvidenceCapture = {
  id: string;
  kind: "action-complete" | "before-failure" | "failure";
  imagePath: string;
  capturedAt: string;
};

export type StepEvidence = {
  evidenceId: string;
  executionId: string;
  scenarioId: string;
  stepOrder: number;
  status: TestStepStatus;
  action: string;
  expected: string;
  actual: string;
  captures: EvidenceCapture[];
  error?: { category: string; message: string; selector?: string; timeoutMs?: number };
};

export type TestCaseResult = {
  scenarioId: string;
  title: string;
  status: TestStepStatus;
  steps: StepEvidence[];
};

export type TestExecution = {
  executionId: string;
  retryOfExecutionId?: string;
  scenarioRunId: string;
  targetUrl: string;
  status: "queued" | "preparing" | "running" | TestResultStatus;
  createdAt: string;
  completedAt?: string;
  cases: TestCaseResult[];
  evidenceBytes: number;
};

export function deriveExecutionResult(cases: TestCaseResult[]): TestResultStatus {
  if (cases.some((item) => item.status === "failed")) return "failed";
  if (cases.some((item) => item.status === "inconclusive")) return "inconclusive";
  if (cases.some((item) => item.status === "cancelled")) return "cancelled";
  return "passed";
}
```

- [ ] **Step 6: IPC snapshot/event 조회 계약 추가 후 전체 shared test 실행**

```ts
export const IPC_CHANNELS = {
  // existing channels remain unchanged
  getProjectState: "project:get-state",
  getProjectEventsSince: "project:get-events-since",
  getProjectActivities: "project:get-activities",
} as const;

export type TestExecutionAccepted = { executionId: string };

export type ScenarioForgeDesktopApi = {
  // keep the existing typed methods
  startScenarioTests: (request: TestExecutionRequest) => Promise<TestExecutionAccepted>;
  getProjectState: (projectId: string) => Promise<ProjectRuntimeState>;
  getProjectEventsSince: (projectId: string, revision: number) => Promise<ScenarioForgeDomainEvent[]>;
};
```

Run: `npm test -- src/shared/runtime-state.test.ts src/shared/test-execution.test.ts src/shared/scenario.test.ts`

Expected: PASS.

- [ ] **Step 7: 계약 커밋**

```bash
git add src/shared/runtime-state.ts src/shared/runtime-state.test.ts src/shared/test-execution.ts src/shared/test-execution.test.ts src/shared/desktop-api.ts
git commit -m "feat: add runtime and execution contracts"
```

### Task 2: Route와 revision 기반 Renderer Store

**Files:**
- Create: `src/renderer/src/app/routes.ts`
- Create: `src/renderer/src/app/routes.test.ts`
- Create: `src/renderer/src/stores/project-store.ts`
- Create: `src/renderer/src/stores/project-store.test.ts`
- Create: `src/renderer/src/stores/test-execution-store.ts`
- Create: `src/renderer/src/stores/test-execution-store.test.ts`

**Interfaces:**
- Consumes: `ProjectRuntimeState`, `ScenarioForgeDomainEvent`, `TestExecution`
- Produces: `ProjectRoute`, `parseProjectRoute()`, `applyProjectEvent()`, `selectPrimaryView()`, `reduceTestExecution()`

- [ ] **Step 1: Hash route 왕복 테스트 작성**

```ts
expect(
  parseProjectRoute("#/projects/prj-1/tests/exe-2/cases/SCN-ORD-001/steps/4"),
).toEqual({
  name: "evidence-detail",
  projectId: "prj-1",
  executionId: "exe-2",
  scenarioId: "SCN-ORD-001",
  stepOrder: 4,
});
expect(formatProjectRoute(parseProjectRoute("#/projects/prj-1/tests"))).toBe(
  "#/projects/prj-1/tests",
);
```

- [ ] **Step 2: Route test의 module-not-found 실패 확인**

Run: `npm test -- src/renderer/src/app/routes.test.ts`

Expected: FAIL because `routes.ts` does not exist.

- [ ] **Step 3: Route union과 parse/format 구현**

```ts
export type ProjectRoute =
  | { name: "workspace"; projectId: string }
  | { name: "scenarios"; projectId: string; runId: string; scenarioId?: string }
  | { name: "test-center"; projectId: string; executionId?: string }
  | { name: "evidence-library"; projectId: string }
  | { name: "evidence-detail"; projectId: string; executionId: string; scenarioId: string; stepOrder: number };
```

- [ ] **Step 4: Store revision 규칙과 주 화면 selector 테스트 작성**

```ts
it("requests replay for a revision gap", () => {
  const state = { ...createInitialProjectRuntimeState(), revision: 4 };
  const event = {
    schemaVersion: 1,
    eventId: "event-6",
    projectId: "project-1",
    revision: 6,
    occurredAt: "2026-08-25T08:00:00.000Z",
    type: "runtime.status.changed",
    payload: { runtimeStatus: "ready" },
  } as const;
  const result = applyProjectEvent(state, event);
  expect(result).toEqual({ kind: "gap", afterRevision: 4 });
});

it("does not treat settled as analysis completion", () => {
  const base = createReadyProjectRuntimeState();
  const state = {
    ...base,
    sessionStatus: "settled",
    artifactStatus: { ...base.artifactStatus, scenario: "validating" },
  };
  expect(selectPrimaryView(state)).toBe("analysis-progress");
});
```

- [ ] **Step 5: Store reducer와 selector 최소 구현**

```ts
export type EventApplyResult =
  | { kind: "applied"; state: ProjectRuntimeState }
  | { kind: "ignored"; state: ProjectRuntimeState }
  | { kind: "gap"; afterRevision: number };

export function selectPrimaryView(state: ProjectRuntimeState) {
  if (state.projectStatus === "unselected") return "project-selection";
  if (state.runtimeStatus === "preparing") return "runtime-preparing";
  if (state.runtimeStatus === "recovering" || state.sessionStatus === "recovering") return "recovery";
  if (state.runtimeStatus === "error" || state.projectStatus === "error") return "error";
  if (state.artifactStatus.scenario === "persisted") return "scenarios-ready";
  if (state.activeStage) return "analysis-progress";
  return "analysis-ready";
}
```

- [ ] **Step 6: 순차 test event reducer 구현과 전체 Store test 실행**

Run: `npm test -- src/renderer/src/app/routes.test.ts src/renderer/src/stores/project-store.test.ts src/renderer/src/stores/test-execution-store.test.ts`

Expected: PASS, including duplicate revision ignore and failed-case remaining-step skip tests.

- [ ] **Step 7: Store 커밋**

```bash
git add src/renderer/src/app src/renderer/src/stores
git commit -m "feat: add revision-aware renderer stores"
```

### Task 3: Schema-valid preview fixture와 프로젝트 상위 탐색

**Files:**
- Create: `src/renderer/src/demo/preview-fixtures.ts`
- Create: `src/renderer/src/demo/preview-fixtures.test.ts`
- Create: `src/renderer/src/components/ProjectNavigation.tsx`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/styles/base.css`
- Modify: `src/renderer/src/styles/responsive.css`

**Interfaces:**
- Consumes: `ProjectRoute`, runtime/test contracts
- Produces: `PreviewMode`, `createPreviewState()`, global project navigation

- [ ] **Step 1: Preview fixture validator 테스트 작성**

```ts
for (const mode of [
  "workspace",
  "runtime-preparing",
  "analysis-fact",
  "recovery",
  "runtime-error",
  "test-running",
  "test-failed",
  "evidence-library",
  "evidence-failure",
] as const) {
  it(`${mode} fixture satisfies runtime contracts`, () => {
    expect(isProjectRuntimeState(createPreviewState(mode).project)).toBe(true);
  });
}
```

- [ ] **Step 2: Fixture test 실패 확인**

Run: `npm test -- src/renderer/src/demo/preview-fixtures.test.ts`

Expected: FAIL because preview fixture module is absent.

- [ ] **Step 3: 고정 ID와 민감정보 없는 fixture 구현**

```ts
export const previewIds = {
  projectId: "PRJ-COMMERCE",
  runId: "RUN-20260825-1542",
  executionId: "EXE-20260825-0007",
  retryExecutionId: "EXE-20260825-0008",
} as const;
```

Fixture의 실패 오류는 `checkout.submit` selector와 timeout만 포함하고 email, password, card token 값을 포함하지 않는다.

`TestExecutionPanel`의 JSON 예시는 다음처럼 값 출처만 안내하고 실행 가능한 secret 형태를 넣지 않는다.

```json
{
  "user": {
    "email": "<TEST_EMAIL_FROM_MEMORY>",
    "password": "<TEST_SECRET_FROM_MEMORY>"
  },
  "payment": {
    "cardToken": "<TEST_TOKEN_FROM_MEMORY>"
  }
}
```

- [ ] **Step 4: 상위 탐색 component 구현**

```tsx
<nav className="project-navigation" aria-label="프로젝트 탐색">
  <button aria-current={route.name === "workspace" ? "page" : undefined}>작업대</button>
  <button disabled={!scenarioReady}>시나리오</button>
  <button disabled={!scenarioReady}>테스트 수행</button>
  <button disabled={!hasEvidence}>증적 보관함</button>
</nav>
```

테스트 실행 중이면 `테스트 수행` label 옆에 현재 완료 case 수를 badge로 표시하고 route를 이동해도 execution fixture를 초기화하지 않는다.

- [ ] **Step 5: `App.tsx`의 preview와 hash route 상태를 fixture/store로 교체**

```ts
const preview = createPreviewState(readPreviewMode(window.location.search));
const [route, setRoute] = useState<ProjectRoute>(() =>
  preview.route ?? parseProjectRoute(window.location.hash),
);
```

기존 `modal`, `workspace`, `progress`, `result`, `result-selected` preview도 새 parser에서 계속 지원한다.

- [ ] **Step 6: 탐색·fixture test와 typecheck 실행**

Run: `npm test -- src/renderer/src/demo/preview-fixtures.test.ts src/renderer/src/app/routes.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 7: 상위 탐색 커밋**

```bash
git add src/renderer/src/demo src/renderer/src/components/ProjectNavigation.tsx src/renderer/src/App.tsx src/renderer/src/styles/base.css src/renderer/src/styles/responsive.css
git commit -m "feat: add project navigation and state previews"
```

### Task 4: Runtime·분석·복구 화면

**Files:**
- Create: `src/renderer/src/components/RuntimeStatePanel.tsx`
- Create: `src/renderer/src/components/ActivityPanel.tsx`
- Create: `src/renderer/src/components/RuntimeStatePanel.test.ts`
- Modify: `src/renderer/src/components/AnalysisProgress.tsx`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/styles/workspace.css`
- Modify: `src/renderer/src/styles/responsive.css`

**Interfaces:**
- Consumes: `ProjectRuntimeState`, `VerifiableActivity[]`, `selectPrimaryView()`
- Produces: 준비·진행·복구·복구 가능 오류를 동일 state에서 렌더링

- [ ] **Step 1: 상태별 presentation selector 테스트 작성**

```ts
expect(createRuntimePresentation(createPreviewState("runtime-preparing").project).title).toBe("Pi 작업환경 준비 중");
expect(createRuntimePresentation(createPreviewState("recovery").project).actions).toEqual([]);
expect(createRuntimePresentation(createPreviewState("runtime-error").project).actions).toEqual([
  "retry",
  "restart-analysis",
]);
```

- [ ] **Step 2: Presentation test 실패 확인**

Run: `npm test -- src/renderer/src/components/RuntimeStatePanel.test.ts`

Expected: FAIL because `createRuntimePresentation` is absent.

- [ ] **Step 3: RuntimeStatePanel과 recovery/error action 구현**

```tsx
<section className={`runtime-state-panel is-${presentation.tone}`} aria-live="polite">
  <span className="eyebrow">{presentation.kicker}</span>
  <h2>{presentation.title}</h2>
  <p>{presentation.description}</p>
  {presentation.actions.includes("retry") && <button onClick={onRetry}>복구 재시도</button>}
  {presentation.actions.includes("restart-analysis") && <button onClick={onRestart}>새 분석 시작</button>}
</section>
```

- [ ] **Step 4: AnalysisProgress를 timer가 아닌 stage/artifact 상태 기반으로 변경**

```tsx
<AnalysisProgress
  stages={state.stages}
  artifactStatus={state.artifactStatus}
  activeStage={state.activeStage}
  progress={state.progress}
/>
```

`sessionStatus === "settled"`여도 active artifact가 `validating`이면 해당 stage에 `검증 중`을 표시한다.

- [ ] **Step 5: 활동 패널 구현**

```tsx
<ul className="activity-list">
  {activities.map((activity) => (
    <li key={activity.activityId} data-status={activity.status}>
      <span>{activity.kind}</span>
      <strong>{activity.name}</strong>
      <small>{activity.summary}</small>
    </li>
  ))}
</ul>
```

활동에는 `repository-map skill`, `fact-analyst 2/4`, `source.read`, `FACT schema validator`처럼 실행 사실만 표시한다.

- [ ] **Step 6: Runtime 화면 test, typecheck, web build 실행**

Run: `npm test -- src/renderer/src/components/RuntimeStatePanel.test.ts && npm run typecheck && npm run build:web`

Expected: PASS and build output created without TypeScript errors.

- [ ] **Step 7: Runtime 화면 커밋**

```bash
git add src/renderer/src/components/RuntimeStatePanel.tsx src/renderer/src/components/RuntimeStatePanel.test.ts src/renderer/src/components/ActivityPanel.tsx src/renderer/src/components/AnalysisProgress.tsx src/renderer/src/App.tsx src/renderer/src/styles/workspace.css src/renderer/src/styles/responsive.css
git commit -m "feat: render durable runtime states"
```

### Task 5: 독립 테스트 센터와 순차 실행 화면

**Files:**
- Create: `src/renderer/src/components/TestCenter.tsx`
- Create: `src/renderer/src/components/TestCaseQueue.tsx`
- Create: `src/renderer/src/components/EvidencePreview.tsx`
- Modify: `src/renderer/src/components/ScenarioResults.tsx`
- Modify: `src/renderer/src/components/TestExecutionPanel.tsx`
- Modify: `src/renderer/src/App.tsx`
- Create: `src/renderer/src/styles/test-center.css`
- Modify: `src/renderer/src/main.tsx`

**Interfaces:**
- Consumes: `TestExecution`, `ProjectRoute`, `StepEvidence`
- Produces: `onOpenExecution`, `onCancel`, `onRetryCases`, `onOpenEvidence`, `onOpenScenario`

- [ ] **Step 1: 실행 생성 후 route 전환 reducer 테스트 추가**

```ts
it("opens the immutable execution after a request is accepted", () => {
  const next = reduceTestExecution(emptyTestStore(), executionCreatedEvent());
  expect(next.activeExecutionId).toBe("EXE-20260825-0007");
  expect(next.executions[0].cases.map((item) => item.status)).toEqual([
    "running",
    "queued",
    "queued",
  ]);
});
```

- [ ] **Step 2: Test store 회귀 test 실패 확인**

Run: `npm test -- src/renderer/src/stores/test-execution-store.test.ts`

Expected: FAIL until the new event and active execution selection are implemented.

- [ ] **Step 3: Scenario 결과의 실행 요청 성공 시 테스트 센터로 이동**

```ts
type TestExecutionAccepted = {
  executionId: string;
};

async function handleRun(targetUrl: string, personalData: Record<string, unknown>) {
  const accepted = await onCreateExecution({ targetUrl, personalData, scenarioIds });
  onNavigate({ name: "test-center", projectId, executionId: accepted.executionId });
}
```

실행 설정 drawer에는 Q&A 동작을 추가하지 않는다.

- [ ] **Step 4: C안 3열 TestCenter 구현**

```tsx
<div className="test-center-layout">
  <ExecutionHistory executions={executions} activeId={execution.id} />
  <TestCaseQueue cases={execution.cases} selectedScenarioId={selectedScenarioId} />
  <EvidencePreview evidence={selectedEvidence} />
</div>
```

`ExecutionHistory`는 `TestCenter.tsx` 내부의 다음 local component로 정의한다.

```ts
function ExecutionHistory({ executions, activeId }: {
  executions: TestExecution[];
  activeId: string;
}) {
  return <aside className="execution-history">{executions.map((item) => (
    <button key={item.executionId} aria-current={item.executionId === activeId ? "true" : undefined}>
      <strong>{item.executionId}</strong><span>{item.status}</span>
    </button>
  ))}</aside>;
}
```

왼쪽은 실행 회차와 `retryOfExecutionId`, 중앙은 현재·대기·완료 case, 오른쪽은 선택 step의 capture와 판정 요약을 표시한다.

- [ ] **Step 5: 중단·재실행·시나리오 이동 action 구현**

```tsx
<button onClick={() => onCancel(execution.id)}>실행 중단</button>
<button onClick={() => onRetryCases(execution.id, retryableScenarioIds)}>다시 실행</button>
<button onClick={() => onOpenScenario(caseItem.scenarioId)}>시나리오에서 보기</button>
```

중단 시 수집된 evidence 수와 남은 case 수를 confirmation에 표시한다. `이 ID로 질문` action은 어디에도 만들지 않는다.

- [ ] **Step 6: 1440px·900px·640px layout CSS 구현**

Desktop은 `280px minmax(420px, 1fr) 360px`, tablet은 history horizontal strip과 2열, mobile은 단일 column과 sticky execution summary를 사용한다.

```css
.test-center-layout { display: grid; grid-template-columns: 280px minmax(420px, 1fr) 360px; }
@media (max-width: 900px) { .test-center-layout { grid-template-columns: minmax(360px, 1fr) 320px; } }
@media (max-width: 640px) { .test-center-layout { grid-template-columns: 1fr; } }
```

- [ ] **Step 7: Test Center test/typecheck/build 실행**

Run: `npm test -- src/renderer/src/stores/test-execution-store.test.ts && npm run typecheck && npm run build:web`

Expected: PASS.

- [ ] **Step 8: 테스트 센터 커밋**

```bash
git add src/renderer/src/components/TestCenter.tsx src/renderer/src/components/TestCaseQueue.tsx src/renderer/src/components/EvidencePreview.tsx src/renderer/src/components/ScenarioResults.tsx src/renderer/src/components/TestExecutionPanel.tsx src/renderer/src/App.tsx src/renderer/src/styles/test-center.css src/renderer/src/main.tsx
git commit -m "feat: add sequential test center"
```

### Task 6: 증적 보관함과 실패 상세

**Files:**
- Create: `src/renderer/src/components/EvidenceLibrary.tsx`
- Create: `src/renderer/src/components/EvidenceDetail.tsx`
- Create: `src/renderer/src/components/evidence-presentation.ts`
- Create: `src/renderer/src/components/evidence-presentation.test.ts`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/styles/test-center.css`
- Modify: `src/renderer/src/styles/responsive.css`

**Interfaces:**
- Consumes: `TestExecution[]`, `StepEvidence`, `EvidenceCapture[]`
- Produces: `createEvidencePresentation()`, execution delete confirmation, retry/scenario navigation

- [ ] **Step 1: 성공·실패 capture 우선순위 test 작성**

```ts
it("puts failure and before-failure captures first for a failed step", () => {
  const evidence = createPreviewState("evidence-failure").evidence.activeStep;
  const result = createEvidencePresentation(evidence);
  expect(result.primaryCapture.kind).toBe("failure");
  expect(result.filmstrip.map((capture) => capture.kind)).toEqual([
    "failure",
    "before-failure",
    "action-complete",
  ]);
});
```

- [ ] **Step 2: Evidence presentation test 실패 확인**

Run: `npm test -- src/renderer/src/components/evidence-presentation.test.ts`

Expected: FAIL because `evidence-presentation.ts` is absent.

- [ ] **Step 3: 판정 presentation 구현**

```ts
export function createEvidencePresentation(evidence: StepEvidence) {
  const order = { failure: 0, "before-failure": 1, "action-complete": 2 } as const;
  const filmstrip = [...evidence.captures].sort((a, b) => order[a.kind] - order[b.kind]);
  const verdictLabels: Record<StepEvidence["status"], string> = {
    queued: "대기",
    running: "실행 중",
    passed: "성공",
    failed: "실패",
    inconclusive: "판정 불가",
    cancelled: "중단됨",
    skipped: "건너뜀",
  };
  const createSafeErrorRows = (error: NonNullable<StepEvidence["error"]>) => [
    ["분류", error.category],
    ["원인", error.message],
    ...(error.selector ? [["대상", error.selector]] : []),
    ...(error.timeoutMs ? [["제한 시간", `${error.timeoutMs}ms`]] : []),
  ];
  return {
    primaryCapture: filmstrip[0],
    filmstrip,
    verdictLabel: verdictLabels[evidence.status],
    errorRows: evidence.error ? createSafeErrorRows(evidence.error) : [],
  };
}
```

- [ ] **Step 4: EvidenceLibrary 구현**

실행별 상태, 시나리오 수, capture 수, 총 용량, retry 연결을 표시한다. 삭제 button은 execution 단위만 제공하고 자동 정리 toggle은 만들지 않는다.

- [ ] **Step 5: 3영역 EvidenceDetail 구현**

```tsx
<div className="evidence-detail-layout">
  <StepTimeline steps={caseResult.steps} activeStep={evidence.stepOrder} />
  <CaptureViewer presentation={presentation} />
  <VerdictInspector evidence={evidence} errorRows={presentation.errorRows} />
</div>
```

`StepTimeline`, `CaptureViewer`, `VerdictInspector`는 `EvidenceDetail.tsx` 안에서 각각 `caseResult.steps`, `EvidencePresentation`, safe error row만 props로 받는 local component로 정의하고 외부 store를 직접 읽지 않는다.

오른쪽 inspector에는 기대 결과, 실제 결과, URL, selector, timeout, 판정 원인을 표시하고 credential·개인정보·raw tool output은 렌더링하지 않는다.

- [ ] **Step 6: `다시 실행`과 `시나리오에서 보기`만 제공하는지 검증**

Run: `rg -n "이 ID로 질문|질문" src/renderer/src/components/TestCenter.tsx src/renderer/src/components/EvidenceLibrary.tsx src/renderer/src/components/EvidenceDetail.tsx`

Expected: no matches.

- [ ] **Step 7: Evidence test/typecheck/build 실행**

Run: `npm test -- src/renderer/src/components/evidence-presentation.test.ts && npm run typecheck && npm run build:web`

Expected: PASS.

- [ ] **Step 8: 증적 화면 커밋**

```bash
git add src/renderer/src/components/EvidenceLibrary.tsx src/renderer/src/components/EvidenceDetail.tsx src/renderer/src/components/evidence-presentation.ts src/renderer/src/components/evidence-presentation.test.ts src/renderer/src/App.tsx src/renderer/src/styles/test-center.css src/renderer/src/styles/responsive.css
git commit -m "feat: add evidence library and failure detail"
```

### Task 7: 자유로운 화면 전환과 preview 검수 계약

**Files:**
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/components/ProjectNavigation.tsx`
- Modify: `src/renderer/src/components/ScenarioResults.tsx`
- Modify: `src/renderer/src/demo/preview-fixtures.ts`
- Modify: `src/renderer/src/demo/preview-fixtures.test.ts`
- Modify: `src/renderer/src/styles/responsive.css`

**Interfaces:**
- Consumes: all project routes and fixture stores
- Produces: route-independent background execution state and deterministic preview URLs

- [ ] **Step 1: 시나리오 왕복·실행 유지 selector test 추가**

```ts
it("keeps the execution while returning to scenarios", () => {
  const fixture = createPreviewState("test-running");
  const scenarioRoute = routeForScenario(fixture, "SCN-PAY-001");
  expect(scenarioRoute.name).toBe("scenarios");
  expect(fixture.tests.activeExecutionId).toBe("EXE-20260825-0007");
});
```

- [ ] **Step 2: `hashchange` 구독과 route 복원 구현**

```ts
useEffect(() => {
  const syncRoute = () => setRoute(parseProjectRoute(window.location.hash));
  window.addEventListener("hashchange", syncRoute);
  return () => window.removeEventListener("hashchange", syncRoute);
}, []);
```

- [ ] **Step 3: `시나리오에서 보기` 강조 상태 구현**

Scenario route의 `scenarioId`를 `ScenarioSheet`까지 전달해 해당 case를 펼치고 `scrollIntoView({ block: "center" })`한다. 질문은 자동 제출하지 않는다.

```ts
useEffect(() => {
  if (!focusedScenarioId) return;
  setExpandedIds((current) => new Set([...current, focusedScenarioId]));
  document.getElementById(`scenario-${focusedScenarioId}`)?.scrollIntoView({ block: "center" });
}, [focusedScenarioId]);
```

- [ ] **Step 4: 결정적 preview URL 고정**

```text
?preview=runtime-preparing
?preview=analysis-fact
?preview=recovery
?preview=test-running
?preview=test-failed
?preview=evidence-library
?preview=evidence-failure
```

- [ ] **Step 5: Store/fixture 회귀 test와 production web build 실행**

Run: `npm test && npm run typecheck && npm run build:web`

Expected: all tests and build PASS.

- [ ] **Step 6: 화면 전환 커밋**

```bash
git add src/renderer/src/App.tsx src/renderer/src/components/ProjectNavigation.tsx src/renderer/src/components/ScenarioResults.tsx src/renderer/src/demo/preview-fixtures.ts src/renderer/src/demo/preview-fixtures.test.ts src/renderer/src/styles/responsive.css
git commit -m "feat: preserve execution across project routes"
```

### Task 8: 실제 화면 캡처와 README 갱신

**Files:**
- Create: `artifacts/screen-test-running.png`
- Create: `artifacts/screen-test-failure-evidence.png`
- Create: `artifacts/screen-runtime-recovery.png`
- Modify: `README.md`
- Create: `docs/screens/05-test-center.md`
- Create: `docs/screens/06-evidence-detail.md`

**Interfaces:**
- Consumes: preview URLs from Task 7
- Produces: 구현된 화면의 실제 PNG와 README 검수 설명

- [ ] **Step 1: 전체 정적 검증 실행**

Run: `npm test && npm run typecheck && npm run build:web`

Expected: PASS.

- [ ] **Step 2: Web preview 서버 실행**

Run: `npm run dev:web`

Expected: Vite reports a local URL such as `http://127.0.0.1:5173`.

- [ ] **Step 3: 1440×1024 테스트 수행 화면 캡처**

Open: `http://127.0.0.1:5173/?preview=test-running`

Verify: execution history, sequential queue, active case, evidence preview, project navigation are visible and no Q&A input exists.

Save screenshot: `artifacts/screen-test-running.png`.

- [ ] **Step 4: 1440×1024 실패 증적 화면 캡처**

Open: `http://127.0.0.1:5173/?preview=evidence-failure`

Verify: failed step, failure/before-failure/action-complete filmstrip, error category, selector, timeout, retry and scenario navigation are visible.

Save screenshot: `artifacts/screen-test-failure-evidence.png`.

- [ ] **Step 5: 1440×1024 복구 화면 캡처**

Open: `http://127.0.0.1:5173/?preview=recovery`

Verify: recovering is shown before running and no false completion message appears.

Save screenshot: `artifacts/screen-runtime-recovery.png`.

- [ ] **Step 6: README 현재 상태·구성·preview·화면 설명 갱신**

```md
### 7. 순차 테스트 수행 센터

실행 이력, 현재 순차 대기열, 선택 케이스 증적을 한 화면에서 확인합니다.

![순차 테스트 수행 화면](artifacts/screen-test-running.png)

### 8. 실패 증적 상세

실패 시점·실패 직전·동작 완료 화면과 구조화 오류 정보를 함께 확인합니다.

![실패 증적 상세](artifacts/screen-test-failure-evidence.png)
```

- [ ] **Step 7: 문서 링크와 이미지 존재 검증**

Run: `test -f artifacts/screen-test-running.png && test -f artifacts/screen-test-failure-evidence.png && test -f artifacts/screen-runtime-recovery.png && rg -n "screen-test-running|screen-test-failure-evidence|screen-runtime-recovery" README.md`

Expected: all three files exist and README contains all three references.

- [ ] **Step 8: 화면·문서 커밋**

```bash
git add artifacts/screen-test-running.png artifacts/screen-test-failure-evidence.png artifacts/screen-runtime-recovery.png README.md docs/screens/05-test-center.md docs/screens/06-evidence-detail.md
git commit -m "docs: add test execution screen evidence"
```

### Task 9: UI 완료 게이트

**Files:**
- Verify: all files changed in Tasks 1–8

**Interfaces:**
- Consumes: UI implementation and screenshots
- Produces: harness-independent UI completion evidence

- [ ] **Step 1: 전체 검증을 깨끗한 process에서 재실행**

Run: `npm test && npm run typecheck && npm run build && npm run build:web`

Expected: every command exits 0.

- [ ] **Step 2: 금지 문구·민감정보 정적 검사**

Run: `rg -n "이 ID로 질문|\"password\": \"test-only-password\"|\"cardToken\": \"test_card_token\"" src README.md docs/screens || true`

Expected: Q&A prohibition paths and captured/docs contain no secret fixture value. The JSON input example may use field names but must not expose a usable value.

- [ ] **Step 3: 화면 상태 matrix 수동 검수**

Verify these preview modes: project selection, model modal, runtime preparing, analysis FACT, recovering, scenario result, test running, test failed, evidence library, evidence failure.

Expected: each mode renders one unambiguous primary view; activity changes do not change the route; only the scenario page contains Q&A.

- [ ] **Step 4: 최종 상태 기록**

Run: `git status --short --branch && git log --oneline -10`

Expected: only intentionally untracked brainstorming assets remain and all UI tasks have dedicated commits.
