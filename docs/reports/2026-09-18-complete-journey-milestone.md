# 완결 사용자 여정 생성 달성 기록

작성일 2026-09-18. 기준 run `RUN-AXSE-AGENTIC-20260918-02`. 이 문서는 로컬 probe 결과이며 제품 backend 등록(`product_stage_acceptance`)은 시도하지 않았다.

> 최초 작성 이후 골든 평가를 실행하고, 그 결과가 드러낸 결함을 고쳐 다시 측정했다. 경과는 8절에 있다.

## 1. 결과

AXSE 대상에서 생성 파이프라인 01~05 전 단계가 통과했고, 완결 사용자 여정 시나리오가 처음으로 생성됐다.

| 지표 | 값 |
| --- | --- |
| 통과 단계 | 01-source-survey → 02-source-gap-review → 03-business-classification → 03a-fact-graph → 03b-business-workflow-mapping → 04-user-journeys → 04a-user-journey-workflow-link → 05-scenario-cases-graph |
| FACT 그래프 | 화면 9, 요소 63, edge 56 |
| shell 포함관계 | 5개 단계 화면 |
| 시나리오 | 58건 (정상 51, 예외 7) |
| edge coverage | 56/56 (100%) |
| 완결 여정 | 2/2, 미완결 0 |
| 여정 연결 시나리오 | 19/58 |

완결 여정 두 건은 로그인부터 업무 결과 확보까지 한 경로로 이어진다.

| 시나리오 | 종류 | step | 경로 |
| --- | --- | --- | --- |
| `SCN-JOURNEY-J001-001` | normal | 28 | loginform → login → main → upload → parsed-db → business → scenario |
| `SCN-JOURNEY-J002-001` | exception | 22 | 동일 (업로드 실패·복구 포함) |

J001의 종료 구간은 step 25~27 CSV·Excel 다운로드, step 28 로그아웃이다. 업무 결과를 거쳐 종료에 도달한다.

## 2. 시작 시점 대비

| 항목 | 2026-09-17 시작 | 현재 |
| --- | --- | --- |
| 완결 여정 시나리오 | 0건 (계약상 생성 불가) | 2/2 |
| 교차 화면 정상 edge | 로그인·로그아웃·stage 진입 누락 | 전부 연결 |
| 제품 state | `fact: failed`(provider 429), progress 20% | 로컬 probe 01~05 통과 |
| 03a 통과 | 불가 | 통과 (17 보정 라운드) |

## 3. 수정한 제품 결함 25건

전부 회귀 테스트를 동반한다. 검증: `npm test` 197건 통과, `npm run typecheck` 0, `npm run build` 0, `git diff --check` 0. Node 24 기준(시스템 기본 v20.19.5는 `node:sqlite` 미지원).

### 3-1. 모델링 부재

| # | 결함 | 수정 |
| --- | --- | --- |
| 1 | shell 포함관계 모델링 없음. `<Shell>`이 감싸는 단계 화면에서 지속 크롬(로그아웃·nav)에 도달 불가 | `SourceShellRecord`, `SourceSnapshot.shells`, `FactScreen.shell_screen_id` 추가. 스캐너가 JSX 중첩에서 도출, graph-tools가 shell 조상의 edge를 포함 화면에서 도달 가능으로 처리 |
| 2 | 완결 여정 시나리오 컴파일러 없음 | `compileJourneyCompleteScenarios` 신규. journey milestone 체인을 순회하며 끊긴 구간은 BFS로 연결 |

### 3-2. 계약 모순 (어떤 모델 출력으로도 통과 불가)

