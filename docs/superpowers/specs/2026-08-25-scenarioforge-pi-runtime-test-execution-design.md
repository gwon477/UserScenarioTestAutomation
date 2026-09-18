# ScenarioForge Pi Runtime 및 테스트 수행 통합 설계

- 작성일: 2026-08-25
- 상태: 설계 승인, 생성·수행 통합 하네스 상세 설계 반영
- 대상 브랜치: `dev`
- 대상 제품: ScenarioForge 설치형 데스크톱 솔루션

## 1. 문서 목적

ScenarioForge가 프로젝트 소스와 사용자가 설정한 LLM을 연결한 뒤, 해당 LLM을 Pi Agent Runtime 위에서 실행하여 `SRC → FACT → WIKI → SCENARIO` 정보 셋을 생성하고 시나리오 질의, 순차 테스트 수행, 증적 관리까지 이어가는 전체 구조를 정의한다.

이 문서는 다음 두 구조를 함께 확정한다.

1. ScenarioForge 애플리케이션 소스의 목표 디렉터리와 패키지 경계
2. 사용자가 선택한 프로젝트에 생성되는 `.scenarioforge/` 런타임·세션·산출물 구조

역할별 하네스 계약과 참조 규칙은 상세 설계 문서로 확정하되, 실제 Resource Bundle 파일과 모델별 few-shot은 기반 구조가 완성된 뒤 마지막 구현 단계에서 작성한다.

생성 하네스의 상세 레코드·도구·분기 정책은 `docs/pi-coding-agent 하네스 설계.md`, 생성과 수행 사이의 snapshot/plan handoff 및 논리적 서버 경계는 `docs/architecture/03-integrated-harness-server-design.md`, 사용자 수행 트리거·immutable batch·수행 전용 skill/agent·Runner 경계는 `docs/architecture/04-test-execution-harness-design.md`, 대상별 기술 선택·adapter routing·CUA 안전 경계는 `docs/architecture/05-multi-target-execution-adapter-design.md`를 따른다. 이 문서와 상세 문서가 충돌하면 상태·권한·저장 원본은 본 문서, 생성 레코드와 분기 정책은 생성 하네스 문서, 생성→수행 handoff는 통합 하네스 문서, 수행 lifecycle은 04 문서, 수행 대상·adapter 계약은 05 문서가 각각 우선한다.

## 2. 제품 목표

사용자는 다음 흐름을 끊김 없이 수행할 수 있어야 한다.

1. 로컬 프로젝트 디렉터리를 선택한다.
2. LLM provider, endpoint, model, credential을 설정한다.
3. ScenarioForge가 프로젝트 전용 Pi 작업환경과 세션을 준비한다.
4. Pi 세션이 프로젝트 구조에 맞춰 도구·스킬·서브에이전트를 동적으로 사용한다.
5. 검증된 `SRC`, `FACT`, `WIKI`, `SCENARIO` 산출물을 프로젝트 내부에 저장한다.
6. 시나리오 도출 화면에서 ID를 기준으로 질의한다.
7. 하나 이상의 시나리오를 선택해 순차 테스트를 실행한다.
8. 각 스텝의 화면과 성공·실패·판정 불가 원인을 증적으로 확인한다.
9. 테스트가 실행 중이어도 시나리오, 테스트 센터, 증적 화면을 자유롭게 오간다.
10. 앱 종료 또는 프로세스 장애 후 프로젝트 상태와 세션을 복구한다.

## 3. 범위

### 3.1 포함

- Electron 앱에 번들된 Pi Runtime과 프로젝트별 Resource Bundle 연결
- 프로젝트 초기화, runtime manifest, 버전 검사 및 마이그레이션 경계
- Pi 세션 생성·복구·분리와 도메인 이벤트 변환
- Pi 원시 이벤트와 화면 상태를 분리하는 영속 도메인 상태 계층
- 모든 LLM 작업이 공통으로 읽는 작업 규격과 상태 문서
- 고정된 분석 단계와 동적인 Pi 작업의 결합
- ID 기반 산출물 인덱스
- 순차 테스트 대기열과 플랫폼 중립 TestVista Execution Kernel 경계
- 스텝별 화면 캡처와 실패 추가 증적
- 테스트 센터, 증적 상세, 자유로운 화면 전환
- 선택 프로젝트 내부의 로컬 저장 구조
- 경로 제한, credential 분리, 개인정보 마스킹, 증적 무결성

### 3.2 제외

- LangGraph 도입
- 분산 Runner와 원격 실행 노드
- 클라우드 동기화
- 다중 사용자의 동시 프로젝트 편집
- 운영체제별 installer, code signing, 자동 업데이트의 상세 구현
- 실제 Resource Bundle 파일과 모델별 few-shot 콘텐츠 구현

## 4. 확정된 제품 결정

| 영역 | 결정 |
| --- | --- |
| 에이전트 구조 | Pi-first 하이브리드 구조 |
| Pi 배치 | 앱에 검증된 버전을 번들하고 프로젝트에는 리소스·세션·산출물만 저장 |
| 분석 제어 | 외부 도메인 단계는 고정, 단계 내부 작업은 Pi가 동적으로 결정 |
| 애플리케이션 상태 | Pi 메시지가 아니라 영속 도메인 상태와 revision이 원본 |
| Pi 이벤트 | `PiEventAdapter`를 통과한 상태 명령 후보로만 사용하고 Renderer에 직접 전달하지 않음 |
| 공통 작업 규격 | 모든 LLM 작업은 `WORK_PROTOCOL.md`와 최신 `WORK_STATE.md`를 읽고 시작 |
| 상태 변경 권한 | LLM은 상태 문서를 직접 편집하지 않고 통제된 상태 갱신 계약을 호출 |
| 완료 판정 | Pi session `settled`와 업무 단계 `completed`를 분리 |
| 이벤트 발행 | 상태·checkpoint·revision 저장이 끝난 뒤 도메인 이벤트 발행 |
| 세션 | 사용자에게는 하나의 프로젝트, 내부적으로 분석·질의·테스트 계획 세션 분리 |
| 질의응답 위치 | 시나리오 도출 페이지에서만 제공 |
| 수행 시작 | 생성 완료와 분리하고 create/enqueue/retry 사용자 명령에서만 시작 |
| 수행 계획 | deterministic compiler 우선, 미해결 binding만 수행 전용 Pi planner/reviewer 사용 |
| 테스트 실행 | 프로젝트별 하나의 Runner가 시나리오를 순차 실행 |
| 실행 중 추가 | 기존 plan을 수정하지 않고 같은 target hash의 immutable batch를 queue 뒤에 append |
| 실패 처리 | 실패 케이스의 후속 스텝은 건너뛰고 다음 대기 케이스를 계속 실행 |
| 성공 증적 | 각 스텝의 동작 완료 시 화면 1장 저장 |
| 실패 증적 | 동작 완료 화면, 실패 직전 화면, 실패 시점 화면, 오류 컨텍스트 저장 |
| 재실행 | 기존 기록을 덮어쓰지 않고 새 `executionId` 생성 및 이전 실행과 연결 |
| 중단 | 수집된 증적을 보존하고 현재·잔여 케이스를 중단 처리 |
| 보존 | 자동 삭제하지 않으며 실행 회차 단위의 명시적 삭제만 허용 |
| 결과 상태 | 성공, 실패, 판정 불가, 중단됨을 구분 |
| 모델 역할 | 저작 `author`와 독립 검토 `reviewer`를 별도 binding; reviewer 미설정 시 assurance 강등 |
| 데이터 원본 | 진행=journal/state, 산출물=run별 immutable artifact, 관계 조회=재구축 가능한 SQLite projection |
| 생성→수행 | immutable `ScenarioSnapshot` + 검증된 `RunnerPlan` 없이는 Runner 시작 금지 |
| 통합 하네스 서버 | Electron Main Application Orchestrator의 논리적 façade; 별도 상태 원본·세 번째 엔진 금지 |

## 5. 최상위 아키텍처

```text
Electron Renderer
        │
        │ typed IPC commands / domain events
        ▼
Electron Main — Application Orchestrator / Logical Harness Server
        ├── ProjectBootstrapper
        ├── CredentialStore
        ├── PiProcessManager
        ├── RuntimeStateCoordinator
        ├── AnalysisCoordinator
        ├── TestCoordinator
        └── ArtifactQueryService
                │
                ├──────────────┐
                ▼              ▼
       Pi UtilityProcess    TestVista UtilityProcess
       PiRuntimeHost        Execution Kernel
        ├── sessions         ├── adapter registry
        ├── resources        ├── web/UIA/mobile/CUA
        ├── tools            ├── assertion/evidence
        └── events           └── resource leases
                │              │
                └──────┬───────┘
                       ▼
        selected-project/.scenarioforge/
        state / journal / sessions / artifacts / evidence / index
```

### 5.1 권한 경계

- Renderer에는 Node.js, 파일 시스템, 프로세스 실행 권한을 노출하지 않는다.
- Electron Main은 요청 검증, 프로세스 수명, 경로 정책, credential 전달을 담당한다.
- Pi와 TestVista는 서로 다른 UtilityProcess에서 실행한다.
- Pi는 프로젝트 분석·질의와 제한된 수행 계획을 담당하며 실제 테스트 실행 상태의 원본이 아니다.
- TestVista는 고정된 테스트 계획의 대상별 adapter action을 실행한다. GUI grounder를 쓰더라도 LLM의 자유 응답으로 판정을 확정하지 않는다.
- 모든 파일 접근은 선택 프로젝트와 `.scenarioforge/`의 허용 경로로 제한한다.

### 5.2 상태 처리 경계

Pi의 원시 이벤트는 UI 계약이 아니다. Renderer는 Pi SDK event name, 메시지 chunk, `agent_end`, tool payload를 알지 못한다.

```text
Pi raw event
  → PiEventAdapter
  → domain command candidate
  → RuntimeStateCoordinator
  → durable state + checkpoint + revision commit
  → persisted domain event
  → typed IPC event
  → Renderer Project/Execution Store
  → state-derived view
```

