---
title: "FACT 패치 canonical ID 변형으로 인한 분석 파이프라인 실패"
date: "2026-08-27"
last_updated: "2026-08-27T16:48:00+09:00"
category: "integration-issues"
module: "scenarioforge-fact-generation"
problem_type: "integration_issue"
component: "assistant"
severity: "high"
symptoms:
  - "FACT 생성 단계에서 FACT_SCHEMA_INVALID 또는 FACT_PATCH_REFERENCE_INVALID로 분석이 중단됨"
  - "LLM이 scanner-owned ID와 Evidence Grant 좌표를 축약하거나 변형함"
  - "필수 FACT 배열 누락 뒤 flatMap 예외가 함께 노출되어 최초 원인을 가림"
  - "동일 실행에서 Azure 429 TPM 오류가 섞여 contract 오류와 provider 오류의 구분이 어려웠음"
root_cause: "logic_error"
resolution_type: "code_fix"
related_components:
  - "pi-runtime"
  - "project-runtime"
  - "scenario-generation-harness"
tags:
  - "fact-extraction"
  - "canonical-id"
  - "opaque-reference"
  - "evidence-provenance"
  - "llm-boundary"
  - "runtime-template"
  - "azure-rate-limit"
  - "fail-closed-validation"
---

# FACT 패치 canonical ID 변형으로 인한 분석 파이프라인 실패

## Problem

ScenarioForge의 FACT 생성 경계가 LLM에 너무 많은 책임을 위임했다. 처음에는 모델이 완전한 `FactBundle`과 canonical ID·evidence를 직접 작성했고, 1차 경계 보강 후에도 긴 `SCR-*`, `EL-*`, `API-*` 문자열을 패치에 그대로 복사하도록 요구했다. 모델이 필수 배열, ID 접미사, evidence 좌표를 변경하면서 FACT 단계가 반복적으로 실패했다.

화면에 보이는 증상은 모두 “분석 실패”였지만 실제로는 source scope, runtime resource, Pi tool 노출, FACT contract, provider rate limit이 서로 다른 문제였다. 동일 실행에서 여러 오류가 관측되더라도 terminal stage와 깨진 invariant를 기준으로 분리해야 한다.

## Symptoms

- 완전한 FACT를 작성하던 실행은 다음 오류로 종료됐다.

  ```text
  STAGE_ARTIFACT_REJECTED:FACT_SCHEMA_INVALID,Cannot read properties of undefined (reading 'flatMap')
  ```

- 해당 모델 산출물은 화면 하나에서 필수 `apis` 배열을 누락했다. 구조 검증이 실패한 뒤에도 evidence/inventory 순회가 실행되어 `flatMap` 예외가 2차 증상으로 추가됐다.
- scanner snapshot에는 interaction 64개와 API 3개가 있었지만 모델이 작성한 축약 ID는 scanner inventory와 일치하지 않았다. 모델 evidence reference도 Evidence Grant의 path, line range, hash, grant ID를 정확히 보존하지 못했다.
- deterministic FACT draft와 semantic patch로 범위를 줄인 다음 실행에서도 모델은 다음처럼 화면 ID에 source hash를 다시 붙였다.

  ```text
  Expected: SCR-frontend-src-features-login-login-page
  Actual:   SCR-frontend-src-features-login-login-page-24848ab2
  Error:    FACT_PATCH_REFERENCE_INVALID
  ```

- 같은 시점에 다음 provider 오류도 관측됐다.

  ```text
  429: {"code":"rate_limit_tpm","message":"분당 토큰 한도에 도달했습니다."}
  ```

  429는 transient provider 오류다. terminal error가 schema/reference rejection이면 FACT contract 문제의 원인을 429로 바꾸지 않는다.

## What Didn't Work

### 프롬프트로 완전한 FACT 복제를 강제

“공급된 ID와 evidence만 사용하라”는 자연어 지시만으로 긴 ID, hash, line range, 필수 빈 배열을 정확히 복제하도록 했다. 모델이 생성하면 안 되는 값을 모델 출력 스키마에 그대로 둔 것이 핵심 문제였다.

