---
title: "FACT author의 조건 누락이 run마다 달라 수동 prompt 보강이 반복됨"
date: "2026-08-27"
last_updated: "2026-08-28"
category: "integration-issues"
module: "scenarioforge-generation-harness"
problem_type: "reliability_issue"
component: "fact-semantic-repair"
severity: "high"
symptoms:
  - "FACT reviewer가 매 run마다 서로 다른 조건부 trigger guard 누락을 거부함"
  - "prompt 체크리스트 보강 후에도 다른 edge에서 의미 누락이 재발함"
root_cause: "single_pass_probabilistic_fact_authoring"
resolution_type: "bounded-review-repair-loop"
related_components:
  - "scenario-generation-harness"
  - "pi-generation-executor"
  - "fact-analyst"
tags:
  - "fact"
  - "semantic-review"
  - "repair-loop"
  - "guard"
---

# FACT semantic reviewer 기반 bounded repair loop

## Problem

`RUN-a3fafbd9-5a47-4112-9755-de958059a6e4`에서는 Settings의 `disabled={!taskId}` guard가 누락됐다. edge별 disabled/render/early-return 체크리스트를 보강한 뒤에도 `RUN-b0eb936a-9371-453d-9590-4eb029e18d06`에서는 “업로드 및 파싱 시작” trigger의 `complete === false` 조건이 누락됐다.

두 건 모두 schema/compiler는 통과했고 독립 FACT reviewer가 정확히 차단했다. 같은 모델의 단일 author pass에 완전성을 맡기고 terminal fail한 뒤 사람이 prompt를 추가하는 구조가 반복 실패의 원인이었다.

## Prior-history comparison

- 복수 guard 계약/빈 conjunction 문제처럼 schema 표현력이 부족한 것이 아니다.
- author 체크리스트에는 이미 `disabled`, conditional rendering, early return이 명시돼 있었다.
- reviewer input 범위 비대칭과 달리 FACT author/reviewer 모두 같은 source evidence 범위를 사용했다.
- 따라서 이번에는 확률적 의미 추출의 1회성 누락을 처리하는 orchestration 안정성 문제다.

## Solution

FACT 단계에 backend가 소유하는 bounded semantic repair를 추가했다.

1. author가 semantic patch를 제출한다.
2. backend가 deterministic compiler와 schema/reference/evidence gate를 적용한다.
3. reviewer가 actionable issue codes로 fail하면 같은 FACT work 안에서 repair author를 호출한다.
4. repair author는 deterministic draft, evidence slices, rejected semantic patch, issue codes를 받고 전체 replacement patch를 제출한다.
5. backend가 replacement를 처음부터 다시 compile/validate하고 reviewer를 다시 호출한다.
6. 최대 repair 상한 뒤 reviewer도 fail하면 stage를 terminal failed로 처리한다.

안전 규약:

- 구조/schema/reference/evidence 실패는 자동 의미 repair 대상이 아니다.
- issue code는 최대 20건, 항목당 2,000자, 합계 16KB로 제한한다.
- reviewer 문자열은 untrusted defect report로 취급하며 evidence/ref/output contract를 덮어쓸 수 없다.
- repair도 canonical FACT를 직접 편집하지 않고 backend-owned deterministic compiler를 통과한다.
- 동일 artifact ID를 재사용할 때 새 submission fingerprint가 없으면 이전 patch를 재사용하지 않고 `MODEL_ARTIFACT_NOT_RESUBMITTED`로 실패한다.
- repair 횟수는 backend 상한으로 제한해 무한 agent loop와 비용 증폭을 방지한다.

## Regression Test

- `scenario-generation-harness.test.ts`
  - 첫 FACT review fail → repair → 다음 pass → 전체 run 완료
  - 다섯 번째 review도 fail → repair는 정확히 4회만 실행되고 terminal fail
- `pi-generation-executor.test.ts`
  - replacement patch payload에 rejected patch와 untrusted issue report 규약 포함
  - 재사용 artifact ID에서 fresh submission이 없으면 이전 artifact를 신뢰하지 않음

수정 전 첫 E2E는 `STAGE_ARTIFACT_REJECTED:FACT_GUARD_MISSING` RED였고 수정 후 GREEN이다.

## Verification

- generation harness E2E 집중 테스트 6개 통과
- Pi executor 집중 테스트 13개 통과
- 전체 workspace 테스트 124개 통과
- 전체 workspace TypeScript 검사 통과
- Electron production build 통과 및 변경된 harness/skill/agent 포함 확인
- 실제 Azure 후속 run `RUN-3169353d-dc49-4904-854a-259ecd84d5a2`는 첫 FACT reviewer에서 통과해 repair를 소비하지 않았고, 전체 SRC→FACT→WIKI→SCENARIO를 완료했다. 실제 repair 분기는 독립 E2E에서 1회 성공/2차 실패 terminal 양쪽을 검증했다.

