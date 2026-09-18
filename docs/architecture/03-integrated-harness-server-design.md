# ScenarioForge 통합 하네스 서버 설계

- 작성일: 2026-08-26
- 상태: 설계 확정, 구현 전
- 적용 범위: 시나리오 생성(테스트 준비) + 시나리오 수행(테스트 실행)
- 상세 생성 하네스: [`../pi-coding-agent 하네스 설계.md`](../pi-coding-agent%20하네스%20설계.md)
- 상세 수행 하네스: [`04-test-execution-harness-design.md`](04-test-execution-harness-design.md)
- 다중 대상 수행 계층: [`05-multi-target-execution-adapter-design.md`](05-multi-target-execution-adapter-design.md)
- 상위 런타임 설계: [`../superpowers/specs/2026-08-25-scenarioforge-pi-runtime-test-execution-design.md`](../superpowers/specs/2026-08-25-scenarioforge-pi-runtime-test-execution-design.md)

## 1. 결론

현재 화면의 상위 정보 구조인 `작업대 / 시나리오 / 테스트 수행 / 증적 보관함`은 생성과 수행을 분리하면서도 하나의 프로젝트 흐름으로 연결하므로 유지한다.

백엔드는 다음 원칙으로 맞춘다.

1. **생성 결과를 실행 입력으로 직접 사용하지 않는다.** 생성된 시나리오에서 불변 `ScenarioSnapshot`을 만들고, 이를 구조화 `RunnerPlan`으로 컴파일한 뒤 실행한다.
2. **통합 하네스 서버는 논리적 애플리케이션 서비스다.** Electron Main의 Application Orchestrator가 생성·질의·계획·실행 command를 하나의 계약으로 제공하되, Pi와 TestVista는 계속 별도 UtilityProcess로 격리한다.
3. **통합 서버가 새 상태 원본이 되지 않는다.** 실행 상태는 journal과 `project-state.json`, 분석 산출물은 run별 불변 파일, 관계 조회는 재구축 가능한 `scenario-index.sqlite`, 테스트 결과는 execution manifest가 각각 원본이다.
4. **LLM은 저작·의미 검토에만 쓴다.** scan, link의 확정 가능한 부분, path walk, coverage, schema·관계·경로 검증, 실행 queue와 증적 무결성은 backend가 결정론적으로 수행한다.
5. **사람용 시나리오와 기계 실행 계약을 분리한다.** `action`·`expected`는 UI 문장이고, Runner는 `actionRef`·`assertionRefs`·semantic/visual target 후보·data binding을 사용한다.
6. **생성 완료는 수행 트리거가 아니다.** 수행 준비는 사용자의 `test.createExecution`, `test.enqueueScenarios`, `test.retryCases`에서만 시작하고 실제 target action은 agent가 아니라 TestVista adapter가 수행한다.

## 2. 제품 정보 구조

```text
Project
├── 작업대
│   ├── 프로젝트·모델 역할 설정
│   ├── Runtime·복구 상태
│   └── AnalysisRun 생성 이력
├── 시나리오                         # 테스트 준비
│   ├── Workflow
│   ├── ScenarioSet / Scenario
│   ├── 근거(Source · Fact · Wiki)
│   ├── 커버리지·미확인 항목
│   └── ID 기반 질의
├── 테스트 수행                     # 테스트 실행
│   ├── ExecutionTargetProfile
│   ├── DataBindingSet
│   ├── ScenarioSnapshot
│   ├── RunnerPlan
│   ├── ExecutionBatch
│   └── Execution / Case / Step queue
└── 증적 보관함
    ├── StepVerdict
    ├── Capture / Trace / Masked log
    └── 재실행 관계
```

화면 단계와 backend 단계는 1:1이 아니다. `FACT`나 `WIKI`는 사용자가 상시 이동하는 상위 화면이 아니라 시나리오의 근거 상세와 분석 진행에서 노출한다. 반대로 테스트 수행은 분석 stage가 아니라 검증된 시나리오를 소비하는 별도 lifecycle이다.

