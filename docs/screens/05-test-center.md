# 화면 05 — 테스트 센터

## 진입 규칙

- `test.batch.queued` domain event를 받은 뒤에만 진입한다. CTA를 누른 시점에 진입하지 않는다.
- Renderer는 execution 객체를 조립하지 않는다. 상태는 snapshot hydration과 event replay로만 만든다.
- route 이동과 앱 재시작 뒤에도 같은 `executionId`로 복구한다. Runner lifecycle은 route와 독립이다.
- 시나리오 화면에서 실행 중 execution이 있으면 헤더에 상태 칩을 상시 표시하고 그 칩으로 센터에 진입할 수 있게 한다. 사용자가 다른 화면을 보는 동안 실행이 진행 중인지 알 수 없어서는 안 된다.

## 정보 구조

3열 구성이다.

| 열 | 역할 |
| --- | --- |
| 좌 | 실행 이력. 현재 실행과 과거 실행을 같은 목록에서 선택 |
| 중 | 수행 대기열. 케이스 순서와 step 진행 |
| 우 | 최근 화면. 선택 케이스의 최신 증적 미리보기 |

상단 헤더에는 진행률, 결과 요약(성공·실패·확인 필요·미수행), 실행 명령을 둔다. 케이스와 step이 위에서 아래로 순차 수행된다는 계약을 화면에 명시한다.

## 판정 표시

판정은 다섯 값이다. 색상만으로 구분하지 않고 아이콘과 텍스트를 함께 쓴다. `대기`와 `확인 필요`에 같은 글리프를 쓰지 않는다.

| 판정 | 라벨 | 의미 |
| --- | --- | --- |
| `PASSED` | 성공 | assertion이 관측됐다 |
| `FAILED` | 실패 | 기대와 다른 것이 관측됐다. 테스트 결과다 |
| `INCONCLUSIVE` | 확인 필요 | 판정할 수 없었다. 실패가 아니다 |
| `SKIPPED` | 건너뜀 | 정책이나 선행 실패로 수행하지 않았다 |
| `CANCELLED` | 중단 | 사용자가 멈췄다 |

## 확인 필요와 거절 사유를 반드시 표시한다

`확인 필요`만 표시하고 사유를 감추면 사용자가 할 수 있는 일이 없다. 비전 경로에서 이 사유가 가장 행동 가능한 정보다. `StepOutcome.reason`과 `GateDecision`을 아래 표대로 옮긴다.

| 코드 | 표시 | 사용자가 할 일 |
| --- | --- | --- |
| `TARGET_NOT_FOUND` | 화면에서 대상을 찾지 못함 | 앵커·라벨이 화면에 보이는지 확인. 생성 트랙에 라벨 보완 요청 |
| `BUDGET_EXHAUSTED` | 관측 예산 소진 | 예산을 늘리거나 화면 응답 지연 원인 확인 |
| `ACTION_OUTCOME_UNKNOWN` | 조작 결과 확인 불가 | 부작용 여부를 사람이 확인. 자동 재시도하지 않는다 |
| `GATE_REJECTED · OBSERVED_LABEL_MISMATCH` | 읽은 라벨이 대상과 다름 | 모델이 다른 컨트롤을 지목했다 |
| `GATE_REJECTED · TARGET_NOT_DISAMBIGUATED` | 대상을 구별하지 못함 | 같은 라벨이 여럿이다 |
| `GATE_REJECTED · LOCUS_OUT_OF_BOUNDS` | 화면 밖 좌표 | 프레임 범위 밖 제안 |
| `GATE_REJECTED · CONFIDENCE_BELOW_THRESHOLD` | 신뢰도 미달 | riskClass 하한 미달 |
| `GATE_REJECTED · DESTRUCTIVE_ACTION_NOT_PERMITTED` | 파괴적 동작 미허용 | 설정에서 명시적으로 허용해야 한다 |
| `GATE_REJECTED · CANDIDATE_VERIFICATION_FAILED` | 대조 실패 | 좌표의 요소가 후보와 다르다 |
| `GATE_REJECTED · ACTION_NOT_ALLOWED` | 허용되지 않은 동작 | 화이트리스트 밖 |
| `FRAME_MASKING_FAILED` | 마스킹 실패로 중단 | 마스킹 대상 선택자를 확인. 프레임은 전송되지 않았다 |
| `SCREEN_TEXT_INSTRUCTION_DETECTED` | 화면 텍스트의 지시 시도 감지 | 보안 사건이다. 대상 화면을 확인 |

assertion 결과도 사유를 함께 쓴다.

