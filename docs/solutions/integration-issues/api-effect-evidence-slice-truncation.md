---
title: "API 후속 효과 직전에서 잘린 FACT evidence slice"
date: "2026-08-27"
last_updated: "2026-08-28"
category: "integration-issues"
module: "scenarioforge-fact-generation"
problem_type: "integration_issue"
component: "pi-generation-executor"
severity: "high"
symptoms:
  - "FACT reviewer가 API_WRITE_EFFECT_NOT_VERIFIED로 산출물을 거부함"
  - "API 호출은 evidence에 있지만 호출 결과를 상태에 반영하는 코드가 evidence 범위 밖에 있음"
  - "사용자 interaction은 evidence에 있지만 20행 밖의 handler 본문과 화면 조합 상태 전이가 빠져 E2E edge가 누락됨"
root_cause: "evidence_boundary_truncation"
resolution_type: "code_fix"
related_components:
  - "source-scanner"
  - "evidence-grant-service"
  - "fact-analyst"
  - "stage-reviewer"
tags:
  - "fact-review"
  - "api-effect"
  - "evidence-slice"
  - "function-boundary"
  - "fail-closed"
---

# API 후속 효과 직전에서 잘린 FACT evidence slice

## Problem

실제 분석 `RUN-e3fb8303-807f-4ce7-b6af-4a64c5c01bf2`의 FACT author는 로그인 API를 다음 의미로 보강했다.

```text
API-POST-api-auth-login
reads: user ID and password credentials
writes: authentication session with access token and refresh token
```

독립 reviewer는 다음 verdict를 제출했고 FACT stage는 fail-closed로 중단됐다.

```text
STAGE_ARTIFACT_REJECTED:
API_WRITE_EFFECT_NOT_VERIFIED:API-POST-api-auth-login
```

이 실행에서 서버 소유 operation ID, staging write, artifact 등록, scope/path/hash 검증은 모두 성공했다. 따라서 이전 `operationId` 충돌이나 artifact handoff 실패가 재발한 것은 아니다.

## Prior-history comparison

기존 [`fetch-options-http-method-misclassification.md`](./fetch-options-http-method-misclassification.md)와 먼저 비교했다.

| 경계 | 이번 실행 관측 | 판정 |
|---|---|---|
| source snapshot | `POST /api/auth/login`, `API-POST-api-auth-login` | 정상 |
| deterministic FACT | 동일 POST canonical ID | 정상 |
| author artifact | 등록·해시 검증 완료 | 정상 |
| reviewer | API write effect의 근거 부족으로 거부 | 신규 evidence 범위 문제 |

snapshot과 FACT가 모두 POST이므로 `fetch` options method 누락과는 다른 문제다. 또한 `work.begin`, `work.submitArtifacts`, `work.requestCompletion`에 서로 다른 `pi:...:<tool>:<callId>` operation ID가 적용되어 [`pi-model-operation-id-collision.md`](./pi-model-operation-id-collision.md)의 문제도 재발하지 않았다.

## Root Cause

[`pi-generation-executor.ts`](../../../apps/desktop/src/main/application/pi-generation-executor.ts)의 `sourceSlices()`는 모든 scanner anchor를 고정 `±20행`으로 잘랐다.

로그인 호출 anchor는 21행이었으므로 API가 소유한 evidence는 1–41행이었다. 실제 소스에서는 다음 흐름이 이어진다.

1. 21행: `POST /api/auth/login`
2. 30행: 응답에서 access/refresh token 추출
3. 41행: `dispatch(loginDone({` 시작
4. 42–48행: token과 refresh token을 인증 상태에 반영

즉 reviewer가 받은 evidence는 상태 변경 호출의 시작에서 끝났다. author는 응답 토큰을 근거로 인증 세션 효과를 추론했지만, reviewer는 그 효과의 실제 적용을 끝까지 확인할 수 없어 올바르게 거부했다.

고정 line radius는 단일 JSX 요소의 국소 근거에는 적합하지만, API 호출과 후속 response handling을 하나의 의미 단위로 검증하는 데는 적합하지 않았다.

## Solution

API anchor만 TypeScript AST의 가장 가까운 enclosing function 범위로 확장한다.

- `fetch`/API 호출이 중첩 handler 안에 있으면 가장 작은 함수만 선택한다.
- route와 interaction anchor는 기존 `±20행` 범위를 유지한다.
- JS/TS 계열이 아니거나 enclosing function을 찾지 못하면 기존 bounded window로 fallback한다.
- 여러 범위는 기존처럼 겹치거나 인접할 때만 병합한다.
- 전체 evidence byte budget `120,000`은 그대로 유지하며 초과 시 fail-closed한다.

이렇게 하면 API request, response parsing, success/failure handling, 상태 반영을 동일 Evidence Grant 범위에서 검증할 수 있다. 동시에 component 파일 전체나 저장소 전체를 모델에 공개하지 않는다.

