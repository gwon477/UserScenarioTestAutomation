# ScenarioForge Agent Runtime (compatibility placeholder)

이 디렉터리는 초기 UI PoC에서 `pi-coding-agent` 기반 런타임의 예정 경계를 표시하기 위해 만든 placeholder입니다. 실제 backend 코드를 이 디렉터리에 추가하지 않습니다.

목표 npm workspace로 전환할 때 책임을 다음 패키지로 분리합니다.

- `packages/pi-runtime`: Pi UtilityProcess host, session, model role binding, tool policy, event adapter
- `packages/scenario-pipeline`: scan/closure/link/walk/coverage, artifact validator, completion gate
- `packages/test-runtime`: 사용자 trigger, immutable batch, target capability router, plan compiler/validator, TestVista adapter queue
- `packages/evidence-store`: masking, capture, hash, retention
- `packages/project-runtime/runtime-template`: generation과 execution-planning으로 분리된 하네스·스킬·agent resource의 원본
- `apps/desktop/src/main/app`: 생성과 수행 command를 묶는 논리적 통합 하네스 façade

통합 하네스 서버를 별도 상태 저장소나 세 번째 실행 프로세스로 만들지 않습니다. Electron Main의 Application Orchestrator가 `RuntimeStateCoordinator`의 single-writer 계약을 통해 Pi와 TestVista를 조율합니다.

관련 설계:

- `docs/pi-coding-agent 하네스 설계.md`
- `docs/architecture/03-integrated-harness-server-design.md`
- `docs/architecture/04-test-execution-harness-design.md`
- `docs/architecture/05-multi-target-execution-adapter-design.md`
- `docs/superpowers/specs/2026-08-25-scenarioforge-pi-runtime-test-execution-design.md`