## 3. 핵심 엔터티와 관계

| 엔터티 | 역할 | 원본 |
| --- | --- | --- |
| `Project` | 선택한 소스와 정책의 최상위 범위 | `.scenarioforge/project.json` |
| `AnalysisRun` | 한 번의 `SRC → FACT → WIKI → SCENARIO` 생성 회차 | run manifest + runtime journal |
| `SourceSnapshot` | 분석 시점의 파일 hash·언어·경로 집합 | `runs/{runId}/source/` |
| `FactGraph` | 화면·상태·요소·API·술어·전이와 evidence 관계 | `runs/{runId}/facts/` |
| `Workflow` | FACT를 업무 목표·종착·변주 축으로 묶은 WIKI 레코드 | `runs/{runId}/wiki/` |
| `ScenarioSet` | 사람이 읽고 선택하는 검증된 시나리오 집합 | `runs/{runId}/scenario-set.json` |
| `ScenarioSnapshot` | 실행 batch 생성 시 선택 시나리오와 참조 hash를 고정한 입력 | `tests/{executionId}/batches/{batchId}/scenario-snapshot.json` |
| `RunnerPlan` | target·adapter·입력 binding·assertion을 포함한 실행 가능 계획 | `tests/{executionId}/batches/{batchId}/runner-plan.json` |
| `ExecutionBatch` | 최초 실행·대기열 추가마다 immutable snapshot/plan을 묶는 append 단위 | `tests/{executionId}/batches/{batchId}/` |
| `TestExecution` | 순차 case·step 상태와 재실행 관계 | execution manifest/result |
| `Evidence` | 판정과 화면·오류·trace의 hash 연결 | execution 하위 evidence 파일 |

주요 연결은 다음과 같다.

```text
SourceSnapshot
  → FactGraph
  → Workflow
  → Scenario
  → ExecutionBatch
      ├── ScenarioSnapshot
      └── RunnerPlan
  → TestExecution
  → StepEvidence
```

모든 downstream 객체는 upstream ID뿐 아니라 `schemaVersion`, `analysisRunId`, `sourceSnapshotId`, 참조 artifact hash를 보관한다. 소스나 시나리오가 바뀌어도 과거 execution의 의미가 바뀌지 않는다.

## 4. 상태와 저장 원본

기존 설계와 생성 하네스의 가장 큰 충돌은 SQLite의 역할이었다. 다음처럼 책임을 분리한다.

| 관심사 | canonical source | SQLite 역할 |
| --- | --- | --- |
| 프로젝트·작업·stage 진행 | hash-chain journal + `project-state.json` | 사용하지 않음 |
| 검증 완료 분석 산출물 | run별 immutable JSON/YAML/Markdown + manifest hash | ID·관계·검색 projection |
| 미완료 작업·재개 | journal의 work item, checkpoint, staging | 조회 최적화만 가능 |
| 테스트 실행·판정 | execution manifest/result + evidence hash | 선택적 조회 projection |

따라서 상세 하네스의 `graph` 명령은 데이터베이스를 직접 쓰는 공개 도구가 아니라 `ArtifactQueryService`, staging validator, index projector에 대한 내부 adapter다. `graph todo`의 진짜 원본은 `WorkStateService`와 `AnalysisCoordinator`다. 인덱스는 canonical revision 이하이며 artifact hash가 일치하는 row만 노출하고, 전체 run 산출물에서 재구축할 수 있어야 한다.

## 5. 시나리오 생성 하네스

### 5.1 외부 stage와 내부 작업

```text
SRC
  scan + source snapshot + closure inventory               # 무LLM
  → source completion gate
FACT
  stack별 추출 → 자동 link → 모호 link 판정 → semantic gate
  → fact completion gate
WIKI
  workflow 저작 → cites·terminal·variation 검증 → semantic gate
  → wiki completion gate
SCENARIO
  bounded walk + combination → UX 서술 → scenario semantic gate
  → coverage + scenario completion gate
READY
```

