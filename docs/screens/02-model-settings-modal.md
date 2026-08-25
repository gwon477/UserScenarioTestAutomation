# 화면 02 — LLM 연결 설정 모달

## 진입 조건

- 새 프로젝트 디렉터리를 선택한 직후 자동으로 연다.
- 프로젝트 작업대의 `LLM 설정` 버튼으로 다시 열 수 있다.

## 배경과 집중

프로젝트 작업대 위에 모달을 띄우고 Navy 반투명 막과 9px backdrop blur를 적용한다. 모달이 열린 동안 배경은 읽을 수만 있고 조작 대상이 아니다.

## 입력 순서

1. 모델 공급자 — OpenAI 호환 / Anthropic / 사용자 지정
2. 엔드포인트 — URL 고정 라벨과 인라인 검증
3. 모델 ID — 엔드포인트에서 호출할 모델명
4. API 키 — 표시/숨기기와 보안 저장 안내

Primary CTA는 `설정 저장` 하나다. 오류는 각 필드 옆에 원인과 수정 방법을 고정 표시한다.

## 보안 계약

- Renderer → preload: `saveModelSettings({ provider, endpoint, model, apiKey })`
- 현재 Electron 목업은 API 키를 main process의 세션 메모리에만 보관한다.
- 후속 구현에서 OS 보안 저장소 연동과 키 교체 정책을 추가한다.
- 브라우저 프로토타입은 공급자·엔드포인트·모델만 localStorage에 저장한다.
- API 키는 브라우저 저장소와 프로젝트 파일에 기록하지 않는다.

## termcn/TUI 대응

- Modal → `Dialog`
- 공급자 → `Radio Group`
- Endpoint/Model → `Text Input`
- API 키 → `Password Input`
- 오류 → 필드 하단 고정 `Status Message`

동일한 `saveModelSettings` 명령을 사용하고 렌더러만 달리한다. termcn은 Electron DOM 컴포넌트가 아니라 별도 CLI를 제공할 때만 적용한다.