| # | 결함 | 수정 |
| --- | --- | --- |
| 3 | `FACT_SOURCE_ACTION_UNRESOLVED`: edge 금지(`feasibility: unresolved`) ↔ edge 없으면 `action_kind` 강제 복원 ↔ 복원되면 오류 | feasibility가 unresolved인 behavior에는 규칙 미적용 |
| 4 | `USER_JOURNEY_PRIMARY_CLASSIFICATION_MISSING`: 모든 여정이 전체 business-capability 포함 ↔ 분류의 스레드와 여정 스레드 일치 ↔ 스레드 유일 배정 | primary 분류 요구를 해당 여정의 스레드에 유효한 것으로 한정 |
| 5 | `USER_JOURNEY_PRIMARY_AREA_MISSING`: 위와 동일 구조 | 동일하게 스레드 범위로 한정 |
| 6 | `USER_JOURNEY_THREAD_ASSIGNED_MULTIPLE` ↔ `USER_JOURNEY_RECOVERY_PAIR_MISMATCH`: 복구 여정은 정상 여정과 진입·결과·종료가 같아야 하는데 같은 스레드를 쓸 수 없음 | 한 스레드에 정상 1 + 복구 1 쌍 허용. 중복 배정·중복 제외는 계속 차단 |

### 3-3. 보정 권한 부재 (모델이 고칠 수 없던 오류)

`createFactCorrectionPlan`이 처리하지 않아 모델이 수정 권한을 못 받던 코드들.

| # | 코드 | 부여한 권한 |
| --- | --- | --- |
| 7 | `FACT_UNRESOLVED_CONNECTION_EDGE_FORBIDDEN` | edge 삭제 (`remove_edge_indexes` 신설) |
| 8 | `FACT_SOURCE_BRANCH_REF_MISSING` | `source_branch_ref`, `kind` |
| 9 | `FACT_LITERAL_NAVIGATION_TARGET_MISMATCH` | `to_screen_ref` |
| 10 | `FACT_SOURCE_BRANCH_OUTCOME_MISMATCH` | `source_branch_ref`, `kind`, 삭제 |
| 11 | `FACT_SOURCE_BRANCH_UNSUPPORTED` | 동일 |
| 12 | `FACT_SOURCE_STABLE_OUTCOME_PREDICATE_MISSING` | `effect` |
| 13 | `FACT_SOURCE_ACTION_UNRESOLVED` | edge 추가 (`add_edge_element_refs`) |

### 3-4. write 슬롯 소모

거부된 write가 전제조건 검사 전에 시도 횟수를 증가시켜, 재시도 가능한 거부가 유일한 write 한도를 영구 소모했다. 러너 5곳 전부에 있었다.

| # | 위치 | 수정 |
| --- | --- | --- |
| 14 | `createSourceSurveyStageGuard` (01) | 증가를 전제조건 뒤로 이동 |
| 15 | `createSourceGapReviewStageGuard` (02) | 동일 |
| 16 | 03a 러너 인라인 | 시도 4회(보정 8회), 성공 시 종료, 재시도 간 45초 백오프, 프롬프트 재시도 허용 |
| 17 | 04 guard | 한도 3 → 6 |
| 18 | 04a 러너 인라인 | 시도 5회, 프롬프트 재시도 허용 |
| 19 | 05 러너 인라인 | 시도 5회, 프롬프트 재시도 허용 |

### 3-5. 모델에게 정보 미제공

오류가 무엇이 틀렸는지만 말하고 무엇으로 고쳐야 하는지 알려주지 않아, 모델이 같은 실수를 반복했다.

| # | 대상 | 추가한 정보 | 효과 |
| --- | --- | --- | --- |
| 20 | `FACT_CORRECTION_EDGE_IDENTITY_CHANGED` | 보존해야 할 `on_element_ref`, 계획에 `replace_edge_identities` 신설 | 8회 연속 실패 → 소멸 |
| 21 | `USER_JOURNEY_THREAD_REF_INVALID` | 유효 스레드 목록 + 스키마 enum 제약 | 가짜 스레드명 6회 → 소멸 |
| 22 | `USER_JOURNEY_RECOVERY_PAIR_MISMATCH` | 어긋난 필드명 | 진동 → 4회 만에 통과 |
| 23 | `FACT_SOURCE_BRANCH_OUTCOME_MISMATCH` | 해당 요소가 소유한 branch 목록 | — |

