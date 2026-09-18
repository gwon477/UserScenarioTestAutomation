---
title: "중립 source interaction이 transition inventory에서 누락됨"
date: "2026-09-07"
category: "integration-issues"
module: "scenarioforge-source-transition-inventory"
problem_type: "integration_issue"
component: "source-interaction-behavior"
severity: "high"
symptoms:
  - "SOURCE_TRANSITION_OBLIGATION_INTERACTION_MISSING"
root_cause: "behavior_presence_confused_with_transition_obligation_presence"
resolution_type: "code_fix"
related_components:
  - "staged-user-journey-runner"
  - "transition-coverage-audit"
tags:
  - "SOURCE_TRANSITION_OBLIGATION_INTERACTION_MISSING"
  - "source-inventory"
  - "transition-obligation"
---

# 중립 source interaction이 transition inventory에서 누락됨

## Problem

`RUN-AXSE-AGENTIC-20260904-07`, `WORK-AXSE-USER-JOURNEYS`의 04 transition correction이 `SOURCE_TRANSITION_OBLIGATION_INTERACTION_MISSING`으로 모델 호출 전에 종료됐다. handler 분석 결과는 존재하지만 `local_view_only=false`, `journey_required=false`인 interaction이 obligation과 unresolved 양쪽에서 빠졌다.

## Root Cause

`createSourceTransitionObligationInventory()`가 behavior map에 없는 interaction만 unresolved로 분류했다. behavior가 존재해도 실제 transition obligation을 만들지 않는 중립 behavior가 있으므로, behavior 존재 여부는 inventory 포함 여부의 올바른 기준이 아니었다.

## Solution

`sourceBehaviorTransitionObligations()` 결과에서 실제 `source_action_ref` 집합을 만들고, 그 집합에 없는 모든 interaction을 unresolved로 보존한다.

변경 파일:

- `packages/scenario-pipeline/src/scanning/source-interaction-behavior.ts`

## Regression Test

`packages/scenario-pipeline/src/scanning/source-interaction-behavior.test.ts`가 중립 behavior도 `unresolved_interactions`에 남는지 검증한다.

```text
node ../../node_modules/vitest/vitest.mjs run src/scanning/source-interaction-behavior.test.ts --config vitest.config.ts
```

## Verification

- focused scanner test 1개 통과
- staged design test 111개 통과
- 전체 workspace/root test 통과
- 전체 typecheck와 Electron production build 통과
- 같은 AXSE run의 04 transition correction revision 2가 모델 호출과 로컬 검증까지 완료됨
