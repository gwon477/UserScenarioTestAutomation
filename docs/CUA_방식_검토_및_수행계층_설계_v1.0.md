# 순수 CUA 수행 방식 검토 — 오픈소스 현황과 "브라우저 영향 최소화" 최적안 토론

| 항목 | 내용 |
|---|---|
| 검토 질문 | ① URL 접근 → 화면 캡처 → 판단 → 액션 반복(순수 CUA) 방식을 제공하는 오픈소스가 있는가 ② 이 방식이 브라우저 영향을 최소화하는 현실적 최적안인가 |
| 선행 문서 | E2E 수행 기술스택 도출 및 브라우저 제약 검토 v1.0 (제약 ID C1~C7 / T1~T5 인용) |
| 조사 시점 | 2026-08-26 (공식 리더보드 원본·모델카드·저장소 기준) |
| 결론 한 줄 | **오픈소스는 충분히 있다. 그러나 순수 CUA는 "기본 수행 방식"이 아니라 "탈출 경로(Tier C)"로 두는 것이 최적이다.** |

> **ScenarioForge 적용 판정(2026-08-26):** 이 문서의 CUA fallback 결론은 유지하되, 브라우저 중심 Tier A/B/C와 특정 제품·모델 버전은 구현 계약으로 직접 사용하지 않는다. 웹은 Playwright, Windows는 UI Automation, Android/iOS는 Appium semantic driver를 우선하고, 비전/CUA는 구조화 제어면이 없는 step에만 사용한다. 최종 적용 구조와 변경된 전제는 [`architecture/05-multi-target-execution-adapter-design.md`](architecture/05-multi-target-execution-adapter-design.md)를 따른다.

---

## 0. 결론 요약

**Q1 — 있습니다.** 폐쇄망 자체 GPU만으로 완결 가능하고 Windows를 지원하는 현역 오픈소스가 최소 4개 존재합니다(Midscene `@midscene/computer`, Microsoft UFO³, Agent-S3, trycua/cua). 모델 축에서는 **Holo3-35B-A3B(Apache-2.0, vLLM, OSWorld-Verified 82.56)** 가 2026년 현재 오픈웨이트 최강이며 인간 baseline(72.36%)을 넘어섰습니다.

**Q2 — 브라우저 영향 최소화라는 목표만 보면 CUA가 명백히 우월합니다. 그러나 최적안은 아닙니다.** 이유는 세 가지이고, 셋 다 정량 근거가 있습니다.

1. **케이스가 길어지면 붕괴한다.** MCPWorld 실측: GUI-Only 방식은 0–5스텝 태스크에서 90.41%지만 **10스텝 초과에서 35.56%로 무너지고**, 하이브리드는 51.11%를 유지합니다. 8장 원자 스텝으로 분해한 SI 통합테스트 케이스는 대부분 10스텝을 넘습니다.
2. **스텝 정확도 90%가 케이스 Pass율을 보장하지 않는다.** 최신 모델들은 ScreenSpot-v2에서 95%대를 찍으면서 OSWorld 다중 스텝에서는 20~40%대에 머뭅니다. Qwen-UI-Agent는 그라운딩 81.5인데 OSWorld-v2 binary는 13.9입니다. **G1의 "그라운딩 90%"는 통과해도 케이스 완주율은 별개 숫자**입니다.
3. **비용 곡선이 반대로 뒤집힌다.** 순수 CUA는 DOM 캐시가 없으므로 회차마다 전량 VLM 호출입니다. 14.2 강점 5("쓸수록 싸지는 축적형 비용 구조")와 FR-050이 정면으로 부정됩니다.

**따라서 권고는 capability 기반 계층형 라우팅입니다.** 기존 시나리오의 자연어 `action`·`expected`와 `actionRef`·`assertionRefs`는 보존할 수 있지만, 비웹 수행에는 launch/activate/context 전환/back/home/key chord/drag와 플랫폼별 target reference가 필요합니다. 즉 **시나리오 자산은 보존하되 FACT→RunnerPlan 실행 IR은 확장**해야 합니다. 수행 계층은 runtime capability이지만 이를 표현하는 binding schema까지 불변인 것은 아닙니다.

---

## 1. Q1 — 오픈소스 현황 (2026-08 기준)

### 1.1 폐쇄망 + Windows + 자체 GPU로 완결 가능한 프레임워크