`scan`이 결정론적으로 처리할 수 없는 동적 route나 runtime 등록은 `unresolved`로 남기거나, 배정 범위가 제한된 보조 source-mapping work로 넘긴다. `source-map` stage 전체를 LLM 탐색에 맡기지 않는다.

### 5.2 모델 역할

하네스는 모델 이름이 아니라 역할에 의존한다.

| 역할 | 기본 binding | 책임 |
| --- | --- | --- |
| `author` | Qwen3.6-35B-A3B | FACT 의미 추출, 모호 link 판정, WIKI·시나리오 서술 |
| `reviewer` | GLM-5.2 | evidence가 주장을 지지하는지 독립 semantic verdict |
| `guiGrounder` | 사용자 선택·benchmark 통과 모델 | visual/CUA step의 화면 target 후보와 confidence 생성 |

사용자는 역할 간 provider credential을 재사용할 수 있지만 model ID와 데이터 경계는 독립 설정한다. reviewer가 없으면 author 자체 검토로 계속할 수 있으나 결과의 assurance를 `single-model`로 표시하고, 독립 검증을 통과한 것으로 표현하지 않는다. `guiGrounder`는 semantic-only 실행에는 필요하지 않고, visual binding이 있을 때에만 필수다. 화면 후보를 반환할 뿐 최종 테스트 verdict나 plan 변경 권한은 없다. 최종 stage·batch 완료 권한은 어떤 모델에도 없고 backend completion gate에만 있다.

### 5.3 evidence 계약

라인 번호만으로는 소스 변경 뒤 근거가 다른 코드를 가리킬 수 있다. 모든 근거는 다음을 포함한다.

```ts
type EvidenceRef = {
  sourceId: string;
  sourceSnapshotId: string;
  path: string;
  startLine: number;
  endLine: number;
  contentHash: string;
  evidenceGrantId: string;
};
```

`evidenceGrantId`는 해당 work가 `closure` 또는 `verify`로 실제 제공받은 slice를 backend가 journal에 기록한 ID다. 재시작 뒤에도 V2 검증을 재현할 수 있다. 소스 파일은 instruction이 아니라 untrusted data로 취급하고, 코드 주석·문자열이 tool policy나 system instruction을 변경할 수 없다.

### 5.4 FACT 그래프 보정

- 정상·실패·잔류 전이는 모두 독립 `edge_id`를 갖는다. `alt`를 부모 edge 안에 중첩하지 않는다. 그래야 `path`, all-transitions coverage, 실패 시나리오가 같은 ID를 참조한다.
- 화면 ID는 route만으로 만들지 않는다. router namespace + canonical route pattern을 semantic key로 쓰고 충돌 시 backend가 짧은 hash suffix를 붙인다.
- 사용자 동작 요소에는 표시 정보와 실행 힌트를 분리한다.

```ts
type InteractionTarget = {
  elementId: string;
  actionKind:
    | "launch"
    | "activate"
    | "click"
    | "fill"
    | "select"
    | "upload"
    | "navigate"
    | "scroll"
    | "drag"
    | "key-chord"
    | "back"
    | "home"
    | "switch-context";
  targetCandidates: Array<
    | { by: "test-id"; value: string }
    | { by: "role-name"; role: string; name: string }
    | { by: "label"; value: string }
    | { by: "css"; value: string }
    | { by: "automation-id"; value: string }
    | { by: "android-resource-id"; value: string }
    | { by: "ios-predicate"; value: string }
    | { by: "visual-description"; value: string }
  >;
  inputBindingKey?: string;
};

type ObservableAssertion = {
  assertionId: string;
  kind:
    | "visible-text"
    | "route"
    | "element-state"
    | "window-state"
    | "app-context"
    | "network"
    | "data-shape"
    | "visual-region";
  subjectRef: string;
  expectedShape: string;
};
```

target candidate는 코드에서 확인된 후보일 뿐 생성 시점에 “작동 보장”으로 승격하지 않는다. Runner planning에서 대상 환경의 DOM·accessibility/UIA tree·Appium page source 또는 허용된 visual probe와 대조해 확정한다. 좌표는 canonical candidate로 저장하지 않는다.

