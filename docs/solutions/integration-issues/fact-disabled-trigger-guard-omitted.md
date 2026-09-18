---
title: "disabled 조건이 있는 FACT 전이에서 등록 guard가 누락됨"
date: "2026-08-27"
category: "integration-issues"
module: "scenarioforge-fact-author"
problem_type: "semantic_rejection"
component: "fact-enrichment-prompt"
severity: "high"
symptoms:
  - "FACT schema/compiler는 통과했지만 semantic reviewer가 edge를 거부함"
  - "disabled={!taskId} 조건이 effect의 자연어로만 남고 predicate/guard에는 없음"
root_cause: "trigger_enablement_checklist_not_explicit"
resolution_type: "author-contract-hardening"
related_components:
  - "pi-generation-executor"
  - "fact-author-skill"
  - "fact-analyst-agent"
tags:
  - "fact"
  - "disabled"
  - "guard"
  - "semantic-review"
---

# disabled 조건이 있는 FACT 전이의 guard 누락

## Problem

빈 conjunction 정규화 후 실제 run `RUN-a3fafbd9-5a47-4112-9755-de958059a6e4`는 FACT schema/compiler를 통과했다. 그러나 semantic reviewer가 Settings edge `E-0007`을 거부했다.

- source trigger: `disabled={!taskId}`
- author artifact: guard 없음
- effect: 작업이 있을 때 설정을 연다는 조건부 자연어만 포함
- reviewer: task 존재를 등록 predicate와 guard로 표현하라고 요구

## Prior-history comparison

- 빈 `guard.all` 문제는 재발하지 않았으며 compiler가 무조건 edge를 정상 처리했다.
- 복수 guard 표현력 문제와 달리 schema는 단일/복수 조건 모두 표현할 수 있다.
- 이번 문제는 author가 개별 trigger의 enablement 조건을 놓친 의미 추출 누락이다.
- reviewer가 evidence를 근거로 누락을 차단했으므로 reviewer 기준 완화 대상이 아니다.

## Root Cause

기존 author 지시는 “conditionally rendered or enabled”를 일반적으로 언급했지만, edge마다 JSX `disabled` 표현을 확인하고 identifier-presence를 등록하라는 구체 체크리스트가 없었다. 그 결과 모델은 조건을 effect 서술에만 남겼다.

## Solution

FACT author task, runtime skill, FACT analyst agent에 다음 규약을 함께 추가했다.

- 제안하는 모든 edge의 정확한 trigger evidence를 확인한다.
- `disabled={condition}`, `disabled={!value}`, 조건부 렌더링, handler early return을 명시적으로 검사한다.
- trigger가 enabled/executable이 되기 위한 identifier-presence와 모든 상태 conjunct를 predicate 및 `guard.all`로 등록한다.
- effect의 조건부 자연어는 guard로 인정하지 않는다.
- reviewer의 누락 거부 규칙은 유지한다.

## Regression Test

`pi-generation-executor.test.ts`가 author payload에 아래 두 규약이 존재하는지 검증한다.

- `disabled={condition}` trigger 검사
- `Conditional wording in effect does not count` 규칙

수정 전 RED, 수정 후 Pi executor 집중 테스트 10개 GREEN이다.

## Verification

- Pi executor 집중 테스트 10개 통과
- 전체 workspace 테스트 119개 통과
- 전체 workspace TypeScript 검사 통과
- Electron production build 통과 및 변경된 runtime skill/agent 포함 확인
- live rerun `RUN-3169353d-dc49-4904-854a-259ecd84d5a2`에서 FACT reviewer가 `pass=true`로 완료되어 prerequisite 누락 거부가 재발하지 않았다.

## Prevention

1. semantic reviewer가 edge prerequisite 누락을 지적하면 schema 표현력과 author 준수를 분리한다.
2. 조건을 effect에서 발견해도 registered predicate/guard가 없으면 실패로 유지한다.
3. UI trigger별 disabled/render/handler 조건을 author 체크리스트로 고정한다.
4. runtime template의 task, skill, agent 규약을 동시에 갱신한다.
5. 실제 모델 재실행에서 해당 edge의 guard와 reviewer verdict를 확인한다.

## Related

- [FACT bounded semantic repair](./fact-semantic-review-bounded-repair-loop.md)
- [FACT 복수 조건 guard 계약](./fact-conjunctive-guard-contract.md)
- [FACT 빈 conjunction 정규화](./fact-empty-conjunctive-guard-normalization.md)
- [Pi Coding Agent 하네스 설계](../../pi-coding-agent%20하네스%20설계.md)
