# ScenarioForge Agent 상세 설계 및 개발 환경

- 작성일: 2026-08-26
- 대상 브랜치: `dev`
- 문서 구분: **설계 문서 (1/2)**
- 후속 문서: [ScenarioForge PoC 모듈 구현 계획](02-poc-implementation-plan.md)
- 상위 설계: `docs/superpowers/specs/2026-08-25-scenarioforge-pi-runtime-test-execution-design.md`
- 생성 하네스 상세: `docs/pi-coding-agent 하네스 설계.md`
- 생성·수행 handoff: `docs/architecture/03-integrated-harness-server-design.md`
- 수행 하네스 상세: `docs/architecture/04-test-execution-harness-design.md`
- 구현 계획: `docs/superpowers/plans/2026-08-25-pi-runtime-llm-workflows.md`, `docs/superpowers/plans/2026-08-25-state-driven-test-center-ui.md`, `docs/plans/2026-08-26-001-feat-test-execution-harness.md`

## 0. 시스템 개요 — 이 Agent가 푸는 문제

ScenarioForge는 **로컬 소스 코드를 읽어 "검증 가능한 사용자 시나리오"를 만들고, 그 시나리오를 실제 브라우저 테스트와 증적(evidence)으로 연결하는 설치형 데스크톱 애플리케이션**이다.

```text
로컬 프로젝트 디렉터리 선택
  → 사용자 소유 LLM 연결 (provider / endpoint / model / API key)
  → Pi Agent Runtime이 SRC → FACT → WIKI → SCENARIO 정보 셋 생성
  → 시나리오 ID 기준 질의응답
  → 선택 시나리오 순차 테스트 수행 (TestVista Execution Kernel + 대상별 adapter)
  → 스텝별 화면·오류 증적 보관
```

일반적인 "코드 설명 챗봇"과 다른 점은 다음 세 가지이며, 이 문서의 모든 설계 결정이 여기서 파생된다.

| 특성 | 의미 | 설계 귀결 |
| --- | --- | --- |
| **산출물이 곧 계약** | 결과는 자연어 답변이 아니라 스키마가 고정된 ID 그래프(`SCN-ORD-001` 등) | LLM 응답을 파싱하지 않고 **파일 제출 + validator**로 받는다 |
| **완료는 backend가 판정** | 모델이 "완료했습니다"라고 말해도 단계는 끝나지 않는다 | `agent_end` ≠ stage completed. **Completion Gate** 분리 |
| **로컬 우선·복구 가능** | 사용자 소스가 외부로 나가지 않고, 앱이 죽어도 이어서 작업 | 클라우드 추적 SaaS 미사용, journal + checkpoint + revision |

---
---

## 1. Agent 페르소나 및 시스템 프롬프트 (Identity)

### 1.1 루트 Agent 정체성

| 항목 | 정의 내용 |
| --- | --- |
| **Agent 이름** | **ScenarioForge Analyst** (내부 호출명 `scenarioforge-analyst`). Pi 하네스의 루트 에이전트이며, 사용자에게는 "분석 에이전트"로만 노출한다. 결정론적 source scanner를 사용하고, LLM 작업은 `fact-analyst`, `edge-linker`, `wiki-writer`, `scenario-designer` author 역할과 stage별 reviewer 역할로 분리한다. |
| **주요 역할** | ① 선택된 로컬 프로젝트의 소스 구조를 식별하고(`SRC`) ② 코드에서 확인 가능한 사실을 원천 위치와 함께 추출하고(`FACT`) ③ 업무·기술 설명 문서를 구성하고(`WIKI`) ④ 사전 조건·스텝·기대 결과를 갖춘 사용자 시나리오를 설계한다(`SCENARIO`). 부가로 ⑤ 시나리오 ID 기반 질의에 근거를 붙여 답하고 ⑥ 테스트 계획 초안을 구조화 스키마로 제출한다. |
| **핵심 목표** | **"코드에서 실제로 확인된 사실만으로, 사람이 그대로 수행할 수 있고 기계가 그대로 실행할 수 있는 사용자 시나리오를 만든다."** 모든 시나리오 문장은 `factId → sourceId`로 역추적 가능해야 하며, 근거를 붙일 수 없는 문장은 산출물에 넣지 않는다. |
| **톤앤매너** | 한국어. 사실 기반의 평서형 단문. 추정과 확인을 반드시 구분하고("확인됨" / "코드에서 확인되지 않음"), 불확실하면 추측 대신 **미확인으로 보고**한다. 사용자에게 노출되는 활동 요약은 내부 용어(tool, token, chunk)가 아니라 제품 용어(모듈 분석, 사실 추출)로 쓴다. 사과·과장·감탄사·이모지를 쓰지 않는다. |
| **제약 사항** | ① canonical state(`project-state.json`, `WORK_STATE.md`, journal, checkpoint)를 파일 도구로 **직접 수정 금지** ② **스스로 완료를 선언 금지** — `work.requestCompletion`만 호출 ③ 배정된 `staging/{workId}/` 밖 쓰기 금지 ④ 다른 단계의 최종 산출물 수정 금지 ⑤ 근거 ID 없는 서술 생성 금지 ⑥ API key·테스트용 개인정보 원문을 응답·로그·활동 요약에 출력 금지 ⑦ 내부 사고 과정(chain-of-thought) 노출 금지 ⑧ 테스트 실행 중 계획 변경 금지 ⑨ 시나리오 도출 화면 외의 경로에서 질의응답 금지 |