`PiEventAdapter`의 책임은 Pi 이벤트를 정규화하고 검증 가능한 활동 사실 또는 세션 상태 변경 후보로 바꾸는 데 한정한다. Adapter는 분석 단계 완료를 확정하거나 파일을 직접 저장하거나 Renderer 이벤트를 발행하지 않는다.

- `agent_start`는 session `running` 전이 후보다.
- tool 시작·종료는 활동 패널용 activity 후보다.
- compaction 이벤트는 session `compacting` 전이 후보다.
- `agent_end`는 session `settled` 전이 후보일 뿐 stage completion이 아니다.
- 모델의 텍스트 응답과 숨은 사고 과정은 상태 판정과 UI 이벤트에 사용하지 않는다.

### 5.3 관리 상태 계층

각 계층은 독립 상태 머신을 가지며 상위 화면은 여러 계층의 영속 상태를 조합해 결정한다.

| 계층 | 대표 상태 | 화면 책임 |
| --- | --- | --- |
| 프로젝트 | `unselected`, `configuring`, `ready`, `error` | 프로젝트 선택, 설정, 작업대 진입 |
| Pi Runtime | `unconfigured`, `preparing`, `ready`, `recovering`, `stopped`, `error` | Runtime 준비와 복구 안내 |
| LLM 세션 | `creating`, `idle`, `running`, `retrying`, `compacting`, `cancelling`, `settled`, `recovering`, `failed` | 세션 상태 표시 |
| 분석 파이프라인 | `src`, `fact`, `wiki`, `scenario`와 단계별 lifecycle | 주 분석 화면과 검증된 진행률 |
| 작업 활동 | tool, skill, subagent, validator 활동 | 활동 패널만 갱신 |
| 산출물 | `absent`, `generating`, `validating`, `verified`, `persisted`, `invalid` | 다음 단계와 시나리오 화면 활성화 |
| 테스트 계획 batch | `requested`, `validating`, `snapshotted`, `compiling`, `planning`, `reviewing`, `plan-validating`, `queued`, `rejected` | 요청 검증·계획 준비·거절 표시 |
| 테스트 execution lifecycle | `queued`, `preparing`, `running`, `completed`, `cancelled`, `aborted` | 테스트 센터 진행과 복구 |
| 테스트 case/step result | `passed`, `failed`, `inconclusive`, `skipped`, `cancelled` | 결과 요약과 증적 표시 |

최소 상태 계약은 다음과 같다.

```ts
type ProjectLifecycleStatus =
  | "unselected"
  | "configuring"
  | "ready"
  | "error";

type RuntimeStatus =
  | "unconfigured"
  | "preparing"
  | "ready"
  | "recovering"
  | "stopped"
  | "error";

type AgentWorkStatus =
  | "creating"
  | "idle"
  | "running"
  | "retrying"
  | "compacting"
  | "cancelling"
  | "settled"
  | "recovering"
  | "failed";

type AnalysisStage = "src" | "fact" | "wiki" | "scenario";

type AnalysisStageStatus =
  | "pending"
  | "running"
  | "validating"
  | "completed"
  | "failed";

type ArtifactStatus =
  | "absent"
  | "generating"
  | "validating"
  | "verified"
  | "persisted"
  | "invalid";

type ActivityKind = "tool" | "skill" | "subagent" | "validator";

type ActivityStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

type ProjectRuntimeState = {
  schemaVersion: number;
  projectId?: string;
  revision: number;
  projectStatus: ProjectLifecycleStatus;
  runtimeStatus: RuntimeStatus;
  sessionStatus: AgentWorkStatus;
  sessionId?: string;
  analysisRunId?: string;
  activeStage?: AnalysisStage;
  stages: Record<AnalysisStage, AnalysisStageStatus>;
  artifactStatus: Record<AnalysisStage, ArtifactStatus>;
  progress: number;
  currentActivity?: string;
  recoverable: boolean;
  lastCheckpointId?: string;
  lastError?: {
    category: string;
    message: string;
  };
};
```

`progress`는 tool 호출 수나 모델 token에서 계산하지 않는다. 저장 완료된 stage와 현재 stage의 검증된 산출물 단위만으로 backend가 계산한다.

#### 5.3.1 Project와 Pi Runtime 상태 머신

```text
Project
unselected → configuring → ready
                    └────→ error
ready ──────────────────→ error
error → configuring                     # 재설정 또는 새 프로젝트 선택

Pi Runtime
unconfigured → preparing → ready → stopped → preparing
                    └───→ error
ready → recovering | stopped | error
recovering → ready | error | stopped
error → preparing | recovering | stopped
```

프로젝트 `ready`는 Pi Runtime과 산출물이 모두 준비됐다는 뜻이 아니다. 선택 프로젝트의 기본 저장소와 설정 계약이 유효하다는 뜻이며, 화면은 runtime과 artifact 상태를 추가로 조합한다.

#### 5.3.2 LLM 세션 상태 머신

```text
creating → idle | failed | recovering
idle → running | recovering | failed
running
                  ├→ retrying → running | failed | cancelling | recovering
                  ├→ compacting → running | settled | failed | recovering
                  ├→ cancelling → settled | failed | recovering
                  ├→ settled → idle | retrying | recovering
                  ├→ failed → retrying | recovering
                  └→ recovering → idle | running | settled | failed
```

`settled`는 현재 Pi turn이 더 이상 event를 생성하지 않는다는 뜻이다. session 전체의 성공이나 stage 완료를 뜻하지 않는다. 동일 session의 다음 stage 또는 보완 작업은 completion gate 결과에 따라 `idle` 또는 `retrying`을 거쳐 다시 `running`으로 전이한다.

#### 5.3.3 분석·산출물·활동 상태 머신

```text
Analysis stage
pending → running → validating → completed
             └────────┬───────→ failed
                      └───────→ running     # gate 미충족 보완 작업
failed → running                           # 명시적 retry, attempt 증가

Artifact
absent → generating → validating → verified → persisted
                           └────→ invalid → generating

Activity
queued → running → succeeded | failed | cancelled
```

한 analysis run에서 `completed` stage와 `persisted` artifact는 되돌리지 않는다. 수정·재분석은 새 `attemptId` 또는 새 `analysisRunId`를 생성하고 관계를 연결한다. stage 순서는 `src.completed → fact`, `fact.completed → wiki`, `wiki.completed → scenario`만 허용한다. 허용되지 않은 전이는 state invariant 오류로 거절하며 revision과 UI event를 만들지 않는다.

### 5.4 LLM 공통 작업 문서

모든 analysis, chat, test-planning 작업은 다음 두 문서를 공통 계약 표면으로 사용한다.

1. `.scenarioforge/runtime/WORK_PROTOCOL.md`
   - Resource Bundle 버전에 고정된 읽기 전용 작업 규격
   - 작업 시작 전 상태 확인, ID 기반 조회, 산출물 제출, 실패 보고, 완료 요청 원칙
   - LLM 응답과 업무 완료의 분리, 금지된 직접 파일 수정, 보안 경계를 선언
2. `.scenarioforge/state/WORK_STATE.md`
   - backend canonical state에서 생성한 현재 상태의 읽기 전용 Markdown projection
   - `schemaVersion`, `revision`, project/session/run/stage/work ID, 입력 ID, 검증된 산출물, 남은 완료 조건, 복구 정보, 허용된 다음 행동을 포함

`WORK_STATE.md`는 다음 heading과 순서를 고정한다. 값이 없더라도 heading을 생략하지 않아 parser와 LLM이 같은 위치에서 정보를 찾게 한다.

```md
# ScenarioForge Work State

## State Identity
## Current Assignment
## Required Input IDs
## Verified Artifacts
## Pending Completion Gates
## Recent Verifiable Activities
## Recovery and Error
## Allowed Next Actions
```

문서에는 credential, 개인정보 원문, chain-of-thought, 전체 tool output을 넣지 않는다. `Recent Verifiable Activities`는 제한된 최근 항목의 projection이며 전체 이력은 journal과 activity 조회 API가 보존한다.

`WORK_PROTOCOL.md`의 구체적인 역할 지침과 문구는 Phase 8에서 작성한다. 이 단계에서는 문서 schema, version, 생성·검증 계약만 구현한다.

LLM이나 서브에이전트가 `WORK_STATE.md`, `project-state.json`, checkpoint를 파일 도구로 직접 편집하는 것은 금지한다. 작업자는 PiRuntimeHost가 제공하는 통제된 `WorkStateService` 요청을 통해서만 갱신 의도를 제출한다.

```ts
interface WorkStateService {
  getContext(input: {
    projectId: string;
    workId: string;
  }): Promise<WorkContext>;

  begin(input: {
    projectId: string;
    workId: string;
    operationId: string;
    expectedRevision: number;
    contextToken: string;
  }): Promise<StateCommit>;

  requestChildWork(input: {
    projectId: string;
    parentWorkId: string;
    operationId: string;
    expectedRevision: number;
    descriptor: ChildWorkDescriptor;
  }): Promise<StateCommit>;

  updateProgress(input: {
    projectId: string;
    workId: string;
    operationId: string;
    expectedRevision: number;
    progress: WorkProgressPatch;
  }): Promise<StateCommit>;

  recordActivity(input: {
    projectId: string;
    workId: string;
    operationId: string;
    expectedRevision: number;
    activity: VerifiableActivity;
  }): Promise<StateCommit>;

  submitArtifacts(input: {
    projectId: string;
    workId: string;
    operationId: string;
    expectedRevision: number;
    artifacts: ArtifactSubmission[];
  }): Promise<StateCommit>;

  discardDraftArtifact(input: {
    projectId: string;
    workId: string;
    operationId: string;
    expectedRevision: number;
    artifactId: string;
    reason: string;
  }): Promise<StateCommit>;

  reportFailure(input: {
    projectId: string;
    workId: string;
    operationId: string;
    expectedRevision: number;
    error: DomainError;
  }): Promise<StateCommit>;

  requestCompletion(input: {
    projectId: string;
    workId: string;
    operationId: string;
    expectedRevision: number;
  }): Promise<CompletionDecision>;
}

type WorkContext = {
  projectId: string;
  workId: string;
  parentWorkId?: string;
  revision: number;
  protocolVersion: string;
  protocolHash: string;
  protocolMarkdown: string;
  stateHash: string;
  stateMarkdown: string;
  requiredInputIds: string[];
  allowedNextActions: string[];
  contextToken: string;
};

type StateCommit = {
  projectId: string;
  workId: string;
  previousRevision: number;
  revision: number;
  eventId: string;
  workStateHash: string;
};

type VerifiableActivity = {
  activityId: string;
  kind: ActivityKind;
  name: string;
  targetIds: string[];
  status: ActivityStatus;
  startedAt: string;
  finishedAt?: string;
  summary?: string;
};

type ChildWorkDescriptor = {
  functionId: LlmFunctionId;
  inputIds: string[];
  objective: string;
  readScopes: string[];
  writeScope: string;
};

type WorkProgressPatch = {
  currentActivity: string;
  producedIds: string[];
};

type ArtifactSubmission = {
  artifactId: string;
  artifactType: AnalysisStage;
  stagingPath: string;
  relatedIds: string[];
  contentHash: string;
  supersedesArtifactId?: string;
};

type DomainError = {
  category: string;
  message: string;
  recoverable: boolean;
  activityId?: string;
};

type CompletionDecision =
  | {
      accepted: true;
      commit: StateCommit;
    }
  | {
      accepted: false;
      revision: number;
      unmetGates: string[];
      context: WorkContext;
    };
```

