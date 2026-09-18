# ScenarioForge

소스코드만 분석해 **로그인부터 업무 결과까지 이어지는 완결 사용자 여정 테스트 시나리오**를 도출하고, 그 시나리오를 실제 화면에서 수행해 판정과 증적까지 남기는 설치형 애플리케이션입니다.

## 1. 목표

이 저장소는 다음 가설을 검증하는 PoC입니다.

> 소스코드로부터 사용자 여정의 시나리오 테스트 케이스를 도출할 수 있다.

가설이 참이려면 세 가지가 성립해야 합니다.

1. 화면 소스에서 **사용자가 보는 정보**, **사용자가 누를 수 있는 액션 포인트**, **액션별 시스템 동작과 화면 전이**를 공통 규격으로 뽑아낼 수 있다.
2. 그 정보를 이으면 **화면 노드 그래프**가 만들어진다.
3. 그래프를 첫 화면부터 끝까지 따라가면 사용자가 실제로 밟을 수 있는 경로가 시나리오 케이스로 구성되고, 그것이 시스템의 대부분을 덮는다.

## 2. 접근 방식

### 2-1. 생성 트랙 — 백엔드가 구조를 소유하고 모델은 의미만 채운다

분석은 일회성 프롬프트가 아니라 **단계형 Pi 코딩 에이전트 워크플로**입니다. 각 단계는 산출물을 남기고 다음 단계가 그것을 입력으로 받습니다.

```text
01-source-survey → 02-source-gap-review → 03-business-classification
  → 03a-fact-graph → 03b-business-workflow-mapping
  → 04-user-journeys → 04a-user-journey-workflow-link → 05-scenario-cases
```

| 백엔드가 소유 (모델이 만들지 못함) | 모델이 채움 |
| --- | --- |
| 소스 inventory, 스냅샷, 근거 grant, 정본 ID(화면·요소·API·edge), hash, revision | 동작·화면의 의미, 업무 분류, 여정 서술, 케이스의 사람이 읽는 step·기대 결과 |

이 경계가 이 프로젝트의 핵심 설계입니다. 모델이 긴 ID를 옮겨 적다 변형시키는 사고가 반복되자, 정본 식별자를 백엔드가 소유하고 모델에는 불투명 참조만 넘기도록 바꿨습니다.

### 2-2. 수행 트랙 — 컴파일된 step 봉투 + 제안 게이트

순수 CUA(매 step 화면 판단과 행동을 모델에 위임) 대신, 결정론적 컴파일러가 시나리오를 고정된 step 봉투로 바꾸고 모델에는 "고정된 대상이 현재 화면 어디에 있는가"만 묻습니다. 계획과 판정은 코드가 가집니다. operator와 observer 세션을 분리해 모델이 자기 행동을 판정하지 못하게 합니다.

## 3. 진행 상황

기준 시점 2026-09-18, 기준 run `RUN-AXSE-AGENTIC-20260918-01` ([상세 보고서](docs/reports/2026-09-18-complete-journey-milestone.md)).

### 생성 트랙

AXSE 대상에서 01~05 전 단계가 통과했고 **완결 사용자 여정 2/2**가 생성됐습니다.

| 지표 | 값 |
| --- | --- |
| FACT 그래프 | 화면 9, 요소 63, edge 56 |
| 시나리오 | 58건 (정상 51, 예외 7) |
| edge coverage | 56/56 (100%) |
| 완결 여정 | 2/2, 미완결 0 |

| 시나리오 | 종류 | step | 경로 |
| --- | --- | --- | --- |
| `SCN-JOURNEY-J001-001` | normal | 28 | loginform → login → main → upload → parsed-db → business → scenario |
| `SCN-JOURNEY-J002-001` | exception | 22 | 동일 (업로드 실패·복구 포함) |

J001은 step 25~27에서 CSV·Excel을 내려받고 step 28에서 로그아웃합니다. 로그인부터 산출물 확보까지 한 경로로 이어집니다.

> 모든 산출물은 `validation_scope: local-probe-contract-only`, `product_stage_acceptance: not-attempted`인 로컬 probe입니다. 제품 backend 등록은 시도하지 않았습니다.