### 5.5 시나리오 계약

표시 ID는 현재 UI·공유 타입과 맞춰 `SCN-{업무코드}-{3자리 순번}`을 사용한다. workflow ID는 내부 관계 키로 유지한다.

```ts
type Scenario = {
  schemaVersion: 2;
  scenarioId: string;
  workflowId: string;
  kind: "normal" | "exception";
  variation: Record<string, string>;
  preconditions: Array<{ text: string; predicateRefs: string[]; dataBindingKeys: string[] }>;
  path: string[];
  steps: Array<{
    order: number;
    action: string;
    expected: string;
    actionRef: { edgeId: string; elementId: string };
    assertionRefs: string[];
  }>;
};
```

기존 Renderer의 `ScenarioResult`는 이 canonical v2에서 필요한 표시 필드만 읽는 projection으로 유지한다. UI 문장만 저장한 v1 fixture를 Runner 입력으로 사용하지 않는다.

## 6. 시나리오 수행 하네스

수행 하네스의 사용자 트리거, batch 불변성, 전용 skill·agent, Preflight/Probe, 계획·실행 상태 머신은 [`04-test-execution-harness-design.md`](04-test-execution-harness-design.md)를 따른다. 대상별 기술 선택, adapter routing, segment, CUA 안전 경계는 [`05-multi-target-execution-adapter-design.md`](05-multi-target-execution-adapter-design.md)를 따른다. 이 절은 생성과 수행 사이의 통합 handoff만 요약한다.

### 6.1 실행 준비

```text
explicit test command
  → executionId/batchId 할당
  → batch별 ScenarioSnapshot 생성 + hash 고정
  → ExecutionTargetProfile 검증 + environment preflight
  → DataBindingSet schema·민감 필드 정책 검증
  → 결정론적 plan compiler
  → capability routing + ExecutionSegment 생성
  → 해결되지 않은 target reference/assertion만 수행 전용 test.plan work에 전달
  → RunnerPlan validator
  → immutable ExecutionBatch commit
  → execution queue 생성 또는 append
```

`test.plan`은 시나리오 의미를 바꾸거나 새 기대 결과를 만들 수 없다. 허용되는 일은 `actionRef`를 허용된 semantic action으로 바인딩하고, 제공된 target 후보의 우선순위를 정하고, data binding key를 실제 입력과 연결하는 것이다. 계획이 시나리오 hash 또는 assertion reference를 바꾸거나 근거 없는 selector·automation ID·좌표를 만들면 거절한다.

생성 완료만으로 이 흐름을 시작하지 않는다. `test.plan`은 수행 전용 session과 resource만 사용하고 source/fact/wiki/scenario, Runner queue, evidence에 쓰지 못한다. 실제 테스트는 하위 agent가 아니라 검증된 계획을 소비하는 TestVista가 수행한다.

### 6.2 RunnerPlan 최소 계약

```ts
type RunnerPlan = {
  schemaVersion: 2;
  executionId: string;
  batchId: string;
  scenarioSnapshotHash: string;
  targetProfileHash: string;
  segments: ExecutionSegment[];
  cases: Array<{
    scenarioId: string;
    steps: Array<{
      order: number;
      actionRef: string;
      intent: ActionIntent;
      primary: AdapterBinding;
      fallbacks: AdapterFallback[];
      assertions: Array<{
        assertionId: string;
        kind: string;
        matcher: Record<string, unknown>;
      }>;
      timeoutMs: number;
    }>;
  }>;
};
```

Runner는 이 계획을 순차 실행하고 adapter observation을 AssertionEngine에 전달한다. 자유 텍스트 LLM 응답으로 verdict를 확정하지 않는다. 시나리오가 요구하는 assertion을 자동화할 수 없으면 `INCONCLUSIVE` 또는 계획 검증 실패로 남기며, 임의의 대체 assertion으로 통과시키지 않는다.

### 6.3 실행과 증적