### 1.2 실제 System Prompt 골격

Resource Bundle(`.scenarioforge/runtime/`)에 버전·해시와 함께 설치되며, LLM은 읽기만 가능하다.

```md
# SYSTEM.md — ScenarioForge Analyst

당신은 ScenarioForge Analyst입니다. 사용자가 선택한 로컬 프로젝트를 분석해
검증 가능한 사용자 시나리오 정보 셋을 만듭니다.

## 절대 규칙
1. 모든 작업은 `work.getContext` → `work.begin`으로 시작합니다.
   컨텍스트를 읽지 않고 시작한 작업은 backend가 거절합니다.
2. 저장소나 산출물에 대해 주장하기 전에 반드시 조회 도구로 확인합니다.
   확인하지 못한 내용은 "코드에서 확인되지 않음"으로 보고합니다.
3. 쓰기는 배정된 `staging/{workId}/` 안에서만 수행합니다.
   `.scenarioforge/state/` 이하는 읽기 전용입니다.
4. 결과는 `work.submitArtifacts`로 제출하고 `work.requestCompletion`으로
   완료를 "요청"합니다. 자연어로 완료를 선언해도 단계는 완료되지 않습니다.
5. 완료 요청이 거절되면 반환된 미충족 조건(unmetGates)을 해결하고 다시 요청합니다.
6. API key와 테스트용 개인정보의 원문을 어떤 출력에도 포함하지 않습니다.

## 작업 시작 전 필독
- `WORK_PROTOCOL.md` : 변경 불가한 작업 규격
- `WORK_STATE.md`   : 현재 상태의 읽기 전용 projection (revision 포함)

## 산출물 원칙
- 모든 항목은 ID를 가집니다. (`SRC-*`, `FCT-*`, `WIKI-*`, `SCN-{업무코드}-{3자리}`)
- 모든 FACT는 sourceId와 근거 위치(파일·라인)를 가집니다.
- 모든 WIKI 문장은 하나 이상의 factId에 연결됩니다.
- 모든 SCENARIO는 precondition / steps(order, action, expected) / expected result와
  관련 wiki·fact·source ID를 가집니다.
```

### 1.3 작업 executor와 역할

| executor / 역할 | 담당 work | 핵심 목표 | 고유 제약 |
| --- | --- | --- | --- |
| deterministic source scanner | `analysis.source-map` | snapshot, 파일·언어·모듈·의존·route inventory를 ID로 확정 | include/exclude 정책 밖 경로 접근 금지, 동적 등록은 unresolved |
| `fact-analyst` (author) | `analysis.fact-extract` | 화면·요소·API·술어·first-class 전이와 snapshot/hash evidence 추출 | 배정 evidence grant 밖 추론 금지 |
| `edge-linker` (author) | FACT link 보조 work | 자동 연결이 못 푼 전이 후보 한 건 판정 | 후보 밖 ID 생성 금지 |
| `wiki-writer` (author) | `analysis.wiki-compose` | workflow, terminal, variation/combination 구성 | source 도구 미장착, 모든 문장에 fact cite 필요 |
| `scenario-designer` (author) | `analysis.scenario-compose` | bounded walk 결과를 `SCN-*` 시나리오로 서술 | 모든 step에 action/assertion reference 필요 |
| stage reviewer | FACT/WIKI/SCENARIO semantic review | evidence가 주장을 실제 지지하는지 독립 verdict 제출 | canonical status 수정 금지, completion 선언 금지 |

Pi 작업자는 부모의 `contextToken`을 재사용하지 않고 **자체 `workId`와 자체 context**를 조회한다. 결과는 부모 상태를 직접 바꾸지 못하고 parent integration gate를 통과해야 한다. reviewer verdict도 최종 gate가 아니며 `RuntimeStateCoordinator`가 schema·관계·coverage와 함께 확인한 뒤에만 status를 commit한다.

---

## 2. 워크플로우 및 오케스트레이션 (Workflow & Logic)

### 2.1 처리 로직

#### Step 1 — Input Analysis (의도 파악)

이 시스템은 **사용자 자연어를 LLM이 분류해 라우팅하지 않는다.** 라우팅 오류가 곧 잘못된 파일 쓰기로 이어지기 때문에, 외부 단계는 backend가 결정론적으로 고정한다.

```text
BOOTSTRAP → SRC → FACT → WIKI → SCENARIO → READY
```

- `AnalysisCoordinator`가 현재 stage와 persisted artifact를 보고 **immutable `WorkDescriptor`** 를 만든다. 이 descriptor가 `workKind`, executor, 입력 ID 목록, 읽기 scope, 쓰기 scope, 완료 gate를 확정한다.
- executor가 LLM이면 모델은 "무엇을 할지"가 아니라 **"주어진 범위 안에서 어떻게 할지"** 만 판단한다. scan/link/walk/coverage처럼 결정론적 work는 backend가 실행한다.
- 유일하게 LLM이 의도를 해석하는 지점은 `scenario.answer`(시나리오 질의)다. 이때도 답변 대상은 사용자가 drag & drop으로 지정한 `scenarioIds[]`로 제한되며, Main process가 route를 신뢰하지 않고 `projectId · runId · scenarioId` 관계를 재검증한다.
- 작업 시작 조건: `work.getContext`가 발급한 **일회성 `contextToken`** 없이는 `work.begin`이 거절된다. 즉 어떤 작업도 최신 프로토콜·상태를 읽지 않고 시작할 수 없다.

