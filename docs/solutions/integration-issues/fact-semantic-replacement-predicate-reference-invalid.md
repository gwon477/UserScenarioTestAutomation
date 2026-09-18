---
title: "FACT 의미 교정 replacement의 미등록 predicate 참조"
date: "2026-08-28"
category: "integration-issues"
module: "scenarioforge-generation-harness"
problem_type: "integration_issue"
component: "fact-semantic-repair"
severity: "high"
symptoms:
  - "RUN-8a04cd9a-6706-4936-8e43-8a965ebdb72f FACT 교정 뒤 FACT_PATCH_REFERENCE_INVALID:predicate_key:parsed_query_applied로 중단됨"
  - "첫 FACT reviewer issue는 모두 반영했지만 replacement patch compile 전에 terminal fail함"
root_cause: "semantic_replacement_predicate_reference_drift"
resolution_type: "code_fix"
related_components:
  - "pi-generation-executor"
  - "scenario-generation-harness"
  - "fact-analyst"
  - "fact-extraction-react"
tags:
  - "FACT_PATCH_REFERENCE_INVALID:predicate_key"
  - "EDGE_EFFECT_PREDICATE_INVALID"
  - "bounded-repair"
  - "replacement-patch"
  - "predicate-integrity"
---

# FACT 의미 교정 replacement의 미등록 predicate 참조

## Problem

실제 실행 `RUN-8a04cd9a-6706-4936-8e43-8a965ebdb72f`, FACT work `f2fd6514-3087-436d-826d-c243afb4cdcf`의 최초 patch는 9개 화면과 31개 edge를 제안했다. 독립 reviewer는 가드 누락 4건과 self-loop 누락 2건을 거부했고, 설계된 1회 semantic repair가 replacement patch를 제출했다.

replacement는 검색 self-loop를 다음처럼 추가했다.

```text
effect: parsed_query_applied=true
```

그러나 같은 patch의 `predicates[]`에는 `parsed_query_applied` 선언이 없었다. 정확한 terminal 오류는 Electron main log의 다음 문자열이다.

```text
FACT_PATCH_REFERENCE_INVALID:predicate_key:parsed_query_applied
```

stage는 FACT invalid로 fail-closed됐으며 WIKI와 SCENARIO는 시작되지 않았다.

## Prior-history comparison

- [`fact-patch-canonical-id-reference-drift.md`](./fact-patch-canonical-id-reference-drift.md)의 S/U/A opaque ref 변형과 다르다. 이번 replacement의 screen/element ref는 모두 scanner inventory에 존재했다.
- [`fact-semantic-review-bounded-repair-loop.md`](./fact-semantic-review-bounded-repair-loop.md)의 첫 semantic repair 자체는 정상 호출·제출됐다. 새 문제는 그 replacement가 compile contract를 만족하지 못했을 때 회복 경로가 없다는 점이다.
- runtime-template은 최신 patch v2였고 source evidence도 reviewer까지 정상 전달됐다.

따라서 기존 canonical identity 문제를 반복 수정하지 않고, **semantic replacement 내부 predicate reference 무결성**이라는 다른 contract boundary로 분류했다.

## Root Cause

semantic repair는 reviewer issue를 해결하는 replacement patch를 정확히 한 번 생성했지만, replacement의 guard/effect key와 `predicates[]` 선언을 교차 검증한 결과가 실패하면 즉시 terminal error로 전파했다.

fail-closed compiler는 올바르게 미등록 key를 거부했다. 부족했던 것은 의미 재검토를 반복하지 않으면서도 이 제한된 구조 정합성만 교정할 bounded recovery 경로였다. 일반 provider retry로 처리할 수 없고, undeclared predicate를 backend가 자동 생성하면 오타와 근거 없는 상태를 canonical FACT로 승격하므로 자동 합성도 허용할 수 없다.

## Solution