### 수행 트랙

AXSE·RA-DAR 두 대상에서 실제 모델 왕복으로 검증했습니다 ([측정 기록](docs/validation/vision-execution-round-trip)). G1 step 그라운딩은 AXSE 97.4%, RA-DAR 71.4%입니다. 아직 없는 것은 웹 외 대상(Windows·mobile) 어댑터입니다.

## 4. 해결한 문제

2026-09-17~18 세션에서 제품 결함 25건을 고쳤습니다. 전부 회귀 테스트를 동반합니다. 상세는 [보고서 3절](docs/reports/2026-09-18-complete-journey-milestone.md)에 있습니다.

핵심은 **실패의 대부분이 모델 능력이 아니라 계약 쪽 문제였다**는 점입니다.

### 4-1. 모델링 부재 (2건)

`<Shell>`이 감싸는 단계 화면에서 지속 크롬(로그아웃·사이드바)에 도달할 수 없었습니다. 화면 포함관계가 모델에 없어 여정이 종료에 닿지 못했습니다. `FactScreen.shell_screen_id`를 추가하고 스캐너가 JSX 중첩에서 이를 도출하게 했습니다. 여정 단위 시나리오를 컴파일하는 `compileJourneyCompleteScenarios`도 새로 만들었습니다.

### 4-2. 계약 모순 (4건) — 어떤 모델 출력으로도 통과 불가

예를 들어 `FACT_SOURCE_ACTION_UNRESOLVED`는 이렇게 맞물려 있었습니다.

```text
feasibility가 unresolved면 edge 금지
  → edge가 없으면 action_kind를 강제로 unresolved로 되돌림
  → action_kind가 unresolved면 오류
```

edge를 만들어도 위반, 안 만들어도 위반입니다. 여정 링크 단계에도 같은 구조가 세 건 더 있었습니다.

### 4-3. 보정 권한 부재 (7건)

`createFactCorrectionPlan`이 오류 코드를 처리하지 않아, 모델이 그 오류를 고칠 필드 권한을 받지 못했습니다. 모델은 매 라운드 성실히 값을 넣었지만 백엔드가 그것을 버렸습니다.

### 4-4. write 슬롯 소모 (6건)

거부된 write가 전제조건 검사 **전에** 시도 횟수를 증가시켜, "아직 소스를 안 읽었다" 같은 재시도 가능한 거부가 유일한 write 한도를 영구히 소모했습니다. 러너 5곳 전부에 있었습니다.

### 4-5. 모델에게 정보 미제공 (4건)

오류가 "무엇이 틀렸는지"만 말하고 "무엇으로 고쳐야 하는지"는 알려주지 않았습니다. 정보를 채우자 즉시 해소됐습니다.

| 대상 | 추가한 정보 | 효과 |
| --- | --- | --- |
| `FACT_CORRECTION_EDGE_IDENTITY_CHANGED` | 보존해야 할 `on_element_ref` | 8회 연속 실패 → 소멸 |
| `USER_JOURNEY_THREAD_REF_INVALID` | 유효 스레드 목록 + 스키마 enum | 가짜 이름 6회 → 소멸 |
| `USER_JOURNEY_RECOVERY_PAIR_MISMATCH` | 어긋난 필드명 | 진동 → 4회 만에 통과 |

### 4-6. 스캐너 판정 오류 (2건)

아이콘 전용 버튼의 라벨이 소실됐습니다(`title="홈으로"`, 본문 `=`인 버튼이 `=`로 기록). 또한 리터럴 화면 이동(`setPage("upload")`)이나 관측 결과(`stable_outcomes: ["downloaded"]`)가 증거로 있는 동작이, 같은 핸들러의 백엔드 호출 하나를 해석하지 못했다는 이유로 통째로 탈락했습니다. 불확실한 것은 백엔드 효과일 뿐 사용자가 보는 결과가 아니므로 `inferred`로 이월하게 고쳤습니다.

### 4-7. 신규 검증 규칙 (2건)