#### Step 2 — Tool Selection (도구 선택 및 분기)

도구는 3계층으로 분리하고, `FunctionPolicy`가 기능별 allowlist를 강제한다. 모델의 선택 실수는 정책 계층에서 차단된다.

```text
[L1] 상태 계약 도구  work.*        — 상태 변경 "요청" 전용, 유일한 쓰기 경로
[L2] 산출물 조회 도구 artifact.*   — ID 기반 결정론적 조회, 관계 해석의 단일 원본
[L3] 탐색 도구       project.*     — 경로 정책으로 감싼 read/grep/list (Pi 기본 도구 wrapper)
```

분기 기준:

| 판단 | 선택 | 근거 |
| --- | --- | --- |
| 상태·진행·완료를 바꾸려 함 | `work.*` | 파일 직접 수정은 정책이 거부 |
| 이미 저장된 산출물의 관계를 알아야 함 | `artifact.*` | 경로·파일명 추론 금지 원칙 |
| 아직 산출물이 없는 원천 코드를 봐야 함 | `project.*` | `SRC`/`FACT` 단계에서만 넓게 허용 |
| 작업량이 커서 분할이 필요함 | `work.requestChild` | module 또는 ID batch 단위, 기능별 허용 여부 상이 |
| 실패했음 | `work.reportFailure` | 조용한 실패·부분 제출 금지 |

정책 위반 시도(예: `wiki-compose`가 `SRC` 원본을 직접 읽으려 함)는 tool 호출 단계에서 거절되고 구조화 오류로 기록된다. 자동 재시도 대상은 provider timeout / rate limit / 일시적 network 오류 **3종뿐**이며 최대 2회(1초, 3초 대기)다. schema·권한·경로 이탈·ID 충돌은 재시도하지 않고 즉시 `failed`로 기록한다.

#### Step 3 — Execution & Response (결과 통합 및 최종 응답)

**LLM의 텍스트 응답은 최종 응답이 아니다.** 최종 응답은 검증을 통과해 저장된 파일과, 그로 인해 발행된 도메인 이벤트다.

```text
staging/{workId}/ 에 결과 작성
  → work.submitArtifacts(contentHash, relatedIds)
  → root/child work tree 전부 settled 확인
  → work.requestCompletion
  → [Completion Gate]
       ├ schema 검증
       ├ 필수 ID · 원천 참조 관계 존재 검증
       ├ staging → 최종 경로 원자적 저장
       ├ 관계 index 반영 검증
       ├ stage manifest 갱신
       ├ journal + checkpoint에 새 revision 확정
       └ 동일 revision의 domain event를 commit record에 포함
  → 통과 시에만 stage = completed
  → typed IPC event 발행 → Renderer 화면 전환
```

Gate가 거절하면 `CompletionDecision.unmetGates`가 `WORK_STATE.md`에 반영되고, 같은 작업이 이어서 보완한다. Renderer는 이벤트 수신 또는 snapshot 동기화 전에는 완료 화면으로 전환하지 않는다.

### 2.2 상태 관리

#### (a) 대화 턴(Turn) 관리 단위

"매 작업마다 확인하고 갱신"의 단위는 모델 토큰이나 자연어 메시지가 아니라 **`workId`** 다. 하나의 논리 작업 = 하나의 `workId` = 하나의 staging 경로 = 하나의 activity stream.

```ts
type ProjectRuntimeState = {
  schemaVersion: number;
  projectId?: string;
  revision: number;                 // 모든 변경의 단조 증가 버전
  projectStatus: ProjectLifecycleStatus; // unselected | configuring | ready | error
  runtimeStatus: RuntimeStatus;     // unconfigured | preparing | ready | recovering | stopped | error
  sessionStatus: AgentWorkStatus;   // creating | idle | running | retrying | compacting
                                    // | cancelling | settled | recovering | failed
  sessionId?: string;
  analysisRunId?: string;
  activeStage?: AnalysisStage;      // src | fact | wiki | scenario
  stages: Record<AnalysisStage, AnalysisStageStatus>;
  artifactStatus: Record<AnalysisStage, ArtifactStatus>;
  progress: number;                 // 검증된 산출물 기준. token/tool 호출 수로 계산하지 않음
  currentActivity?: string;
  recoverable: boolean;
  lastCheckpointId?: string;
  lastError?: { category: string; message: string };
};
```

6개 상태 계층이 각각 독립 상태 머신을 갖고, 화면은 여러 계층을 **조합**해 결정한다.

| 계층 | 대표 상태 | 화면 책임 |
| --- | --- | --- |
| 프로젝트 | `unselected` → `configuring` → `ready` / `error` | 프로젝트 선택·설정 |
| Pi Runtime | `unconfigured` → `preparing` → `ready` / `recovering` / `stopped` / `error` | 작업환경 준비·복구 |
| LLM 세션 | `creating` / `idle` / `running` / `retrying` / `compacting` / `cancelling` / `settled` / `recovering` / `failed` | 세션 상태 표시 |
| 분석 파이프라인 | stage별 `pending → running → validating → completed / failed` | 진행률 |
| 작업 활동 | `queued → running → succeeded / failed / cancelled` | **활동 패널만 갱신** (route 전환 금지) |
| 산출물 | `absent → generating → validating → verified → persisted` / `invalid` | 다음 단계 활성화 |

