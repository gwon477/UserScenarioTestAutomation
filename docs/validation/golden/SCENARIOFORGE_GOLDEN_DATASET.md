# axse-agents ScenarioForge 골든 데이터셋 v2

## 1. 목적, 범위, 근거 규칙

이 문서는 `axse-agents` 소스에서 직접 확인되는 사용자 업무와 분기를 정리한 골든 기준이다. 2026-09-18에 `frontend/src` 전체와 `backend/app/api` 라우트를 판독해 작성했으며, ScenarioForge 생성 결과는 참조하지 않았다.

- 분석 범위: `frontend/src`의 실제 렌더링·상태·API 호출 코드와 `backend/app/api`의 라우트.
- 제외 범위: `node_modules`, `build`, `dist`, `.scenarioforge`, 기존 생성 산출물.
- `[확정]`은 동작·guard·요청·상태 변화가 소스에서 직접 확인되는 항목이다.
- 자격 증명과 식별자의 실제 값은 정의하지 않는다.

### 사용자 여정 우선 판정 계약

- 사용자 여정이 최상위 평가 단위다. 전이 coverage가 100%여도 진입에서 업무 결과까지 이어지는 여정이 없으면 불합격이다.
- 여정은 persona, 진입 화면, 준비 데이터, 화면에 보이는 action, 단계 간 state handoff, 업무 결과, 종료를 포함한다.
- 종료 형태는 업무 분류가 결정한다. 조회 업무는 결과 확인이, 생성 업무는 산출물 확보가 종료다. 로그아웃은 그중 한 형태다.
- 실패가 있어도 화면에 재시도·재선택 action이 있으면 복구 경로를 명시한다.

### 골든 사용자 여정

| 여정 | 목적 | 경로 | 대표 시나리오 | 판정 |
| --- | --- | --- | --- | --- |
| `AXSE2-J-001` | 소스 문서로 추적성 매트릭스를 만들어 CSV/Excel로 확보 | 로그인 → 프로젝트 → TS 작업 → UPLOAD → PARSED_DB → BUSINESS → SCENARIO → CSV/Excel → 로그아웃 | `AXSE2-SCN-035` | 필수 정상 E2E |
| `AXSE2-J-002` | 업로드·파싱 실패를 화면에서 복구해 매트릭스까지 도달 | 로그인 → 프로젝트 → TS 작업 → UPLOAD 실패 → 파일 재선택 → PARSED_DB → BUSINESS → SCENARIO → CSV/Excel → 로그아웃 | `AXSE2-SCN-020` | 필수 복구 E2E |

## 2. 사용자 여정 관련 소스 인벤토리

| 영역 | 파일 | 확인 내용 |
| --- | --- | --- |
| 진입 분기 | `frontend/src/App.jsx` | loginReady/sessionReady로 3개 최상위 화면 분기 |
| 로그인 | `frontend/src/features/login/login-form.page.jsx` | 필수값 검증, 로그인 요청, claim 파싱, 오류 표시 |
| 프로젝트 선택 | `frontend/src/features/login/login.page.jsx` | 목록 조회, 빈 결과, 재조회, 선택, 로그아웃 |
| 셸·단계 게이트 | `frontend/src/features/main/pages/main.page.jsx` | 지속 크롬, STAGE_ORDER 게이트, 작업 생성·전환 |
| 업로드·파싱 | `frontend/src/features/upload/pages/upload.page.jsx` | 파일 선택, 업로드, 폴링, 실패, 교체, 잠금 |
| 파싱 데이터 조회 | `frontend/src/features/parsed-db/pages/parsed-db.page.jsx` | 탭, 검색, 페이징, 빈 결과, 진단 |
| 설정 | `frontend/src/features/settings/pages/settings.page.jsx` | handler와 API 없음 |
| 백엔드 라우트 | `backend/app/api/v1/*.py` | auth, projects, tasks, workflows, documents |

단계 접근 게이트는 `main.page.jsx:30-34`와 `1496-1518`에서 `STAGE_ORDER = [UPLOAD, PARSED_DB, BUSINESS, SCENARIO]`로 강제된다. 목표 단계가 `ui_stage`보다 뒤면 `PATCH /tasks/{id}/stage`로 서버 단계를 올린 뒤 전환한다. `[확정]`

