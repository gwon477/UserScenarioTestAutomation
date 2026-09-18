---
title: "workflow variation과 조건부 전이 guard가 scenario 전제조건에서 누락됨"
date: "2026-08-27"
last_updated: "2026-08-28"
category: "integration-issues"
module: "scenarioforge-scenario-pipeline"
problem_type: "integration_issue"
component: "scenario-compiler"
severity: "high"
symptoms:
  - "FACT와 WIKI reviewer는 통과하지만 SCENARIO reviewer가 빈 preconditions를 거부함"
  - "variation에는 선택 조건이 있으나 구조화 precondition에는 같은 predicate가 없음"
  - "조건부로 노출되는 화면 전이의 선행 상태가 edge effect 문장에만 남음"
  - "앞 단계 action이 만드는 상태를 walk가 적용하지 않아 실제 action 대신 precondition으로 승격함"
root_cause: "deterministic_precondition_loss"
resolution_type: "code_fix"
related_components:
  - "fact-author-contract"
  - "fact-reviewer-contract"
  - "wiki-author-contract"
  - "scenario-compose-skill"
tags:
  - "scenario"
  - "precondition"
  - "variation-axis"
  - "edge-guard"
  - "semantic-review"
---

# workflow variation과 조건부 전이 guard가 scenario 전제조건에서 누락됨

## Problem

실제 분석 `RUN-ca372b6d-53cd-440c-8b28-cee00da44c91`은 FACT edge 4건과 WIKI workflow 2건을 생성해 두 reviewer를 통과했다. SCENARIO author도 2개 시나리오를 제출했지만, 두 레코드의 `preconditions`가 모두 비어 최종 reviewer가 거부했다.

```text
SCENARIO-001: upload workflow starts after upload/parsing but has no explicit prerequisite
SCENARIO-002: selected business flow exists only as a variation value, not a precondition
```

## Prior-history comparison

- runtime-template, credential, operation ID, artifact handoff: 정상
- FACT canonical ID와 API effect: 정상
- state-driven screen/edge: 4개 실제 전이가 생성되어 이전 WIKI empty 문제는 해소됨
- provider 429: SCENARIO 첫 author 호출에서 발생했지만 60초 뒤 단일 재시도로 정상 제출됨

따라서 이전 실패의 재발이 아니라 WIKI→SCENARIO deterministic contract에서 전제조건이 소실된 신규 문제다.

## Root Cause

`compileScenarioSet`은 edge의 `guard` 문자열에서만 predicate ID를 모아 precondition을 만들었다. 그러나 WIKI의 `variation_axes`와 `combination.axis_defaults`는 `variation`에만 복사하고 precondition으로 승격하지 않았다.

동시에 FACT author는 source에서 다음 두 조건을 보았지만 E-0003에 guard를 붙이지 않고 effect에만 `after parsing completes`를 적었다.

```jsx
actions={complete && !locked ? <button ...>다음 단계</button> : null}
if (!complete || submitting) return;
```

기계 compiler는 등록되지 않은 조건을 창작할 수 없고 scenario author는 deterministic precondition을 바꿀 수 없으므로, 최종 reviewer가 발견할 때까지 빈 배열이 유지됐다.

## Solution

1. deterministic scenario compiler가 다음 두 원천을 합쳐 precondition을 만든다.
   - path edge의 등록된 `guard`
   - workflow `variation_axes`의 등록된 default 값
2. precondition text에는 `PRED-id=value`를 보존하고 `predicate_refs`에 같은 등록 ID를 둔다.
3. FACT author 계약은 조건부 렌더·enabled·handler early return이 있는 전이에 evidence-backed predicate와 guard를 요구한다.
4. FACT reviewer 계약은 source 조건이 있는데 guard가 빠진 edge를 거부한다.
5. WIKI author는 cited edge가 수행하지 않는 entry setup을 workflow action처럼 주장하지 않는다.
6. scenario skill/agent는 precondition을 variation 또는 action 문장으로만 옮기지 않고 명시적 배열에 유지한다.

reviewer 기준은 완화하지 않았다.

## Regression Test

- `generation-core.test.ts`: guard가 없는 path라도 workflow variation/default가 `PRED-selected-flow=selected` precondition으로 승격되는지 확인한다. 수정 전 빈 배열로 RED, 수정 후 GREEN이다.
- `pi-generation-executor.test.ts`: 조건부 transition guard author 지시, FACT reviewer 거부 규칙, WIKI entry setup 경계를 확인한다. 세 assertion 모두 수정 전 RED였다.

