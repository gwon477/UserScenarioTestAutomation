---
title: "WIKI terminal의 FACT 도달성 검증 누락"
date: "2026-08-27"
category: "integration-issues"
module: "scenarioforge-wiki-compose"
problem_type: "integration_issue"
component: "wiki-validator"
severity: "high"
symptoms:
  - "WIKI schema 검증은 통과하지만 semantic reviewer가 unsupported terminal로 거부함"
  - "entry screen과 동일한 screen을 성공 terminal로 사용해 workflow 완료를 주장함"
root_cause: "logic_error"
resolution_type: "code_fix"
related_components:
  - "pi-generation-executor"
  - "project-runtime"
  - "scenario-pipeline"
tags:
  - "wiki"
  - "fact-grounding"
  - "terminal-reachability"
  - "semantic-review"
  - "workflow"
---

# WIKI terminal의 FACT 도달성 검증 누락

## Problem

실제 실행 `RUN-1eeab4ea-eafc-43d6-b14a-6650686efbe7`은 SRC와 FACT를 처음으로 완료했지만 WIKI reviewer에서 중단됐다.

```text
STAGE_ARTIFACT_REJECTED:
WF-project-selection-success-terminal-unsupported-by-supplied-evidence,
WF-project-selection-transition-to-main-unsupported-by-supplied-evidence,
WF-scenario-review-export-success-terminal-does-not-represent-review-or-export-completion,
WF-scenario-review-export-missing-export-or-generation-outcome-variation
```

WIKI author는 `WF-project-selection`의 성공 조건을 `at(SCR-...main-page)`로 작성했지만 FACT에는 해당 화면으로 가는 edge가 없었다. `WF-scenario-review-export`는 entry와 success terminal을 같은 main screen으로 지정해 workflow 시작 상태를 완료 상태처럼 사용했다.

## History Classification

- `fetch options HTTP method` 문제와 다르다. live SRC에서 `/api/auth/login`이 POST로 교정됐고 FACT reviewer도 통과했다.
- `rate_limit_tpm` 문제와 다르다. WIKI author/reviewer 산출물은 429 전에 제출됐고 등록·hash 검증 후 정상 회수됐다.
- canonical ID drift와 다르다. 모든 cite ID는 현재 FACT inventory에 존재했다.
- 깨진 경계는 WIKI schema validator와 author contract 사이의 **FACT-grounded terminal 규칙**이다.

## Root Cause

기존 `validateWikiBundle()`은 `success_terminal`이 비어 있지 않은지만 확인했다. `at(SCR-*)`가 다음 조건을 충족하는지는 검사하지 않았다.

1. terminal screen이 FACT에 존재하는가.
2. 하나 이상의 entry screen에서 FACT edge를 한 번 이상 따라 도달할 수 있는가.

WIKI skill도 등록 predicate와 cite를 사용하라고만 했고, 완료 조건이 FACT에 없을 때 workflow를 생략하라는 규칙이 없었다. 그 결과 schema gate는 통과하고 의미 reviewer에서만 실패했다.

## Solution

### Backend validator

[`generation-artifact-validators.ts`](../../../packages/scenario-pipeline/src/validators/generation-artifact-validators.ts)에 FACT edge adjacency를 만들고 entry screen에서 terminal screen까지 BFS 도달성을 검사하도록 추가했다.

화면 terminal은 0-step 도달을 허용하지 않는다. entry와 terminal이 같더라도 실제 self-loop edge가 없다면 workflow 완료 조건이 아니므로 다음 code로 거부한다.

```text
WORKFLOW_TERMINAL_UNREACHABLE
```

### Author payload와 runtime resource

[`pi-generation-executor.ts`](../../../apps/desktop/src/main/application/pi-generation-executor.ts)의 WIKI payload와 다음 runtime 원본을 같은 계약으로 변경했다.

- [`wiki-compose/SKILL.md`](../../../packages/project-runtime/runtime-template/skills/generation/wiki-compose/SKILL.md)
- [`wiki-writer.md`](../../../packages/project-runtime/runtime-template/agents/generation/wiki-writer.md)

규칙은 다음과 같다.

- screen terminal은 entry에서 reachable FACT edge path가 있어야 한다.
- predicate terminal과 variation default는 등록된 ID/value를 정확히 사용한다.
- FACT에 완료 또는 outcome이 표현되지 않은 workflow는 생성하지 않는다.
- `status: unresolved`는 근거 없는 terminal을 허용하는 우회 수단이 아니다.

## Regression Evidence

- FACT edge를 제거한 fixture에서 기존 validator가 terminal을 통과시키는 RED 확인
- 수정 후 `WORKFLOW_TERMINAL_UNREACHABLE` 확인
- WIKI payload contract 집중 테스트 통과
- runtime skill/agent 동기화 테스트 RED→GREEN 확인

## Follow-up Boundary

이 실행의 FACT에는 predicate는 4개지만 edge가 0개였다. WIKI가 unsupported workflow를 생략하면 WIKI 자체는 정직해지지만 deterministic scenario walk는 경로를 만들 수 없다. 이는 이 문서의 terminal 검증 문제와 별개인 **FACT auto-link/edge coverage 구현 부족**이다.

다음 실행에서 WIKI가 통과한 뒤 scenario가 비거나 edge coverage 오류가 발생하면 이 문서를 재수정하지 않고 FACT auto-link 문제로 별도 기록한다. 설계 문서는 `FACT: stack별 추출 → auto link → ambiguous link 판정 → reviewer` 순서를 요구하지만 현재 구현은 별도 backend auto-link를 실행하지 않는다.

## Search Terms

```text
WORKFLOW_TERMINAL_UNREACHABLE
unsupported-by-supplied-evidence
success-terminal-does-not-represent
wiki terminal
FACT edge path
```

## Related

- [fetch HTTP method 오분류 이력](./fetch-options-http-method-misclassification.md)
- [FACT canonical ID 및 provider failure 이력](./fact-patch-canonical-id-reference-drift.md)
- [Pi Coding Agent 하네스 설계](../../pi-coding-agent%20하네스%20설계.md)
