# ScenarioForge PoC 모듈 구현 계획

- 작성일: 2026-08-26
- 대상 브랜치: `dev` (기준 커밋 `83ec9df`)
- 문서 구분: **설계 문서 (2/2)**
- 선행 문서: [ScenarioForge Agent 상세 설계 및 개발 환경](01-agent-detailed-design.md)
- 상위 설계: `docs/superpowers/specs/2026-08-25-scenarioforge-pi-runtime-test-execution-design.md`
- 구현 계획: `docs/superpowers/plans/2026-08-25-pi-runtime-llm-workflows.md`, `docs/superpowers/plans/2026-08-25-state-driven-test-center-ui.md`

> **현황 구분 표기**
> `[구현 완료]` = `dev` 브랜치에 코드가 존재하고 테스트가 통과함
> `[PoC 진행]` = 이번 PoC 단계에서 구현할 범위 (계획 문서에 Task 확정)
> `[후속]` = 이번 PoC 범위 밖

현재 `dev` 브랜치(`83ec9df`)에는 **Electron 셸 + 전 화면 + 공유 타입 계약 + 결정론적 fixture**가 구현돼 있고, Pi 런타임과 실제 Test Runner는 **동일한 공유 계약에 연결하는 방식**으로 설계·계획까지 확정된 상태다. fixture를 먼저 실제 계약 타입으로 구현해 둔 이유는, 백엔드가 붙을 때 UI를 다시 쓰지 않고 **데이터 공급원만 교체**하기 위해서다.

## 1. 핵심 구현 내용

### 1.1 에이전트 워크플로우 (Agent Workflow)

**구현 기능**
- `[구현 완료]` 프로젝트 → 모델 → 확인 3단계 온보딩과 `작업대 / 시나리오 / 테스트 수행 / 증적 보관함` 상위 내비게이션, 화면 상태(`ViewMode`) 기반 결정론적 라우팅
- `[PoC 진행]` `SRC → FACT → WIKI → SCENARIO` 고정 파이프라인 오케스트레이션과 **stage completion gate**
- `[PoC 진행]` Pi 원시 이벤트를 UI 계약에서 분리하는 `PiEventAdapter`

**동작 원리**

이 시스템의 라우팅은 "LLM이 사용자 의도를 분류해 분기"하는 구조가 **아니다.** `AnalysisCoordinator`가 현재 stage와 persisted artifact 상태를 보고 다음 `WorkDescriptor`를 결정론적으로 만들고, LLM은 그 범위 안에서만 자율적으로 도구를 고른다. 단계 완료는 다음 경로로만 확정된다.

```text
Pi agent_end
  → session settled          ← 여기서 멈춘다. 완료 아님
  → stage validating
  → schema validation
  → 필수 ID / 원천 관계 validation
  → staging → 최종 경로 원자적 저장
  → index 반영 검증
  → stage completed + revision commit
  → analysis.stage.completed event publish
  → Renderer 화면 전환
```

`PiEventAdapter`의 책임은 정규화까지로 **엄격히 제한**한다. Adapter는 단계 완료를 확정하거나 파일을 저장하거나 Renderer 이벤트를 발행하지 않는다.

| Pi 원시 이벤트 | Adapter 산출 | 금지 |
| --- | --- | --- |
| `agent_start` | session `running` 전이 **후보** | 직접 전이 확정 |
| tool 시작/종료 | activity 후보 (활동 패널 전용) | route 전환 |
| compaction | session `compacting` 후보 | — |
| `agent_end` | session `settled` 후보 | **stage completion으로 해석** |
| 모델 텍스트 응답 / 사고 과정 | **버림** | 상태 판정·UI 표시 |

**주요 기술**
Electron `UtilityProcess` 프로세스 격리 · `@earendil-works/pi-coding-agent@0.84.3` SDK · 순수 함수 reducer + single-writer `RuntimeStateCoordinator` · `expectedRevision` compare-and-set · React 상태 파생 라우팅 (`src/renderer/src/App.tsx`)

---

### 1.2 도구(Tool) 및 함수 연동

**구현 기능**
- `[구현 완료]` Renderer ↔ Main의 **allowlist typed IPC 계약** 7종과 preload `contextBridge` 노출 (`src/shared/desktop-api.ts`, `src/preload/index.ts`)
- `[구현 완료]` native directory dialog 연결, 발신자 검증, 경로 이탈 차단, 디스크 결과 스키마 검증 후 반환
- `[PoC 진행]` `WorkStateService` 9종 도구와 `ArtifactQueryService` 6종 조회 도구를 Pi tool로 노출
- `[PoC 진행]` Pi 기본 파일·명령 도구를 감싸는 `ProjectPathPolicy` wrapper