### 2026-08-28 후속 회귀: 복합 화면의 단계적 누락 발견

`RUN-c7f1ebfc-2c86-481c-9528-3e4c8257b58c`은 9개 화면·39개 edge의 첫 FACT에서 프로젝트 선택과 가드 누락을 거부했다. 첫 semantic repair가 이를 고친 뒤 독립 reviewer는 같은 `결과 확인/새로고침` control의 `generation-active=false` 결과 확인 분기를 새로 발견했다. 첫 reviewer가 모든 edge 의미 누락을 한 번에 열거한다는 보장이 없으므로 1회 상한은 복합 UI에서 유효한 두 번째 발견을 교정할 수 없었다.

상한을 semantic replacement 최대 2회로 변경했다. 로컬 modal close, filter/search, pagination, expand/collapse, refresh 요구는 scope policy로 제거하고 실제 journey issue만 repair 입력에 남긴다. 세 번째 semantic rejection은 그대로 terminal failure다. `scenario-generation-harness.test.ts`는 세 번 모두 fail하는 reviewer에서 repair 호출이 정확히 2회이고 review가 3회인 것을 RED→GREEN으로 검증한다.

### 2026-08-28 후속 회귀: prerequisite-setting control을 reviewer가 순차 발견

`RUN-9c03ffe1-125d-49ee-8d64-f153d7d2d375`의 source snapshot은 63개 interaction을 포함했다. 최초 reviewer는 업로드 상태 guard 4건, 다음 reviewer는 `흐름보기 → getFlowText` 결과 self-loop, 세 번째 reviewer는 업무 흐름 checkbox/select-all이 `checkedFlows`를 바꾸어 생성 요청을 가능하게 하는 prerequisite action임을 순차 발견했다. 세 번째 항목은 검색·pagination 같은 local view control이 아니라 다음 생성 요청의 eligibility와 payload를 바꾸므로 반드시 FACT edge여야 한다.

단순히 상한만 늘리지 않고 다음 세 가지를 함께 적용했다.

1. FACT author 체크리스트에 후속 action의 eligibility/payload를 바꾸는 checkbox, radio, select-all, choice, toggle을 명시했다.
2. 생성/진단 결과 열기와 완료 결과 확인도 same-screen journey output으로 전수 점검한다.
3. reviewer는 전체 interaction inventory를 끝까지 감사하고 지원 가능한 모든 누락을 한 verdict에 모은다.

복합 UI의 확률적 잔여 누락에 대비한 semantic replacement 상한은 처음 4회로 두었다. 이후 실제 run에서 동일 evidence를 보는 독립 reviewer가 앞선 `exception 추가/제거` 결정을 뒤집고, exception의 busy reset을 사용자 가시 실패 outcome으로 오인하는 문제가 확인됐다.

현재 상한은 6회이며 일곱 번째 거부는 terminal이다. 다음 reviewer에는 과거 decision code 전체 합계 16KB 이내의 bounded history를 전달한다. history는 여전히 untrusted consistency context이며 evidence나 contract를 덮어쓰지 않는다. 동일 work/evidence에서 앞선 add/remove 결정을 뒤집어야 한다면 자동 pass하지 않고 `REVIEW_DECISION_CONFLICT`로 실패시킨다. 모든 exception edge는 정상 trigger와 같은 executable guard, 그리고 사용자 가시 오류를 구분하는 failure-specific predicate effect를 가져야 한다. `scenario-generation-harness.test.ts`는 연속 실패 시 repair 6회/review 7회에서 정확히 종료함을 검증한다.

## Prevention

1. 반복되는 의미 누락은 prompt 문자열 증설만으로 해결하지 않는다.
2. deterministic gate와 semantic reviewer 사이에 bounded correction 경로를 둔다.
3. repair 입력/횟수/크기를 backend가 소유한다.
4. 상한 이후 실패는 숨기지 않고 정확한 reviewer issue로 terminal 처리한다.
5. 향후 WIKI/SCENARIO repair는 각 stage의 deterministic 불변 필드와 입력 대칭을 별도 설계한 뒤 추가한다.

## Related

- [FACT disabled trigger guard 누락](./fact-disabled-trigger-guard-omitted.md)
- [FACT 복수 조건 guard 계약](./fact-conjunctive-guard-contract.md)
- [WIKI reviewer evidence 범위 비대칭](./wiki-reviewer-source-evidence-scope-mismatch.md)
- [Pi Coding Agent 하네스 설계](../../pi-coding-agent%20하네스%20설계.md)
