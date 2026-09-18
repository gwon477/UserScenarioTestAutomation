---
title: "FACT 검토 이력 버전 혼합과 비동기 사용자 trigger 분할"
date: "2026-08-28"
last_updated: "2026-08-28"
category: "integration-issues"
module: "scenarioforge-generation-harness"
problem_type: "reliability_issue"
component: "fact-semantic-review"
severity: "high"
symptoms:
  - "수정된 FACT의 edge ID를 이전 버전 검토 이력과 비교해 허위 REVIEW_DECISION_CONFLICT가 발생함"
  - "한 번의 비동기 버튼 실행이 요청 시작과 시스템 완료를 나타내는 두 개의 일반 사용자 edge로 생성됨"
  - "deterministic validator가 FACT_ASYNC_TRIGGER_SPLIT을 찾았지만 초기에는 repair loop로 전달하지 못함"
root_cause: "unversioned_reviewer_history_and_async_trigger_modeling_drift"
resolution_type: "content_hash_scoped_history_and_repairable_validation"
related_components:
  - "pi-generation-executor"
  - "scenario-generation-harness"
  - "generation-artifact-validators"
  - "runtime-template"
tags:
  - "fact"
  - "review-history"
  - "async"
  - "repair-loop"
  - "runtime-template"
---

# FACT 검토 이력 버전 혼합과 비동기 trigger 분할

## 실패 이력

### `RUN-38481291-cb10-43b4-8af6-bc484241f6ce`

FACT는 43개 edge와 9개 exception까지 교정됐으나 `FACT_REPAIR_ISSUE_BUDGET_EXCEEDED`로 실패했다. 마지막 reviewer verdict의 21개 code 가운데 20개는 실제 이슈였고, `REVIEW_DECISION_CONFLICT`는 잘못된 충돌이었다.

원인은 repair 전후 FACT를 같은 검토 대상으로 취급한 것이다. FACT를 다시 compile하면 `E-####`가 재부여되므로 서로 다른 artifact 버전의 edge ID를 비교하면 이전 결정과 현재 결정을 안전하게 연결할 수 없다.

### `RUN-928619b5-78ec-4f67-b749-b512a82eed71`

초기 FACT가 `FACT_PATCH_SCHEMA_INVALID`로 실패했다. 실제 malformed effect는 다음과 같았다.

```json
{
  "all": [
    { "predicate_key": "upload_phase", "value": "reupload" },
    { "value": "reupload" }
  ]
}
```

두 번째 clause에 `predicate_key`가 없었다. 의미 repair와 별개인 제한된 출력 계약 오탈자이므로, 최초 patch 또는 semantic replacement에 대해 `FACT_PATCH_SCHEMA_INVALID`나 predicate key/value 등록 오류만 정확히 한 번 교정할 수 있게 했다. identity, ownership, evidence, element/API reference 오류는 여전히 terminal이다.

### `RUN-a21b9c0c-5231-4105-b48c-78b05342d602`

reviewer가 같은 비동기 버튼을 요청 시작과 완료에 각각 한 번씩 누르는 두 edge로 강제하는 것을 관측해 실행을 수동 중단했다. 사용자 한 번의 action 뒤에 일어나는 loading, 요청, polling, cleanup은 시스템 내부 상태이며 별도의 사용자 edge가 아니다.

이 실행을 관측하는 동안 활성 프로젝트의 `.scenarioforge/runtime`을 수정해 프로세스 종료 시 `RESOURCE_HASH_MISMATCH`도 확인됐다. 활성 host가 선언한 runtime hash와 디스크 내용이 달라진 정상적인 guard 반응이다. 실행 중에는 runtime 파일을 변경하지 말고, 앱을 먼저 종료한 뒤 canonical template과 필요한 mirror를 수정하고 재시작해야 한다.

### `RUN-82a7ca6d-ac12-4b2f-95be-e92107193474`

deterministic validator가 동일 async trigger의 복수 normal edge를 `STAGE_ARTIFACT_REJECTED:FACT_ASYNC_TRIGGER_SPLIT`으로 정확히 거부했다. 하지만 당시 harness의 repairable validation code 목록에 이 code가 없어 semantic repair를 시도하지 않고 FACT 단계가 terminal failure로 끝났다. 이번에 기록하는 마지막 확인된 실패다.

### 이후 중단 실행