**동작 원리**

LLM이 만든 값은 **어느 것도 신뢰하지 않는다.** 3중 검증을 통과해야 실제 효과가 발생한다.

```text
[1] 스키마 검증   — tool 입력이 WorkStateService 계약과 동일한 스키마인지
                   (임의 경로 · canonical state 패치 · 완료 boolean · hard delete 불가)
[2] 권한 검증     — FunctionPolicy allowlist / 자기 workId 범위 / staging scope
[3] 상태 검증     — expectedRevision == 현재 revision (불일치 시 최신 context 재조회 요구)
```

같은 원칙이 이미 구현된 코드에도 적용돼 있다. `loadScenarioResult` 핸들러는 ① 발신자가 메인 윈도우인지 확인하고(`assertTrustedSender`, `src/main/index.ts:17`) ② `runId`를 `/^[a-zA-Z0-9_-]+$/`로 제한하고 ③ `resolve()` 후 프로젝트 루트 접두사를 재확인해 경로 이탈을 막고(`src/main/index.ts:82`) ④ 파싱 결과를 `isScenarioResult()`로 전수 검증한 뒤에만 Renderer로 넘긴다. Renderer는 Node.js·파일시스템·프로세스 권한을 전혀 갖지 않는다.

**주요 기술**
Electron `contextBridge` + `ipcMain.handle` allowlist · TypeScript 판별 함수(type predicate) 기반 런타임 검증 · `node:path`의 `resolve`/`sep` canonical 경로 검사 · SHA-256 `contentHash` · idempotency key `{projectId, sessionId, workId, operationId, expectedRevision}`

---

### 1.3 데이터 및 메모리 (RAG & Context)

**구현 기능**
- `[구현 완료]` 시나리오 정보 셋 스키마(`ScenarioResult → ScenarioGroup → ScenarioCase → ScenarioStep`)와 전수 검증기
- `[구현 완료]` 테스트 실행·증적 스키마와 판정 규칙(`deriveExecutionResult`, `isValidStepEvidence`, `orderEvidenceCaptures`)
- `[구현 완료]` 프로젝트별 생성 이력 재접근 — 완료 이력을 열면 재분석 없이 `.scenarioforge/runs/{runId}/scenario-set.json`을 읽어 결과 화면으로 복원
- `[PoC 진행]` `WORK_STATE.md` projection과 journal/checkpoint 기반 복구
- `[PoC 진행]` ID 관계 인덱스(`scenario-index.sqlite`)와 `ArtifactQueryService`

**동작 원리**

질문이 들어오면 **임베딩 유사도 top-k를 검색하지 않는다.** 사용자가 시나리오 ID를 drag & drop으로 지정하면, 그 ID를 시작점으로 관계 그래프를 결정론적으로 펼쳐 근거를 모은다.

```text
사용자가 `SCN-PAY-001`을 채팅에 drop
  → scenarioIds = ["SCN-PAY-001"]
  → artifact.scenario.getById       → 사전 조건 · 스텝 · 기대 결과
  → artifact.wiki.listByScenarioId  → 관련 WIKI
  → artifact.fact.listByScenarioId  → 근거 FACT + 원천 위치
  → artifact.source.listByScenarioId→ 원천 파일
  → 이 집합만 컨텍스트로 주입
  → 답변의 모든 인용 ID가 조회 결과 안에 있는지 gate 검증
```

인용 ID가 조회 결과에 없으면 **환각으로 판정해 답변을 반려**한다. 근거 부재가 "찾지 못함"이 아니라 **검증 실패**가 되는 것이 이 설계의 핵심이다.

컨텍스트 수명은 세션별로 다르다 — analysis는 compaction 요약(원본은 파일), chat은 윈도우 버퍼 + 매 턴 재조회, test planning은 immutable snapshot 단발성.

**주요 기술**
ID 그래프 기반 Structured Retrieval · `node:sqlite` + `sqlite-vec`(2차 의미 검색 예정) · tree-sitter 심볼 경계 청킹 · Pi 세션 compaction · append-only journal + checkpoint · Markdown projection

---

## 2. 주요 문제 해결 및 기술 리서치

