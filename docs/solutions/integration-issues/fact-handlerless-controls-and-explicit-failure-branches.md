---
title: "FACT가 handler 없는 설정 control을 동작으로 만들고 명시적 실패 분기를 누락함"
date: "2026-08-28"
last_updated: "2026-08-28"
category: "integration-issues"
module: "scenarioforge-generation-harness"
problem_type: "semantic_coverage_issue"
component: "fact-author-review-contract"
severity: "high"
symptoms:
  - "실제 소스에 onClick이 없는 설정 저장 버튼이 FACT edge로 생성됨"
  - "downstream에서 소비하지 않는 uncontrolled checkbox/select가 시나리오 동작으로 생성됨"
  - "로그인·업로드·생성 코드에 오류 처리가 있지만 FACT exception edge가 0개임"
root_cause: "element_inventory_mistaken_for_executable_journey_inventory"
resolution_type: "evidence-backed-executability-and-exception-contract"
related_components:
  - "pi-generation-executor"
  - "fact-analyst"
  - "stage-reviewer"
tags:
  - "fact"
  - "handler"
  - "exception-edge"
  - "source-evidence"
---

# Handler 없는 control과 명시적 실패 분기 경계

## Problem

실제 Azure 실행 `RUN-b79e4bbb-5a21-4c61-9a75-d199e90ba217`은 9개 화면, 63개 element, 38개 edge의 FACT를 reviewer pass로 확정했다. 그러나 수동 소스 대조 결과 정상 edge 38개, exception edge 0개였고 다음 과잉·누락이 동시에 존재했다.

- `SettingsPage`의 `저장`과 `초기화` 버튼은 handler가 없지만 `save-settings` 동작이 생성됐다.
- `defaultChecked` checkbox와 handler 없는 select는 브라우저 로컬 값만 바꾸며 저장·생성 payload에 소비되지 않지만 설정 변경 edge가 생성됐다.
- 로그인 handler의 빈 입력, HTTP 비성공, 네트워크 오류와 업로드/생성의 FAILED·오류 결과가 source evidence에 있음에도 exception edge가 생성되지 않았다.

모든 verified FACT edge를 WIKI와 SCENARIO가 100% cover하도록 만든 상태에서 이런 과잉 FACT를 허용하면 완전성 gate가 오히려 존재하지 않는 사용자 동작을 시나리오에 강제한다.

## Root Cause

scanner interaction inventory는 화면 요소의 존재와 locator 후보를 보존하지만 그 자체가 실행 가능한 업무 동작을 보장하지 않는다. 기존 author/reviewer 계약은 “evidence-backed journey action”을 요구했지만 다음 판정 규칙을 명시하지 않았다.

1. handler/link/native-submit/downstream state consumption 중 하나가 있어야 executable action이다.
2. 소스 handler가 명시한 실패 결과는 정상 edge와 별개의 exception edge다.

LLM은 빈 규칙을 UI 종류와 label로 보완해 `저장`을 동작으로 추론했고, 행복 경로 중심으로 edge를 작성했다. reviewer도 같은 모호한 경계를 사용해 이를 통과시켰다.

## Solution

FACT author와 reviewer의 공통 계약을 다음처럼 강화했다.

- 요소 존재는 action evidence가 아니다.
- 정확한 evidence에 executable handler, link/navigation, native submit, 또는 후속 여정이 소비하는 state change가 있어야 semantic action/edge를 허용한다.
- handler 없는 button과 downstream 소비가 없는 uncontrolled input은 edge에서 제외한다.
- executable handler가 입력 거부, HTTP 비성공, catch/network error, FAILED/partial result, 사용자 가시 오류를 명시하면 같은 trigger의 normal edge와 함께 exception edge를 요구한다.
- refresh는 일반 local-view action에서는 제외하지만 오류/빈 상태의 evidence-backed recovery action이면 포함할 수 있다.
- reviewer는 누락뿐 아니라 unsupported edge claim도 한 verdict에 함께 보고한다.

후속 `RUN-22b83aa2-96ff-4618-a1ca-191bb1c78606`에서는 author가 handler 없는 edge를 제거해도 deterministic draft가 element type만 보고 부여한 기본 `click/check/select`가 compiled FACT에 남아 reviewer가 네 번 연속 거부했다. 모델 patch에는 기존 action kind를 삭제하는 표현이 없으므로 prompt로 해결할 수 없는 backend ownership 문제였다. 따라서 deterministic draft의 모든 element `action_kind` 기본값을 `unresolved`로 변경했다. author가 exact handler evidence를 제시한 element만 semantic action으로 승격한다.

같은 실행에서 reviewer가 category panel과 정상 refresh를 명시적으로 `local-only`라고 판정했지만 기존 필터는 `local view`와 `refresh-action` 형태만 인식했다. 실제 verdict 문자열인 `local panel`, `local-only view`, `refresh is a local-only view control`도 회귀 테스트에 넣어 범위를 일반화했다. 명시적 오류 recovery/exception 요구는 이 필터와 별도로 유지한다.

이 규칙은 source inventory를 삭제하지 않는다. 요소와 locator는 FACT screen에 남고, 실제 시나리오 경계를 이루는 edge만 엄격하게 제한한다.

## Regression Test

`apps/desktop/src/main/application/pi-generation-executor.test.ts`에서 author와 reviewer payload 모두 다음 문구를 가져야 한다.

- `Element existence is not action evidence`
- `exception edge`
- 전체 지원 가능 누락의 일괄 verdict

수정 전 두 assertion이 RED였고 수정 후 19개 집중 테스트가 모두 GREEN이다.

## Verification

- 실제 실패 산출물의 설정 화면 소스 `frontend/src/features/settings/pages/settings.page.jsx:12-36`을 직접 대조했다.
- handler 없는 `저장`/`초기화`, downstream 소비 없는 checkbox/select를 확인했다.
- `frontend/src/features/login/login-form.page.jsx:12-58`에서 입력 거부, HTTP 실패, network catch를 확인했다.
- 수정된 Electron main bundle에 executability/exception 계약이 포함된 것을 확인했다.
- deterministic FACT draft에서 checkbox와 file input의 기본 action이 `unresolved`인지 2개 RED→GREEN 테스트로 확인했다.
- 실제 local panel/refresh verdict가 실제 journey issue와 섞였을 때 local-only 항목만 제거되는지 executor 테스트로 확인했다.
- 최종 Azure run과 전체 테스트·타입검사·빌드 결과는 E2E coverage audit 문서에 기록한다.