### canonical ID를 그대로 노출한 semantic patch v1

완전한 FACT 대신 patch만 작성하도록 줄인 것은 올바른 방향이었지만 다음 필드는 여전히 자유 문자열이었다.

```json
{
  "screen_updates": [{"screen_id": "SCR-*"}],
  "element_updates": [{"element_id": "EL-*"}],
  "api_updates": [{"api_id": "API-*"}]
}
```

모델은 element ID에 보이는 source hash 패턴을 screen ID에도 적용했다. “정확히 복사”라는 지시는 구조적 권한 분리가 아니었다.

### reviewer에만 provenance 방어를 의존

Reviewer는 잘못된 산출물을 탐지할 수 있지만 canonical 값의 복구 수단이 아니다. 모델이 이미 전체 FACT를 작성한 뒤 reviewer가 거부하는 방식은 비용이 크고, malformed collection을 안전하게 순회하지 못하면 2차 예외가 최초 원인을 가린다.

### 서로 다른 실패를 한 원인으로 취급

- `.claude/worktrees` 포함은 source input-scope 문제다.
- `noTools: "all"`은 ScenarioForge custom tool suppression 문제다.
- runtime-template 미포함은 build/resource 설치 문제다.
- `FACT_SCHEMA_INVALID`와 `FACT_PATCH_REFERENCE_INVALID`는 artifact contract 문제다.
- `rate_limit_tpm`은 provider capacity 문제다.

같은 “분석 실패” 화면에서 나타나더라도 수정 지점과 회귀 테스트가 다르다.

## Solution

### 수정 이력

| 순서 | 관측된 문제 | 원인 판정 | 반영 내용 | 회귀 근거 |
|---|---|---|---|---|
| 1 | 실제 소스와 무관한 정보가 분석됨 | coding-agent worktree가 scan 대상에 포함될 수 있음 | `.claude/worktrees`를 source snapshot에서 제외 | `generation-core.test.ts`의 worktree 제외 테스트 |
| 2 | 빌드 앱에서 runtime resource를 찾지 못함 | 소스 템플릿이 Electron main output에 포함되지 않음 | runtime-template asset bundle과 bootstrap 복사 경로 구성 | `runtime-template-bundle.test.ts` |
| 3 | agent가 `work.*`, `staging.*`를 호출하지 못함 | Pi의 `noTools: "all"`이 custom tool까지 막음 | built-in tool만 비활성화하는 `noTools: "builtin"`으로 변경 | `pi-sdk-driver.ts`, Pi runtime tests |
| 4 | 완전한 FACT가 schema·inventory·evidence 검증 실패 | LLM이 canonical 구조와 provenance를 소유 | backend deterministic FACT skeleton + semantic patch compiler 도입 | pipeline, desktop, root E2E tests |
| 5 | malformed FACT 뒤 `flatMap` 예외 발생 | 구조 실패 후 evidence 순회를 계속함 | schema invalid 시 즉시 반환하는 fail-closed 순서로 변경 | missing-`apis` E2E test |
| 6 | `FACT_PATCH_REFERENCE_INVALID` | patch v1이 긴 canonical ID 복사를 요구해 모델이 ID를 변형 | patch schema v2 opaque `S/U/A` reference와 backend resolution 도입 | 변형 ref 거부 및 payload ID 비노출 테스트 |
| 7 | verdict 제출 성공 뒤 마지막 429로 FACT 전체 실패 | executor가 terminal provider error만 보고 이미 등록된 산출물을 폐기 | work state 등록·scope·staging path·SHA-256이 모두 맞는 산출물은 prompt 오류 뒤에도 회수 | desktop artifact handoff tests |
| 8 | FACT reviewer 429가 짧은 시간에 최대 12회 호출로 증폭 | Pi 내부 4회 retry와 executor 3회 attempt가 중첩되고 executor rate-limit 대기가 1초·3초에 불과 | Pi generation retry 비활성화, executor 단일 소유, rate-limit 60초·120초 backoff와 sanitized progress 도입 | Pi retry settings, retry policy, executor retry metadata tests |
| 9 | 단일 재시도 정책 적용 뒤에도 FACT reviewer가 `staging.writeJson` 다음 호출에서 429 | FACT bundle을 두 번 넣은 166KB 검토 prompt와 `work.begin`이 반환한 137KB 전체 runtime state가 대화에 누적되어 다음 요청이 약 104K tokens로 증가 | FACT review의 `verified_facts` 중복 제거, Pi work mutation 결과를 `revision/eventType/workStateHash` 소형 receipt로 축약 | semantic review payload 및 compact work receipt tests |