| 이슈 구분 | 문제 상황 및 원인 | 리서치 및 해결 과정 (Reference & Solution) |
| --- | --- | --- |
| **프롬프트 / 완료 판정** | 에이전트가 "분석을 완료했습니다"라고 응답하거나 Pi가 `agent_end`를 발행하면 UI가 완료 화면으로 넘어간다. 그러나 실제로는 산출물이 비어 있거나 스키마가 깨져 있는 경우가 발생한다. **모델의 자기 보고를 완료 조건으로 쓴 것이 원인.** | • **리서치:** Pi SDK 이벤트 문서에서 `agent_end`의 의미가 "이번 turn이 더 이상 이벤트를 만들지 않음"일 뿐 작업 성공이 아님을 확인. LangGraph의 conditional edge / `interrupt()` 패턴도 함께 조사.<br>• **적용:** 세션 상태(`settled`)와 업무 상태(`completed`)를 **서로 다른 reducer**로 완전히 분리. 8개 조건(root/child settle · schema · ID 관계 · 원자적 저장 · index 일치 · manifest · revision commit · event 포함)을 모두 만족해야 `completed`. 에이전트에는 `work.requestCompletion`(요청)만 주고 승인 권한을 제거. Gate 거절 시 `unmetGates`를 `WORK_STATE.md`에 써서 같은 작업이 이어받게 함. |
| **도구 연동 / 상태 원본 이중화** | 초기 구상에서는 에이전트가 상태 파일을 직접 읽고 쓰게 하려 했다. 그러면 ① 여러 subagent가 오래된 상태를 덮어쓰고 ② 상태 원본이 "파일"과 "Pi 세션 메시지" 두 개가 되며 ③ 앱이 중간에 죽으면 어느 쪽이 참인지 알 수 없다. | • **리서치:** LangGraph Persistence(checkpointer/thread) 문서로 durable state 패턴 조사. 결론은 "checkpoint를 하나만 둘 것". 낙관적 동시성 제어(compare-and-set) 패턴 검토.<br>• **적용:** ① canonical state 파일을 Pi 일반 파일 도구에 **write-deny** 처리 ② 모든 변경을 `WorkStateService` 9종 tool로만 받음 ③ 프로젝트별 **single-writer queue** + `expectedRevision` compare-and-set — stale revision은 거절하고 최신 context를 다시 읽게 함 ④ `contextToken`을 일회성으로 발급해 **컨텍스트를 안 읽고 시작하는 작업 자체를 불가능**하게 만듦 ⑤ child는 부모 토큰을 재사용하지 못하고 자체 context를 조회. |
| **프레임워크 선정** | 워크플로우 제어를 위해 LangGraph 도입을 검토했으나, Pi가 이미 agent loop·세션·checkpoint를 갖고 있어 **실행 상태 원본이 두 개**가 되는 문제가 예상됨. | • **리서치:** LangGraph Workflows & Agents / Persistence 공식 문서와 Pi SDK·Extensions·Skills 문서를 대조해 기능 중복 구간을 표로 정리. Electron 기반 코딩 에이전트 완제품(OpenGUI)의 프로세스·세션·스트리밍 구조도 참고 구현으로 조사.<br>• **적용:** **Pi-first 하이브리드**로 확정. LangGraph의 Node/Edge/Checkpointer를 각각 `WorkDescriptor` / Completion Gate / journal+checkpoint로 자체 구현(→ 상세 설계 문서 §2.2 등가 매핑표). 동시에 **재도입 조건 5가지**(노드 단위 exact-resume, 장시간 승인 interrupt, 분산 작업자, 보상 트랜잭션, 프로세스 공유 durable graph state)를 문서에 명시해 결정을 되돌릴 기준을 남김. |
| **보안 / 개인정보** | 테스트 수행에는 실제 URL과 테스트용 개인정보 JSON이 필요하다. 이 값이 실행 로그·스크린샷·도메인 이벤트에 그대로 남으면 증적 자체가 유출 경로가 된다. API key도 마찬가지. | • **리서치:** Electron 공식 보안 체크리스트(`contextIsolation`, sandbox, `nodeIntegration: false`, 제한된 preload bridge) 기준 적용 범위 확인. OS 보안 저장소 사용 가능 여부에 따른 credential 분기 설계.<br>• **적용:** ① API key 원문은 프로젝트 파일·세션 파일에 쓰지 않고 OS 저장소 reference 또는 앱 세션 메모리만 사용 — 현재 코드도 `sessionModelSettings` 메모리 변수로만 유지(`src/main/index.ts:48`) ② 개인정보는 Runner 메모리에서만 쓰고 로그·증적에 field masking ③ **마스킹이 실패하면 증적 저장과 전체 실행을 중단**(fail-closed) ④ 도메인 이벤트에서 credential·개인정보·사고 과정·raw tool output을 전면 제외. |
| **상태 / 복구** | 분석 도중 앱을 끄거나 Pi 프로세스가 죽으면, 저장된 상태가 `running`인 채로 남는다. 재시작 시 이를 그대로 복원하면 **실제로는 아무도 일하지 않는데 진행 중 화면**이 뜬다. | • **리서치:** 커밋 중간 지점(index 기록 후 state commit 전, 파일 저장 후 event 발행 전 등)별 실패 시나리오를 fixture로 열거.<br>• **적용:** ① active 상태는 복원 대신 먼저 `recovering`으로 전이 ② 최신 정상 journal + checkpoint 선택 → Pi 세션 resume 가능성 · staging/final artifact · index 일치를 검사한 뒤에만 재개 ③ 이벤트를 **저장 후 발행**해 publish가 끊겨도 revision 기준 replay 가능 ④ index만 남은 row는 숨기고 recovery가 제거, 파일만 남으면 `state/orphans/`로 격리하고 **자동 삭제하지 않음** ⑤ `WORK_STATE.md`가 손상돼도 canonical state에서 재생성하며, projection 손상만으로 작업을 실패 처리하지 않음. |
| **성능 / UI 스택** | 시나리오가 수백~수천 건으로 늘어날 때의 렌더링 비용과, 에이전트형 앱에 맞는 UI 기반을 무엇으로 둘지 판단 필요. | • **리서치:** termcn / OpenGUI / OpenUI / shadcn(Base UI) / React Aria / TanStack Table / xterm.js 7종을 성격과 적용 가능성으로 비교 (`docs/architecture/ui-stack-research.md`).<br>• **적용:** Electron + electron-vite + React + TypeScript를 기반으로 유지. termcn은 터미널 UI라 Chromium DOM 대체재가 아니고, OpenGUI 완제품 포크는 도메인·디자인 정합 비용이 크며, OpenUI의 generative UI는 스키마가 확정된 시나리오 시트에 과하다고 판단해 모두 배제. Dialog/Sheet/Select는 shadcn(Base UI)로 점진 교체, **대규모 시나리오 시점에 TanStack Table/Virtual 도입**으로 결정을 유예. |
| **증적 규칙** | 성공 스텝과 실패 스텝의 캡처 요구가 달라(성공 1장 vs 실패 3장 + 오류 컨텍스트), 규칙이 코드 곳곳에 흩어지면 누락된 증적이 UI에서 정상처럼 보인다. | • **리서치:** 판정 상태를 `PASSED / FAILED / INCONCLUSIVE / CANCELLED` 4종으로 나눠, "실패"와 "환경 문제로 판정 불가"를 구분하는 taxonomy 정의.<br>• **적용:** 규칙을 **공유 계약 함수 한 곳**으로 모음 — `isValidStepEvidence()`(`src/shared/test-execution.ts:108`)가 성공 스텝은 `action-complete` 정확히 1장 + 오류 없음, 실패 스텝은 3종 캡처 전부 + `error.category`/`error.message` 존재를 강제한다. 표시 우선순위도 `orderEvidenceCaptures()`(`:147`)로 고정해 실패 시점 → 실패 직전 → 이전 완료 순서를 보장. 실행 최종 판정은 `deriveExecutionResult()`(`:86`)가 `failed > inconclusive > cancelled > passed` 우선순위로 계산하고, **진행 중 케이스가 하나라도 있으면 `null`을 반환해 조기 확정을 막는다.** |

