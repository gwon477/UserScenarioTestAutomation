# test-runtime

시나리오 수행 계층이다. 검증된 시나리오 케이스를 받아 비전 실행 계획으로 컴파일하고, 모델 제안을 검사하고, 실제 입력과 판정 사이의 경계를 지킨다.

설계 정본은 `docs/architecture/04-test-execution-harness-design.md`(계약)와 `docs/architecture/07-vision-first-execution-design.md`(수행 방식)이다. 실측 근거는 `docs/validation/vision-execution-grounding/PROBE-20260907-01`이다.

## 생성 계층과의 경계

- `@scenarioforge/contracts`의 `ScenarioRecord`, `FactScreen`, `FactEdge`, `FactElement`를 **읽기만** 한다.
- canonical ID, evidence, `target_candidates`를 만들거나 바꾸지 않는다.
- 원본 소스를 읽지 않는다. 필요한 것은 FACT 레코드를 통해서만 얻는다.
- 사람이 읽는 `action`, `expected`, precondition 텍스트는 표시와 보고용이다. 실행 지시로 파싱하지 않는다.
- 생성 계층에 없는 필드가 필요하면 `packages/contracts` 계약 요청으로 올린다. 여기서 추론하거나 텍스트에서 뽑아내지 않는다.

## 좌표계 계약

`frame-coordinate-space.ts`가 유일한 변환 지점이다.

- 모델은 짧은 변을 `MODEL_FRAME_SHORT_SIDE`(768)로 맞춘 전처리 이미지 좌표계로 답한다.
- 전송 전 리사이즈, 수신 후 `toCaptureSpace` 환산을 건너뛰지 않는다. 이 변환을 빼면 좌표가 정확한 모델도 hit rate 0.07~0.21로 보인다.
- 배율은 프레임마다 계산한다. 상수로 하드코딩하지 않는다.
- 좌표는 canonical locator가 아니다. 프레임 fingerprint와 함께 관측으로만 저장한다.

## 컴파일러 규칙

`vision-step-compiler.ts`는 추측하지 않는다.

- `ACTION_KIND_MAP`에 없는 `action_kind`는 `ACTION_KIND_UNSUPPORTED`다. 유사 매핑을 임의로 추가하지 않는다.
- 화면에 보이는 라벨이 없으면 `NO_VISUAL_TARGET_EVIDENCE`다. `target_candidates`는 사후 대조용이며 대상을 찾는 근거가 아니다. 실측에서 `aria-label`만 있는 아이콘 버튼은 모델이 전부 «못 찾았다»고 답했다.
- 같은 화면에 같은 라벨이 여러 개이고 대조할 후보도 없으면 `AMBIGUOUS_VISUAL_TARGET`이다.
- 값이 필요한 step에 binding 참조 키가 없으면 `MISSING_DATA_BINDING`이다. 값을 만들어 넣지 않는다.
- `assertion_refs`가 빈 step은 컴파일하지 않는다.
- 한 step이 컴파일 불가여도 같은 시나리오의 나머지 step은 계속 컴파일한다.

## Proposal Gate 규칙

`proposal-gate.ts`는 코드이며 LLM이 아니다.

- `confidence`는 하한 검사에만 쓴다. 실측에서 hit과 miss 모두 0.94~0.99였으므로 판별 근거로 쓰지 않는다.
- `observedLabel` 대조는 항상 한다. 정규화는 글자와 숫자만 남기고, 포함 관계는 일치 비율 0.6 이상일 때만 인정한다. 짧은 조각은 대상을 특정하지 못한다.
- `labelUniqueOnSurface`가 `false`면 후보 대조가 성공해야 통과한다(`TARGET_NOT_DISAMBIGUATED`).
- `verifyCandidate`의 `null`은 보조 제어면 조회 불가이며 실패가 아니다. `false`만 거부한다.
- 파괴적 step은 target profile이 명시적으로 허용해야 통과한다.
- 화면 텍스트가 지시문 형태이면 거부가 아니라 `aborted`다. 계속 진행하지 않는다.
- gate가 거부한 제안은 실행하지 않는다. 예산이 남았을 때만 재관측한다.