### Backend-owned deterministic FACT skeleton

[`fact-draft-compiler.ts`](../../../packages/scenario-pipeline/src/facts/fact-draft-compiler.ts)의 `createDeterministicFactDraft(snapshot, grant)`가 다음 값을 완성한다.

- 모든 unique scanner interaction/API
- scanner-owned screen/element/API ID
- route가 없는 source의 deterministic screen ID
- 모든 필수 collection
- Evidence Grant에서 선택한 정확한 evidence reference

모델이 update를 생략해도 inventory와 빈 배열은 사라지지 않는다.

### Opaque reference patch v2

`createFactEnrichmentDraftView()`는 canonical ID를 모델에 공개하지 않고 실행 한정 ref로 투영한다.

```json
{
  "screens": [{
    "screen_ref": "S1",
    "elements": [{"element_ref": "U1", "type": "button", "label": "Sign in"}],
    "apis": [{"api_ref": "A1", "reads": [], "writes": ["POST /api/login"]}]
  }]
}
```

모델 출력은 의미 보강만 포함한다.

```json
{
  "schema_version": 2,
  "screen_updates": [{"screen_ref": "S1", "title": "사용자 로그인"}],
  "element_updates": [{"element_ref": "U1", "label": "로그인", "action_kind": "submit-login"}],
  "api_updates": [{"api_ref": "A1", "reads": ["credentials"], "writes": ["session"]}],
  "predicates": [{
    "key": "auth.success",
    "values": ["true", "false"],
    "source": "code",
    "evidence_element_refs": ["U1"]
  }],
  "edges": [{
    "kind": "normal",
    "from_screen_ref": "S1",
    "on_element_ref": "U1",
    "to_screen_ref": "S1",
    "guard": {"predicate_key": "auth.success", "value": "true"}
  }]
}
```

`applyFactEnrichmentPatch()`가 S/U/A ref를 canonical record로 해석하고 `PRED-*`, `E-*`, predicate/edge evidence를 백엔드에서 만든다. 알 수 없는 ref는 다음처럼 필드와 값을 포함해 거부한다.

```text
FACT_PATCH_REFERENCE_INVALID:screen_ref:S1-24848ab2
```

### Runtime agent/skill 계약 동기화

다음 원본 resource를 patch v2와 동일하게 변경했다.

- [`fact-analyst.md`](../../../packages/project-runtime/runtime-template/agents/generation/fact-analyst.md)
- [`fact-extraction-react/SKILL.md`](../../../packages/project-runtime/runtime-template/skills/generation/fact-extraction-react/SKILL.md)

프로젝트의 `.scenarioforge/runtime`은 `분석 시작` bootstrap에서 이 원본을 복사한다. build output에도 같은 asset이 포함되어야 한다.

### 검증 결과

- 전체 테스트: 73개 통과
- 전체 workspace TypeScript 검사: 통과
- Electron production build: 통과
- 2026-08-27 14:44 실제 재실행:
  - runtime skill `fact-enrichment-patch-v2` 설치 확인
  - FACT author가 schema v2 patch 작성
  - screen ref `S1..S7`, element ref `U*`, API ref `A1..A3` 사용
  - patch counts: screen updates 7, element updates 30, API updates 3, predicates 4, edges 7
  - `FACT_PATCH_REFERENCE_INVALID` 재발 없이 reviewer 단계 진입