---

## 3. 핵심 동작 검증

### 검증 시나리오 A: 결제 스텝 실패 시 증적 3종 확보 및 후속 처리

`[구현 완료 · 자동 테스트 통과]`

**입력**
- 시나리오 `SCN-PAY-001` (신용카드 결제 승인, 4스텝) 외 선택 케이스
- 대상 URL: `https://staging.commerce.example/checkout`
- 실행: `EXE-20260825-0006`

**에이전트 / Runner 동작**

1. 스텝 1~2 성공 → 각 스텝 완료 화면 `action-complete.png` **1장씩** 저장
2. 스텝 3 `결제를 요청한다` 실행 → 결제 API가 `503 Service Unavailable` 반환, 기대 결과(`승인 번호와 주문 완료 화면`) 미충족
3. 실패 인지 → 증적 규칙 분기: 완료 화면 외에 `before-failure.png`, `failure.png`를 추가 저장하고 `failure-context.json`에 오류 분류·코드 기록
4. `isValidStepEvidence()` 검증 → 3종 캡처 + `error.category`/`error.message` 존재 확인 후 증적 확정
5. 같은 케이스의 **스텝 4는 `skipped`** 로 기록 (`queued`로 남기지 않음)
6. 실패 증적 확정 후 **다음 대기 케이스를 계속 실행** (실행 전체를 중단하지 않음)
7. `deriveExecutionResult()`가 `failed > inconclusive > cancelled > passed` 우선순위로 실행 최종 판정을 계산

