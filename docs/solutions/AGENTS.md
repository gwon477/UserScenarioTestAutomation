# docs/solutions

검증된 실패 이력과 재사용 가능한 수정을 기록한다. 추측이 아니라 **재현되고 검증된** 내용만 남긴다.

## YAML frontmatter 필수 필드

```yaml
---
title: "한 줄 제목"
date: "YYYY-MM-DD"
category: "integration-issues"
module: "scenarioforge-<영역>"
problem_type: "integration_issue"
component: "<주 실패 컴포넌트>"
severity: "high"
symptoms:
  - "관찰된 증상"
root_cause: "<snake_case 원인 분류>"
resolution_type: "code_fix"
related_components:
  - "<보조 컴포넌트>"
tags:
  - "<검색 키워드>"
---
```

같은 문제를 갱신할 때는 `last_updated: "YYYY-MM-DD"`를 추가/갱신한다. `symptoms`, `tags`, `related_components`는 exact error 문자열로 검색될 수 있도록 실제 오류 코드를 포함한다.

## 본문 순서

`Problem` → `Root Cause` → `Solution` → `Regression Test` → `Verification`

- **Problem** — stage, run ID, work ID, 최초 오류와 terminal 오류를 실제 로그 문자열로 인용한다.
- **Root Cause** — 깨진 contract boundary를 명시한다. "LLM이 잘못했다"로 끝내지 않는다.
- **Solution** — 하나의 원인에 대한 하나의 수정. 변경 파일을 나열한다.
- **Regression Test** — 원인을 증명하는 테스트의 파일 경로와 실행 명령.
- **Verification** — focused test, 전체 test, typecheck, build, live stage 결과.

`Prevention`, `Related`, `Prior-history comparison`은 선택 항목으로 뒤에 붙인다.

## 같은 문제 vs 새 문제

다음 다섯 가지를 비교해 분류한다: 깨진 contract boundary, root cause, artifact 형태, 영향 파일, 이전에 보호한 invariant.

- **같은 문제** — 기존 문서의 `last_updated`를 갱신하고 후속 회귀 섹션을 추가한다. 새 문서를 만들지 않는다.
- **다른 contract boundary** — 새 문서를 만든다. 기존 문서에는 `Related`로 상호 링크한다.

기존 문제로 분류했다면 문서화된 회귀 테스트를 먼저 실행한다. 그 테스트가 통과하는데 실패가 남아 있으면 같은 문제가 아니므로 이전 수정을 반복하지 않는다.

## 섞지 않는 것

- provider 오류(rate limit, timeout, 인증, 동시성)와 artifact/schema 오류를 한 문서에 섞지 않는다. 한쪽이 다른 쪽을 유발했다는 증거가 있을 때만 함께 기록하고, 그 인과를 명시한다.
- 여러 원인을 한 문서에 묶지 않는다. 검색으로 재사용할 수 없게 된다.
- secret, API key, credential, prompt 원문을 인용에 포함하지 않는다. 마스킹한 형태로만 남긴다.
