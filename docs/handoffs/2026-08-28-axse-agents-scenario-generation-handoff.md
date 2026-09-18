# axse-agents 시나리오 생성 인수인계

- 마지막 갱신: 2026-09-04
- 현재 단계: AXSE `01-source-survey`~`04-user-journeys` 로컬 검증 통과, `05-scenario-cases` 승인 전
- 작업 디렉터리: `/Users/a11769/Desktop/master-project`

## 새 세션이 먼저 읽을 문서

다음 순서를 지킨다.

1. `/Users/a11769/Desktop/master-project/AGENTS.md`
2. `docs/handoffs/2026-08-28-axse-agents-scenario-generation-handoff.md`
3. `docs/architecture/06-golden-journey-generation-validation.md`
4. 변경할 디렉터리의 `AGENTS.md`
5. 관련 exact error를 `docs/solutions/integration-issues`에서 검색한 결과

`test_project_source/axse-agents/SCENARIOFORGE_GOLDEN_DATASET.md`는 다음 후보 생성과 원본 source review가 모두 끝난 뒤 외부 평가 단계에서만 읽는다. 생성 agent의 prompt, artifact, gap 입력에는 그 내용·ID·개수·표현을 포함하지 않는다.

## 사용자 의도

- 최종 목표는 개별 transition을 많이 만드는 것이 아니라, 실제 소스 근거로 업무 분류를 도출하고 로그인 또는 지원되는 진입점부터 업무 결과와 종료까지 이어지는 사용자 여정을 만드는 것이다.
- 중간 산출물의 사소한 누락이나 불완전함은 가능한 한 다음 단계가 참고하여 보정한다.
- ID·근거·참조 무결성처럼 보정할 수 없는 경계만 fail-closed한다.
- coverage는 골든 데이터셋을 기준으로 나중에 평가한다.
- 한 번에 전체를 바꾸지 말고 단계별로 적합성을 증명한 뒤 고도화한다.
- 기본 생성 방식은 Pi coding-agent에게 한 단계씩 작업과 산출물 경로를 주고, 산출물을 원본과 대조한 gap을 다음 지시에서 다시 소스를 읽어 보정하게 하는 방식이다.

## 현재까지 완료

### 이전 실제 파이프라인 상태

- `RUN-82a7ca6d-ac12-4b2f-95be-e92107193474`: `FACT_ASYNC_TRIGGER_SPLIT`로 실패했고 repair loop 연결 및 관련 E2E 9개가 수정·통과했다.
- input rejection guard 계약도 후속 수정됐다.
- `RUN-8b891ecb-3a79-41a8-a7c6-e16a6ca83a1b`: `/new` 전환을 위해 FACT 25%에서 의도적으로 중단한 recoverable run이며 실패 run이 아니다.
- Electron/Vite는 종료 상태다.

### 사용자 여정 기준선

- 기존 완료 run: `RUN-e4e375ef-f74f-439c-9c46-222ab084989b`
- 산출물: 업무 분류 18, workflow 50, scenario 67, scenario 최대 3 steps
- edge coverage: 65/65, 100%
- 로그인 → 업무 다운로드 → 로그아웃을 한 시나리오에서 완주: 0건
- 결론: transition coverage 100%만으로 사용자 E2E를 보장하지 않는다.

### 이전 AXSE 독립 Azure 설계 probe — 참고용

- 모델: 실제 Azure OpenAI `gpt-5.6-luna`
- 결과 artifact: `/private/tmp/scenarioforge-axse-journey-probe-20260903-20/result.json`
- 골든은 후보 생성에 제공하지 않았고 마지막 독립 비교에서만 사용했다.
- 실제 소스 37 files → 8 chunks → raw findings 109 → 실행 가능한 UI findings 28
- 후보: 업무 분류 7, workflow 11, 정상/복구 여정 2
- 골든 평가: 분류 6/6, workflow 10/10, 필수 여정 2/2, critical gap 0
- `J-001` 정상 E2E similarity 0.98: 18 milestones, 13 handoffs
- `J-002` 복구 E2E similarity 0.98: 14 milestones, 10 handoffs

상세 판정과 설계 결론은 `docs/architecture/06-golden-journey-generation-validation.md`에 있다.

이 결과는 가능성 확인에는 유효하지만 source-map → link → taxonomy → journey를 서로 분리된 JSON 변환으로 호출한 격리 probe다. 현재 채택한 Pi coding-agent의 누적 source 재확인 방식에 대한 제품 증명으로 간주하지 않는다.

### 단계형 Pi source survey

