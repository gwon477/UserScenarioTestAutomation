# RA-DAR 비전 step 왕복 실측 PROBE-20260907-04

- 실행일: 2026-09-07
- 설계 근거: [`../../../architecture/07-vision-first-execution-design.md`](../../../architecture/07-vision-first-execution-design.md) §4 · §5 · §6
- 동일 harness의 AXSE 결과: [`../PROBE-20260907-03/README.md`](../PROBE-20260907-03/README.md)
- 대상: `/Users/a11769/Desktop/RA-DAR` FrontEnd
- 상태: **실제 모델 왕복 완료**

## 시나리오

RA-DAR는 로그인 카드가 랜딩 deck의 s10 장면에 있고 평가용 사번이 미리 입력되어 있다. 따라서 입력 step 없이 두 step이다.

| step | 의도 | 대상 | 도착 | assertion 앵커 |
| --- | --- | --- | --- | --- |
| 1 | press | 바로 시작하기 | `SCR-LOGIN` | 담당자 로그인 |
| 2 | press | 사번으로 인증하고 시작 | `SCR-DASHBOARD` | 새로 생성된 대조 조항 |
| 3 | navigate | 누적 관리 | `SCR-LEDGER` | 전체 규정 개정 이력 |

초기 픽스처는 로그인 장면까지 스크롤하는 것을 환경 준비로 다뤘다. **이는 잘못된 판단이었다.** 랜딩 첫 화면에 「바로 시작하기」 버튼이 있고, 그 버튼이 `onJump(SCENES.length - 1)`로 로그인 장면으로 이동시킨다(`ProblemScenes.tsx`, 주석에 "소개를 건너뛰고 «시작하는 자리»로 바로 간다"). 즉 스크롤은 환경 준비가 아니라 **사용자 동작**이고 시나리오 step 이어야 한다.

픽스처를 랜딩 첫 화면에서 시작하도록 고쳤고, 진입 준비는 URL 로드까지로 줄었다. 이 판단은 AGENTS.md 의 complete user journey invariant 와도 맞는다. 여정은 가장 이른 사용자 진입점에서 시작해야 한다.

## 결과

| 모드 | step 1 | step 2 | case |
| --- | --- | --- | --- |
| 어댑터 자체 점검 (DOM 모델) | PASSED, 1037/568 | PASSED, 246/26 | **PASSED** |
| 실제 모델 (`gpt-5.6-luna`) | PASSED, 1037/572 | PASSED, 257/26 | **PASSED** |
| 음성 assertion | PASSED, 1037/573 | FAILED (`SCR-NEVER`) | **FAILED** |

두 step 모두 첫 제안이 gate를 통과했다. 실제 모델과 DOM 기준 좌표의 차이는 x 0~11px, y 0~4px다.

`누적 관리`는 상단 내비게이션에 있고 본문에는 `누적 관리 열기`가 따로 있다. 정규화 후 서로 다른 문자열이므로 `labelUniqueOnSurface`가 참이고, 모델도 상단 항목을 지목했다.

## 이 실행이 찾아낸 설계 결함

첫 실제 모델 실행은 step 1에서 **`INCONCLUSIVE`**로 끝났다. 사유는 `screen anchor unstable`이었다.

```text
observer 1회차: []                        <- 대시보드가 데이터를 아직 채우지 않음
observer 2회차: ["새로 생성된 대조 조항"]
```

설계 §6의 「화면 전이는 연속 두 관측에서 확인해야 통과」를 **처음 두 장에만** 적용하면, 데이터를 늦게 채우는 화면의 정상적인 부재 → 존재 전이가 「불안정」으로 오판된다.

`anchor-stability.json`으로 화면 자체는 문제가 없음을 확인했다. 클릭 직후부터 1.2초 간격 6회 동안 앵커가 같은 위치(`x 28, y 195, 1004x21`)에 계속 존재하고 스크롤도 움직이지 않았다.

수정: `step-runner.ts`가 `maxScreenshots` 안에서 판정이 확정될 때까지 다시 관측한다. 확정된 `PASSED`/`FAILED`는 즉시 멈추고, `INCONCLUSIVE`만 예산 안에서 재관측한다. 부재 → 존재 → 존재는 통과이고, 부재 → 존재 → 부재는 여전히 `INCONCLUSIVE`다. 두 경우 모두 `step-runner.test.ts`에 회귀 테스트로 고정했다.

