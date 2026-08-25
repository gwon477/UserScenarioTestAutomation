# 설치형 UI 스택 조사와 적용 결정

조사일: 2026-08-25

## 결론

ScenarioForge의 기본 화면은 **Electron + electron-vite + React + TypeScript**로 유지한다. 공통 대화상자, 드로어, 선택 컨트롤, 툴팁 등은 다음 UI 확장 작업부터 **shadcn/ui(Base UI 기반)**를 디자인 시스템 토큰에 맞춰 선택적으로 도입한다. 시나리오가 수백~수천 건으로 늘어나는 시점에는 **TanStack Table/Virtual**을 시나리오 시트의 상태·가상화 엔진으로 붙인다.

`termcn`이나 `OpenGUI`를 화면 전체의 기반으로 포크하지 않는다. 둘은 참고 가치가 크지만 ScenarioForge의 결정적 워크플로우 UI를 직접 대체하는 컴포넌트 스택은 아니다.

## 후보 비교

| 후보 | 실제 성격 | ScenarioForge 적용 판단 |
| --- | --- | --- |
| [termcn](https://www.termcn.dev/docs) | Ink/OpenTUI 위에서 동작하는 React 기반 터미널 UI 레지스트리 | Electron Renderer는 Chromium DOM이므로 메인 GUI 대체재가 아니다. 추후 별도 CLI를 제공할 때 `packages/cli`에서 검토한다. |
| [OpenGUI](https://github.com/akemmanuel/OpenGUI) | Electron 기반 코딩 에이전트 완제품이며 Host/Harness까지 포함 | 컴포넌트 라이브러리로 소비하기보다 프로세스 분리, 세션, 스트리밍 구조의 참고 구현으로 사용한다. 완제품 포크는 ScenarioForge 도메인과 디자인 시스템을 맞추는 비용이 크다. |
| [OpenUI](https://github.com/thesysdev/openui) | 모델이 구조화 UI를 스트리밍 생성하는 Generative UI 런타임과 채팅 UI | 분석 결과가 확정 스키마인 시나리오 시트에는 과하다. 추후 채팅이 차트·보고서 아티팩트를 생성해야 할 때 왼쪽 채팅 영역에 한정해 PoC한다. |
| [shadcn/ui](https://ui.shadcn.com/docs) + [Base UI](https://ui.shadcn.com/docs/changelog/2026-07-base-ui-default) | 접근성 프리미티브를 기반으로 실제 컴포넌트 소스를 프로젝트가 소유하는 레지스트리 | 디자인 시스템의 2px radius와 색상 토큰을 유지하면서 Dialog, Sheet, Select, Tooltip 등을 재사용하기에 가장 적합하다. 다음 화면 확장부터 점진 적용한다. |
| [React Aria Components](https://react-aria.adobe.com/getting-started) | 접근성·국제화·상호작용을 제공하는 무스타일 컴포넌트 | shadcn/Base UI로 충족되지 않는 복합 키보드 상호작용이 생길 때 보완 후보로 유지한다. 두 프리미티브를 같은 기능에 중복 사용하지 않는다. |
| [TanStack Table](https://tanstack.com/table/latest/docs/overview) | 디자인 비의존형 테이블/데이터그리드 상태 엔진 | 대규모 시나리오의 정렬, 필터, 행 선택, 펼침, 가상화에 적합하다. 현재 6건 목업에서는 도입하지 않는다. |
| [xterm.js](https://github.com/xtermjs/xterm.js/) | Chromium/Electron에 넣을 수 있는 실제 터미널 프런트엔드 | pi-coding-agent 로그나 대화형 PTY가 필요할 때 사용한다. 단순 진행 로그에는 일반 React 로그 뷰가 더 접근성이 좋다. |

## 이번 커밋에 적용한 범위

- `electron-vite`가 권장하는 main / preload / renderer 분리를 적용한다.
- Renderer에는 Node.js 권한을 주지 않는다.
- 파일 선택과 향후 분석·테스트 실행은 명시적인 typed IPC 채널만 사용한다.
- 현재 화면과 진행률은 목업으로 유지한다.
- API 키는 이 단계에서 디스크에 저장하지 않고 Electron 세션 메모리에서만 보관한다.
- `pi-coding-agent`, ScenarioForge 하네스, 스킬, 서브에이전트는 구현하지 않고 `packages/agent-runtime` 경계만 예약한다.

## 후속 도입 순서

1. shadcn/ui(Base UI) 토큰을 ScenarioForge 디자인 시스템에 매핑한다.
2. 기존 Modal, Test Execution Sheet부터 접근성 프리미티브로 교체한다.
3. 시나리오 데이터 규모가 확정되면 TanStack Table/Virtual을 도입한다.
4. 채팅 스트리밍 계약이 확정되면 OpenUI와 자체 chat shell을 짧은 PoC로 비교한다.
5. 실제 PTY 상호작용이 요구될 때만 xterm.js와 main-process PTY 브리지를 추가한다.

## Electron 보안 기준

[Electron 공식 보안 체크리스트](https://www.electronjs.org/docs/latest/tutorial/security)를 기준으로 `contextIsolation`, renderer sandbox, `nodeIntegration: false`, 제한된 preload bridge, 신규 창 차단을 기본값으로 둔다. 분석 대상 파일 읽기와 프로세스 실행 권한은 main 또는 격리된 Utility Process 안에만 둔다.
