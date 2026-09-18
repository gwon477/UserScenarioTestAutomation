---
title: "앱 재시작 후 프로젝트 디렉터리 승인이 사라져 즉시 재분석할 수 없음"
date: "2026-08-27"
category: "integration-issues"
module: "scenarioforge-desktop"
problem_type: "integration_issue"
component: "electron-main"
severity: "medium"
symptoms:
  - "모델 키는 복원되지만 앱이 다시 소스 디렉터리 선택 화면에 머묾"
  - "다시 분석을 요청해도 새 analysisRunId가 생성되지 않음"
root_cause: "ephemeral_project_authorization"
resolution_type: "code_fix"
related_components:
  - "electron-preload"
  - "renderer-startup"
  - "project-directory-store"
tags:
  - "project-directory"
  - "authorization"
  - "restart"
  - "immediate-retry"
---

# 앱 재시작 후 프로젝트 디렉터리 승인이 사라져 즉시 재분석할 수 없음

## Problem

OS 보호 credential cache를 구현한 뒤에도 개발 앱을 build/restart하면 프로젝트 선택 화면으로 돌아갔다. 사용자가 분석 시작을 알렸지만 `.scenarioforge/state/project-state.json`의 revision은 345, 최종 run은 `RUN-94faabc8-29f8-4172-bebd-38b5b6a87a83`에 머물렀고 새 run이 생성되지 않았다.

## Prior-history comparison

- runtime-template 누락: 앱 기동 로그와 build asset에 재발 없음
- credential 소실: 설정과 author/reviewer key availability는 OS 보호 cache에서 복원됨
- FACT/WIKI 계약 실패: 분석 요청 자체가 main orchestrator에 도달하지 않아 해당 단계 이전의 문제임
- `.claude/worktrees` 경로 오선택: 현재 대상은 canonical `test_project_source/axse-agents`이며 무관함

따라서 이전 분석 단계 실패의 재발이 아니라 Electron main의 디렉터리 승인 수명 문제다.

## Root Cause

main 프로세스는 사용자가 native directory picker로 선택한 canonical 경로를 다음 메모리 Set에만 보관했다.

```ts
const selectedProjectRoots = new Set<string>();
```

build/restart 시 Set이 비워지는 반면 renderer는 보안을 위해 localStorage의 프로젝트 경로를 desktop 권한으로 사용하지 않았다. 두 정책은 각각 안전했지만 함께 적용되면서 매번 native picker를 다시 거쳐야 했고, credential cache만으로는 즉시 재시도가 완성되지 않았다.

## Solution

사용자가 picker에서 실제 선택한 경로만 Electron app userData의 `project-directory.v1.json`에 기록한다.

- main이 선택 경로를 `realpath`로 canonicalize하고 directory 여부를 검사한다.
- same-directory temporary file과 `rename`으로 원자적으로 저장하고 mode `0600`을 요청한다.
- 재시작 시 main이 저장 문서를 읽어 다시 `realpath + stat().isDirectory()`를 검증한다.
- 검증된 경로만 현재 프로세스의 `selectedProjectRoots`에 재등록한다.
- renderer localStorage는 권한 근거로 사용하지 않으며, renderer에는 main이 승인한 `{name, path}`만 반환한다.
- 문서 손상, schema 불일치, 경로 삭제, 파일로 변경된 경로는 cache miss로 처리해 picker 화면으로 돌아간다.

이는 임의 renderer 경로를 자동 승인하는 변경이 아니다. 기존의 명시적 사용자 선택을 app-scoped allowlist로 기억하는 변경이다.

## Regression Test

- `index.test.ts`: restore IPC, store load/save, 승인 Set 재등록을 요구해 수정 전 RED를 확인했다.
- `desktop.test.ts`: preload bridge가 없는 Electron renderer가 localStorage fallback을 신뢰하지 않는지 확인했다.
- `project-directory-store.test.ts`: symlink canonicalization, 정상 복원, malformed/stale fail-closed, regular file 거부를 검증한다.

## Verification

- 집중 테스트 12개 통과
- 후속 회귀를 포함한 전체 workspace 테스트 118개 통과
- 전체 workspace TypeScript 검사 통과
- Electron production build 통과, `runtime-template` asset 포함 확인
- 실제 재시작에서 프로젝트와 `gpt-5.6-luna` credential availability가 자동 복원되고 `분석 시작` 화면에 바로 진입함을 확인했다.

## Prevention

재시작 후 즉시 재시도가 실패하면 provider key부터 다시 묻지 않는다.

1. 새 state revision/analysisRunId가 생성됐는지 본다.
2. 생성되지 않았다면 renderer → preload → main IPC 도달 여부를 확인한다.
3. credential availability와 project path authorization을 별도 상태로 확인한다.
4. renderer가 보유한 경로 문자열 자체를 승인 근거로 삼지 않는다.
5. 저장된 allowlist 경로는 매 프로세스 시작마다 canonical path와 directory type을 다시 검증한다.

## Related

- [상태 기반 Page 컴포넌트 screen inventory](./state-driven-page-components-collapsed-into-source-screen.md)
- [FACT canonical ID 및 provider failure 이력](./fact-patch-canonical-id-reference-drift.md)
- [보호 credential cache 설계](../../superpowers/specs/2026-08-27-secure-model-credential-cache-and-rate-limit-retry-design.md)
