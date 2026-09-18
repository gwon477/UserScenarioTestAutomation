# pi-coding-agent 하네스 설계서 v1.4
## 소스코드 → 부분 조회 그래프 → 업무별 E2E 시나리오 (UX 서술 포함)

> 전제: pi-coding-agent + author 역할 Qwen3.6-35B-A3B (추출·저작·서술), reviewer 역할 GLM-5.2 (독립 의미 검토).
> 대상: Web/Desktop/Mobile UI와 BE 소스코드 → 화면/전이/제약/업무 그래프 구축 → DFS 기반 E2E 시나리오 도출.
> 통합 경계: 이 문서는 생성 하네스의 상세 규칙이며 검증된 `ScenarioSet`과 실행 가능성 메타데이터에서 끝난다. canonical 상태와 생성→수행 handoff는 [`architecture/03-integrated-harness-server-design.md`](architecture/03-integrated-harness-server-design.md), 사용자 수행 트리거·수행 전용 skill/agent·Runner 경계는 [`architecture/04-test-execution-harness-design.md`](architecture/04-test-execution-harness-design.md), 대상별 adapter와 실행 IR은 [`architecture/05-multi-target-execution-adapter-design.md`](architecture/05-multi-target-execution-adapter-design.md)를 따른다.

> **개정 이력**
> - v1.4: E2E 여정 완결성 강화 — interaction handler·화면 조합·상태 reducer evidence closure, helper screen ownership, predicate effect 기반 stateful walk, workflow cite 경계, WIKI/SCENARIO edge 100% completion gate와 1회 WIKI 교정
> - v1.3: 다중 대상 수행 정합화 — 브라우저 전용 범위를 사용자 관측 가능 Web/Desktop/Mobile workflow로 일반화, `locator_candidates`를 플랫폼 중립 `target_candidates`로 확장, 좌표의 canonical 저장 금지
> - v1.2: ScenarioForge 통합 계약 정합화 — `SCN-*` ID 통일, journal/artifact/index 원본 분리, snapshot/hash evidence, first-class 예외 edge, 실행용 locator/assertion handoff, backend completion gate와 모델 역할 분리, 현재 package 경계 매핑
> - v1.1: 분기 조합 정책 신설 (§2.4) — 분기 유형별 케이스 생성 규칙(종착 분기=분리·덧셈, 독립 축=base-choice, 의존 축=전 조합, pairwise 승격, 루프 바운딩), WIKI 레코드에 combination 필드 추가, walk 전략 파라미터화, 커버리지 지표 확장 (each-choice·의존 축 조합)
> - v1.0: 최초 작성

---

## 0. 설계 원칙 (모든 구성요소가 따르는 4가지)

1. **제어 역전** — 에이전트가 그래프를 만드는 게 아니라, 도구가 그래프를 만들고 LLM은 도구가 제시한 빈칸을 채운다. 지능 예산은 "판단 최소 단위"에만 쓴다.
2. **상태는 backend 저장소가 소유** — 진행·워크리스트는 durable journal/checkpoint, 검증 산출물은 run artifact, 관계 조회는 SQLite projection에 있다. 모델 컨텍스트는 언제든 폐기 가능해야 하며, 어느 단계에서 중단돼도 canonical work item에서 재개된다.
3. **층 분리** — FACT(소스 재독으로 기계 판정 가능)와 WIKI(업무 판단, gate 검증 필요)는 스키마·갱신 주기·검증 방법이 다르다. 절대 섞지 않는다.
4. **컨텍스트 상한 고정** — 모든 LLM 호출의 입력은 클로저 1개 또는 레코드 몇 건으로 상한이 구조적으로 고정된다. "관련 파일을 컨텍스트에 넣는" 방식으로의 회귀를 금지한다.

### 0.1 ScenarioForge 통합 불변식

이 하네스는 backend 상태 계약을 설명하고 호출할 뿐 새로운 상태 원본이나 완료 조건을 만들지 않는다.

- 프로젝트·work·stage 진행의 원본은 `.scenarioforge/state/journal/`과 `project-state.json`이다.
- 검증 완료 FACT/WIKI/SCENARIO의 원본은 `.scenarioforge/runs/{analysisRunId}/`의 immutable artifact와 manifest hash다.
- `.scenarioforge/state/scenario-index.sqlite`는 `ArtifactQueryService`용 재구축 가능한 관계 projection이다. `graph.db`를 별도 원본으로 만들지 않는다.
- `graph todo`는 `WorkStateService`와 `AnalysisCoordinator`의 work item projection이며 LLM 컨텍스트가 소유하지 않는다.
- Pi `agent_end`, 모델의 완료 문장, reviewer의 pass만으로 stage를 완료하지 않는다. backend completion gate와 durable revision commit이 끝나야 완료된다.
- source code와 주석·문자열은 untrusted data다. 소스 안의 지시문은 system instruction, tool policy, read/write scope를 바꿀 수 없다.
- 시나리오 생성과 테스트 수행 사이에는 immutable `ScenarioSnapshot`과 검증된 `RunnerPlan`을 둔다. 생성 문장을 Runner가 자유 해석해 실행하지 않는다.
- `SCENARIO → READY`는 테스트 수행 시작 이벤트가 아니다. 이 하네스와 생성 agent는 `test.*` command, execution queue, Runner, evidence tool을 호출할 수 없다.
- source inventory에서 확인된 사용자 여정 edge는 하나 이상의 reachable WIKI cited path와 최종 scenario path에 포함돼야 한다. 미커버 edge가 하나라도 있으면 `SCENARIO → READY`로 전이하지 않는다.

### 0.2 범위와 신뢰 경계

