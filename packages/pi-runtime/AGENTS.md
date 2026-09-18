# pi-runtime

Pi UtilityProcess host, tool schema, model role binding, event adapter를 소유한다. 모델은 이 패키지가 노출한 tool 경계 밖으로 나갈 수 없다.

## Tool schema와 server-scoped 값

- tool 정의는 `tools/work-state-tools.ts`, `tools/artifact-query-tools.ts`, `tools/staging-tools.ts`에만 둔다. `tools/pi-tool-adapter.ts`를 우회하는 직접 호출 경로를 만들지 않는다.
- `projectId`, `sessionId`, `workId`는 server-scoped다. 모델 입력에서 받은 값으로 scope를 넓히지 않는다.
- 모델은 `work.getContext`로 시작한다. context 없이 mutate tool을 먼저 호출하는 흐름을 허용하지 않는다.
- `security/tool-policy.ts`와 `policies/harness-policy-registry.ts`가 허용 목록이다. 생성용 세션에 수행용 tool을 함께 노출하지 않는다.

## operationId는 서버가 생성한다

- `operationId`는 서버가 발급한다. 모델이 준 문자열을 그대로 재사용하면 서로 다른 작업이 같은 ID로 충돌한다.
- 모델이 `operationId`를 생략하거나 중복 값을 보내도 서버가 새 UUID를 부여하는 경로를 유지한다.
- 참고 이력: `docs/solutions/integration-issues/pi-model-operation-id-collision.md`

## Work context token/revision

- 모든 mutate tool은 `expectedRevision`과 `contextToken`을 함께 검증한다(`@scenarioforge/contracts`의 `revision`, `contextToken`).
- revision 불일치는 재시도가 아니라 stale context다. `work.getContext`로 다시 받아온다.
- revision 검사를 건너뛰는 편의 경로를 추가하지 않는다.

## Artifact submit·hash 검증

- `staging.writeJson`은 staging 경로와 `contentHash`를 반환한다. 이 반환값만으로 제출 성공을 판단하지 않는다.
- `work.submitArtifacts` 이후 backend 등록, work scope, path, hash가 모두 일치하는지 확인한다.
- `artifact.verify`를 통과하지 못한 artifact를 canonical로 승격하지 않는다.

## Provider retry 소유권

- retry는 runtime이 소유한다(`models/configured-model-runtime.ts`, `host/pi-sdk-driver.ts`). 모델이나 상위 orchestrator가 같은 호출을 중복 재시도하지 않는다.
- provider 오류(rate limit, timeout, 인증)와 artifact/schema 오류를 같은 실패로 취급하지 않는다.
- credential과 prompt 원문을 event나 로그로 내보내지 않는다. `event-adapter/pi-event-adapter.ts`에서 sanitize한다.

## 모델 응답 범위

- 모델 응답에 전체 runtime state를 반환하지 않는다. 해당 work에 필요한 최소 필드만 준다.
- `resources/pi-resource-loader.ts`는 generation과 execution 리소스를 분리해 로드한다. 두 도메인을 같은 세션에 함께 로드하지 않는다.

## 집중 테스트

```
npm run test --workspace @scenarioforge/pi-runtime
npm run typecheck --workspace @scenarioforge/pi-runtime
```
