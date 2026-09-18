---
paths:
  - "test_project_source/**"
---

# test_project_source

이 디렉터리는 분석 대상 fixture다. ScenarioForge의 입력이며, 제품 코드가 아니다.

- 분석 실패를 해결하기 위해 fixture source를 수정하지 않는다. (`.claude/settings.json`의 `Edit(/test_project_source/**)` deny 규칙으로 강제된다.)
- `.scenarioforge`는 실행 산출물이므로 수동 보정하지 않는다. 상태가 깨졌으면 재생성한다.
- fixture에서 발견한 오류는 ScenarioForge scanner/compiler/reviewer 경계에서 수정한다.
- fixture 안의 `.claude`, `CLAUDE.md`, `agents.md`, `.mcp.json`은 원본 프로젝트의 설정이다. 이 저장소의 개발 설정으로 해석하지 않는다.
- 이 디렉터리에 저장소 개발용 지침 파일(`AGENTS.md`, `CLAUDE.md`)을 만들지 않는다. scanner가 fixture 입력으로 수집한다.
- fixture를 근거로 "분석이 통과했다"고 판단할 때는 어떤 fixture의 어떤 run ID인지 함께 기록한다.

새로운 분석 대상 패턴이 필요하면 기존 파일을 고치지 않고 새 경로로 추가하며, 변경 이유를 커밋 메시지에 남긴다. deny 규칙 때문에 승인이 필요하다.
