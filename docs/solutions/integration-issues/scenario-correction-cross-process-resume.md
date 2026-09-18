---
title: "부분 성공 scenario correction을 프로세스 재시작 후 잃음"
date: "2026-09-07"
category: "integration-issues"
module: "scenarioforge-scenario-correction"
problem_type: "integration_issue"
component: "scenario-correction-resume"
severity: "high"
symptoms:
  - "SCENARIO_CASE_CORRECTION_UNCHANGED"
  - "35개 target 중 34개 성공 후 프로세스 종료 시 성공 변경 재생 불가"
root_cause: "partial_correction_state_was_memory_only"
resolution_type: "code_fix"
related_components:
  - "scenario-case-correction-plan"
  - "staged-scenario-case-runner"
tags:
  - "SCENARIO_CASE_CORRECTION_UNCHANGED"
  - "correction-resume"
  - "partial-merge"
---

# Scenario correction의 교차 프로세스 resume

## Problem

`RUN-AXSE-AGENTIC-20260904-07`, `WORK-AXSE-SCENARIO-CASES`에서 Luna가 제출한 35개 correction target 중 34개는 유효했지만 `CT035`가 `SCENARIO_CASE_CORRECTION_UNCHANGED`로 거절됐다. runner는 성공 target을 메모리에서만 병합했기 때문에 프로세스 종료 뒤 실패 target 하나만 재시도할 수 없었다.

## Root Cause

rejected patch, initial plan, retry plan은 파일로 남았지만 이를 신뢰 경계 안에서 다시 적용하는 backend replay 계약과 bounded resume option이 없었다.

## Solution

- rejected patch를 원래 base와 initial plan에 순서대로 다시 적용한다.
- 저장된 failed target/index와 계산 결과를 대조한다.
- 각 retry plan의 새 base hash와 전체 JSON 동일성을 검증한다.
- 성공 target을 병합한 base를 복원하고 남은 target만 모델에 전달한다.
- resume 경로는 run의 직접 자식 디렉터리만 허용하고 심볼릭 링크를 거부한다.
- retry 시 남은 target의 source ref만 읽기 상태에서 제거해 실제 재조회를 강제한다.

## Regression Test

`tests/design/staged-agent-scenario-cases.test.ts`가 한 target 성공/한 target unchanged인 patch를 재생해 성공 변경은 보존되고 실패 target만 남는지 검증한다.

## Verification

- 실제 실패 artifact 재생 결과: initial target 35개, remaining target `CT035` 1개
- 최종 Luna patch: `CT035.preconditions` 한 필드만 제출
- case 8개 수와 순서 유지, 허용 밖 의미 변경 없음
- 전체 workspace/root test, typecheck, build, `git diff --check` 통과