| 프레임워크 | 라이선스 | 최신 릴리스 | 제어 계층 | 로컬 vLLM | Windows | 병렬 |
|---|---|---|---|---|---|---|
| **Midscene `@midscene/computer`** | MIT | **2026-08-24** (v1.12.0, 매우 활발) | 순수 스크린샷 (DOM·a11y 불필요) | ✅ `MIDSCENE_MODEL_BASE_URL` 환경변수 직결 | ✅ | ❌ **동기 1명령 강제** |
| **Microsoft UFO³ "Galaxy"** | MIT | UFO³ 2025-11, 2026 커밋 활동 | **Windows UIA/Win32/WinCOM 네이티브 + GUI 혼합** | ✅ Ollama / Custom 백엔드 | ✅ **1급 대상** | ✅ DAG 기반 비동기 병렬 |
| **Agent-S3 (Simular)** | Apache-2.0 | 0.3.2 / 2025-12-16 (**정체**) | OS 전체 화면 + 코드 실행 | ✅ **"vLLM inference" 명시**, 그라운딩 엔드포인트 완전 분리 | ✅ | ❌ |
| **trycua/cua** | MIT | 2026-06-24 (활발, 21.9k★) | 호스트 직접 제어 + **격리 VM/컨테이너 데스크톱** | ✅ LiteLLM + `huggingface-local/` | ✅ | ✅ `Sandbox.ephemeral()`, `--max-parallel N` |
| **OpenAdapt** | MIT | **2026-08-25** (가장 활발) | 시연 → **결정론적 컴파일** (정상 실행 시 모델 호출 0회) | 문서에 "on-prem VLM appliance" 명시 | ✅ | 확인 불가 |
| **microsoft/fara (Fara1.5)** | MIT (**모델 가중치 포함**) | 가중치 2026-07-22 | **브라우저 전용** (Playwright) | ✅ `vllm serve microsoft/Fara-7B` 공식 문서 | 호스트만 | 확인 불가 |
| OmniParser + OmniTool | 코드 MIT / **아이콘 검출 모델 AGPL** | 2025-09-12 (**정체**) | 인식(파서) + OmniTool이 제어. **Docker Windows 11 VM 동봉** | ✅ Qwen2.5-VL 조합 | ✅ | 확인 불가 |

**도입 비권장으로 확인된 것**: **Bytebot은 2026-03-07 GitHub 아카이브(read-only) 처리**되었습니다(Standard Fleet 인수로 추정, 공식 발표문 미확인). 컨테이너 데스크톱 병렬 구조의 대표 주자였으므로 선택지가 좁아졌습니다. UI-TARS-desktop은 2025년 하반기 이후 릴리스가 없고 2026-06 실사용 리뷰에서 "문서·저장소 업데이트가 활발하지 않다"는 평가를 받았습니다. Self-Operating Computer는 2025-02 이후 정체입니다.

**라이선스 지뢰** (15장의 "AGPL 법무 검토" 항목 구체화 대상): Skyvern **AGPL-3.0**, Notte **SSPL-1.0(OSI 비승인)**, OmniParser 아이콘 검출 가중치 **AGPL**, Holo2-30B-A3B **연구 전용(비상업)**.

### 1.2 모델 축 — 여기가 2026년에 가장 크게 바뀐 지점

| 모델 | 라이선스 | OSWorld-Verified | ScreenSpot-Pro | 폐쇄망 적합성 |
|---|---|---|---|---|
| **Holo3-35B-A3B** (H Company) | **Apache-2.0** | **82.56** (공식 리더보드 오픈웨이트 1위) | — | ✅ vLLM/SGLang/llama.cpp |
| **Holo3.1** (0.8B/4B/9B/35B-A3B) | 4B Apache-2.0 확인 | — | — | ✅ **FP8/Q4 GGUF/NVFP4 양자화 + function-calling** |
| MiniMax M3 | 오픈웨이트 | 75.19 | — | ✅ |
| GUI-Owl-1.5 (2B~235B) | 리포 MIT | 56.5 | 80.3 | 2026-02-14 공개 |
| MAI-UI / Qwen-UI-Agent (2B·8B 공개) | Apache-2.0 | 79.5 (자체보고) | 81.5 (자체보고) | ✅ vLLM 0.11.0 |
| OpenCUA (7B/32B/72B) | MIT | 46.1 | — | ✅ vLLM 문서 완비 |
| UI-TARS-1.5-7B | Apache-2.0 | 27.5 | 61.6 | ✅ (**UI-TARS-2는 가중치 미공개**) |
| **참고 — 범용 VLM** | | | **Claude Computer Use 17.1 / GPT-5 6~18 / GPT-4o 0.8** | — |