- 프로젝트별 동시 active execution은 하나다.
- 케이스와 스텝은 snapshot 순서를 보존한다.
- 실패 케이스의 남은 step은 `SKIPPED`, 다음 case는 계속 실행한다.
- 성공 step은 `action-complete` 1장, 실패 step은 `action-complete`, `before-failure`, `failure`와 오류 컨텍스트를 요구한다.
- browser/device/desktop session/network/capture 환경 문제는 `INCONCLUSIVE`로 분리한다.
- 개인정보 masking 실패, evidence write 실패, Runner process 사망은 fail-closed로 전체 execution을 중단한다.
- 재실행은 새 `executionId`와 새 snapshot/plan을 만들고 `retryOfExecutionId`로 연결한다.
- 실행 중 추가는 기존 snapshot/plan을 수정하지 않고 같은 target hash의 새 `ExecutionBatch`를 검증한 뒤 queue 뒤에 붙인다.

## 7. 통합 하네스 서버 경계

통합 하네스 서버는 별도 네트워크 서버나 세 번째 실행 엔진이 아니다. Electron Main의 Application Orchestrator가 다음 façade를 제공하는 논리적 서비스 경계다.

```ts
interface HarnessApplicationService {
  bootstrapProject(command: BootstrapProject): Promise<CommandAccepted>;
  startAnalysis(command: StartAnalysis): Promise<CommandAccepted>;
  resumeAnalysis(command: ResumeAnalysis): Promise<CommandAccepted>;
  askScenario(command: AskScenario): Promise<ScenarioAnswer>;
  createExecution(command: CreateExecution): Promise<ExecutionAccepted>;
  enqueueScenarios(command: EnqueueScenarios): Promise<CommandAccepted>;
  cancelExecution(command: CancelExecution): Promise<CommandAccepted>;
  retryCases(command: RetryCases): Promise<ExecutionAccepted>;
  getSnapshot(query: GetProjectSnapshot): Promise<ProjectRuntimeState>;
  getEventsSince(query: GetEventsSince): Promise<DomainEvent[]>;
}
```

서비스 내부 흐름은 다음과 같다.

```text
typed IPC / future headless adapter
  → command schema + relationship + expectedRevision 검증
  → AnalysisCoordinator | TestCoordinator
  → PiRuntimeHost | TestVista Execution Kernel
  → RuntimeStateCoordinator single writer
  → durable commit
  → domain event publish
```

향후 headless 사용이 필요하면 같은 façade 앞에 로컬 RPC adapter를 추가한다. RPC가 journal, artifact, Runner를 직접 쓰는 별도 상태 원본을 만들지 않는다.

## 8. 현재 디렉터리와 목표 디렉터리 정합성

현재 저장소는 UI PoC를 위해 `src/{main,preload,renderer,shared}`가 평면으로 구성돼 있고, 목표 설계는 npm workspace의 `apps/desktop` + `packages/*`다. 이는 정면 충돌이 아니라 **미완료 마이그레이션**이다. 다만 이 상태에서 backend를 `src/main` 아래에 계속 추가하면 이후 이동 비용이 커진다.

적용 규칙은 다음과 같다.

1. 현재 Renderer 수정과 얇은 IPC adapter는 기존 `src/`에서 유지한다.
2. 신규 canonical state, 분석, Pi, Runner, evidence 구현은 목표 `packages/*`에 작성한다.
3. `packages/agent-runtime`은 초기 placeholder이므로 실제 구현 위치로 확장하지 않는다. Phase 1에서 `packages/pi-runtime`과 `packages/scenario-pipeline`로 책임을 이동하고 안내 문서만 남긴다.
4. 별도 `harness-server` 패키지는 만들지 않는다. composition root는 `apps/desktop/src/main/app`이고, 재사용 계약은 `packages/contracts`에 둔다.
5. 생성·수행 planning resource는 앱 저장소의 `packages/project-runtime/runtime-template/{harnesses,skills,agents}/`에서 domain별로 분리해 버전 관리하고 선택 프로젝트의 `.scenarioforge/runtime/`에는 검증된 복사본만 설치한다.

목표 backend 책임은 기존 상위 설계를 유지한다.