## 실행 루프 규칙

`step-runner.ts`가 캡처 -> 제안 -> gate -> 조작 -> 관측 -> 판정을 한 step 단위로 돈다.

- 실제 화면과 모델은 port 로 주입한다. 이 파일에 Electron 도 HTTP 도 넣지 않는다. 그래야 모든 분기를 fake 로 검사할 수 있다.
- 마스킹 실패는 전송 생략이 아니라 중단이다. `maskFrame` 이 `null` 을 반환하면 모델 호출 없이 `FRAME_MASKING_FAILED` 로 끝난다.
- 조작은 gate 통과 후 한 번만 한다. 조작이 예외를 던지면 부작용이 남았는지 알 수 없으므로 재시도하지 않고 `ACTION_OUTCOME_UNKNOWN` 으로 닫는다.
- 모델이 «못 찾았다»고 답한 것은 실패가 아니라 `TARGET_NOT_FOUND` 다. 예산이 남았으면 재관측한다.
- 원문 값은 `resolveValue` 로만 얻고 결과·기록에 담지 않는다.
- 화면 전이 확인은 조작 후 2회 관측이다. 한 번만 보고 확정하지 않는다.

## 판정 규칙

`assertion-engine.ts` 만 verdict 를 만든다. 모델 응답은 관측 후보다.

- `assertion_refs` 에는 `edge.feedback` ID 와 도착 화면 ID 가 섞여 들어온다(`scenario-pipeline/src/graph/graph-tools.ts` 가 그렇게 만든다). 두 종류를 모두 해석한다.
- 스크린샷으로 관측할 수 없는 assertion kind 는 `unsupported` 이고 결과는 `INCONCLUSIVE` 다. 통과로 올리지 않는다.
- 화면 전이는 연속 두 관측에서 앵커가 보여야 `PASSED` 다. 엇갈리면 `INCONCLUSIVE` 다.
- 증명된 불일치는 다른 항목이 판정 불가여도 `FAILED` 로 보고한다. 판정 불가만 있으면 절대 `PASSED` 가 아니다.

## TestCoordinator 규칙

`coordination/test-coordinator.ts`가 실행 명령을 받아 immutable batch 를 만든다.

- `executionId`, `batchId`, 멱등성은 coordinator 소유다. renderer 도 main 도 ID 를 만들지 않는다.
- 멱등 키는 `operationId` 다. 같은 payload 재전송은 기존 batch 를 돌려주고, 같은 키에 다른 payload 는 `OPERATION_ID_REUSED_WITH_DIFFERENT_PAYLOAD` 로 거절한다.
- operation 기록은 batch artifact 가 durable 하게 쓰인 **뒤에** 남긴다. 순서를 바꾸면 중간 실패가 유령 실행을 만든다.
- 실행 산출물은 `.scenarioforge/runs/{runId}/tests/` 하위 트리에만 쓴다. 생성 트랙의 manifest, journal, artifact 는 읽지도 쓰지도 않는다.
- 경로는 `coordination/execution-paths.ts`로만 만든다. run ID, execution ID, batch ID 는 안전한 segment 인지 검사한 뒤 사용한다.
- `data-binding-manifest.json` 에는 key 와 secret 여부만 쓴다. 원문 값은 coordinator 에 넘기지 않는다.

## 실행 명령 규칙

`createExecution` 외 세 명령도 coordinator 소유다.