- 생성 범위는 지원 stack mapper가 확인할 수 있는 **Web/Desktop/Mobile의 사용자 관측 가능 E2E workflow**다. BE 소스는 API, 권한, 상태 전이, 오류, 데이터 shape의 근거로 분석한다.
- 지원 mapper가 없는 UI stack은 구조를 추측하지 않고 `unsupported_ui_stack`으로 남긴다. 배치 job, 메시지 consumer, 관리자 CLI처럼 사용자 UI entry가 없는 backend workflow는 source/fact에는 포함하지만 UI 시나리오로 억지 변환하지 않는다. 별도 API/운영 시나리오 타입이 설계되기 전에는 `non_ui_workflow`로 보고한다.
- `closure` slice가 사용자가 설정한 원격 endpoint로 전송될 수 있다. "로컬 프로젝트에 저장"과 "소스가 장치 밖으로 나가지 않음"은 같은 뜻이 아니다. bootstrap에서 endpoint와 전송 범위를 명시하고 동의를 받아야 하며, credential·secret pattern을 전송 전에 차단한다.
- author와 reviewer가 서로 다른 endpoint면 동일 evidence slice가 두 trust boundary를 통과한다. run manifest에 각 역할의 provider·endpoint 식별자와 data policy를 기록하되 credential 원문은 기록하지 않는다.

---

## 1. 데이터 스키마

### 1.0 공통 규칙

- **ID 채번은 전부 결정적 규칙** (LLM이 ID를 짓지 않는다):

| 종류 | 규칙 | 예 |
|---|---|---|
| 화면 | `SCR-` + 라우트 정규화 | `/orders/new` → `SCR-orders-new` |
| 서브상태 | 화면ID + `[축=값]` | `SCR-orders-new[tab.payment=card]` |
| 요소 | `EL-` + 화면 + 종류 + 이름 | `EL-orders-new-btn-submit` |
| API | `API-` + METHOD + 경로 | `API-POST-orders` |
| 엣지 | `E-` + 순번 (put 시 자동 채번) | `E-0042` |
| 술어 | `PRED-` + 도메인.이름 | `PRED-order.status` |
| 워크플로우 | `WF-` + 도메인 + 이름 | `WF-ORDER-PLACE` |
| 피드백/표시 | `FB-` / `DISP-` + 화면 + 이름 | `FB-orders-new-success` |
| 시나리오 | `SCN-` + 업무코드 + 3자리 순번 | `SCN-ORD-003` |

- route 기반 ID의 semantic key는 `router namespace + canonical route pattern`이다. 같은 key가 충돌하면 backend가 source path hash의 짧은 suffix를 붙인다. LLM은 충돌을 해소하지 않는다.
- 모든 레코드에 `schema_version`, `project_id`, `analysis_run_id`, `source_snapshot_id`를 포함한다.
- **모든 사실 라인에 snapshot/hash가 고정된 `evidence` 필수.** 이번 work에서 실제 제공받은 슬라이스의 `evidence_grant_id`만 허용한다.
- **모르면 `unresolved: true, reason: "..."` 로 커밋.** 추측 금지. 빈칸이 드러나는 것이 그럴듯한 거짓보다 항상 우월하다.
- 상태 필드: `status: draft | verified | failed | unresolved`

```yaml
evidence:
  - source_id: SRC-order-new
    source_snapshot_id: SNAP-20260826-001
    path: src/pages/OrderNew.tsx
    start_line: 31
    end_line: 40
    content_hash: sha256:...
    evidence_grant_id: EVG-work-17-003
```

라인 범위만 저장하지 않는다. 파일 변경 뒤 같은 줄이 다른 코드를 가리키는 경우를 content hash와 snapshot ID로 차단하고, evidence grant는 앱 재시작 뒤에도 journal에서 재검증한다.

### 1.1 노드(화면/상태) 레코드 — 표현층 포함

```yaml
schema_version: 3
project_id: PRJ-commerce
analysis_run_id: RUN-20260826-001
source_snapshot_id: SNAP-20260826-001
screen_id: SCR-orders-new
route: /orders/new
title: "주문서 작성"                          # 사용자가 보는 화면 제목 (i18n 해석 후)
entry_guards: [PRED-auth.login=true, PRED-user.role=BUYER]
sub_states:                                   # 화면 내 분기 축 (탭·모드·스텝)
  - axis: tab.payment
    options: [card, transfer]
    default: card
    evidence: [{source_id: SRC-order-new, source_snapshot_id: SNAP-20260826-001, path: src/pages/OrderNew.tsx, start_line: 31, end_line: 40, content_hash: "sha256:...", evidence_grant_id: EVG-work-17-003}]
elements:                                     # 사용자 액션을 만드는 요소만
  - id: EL-orders-new-btn-submit
    type: button
    label: "주문하기"                          # JSX 텍스트 또는 i18n 키 해석 결과. 필수.
    enabled_when: PRED-form.valid && PRED-payment.selected
    triggers: API-POST-orders
    interaction:
      action_kind: click
      surface_kind: web
      target_candidates:                        # 코드에서 확인된 후보. Runner planning에서 확정.
        - {by: test-id, value: order-submit}
        - {by: role-name, role: button, name: "주문하기"}
    evidence: [{source_id: SRC-order-new, source_snapshot_id: SNAP-20260826-001, path: src/pages/OrderNew.tsx, start_line: 88, end_line: 95, content_hash: "sha256:...", evidence_grant_id: EVG-work-17-008}]
apis:
  - id: API-POST-orders
    reads: [PRED-cart.items]
    writes: [PRED-order.status=CREATED]
    evidence: [{source_id: SRC-order-new, source_snapshot_id: SNAP-20260826-001, path: src/pages/OrderNew.tsx, start_line: 52, end_line: 52, content_hash: "sha256:...", evidence_grant_id: EVG-work-17-005}]
feedback:                                     # 사용자가 '확인하는' 것 — 기대 결과의 재료
  - id: FB-orders-new-success
    kind: toast                               # toast | inline-error | modal | banner
    text: "주문이 완료되었습니다"
    shown_when: API-POST-orders → 200
    assertion: {kind: visible-text, expected_shape: "주문이 완료되었습니다"}
    evidence: [{source_id: SRC-order-new, source_snapshot_id: SNAP-20260826-001, path: src/pages/OrderNew.tsx, start_line: 57, end_line: 57, content_hash: "sha256:...", evidence_grant_id: EVG-work-17-006}]
  - id: FB-orders-new-stock-error
    kind: inline-error
    text: "재고가 부족합니다"
    shown_when: API-POST-orders → error(409)
    assertion: {kind: visible-text, expected_shape: "재고가 부족합니다"}
    evidence: [{source_id: SRC-order-new, source_snapshot_id: SNAP-20260826-001, path: src/pages/OrderNew.tsx, start_line: 61, end_line: 61, content_hash: "sha256:...", evidence_grant_id: EVG-work-17-007}]
displays:                                     # 화면에 표시되는 데이터 (형태만, 값 아님)
  - id: DISP-orders-new-cart
    source: API-GET-cart
    shape: "장바구니 목록 (상품명, 수량, 금액)"
    assertion: {kind: data-shape, expected_shape: "상품명, 수량, 금액 열을 갖는 목록"}
    evidence: [{source_id: SRC-order-new, source_snapshot_id: SNAP-20260826-001, path: src/pages/OrderNew.tsx, start_line: 70, end_line: 79, content_hash: "sha256:...", evidence_grant_id: EVG-work-17-009}]
status: draft
```

