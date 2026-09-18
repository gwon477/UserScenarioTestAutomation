# 비전 step 왕복 실측 PROBE-20260907-03

- 실행일: 2026-09-07
- 설계 근거: [`../../../architecture/07-vision-first-execution-design.md`](../../../architecture/07-vision-first-execution-design.md) §4 · §5 · §6 · §11 단계 2~4
- 선행 실측: [`../../vision-execution-grounding/PROBE-20260907-02/README.md`](../../vision-execution-grounding/PROBE-20260907-02/README.md)
- 대상: `test_project_source/axse-agents` 로그인 여정 3 step
- harness: [`../harness`](../harness) (RA-DAR와 공유)
- 같은 harness의 RA-DAR 결과: [`../PROBE-20260907-04/README.md`](../PROBE-20260907-04/README.md)
- 상태: **실제 모델 왕복 완료**

## 무엇을 실행했는가

`ScenarioRecord` + FACT 픽스처에서 시작해 실제 화면 조작과 판정까지 한 번에 돌렸다.

```text
ScenarioRecord(3 steps) + FactScreen/FactEdge
  -> compileVisionSteps        3 envelopes, non-automatable 0
  -> 캡처(마스크 적용) -> 리사이즈(1229x768)
  -> operator 제안 -> evaluateProposal -> 캡처 좌표 환산
  -> sendInputEvent / insertText 로 실제 입력 합성
  -> 조작 후 2회 관측 -> evaluateAssertions
  -> step verdict -> case verdict
```

시나리오는 AXSE 로그인이다. 아이디 입력, 패스워드 입력, 로그인 버튼 클릭 세 step이고 `assertion_refs`는 도착 화면 ID다(`graph-tools.ts`가 만드는 형태와 같다).

## 결과: 어댑터 자체 점검

`LIVE_RUN_FAKE_MODEL=1`로 operator·observer만 DOM에서 값을 읽는 가짜로 바꿔 돌렸다. **모델 성능 측정이 아니고**, 컴파일러·gate·입력 합성·관측·판정이 실제 앱에서 이어지는지 보는 점검이다.

| step | 의도 | 대상 | gate | 환산 좌표 | assertion | verdict |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | fill | 아이디 | accepted | 721, 441 | `SCR-LOGIN` | PASSED |
| 2 | fill | 패스워드 | accepted | 721, 504 | `SCR-LOGIN` | PASSED |
| 3 | press | 로그인 | accepted | 721, 565 | `SCR-PROJECT` | PASSED |

case verdict **PASSED**, 3/3 step 실행.

환산 좌표가 PROBE-02의 ground truth 중심(720/441, 720/504, 720/565)과 1px 안에서 일치한다. 좌표계 환산이 실행 경로에서도 맞는다는 뜻이다.

실제로 로그인이 수행되어 화면이 프로젝트 선택으로 전이됐고, `SCR-PROJECT` 앵커 「프로젝트 선택」이 연속 두 관측에서 확인됐다. DOM `.click()`이 아니라 `sendInputEvent`와 `insertText`로 입력을 합성했다.

## 마스킹 확인

`masked-frame.png`는 패스워드에 `MASK-PROBE-MARKER`를 넣은 상태로 마스크를 적용해 캡처한 1229x768 프레임이다. 패스워드 입력 영역이 완전히 가려져 있다. 모델에 전송되는 프레임이 바로 이 형태다.

마스킹은 캡처 직전 페이지에 오버레이를 덮는 방식이다. 선언된 선택자 중 하나라도 덮이지 않으면 `maskFrame`이 `null`을 반환하고 실행이 `FRAME_MASKING_FAILED`로 중단된다. 프레임을 그대로 보내는 경로는 없다.

## 결과: 실제 모델 왕복 (`live-step-run.json`)

operator와 observer를 실제 `gpt-5.6-luna`로 돌렸다. 모델 호출 9회(operator 3, observer 6)이고 캐시된 자격증명을 썼다.

| step | 의도 | 대상 | operator 응답 | gate | 환산 좌표 | assertion | verdict |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | fill | 아이디 | found, `아이디`, 0.99 | accepted | 719, 441 | `SCR-LOGIN` | PASSED |
| 2 | fill | 패스워드 | found, `패스워드`, 0.99 | accepted | 719, 504 | `SCR-LOGIN` | PASSED |
| 3 | press | 로그인 | found, `로그인`, 0.99 | accepted | 719, 565 | `SCR-PROJECT` | PASSED |

case verdict **PASSED**, 3/3 step 실행. 세 step 모두 재시도 없이 첫 제안이 gate를 통과했다. 환산 좌표는 ground truth 중심(720/441, 720/504, 720/565)에서 1px 안이다.

실제로 로그인이 수행됐고 observer가 전이 후 두 관측에서 「프로젝트 선택」을 읽었다.

## 증적 기록 (`evidence/`)

실행 루프가 step 마다 프레임과 구조화 기록을 남긴다. 배치는 `evidence/{executionId}/{scenarioId}-step-{n}/`이다.

```text
SCN-AXSE-0001-step-3/
├── evidence.json
└── frames/
    ├── 01-model-input-1.png     <- 모델에 전송된 프레임. 판정 근거
    ├── 02-after-action-1.png
    └── 03-after-action-2.png
```

`01-model-input-1.png`은 1229x768이고 패스워드 입력이 검게 가려져 있다. 모델이 실제로 본 프레임이 그대로 남는다.