## 3. 업무 분류

| 분류 | 이름 | 범위 | 근거 |
| --- | --- | --- | --- |
| `AXSE2-BC-001` | 인증과 프로젝트 진입 | 로그인, 프로젝트 조회·선택, 세션 종료 | `login-form.page.jsx, login.page.jsx` |
| `AXSE2-BC-002` | TS 작업 관리 | 작업 목록 조회·자동 진입, 생성, 전환 | `main.page.jsx:1471-1494, Shell:120-135` |
| `AXSE2-BC-003` | 문서 업로드와 기계 파싱 | 파일 선택, 업로드, 파싱 폴링, 문서 교체 | `upload.page.jsx` |
| `AXSE2-BC-004` | 파싱 데이터 조회와 진단 | 탭 조회, 검색, 페이징, 이슈 진단 | `parsed-db.page.jsx` |
| `AXSE2-BC-005` | 업무흐름 매핑과 검증 | 업무흐름 선택, 화면 진단, 매핑 CSV | `main.page.jsx BusinessPage` |
| `AXSE2-BC-006` | 시나리오·TC 생성과 산출물 확보 | 생성 요청, 진행 추적, 매트릭스·다운로드 | `main.page.jsx ScenarioPage` |

설정 화면은 `초기화`·`저장`·checkbox·select에 handler와 API가 없어 업무 분류로 승격하지 않는다. `[확정]`

## 4. 업무흐름 정의

### `AXSE2-WF-001` 자격 증명으로 로그인

- 분류: `AXSE2-BC-001`
- 진입 화면: LoginForm
- 핵심 동작: POST /api/auth/login 후 accessToken claim 파싱
- 근거: `login-form.page.jsx:20-56` `[확정]`

### `AXSE2-WF-002` 프로젝트 목록 조회·재조회

- 분류: `AXSE2-BC-001`
- 진입 화면: LoginPage
- 핵심 동작: GET /api/projects, ↺ 새로고침
- 근거: `login.page.jsx:22-48` `[확정]`

### `AXSE2-WF-003` 프로젝트 선택으로 세션 확정

- 분류: `AXSE2-BC-001`
- 진입 화면: LoginPage
- 핵심 동작: authSet dispatch로 셸 진입
- 근거: `login.page.jsx:50-59` `[확정]`

### `AXSE2-WF-004` 세션 종료

- 분류: `AXSE2-BC-001`
- 진입 화면: LoginPage/Shell
- 핵심 동작: sessionReset으로 로그인 폼 복귀
- 근거: `login.page.jsx:11, main.page.jsx:1484` `[확정]`

### `AXSE2-WF-005` TS 작업 목록 조회와 자동 진입

- 분류: `AXSE2-BC-002`
- 진입 화면: Shell
- 핵심 동작: taskApi.list 후 최근 작업 bootstrap
- 근거: `main.page.jsx:1471-1482` `[확정]`

### `AXSE2-WF-006` 신규 TS 작업 생성과 작업 전환

- 분류: `AXSE2-BC-002`
- 진입 화면: Shell
- 핵심 동작: taskApi.create, loadTask
- 근거: `main.page.jsx:1486-1494` `[확정]`

### `AXSE2-WF-007` 문서 선택과 업로드·파싱

- 분류: `AXSE2-BC-003`
- 진입 화면: Upload
- 핵심 동작: 필요 시 작업 생성 후 parseDocument, 2.5초 폴링
- 근거: `upload.page.jsx:88-108` `[확정]`

### `AXSE2-WF-008` 파싱 문서 교체

- 분류: `AXSE2-BC-003`
- 진입 화면: Upload
- 핵심 동작: 다시 업로드(↩), 다시 선택(×), 취소
- 근거: `upload.page.jsx:110-126` `[확정]`

### `AXSE2-WF-009` 파싱 완료 후 다음 단계 이동

- 분류: `AXSE2-BC-003`
- 진입 화면: Upload
- 핵심 동작: 다음 단계 → 로 서버 stage 상승
- 근거: `upload.page.jsx:128-136` `[확정]`