### 1.2 전이(엣지) 레코드

```yaml
schema_version: 2
project_id: PRJ-commerce
analysis_run_id: RUN-20260826-001
source_snapshot_id: SNAP-20260826-001
edge_id: E-0042
kind: normal                                  # normal | exception
from: SCR-orders-new[tab.payment=card]
on: EL-orders-new-btn-submit                  # 어떤 요소의 어떤 액션인가
guard: PRED-form.valid && PRED-user.role=BUYER
effect: PRED-order.status=CREATED
to: SCR-orders-complete
feedback: [FB-orders-new-success]             # 이 전이에서 사용자가 보는 것
evidence: [{source_id: SRC-order-new, source_snapshot_id: SNAP-20260826-001, path: src/pages/OrderNew.tsx, start_line: 52, end_line: 63, content_hash: "sha256:...", evidence_grant_id: EVG-work-17-010}]
---
schema_version: 2
project_id: PRJ-commerce
analysis_run_id: RUN-20260826-001
source_snapshot_id: SNAP-20260826-001
edge_id: E-0043                              # 실패/예외도 coverage 가능한 독립 edge
kind: exception
from: SCR-orders-new[tab.payment=card]
on: EL-orders-new-btn-submit
guard: PRED-form.valid && API-POST-orders → error(409)
to: SCR-orders-new
feedback: [FB-orders-new-stock-error]
evidence: [{source_id: SRC-order-new, source_snapshot_id: SNAP-20260826-001, path: src/pages/OrderNew.tsx, start_line: 52, end_line: 63, content_hash: "sha256:...", evidence_grant_id: EVG-work-17-010}]
status: draft
```

`alt`를 부모 edge 안에 중첩하지 않는다. 정상·실패·잔류 전이가 모두 고유 `edge_id`를 가져야 `path`, all-transitions coverage, 예외 시나리오가 동일한 단위를 참조할 수 있다.

### 1.3 FACT 제약층 — 통제 어휘

guard/effect/entry_guards 는 **여기 등록된 술어 ID만** 사용할 수 있다 (put이 강제).

```yaml
schema_version: 2
project_id: PRJ-commerce
analysis_run_id: RUN-20260826-001
source_snapshot_id: SNAP-20260826-001
pred_id: PRED-order.status
values: [CREATED, PAID, SHIPPED, CANCELLED]   # enum이면 값 전수
transitions:                                  # 백엔드 상태기계가 있으면
  - CREATED → PAID
  - PAID → SHIPPED
source: code                                  # code | db | assumed
evidence: [{source_id: SRC-order-model, source_snapshot_id: SNAP-20260826-001, path: src/server/models/order.ts, start_line: 12, end_line: 20, content_hash: "sha256:...", evidence_grant_id: EVG-work-22-002}]
---
schema_version: 2
project_id: PRJ-commerce
analysis_run_id: RUN-20260826-001
source_snapshot_id: SNAP-20260826-001
pred_id: PRED-user.role
values: [BUYER, SELLER, ADMIN]
source: code
evidence: [{source_id: SRC-auth-roles, source_snapshot_id: SNAP-20260826-001, path: src/auth/roles.ts, start_line: 3, end_line: 3, content_hash: "sha256:...", evidence_grant_id: EVG-work-22-004}]
```

`source: assumed`(코드에서 못 찾고 가정한 것)는 커버리지 리포트에 별도 집계된다.

### 1.4 WIKI 워크플로우 레코드 (업무층)

```yaml
schema_version: 2
project_id: PRJ-commerce
analysis_run_id: RUN-20260826-001
source_snapshot_id: SNAP-20260826-001
workflow: WF-ORDER-PLACE
goal: "사용자가 상품을 선택해 주문을 완료한다"
entry_screens: [SCR-products-list]
success_terminal: PRED-order.status=PAID && at(SCR-orders-complete)
failure_terminals:                            # 업무적으로 의미 있는 실패 종착
  - PRED-order.status=CANCELLED
variation_axes: [tab.payment]                 # 케이스 분화 축 — 실제 sub_states/guard 축과 대응해야 함
combination:                                  # 분기 조합 정책 (§2.4, walk가 사용)
  strategy: base-choice                       # base-choice(기본) | pairwise
  axis_defaults: {tab.payment: card}          # 기준 케이스·예외 케이스의 대표 맥락 값 (UI 기본값 우선)
depends_on: [WF-AUTH-LOGIN]                   # 선행 워크플로우
cites: [SCR-orders-new, E-0042, PRED-order.status]   # 근거로 삼은 FACT
status: draft
```

### 1.5 시나리오 산출 레코드