- 최종 성공 run: `RUN-AXSE-AGENTIC-20260904-07`
- 모델/runtime: 실제 Azure `gpt-5.6-luna` + `@earendil-works/pi-coding-agent`
- artifact: `docs/validation/axse-agentic-analysis/RUN-AXSE-AGENTIC-20260904-07/01-source-survey.json`
- 상태: locally validated, unregistered probe. 제품 stage acceptance는 수행하지 않았다.
- trust-boundary validation: 통과, issue 0
- source inventory: model 허용 95 files, 8 routes, 2 scanner-detected API calls, 63 interactions. test/fixture/docs/generated scenario/hidden/mock/golden-like path는 inventory와 closure에서 제외했다.
- source survey: 5 source areas, 2 provisional threads, 4 source gaps, 16 cited evidence slices
- tool usage: inventory 1회, closure 10회, cumulative 197,166 bytes, artifact write 1회
- Pi session: in-memory. raw prompt/source transcript 파일을 만들지 않았다.
- 골든 입력: 생성 중 미사용, 완료 뒤 사후 대조에만 사용
- 사후 대조: 인증/프로젝트, 업로드/파싱, 파싱 데이터, 업무흐름/매핑, 시나리오 결과·CSV/Excel은 확인했다. TS 작업/단계 내비게이션은 thread milestone에는 있지만 독립 영역이 아니다.
- 완결성 gap: normal thread의 마지막이 “CSV/Excel 다운로드 또는 로그아웃”이므로 다운로드 뒤 로그아웃의 순차 terminal이 아니며, full recovery thread도 없다.
- 다음 입력: `docs/validation/axse-agentic-analysis/RUN-AXSE-AGENTIC-20260904-07/orchestrator-gaps.json`
- 상세 검토: `docs/validation/axse-agentic-analysis/RUN-AXSE-AGENTIC-20260904-07/orchestrator-source-review.md`

`RUN-AXSE-AGENTIC-20260903-05`는 `pi-source-survey`에서 `AGENTIC_SOURCE_SCOPE_VIOLATION`으로 종료했다. 허용된 MainPage가 모델 요청 budget보다 클 때 빈 closure를 source escape로 오분류한 경계를 수정했고, RUN-07에서 작은 요청 budget을 70,328 bytes로 올려 정상 완료했다. 수정 이력은 `docs/solutions/integration-issues/staged-source-closure-minimum-budget.md`에 있다.

이전 RUN-03/RUN-04는 screen/element/API canonical ref를 모델에 노출했고, production staging receipt를 로컬 docs artifact에 잘못 사용했으며, transcript를 디스크에 남겼다. 현재 실행기는 불필요한 canonical ref를 제거하고 `analysis.writeArtifact`로 비정규 프로브임을 명시하며 Pi session을 메모리에만 둔다. 기존 RUN-03/RUN-04 transcript는 삭제하지 않고 디렉터리 `0700`, 파일 `0600`으로 권한을 제한했다.

### 단계형 Pi source gap review

- run: `RUN-AXSE-AGENTIC-20260904-07`
- artifact: `docs/validation/axse-agentic-analysis/RUN-AXSE-AGENTIC-20260904-07/02-source-gap-review/02-source-gap-review.json`
- 상태: locally validated, unregistered probe. 제품 stage acceptance는 수행하지 않았다.
- prior/snapshot 계약: `01-source-survey` hash, source snapshot ID, root hash 일치
- source 재열람: gap에 허용된 6개 ref 전부, closure 3회, cumulative 134,273 bytes
- correction: TS 작업·단계 source area 1개, 정상 thread 교체 1개, 복구 thread 추가 1개
- gap 결과: 3개 모두 해소, 추가 gap 0개
- 보존 결과: 기존 비대상 source area, 프리셋 thread, supporting systems, internal exclusions, explicit source gaps 유지
- evidence 결과: prior 16개와 이번 6개 persisted grant를 각각 재검증하고 merged catalog 22개로 보존, 누락 ref 0개
- 완결성 결과: 정상 thread는 로그인부터 CSV→Excel→로그아웃까지 순차 연결되고, 복구 thread는 같은 진입에서 실패·재선택/재업로드 뒤 정상 흐름에 합류해 Excel과 로그아웃까지 완료
- 골든 입력: 생성 중 미사용, 원본 검토 완료 뒤 사후 비교에만 사용
- 상세 검토: `docs/validation/axse-agentic-analysis/RUN-AXSE-AGENTIC-20260904-07/02-source-gap-review/orchestrator-gap-review.md`

이 checkpoint로 artifact-to-artifact section correction과 기존 유효 내용 보존이 실제 Pi/Azure 실행에서 확인됐다. backend 등록이나 제품 FACT/WIKI/SCENARIO 통합 완료를 뜻하지 않는다.

첫 로컬 통과 시도는 merged survey의 prior `EV-*` 참조 16개를 final evidence catalog에서 누락해 코드 리뷰에서 거부됐다. 해당 시도는 `02-source-gap-review-rejected-05`로 보존했다. 최종 artifact는 이 결함과 100개 초과 source inventory 오거부를 회귀 테스트로 수정한 뒤 다시 생성했다.