핵심 불변식: **`session.settled ≠ stage.completed`**. `settled`는 "현재 Pi turn이 더 이상 이벤트를 만들지 않음"만 뜻한다.

#### (b) 상태 커밋 규칙

`RuntimeStateCoordinator`는 프로젝트별 **single-writer queue**를 소유한다.

```text
1. 현재 snapshot과 expectedRevision 비교 (compare-and-set)
2. 순수 reducer로 다음 상태 + 단일 domain event 계산
3. journal / checkpoint를 임시 경로에 기록하고 검증
4. revision +1 commit record 원자적 확정
5. project-state.json 스냅샷과 WORK_STATE.md projection 갱신
6. 저장된 domain event를 typed IPC로 발행
```

- 하나의 commit = 하나의 revision = 하나의 domain event.
- 이벤트를 **먼저 저장하고 나중에 발행**하므로, 앱이 죽어도 재시작 후 revision 기준 replay가 가능하다.
- Renderer는 revision이 +1이면 적용, 같거나 작으면 무시, 2 이상 벌어지면 `project.getEventsSince`로 누락분을 요청한다.

#### (c) LangGraph Node/Edge 흐름 — 미도입 결정과 등가 매핑

**LangGraph는 도입하지 않는다.** Pi가 이미 agent loop, session, resource loading, tool execution, compaction, event streaming을 담당하므로, LangGraph를 함께 쓰면 *Pi 세션*과 *그래프 checkpoint*라는 실행 상태 원본이 두 개가 된다. 대신 동일한 제어 이점을 다음 자체 계층으로 확보한다.

| LangGraph 개념 | ScenarioForge 등가물 | 위치 |
| --- | --- | --- |
| `StateGraph` state schema | `ProjectRuntimeState` + reducer | `packages/runtime-state/src/model`, `reducer` |
| Node | `WorkDescriptor` (`HarnessWorkKind` 단위) | `packages/scenario-pipeline/src/stages` |
| Conditional Edge | **Completion Gate** 판정 결과 | `scenario-pipeline/src/validators` |
| Checkpointer | journal + checkpoint + revision commit | `runtime-state/src/journal`, `recovery` |
| `interrupt()` | `CompletionDecision.accepted=false` + `unmetGates` | `WorkStateService` |
| Subgraph | `work.requestChild` → child `workId` + parent integration gate | `pi-runtime/src/host` |
| Stream event | `PiEventAdapter` → domain command candidate → persisted domain event | `pi-runtime/src/event-adapter` |

고정 그래프 흐름은 다음과 같다.

```text
        ┌──────────────┐
        │  BOOTSTRAP   │
        └──────┬───────┘
               ▼
   ┌───────────────────────┐   gate reject (unmetGates)
   │  SRC  source-map      │◀──────────────┐
   └──────┬────────────────┘               │
          │ gate pass                      │
          ▼                                │
   ┌───────────────────────┐               │
   │  FACT fact-extract    │───────────────┤
   └──────┬────────────────┘               │
          ▼                                │
   ┌───────────────────────┐               │
   │  WIKI wiki-compose    │───────────────┤
   └──────┬────────────────┘               │
          ▼                                │
   ┌───────────────────────┐               │
   │ SCENARIO scenario-    │───────────────┘
   │          compose      │
   └──────┬────────────────┘
          ▼
   ┌───────────────────────┐
   │        READY          │──▶ scenario.answer (chat session, 상태 변경 없음)
   └──────┬────────────────┘
          ▼
   명시적 test command only
          ▼
   ┌───────────────────────┐
   │ compiler → test.plan? │  (수행 전용 planning session · immutable batch)
   │        → TestVista    │  (agent가 아닌 검증된 adapter 실행 커널)
   └───────────────────────┘
```

허용 전이는 `src.completed → fact`, `fact.completed → wiki`, `wiki.completed → scenario`뿐이다. 그 외 전이는 state invariant 오류로 거절되며 revision도 UI 이벤트도 만들지 않는다.

LangGraph는 다음 요구가 **실제로 발생하면** 재검토한다: 노드 단위 exact-resume, 장시간 사용자 승인 interrupt, 분산 작업자와 중앙 checkpoint, 보상 트랜잭션, 여러 프로세스가 공유하는 durable graph state.

---

## 3. 도구(Tools) 및 함수 명세 (Capability)

### 3.1 L1 — 상태 계약 도구 (`WorkStateService` → Pi tool)

`operationId`는 backend 상태 계약에는 존재하지만 Pi 모델이 생성하지 않는다. Pi adapter는 이 필드를 모델 tool schema에서 숨기고 `project/session/work/tool + provider toolCallId`로 서버 소유 idempotency key를 만든다. 아래 입력 표의 `operationId`는 신뢰된 비-Pi 호출자와 내부 service contract에 해당한다.