| 패키지 | 책임 |
| --- | --- |
| `packages/contracts` | command, event, state, artifact, scenario snapshot, runner plan schema |
| `packages/runtime-state` | single-writer, journal, checkpoint, recovery, projection |
| `packages/project-runtime` | bootstrap, path policy, runtime resource 설치 |
| `packages/pi-runtime` | Pi host, role별 model binding, tool policy, event adapter |
| `packages/scenario-pipeline` | scan/closure/link/walk/coverage, validator, completion gate |
| `packages/test-runtime` | plan compiler, queue, Runner contract, verdict |
| `packages/evidence-store` | capture, masking, integrity, retention |

## 9. 선택 프로젝트 저장 구조

```text
.scenarioforge/
├── manifest.json
├── runtime/                         # versioned resource copy
├── sessions/{analysis,chat,test-planning}/
├── staging/{workId}/
├── state/
│   ├── project-state.json
│   ├── WORK_STATE.md
│   ├── scenario-index.sqlite        # projection, canonical 아님
│   ├── journal/
│   ├── checkpoints/
│   └── evidence-grants/             # work가 실제 읽은 slice 기록
└── runs/{analysisRunId}/
    ├── manifest.json
    ├── source/
    ├── facts/
    ├── wiki/
    ├── scenario-set.json
    ├── coverage.json
    └── tests/{executionId}/
        ├── manifest.json
        ├── batches/{batchId}/
        │   ├── scenario-snapshot.json
        │   ├── execution-target-profile.json
        │   ├── data-binding-manifest.json
        │   ├── target-probe.json
        │   ├── runner-plan.json
        │   └── batch-manifest.json
        ├── execution-result.json
        ├── cases/
        ├── execution.log
        └── trace.zip
```

## 10. 구현 순서와 완료 기준

### Phase A — 계약과 저장 원본

- workspace 이동, schema version, ID 규칙, evidence ref, journal/index 책임 구현
- 기존 UI fixture를 canonical scenario projection으로 변환

### Phase B — 생성 하네스

- source snapshot, scan, closure grant, FACT graph, link, semantic reviewer, workflow, walk, scenario gate, coverage
- 실제 소형 React + API fixture에서 중단·재개와 증분 무효화 검증

### Phase C — 실행 준비와 adapter routing

- 사용자 trigger façade, ExecutionBatch, ScenarioSnapshot, ExecutionTargetProfile, DataBindingSet, environment preflight, capability router, segment compiler, 수행 전용 `test.plan` author/reviewer, RunnerPlan validator

### Phase D — 실행과 증적

- adapter-neutral TestVista kernel, Playwright와 Windows UIA 기준선, 제한된 vision/CUA pilot, AssertionEngine, verdict taxonomy, evidence masking·hash, retry relation

### Phase E — 통합 E2E

- 생성한 시나리오를 같은 run에서 실행
- 앱·Pi·Runner 강제 종료 후 복구
- source 변경 후 과거 execution 불변성 확인
- single-model/degraded assurance와 dual-model independent assurance 표시

다음 조건을 모두 만족해야 통합 하네스 서버가 준비된 것으로 본다.

1. Renderer가 Pi raw event나 Runner raw log를 상태 원본으로 사용하지 않는다.
2. `SRC → FACT → WIKI → SCENARIO`의 모든 완료가 backend gate와 durable revision을 거친다.
3. 모든 scenario step이 `actionRef`와 하나 이상의 `assertionRef`를 갖거나 명시적으로 non-automatable이다.
4. execution은 hash가 고정된 ScenarioSnapshot과 검증된 RunnerPlan 없이는 시작되지 않는다.
5. enqueue는 기존 snapshot/plan을 수정하지 않고 새 immutable batch를 append한다.
6. SQLite 삭제 후 run artifact와 journal에서 조회 인덱스를 재구축할 수 있다.
7. source 파일이 바뀌어도 완료된 execution과 evidence 의미가 변하지 않는다.
8. credential·테스트 개인정보·source·target 내 prompt injection이 권한 경계를 넘지 못한다.
