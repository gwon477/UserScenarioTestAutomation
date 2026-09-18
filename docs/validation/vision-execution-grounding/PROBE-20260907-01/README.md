# 비전 수행 그라운딩 실측 PROBE-20260907-01

- 실행일: 2026-09-07
- 설계 근거: [`../../../architecture/07-vision-first-execution-design.md`](../../../architecture/07-vision-first-execution-design.md) §11 단계 1
- 대상: `test_project_source/axse-agents` (AXSE), `/Users/a11769/Desktop/RA-DAR` (RA-DAR)
- 모델: `gpt-5.6-luna`, `azure-openai-chat-completions`, 캐시된 author 자격증명
- 상태: 단계 1 완료. 단계 2 이후는 미실행

## 측정 대상 질문

1. 배포된 GPT 계열 모델이 이미지 입력을 실제로 처리하는가.
2. 화면에 보이는 컨트롤의 좌표를 어느 정확도로 반환하는가.

## 방법

1. 각 앱의 실제 dev server를 띄우고 백엔드는 stub API로 대체했다. 두 프로젝트의 소스는 수정하지 않았다.
2. Electron `BrowserWindow` 1440x900으로 화면을 열고, DOM에서 상호작용 컨트롤의 보이는 라벨과 `getBoundingClientRect`를 ground truth로 추출했다.
3. `capturePage()`로 같은 프레임을 PNG로 저장했다.
4. 화면당 최대 6개 대상에 대해 `visibleLabel` + `controlKind`만 주고 클릭 좌표를 요청했다. 좌표는 주지 않았다.
5. 반환 좌표가 ground truth 사각형 안에 들어가면 `hit`, 밖이면 `miss`, 모델이 못 찾았다고 답하면 `not-found`로 집계했다.

## 결과

### 1. 이미지 입력

수용된다. 8개 AXSE 화면과 6개 RA-DAR 화면 모두 `image_url` content로 응답을 받았다. 화면당 응답 시간은 2.8초에서 17.6초였다.

### 2. 원본 좌표계 정확도

| 프로젝트 | 화면 | 대상 | hit | miss | not-found | hit rate |
| --- | --- | --- | --- | --- | --- | --- |
| AXSE | 8 | 39 | 8 | 31 | 0 | **0.205** |
| RA-DAR | 6 | 29 | 2 | 19 | 8 | **0.069** |

`observedLabel`은 대체로 요청한 라벨과 일치했다. 즉 모델은 화면을 읽고 대상을 식별했으나 좌표가 맞지 않았다.

### 3. 원인: 좌표계 불일치

AXSE 39개 대상의 오차는 전부 좌상향이었고 선형이었다.

```text
predicted_x = 0.8651 * truth_x - 13.5    평균 절대 잔차 6.9px
predicted_y = 0.8532 * truth_y + 0.0     평균 절대 잔차 0.5px
```

`y` 잔차 0.5px는 사실상 정확한 선형 관계다. 배율 0.8533은 `768 / 900`과 일치한다. 즉 모델은 원본 1440x900이 아니라 **짧은 변을 768로 맞춘 전처리 이미지 좌표계**로 답하고 있었다. 선형식을 역산하면 AXSE 39/39가 hit이 된다.

### 4. 검증: 짧은 변 768로 맞춰 재측정

가설을 직접 검증하기 위해 이미지를 짧은 변 768로 리사이즈해 전송하고 ground truth도 같은 배율로 환산했다.

| 프로젝트 | 화면 | 대상 | hit | miss | not-found | hit rate | 중심 거리 중앙값 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| AXSE | 8 | 39 | 39 | 0 | 0 | **1.000** | 0~17px |
| RA-DAR | 6 | 28 | 20 | 3 | 5 | **0.714** | 0~8px |

AXSE는 8개 화면 39개 대상 전부 정확히 맞췄다. 로그인 입력 화면은 중심 거리 중앙값 0px이다.

### 5. RA-DAR 잔여 실패의 성격

RA-DAR의 8건은 모델 그라운딩 실패가 아니라 harness ground truth 결함이었다.

| 실패 | 건수 | 실제 원인 |
| --- | --- | --- |
| `RADAR 홈` miss (거리 84~92px) | 3 | ground truth 요소가 로고와 「홈」을 함께 감싼 넓은 `aria-label` 영역이고, 모델은 화면에 보이는 「홈」 텍스트를 정확히 지목했다 |
| 원장 표 셀 `not-found` | 5 | 대상이 가로 스크롤 컨테이너 안에서 화면 밖으로 잘려 스크린샷에 존재하지 않는다. 모델은 추측하지 않고 못 찾았다고 답했다 |

모델이 보이지 않는 대상에 좌표를 지어내지 않은 것은 설계 §3이 요구하는 동작과 일치한다.

### 6. 동일 이미지 재현성

`06-ledger`와 `07-ledger-status-filter`는 상호작용이 실패해 픽셀이 동일한 이미지다. 같은 이미지에서 `직접 등록` 대상이 한 번은 hit, 한 번은 `not-found`였다. 즉 동일 입력에서도 판정이 흔들린다. 설계 §5 gate와 §6의 재관측 규칙이 필요한 근거다.

## 판정

- 단계 1 통과. 이미지 입력이 되고, 좌표 정확도는 좌표계를 맞추면 실용 수준이다.
- **좌표계 정규화는 선택이 아니라 필수 계약이다.** 이 계약이 없으면 정확한 모델도 20% 이하로 보인다.
- CUA 검토 문서가 기록한 「GPT 계열은 고밀도 화면 그라운딩이 약하다」는 우려는 이 실측 범위에서는 재현되지 않았다. 다만 그 문서의 ScreenSpot-Pro는 훨씬 고밀도이고 여기 화면은 그 정도가 아니므로, 이 결과를 그 벤치마크의 반증으로 쓰지 않는다.

## 미실행과 한계

- 개선한 ground truth 추출기(스크롤 클리핑 제외, 보이는 텍스트 우선)로 재측정하려 했으나 모델 배포가 `monthly_token_cap`(HTTP 429)에 도달해 실행하지 못했다. 위 RA-DAR 0.714는 §5의 ground truth 결함을 포함한 값이다.
- 두 앱 모두 백엔드를 stub으로 대체했다. 실제 데이터 밀도와 표 행 수는 다를 수 있다.
- 화면당 최대 6개 대상, 1회 측정이다. 통계적 신뢰구간을 주장할 표본이 아니다.
- 단계 2 이후(step envelope 왕복, Proposal Gate, assertion 판정 분리, segment, replay)는 실행하지 않았다.

## 재실행

```sh
# 1. 대상 앱 dev server와 stub API
node axse-stub-api.mjs      # 45181
node radar-stub-api.mjs     # 45191
vite --config axse.vite.config.mjs    # 45180
vite --config radar.vite.config.mjs   # 45190

# 2. 캡처
GROUNDING_OUT=<dir> electron capture-axse.mjs
GROUNDING_OUT=<dir> electron capture-radar.mjs

# 3. 측정. GROUNDING_SHORT_SIDE를 빼면 원본 좌표계로 측정한다.
GROUNDING_CAPTURE_DIR=<dir> GROUNDING_SHORT_SIDE=768 \
  GROUNDING_RESULT_PATH=<file> GROUNDING_PROJECT=<name> electron probe-grounding.mjs
```

`electron`은 저장소 루트의 `node_modules/.bin/electron`이고 Node는 22.19.0 이상이 필요하다. 자격증명은 Electron `safeStorage` 캐시에서 읽으며 프롬프트, 산출물, 로그에 남기지 않는다.