`getContext`는 project, work, revision, protocol hash에 묶인 일회성 `contextToken`을 발급하고 `begin`은 이 token이 없거나 오래됐으면 거절한다. 따라서 각 root/child 작업은 공통 문서를 조회하지 않고 시작할 수 없다. 이후 `expectedRevision`이 현재 revision과 다르면 갱신을 거절하고 최신 `WorkContext`를 다시 읽게 한다. 이를 통해 여러 tool과 subagent 결과가 오래된 상태를 덮어쓰지 못하게 한다. 구체적인 Pi tool 이름과 각 역할이 참조하는 상세 정보는 마지막 하네스·스킬·에이전트 설계에서 이 service 계약에 매핑한다.

### 5.5 공통 작업 프로토콜

각 논리 작업은 backend가 발급한 `workId`와 다음 순서를 따른다.

1. `getContext`로 최신 revision과 `WORK_PROTOCOL.md`/`WORK_STATE.md` 내용을 읽고 `contextToken`을 발급받는다.
2. 같은 revision의 `contextToken`을 포함한 `begin`으로 작업 시작을 기록한다.
3. tool, skill, subagent 실행 결과 중 검증 가능한 사실만 `recordActivity`로 기록한다.
4. 생성 결과는 staging 영역에 둔 뒤 `submitArtifacts`로 검증을 요청한다.
5. 실패하면 원인을 `reportFailure`로 구조화해 남긴다.
6. 작업자가 끝났다고 판단해도 `requestCompletion`만 호출한다.
7. backend completion gate가 거절하면 최신 context와 미충족 조건을 받아 계속 작업한다.
8. gate가 승인되고 상태 commit이 완료된 뒤에만 stage completion event가 발행된다.

“매 작업마다 확인하고 업데이트”의 단위는 모델 token이나 자연어 메시지가 아니라 상태에 영향을 주는 `workId` 단위다. child subagent는 별도 child `workId`를 가지며, 부모 작업은 child 결과가 검증된 뒤에만 이를 자신의 산출물로 통합한다.

### 5.6 영속 상태 commit과 revision

`RuntimeStateCoordinator`는 프로젝트별 single-writer queue를 사용한다. 모든 상태 변경은 다음 순서를 지킨다.

1. 현재 snapshot과 `expectedRevision` 비교
2. 순수 reducer로 다음 상태와 단일 domain event 계산
3. state journal과 checkpoint를 임시 경로에 기록하고 검증
4. revision을 1 증가시킨 commit record를 원자적으로 확정
5. `project-state.json`과 `WORK_STATE.md` projection 갱신
6. 저장된 domain event를 typed IPC로 발행

hash 검증을 통과한 최신 journal commit record가 canonical state다. `project-state.json`은 빠른 시작을 위한 snapshot이고 `WORK_STATE.md`는 LLM용 projection이므로, 두 파일은 journal에서 재생성할 수 있다. checkpoint에는 Pi session 위치, analysis run·stage·attempt, artifact hash, index revision, 마지막 완료 gate를 저장한다.

artifact 관계 index의 row는 예정된 `stateRevision`과 `transactionId`를 포함한다. `ArtifactQueryService`는 canonical revision 이하이고 commit record의 artifact hash와 일치하는 row만 노출한다. index 기록 후 state commit 전에 종료되면 해당 row는 보이지 않으며 recovery가 제거한다. 최종 경로에 파일만 남은 경우는 `.scenarioforge/state/orphans/`로 이동하고 자동 삭제하지 않는다. retry 산출물과 hash가 같을 때만 validator를 다시 거쳐 재사용하고, 그 외 파일은 복구 화면에서 대상과 용량을 보여준 뒤 사용자가 명시적으로 삭제한다.

domain event는 다음 envelope를 공통으로 사용한다.

```ts
type DomainEvent<TType extends string, TPayload> = {
  schemaVersion: number;
  eventId: string;
  projectId: string;
  revision: number;
  occurredAt: string;
  type: TType;
  payload: TPayload;
};
```

하나의 state commit은 하나의 revision과 하나의 domain event만 생성한다. 복합 변경은 하나의 event payload에 함께 담고, 후속 활동은 별도 commit으로 처리한다. event는 commit record에 먼저 저장하므로 앱 종료로 publish가 끊겨도 재시작 후 `revision` 기준으로 replay할 수 있다. Renderer는 동일 `eventId` 또는 이미 적용한 revision을 무시한다.

### 5.7 완료 판정과 상태 분리

세션 상태와 업무 상태는 서로 다른 reducer가 관리한다.

```text
Pi agent_end
  → session settled
  → stage validating
  → schema validation
  → required ID/source relation validation
  → artifact atomic persistence
  → index update verification
  → stage completed + project revision commit
  → analysis.stage.completed event publish
```

예를 들어 FACT 단계는 아래 조건이 모두 참일 때만 완료된다.

- FACT root work와 모든 child work가 `settled` 또는 명시적 종료 상태이고 진행 중 activity가 없다.
- FACT artifact schema가 유효하다.
- 모든 FACT ID와 source ID의 관계가 존재한다.
- artifact가 staging이 아닌 최종 경로에 원자적으로 저장됐다.
- 관계 index 조회 결과가 저장 artifact와 일치한다.
- 새 project revision과 checkpoint가 확정됐다.
- 동일 revision의 `analysis.stage.completed` event가 commit record에 포함됐다.

하나라도 실패하면 FACT는 `validating` 또는 `failed`에 머물며 시나리오 화면을 활성화하지 않는다. `agent_end`, 모델의 “완료했습니다” 응답, tool 성공 이벤트는 단독 완료 조건이 될 수 없다.

### 5.8 앱 재시작과 복구

앱 시작 시 저장된 상태가 `running`, `retrying`, `compacting`, `cancelling`이면 그대로 Renderer에 복원하지 않는다.

```text
previous active state
  → runtime/session recovering
  → latest valid journal + checkpoint 선택
  → Pi session 존재와 resume 가능 여부 검사
  → staged/final artifact와 index 일치 검사
  → resumable: ready/running 또는 validating으로 전이
  → not resumable but retryable: error + recoverable=true
  → corrupt/non-retryable: error + recoverable=false
```

복구 시 `WORK_STATE.md`는 canonical snapshot에서 다시 생성한다. projection 누락이나 손상만으로 작업을 실패 처리하지 않는다. journal의 revision이 연속되지 않거나 hash가 맞지 않으면 마지막 정상 checkpoint까지만 채택하고 사용자에게 재개 또는 새 분석을 선택하게 한다.

### 5.9 프런트 Store와 화면 판정

Renderer는 다음 store를 분리한다.

- `ProjectStore`: 프로젝트 선택·설정·runtime 준비·복구·오류
- `AnalysisExecutionStore`: session, stage, artifact, progress, completion gate 결과
- `ActivityStore`: tool, skill, subagent, validator의 검증 가능한 활동 요약
- `TestExecutionStore`: 순차 queue, case, step, evidence 상태

Store는 시작 시 `project.getState` snapshot을 받고 이후 domain event만 적용한다. 이벤트 revision이 현재보다 1 크면 적용하고, 같거나 작으면 무시하며, 2 이상 차이나면 `project.getEventsSince`로 누락 event를 요청한다. replay가 불가능하면 전체 snapshot을 다시 받는다.

주 화면 전환 규칙은 다음과 같다.

| 조건 | 화면 |
| --- | --- |
| project `unselected` | 프로젝트 선택 |
| project `configuring`이고 model 미설정 | 모델 설정 modal |
| runtime `preparing` | Pi 작업환경 준비 |
| runtime `ready`이고 분석 미시작 | 프로젝트 분석 준비 |
| session `running`이고 active stage 존재 | SRC/FACT/WIKI/SCENARIO 진행 |
| runtime 또는 session `recovering` | 작업 복구 |
| SCENARIO artifact `persisted`이고 analysis 완료 | 시나리오 도출 |
| `error`, `recoverable=true` | 오류 원인과 재시도/새 분석 선택 |
| `error`, `recoverable=false` | 복구 불가 원인과 설정/프로젝트 선택 이동 |

활동 상태는 `ActivityStore`와 활동 패널만 갱신한다. tool 실행이나 subagent 완료가 route를 전환하지 않는다. LLM의 사고 과정은 저장·전송·표시하지 않고 도구 이름, 대상의 안전한 식별자, 시작·종료 시각, 구조화 결과만 노출한다.

## 6. 프로젝트 초기화

### 6.1 사용자 흐름

```text
프로젝트 선택
  → 모델 설정
  → 프로젝트 신뢰·범위 확인
  → .scenarioforge manifest 검사
  → Runtime Resource Bundle 설치 또는 마이그레이션
  → 세션·인덱스·산출물 저장소 준비
  → Pi 세션 생성 또는 복구
  → 프로젝트 작업대
```

### 6.2 ProjectBootstrapper 책임

