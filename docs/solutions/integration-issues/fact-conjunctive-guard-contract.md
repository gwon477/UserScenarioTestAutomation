---
title: "조건부 전이의 복수 조건절을 단일 FACT patch guard로 표현할 수 없음"
date: "2026-08-27"
category: "integration-issues"
module: "scenarioforge-fact-compiler"
problem_type: "integration_issue"
component: "fact-enrichment-contract"
severity: "high"
symptoms:
  - "FACT author가 대표 조건 하나만 guard로 등록함"
  - "FACT reviewer가 locked=false 또는 requesting=false 누락을 거부함"
  - "상위 FACT 모델은 && guard를 허용하지만 patch schema는 단일 predicate만 허용함"
root_cause: "single_clause_patch_guard"
resolution_type: "contract_extension"
related_components:
  - "fact-draft-compiler"
  - "scenario-compiler"
  - "fact-author-skill"
  - "fact-reviewer"
tags:
  - "fact"
  - "guard"
  - "conjunction"
  - "predicate"
  - "precondition"
---

# 조건부 전이의 복수 조건절을 단일 FACT patch guard로 표현할 수 없음

## Problem

실제 run `RUN-79f3ab37-320c-40b6-9465-a2e7da7494fb`에서 강화된 FACT reviewer는 두 edge를 거부했다.

- `complete && !locked` 중 `complete`만 guard에 있음
- 선택 조건과 `requesting=false` 중 선택 조건만 guard에 있음

author에게 모든 조건을 등록하라고 요구했지만 당시 patch contract는 다음 단일 객체만 허용했다.

```json
{"guard":{"predicate_key":"...","value":"..."}}
```

따라서 reviewer 요구를 구조적으로 만족할 수 없었다.

## Prior-history comparison

- precondition 소실: 이번에는 deterministic compiler 이전 FACT patch 표현력 문제임
- scenario narration lock: scenario stage에 도달하지 않음
- nullable API list: reads/writes 정규화는 정상이며 무관함
- canonical ID/reference: opaque ref는 정상

상위 하네스 설계와 `FactEdge.guard?: string`은 이미 `PRED-a && PRED-b`를 허용하므로 patch 축소 구현이 원인인 신규 문제다.

## Solution

patch edge guard를 backward-compatible union으로 확장했다.

```ts
guard?:
  | { predicate_key: string; value: string }
  | { all: Array<{ predicate_key: string; value: string }> };
```

- 기존 단일 guard patch는 계속 허용한다.
- `guard.all`은 비어 있을 수 없고 모든 clause가 등록 predicate key/value여야 한다.
- backend compiler가 각 clause를 canonical `PRED-id=value`로 바꾸고 ` && `로 결합한다.
- scenario compiler가 결합 guard를 clause별로 분리해 각 predicate를 구조화 precondition으로 보존한다.
- author skill/task는 조건부 렌더·enabled·early return의 모든 conjunct, 특히 busy/locked/submitting/requesting의 음수 readiness 상태를 요구한다.
- FACT reviewer 기준은 완화하지 않는다.

## Regression Test

`generation-core.test.ts`에서 `cart_ready=true && request_idle=true` 두 clause patch를 작성한다.

- 수정 전: `FACT_PATCH_SCHEMA_INVALID` RED
- 수정 후: canonical FACT guard 두 clause 생성
- 같은 graph의 deterministic scenario에 precondition 두 건 생성

`pi-generation-executor.test.ts`는 output contract의 `guard.all`과 author task의 `every conjunct` 요구를 확인한다.

## Verification

- scenario-pipeline 집중 테스트 20개 통과
- Pi executor 집중 테스트 10개 통과
- 전체 workspace 테스트 118개 통과
- 전체 workspace TypeScript 검사와 Electron production build 통과
- 변경된 FACT skill/agent의 runtime-template 포함 확인
- live rerun은 후속 검증에서 기록한다.

## Prevention

reviewer가 “조건 누락”을 지적하면 prompt 준수 문제로만 보지 않는다.

1. output schema가 요구된 논리 구조를 표현할 수 있는지 확인한다.
2. 상위 canonical 모델과 LLM patch 모델의 표현력을 비교한다.
3. 복수 조건의 순서와 ID/value를 backend가 canonicalize한다.
4. downstream scenario compiler가 모든 conjunct를 잃지 않는지 검증한다.
5. 단일 guard 입력 호환성을 유지해 기존 artifact를 깨지 않는다.

## Related

- [FACT disabled trigger guard 누락](./fact-disabled-trigger-guard-omitted.md)
- [FACT 빈 conjunction 정규화](./fact-empty-conjunctive-guard-normalization.md)
- [SCENARIO precondition 소실](./scenario-preconditions-dropped-from-workflow-variation.md)
- [FACT API null-list 정규화](./fact-api-null-list-normalization.md)
- [Pi Coding Agent 하네스 설계](../../pi-coding-agent%20하네스%20설계.md)