### `AXSE2-WF-010` 파싱 데이터 탭 조회·검색·페이징

- 분류: `AXSE2-BC-004`
- 진입 화면: ParsedDb
- 핵심 동작: 업무/화면/필드/이벤트 탭, 검색, 이전·다음
- 근거: `parsed-db.page.jsx:264-285` `[확정]`

### `AXSE2-WF-011` 업무흐름 선택과 매핑 검증

- 분류: `AXSE2-BC-005`
- 진입 화면: Business
- 핵심 동작: 큐브·트리 선택, 화면 진단, 매핑 CSV
- 근거: `main.page.jsx:241-262, 313-330, 442-452` `[확정]`

### `AXSE2-WF-012` 시나리오·TC 생성과 매트릭스 확보

- 분류: `AXSE2-BC-006`
- 진입 화면: Business/Scenario
- 핵심 동작: 생성 요청, 진행 추적, CSV·Excel
- 근거: `main.page.jsx:342-441, 1176-1187` `[확정]`

## 5. 골든 전이 원장

| 전이 | 업무흐름 | 동작 | 결과 |
| --- | --- | --- | --- |
| `AXSE2-E-001` | `AXSE2-WF-001` | 로그인 제출 | 프로젝트 선택 화면 진입 |
| `AXSE2-E-002` | `AXSE2-WF-002` | 프로젝트 목록 조회 | 카드 목록 표시 또는 빈 결과 안내 |
| `AXSE2-E-003` | `AXSE2-WF-003` | 프로젝트 카드 선택 | 셸 진입 |
| `AXSE2-E-004` | `AXSE2-WF-004` | 로그아웃 | 로그인 폼 복귀 |
| `AXSE2-E-005` | `AXSE2-WF-005` | 작업 목록 조회 | 최근 작업 자동 진입 |
| `AXSE2-E-006` | `AXSE2-WF-006` | 새 작업 생성 | 작업 생성 후 UPLOAD 단계 |
| `AXSE2-E-007` | `AXSE2-WF-006` | 작업 전환 | 선택 작업의 단계로 이동 |
| `AXSE2-E-008` | `AXSE2-WF-007` | 업로드 및 파싱 시작 | 진행률 상승 후 PARSED 또는 FAILED |
| `AXSE2-E-009` | `AXSE2-WF-008` | 문서 교체 | 파일 선택 가능 상태로 복원 |
| `AXSE2-E-010` | `AXSE2-WF-009` | 다음 단계 이동 | PARSED_DB 단계 진입 |
| `AXSE2-E-011` | `AXSE2-WF-010` | 탭 전환·검색·페이징 | 해당 목록 재조회 |
| `AXSE2-E-012` | `AXSE2-WF-011` | 업무흐름 선택 | 선택 수 반영과 화면 진단 조회 |
| `AXSE2-E-013` | `AXSE2-WF-011` | 매핑 검증 CSV | 파일 다운로드 |
| `AXSE2-E-014` | `AXSE2-WF-012` | 시나리오·TC 생성 요청 | 진행 화면 이동 |
| `AXSE2-E-015` | `AXSE2-WF-012` | 매트릭스 다운로드 | CSV 또는 Excel 파일 확보 |

## 6. 골든 시나리오 케이스

### 인증·프로젝트

#### `AXSE2-SCN-001` 유효 자격 증명 로그인

- 분류/흐름/kind: `AXSE2-BC-001` / `AXSE2-WF-001` / normal
- preconditions: 아이디·패스워드가 모두 채워진 정상 계정.
- steps:
  1. 로그인 폼에서 아이디와 패스워드를 입력한다.
  2. 로그인을 누른다.
  3. 프로젝트 선택 화면으로 이동하는지 확인한다.
- 근거: `login-form.page.jsx:20-56` `[확정]`

#### `AXSE2-SCN-002` 필수 입력 누락 검증

- 분류/흐름/kind: `AXSE2-BC-001` / `AXSE2-WF-001` / boundary
- preconditions: 아이디 공백 / 패스워드 공백 / 둘 다 공백.
- steps:
  1. 하나 이상의 필수 입력을 비운 채 로그인을 누른다.
  2. 요청이 전송되지 않고 안내 문구가 보이는지 확인한다.
  3. 로그인 폼에 머무는지 확인한다.