- 선택 경로의 실재 여부, 디렉터리 여부, 읽기·쓰기 가능 여부 검사
- symlink와 `..`를 포함한 경로 이탈 방지
- 프로젝트 ID 생성 또는 기존 ID 복구
- `.scenarioforge/manifest.json` 스키마와 runtime version 검사
- 동일 버전 초기화의 멱등성 보장
- 마이그레이션 전에 manifest와 상태 파일의 복구 사본 생성
- runtime resource를 임시 디렉터리에 작성하고 검증 후 원자적으로 교체
- 세션 디렉터리와 산출물 인덱스 준비
- bootstrap 도메인 이벤트 발행

### 6.3 프로젝트 파일 보호

- 사용자의 소스 파일을 초기화 과정에서 변경하지 않는다.
- 프로젝트 `.gitignore`를 자동 수정하지 않는다.
- `.scenarioforge/`의 커밋 여부는 사용자에게 별도 안내하고 이후 설정으로 다룬다.
- 프로젝트가 이미 `.scenarioforge/`를 포함하면 소유권과 버전을 확인한 뒤 재사용한다.
- 호환되지 않는 버전은 조용히 덮어쓰지 않고 마이그레이션 필요 상태로 표시한다.

## 7. LLM과 Pi Runtime

### 7.1 모델 구성

사용자가 설정한 다음 값으로 Pi의 모델 런타임을 구성한다. 화면의 단일 "연결 모델" 개념은 backend에서 역할별 `ModelBinding`으로 확장한다.

- provider
- endpoint
- model ID
- API credential reference
- thinking level 또는 제품이 허용하는 추론 설정

```ts
type ModelRole = "author" | "reviewer";

type ModelBinding = {
  role: ModelRole;
  provider: "openai-compatible" | "anthropic" | "custom";
  endpoint: string;
  modelId: string;
  credentialRef?: string;
};
```

- `author`는 FACT 의미 추출, 모호 link 판정, WIKI·SCENARIO 저작에 사용한다.
- `reviewer`는 snapshot/hash로 고정된 evidence가 주장을 지지하는지 독립 verdict를 제출한다.
- 기본 검증 구성은 author=Qwen3.6-35B-A3B, reviewer=GLM-5.2지만 제품 계약은 모델명이 아니라 역할을 참조한다.
- reviewer가 없으면 author 자체 검토로 계속할 수 있으나 run manifest에 `assurance: single-model`을 기록하고 독립 검증으로 표시하지 않는다.
- reviewer verdict도 stage completion이 아니다. backend completion gate만 최종 status를 commit한다.

provider, endpoint, model ID는 애플리케이션 설정에 보존할 수 있다. API key 원문은 프로젝트에 저장하지 않는다. 운영체제 보안 저장소를 사용할 수 있으면 credential reference만 저장하고, 사용할 수 없으면 현재 앱 세션 메모리에만 유지하며 재시작 후 재입력을 요구한다.

원격 endpoint를 사용하면 closure의 source slice가 장치 밖으로 전송될 수 있다. bootstrap과 모델 설정은 역할별 endpoint, 전송 범위, source secret 차단 정책을 명시해야 한다. "산출물이 로컬에 저장됨"을 "소스가 외부로 전송되지 않음"으로 표현하지 않는다.

### 7.2 PiRuntimeHost

PiRuntimeHost는 Pi SDK를 별도 UtilityProcess에 내장한다.

- 최초 구현은 `@earendil-works/pi-coding-agent@0.84.3`을 exact pin하고 runtime manifest에 package hash를 기록한다.

- 프로젝트 루트를 `cwd`로 사용
- 프로젝트별 SessionManager 사용
- ScenarioForge ResourceLoader로 runtime resource 경로를 명시
- 기본 파일·명령 도구를 경로 정책과 명령 정책으로 감싼다.
- 세션 원시 이벤트를 구독해 `PiEventAdapter`에 전달한다.
- Adapter가 만든 상태 명령 후보를 `RuntimeStateCoordinator`로 전달하고 직접 domain event를 만들지 않는다.
- `prompt`, `steer`, `followUp`, `abort`, `compact`, `dispose` 수명을 관리한다.
- Pi 프로세스가 종료되면 애플리케이션 상태와 세션 파일을 대조해 복구 가능 상태를 계산한다.

### 7.3 SDK와 RPC 선택

- Pi와 애플리케이션이 모두 TypeScript/Node.js 기반이므로 UtilityProcess 내부에서는 SDK를 사용한다.
- Electron Main과 Pi UtilityProcess 사이에는 ScenarioForge 전용 IPC protocol을 사용한다.
- Pi CLI RPC는 언어가 다른 외부 프로세스를 붙일 필요가 생길 때만 고려한다.

### 7.4 LangGraph 제외 근거

Pi가 이미 agent loop, session, resource loading, tool execution, compaction, event streaming을 담당한다. LangGraph를 동시에 도입하면 Pi 세션과 그래프 checkpoint라는 두 개의 실행 상태 원본이 생긴다.

다음 요구가 실제로 발생하기 전에는 LangGraph를 도입하지 않는다.

- 노드 단위 exact-resume
- 장시간 사용자 승인 interrupt
- 분산 작업자와 중앙 checkpoint
- 보상 트랜잭션 또는 복잡한 rollback
- 여러 프로세스가 공유하는 durable graph state

## 8. 세션 토폴로지

### 8.1 사용자 모델과 내부 모델

사용자는 하나의 프로젝트가 지속되는 것으로 이해한다. 내부에서는 책임을 분리한 프로젝트 세션 집합을 사용한다.

```text
projectSessionId
├── analysisSession
├── chatSession/{conversationId}
└── testPlanningSession/{executionId}/{batchId}
```

### 8.2 Analysis Session

- `SRC → FACT → WIKI → SCENARIO` 작업의 연속성을 유지한다.
- 완료 산출물은 세션 메시지가 아니라 파일과 인덱스에 저장한다.
- 사용자가 분석을 중단하면 Pi 작업을 abort하고 마지막 검증된 checkpoint를 유지한다.
- 재개 시 manifest와 세션을 대조해 다음 미완료 단계를 계산한다.

### 8.3 Chat Session

- 시나리오 도출 페이지에서만 생성·사용한다.
- 요청은 `scenarioRunId`, `scenarioId[]`, `conversationId`, `question`을 포함한다.
- 답변에 필요한 사실은 ID 기반 도구로 조회한다.
- 테스트 센터와 증적 화면에는 질문 요청 API를 노출하지 않는다.
- 테스트 센터와 증적 화면의 `시나리오에서 보기`는 해당 시나리오를 강조한 도출 페이지로만 이동한다.

### 8.4 Test Planning Session

- LLM의 해석이 필요한 테스트 계획 생성 또는 보완에만 사용한다.
- TestVista가 실행할 계획은 반드시 구조화 스키마로 검증하고 immutable snapshot으로 저장한다.
- 테스트 실행 중 LLM의 자유로운 계획 변경을 허용하지 않는다.
- 최초 실행, 명시적 enqueue, retry가 만드는 새 batch에서만 계획하며 기존 batch plan을 수정하지 않는다.
- deterministic compiler가 모든 binding을 해결하면 session을 생성하지 않는다.
- session에는 execution planning resource만 로드하며 생성 skill·agent와 Runner 제어 tool을 노출하지 않는다.

### 8.5 Harness work 목록과 고정 외부 워크플로우

내부 탐색과 tool 선택은 동적이지만 각 work의 입력, executor, 쓰기 범위, 출력, 완료 gate는 고정한다. source map은 가능한 범위를 결정론적 scanner가 수행하므로 모든 work를 LLM 기능으로 부르지 않는다.

```ts
type GenerationHarnessWorkKind =
  | "analysis.source-map"
  | "analysis.fact-extract"
  | "analysis.wiki-compose"
  | "analysis.scenario-compose";

type ScenarioQueryWorkKind = "scenario.answer";
type ExecutionPlanningWorkKind = "test.plan";
type HarnessWorkKind =
  | GenerationHarnessWorkKind
  | ScenarioQueryWorkKind
  | ExecutionPlanningWorkKind;

type LlmFunctionId = Exclude<HarnessWorkKind, "analysis.source-map">;
```

| 기능 | executor | 입력 | 허용 출력 | 완료 gate |
| --- | --- | --- | --- | --- |
| `analysis.source-map` | backend scan, 동적 등록만 제한된 보조 work | project snapshot, include/exclude policy | source snapshot, source/module/dependency ID와 위치 | source schema, hash, 경로 존재, 프로젝트 범위 확인 |
| `analysis.fact-extract` | author + reviewer | persisted source ID, evidence grant slice | fact graph draft + semantic verdict | fact schema, snapshot/hash evidence, first-class edge, relation 확인 |
| `analysis.wiki-compose` | author + reviewer | persisted fact/source ID의 bounded view | workflow와 fact relation + semantic verdict | wiki schema, fact coverage, terminal·variation·cites 검사 |
| `analysis.scenario-compose` | deterministic walk + author + reviewer | persisted workflow/fact/source ID | `SCN-*`, structured precondition, action/assertion refs | scenario schema, ID graph, 중복·순서·coverage 검사 |
| `scenario.answer` | author | 선택 scenario ID와 질문 | ID별 근거가 있는 chat response record | 모든 인용 ID가 query 결과에 존재, 분석 artifact 변경 없음 |
| `test.plan` | 필요한 경우 author + reviewer; compiler는 work 밖 backend | immutable batch snapshot, target contract, redacted probe slice | 구조화 RunnerPlan patch + review verdict | plan schema, snapshot hash, action/assertion 보존, 후보 provenance, 허용 action 검사 |

각 root 기능은 다음 순서를 공통으로 따른다.

```text
AnalysisCoordinator or TestCoordinator creates immutable WorkDescriptor
  → function-specific read/write policy 적용
  → getContext + contextToken
  → begin
  → executor 실행 (deterministic tool 또는 Pi turn)
  → 필요 시 requestChildWork
  → child 결과를 각각 검증
  → root가 결과를 staging에 통합
  → submitArtifacts
  → Pi work tree settled 확인
  → requestCompletion
  → backend completion gate
  → state revision commit
  → domain event publish
```