**최종 결과**

증적 상세 화면이 실패 시점 화면을 우선 노출하고, 실패 직전·이전 단계 완료 화면과 기대·실제 결과, 오류 분류를 함께 표시한다.

```text
판정      FAILED
기대 결과  승인 번호와 주문 완료 화면이 표시된다.
실제 결과  결제 요청 후 오류 안내 없이 동일 화면에 머물렀습니다. 결제 API가 503을 반환했습니다.
오류      target.network / PAYMENT_GATEWAY_UNAVAILABLE
          POST /api/payments 응답 503 · Service Unavailable
증적      failure.png → before-failure.png → 이전 단계 완료.png  (3장)
후속      스텝 4 = SKIPPED, 다음 케이스 계속 실행
```

**검증 근거 (실제 실행 결과)**

```bash
$ npm test
 RUN  v4.1.11 /Users/a11769/Desktop/master-project
 Test Files  3 passed (3)
      Tests  11 passed (11)
   Duration  178ms
```

| 검증 항목 | 테스트 |
| --- | --- |
| 성공 스텝은 완료 화면 정확히 1장 | `isValidStepEvidence > accepts exactly one completion screen for a passed step` |
| 실패 스텝은 3종 캡처 + 오류 상세 필수 | `isValidStepEvidence > requires failure context screens and error details` |
| 실패 시점 화면이 최우선 노출 | `orderEvidenceCaptures > prioritizes the failure frame and its preceding context` |
| 실패 우선 최종 판정 | `deriveExecutionResult > uses failure as the highest-priority final result` |
| 진행 중 케이스가 있으면 조기 확정 금지 | `deriveExecutionResult > does not finalize while any case is still active` |
| 실패 이후 케이스는 skipped 처리 | `createDemoTestExecution > marks cases after a failure as skipped rather than queued` |
| 재시도 케이스는 스텝 확정 전까지 active 유지 | `createDemoTestExecution > keeps a single-case retry active until its current step settles` |
| 시나리오 정보 셋 스키마 전수 검증 | `isScenarioResult` 3건 (정상 / 그룹 누락 / 스텝 형식 오류) |

화면 검증: `npm run dev:web` 실행 후 `?preview=test-failed`, `?preview=evidence-failure` 쿼리로 동일 상태를 재현할 수 있으며, 캡처는 `artifacts/screen-test-failure-evidence.png`에 보관돼 있다.

---

### 검증 시나리오 B: FACT 단계 완료 게이트 — "완료했습니다"를 거절

`[PoC 진행 · fake Pi adapter fixture로 검증 예정]`

**입력**
- `analysis.fact-extract` root work, 입력 = persisted source ID 12건

**에이전트 동작 (기대)**

1. `work.getContext` → revision 41, protocolHash 확인, `contextToken` 발급
2. `work.begin(expectedRevision: 41, contextToken)` → revision 42
3. `work.requestChild` × 3 (모듈 배치 단위) → 각 child가 **자체 context를 다시 조회**
4. child 결과를 `staging/{workId}/facts/*.json`에 통합
5. `work.submitArtifacts(contentHash, relatedIds)` → revision 46
6. 모델이 `"FACT 추출을 완료했습니다"` 응답 → **아무 상태도 바뀌지 않음**
7. `work.requestCompletion(expectedRevision: 46)` 호출
8. Completion Gate 검증 → `FCT-0007`의 `sourceId`가 persisted source 목록에 없음

**최종 결과 (기대)**

