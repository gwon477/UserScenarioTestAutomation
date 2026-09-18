---
title: "거친 scenario step의 transition linkage를 executable coverage로 과대평가함"
date: "2026-09-07"
category: "integration-issues"
module: "scenarioforge-transition-coverage"
problem_type: "architecture_mismatch"
component: "staged-scenario-transition-audit"
severity: "high"
symptoms:
  - "33개 transition ref가 한 normal case의 6개 step에 집중됐지만 missing=0으로 보고됨"
  - "한 step에 최대 12개 transition ref가 연결됨"
root_cause: "milestone_linkage_confused_with_guarded_path_coverage"
resolution_type: "review-scope-alignment"
related_components:
  - "fact-edge-ledger"
  - "graph-tools"
  - "staged-scenario-case-runner"
tags:
  - "transition-coverage"
  - "lower-bound-transition-linkage"
  - "not-measurable"
---

# Transition linkage와 executable coverage 구분

## Problem

`RUN-AXSE-AGENTIC-20260904-07`의 revision 3 로컬 audit은 69개 obligation 중 33개 covered, 36개 unresolved, missing 0을 보고했다. 외부 의미 검토에서는 33개 ref 전부가 첫 normal case에만 연결됐고 네 step에 각각 6, 2, 11, 12개가 몰린 것을 확인했다. case body는 이전 실패 후보와 같은 8개였다.

## Root Cause

staged transition inventory는 source action과 outcome의 lower-bound 목록일 뿐 canonical `from`/`to` view state, guard, effect, choice group, reachable path가 없다. milestone이 같은 ref를 coarse step에 붙인 사실은 연결성만 증명하며 서로 다른 실행 분기 커버리지를 증명하지 않는다.

## Solution

- staged audit에 `assessment_kind=lower-bound-transition-linkage`와 `executable_coverage_status=not-measurable`을 명시한다.
- 05 검증 결과의 함수·필드·수치는 `transition_linkage`, `linked`, `linkage_percent`로 기록하고 `covered`, `coverage_percent`를 노출하지 않는다.
- 한 step에 여러 ref가 연결된 위치를 `non_atomic_step_mappings`로 보고한다.
- 05 로컬 probe 성공만으로 run marker를 05로 전진시키지 않는다.
- 새 graph 구현 대신 기존 FACT edge ledger와 `graph-tools`의 guard/effect 기반 deterministic path compiler를 다음 integration 기준으로 선택한다.

## Regression Test

`tests/design/staged-agent-scenario-cases.test.ts`가 linkage 상태와 non-atomic step 감사를 검증하고, 05 runner가 `run.json`을 갱신하지 않는지 확인한다.

## Verification

- staged design test 111개 통과
- 전체 workspace/root test, typecheck, Electron production build, `git diff --check` 통과
- golden 외부 평가: complete journey와 case kind는 유지됐지만 44개 case family 대비 case body는 8개로 동일해 breadth checkpoint 실패
- 후보는 `05-scenario-cases-transition-linkage-evaluation-failed-17`에 보존하고 run marker는 검증된 04 revision 2로 복원