- `FACT_JOURNEY_ACTION_SELF_LOOP_ONLY` — 화면 이동을 자기 루프로 모델링하는 것을 거부합니다. CSV 다운로드처럼 제자리에서 결과를 남기는 정당한 종료는 통과합니다.
- 05 검증 산출물에 `journey_completion` 기록 — 완결 불가 여정을 컴파일러가 조용히 버리던 것을 드러냅니다.

## 5. 해결해야 하는 문제

| 항목 | 내용 |
| --- | --- |
| **골든 평가 미실행** | PoC 가설의 측정치입니다. 06 골든 평가를 현재 후보로 돌리지 않았습니다. 직전 측정값은 성공 시나리오 recall 50%(16/32), 목표 80% |
| **경로 품질** | J001 step 6~16에서 upload ↔ parsed-db 왕복 4회, step 20 설정 화면 이탈, step 25·27 CSV 중복. 사람이 따라갈 여정이 아닙니다. milestone의 중복·역행 edge가 경로에 그대로 반영됩니다 |
| **제품 등록 미시도** | 전 산출물이 로컬 probe입니다. `.scenarioforge` 제품 state는 여전히 `fact: failed`, progress 20% |
| **단일 대상** | AXSE만 검증했습니다. RA-DAR 일반화 미확인 |
| **수행 어댑터** | 웹만 구현. Windows·Android·iOS 없음 |
| **RA-DAR 그라운딩** | 71.4%로 목표 90% 미달. 실패 8건 전부 대상 서술 문제(글자 없는 아이콘 버튼, 잘린 셀, 접미사만 다른 반복 컨트롤) |

### 다음 작업 순서

1. 06 골든 평가를 `RUN-AXSE-AGENTIC-20260918-01`의 05 후보로 실행해 recall 측정
2. 경로 품질 개선 — milestone edge 중복·역행 제거
3. 제품 backend 등록 경로로 동일 결과 재현
4. RA-DAR 일반화 확인

## 6. 저장소 구조

| 디렉터리 | 책임 |
| --- | --- |
| `apps/desktop` | Electron main 오케스트레이션, renderer 표현, 자격증명 |
| `packages/contracts` | 생성·실행 공통 계약 |
| `packages/pi-runtime` | Pi 도구 스키마, 서버 소유 값, provider 재시도 |
| `packages/scenario-pipeline` | 스캐너, 정본 ID, 근거, 그래프 도구, reviewer 게이트 |
| `packages/project-runtime` | 런타임 템플릿과 `.scenarioforge` 경로 정책 |
| `packages/runtime-state` | reducer, 저널, 복구 |
| `packages/test-runtime` | 비전 step 컴파일러, 좌표계, 제안 게이트 |
| `scripts/run-staged-axse-*.mjs` | 단계별 생성 하네스 러너 |
| `docs/architecture` | 설계 문서 |
| `docs/reports` | 진행 보고서 |
| `docs/solutions` | 검증된 수정 이력과 회귀 테스트 기록 |
| `docs/validation` | 실측 run 증거 |
| `test_project_source` | 분석 픽스처 (저장소에 포함하지 않음) |

## 7. 개발

Node는 `package.json`의 engine 요구(`>=22.19.0`)를 만족해야 합니다. `node:sqlite`를 사용하므로 Node 20에서는 테스트가 실행되지 않습니다.

```sh
npm test         # 197건
npm run typecheck
npm run build
npm run dev      # Electron 앱
```

단계형 생성 하네스는 Electron 컨텍스트에서 실행합니다(자격증명이 `safeStorage`에 있습니다).

```sh
npx esbuild scripts/run-staged-axse-source-survey.mjs --bundle --platform=node --format=esm \
  --target=node22 --external:electron '--external:@earendil-works/*' --external:typescript-compiler \
  --outfile=apps/desktop/out/staged-probe/run-staged-axse-source-survey.mjs

npx electron apps/desktop/out/staged-probe/run-staged-axse-source-survey.mjs --run-id RUN-AXSE-AGENTIC-YYYYMMDD-NN
```

개발 규칙은 [`AGENTS.md`](AGENTS.md)에 있습니다.
