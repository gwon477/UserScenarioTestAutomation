---
title: "수정 revision의 상속 evidence grant를 현재 디렉터리에서만 조회함"
date: "2026-09-07"
category: "integration-issues"
module: "scenarioforge-evidence-lineage"
problem_type: "integration_issue"
component: "staged-run-evidence-verification"
severity: "high"
symptoms:
  - "AGENTIC_SOURCE_SURVEY_FAILED"
  - "상속 evidence_grant_id의 파일이 이전 revision 디렉터리에만 존재함"
root_cause: "evidence_verifier_assumed_single_revision_directory"
resolution_type: "code_fix"
related_components:
  - "evidence-grant-service"
  - "staged-user-journey-runner"
  - "staged-scenario-case-runner"
tags:
  - "AGENTIC_SOURCE_SURVEY_FAILED"
  - "evidence-grant"
  - "revision-lineage"
---

# 수정 revision의 상속 evidence grant 디렉터리 조회

## Problem

`RUN-AXSE-AGENTIC-20260904-07`, `WORK-AXSE-SCENARIO-CASES`의 05 입력 검증이 `AGENTIC_SOURCE_SURVEY_FAILED`로 종료됐다. 실제 첫 오류는 최신 04 revision이 상속한 grant 파일을 최신 revision의 `evidence-grants` 한 곳에서만 읽으려 한 파일 부재였다.

## Root Cause

artifact evidence catalog는 이전 revision의 `evidence_grant_id`를 정상적으로 보존하지만 verifier가 선택한 최신 stage 디렉터리 하나만 grant root로 사용했다. JSON lineage와 파일 저장 lineage의 범위가 달랐다.

## Solution

run의 동일 stage revision 디렉터리에서 정확한 `evidence_grant_id` 파일을 찾고, grant별 reference를 원래 디렉터리로 그룹화해 `EvidenceGrantService`로 재검증한다. 누락, 중복, 파일 심볼릭 링크, run 밖 경로는 fail-closed한다.

변경 파일:

- `scripts/staged-agent-run-support.mjs`
- `scripts/run-staged-axse-user-journeys.mjs`
- `scripts/run-staged-axse-scenario-cases.mjs`

## Regression Test

`tests/design/staged-agent-run-support.test.ts`가 여러 revision의 정상 grouping과 missing/duplicate/link 거부를 검증한다.

## Verification

- evidence lineage focused test 2개 통과
- staged design test 111개 통과
- 전체 workspace/root test, typecheck, build, `git diff --check` 통과
- 최종 05 probe에서 29개 evidence reference가 3개 revision 디렉터리의 유일한 grant 파일로 해석되고 hash 검증됨