| 도구명 (Function Name) | 기능 설명 (Description) | 입력 파라미터 (Input Schema) | 출력 데이터 (Output) |
| --- | --- | --- | --- |
| `work.getContext` | 작업 시작 전 필수. `WORK_PROTOCOL.md`/`WORK_STATE.md` 본문, 현재 revision, 필수 입력 ID, 허용된 다음 행동을 받고 일회성 `contextToken`을 발급받는다. 유일하게 revision을 증가시키지 않는 도구. | `projectId: string`<br>`workId: string` | `WorkContext { revision, protocolVersion, protocolHash, protocolMarkdown, stateHash, stateMarkdown, requiredInputIds[], allowedNextActions[], contextToken }` |
| `work.begin` | 작업 시작을 상태에 기록한다. `contextToken`이 없거나 오래됐으면 거절된다. | `projectId`, `workId`, `operationId: string`, `expectedRevision: number`, `contextToken: string` | `StateCommit { previousRevision, revision, eventId, workStateHash }` |
| `work.requestChild` | 하위 작업을 backend에 요청한다. 부모가 직접 child를 생성하거나 child 상태를 쓰지 못한다. | `parentWorkId`, `operationId`, `expectedRevision`, `descriptor: { functionId, inputIds[], objective, readScopes[], writeScope }` | `StateCommit` (신규 child `workId` 포함) |
| `work.updateProgress` | 현재 처리 범위와 생성한 ID를 갱신한다. allowlist 필드만 compare-and-set. | `workId`, `operationId`, `expectedRevision`, `progress: { currentActivity: string, producedIds: string[] }` | `StateCommit` |
| `work.recordActivity` | tool·skill·subagent·validator 실행 중 **검증 가능한 사실**만 append한다. 사고 과정과 raw tool output은 넣지 않는다. | `workId`, `operationId`, `expectedRevision`, `activity: { activityId, kind: "tool"\|"skill"\|"subagent"\|"validator", name, targetIds[], status, startedAt, finishedAt?, summary? }` | `StateCommit` |
| `work.submitArtifacts` | staging 결과를 검증 대상으로 제출한다. 저장 위치를 직접 지정하지 못한다. | `workId`, `operationId`, `expectedRevision`, `artifacts: Array<{ artifactId, artifactType: AnalysisStage, stagingPath, relatedIds[], contentHash, supersedesArtifactId? }>` | `StateCommit` |
| `work.discardDraft` | **미제출** staging draft만 폐기한다. persisted artifact는 hard delete 불가. | `workId`, `operationId`, `expectedRevision`, `artifactId`, `reason: string` | `StateCommit` (tombstone revision) |
| `work.reportFailure` | 실패 원인을 구조화해 기록한다. 조용한 실패·부분 제출을 금지한다. | `workId`, `operationId`, `expectedRevision`, `error: { category, message, recoverable: boolean, activityId? }` | `StateCommit` |
| `work.requestCompletion` | 완료를 **요청**한다. 승인 권한은 backend gate에만 있다. | `workId`, `operationId`, `expectedRevision` | `CompletionDecision` = `{ accepted: true, commit }` \| `{ accepted: false, revision, unmetGates: string[], context: WorkContext }` |

### 3.2 L2 — 산출물 조회 도구 (`ArtifactQueryService`)

Pi 도구와 Renderer 읽기 API가 **같은 query service**를 사용해 관계 해석 차이를 원천 차단한다.

| 도구명 | 기능 설명 | 입력 파라미터 | 출력 데이터 |
| --- | --- | --- | --- |
| `artifact.scenario.getById` | 시나리오 단건 조회 | `scenarioId: string` | `ScenarioCase { id, title, summary, precondition, source, steps[] }` |
| `artifact.source.listByScenarioId` | 시나리오의 원천 소스 목록 | `scenarioId: string` | `SourceRef[] { sourceId, path, language, moduleId }` |
| `artifact.fact.listByScenarioId` | 시나리오 근거 사실 목록 | `scenarioId: string` | `Fact[] { factId, statement, sourceId, location }` |
| `artifact.wiki.listByScenarioId` | 시나리오 관련 위키 목록 | `scenarioId: string` | `WikiRef[] { wikiId, title, factIds[] }` |
| `artifact.execution.listByScenarioId` | 시나리오의 테스트 실행 이력 | `scenarioId: string` | `TestExecution[]` |
| `artifact.evidence.listByScenarioId` | 시나리오의 증적 목록 | `scenarioId: string` | `StepEvidence[]` |

> `ArtifactQueryService`는 canonical revision 이하이고 commit record의 artifact hash와 일치하는 row만 노출한다. index만 기록되고 state commit 전에 종료된 row는 보이지 않으며 recovery가 제거한다.

### 3.3 L3 — 탐색 도구 (Pi 기본 도구의 정책 wrapper)

| 도구명 | 기능 설명 | 입력 파라미터 | 출력 데이터 |
| --- | --- | --- | --- |
| `project.listFiles` | include/exclude 정책 안에서 파일 목록 조회 | `relativePath: string`, `depth?: number` | `FileEntry[] { path, size, language? }` |
| `project.readFile` | 프로젝트 범위 안 파일 읽기. `.scenarioforge/state/` 쓰기는 항상 거부 | `relativePath: string`, `range?: { start, end }` | `{ path, content, truncated: boolean }` |
| `project.grep` | 정규식 검색 (결과 수·크기 제한) | `pattern: string`, `include?: string` | `Match[] { path, line, preview }` |
| `staging.write` | 배정된 `staging/{workId}/` 안에만 쓰기 | `workId`, `relativePath`, `content` | `{ path, contentHash }` |

### 3.4 도구 권한 매트릭스

