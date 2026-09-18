---
title: "FACT api_updates의 빈 reads/writes가 null로 제출되어 schema gate에서 거부됨"
date: "2026-08-27"
category: "integration-issues"
module: "scenarioforge-fact-compiler"
problem_type: "integration_issue"
component: "fact-draft-compiler"
severity: "medium"
symptoms:
  - "FACT author가 predicate와 guarded edge를 정상 제출했지만 FACT_PATCH_SCHEMA_INVALID로 종료됨"
  - "API 의미 업데이트의 한쪽 방향이 null이고 다른 방향만 배열임"
root_cause: "nullable_empty_api_semantics"
resolution_type: "code_fix"
related_components:
  - "pi-generation-executor"
  - "fact-enrichment-contract"
tags:
  - "fact-patch"
  - "api-updates"
  - "null-normalization"
  - "schema-boundary"
---

# FACT api_updates의 빈 reads/writes가 null로 제출되어 schema gate에서 거부됨

## Problem

SCENARIO precondition 계약을 강화한 뒤 실제 재실행 `RUN-04e498f7-c6e9-4b85-8840-3118ddcf4e0c`의 FACT author는 조건부 전이에 guard 7건과 predicate 5건을 제출했다. 그러나 compiler는 `FACT_PATCH_SCHEMA_INVALID`로 artifact를 거부했다.

구조 점검 결과 다른 필드는 모두 계약과 일치했고 다음 두 값만 달랐다.

```json
{"api_ref":"A1","reads":null,"writes":["..."]}
{"api_ref":"A2","reads":["..."],"writes":null}
```

## Prior-history comparison

- canonical ID/reference drift: opaque `S/U/A` ref는 모두 유효해 이전 문제와 다름
- malformed full FACT: patch top-level 필수 배열은 모두 존재함
- API effect evidence: writes 의미가 실제로 제출되어 evidence slice 절단 재발이 아님
- conditional guard: 강화한 계약대로 predicate/guard가 생성됨

따라서 같은 terminal code 문자열을 일부 공유하지만 깨진 필드는 신규 경계다.

## Root Cause

output contract와 task는 `reads`, `writes`를 배열로 요구했지만 모델은 의미가 없는 방향을 JSON `null`로 표현했다. compiler는 이를 즉시 거부했다. 이 두 필드에서 `null`은 “기록 없음”이라는 한 가지 의미밖에 없고 빈 배열과 정보량이 동일하다.

## Solution

- author task에 `Use [] rather than null`을 명시한다.
- compiler 입구에서 **오직** `api_updates[].reads`와 `api_updates[].writes`의 `null`만 `[]`로 canonicalize한다.
- 다른 타입 오류, 누락 필드, 잘못된 ref, 잘못된 guard/predicate는 기존처럼 fail-closed로 거부한다.
- 정규화 후 기존 `assertPatch`를 그대로 실행하므로 schema gate를 우회하지 않는다.

## Regression Test

- `generation-core.test.ts`: `reads:null`, `writes:null` patch가 canonical 빈 배열로 컴파일되는지 확인한다. 수정 전 `FACT_PATCH_SCHEMA_INVALID` RED, 수정 후 GREEN이다.
- `pi-generation-executor.test.ts`: author task가 빈 API 의미를 `[]`로 요구하는지 확인한다. 수정 전 RED, 수정 후 GREEN이다.

## Verification

- scenario-pipeline 집중 테스트 18개 통과
- Pi executor 집중 테스트 10개 통과
- 후속 conjunctive guard 회귀를 포함한 전체 workspace 테스트 118개 통과
- 전체 workspace TypeScript 검사 통과
- Electron production build 및 runtime-template 포함 확인
- live rerun은 후속 검증에서 기록한다.

## Prevention

`FACT_PATCH_SCHEMA_INVALID`는 top-level schema만 보지 않는다.

1. 각 update 배열의 필드별 JSON type을 출력한다.
2. ID/ref 오류와 nullable empty-value 표현을 구분한다.
3. 정규화는 정보량이 동일한 단일 표현에만 허용한다.
4. 정규화 뒤에도 전체 schema assertion을 실행한다.
5. 새 provider/model이 null을 반복하더라도 prompt와 compiler 양쪽 계약을 함께 유지한다.

## Related

- [FACT canonical ID 및 provider failure 이력](./fact-patch-canonical-id-reference-drift.md)
- [API effect evidence slice 절단](./api-effect-evidence-slice-truncation.md)
- [SCENARIO precondition 소실](./scenario-preconditions-dropped-from-workflow-variation.md)