## Regression Test

[`pi-generation-executor.test.ts`](../../../apps/desktop/src/main/application/pi-generation-executor.test.ts)에 API 호출과 상태 반영 사이가 20행보다 긴 handler를 추가했다.

```text
fetch('/api/auth/login', { method: 'POST' })
... 22 lines ...
dispatch(loginDone({ token: accessToken, refreshToken }))
```

수정 전에는 evidence가 `intermediate18`에서 끝나 후속 `dispatch`가 없으므로 RED로 실패했다. 수정 후에는 enclosing handler 끝까지 포함되어 GREEN으로 전환됐다. 기존 1,200행 대형 파일 테스트는 interaction evidence가 계속 bounded window인 것도 함께 보장한다.

## Verification

- desktop 집중 테스트: 9개 통과
- 전체 workspace 테스트: 105개 통과
- 전체 workspace TypeScript 검사: 통과
- Electron production build: 통과
- build output의 runtime-template asset 포함 확인
- 실제 SRC→FACT reviewer 재실행: 새 build 재시작 후 관측 예정

### 2026-08-28 후속 회귀: interaction과 화면 조합 evidence

실제 `RUN-3169353d-dc49-4904-854a-259ecd84d5a2`은 업로드 화면의 `다음 단계` interaction을 찾았지만, 파일 선택·업로드·파싱을 수행하는 handler 전체와 `App.jsx`/`store.js`의 로그인→프로젝트→MainPage 조합을 FACT evidence grant에 포함하지 않았다. 그 결과 업로드 완료를 precondition으로 처리하고 로그인부터 파싱까지의 사용자 action을 생략했다.

깨진 경계는 기존 문서와 같은 evidence planner의 의미 단위 절단이다. 고정 20행 window가 API effect뿐 아니라 interaction handler와 화면 조합 state transition도 분리했다.

수정은 다음과 같다.

- 모든 interaction anchor를 가장 가까운 enclosing function까지 확장한다.
- 둘 이상의 등록 Page를 렌더링하는 작은 JS/TS composition 파일을 evidence에 포함한다.
- composition 파일이 직접 import하는 작은 state reducer/store 의존성을 포함한다.
- 전체 source evidence byte budget 120,000은 유지하고 초과 시 fail-closed한다.

[`pi-generation-executor.test.ts`](../../../apps/desktop/src/main/application/pi-generation-executor.test.ts)에 interaction과 handler 사이가 20행보다 먼 fixture, `App.jsx`의 조건부 Page 조합, `store.js`의 reducer 전이를 추가했다. 수정 전에는 handler 끝과 조합/상태 파일이 없어 RED였고 수정 후 GREEN이다.

후속 검증은 desktop 62개, 전체 workspace 135개, TypeScript 검사, Electron production build가 모두 통과했다. 실환경 `RUN-8a04cd9a-6706-4936-8e43-8a965ebdb72f`의 최초 FACT 초안은 9개 화면과 31개 edge를 제출해 기존 6개 edge 대비 전체 여정 근거가 확장됐고, reviewer가 남은 가드/self-loop 누락 6건을 fail-closed로 거부한 뒤 1회 교정 중이다.

## Prevention

향후 `API_WRITE_EFFECT_NOT_VERIFIED`는 다음 순서로 판정한다.

1. snapshot method/path/API ID가 실제 호출과 일치하는지 확인한다.
2. compiled FACT의 API citation 범위가 request뿐 아니라 주장한 effect까지 포함하는지 확인한다.
3. effect가 citation 범위 안에 없으면 reviewer prompt를 완화하지 않고 evidence planner를 수정한다.
4. effect가 범위 안에도 없으면 author의 `api_updates.writes`가 근거 없는 의미 확장인지 확인한다.
5. staging 파일만 보지 말고 backend artifact 등록, work scope, path, content hash를 함께 검증한다.

| 관측 | 판정 |
|---|---|
| `fetch(..., {method: POST})`가 snapshot에서 GET | 기존 method 오분류 문제 |
| snapshot/FACT는 POST, citation이 effect 직전 종료 | 이 문서의 evidence slice 절단 문제 |
| citation 안에 effect가 없는데 author가 구체 write를 주장 | author semantic overreach |
| citation 안에 effect가 있는데 reviewer가 거부 | reviewer rule/prompt 또는 의미 모델 문제 |
| tool mutation들이 같은 operation ID로 충돌 | Pi model operation ID 문제 |

## Related

- [fetch options HTTP method 오분류](./fetch-options-http-method-misclassification.md)
- [Pi model operation ID 충돌](./pi-model-operation-id-collision.md)
- [FACT canonical ID 및 provider failure 이력](./fact-patch-canonical-id-reference-drift.md)
- [Pi Coding Agent 하네스 설계](../../pi-coding-agent%20하네스%20설계.md)