- 근거: `login-form.page.jsx:21-24` `[확정]`

#### `AXSE2-SCN-003` 로그인 응답 실패 처리

- 분류/흐름/kind: `AXSE2-BC-001` / `AXSE2-WF-001` / exception
- preconditions: 서버가 비정상 응답을 반환.
- steps:
  1. 자격 증명을 입력하고 로그인을 누른다.
  2. 서버 detail 또는 기본 실패 문구가 보이는지 확인한다.
  3. 로그인 폼에 머무는지 확인한다.
- 근거: `login-form.page.jsx:33-36` `[확정]`

#### `AXSE2-SCN-004` 로그인 네트워크 오류 처리

- 분류/흐름/kind: `AXSE2-BC-001` / `AXSE2-WF-001` / exception
- preconditions: 네트워크가 끊긴 상태.
- steps:
  1. 로그인을 누른다.
  2. 네트워크 오류 문구가 보이는지 확인한다.
- 근거: `login-form.page.jsx:56` `[확정]`

#### `AXSE2-SCN-005` 토큰 claim 파싱 실패 대체

- 분류/흐름/kind: `AXSE2-BC-001` / `AXSE2-WF-001` / normal
- preconditions: accessToken payload가 파싱 불가.
- steps:
  1. 로그인에 성공한다.
  2. 사용자명이 입력한 아이디로 표시되는지 확인한다.
- 근거: `login-form.page.jsx:39-50` `[확정]`

#### `AXSE2-SCN-006` 프로젝트 목록 조회와 선택

- 분류/흐름/kind: `AXSE2-BC-001` / `AXSE2-WF-002` / normal
- preconditions: 프로젝트가 1건 이상.
- steps:
  1. 프로젝트 선택 화면 진입 시 목록이 조회되는지 확인한다.
  2. 프로젝트 카드를 선택한다.
  3. 셸 화면으로 진입하는지 확인한다.
- 근거: `login.page.jsx:22-59` `[확정]`

#### `AXSE2-SCN-007` 프로젝트 0건 안내

- 분류/흐름/kind: `AXSE2-BC-001` / `AXSE2-WF-002` / boundary
- preconditions: 조회 결과가 빈 배열.
- steps:
  1. 프로젝트 선택 화면에 진입한다.
  2. 조회된 프로젝트가 없다는 안내가 보이는지 확인한다.
  3. 선택 가능한 카드가 없는지 확인한다.
- 근거: `login.page.jsx:39-41` `[확정]`

#### `AXSE2-SCN-008` 프로젝트 조회 실패와 재조회

- 분류/흐름/kind: `AXSE2-BC-001` / `AXSE2-WF-002` / exception
- preconditions: 프로젝트 조회가 비정상 응답.
- steps:
  1. 오류 문구에 상태코드가 포함되는지 확인한다.
  2. 새로고침을 눌러 재조회한다.
  3. 재조회가 수행되는지 확인한다.
- 근거: `login.page.jsx:33-37, 74-80` `[확정]`

### TS 작업

#### `AXSE2-SCN-009` 기존 작업 자동 진입

- 분류/흐름/kind: `AXSE2-BC-002` / `AXSE2-WF-005` / normal
- preconditions: 작업이 1건 이상.
- steps:
  1. 셸에 진입한다.
  2. 작업 목록이 조회되고 최근 작업으로 자동 진입하는지 확인한다.
  3. 해당 작업의 ui_stage 화면이 열리는지 확인한다.
- 근거: `main.page.jsx:1471-1482` `[확정]`

#### `AXSE2-SCN-010` 작업 0건 안내

- 분류/흐름/kind: `AXSE2-BC-002` / `AXSE2-WF-005` / boundary
- preconditions: 작업이 없는 프로젝트.
- steps:
  1. 셸에 진입한다.
  2. 좌측 작업 메뉴에서 새 작업을 생성하라는 안내가 보이는지 확인한다.
- 근거: `main.page.jsx:1543` `[확정]`

#### `AXSE2-SCN-011` 신규 작업 생성

