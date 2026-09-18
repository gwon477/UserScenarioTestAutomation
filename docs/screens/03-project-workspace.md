# 화면 03 — 프로젝트 작업대와 분석 공정

## 프로젝트 작업대

프로젝트 선택 이후의 기본 진입 화면이다. Renderer는 비밀값을 제외한 표시 설정·생성 이력을 localStorage에서 복원한다. 프로젝트 경로의 권한 근거는 renderer storage가 아니라 Electron main의 app-scoped 선택 이력이다. main은 이전에 native picker에서 선택된 canonical directory를 재검증한 뒤 현재 프로세스 allowlist에 복원한다. 선택 프로젝트의 `.scenarioforge/project.json`에는 프로젝트 ID, 소스 정책, credential reference만 포함한 모델 역할 binding을 별도로 기록한다.

### 정보 구조

1. 활성 프로젝트명과 로컬 경로
2. 작업 범위·저작/검토 모델 역할·생성 이력 요약
3. 분석 시작 작업 박스
4. 생성 이력 앱 박스 목록

생성 이력 박스는 실제로 결과를 여는 상호작용 단위이므로 카드 표현을 사용한다. 최초 진입에는 빈 상태를, 분석 완료 후에는 신규 이력을 목록 맨 앞에 추가한다.

생성 이력은 `analysisRunId`, source snapshot 시각, model assurance, scenario 수, unresolved 수를 표시한다. 과거 run을 열 때 현재 source와 다른 snapshot이어도 기존 결과를 덮어쓰거나 자동 재분석하지 않는다.

## 분석 공정

`분석 시작` 후 작업 박스는 다음 공정 그래프로 전환된다.

`SRC → FACT → WIKI → SCENARIO`

| 공정 | 사용자에게 보이는 설명 |
| --- | --- |
| SRC | 소스 구조 수집 |
| FACT | 코드 사실 추출 |
| WIKI | 코드 위키 작성 |
| SCENARIO | 사용자 시나리오 생성 |

완료 공정은 Blueprint, 현재 공정은 Navy, 대기 공정은 Ice 보더로 표시한다. 색상 외에도 번호·체크·텍스트를 함께 사용한다. 전체 퍼센트와 현재 작업 문장을 실시간으로 갱신한다.

provider timeout과 network transient는 하네스 executor가 `1초 → 3초` 간격으로 재시도한다. 분당 토큰 한도 429는 `60초 → 120초` 간격으로 재시도하며, 이때 현재 공정 문장을 `FACT 단계: 요청 한도 회복 대기 (60초 후 재시도)`처럼 바꾼다. Pi 세션 내부 자동 재시도는 비활성화하여 하나의 요청 실패가 중첩 호출로 증폭되지 않게 한다.

분석 실패 시 작업 박스는 `다시 분석`을 제공한다. 현재 프로세스의 credential 또는 OS 보호 cache가 유효하면 설정 모달을 다시 열지 않고 새 `analysisRunId`로 전체 파이프라인을 시작한다. 앱 재시작 뒤에는 credential과 이전에 사용자가 선택한 source directory 승인을 각각 복원한다. main은 저장된 경로를 `realpath`와 directory type으로 다시 검증하며, 손상·삭제·변경된 경로는 자동 승인하지 않고 사용자가 디렉터리를 다시 선택하게 한다.

## termcn/TUI 대응

- 공정 그래프 → `Multi Progress` + `Status Message`
- 생성 이력 → 키보드 탐색 가능한 `List`
- 결과 메타 → `Key Value`

Electron Renderer는 backend completion gate가 발행하는 `onAnalysisProgress` 이벤트를 구독한다. 향후 TUI도 같은 도메인 이벤트 projection을 사용한다.