마지막 항목은 opaque-ref 수정이 live FACT 경계를 통과했다는 증거다. 전체 SRC→FACT→WIKI→SCENARIO 완료를 의미하지는 않는다.

## Why This Works

- canonical ID와 evidence provenance를 확률적 생성 대상에서 제거했다.
- opaque ref는 모델이 ID의 의미나 접미사를 “정리”하거나 재구성할 기회를 없앤다.
- 모델의 강점인 label, action 의미, predicate, transition 추론은 유지하면서 identity와 provenance는 backend가 소유한다.
- 구조 검증을 evidence/inventory 순회보다 먼저 수행해 최초 오류가 terminal code로 보존된다.
- provider retry와 artifact rejection을 별도 오류 범주로 유지하므로 한 실행에서 함께 나타나도 원인을 섞지 않는다.

## Prevention

### 실패 처리 표준 절차

모든 분석 실패는 코드를 수정하기 전에 다음 순서로 처리한다.

1. `analysis_run_id`, `work_id`, stage, 최초 오류, terminal 오류를 고정한다.
2. session JSONL에서는 tool name, stop reason, provider error, artifact metadata만 먼저 본다. 전체 source/prompt와 secret은 출력하지 않는다.
3. staging artifact의 top-level keys, schema version, record counts를 확인한다.
4. 다음처럼 exact error, module, 함수명, tag를 `docs/solutions/`에서 검색한다.

   ```bash
   rg -n -i \
     "FACT_SCHEMA_INVALID|FACT_PATCH_SCHEMA_INVALID|FACT_PATCH_REFERENCE_INVALID|rate_limit_tpm|fact-draft-compiler|pi-generation-executor" \
     docs/solutions
   ```

5. 기존 이력과 symptom, terminal code, 깨진 contract boundary, root cause, 관련 파일, artifact shape, 보장 invariant를 비교해 **동일 문제** 또는 **신규 문제**로 판정한다.
6. 동일 문제면 기존 회귀 테스트를 먼저 실행한다. 테스트가 통과하지만 live failure가 재현되면 같은 화면 증상만으로 동일 문제라고 단정하지 않는다.
7. root cause를 증명하는 최소 실패 테스트를 추가한 후 하나의 원인만 수정한다.
8. focused test, workspace tests, root E2E, typecheck, build, 실제 앱 stage 진행을 순서대로 검증한다.
9. 동일 문제면 이 문서에 `last_updated`와 새 재현·검증을 추가하고, 신규 문제면 별도 solution 문서를 만든다.

### 동일 문제 판정 기준

| 관측 | 판정 |
|---|---|
| full FACT에서 필수 배열 누락 후 secondary `flatMap` | 기존 malformed FACT/validator-order 문제 |
| `FACT_PATCH_REFERENCE_INVALID:element_ref:U99` | opaque reference 변형 또는 ref catalog 문제 |
| Azure `rate_limit_tpm` 뒤 artifact가 없음 | provider retry/failure propagation 문제 |
| `.claude/worktrees` 파일이 snapshot에 포함 | source input-scope 문제 |
| runtime skill이 patch v1 또는 구문을 사용 | runtime-template build/bootstrap 문제 |

같은 “분석 실패” 또는 같은 stage만으로 동일 문제라 판단하지 않는다.

### 최신 관측에서 분리된 신규 문제

2026-08-27 14:45 reviewer session은 시작 직후 `rate_limit_tpm` 429를 네 번 기록했고 tool call이나 verdict artifact를 만들지 못했다. 이후 executor가 존재하지 않는 `VERDICT-fact-<workId>.json`을 읽어 다음 오류가 났다.

```text
ENOENT: no such file or directory, open '.scenarioforge/staging/<workId>/VERDICT-fact-<workId>.json'
```