- 분류/흐름/kind: `AXSE2-BC-002` / `AXSE2-WF-006` / normal
- preconditions: 작업 생성 권한 보유.
- steps:
  1. 작업 메뉴에서 새로 생성을 누른다.
  2. 작업이 생성되고 해당 단계 화면으로 진입하는지 확인한다.
- 근거: `main.page.jsx:1486-1494` `[확정]`

#### `AXSE2-SCN-012` 작업 전환

- 분류/흐름/kind: `AXSE2-BC-002` / `AXSE2-WF-006` / normal
- preconditions: 작업이 2건 이상.
- steps:
  1. 작업 메뉴에서 다른 작업을 선택한다.
  2. 선택한 작업의 단계 화면으로 이동하는지 확인한다.
- 근거: `Shell:120-135` `[확정]`

#### `AXSE2-SCN-013` 작업 조회·생성 실패 처리

- 분류/흐름/kind: `AXSE2-BC-002` / `AXSE2-WF-006` / exception
- preconditions: 작업 API가 오류 반환.
- steps:
  1. 작업 조회 또는 생성을 수행한다.
  2. 오류 카드가 표시되는지 확인한다.
- 근거: `main.page.jsx:1478, 1491` `[확정]`

### 문서 업로드·파싱

#### `AXSE2-SCN-014` 문서 업로드와 파싱 완료

- 분류/흐름/kind: `AXSE2-BC-003` / `AXSE2-WF-007` / normal
- preconditions: UTF-8 마크다운 문서 준비.
- steps:
  1. 파일을 선택한다.
  2. 업로드 및 파싱 시작을 누른다.
  3. 진행률이 단계별로 오르고 파싱 완료에 도달하는지 확인한다.
- 근거: `upload.page.jsx:88-108` `[확정]`

#### `AXSE2-SCN-015` 작업 없이 업로드하면 작업이 먼저 생성

- 분류/흐름/kind: `AXSE2-BC-003` / `AXSE2-WF-007` / normal
- preconditions: 선택된 작업이 없음.
- steps:
  1. 파일을 선택하고 업로드를 시작한다.
  2. 작업이 자동 생성된 뒤 파싱이 진행되는지 확인한다.
- 근거: `upload.page.jsx:93-98` `[확정]`

#### `AXSE2-SCN-016` 드래그 앤 드롭 파일 선택

- 분류/흐름/kind: `AXSE2-BC-003` / `AXSE2-WF-007` / normal
- preconditions: 파싱 전 상태.
- steps:
  1. 문서를 드롭 영역에 끌어다 놓는다.
  2. 파일이 선택 상태로 표시되는지 확인한다.
- 근거: `upload.page.jsx:171-177` `[확정]`

#### `AXSE2-SCN-017` 파싱 실패 처리

- 분류/흐름/kind: `AXSE2-BC-003` / `AXSE2-WF-007` / exception
- preconditions: 서버 파싱이 실패로 종료.
- steps:
  1. 업로드를 시작한다.
  2. 파싱 실패 문구가 보이고 진행이 멈추는지 확인한다.
- 근거: `upload.page.jsx:70-76` `[확정]`

#### `AXSE2-SCN-018` 파싱 폴링 조회 오류 처리

- 분류/흐름/kind: `AXSE2-BC-003` / `AXSE2-WF-007` / exception
- preconditions: 폴링 중 조회 API 오류.
- steps:
  1. 업로드를 시작한다.
  2. 폴링이 중단되고 오류 문구가 보이는지 확인한다.
- 근거: `upload.page.jsx:78-81` `[확정]`

#### `AXSE2-SCN-019` 파싱 완료 문서 재업로드

- 분류/흐름/kind: `AXSE2-BC-003` / `AXSE2-WF-008` / normal
- preconditions: 파싱이 완료된 작업.
- steps:
  1. 다시 업로드 버튼을 누른다.
  2. 파일 선택이 다시 가능해지는지 확인한다.
- 근거: `upload.page.jsx:110-116` `[확정]`

#### `AXSE2-SCN-020` 선택 파일 해제

- 분류/흐름/kind: `AXSE2-BC-003` / `AXSE2-WF-008` / recovery
- preconditions: 파일만 선택하고 업로드 전.
- steps:
  1. 다시 선택 버튼을 누른다.
  2. 선택이 해제되고 초기 상태로 돌아가는지 확인한다.
  3. 다른 파일을 선택해 업로드를 이어간다.