`scenario.answer`와 `test.plan`도 같은 시작·settle 계약을 사용하지만 analysis stage를 변경하지 않는다. `scenario.answer`는 conversation record만 append한다. `test.plan`은 TestCoordinator의 deterministic compiler가 unresolved binding을 반환한 경우에만 batch별 planning staging artifact를 만들며 execution state나 Runner queue를 변경하지 않는다.

### 8.6 Work별 격리와 안정성

| 경계 | analysis 4단계 | scenario Q&A | test planning |
| --- | --- | --- | --- |
| Pi session | 하나의 analysis session에서 stage별 root work 분리 | conversation별 chat session | execution/batch별 planning session, 필요할 때만 생성 |
| 읽기 | 현재 stage가 허용한 project source와 persisted input ID | ArtifactQueryService가 반환한 선택 ID 관계 | immutable scenario snapshot, target contract, 배정된 redacted probe slice |
| 쓰기 | `.scenarioforge/staging/{workId}/`와 상태 요청 | conversation log만 append | `.scenarioforge/staging/{workId}/runner-plan-patch.json` 또는 review verdict |
| 금지 | 다른 stage final artifact와 canonical state 직접 수정 | source·fact·wiki·scenario·execution 수정 | project source, analysis artifact, 기존 plan, Runner queue/control, evidence 수정 |
| child work | module 또는 ID batch 단위 허용 | 기본 금지 | 계획이 큰 경우 scenario 단위 허용 |
| 완료 | stage completion gate | response schema와 cited ID gate | TestCoordinator plan validator와 batch durable commit gate |

안정성 규칙은 다음과 같다.

- root/child work는 각각 고유 `workId`, staging path, tool policy, activity stream을 가진다.
- child는 부모의 `contextToken`을 재사용하지 않고 자체 context를 조회한다.
- child 결과는 부모 상태를 직접 바꾸지 않으며 parent integration gate를 통과해야 한다.
- project별 `RuntimeStateCoordinator`만 canonical state를 쓰고 모든 LLM session은 read-only projection을 본다.
- 상태 변경 요청은 `{projectId, sessionId, workId, operationId, expectedRevision}` idempotency key로 중복 적용을 막는다.
- provider timeout, rate limit, 일시적 network 오류만 최대 2회 재시도하며 대기 간격은 1초, 3초다.
- schema, 권한, 경로 이탈, ID 충돌 오류는 자동 재시도하지 않고 `failed`와 구조화 원인을 기록한다.
- work timeout 또는 abort 시 child부터 취소하고 root를 `cancelling → settled|failed`로 전이한다.
- Pi UtilityProcess crash는 Electron Main과 Renderer를 종료시키지 않으며 session을 `recovering`으로 전이한다.
- tool output은 크기 제한과 민감정보 마스킹을 거친 요약만 activity에 저장한다.

### 8.7 공통 계약 정보의 추가·수정·삭제

`WORK_PROTOCOL.md`는 앱 Resource Bundle이 소유한다. LLM은 읽기만 가능하며 app upgrade가 새 protocol version과 hash를 설치할 때만 변경한다. 호환되지 않는 protocol은 기존 run에 덮어쓰지 않고 새 analysis run부터 적용한다.

`WORK_STATE.md`는 canonical journal의 projection이므로 LLM이 Markdown을 직접 편집하지 않는다. 정보 변경은 다음 규칙을 사용한다.

| 연산 | 허용 방식 | 불변 조건 |
| --- | --- | --- |
| 추가 | `requestChildWork`, `recordActivity`, `submitArtifacts` 등 구조화 command | backend가 ID와 owner를 검증하고 새 revision 생성 |
| 수정 | `updateProgress`와 activity 종료처럼 allowlist field만 compare-and-set | `expectedRevision` 일치, 자신의 `workId` 범위, 이전 값 journal 보존 |
| 삭제 | 미제출 draft만 `discardDraftArtifact`; work와 제출 기록은 tombstone | persisted artifact, activity, 완료 stage는 LLM hard delete 금지 |

삭제는 기본적으로 물리 삭제가 아니라 다음 tombstone을 새 revision에 추가하는 방식이다.

```ts
type StateTombstone = {
  entityId: string;
  entityType: "work" | "draft-artifact";
  deletedAt: string;
  deletedByWorkId: string;
  reason: string;
  previousRevision: number;
};
```

- unsubmitted draft는 staging에서 격리한 뒤 tombstone commit이 성공하면 제거할 수 있다.
- 제출·검증·저장된 artifact는 새 attempt가 `supersedesArtifactId`로 대체하며 기존 파일과 관계를 유지한다.
- activity는 append-only이고 삭제하지 않는다. 민감정보가 발견되면 원본을 노출 차단하고 redaction revision을 추가한다.
- analysis run, test execution, evidence의 물리 삭제는 사용자 명시 명령과 관계 검사를 거치는 retention 기능만 수행한다.
- tombstone 또는 superseding 관계가 반영될 때마다 `WORK_STATE.md`를 전체 재생성하고 hash를 StateCommit에 기록한다.

### 8.8 역할별 상세 하네스와의 연결 시점

위 기능 ID, workflow, isolation, CRUD 계약은 하네스보다 먼저 구현하고 fake Pi fixture로 검증한다. Phase 8에서 생성 resource는 `docs/pi-coding-agent 하네스 설계.md`, 수행 resource는 `docs/architecture/04-test-execution-harness-design.md`에 따라 별도 subtree와 policy로 연결한다. 최상위 Pi harness는 공통 lifecycle과 domain routing만 정의한다. 하네스는 상태 전이나 완료 조건을 새로 정의할 수 없고 backend 계약을 설명하고 호출하는 역할만 가진다.

## 9. 분석 파이프라인

### 9.1 고정 외부 단계

```text
BOOTSTRAP → SRC → FACT → WIKI → SCENARIO → READY
```

각 단계 내부에서는 Pi가 프로젝트 특성에 따라 도구·스킬·서브에이전트를 선택한다. 단계의 시작·완료·실패·복구는 AnalysisCoordinator가 통제한다.

상세 생성 하네스의 내부 순서는 다음으로 고정한다.

```text
SRC:      source snapshot + scan + closure inventory
FACT:     stack별 추출 → auto link → ambiguous link 판정 → independent semantic review
WIKI:     workflow 저작 → cites/terminal/variation 검증 → independent semantic review
SCENARIO: bounded walk/combination → UX 서술 → independent semantic review → coverage
```

scan, auto link, walk, coverage는 backend executor이며 모델 선택에 맡기지 않는다. 각 stage의 author/reviewer work는 동적일 수 있지만 stage 순서와 completion gate는 고정한다.

### 9.2 완료 조건

Pi의 텍스트 응답은 완료 조건으로 사용하지 않는다. 각 단계는 다음 조건을 충족해야 한다.

1. root work와 모든 child work가 `settled` 또는 명시적 종료 상태이며 `queued`/`running` activity가 없음
2. 스키마 검증 통과
3. 필수 ID와 원천 참조 존재
4. 임시 파일에서 최종 파일로 원자적 저장 완료
5. 인덱스 반영 완료
6. stage manifest 갱신 완료
7. state journal과 checkpoint에 새 revision 확정
8. 동일 revision의 완료 도메인 이벤트를 commit record에 포함

작업자가 `requestCompletion`을 호출하면 stage는 먼저 `validating`으로 전이한다. validator가 위 조건을 확인한 후 `completed`를 commit하고 저장된 이벤트를 발행한다. publish가 중간에 끊기면 완료 상태를 되돌리지 않고 해당 revision의 이벤트를 replay한다. Renderer는 이벤트 수신 또는 최신 snapshot 동기화 전에는 완료 화면으로 전환하지 않는다. gate 거절 시 `CompletionDecision.unmetGates`를 공통 상태 문서에 반영해 같은 작업 또는 복구 작업이 이어서 처리한다.

### 9.3 단계별 산출물

| 단계 | 최소 산출물 |
| --- | --- |
| SRC | source snapshot ID, 파일 hash·언어·모듈·의존 경계 목록과 source ID, evidence grant ledger |
| FACT | 화면·상태·요소·API·술어·first-class 전이, snapshot/hash evidence, 플랫폼별 interaction target 후보와 observable assertion |
| WIKI | workflow goal, entry/terminal, variation/combination, cites한 fact ID |
| SCENARIO | `SCN-{업무코드}-{3자리}`, 구조화 사전 조건, path, action/actionRef, expected/assertionRefs, coverage |

## 10. ID와 인덱스

### 10.1 원칙

- 모든 정보는 문자열 ID로 연결한다.
- ID는 UI 표시값이면서 조회 계약의 키다.
- 경로와 파일명만으로 관계를 추론하지 않는다.
- 동일 분석 run 안에서 ID는 변경되지 않는다.
- 재분석 시 의미가 같은 엔터티의 ID 유지 여부는 인덱스의 identity mapping으로 결정한다.
- 생성 충돌은 애플리케이션 validator가 거부한다.
- 화면 ID의 semantic key는 router namespace + canonical route pattern이며 충돌 suffix는 backend가 결정한다.
- 사용자에게 표시되는 시나리오 ID는 기존 UI 계약과 동일한 `SCN-{업무코드}-{3자리 순번}`을 사용한다. `TS-*` 별도 체계를 만들지 않는다.

### 10.2 주요 관계

```text
scenarioId
├── sourceIds
├── factIds
├── wikiIds
├── executionIds
└── evidenceIds
```

### 10.3 ArtifactQueryService

최소 조회 계약은 다음을 포함한다.

- `scenario.getById`
- `source.listByScenarioId`
- `fact.listByScenarioId`
- `wiki.listByScenarioId`
- `execution.listByScenarioId`
- `evidence.listByScenarioId`

Pi 도구와 Renderer 읽기 API는 동일 query service를 사용해 관계 해석 차이를 방지한다.

## 11. 테스트 수행

수행 lifecycle은 `docs/architecture/04-test-execution-harness-design.md`, 다중 대상 adapter 계약은 `docs/architecture/05-multi-target-execution-adapter-design.md`를 따른다. 생성 완료는 수행 트리거가 아니며 사용자의 명시적 test command가 있어야 수행 준비를 시작한다.