이 오류는 이 문서에서 해결한 canonical ID drift와 동일 문제가 아니다. 직접 원인은 reviewer provider throttling이고, `host.prompt()`의 model error가 executor retry 경계로 전달되지 않아 `ENOENT`가 terminal symptom이 된 failure-propagation 결함이 함께 있었다.

별도 TDD 재현 후 [`pi-sdk-driver.ts`](../../../packages/pi-runtime/src/host/pi-sdk-driver.ts)에 `promptWithFailurePropagation()`을 추가했다. Pi 내부 retry가 끝난 뒤 새 assistant message의 `stopReason`이 `error`이면 `errorMessage`를 throw하여 executor의 provider retry 분류로 전달한다. 이 변경 후 전체 테스트는 74개가 통과했고 production build도 성공했다. 새 앱에서의 reviewer live 재검증은 다음 사용자 실행을 기다리는 상태이므로, 아직 provider 429 자체가 해소됐다고 기록하지 않는다.

### 2026-08-27 14:57 재실행: 제출 이후 429

재실행 `RUN-510a79ed-76aa-47cc-b5d2-a36b2c4bd261`에서는 이전의 가짜 terminal symptom인 `ENOENT`가 재발하지 않았다. `promptWithFailurePropagation()`이 최종 오류를 다음처럼 정확히 executor까지 전달했으므로 이전 수정은 의도대로 작동했다.

```text
429: {"code":"rate_limit_tpm","message":"분당 토큰 한도에 도달했습니다."}
```

그러나 이번 reviewer는 429가 나기 전에 다음 산출물을 이미 작성하고 `work.submitArtifacts`까지 성공했다.

```text
.scenarioforge/staging/9a657f5c-b376-41f7-96a7-a52170f25a7e/
  VERDICT-fact-9a657f5c-b376-41f7-96a7-a52170f25a7e.json

{"pass":true,"issueCodes":[]}
```

즉 이전 관측의 “429 뒤 artifact가 없음”과는 다른 후속 결함이다. 같은 provider/failure-propagation 영역이지만 깨진 invariant는 **제출 트랜잭션이 완료된 산출물은 마지막 설명 응답의 실패로 폐기하면 안 된다**는 handoff 규칙이다.

[`pi-generation-executor.ts`](../../../apps/desktop/src/main/application/pi-generation-executor.ts)의 산출물 회수 조건을 다음처럼 보강했다.

1. 현재 backend work state에 동일 `artifactId`가 등록되어 있어야 한다.
2. 등록 record의 `workId`, `stagingPath`, `status`가 현재 요청과 정확히 일치해야 한다.
3. staging 파일의 SHA-256이 등록된 `contentHash`와 일치해야 한다.
4. 위 조건이 모두 맞으면 prompt terminal error 이후에도 JSON을 회수한다.
5. 등록되지 않은 파일이면 파일이 존재해도 신뢰하지 않고 원래 provider error를 유지한다.

검증 결과는 desktop artifact handoff 집중 테스트 4개, 전체 테스트 76개, TypeScript 검사, Electron production build 모두 통과다. 이 변경의 실제 SRC→FACT 이후 진행 여부는 새 build로 재실행해 계속 관측한다.

### 2026-08-27 16:04 재실행: 중첩 429 재시도 증폭

재실행 `RUN-f7710a2d-3ee3-42a7-829d-987e5e39429e`의 SRC는 완료됐고 FACT author는 다음 경계를 모두 통과했다.

- `work.submitArtifacts` 성공: `2026-08-27T07:03:09Z`
- `work.requestCompletion` 성공: `2026-08-27T07:03:12Z`
- 직후 terminal 429가 발생했지만 등록·scope·path·hash가 일치하는 `FACT-RUN-f7710a2d-3ee3-42a7-829d-987e5e39429e`를 회수

따라서 runtime-template, opaque reference, artifact handoff 수정은 이번 실행에서도 정상 작동했다. 실패 지점은 독립 FACT reviewer였다.

Reviewer attempt별 session 관측은 다음과 같다.