- 근거: `upload.page.jsx:118-122` `[확정]`

#### `AXSE2-SCN-021` 재업로드 취소

- 분류/흐름/kind: `AXSE2-BC-003` / `AXSE2-WF-008` / boundary
- preconditions: 재업로드 대기 상태.
- steps:
  1. 취소 버튼을 누른다.
  2. 서버 단계 기준 초기 상태로 복원되는지 확인한다.
- 근거: `upload.page.jsx:124-126` `[확정]`

#### `AXSE2-SCN-022` 생성 시작 이후 업로드 잠금

- 분류/흐름/kind: `AXSE2-BC-003` / `AXSE2-WF-008` / boundary
- preconditions: 단계가 생성 중 또는 생성 완료.
- steps:
  1. 업로드 화면에 진입한다.
  2. 업로드가 잠기고 안내 문구가 보이는지 확인한다.
- 근거: `upload.page.jsx:34, 139-143` `[확정]`

### 파싱 데이터 조회

#### `AXSE2-SCN-023` 업무 탭 기본 조회

- 분류/흐름/kind: `AXSE2-BC-004` / `AXSE2-WF-010` / normal
- preconditions: 파싱이 완료된 작업.
- steps:
  1. 파싱 데이터 화면에 진입한다.
  2. 지표 4종과 업무흐름 목록이 보이는지 확인한다.
- 근거: `parsed-db.page.jsx:211-214, 290-296` `[확정]`

#### `AXSE2-SCN-024` 탭 전환 시 검색·페이지 초기화

- 분류/흐름/kind: `AXSE2-BC-004` / `AXSE2-WF-010` / normal
- preconditions: 검색어와 2페이지 이상 상태.
- steps:
  1. 다른 탭으로 전환한다.
  2. 검색어와 페이지가 초기화되고 해당 목록이 조회되는지 확인한다.
- 근거: `parsed-db.page.jsx:264-270` `[확정]`

#### `AXSE2-SCN-025` 검색으로 목록 좁히기

- 분류/흐름/kind: `AXSE2-BC-004` / `AXSE2-WF-010` / normal
- preconditions: 조회 대상 데이터 존재.
- steps:
  1. 검색어를 입력하고 검색 또는 Enter를 누른다.
  2. 1페이지부터 재조회되는지 확인한다.
- 근거: `parsed-db.page.jsx:272-280` `[확정]`

#### `AXSE2-SCN-026` 조회 결과 0건 안내

- 분류/흐름/kind: `AXSE2-BC-004` / `AXSE2-WF-010` / boundary
- preconditions: 일치 항목이 없는 검색어.
- steps:
  1. 검색을 수행한다.
  2. 탭별 빈 결과 안내가 보이는지 확인한다.
- 근거: `parsed-db.page.jsx:38, 70, 105` `[확정]`

#### `AXSE2-SCN-027` 페이지 이동

- 분류/흐름/kind: `AXSE2-BC-004` / `AXSE2-WF-010` / normal
- preconditions: 50건 초과 데이터.
- steps:
  1. 다음을 누른다.
  2. 다음 페이지 데이터와 페이지 표시가 갱신되는지 확인한다.
  3. 이전으로 되돌아올 수 있는지 확인한다.
- 근거: `parsed-db.page.jsx:26-35, 282-285` `[확정]`

#### `AXSE2-SCN-028` 목록 조회 실패 처리

- 분류/흐름/kind: `AXSE2-BC-004` / `AXSE2-WF-010` / exception
- preconditions: 목록 API가 오류 반환.
- steps:
  1. 탭을 조회한다.
  2. 오류 문구가 표시되는지 확인한다.
- 근거: `parsed-db.page.jsx:255-257` `[확정]`

#### `AXSE2-SCN-029` 이슈 화면 진단 확인

- 분류/흐름/kind: `AXSE2-BC-004` / `AXSE2-WF-010` / normal
- preconditions: 진단 API 응답 보유.
- steps:
  1. 파싱 데이터 화면에 진입한다.
  2. 누락·미사용 화면 수 또는 이슈 없음이 표시되는지 확인한다.
