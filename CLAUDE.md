@AGENTS.md

## Claude Code

- 디렉터리별 세부 규칙은 각 디렉터리의 `AGENTS.md`에 있고, 같은 디렉터리의 `CLAUDE.md`가 이를 import한다. 해당 디렉터리 파일을 읽을 때 로드된다.
- 실패 조사는 `diagnose-analysis-failure` skill로 시작한다.
- 완료를 주장하기 전에 `verify-generation-pipeline` skill을 실행한다.
- 읽기 전용 조사는 `failure-investigator`, 검증 실행은 `verification-runner` 에이전트에 위임한다.
- 구조적 탐색(정의 위치, 호출 관계, 변경 영향)은 grep 대신 `codegraph_*`를 사용한다.
