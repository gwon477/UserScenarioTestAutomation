---
title: "FACT reviewer가 로컬 보기 컨트롤을 E2E edge로 요구함"
date: "2026-08-28"
category: "integration-issues"
module: "scenarioforge-fact-review"
problem_type: "integration_issue"
component: "stage-reviewer"
severity: "high"
symptoms:
  - "FACT reviewer가 modal close, search, pagination, refresh에 MISSING_SELF_LOOP_EDGE를 반환함"
  - "author 계약은 local-only view controls를 제외하지만 reviewer가 같은 컨트롤을 필수 edge로 요구함"
root_cause: "semantic_reviewer_scope_drift"
resolution_type: "code_fix"
related_components:
  - "pi-generation-executor"
  - "gate-review"
  - "fact-semantic-repair"
tags:
  - "MISSING_SELF_LOOP_EDGE"
  - "modal-close-action"
  - "pagination"
  - "refresh-action"
  - "review-scope"
---

# FACT reviewer가 로컬 보기 컨트롤을 E2E edge로 요구함

## Problem

`RUN-c7f1ebfc-2c86-481c-9528-3e4c8257b58c`의 첫 FACT는 9개 화면·39개 edge를 제출했고 reviewer가 프로젝트 선택, 다운로드/파일 가드, modal close를 지적했다. semantic replacement는 E2E 핵심 문제를 수정하고 local-only modal close는 author contract에 따라 제외했다.

두 번째 reviewer는 다음 local view interaction만 다시 요구했다.

```text
MISSING_SELF_LOOP_EDGE:...:modal-close-action-is-evidence-backed
MISSING_SELF_LOOP_EDGE:...:search-action-updates-same-screen-results
MISSING_SELF_LOOP_EDGE:...:pagination-previous-action-updates-same-screen-results
MISSING_SELF_LOOP_EDGE:...:refresh-action-is-evidence-backed
```

후속 검토에서는 modal close와 main refresh 외에 실제 `MISSING_SCENARIO_RESULT_CONFIRMATION_BRANCH`도 함께 발견했다. 따라서 reviewer를 무조건 통과시키거나 전체 verdict를 무시할 수 없고, scope 밖 issue와 유효한 journey issue를 분리해야 했다.

## Prior-history comparison

- [`fact-semantic-review-bounded-repair-loop.md`](./fact-semantic-review-bounded-repair-loop.md)는 유효한 의미 누락을 교정하는 횟수 문제다.
- 이번 문제는 artifact가 아니라 reviewer가 공통 author/reviewer 범위를 넘어 local UI controls를 required journey edge로 승격한 입력 계약 위반이다.
- `결과 확인`은 생성 완료 후 매트릭스를 노출하는 실제 상태 분기이므로 local refresh와 분리해 계속 fail-closed로 유지한다.

## Root Cause

FACT review payload는 “local-only view controls를 요구하지 말라”고만 썼고 구체 경계가 없었다. 모델은 화면 안의 결과가 바뀐다는 이유로 modal close, filter/search, pagination, refresh까지 모두 meaningful self-loop로 해석했다.

review verdict는 untrusted defect report지만, 기존 executor는 issue별 policy scope를 적용하지 않고 전체 문자열을 semantic repair와 completion gate에 전달했다. 이 때문에 author가 올바르게 제외한 컨트롤 때문에 stage가 실패하거나 불필요한 edge/workflow/scenario가 생성될 수 있었다.

## Solution

공통 FACT review contract에 local-only 범위를 명시했다.

```text
modal close/backdrop
filter/search
pagination
expand/collapse
refresh
```

이 컨트롤은 supplied FACT가 해당 action 자체를 workflow outcome으로 확정한 경우만 edge 대상이다. 단순 local view state 변화는 self-loop 근거가 아니다.

executor는 verdict를 다음처럼 처리한다.

1. local-only issue와 실제 journey issue가 섞이면 local-only issue만 제거하고 유효 issue를 semantic repair에 전달한다.
2. 모든 issue가 local-only면 artifact를 자동 통과시키지 않고 독립 review를 정확히 1회 다시 요청한다.
3. scope correction review에도 실제 guard, journey action, state, API effect, identity, evidence gap을 계속 찾도록 요구한다.
4. 두 번째 review가 다시 fail하면 그대로 terminal failure다.

runtime의 `stage-reviewer.md`와 `gate-review/SKILL.md`도 같은 예시와 예외 규칙으로 동기화했다.

## Regression Test

[`pi-generation-executor.test.ts`](../../../apps/desktop/src/main/application/pi-generation-executor.test.ts)에 두 fixture를 추가했다.

- 모든 issue가 modal close/pagination/refresh인 verdict는 scope-corrected independent review를 1회 수행하고 pass한다.
- modal close/refresh와 `MISSING_SCENARIO_RESULT_CONFIRMATION_BRANCH`가 섞이면 review를 반복하지 않고 유효 journey issue만 보존한다.

수정 전 첫 fixture는 첫 fail verdict를 그대로 반환했고, 두 번째 fixture는 local issue까지 모두 repair 입력에 남겨 RED였다. 수정 후 둘 다 GREEN이다.

## Verification

- Pi executor 집중 테스트: 19개 통과
- generation harness E2E 집중 테스트: 8개 통과
- 대상 프로젝트 runtime에 명시적 local-view-control 범위 복사 확인
- live rerun: `RUN-9c03ffe1-125d-49ee-8d64-f153d7d2d375` 진행 중

## Prevention

1. “화면이 바뀐다”와 “업무 상태/결과가 바뀐다”를 같은 self-loop 기준으로 쓰지 않는다.
2. reviewer issue는 전체 verdict 단위가 아니라 policy scope별로 분류한다.
3. scope 밖 verdict를 곧바로 pass로 바꾸지 않고 독립 재검토 1회를 둔다.
4. local control과 실제 상태 분기가 같은 element를 공유하면 predicate guard별 edge를 분리한다.
5. local controls를 FACT에 넣어 WIKI/SCENARIO 100%를 인위적으로 부풀리지 않는다.

## Related

- [FACT semantic bounded repair](./fact-semantic-review-bounded-repair-loop.md)
- [FACT replacement predicate reference](./fact-semantic-replacement-predicate-reference-invalid.md)
- [FACT/WIKI/SCENARIO edge coverage](./fact-workflow-scenario-edge-coverage-not-gated.md)