### 단계형 Pi business classification

- run: `RUN-AXSE-AGENTIC-20260904-07`
- artifact: `docs/validation/axse-agentic-analysis/RUN-AXSE-AGENTIC-20260904-07/03-business-classification/03-business-classification.json`
- 상태: locally validated, unregistered probe. 제품 stage acceptance는 수행하지 않았다.
- 분류 방식: source area별 1차 `business-capability` 6개와 역할·권한·책임·단계·상태·데이터·채널·입력·산출물·연동·복구의 교차 category 27개
- 관점 평가: 표준 14개 중 12개 classified, organization/compliance 2개 not-evidenced
- source 재열람: 6개 ref, closure 6회, cumulative 41,465 bytes
- evidence: 현재 단계 grant 6개를 backend가 category 33개에 결합, 빈 binding 0개
- unresolved: 실제 사용자 권한 차이와 프로젝트 접근 규칙, 생성 실패 후 재요청·기존 결과 보존 규칙
- 골든 입력: 생성 중 미사용, 원본 검토 완료 뒤 업무 분류 6개와 사후 비교
- 골든 대응: `AXSE-BC-001`~`AXSE-BC-006` 핵심 범위 6/6
- 상세 검토: `docs/validation/axse-agentic-analysis/RUN-AXSE-AGENTIC-20260904-07/03-business-classification/orchestrator-classification-review.md`

모델은 category ID, evidence metadata 또는 executable target을 작성하지 않았다. semantic category와 source-area/journey 참조만 작성했고 backend가 persisted evidence와 hash를 소유했다. 첫 다축 후보의 umbrella category와 과장된 의미는 `03-business-classification-rejected-04`에 보존했고, 최종 후보는 source area별 1차 분류를 강제한 뒤 다시 생성했다.

### 단계형 Pi user journeys

- run: `RUN-AXSE-AGENTIC-20260904-07`
- artifact: `docs/validation/axse-agentic-analysis/RUN-AXSE-AGENTIC-20260904-07/04-user-journeys/04-user-journeys.json`
- 상태: locally validated, unregistered probe. 제품 stage acceptance는 수행하지 않았다.
- 입력: locally validated 02 source-gap artifact와 03 business-classification artifact, 동일 snapshot/hash
- 결과: 정상 1개, 복구 1개, 제외된 local preview thread 1개, milestone 13개, handoff 11개
- 완결성: 로그인→프로젝트/TS 작업→업로드·파싱→Parsed DB→업무 매핑·생성→결과/다운로드→로그아웃, 그리고 같은 진입에서 업로드/파싱 실패를 파일 재선택·재업로드로 복구해 결과와 로그아웃까지 연결
- 업무 연결: 두 여정 모두 6개 primary business capability 포함; cross-axis 분류는 source thread별 backend 투영 허용 목록 안에서만 사용
- evidence: 현재 단계 13개 grant, 모든 journey와 milestone binding 비어 있지 않음
- source usage: closure 1회, cumulative 70,170 bytes
- 내부 semantic correction: write 시도 3회 중 최종 1회만 영구 기록; trust-boundary 위반은 재시도 불가
- unresolved: 실제 역할별 권한·프로젝트 접근 정책, 생성 실패/부분 완료 후 재요청과 기존 결과 보존 규칙
- 외부 평가: 원본 검토 뒤 필수 정상·복구 여정과 6개 업무 범위 대응
- 다음 model-safe correction input: `04-user-journeys/orchestrator-next-stage-gaps.json`. 복구 case의 실패 입력과 교체 입력 조건을 원본에서 다시 확인하되, 외부 평가 문서는 생성 agent에게 제공하지 않음
- 상세 검토: `04-user-journeys/orchestrator-source-review.md`, `04-user-journeys/orchestrator-external-evaluation.md`

## 이번 단계의 코드와 테스트

### 현재 단계형 Pi 구현

- `scripts/staged-agent-analysis-contract.mjs`
  - model-facing source allowlist와 canonical ID 축소
  - strict source-survey schema, secret/raw-source, evidence/source-ref 검증
  - required tool order, cumulative closure budget, pre-write validation
- `scripts/staged-agent-run-support.mjs`
  - AXSE/output realpath scope, sanitized lifecycle failure, prompt timeout/abort
- `scripts/run-staged-axse-source-survey.mjs`
  - 실제 Azure/Pi 01 assignment, in-memory session, evidence grant, locally validated artifact
- `scripts/run-staged-axse-business-classification.mjs`
  - 실제 Azure/Pi 03 assignment, 다축 관점 지침, source-area support reread, backend evidence binding
- `scripts/run-staged-axse-user-journeys.mjs`
  - 실제 Azure/Pi 04 assignment, complete normal/recovery invariant, thread-bounded classification projection, backend evidence binding