**이 표의 마지막 줄이 가장 중요합니다.** 고밀도 화면 그라운딩(ScreenSpot-Pro)에서 프론티어 범용 VLM은 **0.8~18점**, GUI 특화 오픈웨이트는 **60~82점**입니다. 기획서 15장이 지정한 `qwen3.6-35b-a3b`는 범용 VLM 계열이므로, **모델 선택만으로 G1의 성패가 갈릴 수 있습니다.**

**상용 API는 처음부터 제외 대상입니다.** Anthropic Computer Use는 2026-08-19 GA, OpenAI Computer Use도 정식 기능이지만 **양쪽 다 가중치 비공개 + 클라우드 API 전용**이며 온프레미스 배포 경로가 문서상 존재하지 않습니다. Azure/Bedrock 경유도 퍼블릭 클라우드 리전이므로 폐쇄망 요건을 충족하지 못합니다.

---

## 2. Q2 토론 — CUA는 브라우저 영향 최소화의 최적안인가

### 2.1 먼저, "브라우저 영향 최소화"를 네 갈래로 나눠야 합니다

논의가 엉키는 이유는 이 표현이 서로 다른 네 가지를 뜻하기 때문입니다.

| 의미 | 순수 CUA | 현행 Midscene+Playwright |
|---|---|---|
| (a) **대상 시스템에 대한 침습 최소화** — 확장 주입·프로파일 조작 없이 실제 사내 브라우저를 그대로 씀 | **압도적 우위** | 신규 프로파일·확장 로드 필요 (C6) |
| (b) **브라우저 종류·버전 종속 최소화** | **우위** (픽셀만 봄) | Chromium 전용 + 버전 핀 (C1, C4) |
| (c) **우리 스택의 브라우저 내부 API 의존도** | **우위** (CDP 불필요) | CDP 필수 (C1, C5) |
| (d) **증적의 실사용 환경 대표성** | **우위** (사내 표준 브라우저 그대로) | 번들 Chromium은 정책·확장 미적용 (C3) |

**(a)~(d) 네 축 모두 CUA가 이깁니다.** 이건 논쟁의 여지가 없습니다. 질문의 전제는 옳습니다.

### 2.2 선행 검토의 제약 12건이 실제로 얼마나 해소되는가

| 제약 | 순수 CUA 적용 시 | 판정 |
|---|---|---|
| C1 Midscene Chromium 전용 | CDP 미사용 → 무관 | **해소** |
| C2 IE·Edge IE 모드 불가 | IE 모드 창도 화면상으로는 그냥 픽셀 | **해소** — 가장 큰 이득 |
| C3 번들 Chromium ≠ 실제 브라우저 | 사내 표준 브라우저를 그대로 구동 | **해소 (오히려 개선)** |
| C4 브라우저 버전 핀 | 무관 | **해소** |
| C5 Bridge 모드 병렬 배타 | 다른 축의 문제로 이동 (§2.4) | 대체 |
| C6 확장 side-load 차단 | 정상 설치된 실제 브라우저 사용 → 확장 그대로 살아 있음 | **해소** |
| C7 크로스브라우저 범위 밖 | 브라우저를 바꿔 띄우기만 하면 됨 | **해소** |
| T1 엑스플랫폼 ActiveX/IE 종속 | C2 해소에 따라 동반 해소 | **해소** |
| T2 WebSquare5 | 애초에 제약 낮음 | 무관 |
| T3 canvas → DOM 캐시 무력화 | 애초에 DOM을 안 봄 → 렌더링 방식 무관 | **해소 (단, §2.3 참조)** |
| T4 키보드 보안 드라이버 후킹 | **부분 해소** — 확장·LNA 권한 문제는 사라지나, 커널 드라이버가 가로채는 키 입력 경로를 OS 레벨 합성 입력이 통과한다는 보장은 없음 | **불확실 — 실측 필요** |
| T5 팝업·다운로드·네이티브 프린트 | 사람과 동일한 경로 | **해소** |

**12건 중 9건 완전 해소, 1건 부분 해소.** 이 정도면 "브라우저 제약 해소"라는 목표에는 사실상 정답입니다. 문제는 그 대가입니다.

### 2.3 대가 ① — 기획서의 핵심 경제 논리가 무너진다

