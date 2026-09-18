---
title: "FACT semantic label이 scanner-owned 실행 locator를 덮어씀"
date: "2026-08-27"
category: "integration-issues"
module: "scenarioforge-fact-generation"
problem_type: "integration_issue"
component: "fact-draft-compiler"
severity: "high"
symptoms:
  - "FACT reviewer가 ELEMENT_TARGET_NAME_MISMATCH로 입력 locator를 거부함"
  - "file input이 ELEMENT_TARGET_ROLE_MISMATCH:textbox로 거부됨"
root_cause: "ownership_boundary_violation"
resolution_type: "code_fix"
related_components:
  - "source-scanner"
  - "fact-draft-compiler"
  - "stage-reviewer"
  - "test-execution-planner"
tags:
  - "target-candidates"
  - "accessible-name"
  - "htmlFor"
  - "file-input"
  - "semantic-label"
  - "ownership"
---

# FACT semantic label이 scanner-owned 실행 locator를 덮어씀

## Problem

실제 분석 `RUN-ab57f0ab-6ad9-4bd3-8788-c2dbbe6a1c99`에서 API effect evidence 문제는 재발하지 않았고 FACT author/reviewer의 도구 호출과 artifact handoff도 완료됐다. reviewer는 다음 세 건으로 FACT를 거부했다.

```text
ELEMENT_TARGET_NAME_MISMATCH: username input
ELEMENT_TARGET_NAME_MISMATCH: password input
ELEMENT_TARGET_ROLE_MISMATCH: upload file control as textbox
```

author가 사람용 label을 `아이디 입력`, `패스워드 입력`으로 보강하자 compiled FACT의 실행 candidate도 같은 문자열로 바뀌었다. 그러나 실제 JSX의 접근 가능한 이름은 연결된 label인 `아이디`, `패스워드`다.

업로드 control은 `kind=file`, `action_kind=upload`였지만 target candidate만 `role-name/textbox`로 남아 있었다.

## Prior-history comparison

[`jsx-regex-interaction-semantic-corruption.md`](./jsx-regex-interaction-semantic-corruption.md)의 기존 원인을 먼저 확인했다.

| 기존 문제 | 이번 실행 |
|---|---|
| arrow `=>`를 tag 끝으로 오인 | 재발 없음 |
| handler source가 label에 포함 | 재발 없음 |
| checkbox가 textbox/fill | 재발 없음 |
| 반복 label ID 충돌 | 재발 없음 |
| semantic label을 role-name에 동기화 | 이번 실패의 직접 원인 |

따라서 원래 regex 파싱 결함의 재발은 아니고, 당시 후속 해결로 도입한 locator 동기화 규칙의 ownership 결함이다.

## Root Cause

### 사람용 label과 실행 locator를 동일 필드처럼 취급

`applyFactEnrichmentPatch()`는 LLM의 `element_updates[].label`을 적용하면서 모든 `role-name` candidate의 `name`도 같은 값으로 덮어썼다.

하지만 두 값의 owner와 목적은 다르다.

- `FactElement.label`: 시나리오 표와 설명에 쓰이는 사람용 semantic text
- `interaction.target_candidates`: 테스트 수행 시 binding에 쓰이는 source-derived executable locator

LLM이 의미를 자연스럽게 다듬을 권한이 있다고 해서 source locator를 바꿀 권한까지 생기지 않는다.

### external label association 누락

scanner는 input의 ancestor `<label>`은 읽었지만 sibling `<label htmlFor="id">`와 `<input id="id">` 관계는 해석하지 않았다. 그 결과 placeholder가 role-name으로 선택됐다. HTML accessible name에서는 연결 label이 placeholder보다 우선한다.

### file input의 role fallback 누락

scanner가 `input type=file`을 `kind=file`로 분류했지만 `interactionRole()`에는 file case가 없어 기본 textbox로 떨어졌다. 업로드 실행은 native file input을 직접 지정해야 하므로 `input[type="file"]` candidate가 더 정확하다.

## Solution

1. semantic patch는 `element.label`만 변경하고 `target_candidates`를 수정하지 않는다.
2. JSX source 전체에서 `label[htmlFor]`를 수집하고 matching `input[id]`의 accessible name으로 사용한다.
3. accessible name 우선순위를 `aria-label → linked/ancestor label → title → placeholder → own text`로 정리한다.
4. file input에는 `role-name/textbox`를 만들지 않고 `css: input[type="file"]` candidate를 제공한다.
5. `test-id`가 있으면 기존과 같이 우선 candidate로 보존한다.

이 경계는 상위 하네스 설계의 “`target_candidates`는 코드에서 확인된 후보” 규칙과 일치한다. 향후 RunnerPlan은 사람용 action 문장을 locator로 재해석하지 않고 이 immutable candidate를 사용한다.

## Regression Tests

[`generation-core.test.ts`](../../../packages/scenario-pipeline/src/generation-core.test.ts)에 세 독립 회귀를 추가·수정했다.

1. semantic label을 `Sign in → 로그인`으로 바꿔도 `role-name: Sign in` 유지
2. `htmlFor="user-id"` label `아이디`가 placeholder `아이디를 입력하세요`보다 우선
3. file input이 `role=textbox`가 아니라 `css=input[type="file"]`, action은 `upload`

각 테스트는 수정 전 의도한 mismatch로 RED를 확인한 뒤 GREEN으로 전환했다.

## Verification

- scenario-pipeline 집중 테스트: 23개 통과
- 전체 workspace 테스트: 107개 통과
- 전체 workspace TypeScript 검사: 통과
- Electron production build: 통과
- `git diff --check`: 통과
- 실제 FACT reviewer 재실행: 새 build 재시작 후 관측 예정

## Prevention

`ELEMENT_TARGET_NAME_MISMATCH` 또는 `ELEMENT_TARGET_ROLE_MISMATCH`는 다음 순서로 확인한다.

1. source snapshot의 `kind`, `label`, `target_candidates`를 먼저 본다.
2. author patch 전 deterministic candidate와 compiled FACT candidate를 비교한다.
3. 값이 patch 뒤 바뀌면 compiler ownership 위반이다.
4. snapshot부터 틀리면 JSX accessible-name/role extraction 문제다.
5. source에 stable binding이 없으면 LLM이 locator를 창작하게 하지 않고 unresolved/inconclusive로 남긴다.

## Related

- [JSX interaction 의미·라벨 손상](./jsx-regex-interaction-semantic-corruption.md)
- [API effect evidence slice 절단](./api-effect-evidence-slice-truncation.md)
- [FACT canonical ID 및 provider failure 이력](./fact-patch-canonical-id-reference-drift.md)
- [Pi Coding Agent 하네스 설계](../../pi-coding-agent%20하네스%20설계.md)
