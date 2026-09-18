# 화면 06 — 증적 상세와 이력 관리

## 원칙

증적은 판정의 근거다. 따라서 두 가지를 지킨다.

1. **화면에 보이는 값은 모두 그 실행에서 기록된 값이다.** 예시 시각이나 예시 문장을 타임라인에 넣지 않는다. fixture 값을 실제 증적처럼 표시하면 사용자는 매 실행마다 틀린 정보를 읽는다.
2. **비전 경로에서 판정 근거는 원본 화면이 아니라 모델에 전송된 프레임이다.** 원본만 보여주면 왜 그렇게 판정됐는지 재구성할 수 없다.

## 증적 상세 구성

3열 구성이다. 좌측 타임라인, 중앙 캡처 인스펙터, 우측 판정 근거.

### 좌측 · 단계 타임라인

기록된 event만 표시한다. 각 항목은 실제 timestamp를 가진다.

- 조작 전 프레임 캡처
- 마스킹 적용 결과
- 모델 제안과 gate 판정 (재시도가 있었으면 각 회차)
- 입력 합성 실행
- 조작 후 관측 (회차별)
- assertion 평가와 최종 판정

### 중앙 · 캡처 인스펙터

필름스트립으로 저장된 프레임을 넘긴다. 각 프레임에는 다음을 표시한다.

- **어느 프레임인지**: `조작 전`, `모델 전송본`, `조작 후 관측 1회차` 등
- **모델 전송본에는 제안 좌표를 오버레이한다.** 비전 실패를 사람이 검토할 때 가장 유용한 단일 산출물이다. 대상 서술과 실제 클릭 지점을 한 장에서 대조할 수 있어야 한다.
- **마스킹된 영역을 「마스킹됨」으로 표시한다.** 표시가 없으면 검은 사각형을 렌더링 오류로 오해한다.
- 좌표계: 캡처 크기와 모델 전송 크기를 함께 쓴다. 예: `1440x900 캡처 · 1229x768 전송 · 배율 0.853`

프레임 기록의 실제 형태는 `packages/test-runtime/src/execution/step-evidence.ts`의 `StepEvidenceRecord`다. 실행된 예시는 `docs/validation/vision-execution-round-trip/PROBE-20260907-03/evidence/`에 있다.

```ts
type StepEvidenceRecord = {
  schemaVersion: 1;
  stepId; actionRef; verdict;
  target: { elementRef; visibleLabel; controlKind; labelUniqueOnSurface };
  frameSpace: { captureSize; modelSize; scale };   // 재현에 필요한 좌표계
  valueRef?: string;                                // 소비한 binding key. 값은 없다
  maskedRegions: Array<{ elementRef; label }>;      // 「마스킹됨」 표시용
  proposal?: { modelPoint; capturePoint; observedLabel; confidence };
  attempts: Array<{ attempt; outcome; code? }>;
  assertions: Array<{ ref; verdict; detail }>;
  observations: number;
  reason?: { code; detail };
  frames: Array<{ id; kind; round; relativePath; size }>;
};
```

`frames[].kind`는 `before-action`, `model-input`, `after-action`이다. `model-input`이 판정 근거이며 오버레이 대상이다. `after-action`은 관측 회차마다 하나씩 남는다.

### 우측 · 판정 근거

- 수행 동작, 기대 결과, 실제 관측
- assertion 참조별 결과와 사유
- gate 판정과 거절 코드
- 오류 정보 (코드, 분류, 메시지)
- 실행 환경: 모델 ID, 프레임 fingerprint(surface, viewport, DPR, scaling, layout hash), adapter, 좌표계 배율

환경 기록은 고정 문자열로 쓰지 않는다. fingerprint가 없으면 증적이 재현 불가다.

### 구현 상태

- 기록 읽기와 프레임 data URL 변환: `apps/desktop/src/main/application/evidence-view.ts`
- 프레임 표시와 제안 좌표 오버레이: `apps/desktop/src/renderer/src/components/CapturedFrame.tsx`
- 증적 상세는 기록이 있으면 fixture 타임라인을 렌더하지 않는다.
- 실행된 예시: `docs/validation/vision-execution-round-trip/PROBE-20260907-03`

## 사람 검토와 코멘트

### 경계

**사람의 판단이 결정론적 verdict를 덮어쓰지 않는다.** verdict는 backend 소유다. 코멘트는 덧붙이는 검토 레이어이며, 원래 판정은 그대로 남는다.

```ts
type HumanReview = {
  // 증적 앵커. 이 조합으로 실행 간 추적이 가능하다.
  executionId: string;
  scenarioId: string;
  stepOrder: number;
  captureId?: string;

  decision: "동의" | "오탐" | "미탐" | "재실행 필요";
  causeTag?: CauseTag;
  note: string;
  author: string;
  at: string;
};

type CauseTag =
  | "앵커 부적절"          // 앵커가 본문에 묻혀 판독이 흔들림
  | "라벨 화면 미표시"      // aria-label만 있고 화면에 글자가 없음
  | "라벨 렌더링 불일치"    // 기록된 라벨과 화면 표시가 다름 (잘림·서식)
  | "대상 크기 과소"        // 작은 대상에서 좌표가 어긋남
  | "환경 문제"
  | "대상 앱 결함"          // 진짜 버그
  | "기타";
```

