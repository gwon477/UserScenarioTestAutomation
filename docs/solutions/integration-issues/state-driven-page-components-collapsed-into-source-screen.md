---
title: "상태 기반 Page 컴포넌트가 단일 source screen으로 합쳐져 WIKI가 비어 있음"
date: "2026-08-27"
last_updated: "2026-08-28"
category: "integration-issues"
module: "scenarioforge-source-scanner"
problem_type: "integration_issue"
component: "source-scanner"
severity: "high"
symptoms:
  - "FACT reviewer는 통과하지만 FACT edge가 0건임"
  - "WIKI author가 workflow를 0개 제출함"
  - "WIKI reviewer가 WIKI_WORKFLOWS_EMPTY_DESPITE_VERIFIED_SCREEN_AND_API_RECORDS로 거부함"
  - "Page 바깥 Shell helper의 작업 생성·로그아웃 interaction이 source fallback screen에 고립됨"
root_cause: "screen_inventory_collapse"
resolution_type: "code_fix"
related_components:
  - "fact-draft-compiler"
  - "wiki-writer"
  - "stage-reviewer"
tags:
  - "state-navigation"
  - "page-component"
  - "virtual-screen"
  - "fact-edge"
  - "wiki-workflow"
---

# 상태 기반 Page 컴포넌트가 단일 source screen으로 합쳐져 WIKI가 비어 있음

## Problem

실제 분석 `RUN-94faabc8-29f8-4172-bebd-38b5b6a87a83`은 FACT reviewer를 최초로 통과했다. 그러나 FACT graph의 edge는 0건이었고 WIKI author는 다음 계약에 따라 workflow를 생략했다.

```text
Omit workflows whose completion or outcome is not represented in FACT.
```

독립 reviewer는 다음 issue code로 빈 WIKI를 거부했다.

```text
WIKI_WORKFLOWS_EMPTY_DESPITE_VERIFIED_SCREEN_AND_API_RECORDS
```

두 agent의 판단은 각자 입력 계약 안에서는 일관됐다. 모순의 원인은 WIKI가 아니라 상위 FACT screen inventory였다.

## Prior-history comparison

- FACT canonical ID, operation ID, artifact handoff: 모두 정상
- API effect evidence: reviewer에서 재발 없음
- semantic label/locator: FACT verdict `pass:true`, 재발 없음
- provider rate limit: WIKI 첫 요청 1회 발생했지만 executor 60초 단일 재시도 후 author/reviewer 모두 정상 제출

따라서 기존 문제의 재발이 아니라 URL route 중심 source scanner가 상태 기반 UI를 표현하지 못한 신규 구조 문제다.

## Root Cause

scanner는 `<Route path="...">` 또는 `path: "/..."`만 screen inventory로 만들었다. 실제 대상 프로젝트는 React Router가 아니라 다음 상태 전환 방식을 사용한다.

```jsx
setPage("db")
setPage("business")
setPage("scenario")

page === "upload" ? <UploadPage /> : null
page === "db" ? <ParsedDbPage /> : null
```

또한 `main.page.jsx` 한 파일 안에 `BusinessPage`, `ScenarioPage`, `MainPage`가 함께 정의되어 있다. 기존 fallback은 source file당 screen 하나였으므로 서로 다른 사용자 화면의 interaction이 같은 screen으로 합쳐졌다.

FACT author에게는 화면별 opaque ref가 없었기 때문에 `setPage("scenario")`의 목적지를 참조할 수 없었다. edge proposal을 생략한 것은 모델 실패가 아니라 입력 graph의 표현력 부족이다.

## Solution

명시적 URL route가 없는 JS/TS source에서는 React 컴포넌트 명명 규약에 따라 **대문자로 시작하고** 이름이 `Page`로 끝나는 가장 가까운 함수 컴포넌트를 backend-owned virtual screen으로 등록한다.

```text
UploadPage   → SCR-component-uploadpage   / component:UploadPage
BusinessPage → SCR-component-businesspage / component:BusinessPage
ScenarioPage → SCR-component-scenariopage / component:ScenarioPage
```

- 각 JSX interaction은 가장 가까운 `*Page` 컴포넌트 screen에 귀속된다.
- 각 API call에도 optional `screen_id`를 부여해 같은 컴포넌트 screen에 귀속한다.
- 명시적 URL route가 있는 파일은 기존 route ownership을 우선한다.
- `setPage`, `handlePage`, `loadMatrixPage`처럼 소문자로 시작하는 helper는 virtual screen에서 제외한다.
- 한 source에 virtual screen이 여러 개인데 Page scope 밖인 record는 첫 screen에 임의 귀속하지 않고 source fallback screen으로 분리한다.
- FACT draft view는 virtual route와 분리된 screen ref를 author에게 제공하므로 기존 fact analyst가 literal `setPage` evidence로 first-class edge를 제안할 수 있다.