수정 후 같은 실행이 `PASSED`가 됐고, 음성 경로에서도 step 1이 `[부재, 존재, 존재]`로 통과한 뒤 step 2가 의도대로 `FAILED`가 됐다.

## observer 앵커 신뢰도 (`observer-anchor-reliability.json`)

로그인 후 3초 settle한 대시보드 프레임 한 장에 대해 앵커 후보 6개를 각 3회 물었다. 화면이 고정된 상태이므로 응답 차이는 전부 observer 변동이다.

| 앵커 | DOM 존재 | observer 3회 |
| --- | --- | --- |
| 새로 생성된 대조 조항 | 있음 | 3/3 |
| RADAR 야간 작업 보고 | 있음 | 3/3 |
| 규제 대응 자산 | 있음 | 3/3 |
| AI 작업 결과 | 있음 | 3/3 |
| 직접 확인 필요 | 있음 | 3/3 |
| 품목 허가 취소 완료 | 없음 | 0/3 |

18/18 모두 DOM과 일치했다. 없는 문구를 지어내지도 않았다. settle된 프레임에서 observer는 신뢰할 수 있다.

## 설명하지 못한 관측 1건

수정 이전 음성 실행 한 번에서 step 1의 관측이 `[존재, 부재, 부재]`로 나와 `FAILED`가 됐다. 로딩이라면 부재 → 존재여야 하는데 반대 방향이다. 화면 안정성 검사와 앵커 신뢰도 측정은 모두 정상이었고, 이후 재실행에서 재현되지 않았다. 원인을 확정하지 못했으므로 열린 항목으로 남긴다. 다음 실행에서 재현되면 관측 프레임을 저장해 진단해야 한다.

이 사건이 잘못된 `PASSED`를 만들지 않았다는 점은 확인했다. 불확실한 관측은 통과가 아니라 실패 또는 판정 불가로 떨어졌다.

## 한계

- 백엔드는 stub이다. `radar-stub-api.mjs`가 `/api/v1/radar` DTO를 대신 응답한다. 실제 Postgres 백엔드가 아니다.
- 2 step 한 시나리오다. 케이스 상세 시트, 등급 확정, CSV 내보내기는 실행하지 않았다.
- FACT·`ScenarioRecord` 픽스처는 실제 화면 구조에서 옮겨 적은 것이며 생성 파이프라인 산출물이 아니다.
- 사번과 비밀번호가 모두 `password` 타입으로 렌더링되어 둘 다 마스킹한다. 마스킹 실패 시 중단은 AXSE에서 확인했다.
- `INCONCLUSIVE` 경로(예산 소진, 대상 미발견, 조작 결과 불명)는 실제 모델로 재현하지 않았다.

## 제품 경로 실행 (`live-execution-run.json`)

harness 고유 로직을 걷어내고 제품 모듈로 실행했다.

```text
TestCoordinator.createExecution  -> batch artifact
  -> runQueuedExecution          -> 격리 session BrowserWindow + 실제 모델
  -> executeBatch                -> ExecutionWriter (정본 실행 트리)
```

결과: `runtimeStatus COMPLETED`, `{PASSED: 3}`. 랜딩 첫 화면에서 시작해 원장까지 3 step 이 모두 통과했다.

step 1 증적에서 확인되는 것:

| 항목 | 값 |
| --- | --- |
| 대상 | 「바로 시작하기」 button |
| `proposal.modelPoint` | 146, 478 (버튼 정중앙) |
| `proposal.capturePoint` | 171, 560 |
| `assertions` | `SCR-LOGIN` PASSED 「담당자 로그인」 |
| 관측 회차 | 3 |

관측이 3회 들어간 것은 scroll-snap 애니메이션 때문이다. 「확정될 때까지 재관측」 규칙(§ PROBE-04 에서 고친 부분)이 이를 처리했다.

## 재실행

```sh
cd ../harness
bash run-live.sh radar                          # 실제 모델 왕복
LIVE_RUN_FAKE_MODEL=1 bash run-live.sh radar    # 모델 없이 어댑터 자체 점검
LIVE_RUN_NEGATIVE=1 bash run-live.sh radar      # FAILED 도달 확인
```