### 3-6. 스캐너 회귀·판정 오류

| # | 결함 | 수정 |
| --- | --- | --- |
| 24 | 아이콘 전용 버튼 라벨 소실. `title="홈으로"`, 본문 `=`인 버튼이 `=`로 기록되어 모델이 의미 해석 불가 | 자기 텍스트가 문자·숫자를 포함하지 않으면 `title`/`aria-label`로 폴백 |
| 25 | 증거 있는 동작이 백엔드 미해결로 통째 탈락. 리터럴 이동(`setPage("upload")`)과 관측 결과(`stable_outcomes: ["downloaded"]`)를 가진 동작이 `unresolved`가 되어 edge 금지 | 둘 중 하나라도 있으면 `inferred` 유지 + `normal:1` branch 생성 |

### 3-7. 신규 검증 규칙

| 결함 | 규칙 |
| --- | --- |
| 화면 이동을 자기 루프로 모델링 (`submit login`이 loginform→loginform) | `FACT_JOURNEY_ACTION_SELF_LOOP_ONLY`: 여정 동작의 정상 edge가 전부 자기 루프이고 stable outcome도 지속 view state도 없으면 거부. CSV 다운로드 같은 정당한 제자리 종료는 통과 |
| 완결 불가 여정을 컴파일러가 조용히 폐기 | 05 검증 산출물에 `journey_completion`(기대 여정 수, 완결 시나리오 수, 미완결 ref) 기록 |

## 4. 종료 지점 판정에 대한 정정

초기에 "여정은 로그아웃으로 끝나야 한다"고 판단해 그 규칙을 넣으려 했으나 잘못된 해석이었다. AGENTS.md는 "로그아웃, 인계, 또는 다른 증거 있는 프로세스 종료"로 규정하며, 업무 분류가 종료 형태를 결정한다. 조회 업무는 결과 확인이, 입력 업무는 입력 완료가 정상 종료다.

실제 결함은 종료 판정 규칙의 부재가 아니라 **업무 결과 동작이 그래프에 없던 것**이었다. CSV·Excel 다운로드가 `stable_outcomes: ["downloaded"]`를 가졌음에도 API 클라이언트 함수 미해결로 탈락해, 여정이 결과에 도달하지 못하고 뒤로가기 edge에서 끝났다. 원인(결함 25)을 고치자 규칙 없이 해결됐다.

로그아웃 강제 규칙을 넣었다면 조회·입력 업무의 정상 종료를 오판하면서 이 문제는 고치지 못했을 것이다.

## 5. 성공으로 볼 수 없는 이유

이 시점은 "구조적으로 불가능하던 완결 여정 생성이 가능해졌고 로컬에서 재현된다"까지다. PoC 가설의 검증은 아니다.

| 미충족 | 내용 |
| --- | --- |
| 골든 평가 미실행 | 06 골든 평가를 이번 후보로 돌리지 않았다. 직전 측정값은 성공 시나리오 recall 50%(16/32), 목표 80% |
| 경로 품질 | J001 step 6~16에서 upload ↔ parsed-db 왕복 4회, step 20 설정 화면 이탈, step 25·27 CSV 중복. 사람이 따라갈 여정이 아니다. milestone의 중복·역행 edge가 경로에 그대로 반영된다 |
| 제품 등록 미시도 | 전 산출물이 `validation_scope: local-probe-contract-only`, `product_stage_acceptance: not-attempted`. `.scenarioforge` 제품 state는 여전히 `fact: failed`, progress 20% |
| 단일 대상 | AXSE만. RA-DAR 일반화 미검증 |

## 6. 다음 작업

