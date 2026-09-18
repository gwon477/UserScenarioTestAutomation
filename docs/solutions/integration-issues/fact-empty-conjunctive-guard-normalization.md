---
title: "FACT 무조건 전이가 빈 guard.all로 제출되어 schema gate에서 거부됨"
date: "2026-08-27"
category: "integration-issues"
module: "scenarioforge-fact-compiler"
problem_type: "integration_issue"
component: "fact-enrichment-contract"
severity: "medium"
symptoms:
  - "FACT author 출력의 무조건 전이에 guard.all 빈 배열이 포함됨"
  - "FACT_PATCH_SCHEMA_INVALID로 WIKI 이전에 분석이 종료됨"
root_cause: "empty_conjunction_used_for_unconditional_edge"
resolution_type: "boundary_normalization"
related_components:
  - "fact-draft-compiler"
  - "pi-generation-executor"
  - "fact-author-skill"
tags:
  - "fact"
  - "guard"
  - "normalization"
  - "schema-boundary"
---

# FACT 무조건 전이의 빈 conjunction 정규화

## Problem

실제 run `RUN-879403fd-ae41-454b-9bf2-accf3108b783`의 FACT author는 9개 edge 중 조건이 없는 2개 edge를 다음처럼 제출했다.

```json
{"guard":{"all":[]}}
```

복수 조건을 지원하기 위해 추가한 patch 계약은 `guard.all`이 존재하면 한 개 이상의 clause가 있어야 하므로 compiler가 `FACT_PATCH_SCHEMA_INVALID`로 거부했다.

## Prior-history comparison

- API null-list 문제와 terminal error 문자열은 같지만 이번 출력에는 null이 없었다.
- canonical ID/reference drift와 달리 모든 opaque ref는 유효했다.
- 복수 guard 계약 자체는 정상 작동했고 조건부 edge에는 1~3개의 clause가 들어 있었다.
- 실패는 무조건 전이만 빈 conjunction으로 표현한 신규 provider/model 경계 변형이다.

## Root Cause

논리적으로 빈 conjunction은 `true`, 즉 조건 없음과 같은 의미지만 wire contract는 이를 허용하지 않았다. author 지시에도 무조건 전이의 guard 표현이 명시되지 않아 모델이 `guard.all: []`을 선택했다.

## Solution

- compiler 입구에서 정확히 `guard: { all: [] }`만 guard 생략으로 canonicalize한다.
- 정규화 후 기존 전체 schema assertion과 reference/value 검증을 그대로 실행한다.
- 비어 있지 않은 `guard.all`은 계속 모든 clause를 엄격히 검증하고 canonical `&&` guard로 컴파일한다.
- author task, runtime skill, FACT agent에 무조건 전이는 guard를 생략하고 빈 `guard.all`을 제출하지 말라고 명시한다.

## Regression Test

`generation-core.test.ts`에 빈 conjunction edge를 추가했다.

- 수정 전: `FACT_PATCH_SCHEMA_INVALID` RED
- 수정 후: guard 없는 canonical FACT edge GREEN

`pi-generation-executor.test.ts`는 author task에 `Omit guard for unconditional` 규약이 포함되는지 확인한다.

## Verification

- scenario-pipeline 집중 테스트 21개 통과
- Pi executor 집중 테스트 10개 통과
- 전체 workspace 테스트 119개 통과
- 전체 workspace TypeScript 검사 통과
- Electron production build 통과 및 변경된 runtime skill/agent 포함 확인
- live rerun `RUN-3169353d-dc49-4904-854a-259ecd84d5a2`에서 FACT schema/compiler와 semantic reviewer가 모두 통과해 재발하지 않았다.

## Prevention

1. 같은 오류 코드라도 patch의 null path, 각 collection type, guard shape를 먼저 비교한다.
2. 정보량이 동일한 wire 표현만 좁게 정규화한다.
3. 정규화가 schema/reference gate를 우회하지 않게 assertion 전에만 적용한다.
4. prompt와 runtime skill/agent를 compiler 계약과 함께 변경한다.
5. 실제 Azure 모델 재실행으로 FACT reviewer까지 통과하는지 확인한다.

## Related

- [FACT 복수 조건 guard 계약](./fact-conjunctive-guard-contract.md)
- [FACT API null-list 정규화](./fact-api-null-list-normalization.md)
- [Pi Coding Agent 하네스 설계](../../pi-coding-agent%20하네스%20설계.md)
