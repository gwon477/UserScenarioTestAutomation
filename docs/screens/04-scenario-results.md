# 화면 04 — 시나리오 결과·질의·테스트 선택

## 진입 규칙

- 분석 공정이 100%가 되면 생성된 run 데이터를 읽고 자동 전환한다.
- 생성 이력 앱 박스를 선택하면 분석 공정을 재실행하지 않고 같은 결과 로더로 직접 진입한다.
- 기준 저장 위치는 `<선택 프로젝트>/.scenarioforge/runs/<runId>/scenario-set.json`이다.

Electron main process가 프로젝트 디렉터리에서 결과를 읽어 Renderer에 전달한다. 브라우저 프로토타입에서는 같은 스키마의 예시 데이터를 사용한다.

## 화면 구성

### 좌측 — 시나리오 채팅

- 결과 정보 셋을 컨텍스트로 사용하는 프로젝트별 채팅
- 시나리오 행을 드롭할 수 있는 입력 영역
- 드롭한 ID는 `` `SCN-ORD-001` `` 형식의 코드 블록으로 입력
- 여러 ID를 한 질문에 참조 가능

### 우측 — 시나리오 시트

- 업무 분류별 그룹: 주문 `ORD`, 결제 `PAY`, 회원 `MEM`
- ID 규칙: `SCN-{업무코드}-{3자리 순번}`
- 각 케이스는 ID, 제목, 설명, 원천 파일, 스텝 수를 표시
- 스텝 토글을 열면 사전 조건, 사용자 동작, 기대 결과를 확인
- 행 전체는 채팅으로 드래그할 수 있지만 drag preview와 전송 payload에는 ID만 포함

## 테스트 선택

- 헤더 체크박스로 전체 선택
- 각 시나리오 체크박스로 개별 선택
- 선택이 하나 이상이면 우측 테스트 설정 패널을 표시
- 패널을 닫거나 `선택 해제`를 누르면 선택 상태 초기화

## 테스트 설정 패널

1. 테스트 대상 URL
2. 필요한 개인정보 JSON
3. `확인하세요` 토글로 JSON 예시 열기
4. 실제 개인정보 대신 테스트 전용 값을 사용하라는 경고
5. `N개 테스트 수행` Primary CTA

요청 계약은 `startScenarioTests({ project, runId, scenarioIds, targetUrl, personalData })`이다.

## termcn/TUI 대응

- 좌측 채팅 → `Chat Thread`, `Chat Message`, `Text Area`
- 시나리오 시트 → `Data Grid`, `Tabbed Content`, `Checkbox`
- 케이스 상세 → `Collapsible` 형태의 행 확장
- 테스트 설정 → `Drawer`, `Path/Input`, `JSON`, `Confirm`

TUI에서 포인터 드래그가 어려운 경우 `참조 추가` 명령으로 같은 백틱 ID 토큰을 입력한다.