- `enqueueScenarios` 는 기존 snapshot 과 plan 을 **수정하지 않고** 새 batch 를 append 한다. 같은 `targetProfileHash` 만 허용하고, 이미 담긴 시나리오는 `SCENARIO_ALREADY_IN_EXECUTION` 으로 거절한다. 결과가 확정된 execution 에는 추가하지 않는다.
- `retryCases` 는 언제나 새 execution 을 만들고 `retryOfExecutionId` 로 원본을 참조한다. 기존 결과와 증적을 덮어쓰지 않는다.
- `cancelExecution` 은 `cancel-request.json` 을 durable 하게 남긴다. 이미 저장된 결과와 증적은 지우지 않는다. 실행 중 중단은 executor 가 step 사이에서 `isCancelled` 로 확인한다.
- `writeBatch` 는 이미 존재하는 batch 디렉터리에 다시 쓰지 않는다(`BATCH_ALREADY_EXISTS`). queue 에 들어간 batch 는 불변이다.

## 실행 순차 규칙

`coordination/batch-executor.ts`가 batch 를 순차 실행한다. port 만 받고 화면·모델·파일 시스템을 직접 다루지 않는다.

- assertion 불일치는 케이스 실패다. 그 케이스의 남은 step 은 `SKIPPED` 로 두고 **다음 케이스는 계속한다**.
- 마스킹 실패와 화면 텍스트 지시 감지는 실행 전체를 `ABORTED` 로 즉시 끝낸다. 남은 케이스는 수행하지 않는다.
- 사용자 중단은 step 사이에서만 확인한다. 조작 도중에 끊지 않는다.
- 이미 수행한 step 의 증적은 중단·실패 뒤에도 남긴다.

## 증적 기록 규칙

`step-evidence.ts`가 durable 기록을 만든다. 프레임 저장은 `recordFrame` port 를 통해 호출자가 한다. 이 패키지에 파일 시스템을 넣지 않는다.

- 비전 경로의 판정 근거는 원본 화면이 아니라 **모델에 전송된 프레임**(`kind: "model-input"`)이다. 원본만 남기면 판정을 재구성할 수 없다.
- `frameSpace` 의 캡처·전송 크기와 배율을 반드시 남긴다. 없으면 증적이 재현 불가다.
- 제안 좌표는 두 좌표계 모두 남긴다. `modelPoint` 는 전송 프레임 기준, `capturePoint` 는 실제 입력 기준이다.
- `maskedRegions` 는 표시용이다. 없으면 검은 사각형이 렌더링 오류로 읽힌다.
- 원문 데이터 값은 기록하지 않는다. 소비한 `valueRef` 만 남긴다.

## 사람 검토 규칙

`coordination/review-store.ts`가 검토 기록을 담당한다.

- **결정론적 verdict 를 덮어쓰지 않는다.** verdict 는 backend 소유이고 검토는 덧붙는 레이어다. 그래서 증적과 같은 디렉터리의 별도 `reviews.json` 에 append 만 한다.
- 기존 기록을 지우거나 고치지 않는다.
- `decision` 과 `causeTag` 는 정해진 값만 받는다. 모르는 값을 저장하지 않는다.
- `author` 는 필수다. 귀속되지 않는 기록은 남기지 않는다.
- 손상된 ledger 는 조용히 빈 목록으로 만들지 않고 `REVIEW_LEDGER_INVALID` 로 실패한다. 기록을 잃는 것보다 실패가 낫다.
- `causeTag` 는 실측에서 확인된 실패 유형에서 왔다. 태그별 집계가 생성 트랙에 올릴 계약 요청의 신호다.

## 실측 회귀 테스트

`proposal-gate-replay.test.ts`는 `docs/validation/vision-execution-grounding/PROBE-20260907-02`의 기록된 모델 응답 64건을 실제 gate에 재생하고 결과를 고정한다. 이 테스트의 기대값을 바꾸려면 왜 gate 판정이 달라져야 하는지 먼저 설명해야 한다. 숫자만 맞추지 않는다.

## 집중 테스트

```
npm run test --workspace @scenarioforge/test-runtime
npm run typecheck --workspace @scenarioforge/test-runtime
```

실제 앱 왕복은 `docs/validation/vision-execution-round-trip/PROBE-20260907-03/run-live.sh` 로 돌린다. `LIVE_RUN_FAKE_MODEL=1` 이면 모델 없이 어댑터만 자체 점검한다.
