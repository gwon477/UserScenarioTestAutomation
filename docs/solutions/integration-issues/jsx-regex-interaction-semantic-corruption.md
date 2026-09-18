---
title: "JSX 정규식 스캔으로 인한 interaction 의미·라벨 손상"
date: "2026-08-27"
last_updated: "2026-08-27T17:55:00+09:00"
category: "integration-issues"
module: "scenarioforge-source-scanner"
problem_type: "integration_issue"
component: "scenario-pipeline"
severity: "high"
symptoms:
  - "FACT reviewer가 checkbox를 textbox/fill로 분류했다고 거부"
  - "버튼과 입력 target name에 onClick/onChange JSX 코드가 포함됨"
  - "같은 파일의 반복 라벨이 동일 element ID로 충돌"
root_cause: "logic_error"
resolution_type: "code_fix"
related_components:
  - "source-scanner"
  - "fact-draft-compiler"
  - "fact-reviewer"
tags:
  - "jsx"
  - "typescript-ast"
  - "checkbox"
  - "accessible-name"
  - "deterministic-id"
  - "fact-review"
---

# JSX 정규식 스캔으로 인한 interaction 의미·라벨 손상

## Problem

실행 `RUN-bfa73671-f5c9-4beb-bb91-c8320f9aa704`의 FACT author와 reviewer는 모든 Pi 도구 호출, 산출물 제출, 완료 요청을 정상 수행했다. 이전의 TPM 컨텍스트 증폭 수정도 실제로 적용되어 author는 약 24.6K tokens, reviewer는 약 33.2K tokens 안에서 종료됐다.

그러나 reviewer는 `pass:false`와 다음 신규 issue code를 반환했다.

```text
ELEMENT_SEMANTICS_CHECKBOX_AS_FILL
ELEMENT_SEMANTICS_SETTINGS_CHECKBOX_AS_TEXTBOX
TARGET_CANDIDATE_RAW_JS_LABELS
ELEMENT_LABEL_NOT_USER_FACING
```

기존 `docs/solutions/`에서 exact issue code와 증상을 검색했지만 일치하는 이력이 없었다. 이 실패는 canonical ID 변형, runtime-template 누락, nested retry, prompt context 증폭의 재발이 아니다.

## Root Cause

[`source-scanner.ts`](../../../packages/scenario-pipeline/src/scanning/source-scanner.ts)는 JSX interaction을 다음 형태의 정규식으로 읽었다.

```text
<(button|a|input|select|textarea)\b([^>]*)>([^<]*)
```

`onClick={() => onPage(page + 1)}`의 화살표에 있는 `>`를 opening tag의 끝으로 오인했다. 그 뒤 handler와 나머지 attribute가 inner text처럼 캡처되어 label과 role-name target에 저장됐다.

```text
= totalPages} onClick={() => onPage(page + 1)} type="button">다음
```

또한 모든 `<input>`을 type attribute와 무관하게 다음처럼 고정했다.

```text
kind=input → role=textbox → action_kind=fill
```

따라서 `<input type="checkbox">`도 checkbox 선택 컨트롤이 아니라 textbox 입력으로 deterministic FACT에 들어갔다. Reviewer는 모델 산출물이 아니라 backend-owned scanner record의 손상을 탐지한 것이다.

AST 전환 뒤 정적 사용자 라벨만 사용하자 같은 파일의 `닫기`, `이전`, generic `button`처럼 반복되는 label이 기존 ID 함수에서 충돌하는 문제도 드러났다. source path와 label만으로 ID를 만들고 source position을 포함하지 않은 것이 원인이었다.

## Solution

### JSX interaction을 TypeScript AST로 추출

정규식 interaction loop를 제거하고 이미 생성하던 TypeScript `SourceFile` AST 순회에 JSX extraction을 통합했다.

- `JsxOpeningElement`와 `JsxSelfClosingElement`만 처리
- `aria-label`, `title`, `placeholder`, direct/nested JSX text, 연결된 `<label>` 순으로 의미 라벨 추출
- handler expression은 label 후보에서 제외
- conditional/template expression에서는 정적 문자열 부분만 추출
- `data-testid`, `data-test`, `testID` 보존
- input type을 checkbox, radio, file, range, number, button 계열로 구분
- checkbox/radio는 role과 kind를 보존

### deterministic action semantics 보강

[`fact-draft-compiler.ts`](../../../packages/scenario-pipeline/src/facts/fact-draft-compiler.ts)의 기본 action mapping을 보강했다.

| kind | action_kind |
| --- | --- |
| checkbox, radio | `check` |
| file | `upload` |
| select | `select` |
| input, textarea | `fill` |

Semantic patch의 `element.label`은 사람·UI용 설명만 갱신한다. scanner가 코드에서 도출한 `target_candidates`는 실행 계약이므로 LLM label과 동기화하지 않는다. 초기 수정에서는 두 값을 함께 바꿨으나 실제 reviewer 실행에서 source-derived accessible name을 훼손하는 후속 결함이 확인되어 이 규칙을 철회했다.

