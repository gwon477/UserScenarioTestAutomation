---
title: "FACT edge 전수가 WIKI와 SCENARIO 완료 조건에 포함되지 않음"
date: "2026-08-28"
category: "integration-issues"
module: "scenarioforge-generation-pipeline"
problem_type: "integration_issue"
component: "generation-artifact-validators"
severity: "high"
symptoms:
  - "RUN-3169353d-dc49-4904-854a-259ecd84d5a2가 FACT edge 6건 중 3건, coverage 50%인 scenario를 완료 산출물로 생성함"
  - "WIKI workflow가 일부 edge만 cite해도 validation을 통과함"
  - "walkWorkflow가 workflow cites 밖의 FACT edge까지 경로에 포함할 수 있음"
root_cause: "deterministic_edge_coverage_not_enforced"
resolution_type: "code_fix"
related_components:
  - "graph-tools"
  - "scenario-generation-harness"
  - "wiki-writer"
  - "scenario-compiler"
tags:
  - "WIKI_EDGE_COVERAGE_INCOMPLETE"
  - "SCENARIO_EDGE_COVERAGE_INCOMPLETE"
  - "all-transitions"
  - "workflow-cites"
  - "coverage-gate"
---

# FACT edge 전수가 WIKI와 SCENARIO 완료 조건에 포함되지 않음

## Problem

실제 `RUN-3169353d-dc49-4904-854a-259ecd84d5a2`은 FACT screen 9개와 edge 6개를 생성했지만 WIKI workflow는 1개, scenario는 1개뿐이었다. 최종 path는 `E-0006 → E-0004 → E-0001`이고 `E-0002`, `E-0003`, `E-0005`가 누락돼 coverage가 50%였다.

더 중요한 문제는 이 결과가 실패하지 않았다는 점이다. 대상 소스와 직접 대조하면 로그인, 프로젝트 선택, 작업 생성/선택, 파일 선택, 업로드·파싱, 생성 완료 대기, CSV/Excel 다운로드도 FACT 앞 단계에서 누락됐지만, pipeline에는 이미 존재하는 FACT edge 전수조차 downstream 산출물에 포함시키는 completion gate가 없었다.

## Prior-history comparison

[`wiki-terminal-fact-grounding-gap.md`](./wiki-terminal-fact-grounding-gap.md)는 terminal이 FACT에서 도달 가능해야 한다는 invariant를 보호했지만, 문서의 Follow-up Boundary에서 FACT auto-link/edge coverage 부족을 별도 후속 문제로 명시했다.

이번 실패는 terminal 도달성 테스트가 통과한 상태에서 일부 verified edge가 WIKI와 scenario에서 사라진 것이다. 기존 terminal 문제의 재발이 아니라 예고된 **edge 전수 coverage completion contract**의 부재다.

## Root Cause

`validateWikiBundle()`은 cite ID가 FACT에 존재하는지만 검사하고 모든 FACT edge가 하나 이상의 reachable cited path에 속하는지는 검사하지 않았다. `validateScenarioSet()`도 path reference 정합성만 검사하고 미커버 FACT edge가 남아 있어도 허용했다.

동시에 `walkWorkflow()`는 전체 FACT adjacency를 순회해, workflow가 cite하지 않은 edge까지 path에 섞을 수 있었다. 따라서 WIKI scope와 coverage 계산이 같은 경계로 잠기지 않았고 50% 결과가 terminal success로 commit됐다.

## Solution

- `walkWorkflow()`는 해당 workflow의 `cites`에 포함된 `E-*`만 adjacency에 넣는다.
- `uncoveredWorkflowEdgeIds()`는 모든 workflow의 실제 reachable cited path를 합쳐 미커버 FACT edge를 계산한다.
- WIKI validator는 하나라도 남으면 `WIKI_EDGE_COVERAGE_INCOMPLETE`로 거부한다.
- scenario validator는 하나라도 남으면 `SCENARIO_EDGE_COVERAGE_INCOMPLETE`로 거부한다.
- WIKI가 coverage issue만 가졌거나 semantic reviewer가 교정 가능한 issue를 반환하면 동일 work/scope에서 정확히 한 번 replacement를 작성하고 다시 schema·reference·coverage·review를 수행한다.
- 두 번째 거부는 terminal failure로 처리한다. reviewer 또는 author에게 canonical completion 권한을 주지 않는다.

## Regression Test

[`generation-core.test.ts`](../../../packages/scenario-pipeline/src/generation-core.test.ts)에 다음 RED fixture를 추가했다.

- workflow가 cite하지 않은 edge가 walk path에 섞이지 않아야 한다.
- FACT edge 두 개 중 하나만 WIKI가 cover하면 `WIKI_EDGE_COVERAGE_INCOMPLETE`여야 한다.
- scenario가 FACT edge 일부만 path에 넣으면 `SCENARIO_EDGE_COVERAGE_INCOMPLETE`여야 한다.

[`scenario-generation-harness.test.ts`](../../../tests/e2e/scenario-generation-harness.test.ts)에는 최초 WIKI가 두 번째 edge를 누락하고 1회 repair가 이를 포함하는 end-to-end fixture를 추가했다. 수정 전에는 incomplete WIKI가 그대로 진행되거나 repair hook이 없어 RED였고 수정 후 GREEN이다.

## Verification

- scenario-pipeline 테스트: 36개 통과
- root E2E 테스트: 7개 통과
- 전체 workspace 테스트: 135개 통과
- 전체 workspace TypeScript 검사: 통과
- Electron production build와 runtime-template asset 생성: 통과
- live rerun: `RUN-8a04cd9a-6706-4936-8e43-8a965ebdb72f` 진행 중. 최초 FACT 31개 edge에 대한 reviewer 교정과 WIKI/SCENARIO 100% gate 결과를 종료 후 확정한다.

## Prevention

시나리오 수가 존재한다는 사실을 E2E 완결로 해석하지 않는다.

1. FACT edge 수와 WIKI reachable cited edge 수를 비교한다.
2. WIKI path에 cite 밖 edge가 섞이지 않았는지 확인한다.
3. scenario `coverage.json`에서 `uncovered_edge_ids=[]`, `coverage_percent=100`을 확인한다.
4. source에서 빠진 journey action은 downstream 100%로 발견할 수 없으므로 별도 source-to-FACT 대조도 수행한다.
5. coverage 부족을 reviewer prompt 완화나 assumed edge 창작으로 통과시키지 않는다.

## Related

- [WIKI terminal의 FACT 도달성 검증 누락](./wiki-terminal-fact-grounding-gap.md)
- [상태 기반 Page screen inventory](./state-driven-page-components-collapsed-into-source-screen.md)
- [workflow precondition 결정성](./scenario-preconditions-dropped-from-workflow-variation.md)
- [단계 격리 생성 orchestration 계획](../../plans/2026-09-02-001-refactor-stage-isolated-generation-orchestration-plan.md)