### 11.1 사용자 트리거와 실행 생성

시나리오 도출 페이지에서 선택한 케이스, 대상 유형별 설정, 테스트 전용 data binding을 제출하면 다음 순서로 처리한다.

1. `test.createExecution` command의 schema, 관계, `operationId`, `expectedRevision` 검증
2. target 종류별 origin·process·window·device policy와 테스트 데이터 민감 필드 정책 검사
3. 새 `executionId`와 최초 `batchId` 할당
4. 선택 시나리오, FACT action/assertion reference, upstream artifact hash를 묶은 batch별 immutable `ScenarioSnapshot` 생성
5. `ExecutionTargetProfile`과 `DataBindingSet`을 검증하고 environment preflight와 capability registry를 구성
6. deterministic compiler가 action/assertion을 adapter-neutral IR과 `ExecutionSegment`로 binding하고, 미해결 target reference가 있을 때에만 허용된 Discovery Probe와 Pi test planning session에서 구조화 plan patch 생성·검토
7. 계획이 scenario hash와 action/assertion 의미를 보존하는지 backend validator 통과
8. immutable `ExecutionBatch` artifact와 순차 queue를 하나의 durable revision으로 commit
9. TestVista UtilityProcess 시작
10. 진행 이벤트와 증적 저장

`ScenarioSnapshot`과 검증된 `RunnerPlan` 없이는 Runner를 시작하지 않는다. `action`·`expected` 자연어만 Runner에 넘기지 않는다.

#### 11.1.1 생성→수행 handoff

`ScenarioSnapshot`은 선택 시나리오의 표시 문장뿐 아니라 다음 관계를 고정한다.

- `analysisRunId`, `sourceSnapshotId`, scenario artifact hash
- step별 `actionRef { edgeId, elementId }`
- step별 `assertionRefs[]`
- 구조화 precondition의 `predicateRefs[]`와 `dataBindingKeys[]`
- FACT의 semantic·visual target 후보와 observable assertion shape

`RunnerPlan`은 이를 플랫폼 중립 `ActionIntent`, `TargetRef`, `AdapterBinding`, matcher로 컴파일한다. 기존 `click/fill/select/upload/navigate`는 이 IR의 부분집합이다. `test.plan`은 시나리오의 path, 기대 결과, assertion ID를 변경할 수 없고 실행 중에는 계획을 수정하지 않는다. 자동화할 target reference 또는 matcher를 확정할 수 없으면 임의 selector·automation ID·좌표를 만들지 않고 계획 단계에서 batch를 거절한다. 계획이 통과했지만 실행 환경 문제로 assertion을 관찰할 수 없는 경우에만 case를 `INCONCLUSIVE`로 판정한다. visual/CUA 모델은 observation과 confidence만 반환하며 최종 verdict는 AssertionEngine이 확정한다.

#### 11.1.2 실행 중 대기열 추가

활성 execution이 있는 상태에서 사용자가 같은 target에 시나리오를 추가하면 `test.enqueueScenarios`가 새 batch를 만든다.

- enqueue는 기존 `ScenarioSnapshot`이나 `RunnerPlan`을 수정하지 않는다.
- 새 batch는 자체 snapshot, optional probe, plan, manifest를 가진다.
- 새 batch의 target hash는 active execution과 같아야 한다.
- planning에 실패한 batch는 `REJECTED`로 남고 기존 queue에 영향을 주지 않는다.
- 검증 완료된 batch만 현재 queue의 뒤에 원자적으로 append한다.
- 같은 scenario의 의도적 재수행은 enqueue가 아니라 `test.retryCases`로 새 execution을 만든다.

### 11.2 순차 실행 상태

계획 batch와 Runner execution 상태를 분리한다.

```text
REQUESTED → VALIDATING → SNAPSHOTTED → COMPILING
  ├── PLAN_VALIDATING → QUEUED
  └── PLANNING → REVIEWING? → PLAN_VALIDATING → QUEUED | REJECTED

QUEUED → PREPARING → RUNNING → COMPLETED
   ├── CANCELLED
   └── ABORTED
```

- 프로젝트별 Runner는 한 번에 하나의 시나리오만 실행한다.
- 실행 중 사용자가 다른 시나리오를 추가하면 검증된 새 batch를 대기열 뒤에 추가한다.
- 테스트 실패 시 현재 케이스의 후속 스텝은 `SKIPPED`로 기록한다.
- 실패 증적을 확정한 후 다음 대기 케이스를 계속 실행한다.
- 케이스 단위 환경 오류는 `INCONCLUSIVE`로 기록하고 Runner 재준비 후 다음 케이스를 시도한다.
- Runner 사망, 증적 저장소 접근 실패, 개인정보 마스킹 실패는 전체 실행을 `ABORTED`로 중단한다.
- `PASSED`, `FAILED`, `INCONCLUSIVE`, `SKIPPED`, `CANCELLED`는 case/step verdict이며 execution terminal state와 혼용하지 않는다.

### 11.3 중단과 재실행

- 중단 요청은 현재 도구 동작을 안전하게 종료한 후 적용한다.
- 이미 수집된 증적은 삭제하지 않는다.
- 현재 케이스와 남은 대기 케이스를 `CANCELLED`로 기록한다.
- planning 중인 미commit batch도 abort하고 queue에 붙이지 않는다.
- `미실행 케이스 다시 수행`은 새 `executionId`를 생성한다.
- 실패 케이스 재실행도 새 `executionId`를 생성한다.
- 새 실행 manifest의 `retryOfExecutionId`로 이전 실행을 연결한다.
- 화면에서는 `1차 실패 → 2차 성공`처럼 회차를 비교할 수 있다.

## 12. 증적

### 12.1 캡처 규칙

- 성공한 각 스텝의 사용자 동작이 끝나면 `action-complete.png` 1장을 저장한다.
- 실패한 스텝은 동작 완료 화면 외에 `before-failure.png`, `failure.png`를 추가한다.
- 실패 시 `failure-context.json`에 오류 종류, redacted target reference 또는 assertion, timeout, target·adapter·환경 메타데이터를 저장한다.
- 전체 실행에 trace와 마스킹된 execution log를 저장한다.

### 12.2 판정

| 상태 | 의미 |
| --- | --- |
| PASSED | 기대 결과를 검증함 |
| FAILED | 실제 결과가 기대 결과와 다름 |
| INCONCLUSIVE | 브라우저·device·desktop session·네트워크·캡처 등 환경 문제로 판정할 수 없음 |
| CANCELLED | 사용자 또는 치명적 시스템 오류로 실행이 중단됨 |

### 12.3 불변성과 무결성

- 완료된 execution manifest와 결과를 덮어쓰지 않는다.
- 캡처와 오류 파일의 hash를 manifest에 기록한다.
- 결과 수정이 필요하면 새 실행을 생성한다.
- 자동 삭제하지 않는다.
- 사용자는 execution 단위로만 삭제할 수 있다.
- 삭제 전 시나리오, 파일 수, 총 용량과 재실행 연결 관계를 보여준다.
- 저장 공간 경고는 제공하지만 자동 정리는 하지 않는다.

## 13. 프런트엔드 정보 구조

### 13.1 프로젝트 설정

기존 세 단계 onboarding을 다음 의미로 사용한다.

1. 프로젝트
2. 모델
3. 작업환경 준비

세 번째 화면은 다음 bootstrap 진행 상태를 표시한다.

- 프로젝트 신뢰·범위 확인
- Pi Runtime 연결
- 하네스·스킬·확장 resource 로드
- 프로젝트 분석 세션 생성 또는 복구
- 산출물 저장소와 인덱스 준비

기술 상세는 접을 수 있는 별도 영역에 제공하고 기본 화면은 제품 용어 중심으로 유지한다.

### 13.2 프로젝트 상위 탐색

runtime 준비 후 다음 project navigation을 사용한다.

```text
작업대 / 시나리오 / 테스트 수행 / 증적 보관함
```

- 시나리오가 없으면 시나리오·테스트·증적 탭을 비활성화한다.
- 테스트 실행 중에는 `테스트 수행` 탭에 진행 상태를 표시한다.
- 다른 화면으로 이동해도 Runner는 계속 실행한다.
- 완료·실패·중단 알림은 비차단 방식으로 표시한다.

### 13.3 작업대와 분석 진행

작업대는 다음 상태를 표시한다.

- 프로젝트 경로와 작업 범위
- 연결 model
- Pi Runtime 상태
- 현재 analysis session
- 복구 가능한 작업 유무
- 생성 이력

분석 진행 화면은 LLM chain-of-thought를 표시하지 않는다. 다음 정보만 보여준다.

- 도메인 단계와 검증된 진행률
- 현재 처리 범위
- 완료된 산출물 수
- 사용한 스킬·서브에이전트·도구의 실행 사실 요약
- 오류와 사용자가 취할 수 있는 조치

### 13.4 시나리오 도출 페이지

- 시나리오 시트와 질의 채팅을 함께 유지한다.
- 시나리오 ID drag & drop 또는 명시적 참조 추가를 제공한다.
- Chat Session은 선택 ID를 기준으로 ArtifactQueryService를 호출한다.
- 테스트 센터에서 `시나리오에서 보기`로 이동하면 관련 케이스를 강조한다.
- 질문 자동 제출은 하지 않는다.

### 13.5 테스트 센터

선택한 C안에 따라 프로젝트 독립 상위 화면으로 구성한다.

- 왼쪽: execution 이력
- 중앙: 현재 execution의 순차 케이스 목록
- 오른쪽: 선택 케이스의 증적 미리보기
- 실행 중 상태와 대기열 추가
- 중단, 재실행, 증적 상세, 시나리오에서 보기
- 질문 기능 없음

### 13.6 증적 상세

- 왼쪽: 스텝별 성공·실패·건너뜀 타임라인
- 중앙: 대상 화면 캡처와 스텝별 filmstrip
- 오른쪽: 기대 결과, 실제 결과, 판정 근거, 오류, 환경 정보
- 성공과 실패를 동일 정보 구조로 표시
- 실패 화면에서는 실패 직전·실패 시점 캡처를 우선 노출
- `다시 실행`, `시나리오에서 보기`만 제공
- 질문 기능 없음