```yaml
schema_version: 2
project_id: PRJ-commerce
analysis_run_id: RUN-20260826-001
source_snapshot_id: SNAP-20260826-001
scenario_id: SCN-ORD-003
workflow: WF-ORDER-PLACE
kind: normal                                  # normal | exception; exception edge 경유 시 exception
variation: {tab.payment: card}                # 이 케이스가 커버하는 축 값 (커버리지 집계 키)
preconditions:
  - text: "BUYER 권한으로 로그인 상태"
    predicate_refs: [PRED-auth.login=true, PRED-user.role=BUYER]
    data_binding_keys: [user.buyer]
  - text: "장바구니에 상품 1개 이상"
    predicate_refs: [PRED-cart.items]
    data_binding_keys: [cart.items]
path: [E-0001, E-0017, E-0042]                # 엣지 시퀀스 (walk 산출)
steps:                                        # 절차·기대결과 1:1 번호 대응
  - n: 1
    action: "'주문하기' 버튼을 클릭한다"
    action_ref: {edge: E-0042, element: EL-orders-new-btn-submit}
    expected: "'주문이 완료되었습니다' 토스트가 표시되고 '주문 완료' 화면으로 이동한다"
    assertion_refs: [FB-orders-new-success, SCR-orders-complete]
```

**서술 규약**: action은 레코드의 `label`만 사용. expected는 `feedback.text`·`title`·`displays.shape` 등 **관측 가능한 형태**만 사용 — "주문번호가 표시된다"(O), "주문번호 ORD-20260825가 표시된다"(X, 값 창작 금지).

**소유권 규약**: `label`은 evidence 범위 안에서 LLM이 사람용 의미를 보강할 수 있지만, `interaction.target_candidates`는 source scanner가 소유하는 실행 계약이다. semantic label 변경으로 role-name/label/CSS candidate를 다시 쓰지 않는다. 코드에서 stable binding을 확인하지 못한 경우 LLM이 locator를 만들지 않는다.

`action`과 `expected`는 사람·UI용 문장이다. 테스트 수행은 이 문장을 다시 해석하지 않고 `action_ref`, `assertion_refs`, FACT의 `interaction.target_candidates`, `data_binding_keys`로 immutable `RunnerPlan`을 만든다. `target_candidates`는 web의 test-id/role/label/CSS, Windows의 automation-id, Android resource-id, iOS predicate, 근거가 있는 visual description을 담을 수 있다. 좌표는 canonical candidate로 저장하지 않는다. 실행 가능한 binding이 없으면 임의 selector·automation ID·좌표를 만들지 않고 계획 검증 실패 또는 `INCONCLUSIVE`로 남긴다.

---

## 2. Tools (backend adapter / Pi tool)

### 2.1 결정적 추출 — LLM 무관여

**`scan --src <dir> --snapshot <source_snapshot_id> --staging <path>`**
AST 기반 1패스. 결과를 `staging/{workId}/source/`에 쓰고 source completion gate가 run artifact로 승격한 뒤 `scenario-index.sqlite`에 projection한다. 별도 `graph.db`를 만들지 않는다. 산출:
- source ID, 파일 hash, 언어, include/exclude 결과를 포함한 `SourceSnapshot`
- URL 라우트 테이블 → 화면 ID 결정적 채번 (SCR- 레코드 골격 생성)
- URL 라우터가 없는 상태 기반 UI → 가장 가까운 **대문자로 시작하는 React `*Page` 컴포넌트**를 virtual screen으로 채번하고 interaction/API를 해당 screen에 귀속 (`setPage`, `handlePage` 같은 소문자 helper는 제외)
- import 그래프 (클로저 계산용)
- API 호출 지점 인벤토리 (파일:라인 → METHOD/경로)
- JSX 상호작용 요소 인벤토리 (button/link/input/Tab/Modal 등)
- **i18n 테이블**: 메시지 리소스 파일 파싱 → 키→문자열 매핑 (레이블·피드백 텍스트 해석용)
- 파일 해시 테이블 (증분 갱신용)

**`closure <screen_id> [--budget <tokens>]`**
해당 화면의 컴포넌트 클로저(직접·간접 import 중 화면 렌더에 관여하는 것)를 계산해 토큰 예산 내 소스 슬라이스로 반환. **추출기의 유일한 소스 입력 경로.** 반환할 때 `evidence_grant_id`와 각 slice의 content hash를 journal에 기록한다. 예산 초과 시 공유 컴포넌트를 요약 스텁으로 대체하고 그 사실을 명시한다.

**`i18n resolve <key>`** — 키→문자열 조회 (추출기가 label 채울 때 사용)

### 2.2 그래프 제출·검증·조회

LLM에는 SQLite 쓰기 권한과 `graph put`을 노출하지 않는다. 작업자는 배정된 staging 경로에 레코드를 쓰고 `work.submitArtifacts`로 제출한다. backend completion gate의 내부 **`graph validate --type <node|edge|pred|workflow|scenario> --file <record>`** 가 다음 검증을 수행한다.

| # | 검증 | 실패 시 |
|---|---|---|
| V1 | 스키마 (필수 필드, enum 값, ID 형식) | reject + 필드별 에러 |
| V2 | evidence 실존 (snapshot·hash·라인 범위 유효, **현재 work에 발급된 evidence grant인지**) | reject |
| V3 | 참조 ID 실존 (to 화면, triggers API, cites 등) — 없으면 `unresolved`로만 허용 | reject |
| V4 | 어휘 검사: guard/effect가 등록된 PRED만 사용 | reject + 미등록 술어 목록 |
| V5 | 완전성: scan 인벤토리 대조 — API/상호작용 누락, label 미해석, unresolved 비율 상한 | warn; stage completion gate에서는 정책 상한 초과 시 reject |
| V6 | 표현층: elements에 label 없으면 unresolved 요구 | reject |
| V7 | 실행 handoff: scenario step의 `action_ref`·`assertion_refs` 실존, 자동화 가능 여부 명시 | reject |
| V8 | first-class edge: 정상·예외 전이 모두 고유 ID, nested `alt` 금지 | reject |
| V9 | edge 완전성: 모든 verified FACT edge가 reachable WIKI cited path와 SCENARIO path에 포함 | `WIKI_EDGE_COVERAGE_INCOMPLETE` 또는 `SCENARIO_EDGE_COVERAGE_INCOMPLETE` |

에러는 기계가 읽을 수 있는 형식으로 반환 (재시도 루프의 입력).

읽기는 `ArtifactQueryService`를 통해 Pi tool **`artifact.get <id>`** / **`artifact.edges --from <id>`** / **`artifact.query <filter> --limit N`** 으로 노출한다. 모든 query는 row·byte 상한과 cursor를 강제하며, LLM은 그래프 전체를 받을 수 없다.

