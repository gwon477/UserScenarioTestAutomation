# 화면 01 — 프로젝트 소스 선택

## 화면의 역할

최초 실행 사용자가 ScenarioForge의 역할을 이해하고, 분석 대상이 될 로컬 소스 디렉터리를 선택한다. 이 화면에서는 모델이나 실행 옵션을 동시에 받지 않는다.

## 사용자 목표

- 제품이 무엇을 하는지 짧게 이해한다.
- 분석할 소스 디렉터리를 선택한다.
- 선택한 디렉터리가 작업 범위라는 점을 확인한다.

## 정보 순서

1. ScenarioForge 제품명과 3단계 설정 진행 상황
2. `소스코드에서, 사용자가 걷는 길을 단조합니다.`
3. 로컬 소스 디렉터리를 선택해야 하는 이유
4. 단일 Primary CTA `소스 디렉터리 선택`
5. 소스가 사용자 경로로 변환되는 Blueprint 미리보기

## 상태

| 상태 | Primary CTA | 보조 피드백 |
| --- | --- | --- |
| 기본 | 소스 디렉터리 선택 | 선택한 디렉터리가 작업 범위임을 안내 |
| 선택 중 | 디렉터리 여는 중 | 버튼 비활성화 |
| 선택 완료 | 이 프로젝트로 시작 | 선택한 프로젝트 이름/경로 표시 |
| 오류 | 소스 디렉터리 선택 | 원인과 해결 방법을 CTA 아래 표시 |

## UI 중립 계약

- 명령: `project.selectDirectory`
- 결과: `{ name: string, path?: string } | null`
- 후속 명령: `onboarding.confirmProject`
- 후속 화면: 화면 02 `LLM 모델 및 엔드포인트 설정`

Electron renderer에서는 preload가 노출한 `selectProjectDirectory`를 호출한다. 웹 미리보기에서는 `showDirectoryPicker`로 대체한다.

## termcn/TUI 대응

같은 명령과 상태를 사용하고 표현만 바꾼다.

- Blueprint 시안 → `Directory Tree`와 단계형 `List`
- Primary CTA → 키보드 포커스를 가진 `Confirm` 또는 `File Picker`
- 선택 중 → `Spinner`와 상태 메시지
- 오류 → 사라지는 Toast가 아닌 고정 `Alert`

termcn 컴포넌트를 Electron DOM에 이식하지 않고, `project.selectDirectory` 계약을 공유하는 별도 클라이언트로 취급한다.

## 디자인 시스템 적용

- Blueprint Navy 네 가지 브랜드 색과 시맨틱 오류색만 사용
- Plus Jakarta Sans, 제목 2.75rem 이하
- 2px radius, 단일 카드 그림자
- 화면당 Primary CTA 하나
- Lucide 아이콘, 44px 이상의 인터랙션 타깃
- 포커스 링과 reduced-motion 지원