1. 06 골든 평가를 `RUN-AXSE-AGENTIC-20260918-01`의 05 후보로 실행해 recall을 측정한다.
2. 경로 품질을 고친다. milestone edge를 순서대로 이어붙이는 현재 컴파일 방식이 중복·역행을 그대로 반영하므로, 경로 압축 또는 milestone 단위 중복 제거가 필요하다.
3. 제품 backend 등록 경로로 동일 결과를 재현한다.
4. RA-DAR로 일반화를 확인한다.


## 8. 골든 평가와 후속 수정

### 8-1. 골든 데이터셋 재작성

기존 골든(`test_project_source/axse-agents/SCENARIOFORGE_GOLDEN_DATASET.md`, 44 케이스)이 산출물과 어긋날 수 있다는 지적에 따라, AXSE 소스를 직접 판독해 v2를 새로 작성했다. `docs/validation/golden/SCENARIOFORGE_GOLDEN_DATASET.md`에 두고 픽스처는 수정하지 않았다. 골든을 산출물에 맞추면 평가가 순환하므로 `frontend/src` 전체와 `backend/app/api` 라우트만 근거로 삼았다.

| 항목 | v1 | v2 | 사유 |
| --- | --- | --- | --- |
| 업무 분류 | 6 | 6 | 동일 |
| 업무흐름 | 10 | 12 | 세션 종료와 작업 전환을 독립 업무흐름으로 분리 |
| 시나리오 케이스 | 44 | 38 | v1은 설정 화면 항목과 백엔드 전용 분기를 셈. v2는 화면에서 관측 가능한 분기만 |
| 필수 여정 | 2 | 2 | 동일 |

평가 러너에 `--golden-root` 옵션을 추가해 저장소 안의 골든을 지정할 수 있게 했다. 경로는 저장소 밖으로 나갈 수 없다.

**골든이 문제가 아니었다.** v1이 과했던 부분(설정 화면 등 비실행 항목)을 걷어내도 핵심 지적인 필수 복구 여정 미충족은 동일했고, 그 지적이 아래 근본 결함을 찾게 했다.

### 8-2. 측정 경과

| 지표 | 목표 | 세션 시작 | v2 최초 | **최종** |
| --- | --- | --- | --- | --- |
| 업무분류 recall | 80% | 100% | 83.3% | **100%** |
| 업무흐름 recall | 80% | 90% | 83.3% | **91.7%** |
| 필수 사용자 여정 | 100% | 50% | 50% | **100%** |
| 성공 시나리오 recall | 80% | 25%(v1 기준) | 50% | **54.5%** (12/22) |
| 복원 recall | 참고 | 9.1% | 18.8% | 18.8% |

필수 사용자 여정 2/2를 처음으로 충족했다. 성공 recall은 목표 미달이다.

### 8-3. 결정적 결함: 증거 있는 동작이 백엔드 미해결로 폐기됨

복구 여정이 계속 틀리게 잡힌 원인은 04의 선택이 아니라 **업로드 페이지에 예외 edge가 하나도 없던 것**이었다. `업로드 및 파싱 시작` 버튼의 behavior는 다음 상태였다.

```
explicit_failure: true            ← 스캐너가 catch 절로 실패 분기를 이미 탐지
branches: exception:1:exception   ← 예외 branch도 이미 생성
feasibility: unresolved           ← 백엔드 엔드포인트 3개 미해결
```

`FACT_UNRESOLVED_CONNECTION_EDGE_FORBIDDEN`이 edge를 금지해 파싱 실패 분기 자체가 그래프에서 사라졌고, 04는 고를 재료가 없었다.

이 계열을 세 번 고쳤다. 모두 하나의 원칙이다 — **소스가 진술하는 사용자 관측 결과는 백엔드 미해결로 지우지 않는다.** 불확실한 것은 서버 효과이지 사용자가 보는 결과가 아니다.