| attempt | session 시작 | 관측 |
| --- | --- | --- |
| 1 | `2026-08-27T07:03:42Z` | artifact/tool call 없이 429 4회 |
| 2 | `2026-08-27T07:03:58Z` | staging write 뒤 submit 전 429 4회 |
| 3 | `2026-08-27T07:04:34Z` | artifact/tool call 없이 429 4회 |

Pi는 한 prompt 안에서 1초·2초·4초 간격으로 자동 retry했고, 이 prompt가 실패하면 `PiGenerationExecutor`가 다시 1초·3초 뒤 새 session을 만들었다. 결과적으로 동일 reviewer 작업이 약 67초 동안 최대 12 provider 요청으로 증폭되어 분 단위 TPM 회복을 방해했다.

이 사례는 기존 `ENOENT`, 제출 이후 artifact 폐기, canonical ID drift, runtime-template 누락의 재발이 아니다. 직접 외부 원인은 Azure `rate_limit_tpm`이고, 내부 결함은 **서로 다른 두 계층이 같은 transient failure의 retry를 동시에 소유한 것**이다.

수정 후 generation session은 `SettingsManager.inMemory({ retry: { enabled: false } })`를 사용한다. `PiGenerationExecutor`가 유일한 retry owner이며 정책은 다음과 같다.

- provider timeout/network transient: `1초 → 3초`
- provider rate limit: `60초 → 120초`
- 세 번째 실패: 원래 provider 오류를 terminal error로 유지

retry observer에는 stage, role, category, attempt, delay만 전달한다. provider 오류 본문, prompt payload, endpoint, credential은 진행 이벤트에 포함하지 않는다. 화면은 rate-limit 대기 중 `요청 한도 회복 대기`를 표시한다.

회귀 테스트:

- `packages/pi-runtime/src/pi-runtime.test.ts`: generation Pi 자동 retry 비활성화
- `packages/scenario-pipeline/src/workflows/work-policies.test.ts`: category별 retry schedule
- `apps/desktop/src/main/application/pi-generation-executor.test.ts`: 60/120초 단일 schedule과 metadata sanitization
- `apps/desktop/src/main/application/application-orchestrator.test.ts`: sanitized 진행 문장 projection

### 2026-08-27 16:40 재실행: FACT reviewer 대화 컨텍스트 증폭

재실행 `RUN-9cad36a7-4478-4de3-9651-d1e5f5b7ac37`은 이전 수정의 60초·120초 단일 backoff를 정확히 따랐다. 세 reviewer session은 각각 `07:35:28Z`, `07:36:29Z`, `07:38:40Z`에 시작했고 Pi 내부 중첩 retry는 재발하지 않았다. 따라서 수정 이력 8의 retry ownership 문제와 같은 결함은 아니었다.

두 번째와 세 번째 attempt는 모두 다음 순서까지 진행한 뒤 실패했다.

```text
work.getContext → work.begin → staging.writeJson → 429 rate_limit_tpm
```

민감한 prompt 본문을 출력하지 않고 session JSONL의 직렬화 크기와 provider usage만 계측했다.

| 계측 항목 | 수정 전 |
| --- | ---: |
| reviewer 최초 prompt | 166,744 bytes |
| `artifact` FactBundle | 55,744 bytes |
| 같은 객체인 `verified_facts` | 55,744 bytes |
| reviewer evidence slices | 54,288 bytes |
| `work.begin` tool result | 약 137KB |
| `staging.writeJson`까지 누적된 provider context | 약 104,304 tokens |

첫 요청에서 `artifact === verified_facts`가 참이었고, `work.begin`은 mutation receipt가 아니라 artifacts와 works를 포함한 전체 `ProjectRuntimeState`를 반환했다. 큰 reviewer prompt에 전체 상태가 다시 대화 기록으로 붙으면서 다음 provider 요청이 TPM/context 경계에 도달했다. 이는 외부 증상은 같은 429지만, 이전의 **재시도 횟수 증폭**과 다른 **요청당 컨텍스트 증폭** 문제다.

