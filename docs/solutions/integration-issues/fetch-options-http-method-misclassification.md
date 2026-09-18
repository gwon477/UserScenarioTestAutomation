---
title: "fetch options HTTP method 누락으로 인한 FACT reviewer 거부"
date: "2026-08-27"
category: "integration-issues"
module: "scenarioforge-source-scanner"
problem_type: "integration_issue"
component: "source-scanner"
severity: "high"
symptoms:
  - "FACT reviewer가 API_METHOD_MISMATCH로 분석을 거부함"
  - "fetch(url, { method: POST }) 호출이 API-GET-* inventory로 생성됨"
root_cause: "logic_error"
resolution_type: "code_fix"
related_components:
  - "scenario-pipeline"
  - "fact-draft-compiler"
  - "stage-reviewer"
tags:
  - "source-scanner"
  - "fetch"
  - "http-method"
  - "typescript-ast"
  - "api-inventory"
---

# fetch options HTTP method 누락으로 인한 FACT reviewer 거부

## Problem

실제 분석 `RUN-a7b7e32f-2989-4494-b037-c803b86a7252`의 FACT reviewer가 다음 오류로 산출물을 거부했다.

```text
STAGE_ARTIFACT_REJECTED:API_METHOD_MISMATCH:
API-GET-api-auth-login is labeled GET, but verified login code calls
/api/auth/login with method POST
```

이 실행에서는 SRC snapshot과 FACT author 산출물이 정상 등록됐고, author/reviewer의 제출 이후 발생한 Azure 429도 등록·해시 검증된 산출물 회수 규칙으로 처리됐다. 따라서 이 오류는 기존 canonical ID drift나 provider failure-propagation 문제가 아니라 source inventory의 신규 오분류 문제다.

## Root Cause

[`source-scanner.ts`](../../../packages/scenario-pipeline/src/scanning/source-scanner.ts)의 API 정규식은 다음 두 형태를 찾았다.

- `fetch("/path")`
- `axios.post("/path")` 또는 `post("/path")`

하지만 `fetch`의 두 번째 options 인자는 읽지 않고 항상 `GET`을 기본값으로 지정했다.

```jsx
fetch("/api/auth/login", {
  method: "POST",
  body: JSON.stringify(credentials),
});
```

그 결과 scanner snapshot은 실제 POST 호출을 다음처럼 기록했다.

```json
{
  "api_id": "API-GET-api-auth-login",
  "method": "GET",
  "path": "/api/auth/login"
}
```

deterministic FACT compiler는 scanner-owned ID를 올바르게 보존했지만 입력 inventory 자체가 틀렸으므로 reviewer가 거부한 것이 맞다.

## Solution

API 호출 추출을 문자열 정규식에서 이미 생성된 TypeScript AST 순회로 변경했다.

- `fetch` 첫 번째 literal 인자를 path로 읽는다.
- 두 번째 인자가 object literal이면 `method` property의 literal 값을 읽어 대문자로 정규화한다.
- options 또는 method가 없으면 기존 동작과 같이 GET을 사용한다.
- `axios.get/post/put/patch/delete`와 기존 direct method call 지원을 유지한다.
- API ID는 검출된 method와 path에서 backend가 계속 결정한다.

## Regression Test

[`generation-core.test.ts`](../../../packages/scenario-pipeline/src/generation-core.test.ts)에 실제 실패 형태를 추가했다.

```ts
fetch("/api/auth/login", { method: "POST" })
```

수정 전에는 테스트가 `API-GET-api-auth-login`을 받아 RED로 실패했고, 수정 후 다음 inventory로 GREEN 전환됐다.

```text
API-POST-api-auth-login / POST / /api/auth/login
```

## Verification

- scenario-pipeline 집중 테스트: 9개 통과
- 전체 테스트: 77개 통과
- 전체 TypeScript 검사: 통과
- Electron production build: 통과
- 실제 SRC→FACT 이후 진행: 새 build 재실행에서 확인 예정

## Prevention

향후 `API_METHOD_MISMATCH`, `API-GET-*`, `fetch options`, `source-scanner` 오류는 먼저 이 문서를 검색한다. 다음 기준으로 구분한다.

| 관측 | 판정 |
|---|---|
| `fetch(url, { method: "POST" })`가 GET inventory로 생성 | 이 문서의 scanner method 추출 문제 |
| snapshot은 POST인데 FACT가 GET ID를 가짐 | FACT inventory/compiler 경계 문제 |
| snapshot과 FACT 모두 POST인데 reviewer만 GET이라 주장 | reviewer evidence/semantic 판정 문제 |
| tool 호출 전후 `rate_limit_tpm`으로 artifact가 없음 | provider retry 문제 |

API method 문제는 reviewer prompt를 완화해서 통과시키지 않는다. source snapshot → deterministic FACT → reviewer로 이어지는 데이터 흐름에서 최초로 값이 잘못 생성된 경계를 수정한다.

## Related

- [FACT canonical ID 및 provider failure 이력](./fact-patch-canonical-id-reference-drift.md)
- [Pi Coding Agent 하네스 설계](../../pi-coding-agent%20하네스%20설계.md)