14.2 강점 5는 "수행 경로 캐시와 템플릿이 회차마다 쌓여 쓸수록 싸지고 남는 것이 생기는 비용 곡선"입니다. FR-050과 G2(캐시 재생 95%)가 이를 뒷받침합니다.

**순수 CUA에는 재생할 "경로"가 DOM 형태로 존재하지 않습니다.** 남는 것은 좌표·스크린샷 해시뿐이고, 이는 해상도·창 위치·스크롤 오프셋·폰트 렌더링에 취약합니다. 8장 target 필드가 이미 이 슬롯들을 정의해 두었지만, **이것은 Midscene이 제공하는 기능이 아니라 자체 구현 대상**입니다(선행 검토 T3에서 지적).

주목할 만한 방증이 있습니다. **OpenAdapt는 2026년에 성격을 완전히 바꿔 "매 스텝 VLM을 호출하는 CUA"에서 "시연을 결정론적 로컬 프로그램으로 컴파일하는 엔진"으로 전환했습니다.** 자기소개가 *"정상 실행 시 모델 호출 0회. 추측하는 대신 중단한다"* 입니다. 이는 이 기획서의 FR-050 이상형과 거의 같은 방향이며, **현장에서 순수 CUA의 반복 비용이 감당되지 않는다는 시장 신호**로 읽어야 합니다.

### 2.4 대가 ② — 병렬 3건과 1인 1설치 가정이 함께 무너진다

| 축 | 현행(브라우저 계층) | 순수 CUA |
|---|---|---|
| 병렬 단위 | 브라우저 컨텍스트 3개 (한 프로세스 내) | **OS 데스크톱 3개** |
| 필요 자원 | PC 1대 | **VM 3대 또는 원격 데스크톱 3세션** |
| QA PC 점유 | 없음 (headless 가능) | **있음 — 마우스·키보드를 에이전트가 점유** |
| 프레임워크 지원 | Playwright 기본 제공 | Midscene 데스크톱은 **"동기 실행 필수, 백그라운드 실행 금지"** 명시 |

즉 **가정 2(1인 1설치)와 가정 4(병렬 3건)는 순수 CUA로 전환하는 순간 동시에 성립하지 않습니다.** 병렬을 유지하려면 폐쇄망 안에 Windows VM 풀(자체 Hyper-V/QEMU, 또는 trycua/cua 로컬 QEMU 경로)이 필요하고, 이는 "설치형·저사양 전제"를 인프라 구축 프로젝트로 바꿉니다. Bytebot 아카이브로 기성품 선택지도 줄었습니다.

### 2.5 대가 ③ — 정확도. 여기가 가장 냉정하게 봐야 할 부분

**(1) 단일 스텝 그라운딩과 케이스 완주율은 다른 숫자입니다.**

| 모델 | 단일 스텝 그라운딩 | 다중 스텝 태스크 | 격차 |
|---|---|---|---|
| Qwen-UI-Agent | ScreenSpot-v2 97.5 / Pro 81.5 | OSWorld-v2 binary **13.9** | **-67.6%p** |
| UI-TARS-1.5-7B | ScreenSpot-v2 94.2 / Pro 61.6 | OSWorld **27.5** | -34.1%p |
| Holo2-30B-A3B | ScreenSpot-v2 94.9 / Pro 66.1 | OSWorld **37.4** | -28.7%p |
| GUI-Owl-1.5 | ScreenSpot-Pro 80.3 | OSWorld-Verified 56.5 | -23.8%p |

**G1이 측정하려는 "그라운딩 성공률 90%"는 위 표의 왼쪽 열입니다.** 케이스가 Pass하려면 오른쪽 열이 필요합니다. 기획서 G1의 임계값 설계를 이대로 두면, **G1을 통과하고도 파일럿 SC-001/002가 실패하는 시나리오**가 발생할 수 있습니다.

OSWorld 2.0(평균 318 tool call, 인간 중앙값 1.6시간)에서 최고 모델이 **binary 20.6% / partial 54.8%** 인 것도 같은 신호입니다 — 부분적으로는 잘 하는데 끝까지 완주를 못 합니다.

**(2) 태스크 길이가 지배 변수입니다 (MCPWorld 실측).**

| GUI 스텝 수 | GUI-Only | API-Only | **Hybrid** |
|---|---|---|---|
| 0–5 | **90.41%** | 63.01% | 90.41% |
| 5–10 | 72.29% | 51.81% | **74.70%** |
| **10+** | **35.56%** | 40.00% | **51.11%** |