### 후속 live failure: narration까지 deterministic으로 잠김

후속 run `RUN-0e9744b8-b686-4fae-b0b1-5997f8a0f918`에서는 다음 전제조건이 올바르게 생성됐다.

```json
{
  "text": "The uploaded document has finished parsing and PRED-upload-parsed=true.",
  "predicate_refs": ["PRED-upload-parsed"],
  "data_binding_keys": []
}
```

그러나 기존 immutable 비교가 precondition 객체 전체를 비교해, author가 deterministic `PRED-upload-parsed=true`를 사람 문장으로 바꾼 것까지 `SCENARIO_DETERMINISTIC_FIELDS_CHANGED`로 거부했다. 이 문제는 같은 precondition 경계의 후속 모순으로 분류했다.

수정 후에는 `predicate_refs`와 `data_binding_keys`만 deterministic으로 잠그고 `text`는 action/expected와 같은 narration 필드로 허용한다. reference를 제거하거나 바꾸면 여전히 deterministic-field rejection이 발생한다. 회귀 테스트는 text 변경 GREEN과 ref 변경 rejection을 함께 확인한다.

## Verification

- scenario-pipeline 집중 테스트 19개 통과
- Pi executor 집중 테스트 10개 통과
- 후속 conjunctive guard 회귀를 포함한 전체 workspace 테스트 118개 통과
- 전체 workspace TypeScript 검사와 Electron production build 통과
- live rerun은 후속 검증에서 기록한다.

### 2026-08-28 후속 회귀: effect를 적용하지 않는 비상태 walk

기존 실행은 “파일이 파싱됨”과 “업무 흐름이 선택됨”을 precondition으로 만들고, 그 상태를 실제로 만드는 파일 선택·업로드·흐름 선택 action을 path 앞부분에서 생략했다. `walkWorkflow`가 edge의 `effect`를 다음 edge의 guard 상태로 적용하지 않았고, FACT effect가 자유 문장이어서 deterministic compiler가 상태 assignment로 읽을 수도 없었다.

같은 WIKI→SCENARIO precondition 경계의 후속 모순으로 다음을 수정했다.

- FACT patch의 `effect`를 등록 predicate assignment 구조로 제한한다.
- backend가 effect를 canonical `PRED-id=value && ...` 문자열로 컴파일하고 미등록 ID/value와 자연어 effect를 거부한다.
- workflow walk는 `axis_defaults`에서 시작해 edge effect를 순서대로 적용하고, 앞 edge가 생산하는 predicate guard를 만족하기 전에는 뒤 edge를 걷지 않는다.
- scenario compiler는 앞 edge effect가 이미 만족한 guard를 precondition으로 다시 만들지 않는다.

[`generation-core.test.ts`](../../../packages/scenario-pipeline/src/generation-core.test.ts)에 계정 입력 self-loop가 `PRED-account.present=true`를 만든 뒤 submit guard를 여는 fixture를 추가했다. 수정 전에는 submit 단독 path 또는 잘못된 precondition으로 RED였고, 수정 후 `[input, submit]` 순서만 생성된다. 자연어 effect가 `EDGE_EFFECT_PREDICATE_INVALID`로 거부되는 테스트도 추가했다.

후속 검증은 scenario-pipeline 36개, 전체 workspace 135개, TypeScript 검사, Electron production build가 모두 통과했다. live 산출물의 action 순서는 `RUN-8a04cd9a-6706-4936-8e43-8a965ebdb72f` 종료 후 확인한다.

## Prevention

SCENARIO precondition rejection에서는 scenario prompt만 수정하지 않는다.

1. 거부된 precondition이 FACT edge guard인지 WIKI variation인지 분류한다.
2. source 조건이 FACT predicate/guard로 등록됐는지 확인한다.
3. WIKI axis default가 deterministic precondition으로 승격됐는지 확인한다.
4. scenario author가 수정할 수 없는 deterministic 필드라면 상위 compiler에서 해결한다.
5. reviewer를 완화하거나 등록되지 않은 predicate를 만들어 통과시키지 않는다.

## Related

- [상태 기반 Page 컴포넌트 screen inventory](./state-driven-page-components-collapsed-into-source-screen.md)
- [API effect evidence slice 절단](./api-effect-evidence-slice-truncation.md)
- [Pi Coding Agent 하네스 설계](../../pi-coding-agent%20하네스%20설계.md)
