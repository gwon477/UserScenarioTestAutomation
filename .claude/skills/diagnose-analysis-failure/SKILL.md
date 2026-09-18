---
name: diagnose-analysis-failure
description: ScenarioForge 생성 파이프라인 실패를 진단할 때 사용한다. SRC/FACT/WIKI/SCENARIO 단계 오류, reviewer fail-closed 거부(STAGE_ARTIFACT_REJECTED 등), artifact 제출 불일치, Pi tool/revision/operationId 오류, 분석이 멈추거나 잘못된 산출물을 낼 때 트리거된다. 코드를 고치기 전에 이 절차로 원인을 확정한다.
---

# 분석 실패 진단

추측으로 수정하지 않는다. 증거 → 이력 → 경계 → 회귀 테스트 → 단일 수정 순서를 지킨다.

## 1. 증거 고정 (수정 금지)

다음을 원문 문자열로 기록한다. 하나라도 비어 있으면 다음 단계로 가지 않는다.

- stage (`SRC` / `FACT` / `WIKI` / `SCENARIO`)
- analysis run ID, work ID
- 최초 오류와 terminal 오류 (요약하지 말고 원문)
- artifact 형태: staging 경로, `contentHash`, backend 등록 여부
- provider event: retry 발생 여부, rate limit/timeout/인증 오류 여부

secret, API key, prompt 원문은 기록하지 않는다.

## 2. 이력 검색

```
rg -n "<exact error string>" docs/solutions/
rg -n "<module|component|파일명>" docs/solutions/
```

`docs/solutions/AGENTS.md`의 분류 기준으로 **같은 문제 / 새 문제**를 판정한다.

**같은 문제라면** 문서화된 회귀 테스트를 먼저 실행한다.
- 테스트가 실패하면 → 같은 문제다. 문서의 수정을 적용한다.
- 테스트가 통과하는데 실패가 남아 있으면 → **같은 문제가 아니다.** 이전 수정을 반복하지 말고 3단계로 간다.

## 3. 계약 경계 특정

실패한 검증의 소유자를 `file:line`으로 특정한다. `codegraph_context`와 `codegraph_callers`로 호출 경로를 확인한다.

| 증상 | 경계 |
| --- | --- |
| inventory/근거 누락, ID 참조 불일치, evidence slice 절단 | `packages/scenario-pipeline` (scanner, deterministic-id, evidence-grant-service) |
| reviewer 거부, stage 미완료 | `packages/scenario-pipeline` (stage-completion-gate, generation-artifact-validators) |
| revision 불일치, operationId 충돌, tool scope 오류, provider retry | `packages/pi-runtime` |
| staging과 canonical 경로 혼동, runtime 리소스 누락 | `packages/project-runtime` |
| 진행 상태/오류 표시, IPC, credential | `apps/desktop` |

판정 기준: **LLM이 무엇을 잘못했는가가 아니라, 어느 backend 검증이 그것을 막지 못했는가.**

## 4. 최소 회귀 테스트 먼저

원인을 증명하는 테스트를 해당 패키지에 추가하고 **실패하는 것을 확인한다.** 실패를 확인하지 못했으면 원인을 아직 모르는 것이다.

```
npm run test --workspace @scenarioforge/<package>
```

## 5. 단일 수정

- 원인 하나만 고친다. 눈에 보이는 다른 문제를 같은 변경에 섞지 않는다.
- fixture(`test_project_source`)나 생성된 `.scenarioforge`를 고쳐 통과시키지 않는다.
- reviewer 조건을 완화해 통과시키지 않는다. fail-closed는 의도된 동작이다.

## 6. 검증과 기록

`verify-generation-pipeline` skill로 검증한 뒤 `docs/solutions`를 갱신한다. 같은 문제면 `last_updated`를, 다른 계약 경계면 새 문서를 만든다.

## 위임

읽기 전용 조사는 `failure-investigator` 에이전트에 맡길 수 있다. 검증 실행은 `verification-runner`에 맡긴다.