수정은 두 경계에 적용했다.

1. FACT 자체를 검토할 때는 `artifact`만 전달하고 동일한 `verified_facts` 필드를 만들지 않는다. WIKI 검토에는 verified FACT를, 시나리오 검토에는 verified FACT와 WIKI를 계속 제공한다.
2. `work.getContext`는 일회성 token과 revision이 필요하므로 그대로 유지한다. `work.begin`, `work.submitArtifacts`, `work.requestCompletion`을 포함한 mutation tool 결과는 전체 state 대신 `ok`, 다음 `revision`, `eventType`, `workStateHash`만 Pi 모델에 반환한다. canonical runtime state와 journal 저장 형식은 변경하지 않았다.

실패 세션과 같은 FACT payload 기준 reviewer prompt는 약 166KB에서 약 111KB로 줄고 mutation 응답은 512 bytes 미만으로 제한된다.

회귀 및 빌드 검증:

- `packages/pi-runtime/src/pi-runtime.test.ts`: 전체 state를 모델에 echo하지 않는 compact receipt와 `work.getContext` 보존
- `apps/desktop/src/main/application/pi-generation-executor.test.ts`: FACT 중복 금지 및 scenario의 FACT/WIKI 참조 보존
- 전체 테스트 100개 통과
- 전체 workspace TypeScript 검사 통과
- Electron production build 통과, runtime-template asset 포함 확인

프로젝트 엔진 요구사항은 Node `>=22.19.0`이다. 전체 검증은 `v24.16.0`에서 수행했다. 기본 shell의 Node 20에서 보인 `node:fs.globSync`와 `node:sqlite` 미지원은 이번 코드 변경의 회귀가 아니며 지원 범위 밖 실행 환경이다.

이 수정이 실제 provider TPM 한도 안에서 FACT reviewer를 완료시키는지는 새 build를 재시작한 다음 실행에서 확인한다.

### 2026-08-28 후속 회귀: 제출 staging path 한 글자 변형

`RUN-31f0dcfa-bed0-4ff2-9d38-f6703e875bf3`의 FACT work에서 backend-expected 파일은 `FACT-RUN-31f0dcfa-bed0-4ff2-9d38-f6703e875bf3.json`으로 정확히 작성됐고 SHA-256도 state의 `contentHash`와 일치했다. 그러나 model의 `work.submitArtifacts` metadata만 run ID를 `...4ff1...`로 한 글자 바꿔 `SUBMITTED_ARTIFACT_SCOPE_MISMATCH`가 발생했다.

artifact ID, work ID, staged status, backend-expected 실제 파일, content hash가 모두 일치할 때는 model이 제출한 `stagingPath` 문자열을 신뢰하지 않고 backend가 계산한 expected path를 사용하도록 변경했다. 파일이 없거나 hash가 다르거나 artifact/work/status scope가 다르면 기존처럼 실패한다. 경로 metadata만 변형된 실제 형태를 회귀 테스트로 RED→GREEN 검증했다.

## Related Issues

- [JSX 정규식 interaction 의미·라벨 손상](./jsx-regex-interaction-semantic-corruption.md)
- [단계 격리 생성 orchestration 계획](../../plans/2026-09-02-001-refactor-stage-isolated-generation-orchestration-plan.md)
- [Pi Coding Agent 하네스 설계](../../pi-coding-agent%20하네스%20설계.md)
- [Agent 상세 설계](../../architecture/01-agent-detailed-design.md)
- [통합 하네스 서버 설계](../../architecture/03-integrated-harness-server-design.md)
- [Pi runtime/LLM workflow 계획](../../superpowers/plans/2026-08-25-pi-runtime-llm-workflows.md)

`docs/pi-coding-agent 하네스 설계.md`와 `docs/architecture/01-agent-detailed-design.md`는 opaque-ref v2 이전 설명을 일부 포함하므로 후속 refresh 우선순위가 높다. 생성 단계의 후속 구조 변경은 active 단계 격리 계획을 기준으로 한다.