전체 평균으로도 Hybrid 75.12% > GUI-Only 70.65% > API-Only 53.23%입니다. **"순수 비전이냐 구조화 접근이냐"는 이분법이 아니라 태스크 길이에 따른 라우팅 문제**라는 것이 정량으로 나옵니다. 이것이 §3 권고의 근거입니다.

**(3) 엔터프라이즈 고밀도 화면은 별도의 벽입니다.**

ScreenSpot-Pro는 정확히 SI 화면을 닮은 벤치마크입니다 — 1080p 초과 해상도, **타겟이 화면 면적의 평균 0.07%**(일반 ScreenSpot의 1/29), 실무자 워크플로 캡처. 2026-08 현재 최고가 zoom-in 기법 포함 **82.7%**, zoom 없는 원패스 최고는 **70% 미만**입니다.

더 직접적인 것은 **GUI-360°**(Word/Excel/PowerPoint 엔터프라이즈 오피스, 17.7M 어노테이션 UI 요소)입니다:
- 그라운딩 zero-shot: GPT-4o **9.38%**, GPT-4.1 **11.41%**, o3 **29.96%** → **도메인 SFT 후 ~82%**
- 액션 예측(비전 only, zero-shot): GPT-4o **3.12%**, o3 **17.92%** → a11y 메타데이터 추가 시 **36~39%** (2~12배)

**그리드·리본·조밀 폼이 가득한 화면에서 범용 VLM은 사실상 사용 불가 수준이며, 도메인 SFT가 필수라는 것이 정량 확인됩니다.** 기획서 11장 Non-Goals의 "자체 GUI 모델 파인튜닝 초기 범위 제외"와 정면으로 부딪힐 수 있는 지점입니다.

**(4) 한국어 UI는 측정된 적이 없습니다.**

조사 결과 **한국어 UI 스크린샷 그라운딩을 평가하는 공개 벤치마크는 존재하지 않습니다.** 간접 근거만 있습니다:
- ScreenSpot-Pro-CN(중국어): UGround-7B **16.4 → 7.7 (-53%)**, OS-Atlas-7B 18.9 → 16.8. 논문 결론 "중국어 지시가 더 어려움"
- macOSWorld 5개 언어: EN 19.3 / RU 17.7 / ZH 17.2 / JA 15.8 / AR 13.7 — 원인은 주로 **그라운딩 열화**
- MPR-GUI: InternVL2.5-8B EN 81.2 → ZH 72.4 → TH 57.9

**기획서 16장이 "한글 UI·Nexacro 그라운딩 정확도 미달(공개 벤치마크 부재)"를 최우선 리스크로 꼽은 것은 정확한 인식이었습니다.** 다만 이는 CUA로 바꾼다고 해소되지 않고, **오히려 CUA에서 더 크게 노출됩니다**(DOM 텍스트라는 보조 신호가 사라지므로).

### 2.6 대가 ④ — 속도

Holo3.1-35B-A3B 실측(DGX Spark): 스텝당 **6.8초 → 3.3초**(NVFP4 양자화 적용). 20스텝 케이스면 순수 추론만 **66~136초**이고 여기에 화면 대기·액션 시간이 더해집니다.

SC-001(수동 대비 70% 단축, [가정 1] 기준선 10분 → 목표 3분)은 **병렬 없이 단건으로도 산술적으로는 가능**합니다. 다만 재시도·자가복구가 붙으면 여유가 크지 않고, 앞서 본 대로 병렬 3건을 유지하려면 VM 3대가 필요합니다. 즉 **SC-001은 지킬 수 있으나 [가정 4]의 비용 구조가 바뀝니다.**

### 2.7 종합 판단

| 평가축 | 순수 CUA | 현행 브라우저 계층 | 승자 |
|---|---|---|---|
| 브라우저 제약 해소 | 12건 중 9건 완전 해소 | 기준선 | **CUA** |
| 대상 커버리지 (IE모드·C/S·모바일) | 전부 커버 | 웹 Chromium만 | **CUA** |
| 증적의 실환경 대표성 | 사내 표준 브라우저 그대로 | 번들 Chromium 괴리 | **CUA** |
| 반복 수행 비용 곡선 (FR-050, 강점 5) | 매 회차 전량 VLM | DOM 캐시 재생 | **현행** |
| 케이스 완주율 (10스텝 초과) | 35.56% | — (하이브리드 51.11%) | **하이브리드** |
| 병렬성 ([가정 4]) | OS 데스크톱 3개 = VM 3대 | 브라우저 컨텍스트 3개 | **현행** |
| 설치형 1인1설치 ([가정 2]) | 성립 곤란 | 성립 | **현행** |
| 속도 | 스텝당 3.3~6.8초 | 캐시 재생 시 ms 단위 | **현행** |

