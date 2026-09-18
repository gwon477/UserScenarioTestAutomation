---
title: "WIKI reviewer가 author에게 없는 소스 동작을 요구함"
date: "2026-08-27"
category: "integration-issues"
module: "scenarioforge-semantic-review"
problem_type: "architecture_mismatch"
component: "wiki-review-boundary"
severity: "high"
symptoms:
  - "WIKI author는 FACT만 입력받지만 reviewer는 원본 source evidence를 근거로 실패 terminal을 요구함"
  - "구조적으로 유효한 WIKI가 author가 알 수 없는 요구로 semantic reject됨"
root_cause: "asymmetric_author_reviewer_evidence_scope"
resolution_type: "review-scope-alignment"
related_components:
  - "pi-generation-executor"
  - "wiki-compose"
  - "gate-review"
tags:
  - "wiki"
  - "reviewer"
  - "evidence-boundary"
  - "failure-terminal"
---

# WIKI author/reviewer evidence 범위 비대칭

## Problem

실제 run `RUN-e5303893-957f-4c12-8d0c-455b0dd78d5c`는 FACT reviewer를 통과한 뒤 WIKI reviewer에서 종료됐다.

- WIKI author 입력: verified FACT graph만
- WIKI artifact: FACT 경로로 지원되는 3개 workflow
- reviewer 추가 입력: 원본 source evidence slice
- reviewer 요구: FACT에 표현되지 않은 업로드 파싱 실패와 시나리오 생성 실패를 `failure_terminals`에 추가

설계상 WIKI writer는 소스 접근이 없고 bounded graph만 사용한다. 따라서 해당 요구는 author가 충족할 수 없는 입력 비대칭이었다.

## Prior-history comparison

- FACT disabled guard 누락과 달리 author가 자신에게 제공된 evidence를 놓친 문제가 아니다.
- WIKI terminal/path validator는 통과했고 모든 terminal은 FACT graph 범위에 있었다.
- 기존 수정 이력에는 failure terminal 관련 사례가 없었다.
- 상위 하네스 문서의 `wiki-writer: bounded 그래프 뷰만`, `wiki-reviewer: workflow + cites 레코드` 규약과 구현이 충돌한 신규 문제다.

## Root Cause

공통 `review()` 경로가 FACT/WIKI/SCENARIO 모든 단계에 FACT source evidence slice를 전달했다. WIKI reviewer가 이를 검증 보조가 아니라 WIKI 완전성 요구의 새로운 근거로 사용하면서, FACT에 없는 동작을 WIKI에 직접 추가하라고 요구했다. 이는 FACT/WIKI 층 분리를 깨뜨린다.

## Solution

- WIKI reviewer에는 source evidence grant/slice를 생성하거나 전달하지 않는다.
- WIKI review payload는 verified FACT graph와 citations만 포함한다.
- reviewer task/skill/agent에 WIKI에서 FACT에 없는 source behavior를 요구하지 말라고 명시한다.
- FACT reviewer는 계속 원본 evidence로 FACT 추출 누락과 guard를 검사한다.
- SCENARIO reviewer는 source evidence를 upstream FACT 주장 검증에만 사용하고 FACT/WIKI에 없는 요구를 추가하지 않는다.

## Regression Test

`pi-generation-executor.test.ts`에 source-only evidence를 전달해도 WIKI review payload에서 제거되는 테스트를 추가했다.

- 수정 전: `reviewer_evidence_slices`에 source-only 동작이 남아 RED
- 수정 후: 빈 evidence slice + verified FACT/citations scope로 GREEN

## Verification

- Pi executor 집중 테스트 11개 통과
- bounded-repair 후속 회귀를 포함한 전체 workspace 테스트 124개 통과
- 전체 workspace TypeScript 검사 통과
- Electron production build 통과 및 변경된 reviewer skill/agent 포함 확인
- live rerun `RUN-3169353d-dc49-4904-854a-259ecd84d5a2`에서 WIKI author 산출 1건과 WIKI reviewer `pass=true`를 확인했고 source-only failure terminal 요구가 재발하지 않았다.

## Prevention

1. 각 stage의 author와 reviewer가 판단할 수 있는 입력 범위를 표로 고정한다.
2. reviewer evidence는 기존 주장의 검증 수단이지 하위 stage 요구사항 확장 수단이 아니다.
3. 소스에서 발견한 누락은 FACT reviewer가 FACT 단계에서 차단한다.
4. WIKI/SCENARIO는 verified upstream artifact가 표현하지 않은 동작을 창작하거나 강제하지 않는다.
5. stage별 review payload 회귀 테스트로 source evidence 유입을 막는다.

## Related

- [FACT disabled trigger guard 누락](./fact-disabled-trigger-guard-omitted.md)
- [Pi Coding Agent 하네스 설계](../../pi-coding-agent%20하네스%20설계.md)