- 근거: `parsed-db.page.jsx:171-199` `[확정]`

### 업무흐름 매핑

#### `AXSE2-SCN-030` 업무흐름 개별 선택

- 분류/흐름/kind: `AXSE2-BC-005` / `AXSE2-WF-011` / normal
- preconditions: 업무흐름이 1건 이상.
- steps:
  1. 컨텍스트 큐브에서 업무흐름을 선택한다.
  2. 선택 수가 반영되는지 확인한다.
  3. 다시 눌러 해제되는지 확인한다.
- 근거: `main.page.jsx:241-252` `[확정]`

#### `AXSE2-SCN-031` 업무흐름 전체 선택·해제

- 분류/흐름/kind: `AXSE2-BC-005` / `AXSE2-WF-011` / normal
- preconditions: 업무흐름이 2건 이상.
- steps:
  1. 전체 선택을 누른다.
  2. 전체가 선택되는지 확인한다.
  3. 다시 눌러 전체 해제되는지 확인한다.
- 근거: `main.page.jsx:249-262, 471-477` `[확정]`

#### `AXSE2-SCN-032` 카테고리 트리 선택

- 분류/흐름/kind: `AXSE2-BC-005` / `AXSE2-WF-011` / normal
- preconditions: 카테고리가 1건 이상.
- steps:
  1. 카테고리 트리 탭으로 전환한다.
  2. 카테고리 단위로 선택이 반영되는지 확인한다.
- 근거: `main.page.jsx:466-469` `[확정]`

#### `AXSE2-SCN-033` 업무흐름 화면 진단 조회

- 분류/흐름/kind: `AXSE2-BC-005` / `AXSE2-WF-011` / normal
- preconditions: 선택 가능한 업무흐름 존재.
- steps:
  1. 업무흐름을 선택한다.
  2. 정상·누락·미사용 화면 진단이 표시되는지 확인한다.
- 근거: `main.page.jsx:313-330` `[확정]`

#### `AXSE2-SCN-034` 매핑 검증 CSV 내려받기

- 분류/흐름/kind: `AXSE2-BC-005` / `AXSE2-WF-011` / normal
- preconditions: 매핑 검증 결과 보유.
- steps:
  1. 매핑 검증 CSV 내보내기를 누른다.
  2. 파일이 내려받아지는지 확인한다.
- 근거: `main.page.jsx:442-452` `[확정]`

### 시나리오 생성·결과

#### `AXSE2-SCN-035` 시나리오·TC 생성과 결과 확인

- 분류/흐름/kind: `AXSE2-BC-006` / `AXSE2-WF-012` / normal
- preconditions: 업무흐름이 선택된 상태.
- steps:
  1. 시나리오·TC 도출을 누른다.
  2. 생성 진행 화면으로 이동하는지 확인한다.
  3. 완료 후 추적성 매트릭스가 표시되는지 확인한다.
- 근거: `main.page.jsx:417-441, 1189-1200` `[확정]`

#### `AXSE2-SCN-036` 이미 진행 중인 생성 안내

- 분류/흐름/kind: `AXSE2-BC-006` / `AXSE2-WF-012` / boundary
- preconditions: 다른 생성이 진행 중.
- steps:
  1. 시나리오·TC 도출을 누른다.
  2. 이미 진행 중이라는 안내가 보이고 진행 화면으로 이동하는지 확인한다.
- 근거: `main.page.jsx:421-427` `[확정]`

#### `AXSE2-SCN-037` 다른 흐름 생성 중 프리셋 차단

- 분류/흐름/kind: `AXSE2-BC-006` / `AXSE2-WF-012` / exception
- preconditions: 다른 업무흐름 생성이 진행 중.
- steps:
  1. 프리셋 생성을 연다.
  2. 다른 흐름 생성 중이라는 오류가 보이는지 확인한다.
- 근거: `main.page.jsx:368-370` `[확정]`

#### `AXSE2-SCN-038` 매트릭스 필터·검색 후 다운로드