backend 전용 **`graph todo [--stage <extract|link|link-ambiguous|fact-gate|wiki|wiki-gate|narrate|scenario-gate>] [--limit N]`** 는 `WorkStateService`의 canonical work item과 artifact projection에서 워크리스트를 만든다. 미추출 화면, unresolved 참조, 검증 실패, 미검수 레코드, 미서술 경로가 여기에 포함된다. Pi 모델이 todo 상태를 직접 변경하지 않는다.

### 2.3 후처리 — LLM 무관여

**`link --auto`** — cross-reference 결정적 연결. 모호 건(전이 대상 후보 복수 등)만 `link-ambiguous` 워크리스트에 적재. 연결 결과도 staging artifact이며 gate 승인 전에는 canonical 관계로 조회하지 않는다.

**`walk <workflow_id> [--strategy base-choice|pairwise|full] [--loop-bound 1] [--max-paths N]`**
entry_screens → terminal 술어까지 바운디드 DFS. 해당 workflow가 `cites`한 `E-*`만 adjacency에 포함해 업무 범위 밖 edge가 경로에 섞이지 않게 한다. guard 실행 가능성은 PRED 값 도메인 기반 제약 검사로 기계 필터링한다. 초기 상태는 `combination.axis_defaults`이며, 각 edge의 canonical predicate `effect`를 다음 edge guard 평가 전에 상태 벡터에 적용한다. 따라서 앞 action이 생산해야 하는 상태를 precondition으로 우회하거나 뒤 action부터 시작할 수 없다. **경로 열거가 아니라 §2.4의 조합 정책에 따른 케이스 집합 생성기** — 전략 미지정 시 WF 레코드의 `combination.strategy`를 읽는다. 산출: 경로(엣지 시퀀스) + 각 스텝의 **경로 상태 벡터**(현재 참인 술어 집합 — 누적 이력이 아니라 스냅샷) + 케이스별 `variation` 값.

**`coverage [--workflow <id>]`**
all-transitions·each-choice·의존 축 조합 커버리지 수치, 미커버 엣지/축 옵션 목록, unresolved/assumed 집계. "전수" 대신 이 수치가 커버리지 보장의 근거가 된다.

### 2.4 분기 조합 정책 (walk의 케이스 생성 규칙)

**원리**: 폭발은 분기 자체가 아니라 독립적인 분기 축들을 서로 곱하는 데서 온다. "분기마다 케이스 분리"를 모든 분기에 재귀 적용하면 곧 전체 경로 열거(곱셈)가 되므로, 분기를 유형별로 다르게 취급해 **독립 축은 변주(덧셈)로, 의존 축만 조합(곱셈)으로** 처리한다. 유형 판정은 휴리스틱이 아니라 술어 그래프에서 기계적으로 이뤄진다.

| 분기 유형 | 기계 판정 기준 | 케이스 생성 규칙 | 증가 방식 |
|---|---|---|---|
| **종착 분기** (성공/실패, 승인/반려) | `kind: exception` 엣지 경유 또는 상이한 terminal 도달 | 각각 별도 케이스. 다른 축과 조합하지 않고 대표 맥락(`axis_defaults`) 고정 | 덧셈 |
| **독립 축** (합류하는 탭·선택) | 축 간 공유 PRED 없음 | **base-choice**: 기준 케이스 1개(전 축 기본값) + 축마다 나머지 옵션만 바꾼 변주 → each-choice 커버리지 보장 | 덧셈 |
| **의존 축** | 한 축의 guard/effect가 다른 축이 세팅하는 PRED를 참조 (예: 쿠폰 guard가 `PRED-payment.method=card` 참조) | 해당 축 **쌍만** 실행 가능 조합 전부 생성, 나머지 축은 base-choice 유지 | 국소 곱셈 |
| **상호작용 의심** (명시적 결합은 없으나 중요 업무) | WF 레코드에 `strategy: pairwise` 지정 | 모든 축 쌍의 값 조합이 최소 1회 등장하는 2-way 케이스 집합 | 준선형 |
| **루프** (뒤로가기·재시도) | 사이클 감지 | 0회/1회만 (경계 검증 필요 시 `--loop-bound N`), 조합 대상 아님 | 상수 |

예시 — 결제수단(3) × 쿠폰(2) × 배송지(2) × 회원등급(3), 전부 독립일 때: 전체 조합 36케이스 → base-choice **1 + 2 + 1 + 1 + 2 = 7케이스**. 모든 선택지가 최소 1회 등장하므로 "모든 분기 선택지 커버" 주장은 유지된다.

- `axis_defaults`(대표 맥락)는 WIKI 저자가 정하되 UI 기본값(sub_states.default)을 우선한다.
- pairwise 승격 대상 선정은 wiki-authoring 스킬의 판단 기준을 따른다 (중요 업무·결함 이력·요청 명시).
- `--strategy full`(전 조합)은 축 2개 이하 소형 워크플로우 검증용 외 사용 금지 — put이 아닌 walk 실행 시 축 수 검사로 경고.

**`verify <record_id>`** — 레코드의 snapshot/hash evidence 슬라이스를 다시 읽고 reviewer 전용 evidence grant로 반환한다. reviewer는 verdict artifact만 제출하며 FACT/WIKI/SCENARIO를 직접 수정하거나 status를 확정하지 않는다.

**`render [--view screens|workflows|scenarios]`** — 레코드 → 사람이 읽는 md/xlsx 뷰 (검수용).

---

## 3. 하네스

### 3.1 공통 지침 (전 서브에이전트 시스템 프롬프트 공통부 — 그대로 사용)