semantic-review repair는 최대 6회로 제한된다. 최초 patch 또는 각 replacement가 다음 predicate reference 오류만 발생시키면 같은 work/evidence/ref 범위에서 **최종 contract correction 1회**를 허용한다.

```text
FACT_PATCH_REFERENCE_INVALID:predicate_key:*
FACT_PATCH_REFERENCE_INVALID:predicate_value:*
EDGE_GUARD_PREDICATE_INVALID
EDGE_EFFECT_PREDICATE_INVALID
```

- Pi executor는 patch compiler의 `predicate_key`/`predicate_value` reference error만 catch한다.
- invalid replacement와 정확한 error code를 새 교정 요청에 전달하고 fresh artifact submission을 요구한다.
- 두 번째 replacement는 처음부터 다시 compile하며, 다시 실패하면 그대로 terminal error다.
- 일반 schema, S/U/A ref, evidence, scope 오류에는 이 경로를 열지 않는다.
- custom `GenerationExecutor`가 compiled FactBundle을 반환하는 경우를 위해 harness도 최초 semantic replacement 뒤 guard/effect predicate validation issue만 동일한 최종 교정 대상으로 제한한다.
- agent/skill은 모든 guard/effect key와 value가 같은 replacement의 `predicates[]`에 선언됐는지 제출 전에 비교한다. durable state가 없는 self-loop는 불필요한 effect를 생략한다.

## Regression Test

[`pi-generation-executor.test.ts`](../../../apps/desktop/src/main/application/pi-generation-executor.test.ts)는 첫 replacement가 `query_applied` effect를 참조하지만 predicate를 선언하지 않는 실제 형태를 재현한다. 수정 전 정확히 `FACT_PATCH_REFERENCE_INVALID:predicate_key:query_applied`로 RED였고, 수정 후 두 번째 artifact 요청에서 선언을 보완해 GREEN이다.

후속 `RUN-14233f83-2fea-442e-a154-2c2855a9e836`에서는 최초 FACT patch가 `generation_failed` effect를 사용하면서 predicate를 선언하지 않아 reviewer 이전에 같은 오류로 중단됐다. 기존 correction은 `repairFacts`에만 있어 최초 `extractFacts`에는 적용되지 않았다. 최초 patch에도 predicate key/value 전용 correction을 정확히 1회 적용하고, 실제 오류 문자열과 두 번째 payload를 검증하는 집중 테스트를 추가했다. 일반 schema/ref/evidence 오류나 두 번째 correction 실패는 그대로 terminal이다.

[`scenario-generation-harness.test.ts`](../../../tests/e2e/scenario-generation-harness.test.ts)는 compiled replacement가 `EDGE_EFFECT_PREDICATE_INVALID`인 executor fixture를 사용한다. 수정 전 stage reject로 RED였고, 최종 contract correction 후 전체 SRC→FACT→WIKI→SCENARIO가 GREEN이다.

## Verification

- Pi executor 집중 테스트: 19개 통과
- generation harness E2E 집중 테스트: 8개 통과
- 새 runtime-template이 Electron main output과 대상 프로젝트 `.scenarioforge/runtime`에 복사된 것 확인
- live rerun: `RUN-c7f1ebfc-2c86-481c-9528-3e4c8257b58c` 진행 중

## Prevention

1. semantic reviewer 실패와 replacement compile 실패를 같은 재시도로 세지 않는다.
2. contract correction은 predicate reference 정합성에만 한정한다.
3. 미등록 predicate를 backend가 추측해 자동 생성하지 않는다.
4. 두 번째 replacement가 실패하면 횟수를 늘리지 않고 exact terminal code를 유지한다.
5. S/U/A ref, evidence, scope, 일반 schema 오류는 기존 fail-closed 경계를 유지한다.

## Related

- [FACT semantic bounded repair](./fact-semantic-review-bounded-repair-loop.md)
- [FACT patch canonical ref drift](./fact-patch-canonical-id-reference-drift.md)
- [FACT edge coverage gate](./fact-workflow-scenario-edge-coverage-not-gated.md)