### 13.7 라우팅

Electron 정적 파일 환경에서 복구 가능한 hash route를 사용한다.

```text
#/projects/:projectId/setup
#/projects/:projectId/workspace
#/projects/:projectId/runs/:scenarioRunId/scenarios
#/projects/:projectId/tests
#/projects/:projectId/tests/:executionId
#/projects/:projectId/tests/:executionId/cases/:scenarioId/steps/:stepOrder
```

## 14. IPC 및 도메인 이벤트

### 14.1 주요 명령

- `project.selectDirectory`
- `project.bootstrap`
- `project.getState`
- `project.getEventsSince`
- `project.getActivities`
- `model.saveSettings`
- `analysis.start`
- `analysis.resume`
- `analysis.cancel`
- `scenario.load`
- `scenario.ask`
- `test.createExecution`
- `test.enqueueScenarios`
- `test.cancelExecution`
- `test.retryCases`
- `test.listExecutions`
- `evidence.getStep`
- `evidence.deleteExecution`

`scenario.ask`는 시나리오 도출 route에서만 호출한다. Main process는 route를 신뢰하지 않고 프로젝트·run·scenario ID의 관계를 재검증한다.

`test.createExecution`은 활성 execution이 없을 때 새 execution과 최초 batch를 만든다. `test.enqueueScenarios`는 같은 target hash의 새 immutable batch만 active execution 뒤에 추가한다. `test.retryCases`는 기존 execution을 수정하지 않고 `retryOfExecutionId`를 가진 새 execution을 만든다.

### 14.2 주요 이벤트

- `project.bootstrap.started`
- `project.bootstrap.progress`
- `project.bootstrap.ready`
- `project.bootstrap.failed`
- `project.state.changed`
- `runtime.status.changed`
- `runtime.recovery.started`
- `runtime.recovery.completed`
- `runtime.recovery.failed`
- `runtime.session.status.changed`
- `analysis.stage.started`
- `analysis.stage.progress`
- `analysis.work.started`
- `analysis.work.updated`
- `analysis.work.completion-rejected`
- `analysis.work.failed`
- `analysis.activity.recorded`
- `analysis.artifact.status.changed`
- `analysis.artifact.saved`
- `analysis.stage.completed`
- `analysis.stage.failed`
- `analysis.completed`
- `test.execution.requested`
- `test.batch.requested`
- `test.batch.snapshot.created`
- `test.plan.started`
- `test.plan.completed`
- `test.plan.rejected`
- `test.batch.queued`
- `test.execution.created`
- `test.execution.preparing`
- `test.execution.started`
- `test.case.started`
- `test.step.started`
- `test.step.completed`
- `test.step.failed`
- `test.evidence.saved`
- `test.case.completed`
- `test.batch.completed`
- `test.execution.completed`
- `test.execution.cancelled`
- `test.execution.aborted`

모든 이벤트는 5.6의 envelope와 project revision을 포함한다. 이벤트에는 credential, 개인정보 원문, 모델의 숨은 사고 과정, 전체 도구 출력 원문을 포함하지 않는다.

## 15. 오류 처리

### 15.1 오류 범주

| 범주 | 예시 | 사용자 결과 |
| --- | --- | --- |
| 입력 오류 | 잘못된 URL, JSON 형식 | 실행 전 인라인 오류 |
| 프로젝트 오류 | 경로 권한, manifest 손상 | bootstrap 중단 및 복구 안내 |
| 모델 오류 | credential, endpoint, rate limit | 세션 일시 중단 및 설정 이동 |
| 산출물 오류 | schema 불일치, ID 충돌 | 현재 분석 단계 실패 |
| 상태 충돌 | stale revision, 금지된 전이 | 최신 상태 재조회 후 해당 작업 갱신 재시도 |
| 복구 오류 | journal hash 불일치, session·checkpoint 불일치 | 마지막 정상 revision 복원 또는 새 분석 선택 |
| 테스트 실패 | 기대·실제 결과 불일치 | FAILED, 다음 케이스 계속 |
| 케이스 환경 오류 | 페이지 접근 실패, 브라우저 crash | INCONCLUSIVE, 복구 후 다음 케이스 시도 |
| 치명적 실행 오류 | Runner 사망, 증적 저장 실패 | 전체 execution 중단 |
| 보안 오류 | 경로 이탈, 마스킹 실패 | 즉시 차단 및 전체 실행 중단 |

### 15.2 사용자 메시지와 기술 상세

- 기본 화면에는 원인과 사용자가 취할 조치를 짧게 표시한다.
- 기술 상세는 별도 펼침 영역이나 로그 화면에 둔다.
- 재시도 가능한 오류와 설정 변경이 필요한 오류를 구분한다.
- 실패한 원본 기록을 수정하지 않는다.

## 16. 보안

- `contextIsolation: true`, renderer sandbox, `nodeIntegration: false`를 유지한다.
- Renderer가 전달한 프로젝트 경로, run ID, scenario ID, execution ID를 신뢰하지 않는다.
- 모든 경로를 project root 아래로 canonicalize하고 symlink escape를 검사한다.
- Pi의 일반 파일 도구에는 `.scenarioforge/state/` 쓰기 권한을 주지 않고 `WorkStateService`만 상태 변경을 수행한다.
- Pi 기본 도구를 그대로 노출하지 않고 ScenarioForge policy wrapper를 적용한다.
- shell 명령은 command policy와 작업 디렉터리 제한을 적용한다.
- credential 원문을 프로젝트 파일, 세션 파일, 로그, 이벤트, 증적에 기록하지 않는다.
- 테스트 개인정보는 Runner 메모리에서만 사용하고 로그와 증적에 field masking을 적용한다.
- masking이 실패하면 증적 저장과 전체 실행을 중단한다.
- 외부 URL 접근과 다운로드는 별도의 network policy 대상으로 취급한다.
- runtime resource는 앱 번들의 hash와 manifest로 무결성을 검사한다.
- source code, 주석, README, 화면 문자열은 untrusted data로 취급한다. 그 안의 명령문은 system instruction, tool allowlist, read/write scope, completion gate를 변경할 수 없다.
- closure가 원격 author/reviewer endpoint로 전송되기 전에 source secret pattern을 검사하고, 차단 시 해당 work를 실패 처리한다.
- 역할별 endpoint와 source 전송 범위를 사용자에게 표시한다. 서로 다른 author/reviewer endpoint를 쓰면 evidence slice가 두 trust boundary를 통과함을 명시한다.

## 17. ScenarioForge 소스 디렉터리

아래는 목표 workspace 구조다. 현재 저장소의 `src/{main,preload,renderer,shared}` 평면 구조는 UI PoC 상태이며 Phase 1에서 `apps/desktop`으로 이동한다. 마이그레이션 전에는 얇은 IPC adapter 외의 신규 backend를 `src/main` 아래에 누적하지 않고 목표 `packages/*`에 구현한다. 기존 `packages/agent-runtime`은 안내용 placeholder이며 실제 runtime 구현은 `packages/pi-runtime`과 `packages/scenario-pipeline`이 소유한다. 별도 `harness-server` 패키지는 만들지 않고 `apps/desktop/src/main/app`을 composition root로 사용한다.

```text
ScenarioForge/
├── apps/
│   └── desktop/
│       ├── src/
│       │   ├── main/
│       │   │   ├── app/
│       │   │   ├── ipc/
│       │   │   ├── processes/
│       │   │   └── windows/
│       │   ├── preload/
│       │   └── renderer/
│       │       ├── app/
│       │       ├── routes/
│       │       ├── stores/
│       │       ├── features/
│       │       │   ├── project-setup/
│       │       │   ├── workspace/
│       │       │   ├── scenario/
│       │       │   ├── test-center/
│       │       │   └── evidence/
│       │       └── styles/
│       └── electron.vite.config.ts
├── packages/
│   ├── contracts/
│   │   └── src/{ipc,events,state,activities,artifacts,schemas}/
│   ├── runtime-state/
│   │   └── src/{model,reducer,coordinator,journal,projection,recovery}/
│   ├── project-runtime/
│   │   ├── src/{bootstrap,migrations,manifest,path-policy}/
│   │   └── runtime-template/{harnesses,skills/{generation,execution},agents/{generation,execution}}/
│   ├── pi-runtime/
│   │   └── src/{host,models,sessions,resources,tools,event-adapter,security}/
│   ├── scenario-pipeline/
│   │   └── src/{stages,validators,artifacts,indexing}/
│   ├── test-runtime/
│   │   └── src/{coordinator,planning,targets,routing,adapters,queue,runner,assertions,verdict,events,recovery}/
│   └── evidence-store/
│       └── src/{writer,reader,masking,integrity,retention}/
├── docs/
│   ├── architecture/
│   ├── screens/
│   └── superpowers/
│       ├── specs/
│       └── plans/
├── artifacts/
├── package.json
├── package-lock.json
└── tsconfig.json
```

## 18. 선택 프로젝트 디렉터리

```text
selected-project/
└── .scenarioforge/
    ├── manifest.json
    ├── project.json
    ├── runtime/
    │   ├── runtime-manifest.json
    │   ├── AGENTS.md
    │   ├── SYSTEM.md
    │   ├── WORK_PROTOCOL.md
    │   ├── harnesses/
    │   ├── skills/{generation,execution}/
    │   ├── extensions/
    │   └── agents/{generation,execution}/
    ├── sessions/
    │   ├── analysis/
    │   ├── chat/
    │   └── test-planning/
    ├── staging/
    │   └── {workId}/
    ├── state/
    │   ├── project-state.json
    │   ├── WORK_STATE.md
    │   ├── scenario-index.sqlite
    │   ├── journal/
    │   ├── checkpoints/
    │   ├── work-items/
    │   ├── orphans/
    │   ├── evidence-grants/
    │   └── locks/
    ├── runs/
    │   └── {scenarioRunId}/
    │       ├── manifest.json
    │       ├── source/
    │       ├── facts/
    │       ├── wiki/
    │       ├── scenario-set.json
    │       ├── coverage.json
    │       └── tests/
    │           └── {executionId}/
    │               ├── manifest.json
    │               ├── batches/
    │               │   └── {batchId}/
    │               │       ├── scenario-snapshot.json
    │               │       ├── execution-target-profile.json
    │               │       ├── data-binding-manifest.json
    │               │       ├── target-probe.json
    │               │       ├── runner-plan.json
    │               │       └── batch-manifest.json
    │               ├── execution-result.json
    │               ├── cases/
    │               │   └── {scenarioId}/
    │               │       ├── case-result.json
    │               │       └── steps/
    │               │           └── {stepOrder}/
    │               │               ├── step-result.json
    │               │               ├── action-complete.png
    │               │               ├── before-failure.png
    │               │               ├── failure.png
    │               │               └── failure-context.json
    │               ├── execution.log
    │               └── trace.zip
    └── logs/
        ├── bootstrap/
        ├── agent/
        └── system/
```

