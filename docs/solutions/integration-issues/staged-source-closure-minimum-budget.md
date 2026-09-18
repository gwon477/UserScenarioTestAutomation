---
title: "Staged source closure의 작은 요청 budget이 범위 침범으로 오분류됨"
date: "2026-09-04"
category: "integration-issues"
module: "scenarioforge-agentic-analysis"
problem_type: "integration_issue"
component: "staged-source-closure"
severity: "high"
symptoms:
  - "RUN-AXSE-AGENTIC-20260903-05가 pi-source-survey에서 AGENTIC_SOURCE_SCOPE_VIOLATION으로 종료됨"
root_cause: "undersized_closure_budget_misclassified_as_source_scope_escape"
resolution_type: "code_fix"
related_components:
  - "scenarioforge-scenario-pipeline"
  - "scenarioforge-pi-runtime"
tags:
  - "AGENTIC_SOURCE_SCOPE_VIOLATION"
  - "artifact.closure"
  - "source-survey"
  - "byte-budget"
---

# Problem

`RUN-AXSE-AGENTIC-20260903-05`, work `WORK-AXSE-SOURCE-SURVEY`는 실제 Pi/Azure `gpt-5.6-luna` 실행 중 stage `pi-source-survey`에서 최초·terminal 오류 `AGENTIC_SOURCE_SCOPE_VIOLATION`으로 종료했다. 그 전에 네 개의 evidence grant는 정상 생성됐다.

당시 실행기는 raw transcript를 남기지 않았고 sanitized tool audit도 아직 없었으므로 실패 호출의 원문 인자는 복구하지 않았다. 대신 같은 AXSE snapshot으로 허용된 `frontend/src/features/main/pages/main.page.jsx`를 작은 budget으로 요청하는 경로를 결정적으로 재현했다.

# Root Cause

`ClosureService`는 요청 budget보다 큰 파일을 선택하지 않고 빈 closure를 반환한다. 기존 stage guard는 빈 closure를 허용 목록 밖 source 요청과 같은 `AGENTIC_SOURCE_SCOPE_VIOLATION`으로 처리했다.

MainPage는 약 70 KB이지만 모델은 RUN-06과 RUN-07에서도 18 KB 또는 30 KB를 요청했다. 이 요청은 허용된 source를 가리키므로 source-scope 위반이 아니라 caller budget이 파일보다 작은 정상적인 bounded-read 조정 조건이다.

# Solution

- 모델이 요청한 source ref가 허용 목록에 있는지 closure 계산 전에 검사한다.
- 허용된 각 entry file이 한 번은 포함되도록 effective budget을 요청 파일 중 가장 큰 파일 크기까지 올리되, 서버 최대 120,000 bytes를 넘기지 않는다.
- closure는 허용된 source만 포함한 snapshot에서 계산해 `mock-data.js` 같은 제외 dependency를 transitive import로 다시 포함하지 않는다.
- raw source나 prompt 없이 tool, count, requested/effective budget, result code만 기록하는 `tool-audit.json`을 추가했다.

변경 파일:

- `scripts/staged-agent-analysis-contract.mjs`
- `scripts/run-staged-axse-source-survey.mjs`
- `tests/design/staged-agent-source-survey.test.ts`

# Regression Test

`tests/design/staged-agent-source-survey.test.ts`의 AXSE MainPage closure 테스트는 1,000 byte 요청을 MainPage 실제 크기로 보정하고, MainPage는 포함하면서 제외된 `mock-data.js`는 포함하지 않는지 확인한다.

```sh
/opt/homebrew/bin/node ./node_modules/vitest/vitest.mjs run tests/design/staged-agent-source-survey.test.ts
```

# Verification

- focused design test: 23/23 통과
- scenario-pipeline evidence security test: 13/13 통과
- pi-runtime test: 24/24 통과
- scenario-pipeline typecheck: 통과
- pi-runtime typecheck: 통과
- live `RUN-AXSE-AGENTIC-20260904-07`: locally validated
- RUN-07 tool audit: inventory 1회 → closure 10회 → artifact write 1회
- RUN-07에서 18,000/30,000 byte MainPage 요청은 70,328 bytes로 보정됐고 source-scope 오류 없이 완료됐다.