```json
{
  "accepted": false,
  "revision": 46,
  "unmetGates": [
    "fact.source-relation: FCT-0007 references SRC-0044 which is not persisted",
    "fact.evidence-range: FCT-0011 location exceeds source file bounds"
  ],
  "context": { "revision": 46, "stateHash": "…", "allowedNextActions": ["…"] }
}
```

- FACT stage는 `validating`에 머물고 **`completed`로 넘어가지 않는다.**
- 시나리오 화면은 활성화되지 않는다.
- `unmetGates`가 `WORK_STATE.md`의 `## Pending Completion Gates`에 반영되고, 같은 작업이 두 건을 보완한 뒤 다시 `requestCompletion`을 호출한다.
- 이 경로에서 **`agent_end`도, 모델의 완료 문장도, tool 성공 이벤트도 단독으로 단계를 완료시키지 못한다.**

---

## 4. PoC 완료 기준

| # | 기준 | 검증 방법 |
| --- | --- | --- |
| 1 | 프로젝트·LLM 설정 후 해당 model로 Pi session이 생성된다 | E2E |
| 2 | `.scenarioforge/` 초기화가 사용자 소스 파일을 변경하지 않는다 | bootstrap 멱등성 테스트 |
| 3 | 산출물은 schema + ID 관계 검증을 통과해야만 완료로 표시된다 | Completion Gate 단위 테스트 |
| 4 | `agent_end`·완료 텍스트만으로 stage가 완료되지 않는다 | 검증 시나리오 B |
| 5 | 모든 LLM 작업이 최신 protocol version과 revision을 확인하고 시작한다 | `contextToken` 없는 `begin` 거절 테스트 |
| 6 | domain event는 revision commit **이후에만** Renderer로 전달된다 | 통합 테스트 (commit 단계별 강제 종료) |
| 7 | 재시작 시 active 상태는 `recovering`을 먼저 거친다 | 복구 fixture |
| 8 | 질의는 시나리오 화면에서만 실행되고 ID 관련 산출물을 조회한다 | UI 테스트 + Main process 관계 재검증 |
| 9 | 테스트는 선택 순서대로 실행되고 스텝별 증적 규칙을 지킨다 | 검증 시나리오 A `[통과]` |
| 10 | 재실행이 기존 증적을 덮어쓰지 않는다 (`retryOfExecutionId` 연결) | 통합 테스트 |
| 11 | credential·개인정보 원문이 상태 문서·이벤트·증적에 남지 않는다 | 마스킹 fail-closed 테스트 |
| 12 | 생성 완료만으로 수행 planning이나 Runner가 시작되지 않는다 | trigger isolation 통합 테스트 |
| 13 | 실행 중 추가가 기존 snapshot/plan을 수정하지 않고 새 batch를 append한다 | immutable batch hash 테스트 |

## 5. 구현 순서

| Phase | 범위 | 상태 |
| --- | --- | --- |
| 0 | Electron 셸 · 전 화면 · 공유 계약 · fixture | **완료** (`83ec9df`) |
| 1 | npm workspace 전환과 contracts 패키지 | PoC |
| 2 | 복구 가능한 Runtime State (journal · checkpoint · `WorkStateService`) | PoC |
| 3 | Project Runtime (bootstrapper · path policy · manifest) | PoC |
| 4 | Pi Runtime Host 기반 (`UtilityProcess` · `PiEventAdapter`) | PoC |
| 5 | Analysis/Query/Planning Domain (generation 4종 · query 1종 · execution planning 1종 · completion gate · ID 인덱스) | PoC |
| 6 | 프런트 보정 (revision 기반 store · 타이머 목업 제거) | PoC |
| 7 | 테스트 및 증적 (trigger façade · immutable ExecutionBatch · TestVista Runner · masking · hash) | PoC |
| 8 | **하네스·스킬·에이전트 상세 설계** — `docs/pi-coding-agent 하네스 설계.md`, `03-integrated-harness-server-design.md`, `04-test-execution-harness-design.md` | **설계 완료 · 구현 대기** |
| 9 | 실제 Pi 통합 E2E와 복구 검증 | PoC |

> Phase 8을 마지막에 두는 이유: 하네스는 상태 전이나 완료 조건을 **새로 정의할 수 없고** backend 계약을 설명하고 호출하는 역할만 갖는다. 계약이 확정되기 전에 프롬프트를 쓰면, 프롬프트가 사실상 아키텍처를 정하게 되어 §2의 첫 두 이슈가 재발한다.
