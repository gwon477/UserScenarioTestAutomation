# 화면 02 — LLM 연결 설정 모달

## 진입 조건

- 새 프로젝트 디렉터리를 선택한 뒤 모델 설정 또는 필수 역할 credential이 없을 때만 자동으로 연다.
- 비밀값을 제외한 모델 설정과 OS 보호 credential이 모두 복원되면 모달을 건너뛰고 프로젝트 작업대로 이동한다.
- 프로젝트 작업대의 `LLM 설정` 버튼으로 다시 열 수 있다.

## 배경과 집중

프로젝트 작업대 위에 모달을 띄우고 Navy 반투명 막과 9px backdrop blur를 적용한다. 모달이 열린 동안 배경은 읽을 수만 있고 조작 대상이 아니다.

## 입력 순서

현재 화면은 같은 모달 안에서 생성 모델 역할을 다음처럼 분리한다.

- **저작 모델(author)** — FACT 추출, 모호 link 판정, WIKI·시나리오 저작. 필수.
- **검토 모델(reviewer)** — evidence 의미 검토. 선택이지만 미설정 시 결과 assurance를 `single-model`로 표시.
- **화면 그라운딩 모델(guiGrounder)** — 구조화 target reference가 없는 visual/CUA step의 화면 위치 탐색·OCR. 선택이며 semantic-only 실행에는 불필요.

기본 화면에는 저작 모델 1세트만 먼저 보이고 `독립 reviewer 사용`을 켰을 때 reviewer provider·endpoint·model ID·별도 API key·전송 동의가 펼쳐진다. guiGrounder 설정은 TestVista 구현 범위에서 추가한다. model ID와 endpoint, 세션 credential reference는 역할별로 독립 관리한다.

1. 모델 공급자 — OpenAI 호환 / Azure OpenAI / Anthropic / 사용자 지정
2. 엔드포인트 — URL 고정 라벨과 인라인 검증
3. 모델 ID — 엔드포인트에서 호출할 모델명. Azure OpenAI에서는 deployment 이름
4. API Version — Azure OpenAI 선택 시 필수 (`2024-12-01-preview` 등)
5. API 키 — 표시/숨기기와 보안 저장 안내. Azure OpenAI에서는 `api-key` 헤더로 전송

Primary CTA는 `설정 저장`이다. 저장된 credential이 있으면 보안 안내 영역에서 `저장된 키 삭제`를 제공한다. 오류는 각 필드 옆에 원인과 수정 방법을 고정 표시한다.

원격 endpoint를 선택하면 분석에 필요한 source slice가 해당 endpoint로 전송될 수 있음을 저장 전에 표시한다. author와 reviewer endpoint가 다르면 두 전송 대상을 각각 보여준다. guiGrounder는 source가 아니라 테스트 화면 screenshot이 전송될 수 있으므로 `local-only | internal-network | approved-remote` 데이터 경계를 별도로 표시하고 승인되지 않은 등급의 화면은 전송하지 않는다.

## 보안 계약

- Renderer → preload: `saveModelSettings`, `getModelCredentialStatus`, `clearModelCredentials`
- main은 이를 `author`와 선택적 `reviewer` binding으로 변환하고 프로젝트에는 credential reference만 기록한다.
- Electron main은 `safeStorage`로 키를 암호화해 `app.getPath("userData")/model-credentials.v1.json`에 저장한다. 선택 프로젝트 내부에는 저장하지 않는다.
- 저장 identity는 역할, 공급자, credential이 제거된 정규화 endpoint, Azure API version으로 구성한다. model/deployment 변경은 같은 endpoint key를 유지하지만 공급자·endpoint 변경은 자동 재사용하지 않는다.
- renderer에는 `storageAvailable`, `hasAuthorCredential`, `hasReviewerCredential`만 반환하고 키 원문이나 암호문을 반환하지 않는다.
- OS 암호화를 사용할 수 없으면 평문 fallback 없이 현재 main process 세션 메모리만 사용한다.
- 브라우저 프로토타입은 공급자·엔드포인트·모델만 localStorage에 저장한다.
- API 키는 브라우저 저장소, 프로젝트 파일, `.scenarioforge` journal/session/artifact, console log에 기록하지 않는다.

## termcn/TUI 대응

- Modal → `Dialog`
- 공급자 → `Radio Group`
- Endpoint/Model → `Text Input`
- API 키 → `Password Input`
- 오류 → 필드 하단 고정 `Status Message`

동일한 `saveModelSettings` 명령을 사용하고 렌더러만 달리한다. termcn은 Electron DOM 컴포넌트가 아니라 별도 CLI를 제공할 때만 적용한다.