| work kind | L1 | L2 조회 범위 | L3 탐색 | child 위임 | 쓰기 scope |
| --- | --- | --- | --- | --- | --- |
| `analysis.source-map` | backend commit만 | — | scanner가 전체(정책 내) | 동적 등록 보조 work만 | `staging/{workId}/source/` |
| `analysis.fact-extract` | 전체 | source | 배정 source만 | ID batch | `staging/{workId}/facts/*.json` |
| `analysis.wiki-compose` | 전체 | source, fact | **금지** | ID batch | `staging/{workId}/wiki/*.md` + relation JSON |
| `analysis.scenario-compose` | 전체 | source, fact, wiki | **금지** | ID batch | `staging/{workId}/scenario-set.json` |
| `scenario.answer` | 전체 | 선택 scenario 관계 전체 | **금지** | **금지** | conversation log append only |
| `test.plan` | 배정 work 상태만 | immutable batch snapshot, target contract, redacted probe slice | **금지** | scenario 단위 | `staging/{workId}/runner-plan-patch.json` 또는 review verdict |

---

## 4. 지식 베이스 및 메모리 전략 (Context & Memory)

### 4.1 RAG (검색 증강 생성) 전략

> **핵심 결정: 벡터 유사도 검색이 아니라 ID 기반 구조적 검색(Structured Retrieval)을 1차 경로로 사용한다.**
> 이 제품의 실패 모드는 "관련 문서를 못 찾는 것"이 아니라 **"근거 없는 시나리오를 만드는 것"** 이다. 유사도 top-k는 근거의 존재를 보장하지 못하지만, `scenarioId → wikiIds → factIds → sourceIds` 관계 조회는 근거 부재를 **검증 실패로 만든다**. 따라서 벡터 검색은 보조 경로로만 둔다.

| 항목 | 정의 내용 |
| --- | --- |
| **참조 데이터 소스** | ① 사용자가 선택한 로컬 프로젝트 소스 트리 (include/exclude 정책 적용)<br>② `.scenarioforge/runs/{runId}/` 산출물 — `facts/`, `wiki/`, `scenario-set.json`<br>③ `.scenarioforge/runtime/WORK_PROTOCOL.md` — 변경 불가 작업 규격 (Resource Bundle 소유)<br>④ `.scenarioforge/state/WORK_STATE.md` — canonical state의 읽기 전용 Markdown projection<br>⑤ `.scenarioforge/state/scenario-index.sqlite` — ID 관계 인덱스<br>⑥ 테스트 실행 결과 `runs/{runId}/tests/{executionId}/` manifest와 증적 |
| **청킹(Chunking) 방식** | 문자 수 기반 재귀 분할(`RecursiveCharacterTextSplitter`)을 **사용하지 않는다.** 코드와 산출물은 의미 경계가 이미 존재하므로 다음 규칙을 쓴다.<br>· **SRC**: 1 파일 = 1 unit. 대형 파일은 tree-sitter 심볼(함수/클래스/모듈) 경계로 분할하고 상위 파일 ID를 부모로 유지<br>· **FACT**: 1 fact = 1 chunk (원자 단위). `{ factId, statement, sourceId, location }` 고정 스키마<br>· **WIKI**: heading 단위 (H2/H3) 분할, 각 chunk에 `factIds[]` 부착<br>· **SCENARIO**: 1 시나리오 = 1 chunk, 스텝은 분할하지 않음<br>· 컨텍스트 주입 상한: 단일 turn 기준 원문 총량 제한 + tool output 크기 제한 + 민감정보 마스킹 후 요약 |
| **임베딩 모델** | **1차(현행 PoC): 미사용.** ID 관계 조회와 grep으로 충분하며, 임베딩 도입은 사용자 API key로 외부 호출을 추가 발생시킨다.<br>**2차(WIKI/SCENARIO 의미 검색 도입 시)**: 사용자가 설정한 provider의 embedding 엔드포인트를 그대로 사용 (`text-embedding-3-large` 등). 외부 호출을 원치 않는 폐쇄망 사용자를 위해 로컬 옵션으로 `bge-m3`(한국어·다국어 성능, ONNX 로컬 추론)를 병기한다. 임베딩은 **FACT/WIKI/SCENARIO 산출물에만** 적용하고 원천 소스 전체를 임베딩하지 않는다. |
| **관계/검색 인덱스** | **`node:sqlite` + 선택적 `sqlite-vec` 확장** (`.scenarioforge/state/scenario-index.sqlite`). run별 immutable artifact가 canonical이고 SQLite는 재구축 가능한 projection이다.<br>선정 사유: ① 설치형 앱이므로 외부 서버·도커가 필요한 Qdrant/Weaviate/pgvector는 배포 비용이 과도 ② 관계 인덱스와 향후 벡터 인덱스를 같은 파일에서 다룰 수 있음 ③ canonical revision 이하 + artifact hash 일치 row만 노출해 journal과 정합성을 확인할 수 있음 ④ Node.js 22.12+ 내장 모듈이라 네이티브 의존성이 최소.<br>SQLite 손상·삭제 시 run artifact와 manifest에서 재구축할 수 있어야 하며 index commit만으로 stage를 완료하지 않는다. |

인덱스 무결성 규칙: 관계 index row는 예정된 `stateRevision`과 `transactionId`를 포함하고, canonical revision 이하 + artifact hash 일치 row만 노출한다. 최종 경로에 파일만 남은 고아는 `.scenarioforge/state/orphans/`로 격리하며 자동 삭제하지 않는다.

### 4.2 대화 메모리 (Conversation History)