`evidence.json`의 step 3 기록에서 확인되는 것:

| 항목 | 값 |
| --- | --- |
| `frameSpace` | 캡처 1440x900, 전송 1229x768, 배율 0.8533 |
| `proposal.modelPoint` | 614, 482 (전송 프레임 좌표) |
| `proposal.capturePoint` | 719, 565 (환산된 실제 클릭 좌표) |
| `proposal.observedLabel` | 「로그인」 |
| `maskedRegions` | `#lf-password` |
| `assertions` | `SCR-PROJECT` PASSED 「프로젝트 선택」 |
| `observations` | 2 |

두 좌표계와 배율이 모두 남으므로 증적이 재현 가능하다. 원문 데이터 값은 어디에도 없고 소비한 binding key 만 남는다.

## observer 음성 대조 (`observer-negative-control.json`)

observer가 질문을 되뇌면 assertion 판정 전체가 무의미해진다. 로그인 화면 한 프레임에 대해 네 가지를 물었다.

| 질문 | 응답 | 판정 |
| --- | --- | --- |
| `로그인` (실제로 보임) | `["로그인"]` | OK |
| `프로젝트 선택` (다음 화면 앵커) | `[]` | OK |
| `결제 승인 완료` (없는 문구) | `[]` | OK |
| 위 셋을 함께 | `["로그인"]` | OK |

되뇌지 않는다. 다음 화면 앵커도, 지어낸 문구도 거부했다. 왕복 실행의 `PASSED`가 관측에 근거한 것임을 뒷받침한다.

## 음성 경로 (`live-step-run-negative.json`)

`FAILED`가 실제로 도달 가능한지 확인했다. 마지막 step의 도착 화면만 실제로 나타나지 않는 화면(`SCR-NEVER`, 앵커 「결제 승인 완료」)으로 바꾸고 같은 실행을 돌렸다.

| step | gate | 좌표 | assertion | verdict |
| --- | --- | --- | --- | --- |
| 1~2 | accepted | 719, 441 / 719, 504 | `SCR-LOGIN` | PASSED |
| 3 | accepted | 719, 565 | `SCR-NEVER` | **FAILED** (screen anchor not observed) |

case verdict **FAILED**. 조작은 성공했고 gate도 통과했지만 업무 결과 assertion이 관측되지 않아 실패로 판정됐다. 「동작 성공」이 「업무 결과 성공」으로 오판되지 않는다는 설계 §6 규칙이 실제 실행에서 확인됐다.

## 한계

- 백엔드는 stub이다. 로그인 응답은 고정 토큰이다.
- 3 step 한 시나리오다. segment 경계, drift 차단, replay fast path는 실행하지 않았다.
- `INCONCLUSIVE` 경로는 실제 모델로 재현하지 않았다. fake port 로만 검사했다(예산 소진, 대상 미발견, 조작 결과 불명).
- 세 step 모두 첫 제안이 통과했으므로 실제 모델에서의 gate 거절 후 재시도 경로는 실행되지 않았다.
- FACT·시나리오 픽스처는 실제 화면 구조에서 옮겨 적은 것이며 생성 파이프라인이 만든 산출물이 아니다. 생성 트랙이 같은 형태를 내보내는지는 별개 확인 대상이다.
- `ts-resolve-hook.mjs`는 harness 편의다. 저장소 TS 모듈이 형제를 `.js`로 import해 Electron이 해석하지 못하는 것을 실행 시점에 보정한다. 제품 코드 경로가 아니다.

## 재실행

```sh
cd ../harness
bash run-live.sh axse                          # 실제 모델 왕복
LIVE_RUN_FAKE_MODEL=1 bash run-live.sh axse    # 모델 없이 어댑터만 자체 점검
LIVE_RUN_NEGATIVE=1 bash run-live.sh axse      # 도착 화면을 나타나지 않는 화면으로 바꿔 FAILED 확인
```

자격증명은 `SCENARIOFORGE_PROBE_MODEL_KEY`가 있으면 그것을 쓰고, 없으면 Electron `safeStorage` 캐시에서 읽는다. 어느 경로든 값을 파일·로그·결과에 남기지 않는다.

프로젝트별 FACT·시나리오 픽스처는 `../harness/fixture-axse.mjs`와 `../harness/fixture-radar.mjs`에 있다. 러너는 두 프로젝트에 대해 같은 코드다.

RA-DAR 실행에서 발견된 「데이터를 늦게 채우는 화면을 불안정으로 오판」하는 결함을 고친 뒤 이 AXSE 결과를 다시 확인했다. 세 모드 모두 같은 판정이 재현된다.

## 결정론적 부분의 테스트

이 실행이 지나간 코드는 `packages/test-runtime`에 있고 51개 테스트가 분기를 고정한다.

- `frame-coordinate-space.test.ts` 5건: 좌표계 환산
- `vision-step-compiler.test.ts` 9건: 컴파일과 `NON_AUTOMATABLE` 7종
- `proposal-gate.test.ts` 14건: gate 규칙
- `proposal-gate-replay.test.ts` 4건: PROBE-02 실측 응답 64건 재생
- `assertion-engine.test.ts` 9건: 판정 규칙
- `step-runner.test.ts` 10건: 루프 분기(마스킹 실패 중단, injection 중단, 예산 소진, 결과 불명 재시도 금지, 값 미노출)