| # | 증거 | 결과 |
| --- | --- | --- |
| 25 | `literal_navigation_targets` (`setPage("upload")`) | `mainpage → uploadpage` 이동 edge 복구 |
| 26 | `stable_outcomes` (`["downloaded"]`) | CSV·Excel 다운로드 edge 생성, 여정이 업무 결과에 도달 |
| 27 | `explicit_failure` | 업로드 실패 edge 생성, 올바른 복구 여정 도출 |

수정 후 04가 도출한 복구 여정은 "파싱 실패 확인 → 올바른 UTF-8 파일 재선택해 재업로드 → 본류 합류"로, 골든이 요구하던 경로와 일치한다.

### 8-4. 역행 배제와 경로 품질

시나리오 테스트는 역행 경로를 다루지 않는다. 역행을 허용하면 시나리오가 종료 없이 이어질 수 있기 때문이다. 세 규칙을 넣었다.

| 규칙 | 근거 |
| --- | --- |
| edge 전역 1회 사용 | 종료 보장의 본질. edge가 유한하므로 경로도 유한 |
| 역행 컨트롤 제외 (`isJourneyRegressionEdge`) | `action_kind`·라벨이 back·previous·이전·뒤로·취소인 edge |
| 막다른 우회 제외 | 이후 어떤 milestone도 쓰지 않는 화면으로 가는 edge |

역행 판정은 모델이 채우는 계약 필드가 아니라 백엔드 결정론 판정으로 만들었다. 모델이 채우는 필드를 늘릴 때마다 새 실패 계열이 생기는 것을 이 세션에서 반복 확인했기 때문이다.

효과: J001 step 28 → 15, 중복 edge 0, upload ↔ parsed-db 왕복 4회 → 0.

### 8-5. 산출물 일관성

경로 탐색을 `planJourneyWalk`로 분리하고 `auditJourneyWalkability`로 export 했다. 두 곳이 같은 판단을 쓴다.

- `compileJourneyScenarioBindings` — 여정 걷기에서 탈락한 milestone에는 시나리오를 바인딩하지 않는다. 이전에는 여정 실행 경로에 없는 설정 단계가 바인딩에서는 `J001 위치 8`로 표시돼 산출물 안에서 두 표시가 어긋났다.
- 04a `run-staged-axse-user-journey-workflow-link` — 링크가 여정 경로를 만드는지 사전 검증하고, 못 만들면 끊기는 지점(현재 화면·다음 edge·출발 화면)을 알려준다.

사용자가 결과를 볼 때 시나리오 케이스는 그대로 있고 `journey_milestones: []`로 여정 밖임이 표시된다. 68건 중 41건이 이 상태다.

### 8-6. 남은 격차

| 항목 | 내용 |
| --- | --- |
| 성공 recall 54.5% | 목표 80%. 골든 38 케이스 중 12건만 의미적으로 덮는다 |
| 근거 없는 여정 서술 | 04가 "설정에서 … 저장한다"처럼 소스에 없는 업무를 milestone으로 쓴다. `저장`·`초기화`는 handler와 API가 없어 FACT에 edge가 0개다. 시나리오 케이스와 여정 실행 경로는 정확하고, 서술 텍스트에만 남는다 |
| 종료 handoff | 골든은 두 여정 모두 로그아웃을 exit에 포함하기를 요구하는데 후보 exit에 없다 |
| 문서 교체 흐름 | 다시 업로드·다시 선택·취소가 독립 업무흐름으로 표현되지 않았다 |
| 제품 등록 | 전 산출물이 로컬 probe. `.scenarioforge` 제품 state는 여전히 `fact: failed` |
| 단일 대상 | AXSE만. RA-DAR 일반화 미검증 |

04의 근거 없는 서술은 04가 설계상 FACT를 보지 않아 04a에서 사후 교정할 수 없다. `USER_JOURNEY_WORKFLOW_LINK_DEAD_END` 규칙으로 차단을 시도했으나 모델이 "거짓 연결"과 "미해결 기록" 사이에서 진동해, 04의 입력 설계를 바꾸는 별도 작업으로 남긴다.