- `packages/scenario-pipeline/src/security/secret-classifier.ts`
  - inventory/evidence/artifact 공통 secret 분류
- `packages/pi-runtime/src/tools/staging-tools.ts`
  - 실제 경로와 non-canonical 상태를 반환하는 `analysis.writeArtifact`
- `packages/pi-runtime/src/host/pi-sdk-driver.ts`
  - standalone probe의 in-memory session과 bounded retry 설정
- `tests/design/staged-agent-source-survey.test.ts`: 35 tests
- `tests/design/staged-agent-business-classification.test.ts`: 12 tests
- `tests/design/staged-agent-user-journeys.test.ts`: 17 tests
- `packages/scenario-pipeline/src/security/evidence-grant-service.test.ts`: 13 tests
- `packages/pi-runtime/src/pi-runtime.test.ts` 포함 workspace: 25 tests

### 이전 격리 probe — 참고용

- `packages/scenario-pipeline/src/evaluation/golden-journey-evaluator.ts`
  - 골든 Markdown 파싱
  - 후보 구조·근거·handoff·복구/종료 검증
  - 독립 semantic assessment의 recall/critical gap 판정
  - 기존 scenario의 연속 사용자 여정 기준선 계산
- `scripts/journey-source-link-contract.mjs`
  - backend 소유 1:1 UI finding skeleton
  - LLM semantic annotation 적용
  - source-link 무결성, recovery 과대 승격 방지
  - taxonomy를 보존하는 journey 조립/repair
- `scripts/axse-journey-design-probe.mjs`
  - 실제 Azure를 사용하는 격리 설계 probe
  - golden leakage 방지, stage checkpoint와 failure artifact 기록
- `tests/design/axse-golden-journey-baseline.test.ts`
- `tests/design/journey-source-link-contract.test.ts`
- `tests/design/axse-journey-design-probe.test.ts`
- `packages/scenario-pipeline/src/evaluation/golden-journey-evaluator.test.ts`

## 설계 결정

1. 기본 흐름은 Pi coding-agent가 한 stage artifact를 작성하고, 오케스트레이터가 원본 대조 gap을 만든 뒤 다음 stage가 필요한 원본을 다시 읽는 누적 방식이다.
2. backend가 canonical ID, source snapshot, evidence, hash, executable target을 소유한다. Pi는 semantic artifact 또는 명명된 section correction만 작성한다.
3. 이미 유효한 artifact 전체를 replacement repair하지 않는다. 부족한 source area, journey thread, gap만 교체하거나 추가한다.
4. 의미 누락·빈 선택 필드는 unresolved/gap으로 다음 단계에 전달한다. secret/path/source mutation, stale 또는 창작 evidence, canonical identity/target 변경만 즉시 fail-closed한다.
5. 생성 agent에게 골든을 주지 않는다. 골든은 stage 완료 뒤 외부 evaluator만 사용한다.
6. 사용자 여정 완결성은 시나리오 breadth와 transition coverage보다 먼저 검사한다.

## 다음 한 단계

사용자 확인 전 RA-DAR 또는 44개 시나리오/90개 transition coverage로 진행하지 않는다.

다음 작업은 명시적 승인 뒤 같은 AXSE snapshot의 `05-scenario-cases`다.

1. locally validated `04-user-journeys`와 `04-user-journeys/orchestrator-next-stage-gaps.json`만 의미 입력으로 제공하되 backend accepted artifact로 표현하지 않는다. 외부 평가 문서는 생성 agent 입력에서 제외한다.
2. 정상 여정과 복구 여정 각각에서 normal, boundary, exception, recovery case를 확장하되 backend-owned workflow, edge, element, evidence 또는 target identity를 바꾸지 않는다.
3. 복구 case precondition에서 실패 입력과 유효 교체 입력을 source-backed하게 구분한다.
4. 권한·조직·생성 재요청 unresolved를 사실로 확정하지 않고 필요한 granted source를 다시 읽는다.
5. candidate case를 원본과 대조한 뒤에만 외부 평가를 수행한다. RA-DAR 일반화는 계속 보류한다.

## 운영 안전 규칙

- dirty worktree를 reset, checkout, clean하거나 별도 worktree로 옮기지 않는다.
- `test_project_source`와 `.scenarioforge` canonical/runtime을 수정하지 않는다.
- 활성 분석 중에는 코드나 runtime을 수정하지 않는다. 실패 시 앱을 먼저 종료하고 run ID, stage, 최초/terminal error, artifact를 수집한다.
- credential을 재입력하게 하거나 로그·문서·답변에 출력하지 않는다.
- Node `>=22.19.0`을 사용한다. 현재 `/opt/homebrew/bin/node`는 v24.7.0이고 기본 `node`는 v20.19.5다.