**어느 한쪽이 전면 승리하지 않습니다. 그리고 이 표는 "둘 중 하나를 고르라"가 아니라 "둘 다 필요하다"를 가리킵니다.**

---

## 3. 권고 — 3계층 수행 어댑터

### 3.1 설계

아래 표는 검토 당시의 브라우저 중심 원안이다. ScenarioForge 최종 적용에서는 모든 비웹 대상을 Tier C로 보내지 않고, Windows UIA와 Android/iOS Appium처럼 플랫폼이 제공하는 semantic automation을 각 대상의 기본 계층으로 둔다. 기존 scenario reference는 유지하지만 실행 binding schema는 플랫폼 중립 IR로 확장한다.

| 계층 | 구현 | 적용 대상 | 캐시 | 병렬 | 비용 |
|---|---|---|---|---|---|
| **Tier A — DOM/CDP** | Midscene + Playwright (현행 15장) | 표준 웹, WebSquare5 | XPath 캐시 유효 | 3+ | 최저 |
| **Tier B — 브라우저 내 비전** | Playwright 스크린샷 + 좌표 클릭 (DOM 셀렉터 미사용, CDP는 캡처·입력에만) | 넥사크로 canvas, 비표준 DOM | 좌표·해시 캐시(자체 구현) | 3+ | 중 |
| **Tier C — OS 레벨 CUA** | `@midscene/computer` 또는 UFO³ | IE 모드, 보안모듈 관문, C/S, Electron 셸, 모바일 | 좌표·해시 캐시 | VM 수만큼 | 최고 |

**적용 해석**: Tier C를 추가해도 기존 시나리오 자산과 Playwright 기준선을 버리지는 않는다. 다만 Midscene 단일 API를 통합 실행 추상화로 채택하지 않고, TestVista의 자체 `ExecutionAdapter` port 아래 Playwright·Windows UIA·Appium·Midscene CUA를 독립 adapter로 둔다. 패키지 릴리스 시점이나 특정 GUI 모델 순위는 구현을 고정하는 근거로 사용하지 않는다.

이 설계는 선행 검토에서 지적한 **S9 갭(Phase 3 C/S용 OS 화면 제어 도구 미지정)을 동시에 메웁니다.**

### 3.2 계층 선택 규칙 (제안)

```
1. target kind·환경 preflight로 사용 가능한 adapter 결정
2. 구조화 제어면 존재 → Web Playwright / Windows UIA / Mobile Appium 우선
3. semantic surface가 opaque인 step → browser vision 또는 desktop CUA fallback
4. OS process·window 전환 → 허용된 ExecutionSegment와 desktop lease가 있을 때만 CUA
5. 케이스 스텝 수 10 초과 & vision/CUA 필요 → 케이스 분할 검토 (MCPWorld 근거)
```

5번을 규칙에 넣는 이유는 §2.5(2)의 붕괴 곡선 때문입니다. **긴 케이스를 짧은 케이스로 쪼개는 것 자체가 정확도 대책**이며, 원자 스텝 구조가 이를 쉽게 만듭니다.

### 3.3 기획서 반영안

**(1) Slice 1 재정의 — 어댑터 인터페이스 우선**

> Phase A는 **수행 어댑터 인터페이스와 capability router**를 먼저 구현하고 Playwright를 web 기준선으로 연결한다. Phase B는 Windows UIA/FlaUI sidecar를 semantic 기준선으로 추가한 뒤, UIA가 보지 못하는 custom/canvas fixture에만 Midscene vision/CUA pilot을 적용한다. Appium mobile adapter는 계약을 먼저 고정하고 실제 지원 대상이 확정된 후 구현한다.

이렇게 하면 G1 실패 시 대응이 "재설계"가 아니라 "어댑터 교체"가 됩니다. D6의 "교체 영향 국소화" 원칙과 같은 논리입니다.

**(2) G1 게이트 재정의 — 두 숫자를 따로 측정**

> G1은 ① **스텝 단위 그라운딩 성공률 90%** 와 ② **케이스 단위 완주율**(스텝 10개 이상 케이스 기준)을 **분리 측정**한다. ①만으로는 SC-001·002 달성을 예측할 수 없다.