```
너는 소스코드 분석 그래프 구축 파이프라인의 단일 역할 에이전트다.

[출력 계약]
- 출력은 지정된 스키마의 YAML만 허용한다. 산문·설명·마크다운 금지.
- guard/effect/entry_guards에는 graph에 등록된 PRED ID만 쓴다. 자유 텍스트 금지.
- LLM FACT patch는 복수 선행조건과 후속 상태를 각각 `guard.all[]`, `effect.all[]`의 `{predicate_key,value}` assignment로 제출하고 backend가 canonical `PRED-a=value && PRED-b=value` 문자열로 컴파일한다. 단일 predicate expression 입력은 하위 호환으로 유지하되 자연어 effect는 거부한다.
- 무조건 전이는 patch에서 `guard`를 생략한다. provider가 동일 의미의 `guard.all: []`을 반환하면 compiler 경계에서 guard 생략으로만 좁게 정규화한 뒤 전체 schema/reference gate를 적용한다.
- FACT author는 제안하는 각 edge의 trigger evidence에서 `disabled={condition}`, `disabled={!value}`, 조건부 렌더링, handler early return을 검사하고, 실행 가능 상태의 모든 조건을 predicate/`guard.all`로 등록한다. effect의 조건부 자연어는 guard를 대체하지 않는다.
- 모든 사실 라인에 source_snapshot_id, content_hash, evidence_grant_id를 포함한
  evidence를 붙인다. 현재 work에 도구가 제공한 슬라이스만 허용된다.

[정직성]
- 확실하지 않으면 unresolved: true 와 reason을 커밋한다. 추측하지 않는다.
- 도구가 반환하지 않은 ID·파일 경로·레이블 문자열을 생성하지 않는다.
- 레이블은 코드의 JSX 텍스트 또는 i18n resolve 결과만 쓴다.

[도구 규율]
- 소스 접근은 closure 를 통해서만 한다. 디렉토리·파일을 직접 cat 하지 않는다.
- 그래프 조회는 상한이 적용된 artifact get/edges/query 로만 한다.
- 쓰기는 배정된 staging/{workId}/ 안에서만 하고 work.submitArtifacts로 제출한다.
- canonical artifact, index, WORK_STATE.md를 직접 수정하지 않는다.
- 한 실행에서 배정된 항목 1건만 처리한다.

[재시도]
- submitArtifacts 또는 completion gate가 거부되면 unmetGates가 지적한 항목만 수정한다.
- schema·권한·경로·ID 충돌은 자동 재시도하지 않는다. 일시적 provider 오류만
  backend retry policy에 따라 최대 2회 재시도한다.
- 해결하지 못하면 work.reportFailure로 구조화해 남긴다.
```

### 3.2 가드레일 — 규칙과 집행 지점의 매핑

프롬프트는 어기지만 검증기는 못 어긴다. 모든 규칙에 기계 집행 지점을 둔다.

| 가드레일 | 프롬프트 | 기계 집행 |
|---|---|---|
| evidence 필수·실존 | 공통 지침 | put V2 |
| 현재 work에서 읽은 파일만 evidence | 공통 지침 | journal의 evidence grant → validate V2 |
| 통제 어휘 강제 | 공통 지침 | put V4 |
| ID 창작 금지 | 공통 지침 | put V1·V3 (형식·실존) |
| 추측 대신 unresolved | 공통 지침 | reviewer verdict + completion gate |
| 게으름(unresolved 남발·필드 누락) | — | validate V5 + stage별 completion threshold |
| 레이블 미해석 | 공통 지침 | put V5·V6 |
| 무한 재시도 | 공통 지침 | Runtime retry policy: 일시 오류만 최대 2회 |
| 컨텍스트 폭발 | 공통 지침 | closure 예산 상한, 화면당 프로세스 1회 실행 |
| 층 오염 (WIKI 저자가 소스 접근) | 역할 프롬프트 | WIKI 저자 프로세스에 closure 도구 자체를 미장착 |

### 3.3 정보 전달 계약 (에이전트 간)

- 에이전트끼리 직접 대화하지 않는다. **모든 전달은 검증·저장된 artifact와 ID 관계 경유.**
- 각 단계의 입력은 "이전 단계가 durable commit한 artifact의 bounded 부분 조회"로만 정의된다.
- 서술기 계약: `steps.action`은 `element.label`만, `steps.expected`는 `feedback.text/title/displays.shape`만 인용한다. `action_ref` 또는 `assertion_refs` 없는 step은 제출이 거부된다.

### 3.4 모델 역할과 Qwen3.6 보정

- 모델 설정은 고정 모델명이 아니라 `author`와 `reviewer` 역할 binding으로 저장한다. 기본 예시는 author=Qwen3.6, reviewer=GLM-5.2다.
- reviewer 미설정 시 author 자체 검토를 허용하되 run manifest에 `assurance: single-model`을 기록한다. 별도 reviewer 통과로 표시하지 않는다.
- 추출·판정 계열 temperature 0~0.2. 스키마 필드는 최대한 enum.
- 한 호출에 판단 하나. 비교·종합 작업은 항목 단위로 쪼갠다.
- 긴 체인을 한 컨텍스트에서 돌리지 않는다 — 워크리스트 기반으로 항목당 pi 프로세스를 새로 띄운다.

---

## 4. Skills

각 서브에이전트는 자기 스킬만 로드한다. **본체는 규칙이 아니라 "입력 → 올바른 레코드" few-shot 예시**다 (이 급 모델에는 예시가 지침 문장보다 효과적).

### 4.1 `fact-extraction` (추출기 전용)

- 워크플로우: closure 수신 → scan 인벤토리와 대조 → 노드+엣지 레코드 작성 → put → 에러 수정 루프
- **패턴 매핑표 (React 기준)**:

| 코드 패턴 | 스키마 매핑 |
|---|---|
| `<Tabs>` / 조건부 렌더 축 | sub_states |
| 삼항·`&&`·`disabled=` | enabled_when |
| `useNavigate`·`<Link>`·라우트 push | 전이 후보 (엣지) |
| fetch/axios 호출 | apis + 엣지 triggers |
| toast·alert·에러 상태 렌더 | feedback + observable assertion |
| `t('key')` | `i18n resolve` 호출 후 label/text |
| 서버 데이터로 그리는 목록·값 | displays (shape만) |
| 못 푸는 동적 라우트·서버 구동 메뉴 | unresolved + reason |

