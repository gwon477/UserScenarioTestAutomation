---
title: "Pi 모델 operationId 재사용으로 인한 artifact 미등록"
date: "2026-08-27"
last_updated: "2026-08-27T17:33:00+09:00"
category: "integration-issues"
module: "scenarioforge-pi-runtime"
problem_type: "integration_issue"
component: "pi-tool-adapter"
severity: "high"
symptoms:
  - "staging.writeJson은 성공했지만 MODEL_ARTIFACT_NOT_SUBMITTED로 FACT 실패"
  - "work.begin, work.submitArtifacts, work.requestCompletion이 OPERATION_ALREADY_APPLIED를 반환"
root_cause: "trust_boundary_error"
resolution_type: "code_fix"
related_components:
  - "work-state-service"
  - "runtime-state-reducer"
  - "pi-generation-executor"
tags:
  - "operation-id"
  - "idempotency"
  - "tool-call-id"
  - "artifact-handoff"
  - "pi-runtime"
---

# Pi 모델 operationId 재사용으로 인한 artifact 미등록

## Problem

실행 `RUN-569b3fb8-23bb-4bf5-bf1b-457b936abe37`에서 새 JSX AST scanner는 정상 적용됐다.

- interactions 63
- raw JSX label 0
- checkbox role 오류 0
- duplicate element ID 0

FACT author는 `staging.writeJson`으로 JSON 파일도 작성했다. 그러나 backend work state에 artifact가 등록되지 않았고 실행은 다음 오류로 종료됐다.

```text
MODEL_ARTIFACT_NOT_SUBMITTED
```

등록되지 않은 staging 파일을 신뢰하지 않은 `promptForSubmittedArtifact()` 가드레일은 정상 동작했다. 직접 원인은 그 이전 lifecycle mutation 실패였다.

## Root Cause

실패 세션의 Pi tool call arguments를 민감 정보 없이 비교한 결과, 모델이 모든 work 도구에 같은 값을 넣었다.

```text
operationId = "analysis.fact-extract"
```

다음 호출이 모두 동일 ID를 사용했다.

```text
work.begin
work.submitArtifacts
work.begin (복구 시도)
work.submitArtifacts (복구 시도)
work.requestCompletion
```

`ProjectRuntimeState.appliedOperationIds`는 프로젝트 journal 전체에서 이미 적용된 operation ID의 재사용을 거부한다. 같은 문자열은 이전 work에서 이미 사용됐으므로 첫 mutation부터 `OPERATION_ALREADY_APPLIED`가 발생했다.

이전 성공 세션은 모델이 `operationId`를 생략했고 `WorkStateTools`가 UUID를 생성했다. 실패 세션은 Pi generic tool schema에 optional `operationId`가 노출된 것을 보고 work kind를 idempotency key로 임의 선택했다. 모델에게 key 생성 권한과 호출별 고유성 책임을 함께 맡긴 것이 trust boundary 오류다.

## Solution

[`pi-tool-adapter.ts`](../../../packages/pi-runtime/src/tools/pi-tool-adapter.ts)에서 Pi mutation의 operation ID를 서버 소유로 전환했다.

1. Pi tool input schema에서 `operationId`를 제거한다.
2. `work.getContext`를 제외한 mutation 호출은 provider가 부여한 고유 `toolCallId`를 사용한다.
3. project/session/work/tool namespace와 toolCallId를 결합해 operation ID를 만든다.
4. 모델이 schema 밖의 `operationId`를 전송해도 adapter가 덮어쓴다.
5. `WorkStateService`와 reducer의 일반 API contract는 유지한다. Pi 이외의 신뢰된 호출자는 기존처럼 명시적 operation ID를 사용할 수 있다.

형태는 다음과 같다.

```text
pi:<project>:<session>:<work>:<tool-name>:<provider-tool-call-id>
```

Provider tool call ID가 같으면 같은 mutation identity가 되고, 서로 다른 tool call은 모델이 같은 문자열을 제안해도 충돌하지 않는다.

## Regression Test

[`pi-runtime.test.ts`](../../../packages/pi-runtime/src/pi-runtime.test.ts)는 동일한 모델 입력을 두 mutation 호출에 전달한다.

```text
model operationId: analysis.fact-extract
tool call IDs: call-first, call-second
```

수정 전에는 adapter가 같은 모델 operation ID를 두 번 전달해 Set size가 1이 되는 것을 확인했다. 수정 후에는 다음을 검증한다.

- Pi schema에 `operationId`가 없음
- backend로 전달된 두 operation ID가 서로 다름
- 모델이 제안한 `analysis.fact-extract`가 사용되지 않음
- 각각의 provider tool call ID가 server-owned ID에 포함됨

## Verification

- focused Pi runtime tests: 12개 통과
- 전체 테스트: 104개 통과
- 전체 workspace TypeScript 검사 통과
- Electron production build 통과

새 build에서 begin → submit → completion이 실제 backend revision을 증가시키는지는 다음 분석 실행에서 확인한다.

## Prevention

1. idempotency key, canonical ID, revision 같은 mutation control 값은 모델이 생성하지 않는다.
2. 모델 tool schema에는 모델이 결정할 수 있는 업무 입력만 노출한다.
3. provider tool call ID를 agent 호출의 안정적인 identity boundary로 사용한다.
4. staging 파일 존재와 backend artifact 등록을 계속 분리하고, 미등록 파일은 신뢰하지 않는다.
5. `MODEL_ARTIFACT_NOT_SUBMITTED`가 발생하면 staging write 성공 여부뿐 아니라 begin/submit의 structured tool error를 먼저 확인한다.

## Related Issues

- [JSX interaction 의미·라벨 손상](./jsx-regex-interaction-semantic-corruption.md)
- [FACT patch canonical ID 및 provider 실패 이력](./fact-patch-canonical-id-reference-drift.md)
- [Agent 상세 설계](../../architecture/01-agent-detailed-design.md)