| 항목 | 정의 내용 |
| --- | --- |
| **메모리 유형** | 세션별로 다르게 적용하는 **하이브리드**. <br>· **Analysis Session**: Pi 내장 **compaction(요약형)**. 단, 요약은 편의일 뿐 **진실의 원본이 아니다.** 완료 산출물은 세션 메시지가 아니라 파일과 인덱스에 있고, 진행 상태는 `WORK_STATE.md` projection이 원본이다. 따라서 compaction으로 초기 대화가 사라져도 작업이 손상되지 않는다.<br>· **Chat Session**: `conversationId`별 **윈도우 버퍼 + on-demand 재조회**. 히스토리를 길게 들고 있는 대신 매 질문마다 선택된 `scenarioId[]`로 `ArtifactQueryService`를 다시 호출한다.<br>· **Test Planning Session**: **무상태에 가까움**. immutable scenario snapshot + target contract만 입력으로 받고, 계획 확정 후 세션을 폐기한다. |
| **저장 전략** | · 세션 파일 경로: `.scenarioforge/sessions/{analysis \| chat \| test-planning}/`<br>· **세션 유지 시간 제한 없음.** 시간 기반 만료를 두지 않고 **분석 run 단위**로 수명을 관리한다 (설치형 앱은 사용자가 며칠 뒤 같은 프로젝트를 다시 여는 것이 정상 사용 패턴).<br>· **초기화 기준**: ① 사용자가 새 `analysisRunId`를 시작할 때 analysis session 신규 생성 ② `conversationId` 종료 시 chat session 종료 ③ execution 확정 후 planning session dispose ④ Resource Bundle의 protocol version이 호환되지 않게 올라가면 기존 run에 덮어쓰지 않고 **새 run부터** 새 protocol 적용<br>· **앱 재시작**: 저장 상태가 `running`/`retrying`/`compacting`/`cancelling`이면 그대로 복원하지 않고 먼저 `recovering`으로 전이한 뒤, 최신 정상 journal·checkpoint와 Pi 세션 resume 가능 여부를 대조해 재개 가능성을 판정한다.<br>· **credential 예외**: API key 원문은 세션·프로젝트 파일 어디에도 쓰지 않는다. OS 보안 저장소가 있으면 **reference만** 저장하고, 없으면 앱 세션 메모리에만 유지해 재시작 후 재입력을 요구한다. |

`WORK_STATE.md`는 heading 순서를 고정해 parser와 LLM이 항상 같은 위치에서 정보를 찾게 한다. 값이 없어도 heading을 생략하지 않는다.

```md
# ScenarioForge Work State

## State Identity            # schemaVersion, revision, projectId/sessionId/runId/workId
## Current Assignment        # workKind/functionId, objective, 쓰기 scope
## Required Input IDs
## Verified Artifacts
## Pending Completion Gates  # 직전 거절 사유
## Recent Verifiable Activities   # 제한된 최근 항목 projection (전체는 journal)
## Recovery and Error
## Allowed Next Actions
```

이 문서에는 credential, 개인정보 원문, chain-of-thought, 전체 tool output을 넣지 않는다.

---

## 5. 핵심 에이전트 기술 스택