| 결과 | 표시 |
| --- | --- |
| screen anchor not observed | 기대 화면이 관측되지 않음 |
| screen anchor unstable | 화면 관측이 안정되지 않음 |
| expected text not observed | 기대 문구가 관측되지 않음 |
| unsupported | 화면만으로는 판정할 수 없는 assertion |

## step 행에 함께 표시하는 실행 경로

step마다 다음을 표시한다. 없으면 사용자가 왜 그렇게 판정됐는지 재구성할 수 없다.

- 사용한 target과 adapter, semantic 경로인지 visual 경로인지
- fallback 사용 여부와 사용 원인
- 제안·거절 재시도 횟수와 마지막 gate 판정
- resource lease, 사람 개입 필요, `POLICY_BLOCKED` 여부

GUI 모델의 자연어 성공 서술은 사용자에게 최종 verdict로 표시하지 않는다. 모델 응답은 관측 후보이고 verdict는 assertion engine의 결과다.

## 실행 명령

| 명령 | 표시 조건 | 결과 |
| --- | --- | --- |
| `대기열에 N개 추가` | 활성 execution이 있고 같은 target profile | 새 immutable batch를 뒤에 append. 기존 snapshot/plan은 바뀌지 않는다 |
| `실행 중단` | 현재 execution이 `QUEUED/PREPARING/RUNNING` | 현재 동작을 안전 종료하고 미수행 항목을 `CANCELLED`로 기록 |
| `선택한 케이스 재시도` | 완료된 execution에 실패·확인 필요·미수행 케이스가 있을 때 | 선택한 케이스만 새 execution으로. `retryOfExecutionId`로 연결 |
| `동일 조건 전체 재시도` | 완료된 execution | 전체를 새 execution으로 |

성공한 케이스까지 다시 도는 전체 재시도를 유일한 재시도 수단으로 두지 않는다. 긴 여정에서는 실패한 것만 다시 도는 것이 기본이다.

### 구현 상태

- 네 명령 모두 `TestCoordinator` 와 IPC 채널이 있다.
- `대기열 실행`, `실행 중단`, `실패·미판정 N개 재시도`, `동일 조건 전체 재시도` 버튼이 있다.
- 활성 실행이 있으면 시나리오 시트의 CTA 가 `대기열에 N개 추가` 로 바뀌고 대상 진입 URL 은 읽기 전용이 된다.
- step 행에서 판단만 남기는 빠른 검토를 제공한다. 메모가 필요하면 증적 상세 스레드를 쓴다.

## 중단 확인

중단은 되돌릴 수 없으므로 modal 확인을 쓴다. 지켜야 할 것:

- 버튼은 결과를 이름으로 말한다. `계속 수행` / `실행 중단`. `확인` / `취소`를 쓰지 않는다.
- 안전한 선택에 기본 포커스를 둔다. Esc는 항상 취소다.
- 중단하면 무엇이 어떻게 되는지 미리 보여준다. 저장된 화면 수와 남은 케이스 수.
- 이미 저장된 artifact와 증적은 지우지 않는다는 것을 명시한다.

## 실패와 중단의 구분

한 enum으로 섞지 않는다.

- assertion 불일치 → 케이스 `FAILED`. 다음 케이스는 계속한다.
- 환경·adapter 문제 → 케이스 `INCONCLUSIVE`. 복구 후 계속한다.
- 사용자 중단 → execution `CANCELLED`. 수집 증적은 보존한다.
- 마스킹·증적·Runner 무결성 실패 → execution `ABORTED`. 즉시 중단하고 증적은 보존한다.

## 진입 준비와 사용자 동작의 구분

대상 화면에 도달하기 위한 조작이 필요할 때, 그것이 환경 준비인지 사용자 동작인지 먼저 가른다.

- **환경 준비**: 진입 URL 로드, 화면이 그려질 때까지 대기, 격리 session 확보. 실행기가 한다.
- **사용자 동작**: 화면에 보이는 버튼이나 링크를 누르는 것. **시나리오 step 이다.**

RA-DAR 랜딩은 로그인 카드가 마지막 장면에 있지만 첫 화면의 「바로 시작하기」가 그 장면으로 이동시킨다. 스크롤을 환경 준비로 다루면 여정이 사용자가 실제로 하는 일과 달라진다. 화면에 보이는 컨트롤로 도달할 수 있으면 그것은 step 이다.

이 구분은 AGENTS.md 의 complete user journey invariant 와 같다. 여정은 가장 이른 사용자 진입점에서 시작한다.

## termcn/TUI 대응

- 실행 이력 → 키보드 탐색 `List`
- 대기열 → `Tree` 또는 중첩 `List`
- 진행률 → `Multi Progress` + `Status Message`
- 중단 확인 → `Confirm`
- step 사유 → `Key Value`