- 완결 예시 2~3개: 실제 화면 슬라이스 → 완성 레코드 (정상 1, 탭 분기 1, unresolved 포함 1)
- **스택별 변형판을 별도 스킬로**: `fact-extraction-react`, `-vue`, `-nexacro`, `-websquare`, `-wpf-winui`, `-android`, `-ios`. 지원하지 않는 stack의 mapping 규칙을 다른 stack에서 유추하지 않는다.
- 상호작용 요소는 코드에서 확인된 플랫폼별 target 후보와 input binding key를 함께 기록한다. 후보가 없으면 시나리오 표시에는 사용할 수 있지만 `automatable: false` 또는 visual probe가 필요한 `automation_mode: visual-candidate-required`로 표시한다.

### 4.2 `edge-linking` (링커 판정 전용)
모호한 전이 대상 판정 기준(라우트 패턴 매칭 우선순위, 조건부 이동의 분해)과 판정 예시.

### 4.3 `wiki-authoring` (WIKI 저자 전용)
업무 분류 기준, goal 서술법, terminal 술어 작성법(등록된 PRED로만), variation_axes 선정 기준(실제 sub_states/guard 축과 대응), depends_on 판단, "업무적 정상 선택" 판단 예시. **소스 코드 언급 자체가 없음 — 그래프 뷰만 다룬다.**
추가: `combination` 필드 작성 기준 — strategy 기본은 base-choice, pairwise 승격은 (a) 핵심 수익/규제 업무 (b) 축 간 업무적 상호작용이 의심되나 guard에 명시되지 않은 경우 (c) 발주처 요청 명시 시. axis_defaults는 UI 기본값 우선, 없으면 가장 일반적 사용 경로의 값.

### 4.4 `scenario-writing` (서술기 전용)
경로 상태 벡터+엣지 시퀀스 → steps 변환 규약. 절차·기대결과 1:1 번호 대응. 관측 가능 형태 서술 규칙(값 창작 금지). 구조화 precondition은 **경로 edge guard와 WIKI variation_axes/axis_defaults를 합쳐** 결정론적으로 도출한다. `predicate_refs`와 `data_binding_keys`는 backend-owned immutable 필드이고, `text`만 author가 같은 등록 조건을 사람이 읽는 문장으로 바꿀 수 있다. 조건부 렌더·enabled·handler early return이 있는 전이는 FACT 단계에서 등록 predicate guard를 가져야 하며 effect 문장에만 숨길 수 없다. 정상/예외(kind) 구분 기준(`kind: exception` 엣지 경유 여부). 모든 step의 `action_ref`·`assertion_refs` 작성. 완결 예시 2개(정상 1, 예외 1).

### 4.5 `gate-review` (게이트 전용)
체크리스트:
- verify 슬라이스가 각 주장을 **실제로 지지**하는가 (evidence 위치는 맞는데 내용이 다른 경우)
- 과잉 일반화·guard 누락·`kind: exception` 경로 누락
- label/text가 슬라이스의 실제 문자열과 일치하는가
- (WIKI 건) cites한 FACT가 존재·정합하는가, terminal 술어가 등록 PRED인가, variation_axes가 실제 분기 축인가
- 판정 출력: `pass` | `fail + 사유(수정 지시 가능한 구체성)`

reviewer의 판정은 semantic verdict artifact다. reviewer에게 canonical artifact status 쓰기 도구를 주지 않으며, backend completion gate가 verdict·schema·관계·coverage를 함께 확인해 최종 status를 commit한다. FACT와 WIKI뿐 아니라 최종 SCENARIO에도 동일한 독립 semantic gate를 적용한다.

---

## 5. Sub-agents

| 에이전트 | 모델 | 입력 (전부 도구 경유) | 출력 | 스킬 | 장착 도구 |
|---|---|---|---|---|---|
| AnalysisCoordinator | **없음 (backend)** | canonical work item | work 생성·completion gate·commit | — | scan, todo, link, walk, coverage, render, WorkStateService |
| `fact-analyst` | author | closure 1화면 + scan 인벤토리 | staging의 노드+엣지 draft | fact-extraction-{stack} | closure, i18n, artifact 조회, staging.write, work.* |
| `edge-linker` | author | 모호 건 1건 + 양측 레코드 | 선택+근거 draft | edge-linking | artifact 조회, staging.write, work.* |
| `fact-reviewer` | reviewer | 레코드 1건 + verify 슬라이스 | semantic verdict artifact | gate-review | artifact 조회, verify, staging.write, work.submitArtifacts |
| `wiki-writer` | author | **bounded 그래프 뷰만** | 워크플로우 draft | wiki-authoring | artifact 조회, staging.write, work.* (**closure 미장착**) |
| `wiki-reviewer` | reviewer | 워크플로우 1건 + cites 레코드 | semantic verdict artifact | gate-review | artifact 조회, staging.write, work.submitArtifacts |
| `scenario-designer` | author | walk 경로 1개 + 경유 레코드 | 시나리오 draft | scenario-writing | artifact 조회, staging.write, work.* |
| `scenario-reviewer` | reviewer | 시나리오 + 경유 FACT/WIKI | semantic verdict artifact | gate-review | artifact 조회, verify, staging.write, work.submitArtifacts |

reviewer evidence 범위는 author의 stage 입력 계약과 대칭이어야 한다. FACT reviewer만 source evidence로 추출 누락을 요구할 수 있다. WIKI reviewer는 verified FACT graph와 cites 레코드만 사용하며 source-only behavior를 WIKI 요구로 추가하지 않는다. SCENARIO reviewer의 source verify는 upstream FACT 주장의 진위 확인에만 사용하고 FACT/WIKI에 없는 절차나 terminal을 요구하지 않는다.

게이트를 GLM-5.2로 분리하는 이유: 추출과 같은 모델로 검증하면 오류가 상관된다. 하이브리드 구성의 최적 투입 지점.

### 오케스트레이터 (backend 의사코드)

