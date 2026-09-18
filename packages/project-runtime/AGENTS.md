# project-runtime

사용자 프로젝트에 설치되는 runtime 산출물과 `.scenarioforge` 경로 정책을 소유한다.

## runtime-template 관리 규칙

- `runtime-template/`은 사용자 프로젝트로 복사되는 **원본**이다. 제품 에이전트 리소스는 여기서만 수정한다.
- 대상 프로젝트에 이미 생성된 `.scenarioforge/runtime/`을 직접 고쳐 문제를 넘기지 않는다. 원본을 고치고 다시 bootstrap한다.
- `runtime-template` 안에 `CLAUDE.md`를 추가하지 않는다. 이 디렉터리는 사용자 프로젝트로 배포되며, 저장소 개발용 지침이 함께 나가면 안 된다.
- `runtime-template/AGENTS.md`, `SYSTEM.md`, `WORK_PROTOCOL.md`는 제품 문서다. 저장소 루트의 개발용 `AGENTS.md`와 혼동하지 않는다.
- `resource-declaration.json`과 실제 파일 목록을 함께 갱신한다. 선언에 없는 리소스는 로드되지 않는다.
- generation과 execution 리소스를 같은 harness 선언에 합치지 않는다.
- template 변경 시 `apps/desktop/src/main/runtime-template-bundle.test.ts`가 번들 목록을 검증하므로 함께 확인한다.

## Path policy

- `.scenarioforge` 하위 경로는 `src/path-policy/project-path-policy.ts`로만 계산한다. 문자열 결합으로 경로를 만들지 않는다.
- staging(`.scenarioforge/staging/<workId>`)과 canonical state(`.scenarioforge/state`)를 구분한다. staging 쓰기를 canonical 반영으로 취급하지 않는다.
- project root 밖으로 나가는 경로는 `ProjectPathPolicyError`로 거부한다. 이 검사를 우회하는 경로를 추가하지 않는다.
- `src/manifest/runtime-manifest.ts`와 `src/bootstrap/project-bootstrapper.ts`는 멱등해야 한다. 재실행이 사용자 산출물을 파괴하지 않아야 한다.

## 집중 테스트

```
npm run test --workspace @scenarioforge/project-runtime
npm run test --workspace @scenarioforge/desktop -- runtime-template-bundle
```