- 분류/흐름/kind: `AXSE2-BC-006` / `AXSE2-WF-012` / normal
- preconditions: 생성이 완료된 매트릭스.
- steps:
  1. 종류 필터와 검색으로 결과를 좁힌다.
  2. CSV 받기 또는 Excel 다운로드를 누른다.
  3. 파일이 내려받아지는지 확인한다.
- 근거: `main.page.jsx:1168-1187, 1206-1216` `[확정]`

## 7. 추적성 및 coverage baseline

### 기준 수치

| 항목 | 수 |
| --- | --- |
| 업무 분류 | 6 |
| 업무흐름 | 12 |
| 전이 | 15 |
| 시나리오 케이스 | 38 |
| 필수 사용자 여정 | 2 |

### 사용자 여정 → 시나리오·전이 추적

| 여정 | 시나리오 | 전이 |
| --- | --- | --- |
| `AXSE2-J-001` | `AXSE2-SCN-001`, `AXSE2-SCN-006`, `AXSE2-SCN-011`, `AXSE2-SCN-014`, `AXSE2-SCN-023`, `AXSE2-SCN-030`, `AXSE2-SCN-035`, `AXSE2-SCN-038` | `AXSE2-E-001`~`AXSE2-E-015` |
| `AXSE2-J-002` | `AXSE2-SCN-001`, `AXSE2-SCN-006`, `AXSE2-SCN-011`, `AXSE2-SCN-017`, `AXSE2-SCN-020`, `AXSE2-SCN-023`, `AXSE2-SCN-030`, `AXSE2-SCN-035`, `AXSE2-SCN-038` | `AXSE2-E-001`~`AXSE2-E-015` |

### 전이 → 시나리오 역추적

| 전이 | 시나리오 |
| --- | --- |
| `AXSE2-E-001` | `AXSE2-SCN-001`, `AXSE2-SCN-002`, `AXSE2-SCN-003`, `AXSE2-SCN-004`, `AXSE2-SCN-005` |
| `AXSE2-E-002` | `AXSE2-SCN-006`, `AXSE2-SCN-007`, `AXSE2-SCN-008` |
| `AXSE2-E-003` | `AXSE2-SCN-006` |
| `AXSE2-E-004` | — |
| `AXSE2-E-005` | `AXSE2-SCN-009`, `AXSE2-SCN-010` |
| `AXSE2-E-006` | `AXSE2-SCN-011` |
| `AXSE2-E-007` | `AXSE2-SCN-012`, `AXSE2-SCN-013` |
| `AXSE2-E-008` | `AXSE2-SCN-014`, `AXSE2-SCN-015`, `AXSE2-SCN-016`, `AXSE2-SCN-017`, `AXSE2-SCN-018` |
| `AXSE2-E-009` | `AXSE2-SCN-019`, `AXSE2-SCN-020`, `AXSE2-SCN-021`, `AXSE2-SCN-022` |
| `AXSE2-E-010` | `AXSE2-SCN-014` |
| `AXSE2-E-011` | `AXSE2-SCN-023`, `AXSE2-SCN-024`, `AXSE2-SCN-025`, `AXSE2-SCN-026`, `AXSE2-SCN-027`, `AXSE2-SCN-028`, `AXSE2-SCN-029` |
| `AXSE2-E-012` | `AXSE2-SCN-030`, `AXSE2-SCN-031`, `AXSE2-SCN-032`, `AXSE2-SCN-033` |
| `AXSE2-E-013` | `AXSE2-SCN-034` |
| `AXSE2-E-014` | `AXSE2-SCN-035`, `AXSE2-SCN-036`, `AXSE2-SCN-037` |
| `AXSE2-E-015` | `AXSE2-SCN-038` |

## 8. 미해결 사항과 명시적 가정

- 설정 화면의 `초기화`·`저장`·checkbox·select는 handler와 API가 없어 케이스로 승격하지 않았다. `[확정]`
- 로그인 백엔드는 현재 mock이며 PIMS 연동 401·502 분기는 주석 처리돼 있다. 현재 유발 불가라 `AXSE2-SCN-003`에 통합했다. `[확정]`
- `PUT /business-flows/{id}/screens`는 백엔드 라우트가 있으나 프런트엔드 호출부가 없어 케이스로 넣지 않았다. `[확정]`