```ts
await coordinator.runDeterministicWork("analysis.source-map", scanSourceSnapshot);
await coordinator.runBoundedQueue("extract", "fact-analyst");
await coordinator.runDeterministicWork("link", linkAuto);
await coordinator.runBoundedQueue("link-ambiguous", "edge-linker");
await coordinator.runBoundedQueue("fact-gate", "fact-reviewer");
await coordinator.requestStageCompletion("fact");

await coordinator.runBoundedQueue("wiki", "wiki-writer");
await coordinator.runBoundedQueue("wiki-gate", "wiki-reviewer");
await coordinator.requestStageCompletion("wiki");

await coordinator.runDeterministicWork("walk", walkVerifiedWorkflows);
await coordinator.runBoundedQueue("narrate", "scenario-designer");
await coordinator.runBoundedQueue("scenario-gate", "scenario-reviewer");
await coordinator.runDeterministicWork("coverage", calculateCoverage);
await coordinator.requestStageCompletion("scenario");
```

위 코드는 shell loop가 아니다. 각 호출은 `workId`, `expectedRevision`, staging scope, retry policy를 가진 durable work이며 결과를 journal에 commit한 뒤에만 다음 stage로 진행한다.

---

## 6. 실행 파이프라인과 산출물

```
scan(무LLM) → 추출 루프 → link+판정 → FACT 게이트
→ WIKI 저작 → WIKI 게이트 → walk(무LLM) → 서술 → SCENARIO 게이트
→ coverage+render(무LLM)
```

- **재개**: 어느 단계에서 죽어도 journal/checkpoint가 남은 work를 안다. 파일 변경 시 새 source snapshot과 hash를 대조해 영향 FACT를 새 attempt로 재추출하고 downstream invalidation을 관계 기반으로 계산한다. 기존 verified artifact는 덮어쓰지 않는다.
- **실패 처리**: 일시적 provider 오류만 최대 2회 재시도한다. schema·권한·경로·ID 오류는 즉시 failed → 사람 검토 큐(render 뷰에 표시). 독립 work 실패가 stage completion threshold를 깨지 않는 범위에서만 파이프라인을 계속한다.
- **FACT 의미 교정**: schema/reference/identity/evidence gate를 통과한 FACT가 reviewer의 actionable issue로 거부되면 동일 work/evidence 범위에서 replacement semantic patch를 최대 6회 재작성한다. 63개 interaction을 가진 실제 복합 UI에서 reviewer가 업로드 가드, 흐름 결과, 업무 선택 상태와 exception outcome을 연속 verdict에서 단계적으로 발견한 이력이 있으므로 author는 후속 action의 eligibility/payload를 바꾸는 선택·토글과 결과 확인까지 최초 전수 점검하고 reviewer는 한 verdict에 모든 지원 가능한 누락을 모아야 한다. 다음 reviewer에는 이전 결정 전체 합계 16KB 이내의 bounded decision history를 untrusted consistency context로 전달해 같은 immutable evidence 범위에서 add/remove 결정을 근거 없이 반전하지 못하게 한다. exception edge는 정상 trigger의 executable guard와 사용자 가시 실패를 구분하는 등록 predicate effect를 가져야 한다. 그래도 남는 확률적 누락은 6회 상한 안에서 교정하며 일곱 번째 semantic 거부는 terminal failed다. rejected patch와 bounded issue codes는 untrusted defect report이며 canonical ID/evidence를 author에게 위임하지 않는다. 최초 patch와 각 replacement가 `predicate_key`/`predicate_value` 참조 또는 compiled edge guard/effect predicate 등록 정합성만 실패하면 같은 work/evidence 범위에서 최종 contract correction을 정확히 1회 허용한다. 이는 semantic repair 횟수가 아니며 S/U/A ref, evidence, scope, 일반 schema 오류에는 적용하지 않는다. replacement를 backend가 처음부터 다시 compile·validate·review한다.
- **WIKI 의미·커버리지 교정**: WIKI가 semantic reviewer에서 교정 가능한 issue로 거부되거나 deterministic 검증 결과가 `WIKI_EDGE_COVERAGE_INCOMPLETE`만 포함하면 동일 work와 verified FACT 범위에서 replacement를 정확히 1회 작성한다. 두 번째 schema/reference/reachability/coverage/reviewer 거부는 terminal failed다.
- **완료 gate**: WIKI는 verified FACT edge 전수를 reachable cited path로 cover해야 하고, SCENARIO는 같은 edge 전수를 path로 cover해야 한다. `coverage.json`의 `uncovered_edge_ids=[]`와 `coverage_percent=100`이 아니면 manifest 완료와 `SCENARIO → READY`를 commit하지 않는다.
- **최종 산출물**:
  1. run별 immutable `source/`, `facts/`, `wiki/` artifact와 manifest hash
  2. `scenario-set.json` — `SCN-*` 업무별 E2E, 절차/기대결과 1:1, action/assertion 참조 포함
  3. `coverage.json`/검수 리포트 — all-transitions·each-choice, 의존 축 조합, 미커버 엣지/축 옵션, unresolved/assumed 목록
  4. `.scenarioforge/state/scenario-index.sqlite` — 위 산출물에서 재구축 가능한 bounded query projection
  5. 테스트 수행 handoff용 immutable `ScenarioSnapshot` 생성 가능 상태

---

## 7. 품질 지표 (주장 가능한 수치)

| 지표 | 정의 | 용도 |
|---|---|---|
| 전이 커버리지 (all-transitions) | 시나리오에 1회 이상 포함된 엣지 / 전체 verified 엣지 | "커버리지 보장" 주장의 1차 근거 |
| 분기 선택지 커버리지 (each-choice) | 시나리오에 등장한 축 옵션 수 / 전체 축 옵션 수 | "모든 분기 선택지 커버" 주장의 근거 |
| 의존 축 조합 커버리지 | 커버된 의존 축 값쌍 / 실행 가능한 전체 값쌍 | 결합 분기 커버 근거 |
| 케이스 통제 배율 | 생성 케이스 수 / 전체 조합 수 (이론치) | 조합 정책의 효율 제시 (예: 7/36) |
| 근거율 | evidence 검증 통과 라인 / 전체 사실 라인 | 환각 통제 근거 |
| 해상률 | resolved / (resolved+unresolved) | 정적 분석 한계의 정직한 공개 |
| 게이트 통과율 | 1차 pass / 전체 | 추출 품질 모니터링 |
| assumed 술어 수 | source: assumed인 PRED | 데이터/권한 입력 보강 필요 지점 |