이 변경은 WIKI reviewer를 완화하지 않는다. WIKI는 계속 verified FACT edge reachability를 요구한다.

## Regression Test

[`generation-core.test.ts`](../../../packages/scenario-pipeline/src/generation-core.test.ts)에 한 파일 안의 두 state-driven Page 컴포넌트를 추가했다.

```jsx
function UploadPage() { fetch("/api/upload"); return <button>다음</button>; }
function DbPage() { fetch("/api/db"); return <button>이전</button>; }
```

수정 전에는 `routes=[]`, interaction/API의 `screen_id`가 모두 없어서 RED로 실패했다. 수정 후에는 두 virtual screen이 생기고 interaction/API가 각각의 Page screen에 귀속되어 GREEN으로 전환됐다.

후속 live snapshot에서 `setPage`, `handlePage`, `loadMatrixPage`, `normalizeScenarioMatrixPage`, `resetToFirstPage`가 과탐되는 것을 발견했다. 같은 테스트 fixture에 소문자 helper를 추가해 수정 전 route 4건으로 RED를 확인했고, 대문자 `UploadPage`, `DbPage` 2건만 남도록 경계를 강화했다.

## Verification

- scenario-pipeline 집중 테스트: 24개 통과
- 전체 workspace 테스트: 후속 desktop 복원 회귀 테스트를 포함해 113개 통과
- 전체 workspace TypeScript 검사: 통과
- Electron production build: 통과
- 실제 FACT edge/WIKI 재실행: 새 build 재시작 후 관측 예정

### 2026-08-28 후속 회귀: Page 바깥 helper ownership

virtual Page screen 자체는 분리됐지만 `Shell`처럼 `MainPage`가 렌더링하는 helper 컴포넌트의 `새로 생성`, 작업 선택, 로그아웃 interaction은 Page scope 바깥이라는 이유로 source fallback screen에 남았다. 사용자 여정의 시작과 종료 edge가 MainPage graph에 연결되지 않는 동일한 screen ownership 문제다.

scanner는 JSX component 사용 관계를 먼저 수집한다. helper가 정확히 하나의 `*Page`에서만 사용되면 helper 내부 interaction/API를 그 Page screen에 귀속하고, 둘 이상의 Page가 공유하면 임의의 screen을 선택하지 않고 unassigned 상태를 유지한다.

[`generation-core.test.ts`](../../../packages/scenario-pipeline/src/generation-core.test.ts)에 단일 Page 소유 helper와 다중 Page 공유 helper를 각각 추가했다. 수정 전에는 단일 소유 helper가 Page에 연결되지 않아 RED였고, 수정 후에는 단일 소유만 GREEN이며 공유 helper는 계속 미귀속이다.

후속 검증은 scenario-pipeline 36개, 전체 workspace 135개, TypeScript 검사, Electron production build가 모두 통과했다. 실환경 `RUN-8a04cd9a-6706-4936-8e43-8a965ebdb72f` source snapshot에서 `새로 생성`과 MainPage 로그아웃 interaction이 `SCR-component-mainpage`에 귀속된 것을 확인했다.

## Prevention

`WIKI_WORKFLOWS_EMPTY`는 WIKI prompt를 먼저 고치지 않는다.

1. FACT screen 수와 edge 수를 확인한다.
2. source가 URL router인지 state-driven navigation인지 확인한다.
3. 서로 다른 Page 컴포넌트의 interaction이 같은 screen ID에 합쳐졌는지 확인한다.
4. FACT author의 deterministic draft에 목적지 screen ref가 실제 존재하는지 확인한다.
5. 입력 graph에 screen/edge 근거가 없으면 reviewer를 완화하거나 workflow를 창작하지 않는다.

## Related

- [semantic label과 실행 locator ownership 혼합](./semantic-label-locator-ownership-drift.md)
- [API effect evidence slice 절단](./api-effect-evidence-slice-truncation.md)
- [FACT canonical ID 및 provider failure 이력](./fact-patch-canonical-id-reference-drift.md)
- [Pi Coding Agent 하네스 설계](../../pi-coding-agent%20하네스%20설계.md)