- `RUN-2bad237a-f02a-4579-93e0-02dd7394ec17`: 입력 전 검증 실패와 요청 후 실패가 같은 guard 계약을 사용해 모순이 생기는 것을 확인해 수동 중단했다. 입력 누락·형식 오류는 invalid-input guard, HTTP/network/FAILED/partial은 normal edge와 동일한 유효 입력 guard를 사용하도록 계약을 분리했다.
- `RUN-8b891ecb-3a79-41a8-a7c6-e16a6ca83a1b`: 위 수정 후 FACT를 재생성하던 실행이다. `/new` 전환을 위해 25% FACT 단계에서 프로세스를 의도적으로 종료했다. 실패로 분류하지 않으며 state는 `recoverable: true`다.

## 적용한 수정

1. FACT artifact의 SHA-256 fingerprint를 reviewer decision에 저장한다.
2. reviewer에게는 `current_artifact_hash`와 byte-identical artifact의 이력만 제공한다.
3. 이력은 verdict당 최대 20개 issue code, 최근 최대 6개 decision, 직렬화 합계 16KB로 제한한다.
4. 동일 hash의 실제 결정 반전만 `REVIEW_DECISION_CONFLICT`로 인정한다.
5. 비동기 action은 loading/requesting/polling/cleanup을 접고 안정된 성공 outcome으로 가는 하나의 normal 사용자 edge로 표현한다.
6. 동일 async-like trigger의 normal edge가 여러 개인 경우 `FACT_ASYNC_TRIGGER_SPLIT`을 발생시킨다. reversible toggle의 select/deselect 분기는 예외다.
7. `FACT_ASYNC_TRIGGER_SPLIT`을 기존 최대 6회의 backend-owned semantic repair loop로 전달한다.
8. exception guard는 pre-request input rejection과 post-request failure를 구분한다.

## 검증 상태

- `pi-generation-executor.test.ts`: 26개 통과
- `generation-core.test.ts`: 30개 통과
- `scenario-generation-harness.test.ts`: 9개 통과
- workspace typecheck 통과

전체 `npm test`는 harness routing 수정 전 RED 상태에서 실행되어 root E2E 한 건이 실패했으며, 수정 후 해당 E2E 9개는 별도로 통과했다. 최신 변경 전체에 대한 `npm test`, `npm run typecheck`, `npm run build`, `git diff --check`는 실제 Azure 성공 run 뒤 다시 수행해야 한다.

## 새로 발견한 미해결 위험

`project-state.json`은 최신 실행 `RUN-8b891ecb-3a79-41a8-a7c6-e16a6ca83a1b`과 FACT work `16cbd23b-da1d-41e6-ac10-bcf4bfcc73cf`를 가리킨다. 그러나 `WORK_STATE.md`의 Current Assignment는 과거에 `running`으로 남은 첫 work `3c571bfd-c7a7-4e36-a4e7-aef3965d9c3f`를 표시한다.

`renderWorkStateMarkdown()`이 `Object.values(state.works).find(work.status === "running")`을 사용하기 때문이다. 과거 중단 work가 상태에 남으면 현재 `analysisRunId`와 관계없는 assignment가 선택된다. 이것이 최근 LLM 실패의 직접 원인인지는 아직 입증되지 않았지만 잘못된 agent context를 만들 수 있으므로 다음 실제 재실행 전에 우선 진단하고 회귀 테스트로 고정해야 한다.

## 예방 규칙

1. reviewer 이력의 식별 기준으로 재컴파일될 수 있는 edge ID만 사용하지 않는다.
2. 사용자 trigger와 그 뒤의 시스템 내부 lifecycle을 별도 사용자 action으로 만들지 않는다.
3. deterministic 의미 validation도 고칠 수 있는 범위라면 동일한 bounded repair 정책을 거친다.
4. 활성 run 중 `.scenarioforge/runtime`을 수정하지 않는다.
5. 실패 시 새 prompt를 바로 추가하기 전에 기존 `docs/solutions/integration-issues`에서 동일 증상을 찾고, run ID·정확한 error code·artifact를 먼저 기록한다.
6. `WORK_STATE.md`의 현재 work 선택은 현재 run/session과 일치해야 하며, 단순히 첫 `running` work를 선택해서는 안 된다.

## 관련 문서

- [FACT semantic reviewer 기반 bounded repair loop](./fact-semantic-review-bounded-repair-loop.md)
- [단계 격리 생성 orchestration 계획](../../plans/2026-09-02-001-refactor-stage-isolated-generation-orchestration-plan.md)
- [Pi Coding Agent 하네스 설계](../../pi-coding-agent%20하네스%20설계.md)