### 반복 라벨 ID 충돌 방지

Element ID의 source discriminator에 JSX opening node의 source position을 포함했다. 같은 파일과 같은 라벨의 컨트롤도 서로 다른 위치라면 고유 ID를 갖고, 같은 source snapshot을 다시 스캔하면 동일 ID가 재생성된다.

## Regression Tests

[`generation-core.test.ts`](../../../packages/scenario-pipeline/src/generation-core.test.ts)에 다음 실제 실패 패턴을 추가했다.

1. arrow-function attribute가 handler source를 label에 유출하지 않고 `다음`을 추출
2. 연결된 `<label>` 안의 checkbox가 `role=checkbox`, `action_kind=check`를 유지
3. semantic label update가 scanner-owned role-name target name을 변경하지 않음
4. 같은 파일·같은 라벨의 두 컨트롤이 서로 다른 deterministic ID를 생성

테스트는 수정 전에 각각 잘못된 handler label, `input/textbox/fill`, stale target name, 중복 ID로 실패하는 것을 확인한 뒤 통과시켰다.

## Verification

실제 대상 디렉터리를 LLM 호출 없이 다시 스캔한 결과:

| 항목 | 결과 |
| --- | ---: |
| interactions | 63 |
| handler/source syntax가 섞인 label | 0 |
| checkbox | 4 |
| checkbox role 오류 | 0 |
| duplicate element ID | 0 |
| runtime 값에 의존해 generic label로 남은 항목 | 10 |

추가 검증:

- 전체 테스트 103개 통과
- 전체 workspace TypeScript 검사 통과
- Electron production build 통과
- `git diff --check` 통과

동적 map 값에 의존하는 generic label 10건은 FACT의 사람용 semantic label 보강 대상이다. 실행 locator는 코드에서 확인된 source candidate만 유지하며, semantic label을 locator로 승격하지 않는다.

## 2026-08-27 후속 회귀: semantic label과 locator ownership 혼합

실행 `RUN-ab57f0ab-6ad9-4bd3-8788-c2dbbe6a1c99`에서 원래의 regex/checkbox/raw-source 오류는 재발하지 않았다. 대신 reviewer가 다음 신규 문제를 탐지했다.

```text
ELEMENT_TARGET_NAME_MISMATCH
ELEMENT_TARGET_ROLE_MISMATCH
```

첫 두 건은 FACT author가 `아이디 입력`, `패스워드 입력`으로 사람용 label을 보강했을 때 compiler가 `role-name.name`도 덮어쓴 데서 발생했다. 세 번째 건은 file input이 `kind=file`, `action_kind=upload`까지는 올바르지만 role은 여전히 기본 `textbox`였던 누락이다. 또한 외부 `<label htmlFor="...">` 연결을 scanner가 해석하지 않아 placeholder를 accessible name으로 쓰고 있었다.

후속 수정은 다음 ownership을 확정한다.

- `FactElement.label`: evidence-backed 사람용 의미 설명, LLM 보강 가능
- `interaction.target_candidates`: source scanner가 소유하는 실행 binding, LLM 변경 불가
- linked label: `aria-label` 다음으로 `htmlFor`/ancestor label을 placeholder보다 우선
- file input: `role-name/textbox`를 만들지 않고 source-derived CSS file-input candidate 사용

상세 원인과 회귀 기준은 [semantic label과 실행 locator ownership 혼합](./semantic-label-locator-ownership-drift.md)에 분리해 기록했다.

## Prevention

1. JSX/TSX 구조를 정규식으로 파싱하지 않는다.
2. scanner record에서 handler source fragment가 label/target name에 포함되지 않는지 집계한다.
3. input interaction은 tag 이름만이 아니라 type attribute로 의미를 결정한다.
4. 반복 렌더링 template을 고려해 source position을 deterministic ID discriminator에 포함한다.
5. reviewer issue code가 새로 나타나면 exact code를 이력에서 검색하고, 모델 출력보다 먼저 backend deterministic input을 검사한다.
6. 사람용 semantic label과 실행용 target candidate를 같은 문자열 필드로 취급하지 않는다.

## Related Issues

- [Pi 모델 operationId 재사용으로 인한 artifact 미등록](./pi-model-operation-id-collision.md)
- [FACT patch canonical ID 변형 및 provider 실패 이력](./fact-patch-canonical-id-reference-drift.md)
- [fetch options HTTP method 오분류](./fetch-options-http-method-misclassification.md)
- [semantic label과 실행 locator ownership 혼합](./semantic-label-locator-ownership-drift.md)
- [Pi Coding Agent 하네스 설계](../../pi-coding-agent%20하네스%20설계.md)