**(3) 모델 후보 교체 — 15장 수정**

> 온프레미스 VLM 후보에 **Holo3-35B-A3B(Apache-2.0, vLLM/SGLang, OSWorld-Verified 82.56)** 및 **Holo3.1(FP8/Q4 GGUF/NVFP4 양자화, function-calling 지원)** 을 추가하고, G1에서 범용 VLM(`qwen3.6-35b-a3b`)과 비교 측정한다. 고밀도 화면 그라운딩에서 범용 VLM과 GUI 특화 모델의 격차가 크다(ScreenSpot-Pro: 범용 0.8~18 vs 특화 60~82).

Midscene의 `MIDSCENE_MODEL_BASE_URL`로 vLLM 엔드포인트를 직접 지정할 수 있으므로 LiteLLM 게이트웨이(FR-070) 구조를 바꾸지 않고 교체 가능합니다.

**(4) 한국어 평가셋을 G1 산출물로 명시**

> 한국어 UI 그라운딩 공개 벤치마크는 존재하지 않는다. G1은 **자체 한국어 평가셋(대상 프레임워크 화면 표본 + 정답 좌표 어노테이션)** 구축을 필수 산출물로 포함한다. 이 평가셋은 이후 모델 교체·업그레이드의 회귀 기준으로 자산화한다.

**(5) [가정 2]·[가정 4] 조건부 문구화**

> Tier C(OS 레벨 CUA)를 사용하는 케이스에 한해 병렬 단위는 브라우저 세션이 아닌 OS 데스크톱이며, 1인 1설치 PC에서는 동시 1건으로 제한한다. Tier C 병렬이 필요한 경우 별도 Windows VM 풀 구성을 전제로 하며, 이는 초기 범위 밖이다.

**(6) 11장 Non-Goals 재검토 필요 표시**

> "자체 GUI 모델 파인튜닝 제외"는 유지하되, **고밀도 엔터프라이즈 화면에서 도메인 SFT 없이 목표 정확도 달성이 어렵다는 외부 근거(GUI-360°: zero-shot 3~30% → SFT 후 ~82%)** 를 리스크로 명기하고, G1 미달 시 완화 옵션의 우선순위를 상향한다.

**(7) 15장 라이선스 주의 구체화**

> AGPL 검토 대상: Skyvern(AGPL-3.0), OmniParser 아이콘 검출 가중치(AGPL, 코드는 MIT). SSPL 대상: Notte. 상업 이용 제한: Holo2-30B-A3B(연구 전용). 채택 후보인 Midscene(MIT)·Playwright(Apache-2.0)·Holo3-35B-A3B(Apache-2.0)·UFO(MIT)·cua(MIT)는 제약 없음.

---

## 4. 남는 질문 (실측·확인 필요)

| ID | 항목 | 방법 |
|---|---|---|
| Q-1 | 키보드 보안(TouchEn nxKey 등)이 걸린 필드에서 **OS 레벨 합성 입력이 통과하는가** — CUA의 T4 해소 여부를 좌우 | 대상 환경 실측. 통과 실패 시 Tier C도 해당 필드는 사람 개입 필요 |
| Q-2 | 대상 화면의 **케이스당 평균 원자 스텝 수** — 10을 넘으면 §2.5(2) 붕괴 구간 | 정규화(FR-002) 결과 표본 집계 |
| Q-3 | 좌표·스크린샷 해시 캐시의 **실제 재생 성공률** (해상도·창 위치 변동 하에서) | G2에 Tier B/C 조건 추가 |
| Q-4 | `qwen3.6-35b-a3b` vs `Holo3-35B-A3B`의 **한국어·Nexacro 화면 그라운딩 실측 비교** | G1 필수 항목화 |
| Q-5 | trycua/cua 로컬 QEMU + Windows 이미지 조합의 **폐쇄망 안정성** (Tier C 병렬이 필요해질 경우) | Slice 1.5 PoC. 공식 퀵스타트에 "This tutorial does not currently work" 경고가 게시된 상태 |

---

## 출처