### `causeTag`가 필요한 이유

실측에서 확인된 실패는 대부분 모델 정확도 문제가 아니라 **대상 서술의 품질 문제**였다(`docs/validation/vision-execution-grounding/PROBE-20260907-02`, `docs/validation/vision-execution-round-trip/PROBE-20260907-04`). 그 원인들은 생성 트랙에 올려야 하는 계약 요청 항목과 정확히 겹친다. 코멘트가 그 피드백 루프의 입구다.

따라서 `causeTag`별 집계를 증적 라이브러리에서 볼 수 있어야 한다. 「라벨 화면 미표시」가 반복되면 개별 케이스를 손보는 대신 FACT label 가시성 필드를 요청해야 한다는 신호다.

### 구현 상태

- 저장: `packages/test-runtime/src/coordination/review-store.ts` → `tests/{executionId}/cases/{scenarioId}/{stepId}/reviews.json`
- 화면: `apps/desktop/src/renderer/src/components/StepReviewThread.tsx`
- 검토 기록이 verdict 를 바꾸지 않는 것을 `tests/e2e/test-execution-requirements.test.ts` 가 확인한다.
- 실제 스키마는 `HumanReview` 타입을 따르며 `reviewId` 와 `executionId` 는 store 가 채운다.
- step 행 인라인 기록은 판단만 남기는 빠른 검토다. 메모와 원인 태그는 증적 상세 스레드에서 남긴다.
- 빠른 검토는 검토자 이름이 먼저 입력돼 있어야 한다. 귀속되지 않는 기록은 남기지 않는다.

### 배치와 상호작용

- **step 행 인라인**: 빠른 기록용. `동의`/`오탐`/`미탐`/`재실행 필요` 중 선택과 한 줄 메모.
- **증적 상세 전체 스레드**: 여러 검토자의 기록을 시간순으로. 답글 가능.
- modal로 만들지 않는다. 코멘트를 쓰는 동안 증적을 계속 봐야 한다.
- 저장은 즉시 반영하고 toast로 확인한다. 되돌리기를 제공한다.
- 검토 기록이 있는 step은 대기열에서 표식을 가진다. 판정 배지를 대체하지 않고 함께 표시한다.

## 증적 라이브러리

### 구현 상태

- 목록 투영: `apps/desktop/src/main/application/evidence-library-view.ts` (정본 실행 트리를 걷는다)
- 화면: `apps/desktop/src/renderer/src/components/EvidenceLibraryTable.tsx`
- 필터는 클라이언트에서 적용한다. 로컬 데이터이므로 서버 페이징이 필요하지 않다.
- 정리·삭제는 구현하지 않았다. 증적 삭제는 되돌릴 수 없으므로 명시적 요구가 있을 때 추가한다. 현재는 용량만 보여준다.

### 필터와 검색

한 여정이 13 milestone이고 실행이 반복되면 목록만으로는 못 찾는다. 사용자가 「어느 실행에 그 실패가 있었지」를 기억하게 만들지 않는다.

- 판정별 필터: 성공 / 실패 / 확인 필요 / 중단
- 케이스·시나리오 ID 필터
- 실행 기간
- 사유 코드 필터 (`OBSERVED_LABEL_MISMATCH` 등)
- `causeTag` 필터와 집계
- 검토 상태 필터: 미검토 / 검토됨

### 저장 용량

step마다 원본 해상도 프레임과 전송본이 남으므로 용량이 빠르게 는다. 라이브러리가 이를 보이게 하고 조치할 수 있게 한다.

- execution별·판정별 용량
- 보존 정책과 남은 여유
- 정리 대상 선택과 삭제. 다만 검토 기록이 붙은 증적과 실패 증적은 기본 정리 대상에서 제외하고, 삭제하려면 명시적 확인을 받는다.
- 저장 경로 복사 (현행 유지)

## 시나리오와의 양방향 추적

- 증적에서 `시나리오에서 보기`로 원래 케이스로 이동한다. (현행 유지)
- 시나리오 케이스에서 그 케이스의 과거 실행 판정 이력으로 이동할 수 있게 한다. 현재는 한 방향만 있다.

## termcn/TUI 대응

- 타임라인 → `Timeline` 또는 순서 있는 `List`
- 필름스트립 → 좌우 키로 넘기는 `Carousel`. 좌표 오버레이는 텍스트 좌표로 대체
- 판정 근거 → `Key Value`
- 코멘트 → `Chat Thread` + `Text Area`
- 라이브러리 필터 → `Filter Bar` + `Data Grid`