성공 스텝에는 실패 전용 파일을 생성하지 않는다. 위 트리는 가능한 전체 파일 종류를 나타낸다.

## 19. 구현 순서

하네스·스킬·에이전트 상세 설계를 마지막에 수행하기 위해 다음 순서를 고정한다.

### Phase 1. Workspace와 계약

- npm workspace 구성
- 기존 Electron 코드를 `apps/desktop`으로 이동
- 상태 계층, command, domain event envelope, IPC schema를 포함한 contracts 패키지 구축
- 기존 화면과 테스트가 이동 후에도 동작하는지 검증

### Phase 2. 복구 가능한 Runtime State

- 순수 상태 머신과 불변 조건
- 프로젝트별 single-writer coordinator와 revision compare-and-set
- journal, checkpoint, atomic snapshot 저장
- `WORK_STATE.md` projection과 `WorkStateService`
- domain event 저장 후 publish와 replay
- 비정상 종료 지점별 복구 fixture 검증

### Phase 3. Project Runtime

- ProjectBootstrapper
- manifest와 migration 경계
- 경로·신뢰·권한 정책
- `WORK_PROTOCOL.md`/`WORK_STATE.md` 보호 경로와 runtime version 연결
- 선택 프로젝트 fixture를 이용한 멱등 초기화 검증

### Phase 4. Pi Runtime Host 기반

- Pi SDK를 UtilityProcess에 연결
- model 설정과 credential reference 전달
- session create, restore, abort, dispose
- Resource Bundle interface와 `PiEventAdapter`
- 원시 Pi 이벤트가 Renderer 또는 stage completion으로 직접 전달되지 않는지 검증
- 실제 역할별 resource 대신 schema-valid test fixture 사용

### Phase 5. Analysis, Query, Planning Domains

- generation 4종, scenario query 1종, execution planning 1종의 immutable `WorkDescriptor`와 domain별 policy
- 단계 상태 머신
- session `settled`와 stage `completed`를 분리한 completion gate
- stage manifest와 artifact schema·ID 관계 validator
- ID 인덱스와 query service
- `workId`/child work 상태 및 stale revision 거절
- 공통 상태 정보 ADD/UPDATE/TOMBSTONE와 ownership 검사
- fake Pi adapter로 전체 분석 흐름 검증

### Phase 6. 프런트 보정

- route와 project navigation
- bootstrap 화면
- `ProjectStore`, `AnalysisExecutionStore`, `ActivityStore`, `TestExecutionStore`
- snapshot hydration, revision gap replay, duplicate event 무시
- 타이머 목업 제거
- 영속 도메인 이벤트 기반 runtime·session·stage·artifact·복구 UI
- 활동 패널과 주 화면 전환의 분리
- 시나리오 페이지 질의 경계 유지

### Phase 7. 테스트 및 증적

- create/enqueue/cancel/retry command handler와 immutable `ExecutionBatch`
- ScenarioSnapshot, ExecutionTargetProfile, DataBindingSet, Preflight/Probe, capability registry, deterministic segment compiler와 validator
- TestCoordinator와 순차 queue
- TestVista execution kernel과 web/UIA/mobile/CUA adapter contract
- verdict와 error taxonomy
- screenshot, trace, log, masking, hash
- 테스트 센터와 증적 상세 화면

### Phase 8. 하네스·스킬·에이전트 구현

- 상세 계약은 `docs/pi-coding-agent 하네스 설계.md`, `docs/architecture/03-integrated-harness-server-design.md`, `docs/architecture/04-test-execution-harness-design.md`로 확정
- `WORK_PROTOCOL.md` 실제 파일과 역할별 시작·갱신·완료 규칙 구현
- 최상위 router와 generation/execution-planning resource subtree 분리
- author/reviewer model binding과 assurance 기록 구현
- scan/closure/evidence grant, bounded artifact query, staging 제출 도구 구현
- 스킬, 역할 resource, 모델별 few-shot 작성
- FACT/WIKI/SCENARIO independent semantic verdict와 backend completion gate 연결
- `test-plan-binding`, `test-plan-review` skill과 `test-planner`, `test-plan-reviewer` resource 작성
- Resource Bundle version manifest와 hash 생성

### Phase 9. 실제 Pi 통합 E2E

- 실제 프로젝트 fixture 분석
- 앱 재시작 후 session 복구
- 시나리오 질의
- 순차 테스트와 증적 저장
- 보안·마스킹·경로 이탈 검증

## 20. 검증 전략

### 20.1 단위 테스트

- schema validators
- canonical path와 symlink escape
- runtime manifest migration
- 각 상태 계층의 reducer와 허용·금지 전이
- stale `expectedRevision` 거절
- context 조회 없는 `begin` 거절과 child context 격리
- work owner 밖의 UPDATE·DELETE 거절
- persisted artifact hard delete 거절과 draft tombstone
- `WORK_STATE.md` projection 결정성·민감정보 제외
- domain event reducer와 revision 계산
- Pi raw event adapter 정규화
- analysis stage completion gates
- scenario ID 관계 조회
- create/enqueue/retry의 immutable batch와 target hash 일치 검증
- planning state와 execution state의 금지 전이
- queue와 cancel/retry 정책
- verdict 분류
- masking과 evidence hash

### 20.2 통합 테스트

- 동일 프로젝트 bootstrap의 멱등성
- runtime upgrade와 rollback
- UtilityProcess session lifecycle
- Pi 이벤트가 session/activity 후보로만 변환되고 UI로 직접 전달되지 않음
- analysis/Q&A/test-planning session의 읽기·쓰기 범위 격리
- generation resource와 execution planning resource의 동시 노출 금지
- deterministic-only plan에서 Pi planning session 미생성
- child 결과가 parent integration 전 stage 상태를 변경하지 않음
- 동일 operation 재전송 시 idempotency 보장
- 상태·checkpoint·revision 저장 전에 event가 발행되지 않음
- 중복 event 무시, revision gap replay, snapshot 재동기화
- commit 각 단계에서 강제 종료한 뒤 마지막 정상 revision 복구
- 이전 `running` 상태를 `recovering`으로 전이한 뒤 재개 가능성 판정
- `WORK_STATE.md` 손상·누락 시 canonical state에서 재생성
- 앱 재시작 후 analysis session 복구
- 테스트 실패 후 다음 케이스 계속
- 실행 중 enqueue가 기존 batch hash를 변경하지 않음
- planning 거절이 기존 queue와 Runner에 영향을 주지 않음
- Runner crash 후 `INCONCLUSIVE` 또는 전체 중단 분류
- 증적 저장 실패 시 fail-closed

### 20.3 UI 테스트

- 프로젝트·모델·runtime 준비 흐름
- project/runtime/session/stage/artifact 조합별 화면 판정
- 복구 중 화면에서 검증 전 `running` 화면으로 이동하지 않음
- tool·skill·subagent activity가 주 route를 바꾸지 않음
- revision gap 중 stale 상태를 완료로 렌더링하지 않음
- 준비 전 상위 탭 비활성화
- 분석 진행 중 자유로운 화면 전환
- Q&A가 시나리오 화면에만 존재
- 활성 execution 유무에 따른 create/enqueue CTA 전환
- planning 거절 시 입력과 선택 유지
- 실행 중 테스트 탭 상태 유지
- 성공·실패 증적 전환
- 재실행 이력 비교
- 중단 후 잔여 케이스 상태

### 20.4 E2E 성공 기준

1. 사용자가 프로젝트와 LLM을 설정하면 해당 model로 Pi session이 생성된다.
2. `.scenarioforge/` 초기화가 소스 파일을 변경하지 않는다.
3. 분석 산출물은 schema와 ID 관계 검증을 통과해야만 UI에 완료로 표시된다.
4. Pi의 `agent_end` 또는 완료 텍스트만으로 분석 stage가 완료되지 않는다.
5. 각 LLM 작업은 동일 protocol version과 최신 `WORK_STATE.md` revision을 확인하고 상태 변경을 요청한다.
6. domain event는 상태와 checkpoint의 revision commit 이후에만 Renderer로 전달된다.
7. 앱을 재시작하면 active 상태는 먼저 `recovering`으로 표시되고 검증 후에만 재개된다.
8. 완료 산출물과 복구 가능한 session을 앱 재시작 후 확인할 수 있다.
9. 질의는 시나리오 페이지에서만 실행되고 ID 관련 산출물을 조회한다.
10. 테스트는 선택 순서대로 실행된다.
11. 각 성공 스텝과 실패 추가 캡처가 규칙대로 저장된다.
12. 실패, 판정 불가, 중단됨이 구분된다.
13. 재실행이 기존 증적을 덮어쓰지 않는다.
14. credential과 개인정보 원문이 프로젝트 파일, 공통 상태 문서, 이벤트, 증적에 남지 않는다.
15. 생성 완료만으로 test planning session이나 Runner가 시작되지 않는다.
16. 실행 중 추가는 기존 snapshot/plan hash를 바꾸지 않고 새 immutable batch를 append한다.

## 21. 공식 기술 참고

- [Pi SDK](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md)
- [Pi Extensions](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md)
- [Pi Skills](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/skills.md)
- [Pi Agent Harness 보안 및 격리](https://github.com/earendil-works/pi)
- [LangGraph Workflows and Agents](https://docs.langchain.com/oss/python/langgraph/workflows-agents)
- [LangGraph Persistence](https://docs.langchain.com/oss/python/langgraph/persistence)
