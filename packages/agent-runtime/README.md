# ScenarioForge Agent Runtime (planned)

이 디렉터리는 다음 백엔드 작업에서 연결할 `pi-coding-agent` 기반 런타임의 경계입니다.

현재 커밋에는 하네스, 스킬, 서브에이전트 또는 분석 실행 코드를 포함하지 않습니다. 후속 작업에서 Electron main process가 별도 `UtilityProcess`로 런타임을 시작하고, 선택된 분석 대상 프로젝트 내부에 전용 구성을 설치하도록 구현할 예정입니다.

예정 책임 범위:

- 분석 대상 디렉터리에 ScenarioForge 전용 에이전트 구성을 설치·갱신
- `SRC → FACT → WIKI → SCENARIO` 파이프라인 실행과 진행 이벤트 발행
- 결과를 대상 프로젝트의 `.scenarioforge/` 아래에 기록
- Renderer에 파일 시스템이나 프로세스 권한을 직접 노출하지 않고 typed IPC 계약으로 결과 전달