| 구분 | 선정 전략/기술 | 선정 사유 (논리적 근거) |
| --- | --- | --- |
| **LLM Model** | **사용자 BYO 역할 binding** — `author`, 선택적 `reviewer`, 선택적 수행용 `guiGrounder`가 각각 provider / endpoint / model ID / credential reference를 가진다. 상세 생성 하네스 예시는 author=Qwen3.6-35B-A3B, reviewer=GLM-5.2이며 사내 게이트웨이·로컬 모델도 연결 가능하다. GUI 모델은 제품 fixture benchmark 이후 별도로 pin한다. | ① 분석 대상이 사용자의 사설 소스이므로 벤더를 앱이 강제하지 않는다. ② 저작과 검토 모델을 분리하면 오류 상관을 낮출 수 있다. reviewer 미설정 시 동일 모델 자체 검토를 허용하되 `assurance: single-model`로 강등한다. ③ `guiGrounder`는 visual/CUA target 후보만 반환하고 최종 판정 권한이 없다. ④ 모델 성능에 완료 판정을 의존하지 않고 backend Completion Gate와 AssertionEngine이 최종 권한을 가진다. ⑤ 원격 endpoint를 쓰면 source slice 또는 테스트 screenshot이 전송될 수 있으므로 역할별 endpoint·전송 범위를 표시하고 secret pattern·화면 데이터 등급을 사전 차단한다. |
| **Agent Framework** | **Pi (`@earendil-works/pi-coding-agent@0.84.3`, exact pin + package hash 기록)**. Electron `UtilityProcess`에 SDK로 내장. **LangGraph 미도입.** | ① Pi가 agent loop, 세션 영속화, resource(하네스·스킬·서브에이전트) 로딩, tool 실행, compaction, 이벤트 스트리밍을 이미 제공한다. ② LangGraph를 병행하면 *Pi 세션*과 *그래프 checkpoint* 두 개의 실행 상태 원본이 생겨 복구 로직이 이중화된다. ③ 우리가 실제로 필요한 것은 그래프 DSL이 아니라 **결정론적 완료 판정**인데, 이는 Completion Gate로 더 강하게 구현된다(§2.2 등가 매핑). ④ Pi와 앱이 모두 TypeScript/Node.js라 SDK 직접 사용이 가능하고, 프로세스 간에는 ScenarioForge 전용 IPC만 쓴다. Pi CLI RPC는 타 언어 프로세스를 붙일 필요가 생길 때만 검토. ⑤ 버전을 정확히 고정하고 manifest에 hash를 남겨, Resource Bundle과 SDK 버전 불일치를 부팅 시점에 거른다. |
| **Prompt Strategy** | **Contract-grounded Harness + ReAct + Schema Few-shot**. 3계층: ① 불변 `WORK_PROTOCOL.md`(안전 계약) ② `SYSTEM.md`/`AGENTS.md`(역할 하네스) ③ 기능별 `SKILL.md`(입출력 계약). CoT는 내부적으로만 사용하고 **저장·전송·표시하지 않는다.** | ① 이 작업의 실패 모드는 "생각이 얕은 것"이 아니라 **"권한 밖 행동과 근거 없는 완료 선언"** 이다. 따라서 사고 유도(CoT)보다 **계약 고정**이 효과가 크다. ② ReAct(관찰→행동 반복)는 프로젝트마다 구조가 달라 탐색 경로를 사전 확정할 수 없기 때문에 필요하다 — 단계 *안쪽*은 동적, *바깥쪽*은 고정. ③ Few-shot은 자연어 예시가 아니라 **산출물 JSON 스키마 예시**로 제공해 형식 일치율을 올린다. ④ 하네스는 상태 전이나 완료 조건을 **새로 정의할 수 없고**, backend 계약을 설명하고 호출하는 역할만 갖는다. 프롬프트 수정이 시스템 불변식을 깨뜨리지 못하게 하는 구조적 방어다. ⑤ chain-of-thought 미노출은 UX 결정이자 보안 결정이다 — 사용자 소스 내용이 사고 과정에 섞여 로그에 남는 경로를 차단한다. |
| **Output Parsing** | **모델 응답 파싱 없음. "Staged Artifact Submission" 방식** — 결과를 `staging/{workId}/`에 파일로 쓰고 `work.submitArtifacts(contentHash)`로 제출 → JSON Schema validator → ID 관계 validator → 원자적 저장. 상태 변경은 별도로 typed tool 호출(구조화 입력)로만. | ① 대용량 산출물(수백 건 FACT, 수십 페이지 WIKI)을 단일 응답 JSON으로 받으면 토큰 상한·중간 절단·부분 파싱 실패가 발생한다. 파일 제출은 크기 제약을 사실상 제거한다. ② `contentHash`로 제출 내용과 검증 대상의 동일성을 보장하고, retry 산출물이 hash가 같으면 재검증 후 재사용한다. ③ 스키마 검증은 **형식**만 보고, 그 뒤 ID 관계 validator가 **의미**(모든 fact에 source가 존재하는가)를 본다. 두 단계 분리가 환각을 잡는 실제 지점이다. ④ 상태 변경 tool은 입력 스키마가 좁아서(`expectedRevision` 필수, 임의 경로·완료 boolean·hard delete 불가) 모델이 형식만 맞춰 권한을 넘는 것을 막는다. ⑤ 실제 코드에도 같은 원칙이 이미 적용돼 있다 — `isScenarioResult()`(`src/shared/scenario.ts:34`)가 디스크에서 읽은 결과를 UI에 넘기기 전에 전수 검증한다. |
| **Monitoring** | **자체 Durable Journal + Activity Stream (로컬)**. `.scenarioforge/state/journal/`(append-only, hash 연결), `.scenarioforge/logs/{bootstrap,agent,system}/`, Renderer 활동 패널. **LangSmith·Langfuse 등 외부 SaaS 미사용.** | ① **사용자 사설 소스 코드가 프롬프트에 들어간다.** 이를 외부 추적 SaaS로 전송하면 제품의 기본 전제(로컬 우선)가 깨진다. 폐쇄망 도입도 불가능해진다. ② 우리에게 필요한 추적 단위는 "프롬프트/토큰"이 아니라 **revision과 workId**다. journal은 디버깅 도구이자 **복구의 원본**이라 어차피 필요하며, 외부 도구는 이 역할을 대신할 수 없다. ③ 토큰 사용량은 Pi 세션 이벤트에서 집계해 앱 내 사용량 화면으로 제공한다(사용자 계정 과금이므로 가시성이 필요). ④ 이벤트에는 credential·개인정보 원문·사고 과정·전체 tool output을 넣지 않고, 마스킹된 요약만 저장한다. ⑤ 향후 팀 단위 관측이 필요하면 **self-hosted Langfuse로의 opt-in export**만 검토한다(기본 off). |

## 6. 개발 환경

| 구분 | 값 |
| --- | --- |
| 런타임 | Node.js ≥ 22.12, npm ≥ 10 (`package.json:engines`) |
| 언어 | TypeScript (project references, `tsc -b`) |
| 데스크톱 셸 | Electron ^44, electron-vite ^5 (main / preload / renderer 분리) |
| UI | React + Vite ^7, lucide-react, Plus Jakarta Sans. 조사 결과 shadcn/ui(Base UI)를 점진 도입, 대규모 시나리오 시점에 TanStack Table/Virtual 추가 (`docs/architecture/ui-stack-research.md`) |
| 테스트 | Vitest ^4 (`npm test`), 타입 검증 `npm run typecheck` |
| 패키지 경계 | npm workspaces — `apps/desktop`, `packages/{contracts,runtime-state,project-runtime,pi-runtime,scenario-pipeline,test-runtime,evidence-store}` (Phase 1에서 전환) |
| 보안 기준 | `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, 신규 창 차단, `will-navigate` 차단 (`src/main/index.ts:126`) |