**프레임워크**
- [Midscene GitHub (MIT)](https://github.com/web-infra-dev/midscene) · [midscenejs.com](https://midscenejs.com/) · [모델 선택 가이드](https://midscenejs.com/choose-a-model.html)
- [Microsoft UFO (MIT)](https://github.com/microsoft/UFO) · [UFO 지원 모델](https://microsoft.github.io/UFO/supported_models/overview/)
- [Simular Agent-S (Apache-2.0)](https://github.com/simular-ai/Agent-S) · [Agent S3 발표](https://www.simular.ai/articles/agent-s3)
- [trycua/cua (MIT)](https://github.com/trycua/cua) · [지원 모델 프로바이더](https://cua.ai/docs/agent-sdk/supported-model-providers)
- [OpenAdapt (MIT)](https://github.com/OpenAdaptAI/OpenAdapt) · [docs.openadapt.ai](https://docs.openadapt.ai/)
- [microsoft/fara (MIT, 가중치 포함)](https://github.com/microsoft/fara) · [Fara1.5 공식 문서](https://www.microsoft.com/en-us/research/articles/fara1-5-computer-use-agent/)
- [Microsoft OmniParser](https://github.com/microsoft/OmniParser) · [Bytebot (2026-03-07 아카이브)](https://github.com/bytebot-ai/bytebot)
- [Skyvern (AGPL-3.0)](https://github.com/Skyvern-AI/skyvern) · [browser-use (MIT)](https://github.com/browser-use/browser-use) · [Notte (SSPL)](https://github.com/nottelabs/notte)

**모델**
- [Holo3-35B-A3B (Apache-2.0)](https://huggingface.co/Hcompany/Holo3-35B-A3B) · [Holo3](https://hcompany.ai/holo3) · [Holo3.1](https://hcompany.ai/holo3.1) · [Holo2-30B-A3B](https://huggingface.co/Hcompany/Holo2-30B-A3B)
- [UI-TARS-1.5-7B](https://huggingface.co/ByteDance-Seed/UI-TARS-1.5-7B) · [UI-TARS-2 논문](https://arxiv.org/abs/2509.02544) · [가중치 공개 요청 이슈 #213(미해결)](https://github.com/bytedance/UI-TARS/issues/213)
- [Qwen-UI-Agent / MAI-UI](https://github.com/Tongyi-MAI/MAI-UI) · [기술보고서](https://arxiv.org/html/2607.28227v1)
- [GUI-Owl-1.5 / Mobile-Agent](https://github.com/X-PLUG/MobileAgent) · [OpenCUA (MIT)](https://github.com/xlang-ai/OpenCUA)

**벤치마크·연구**
- [OSWorld 공식 검증 결과 원본](https://github.com/os-world/os-world.github.io/blob/main/static/data/osworld_verified_results.xlsx) · [OSWorld 논문(인간 baseline 72.36%)](https://arxiv.org/abs/2404.07972) · [OSWorld 2.0](https://arxiv.org/html/2606.29537v1)
- [ScreenSpot-Pro 공식 리더보드](https://gui-agent.github.io/grounding-leaderboard/) · [ScreenSpot-Pro 논문(타겟 면적 0.07%)](https://arxiv.org/html/2504.07981v1)
- [MCPWorld — GUI vs API vs Hybrid](https://arxiv.org/html/2506.07672v1)
- [GUI-360° — 엔터프라이즈 오피스 그라운딩](https://arxiv.org/html/2511.04307v2)
- [Read More, Think More — 관측 형식별 토큰·성능](https://arxiv.org/html/2604.01535) · [A11y-Compressor](https://arxiv.org/html/2605.00551v1)
- [macOSWorld — 다국어 성능 하락](https://arxiv.org/html/2506.04135v4) · [MPR-GUI](https://arxiv.org/html/2512.00756) · [K-BrowseComp(한국어, 텍스트 브라우징)](https://arxiv.org/html/2606.02404v1)
- [GUI 에이전트 지연시간 분해](https://arxiv.org/html/2607.28399v1) · [Princeton HAL 비용 리더보드](https://hal.cs.princeton.edu/online_mind2web)
- [Anthropic Claude Platform 릴리스 노트](https://platform.claude.com/docs/en/release-notes/overview) · [OpenAI Computer use 가이드](https://developers.openai.com/api/docs/guides/tools-computer-use)

**미확인(단정하지 않음)**: UI-TARS-2 가중치 공개 여부 · Holo3.1 전 사이즈 라이선스 · GLM-4.6V의 GUI 그라운딩 수치 · 한국어 UI 그라운딩 벤치마크(**존재 자체 미확인**) · CUA의 input(스크린샷) 토큰 공식 수치 · Bytebot 인수 시점·조건 · Agent-S의 2026년 커밋 활동.
