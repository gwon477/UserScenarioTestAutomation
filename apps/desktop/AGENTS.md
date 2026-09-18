# desktop

Electron 앱이다. orchestration은 main process가 소유하고 renderer는 상태를 표시한다.

## 프로세스 경계

- `src/main/application/application-orchestrator.ts`가 orchestration의 단일 소유자다. renderer에서 파이프라인 단계를 직접 진행시키지 않는다.
- renderer는 상태를 표시하고 사용자 의도를 IPC로 전달한다. renderer에 도메인 결정 로직(단계 전이, artifact 승격, 재시도 판단)을 두지 않는다.
- IPC 표면은 `src/preload/index.ts`와 `src/shared/desktop-api.ts`에만 정의한다. preload에서 Node 권한을 renderer로 새로 노출하지 않는다.
- Pi는 `src/main/processes/pi-utility-entry.ts`의 UtilityProcess로 실행한다. renderer나 main에서 provider를 직접 호출하지 않는다.

## LLM credential

- credential은 `src/main/security/model-credential-store.ts`의 safe storage만 사용한다.
- API key, endpoint secret, prompt 원문을 renderer state, 로그, 오류 메시지, 파일에 쓰지 않는다.
- 설정 UI(`ModelSettingsModal`)는 저장 여부와 마스킹된 식별자만 표시한다. 저장된 값을 다시 읽어 화면에 채우지 않는다.

## 오류 메시지와 진행 상태 sanitization

- 사용자에게 노출하는 오류는 stage, work ID, 분류된 오류 코드까지다. stack trace 원문과 provider 응답 본문을 그대로 표시하지 않는다.
- 진행 상태는 `AnalysisProgress`가 backend event만 반영한다. renderer에서 진행률을 추정해 채우지 않는다.
- 분석 실패 화면에 표시하는 오류 코드는 `analysis-error.ts`의 `classifyAnalysisError`를 통과한 것만이다. 코드 모양이 아닌 메시지는 표시하지 않는다. provider 응답 본문, stack trace, 프롬프트 원문이 새지 않게 하는 경계다.
- 실패 시 진행률을 0으로 되돌리지 않는다. 어느 단계에서 실패했는지가 사라진다.
- provider 오류와 artifact/schema 오류를 같은 메시지로 합치지 않는다. 사용자가 재시도 가능 여부를 구분할 수 있어야 한다.

## 디자인 시스템

`docs/mockups/redesign-v2.html` 의 `<style>` 이 정본이다.

- 토큰은 `styles/base.css` 의 `:root` 가, 컴포넌트 어휘는 `styles/system.css` 가 소유한다. 규칙을 바꿔야 하면 목업을 먼저 고친다. 한쪽만 고치면 두 정본이 갈라진다.
- 아이콘은 `IconSprite` 스프라이트 + `Icon` 래퍼만 쓴다. 이모지를 아이콘으로 쓰지 않는다. 스프라이트는 문서에 한 번만 마운트한다.
- `--accent` 는 헤어라인·밑줄·틱·포커스 전용이다(3.66:1). 채움 버튼은 `--accent-btn`, 틴트 위 글자는 `--accent-ink` 를 쓴다.
- 상태는 색만으로 구분하지 않는다. `.chip` 과 `.mark` 에 글리프를 함께 붙이고, 「확인 필요」는 「대기」와 다른 글리프를 쓴다.
- 셸은 `titlebar -> topbar -> tabs -> body` 다. `.app-shell` 은 뷰포트 높이에 고정되고 본문만 스크롤한다. 셸 전체가 스크롤하면 탭이 밀려 올라가 현재 위치를 잃는다.
- 상세 화면은 `AppShell` 의 `layout="split"` 을 쓴다. 3분할 패널이 각자 스크롤하려면 본문이 스크롤하지 않아야 한다.
- 목록은 `.rows.tbl` 의 `--cols` 로 컬럼 축을 고정한다. 행마다 폭이 달라지면 세로 정렬이 깨진다.
- 시나리오 시트는 `--sc` 축을 헤더·행·세부가 공유한다. 세부 패널의 왼쪽 정렬선은 ID 컬럼 시작선에 맞춘다.
- 목업에 없는 기능은 목업 어휘로 만든다. 새 클래스 이름을 만들기 전에 `system.css` 에 쓸 수 있는 것이 있는지 본다.
- 구현에 없는 동작을 버튼으로 두지 않는다. 눌러 보고 나서야 없다는 것을 알게 된다.

- 아이콘 원천은 스프라이트 하나다. 외부 아이콘 라이브러리를 다시 들이지 않는다. 앱 전용 글리프(`sf-src`, `sf-gate`, `sf-mask`)가 스프라이트에만 있어 두 원천이 섞이면 획 굵기와 모서리가 갈라진다.
- 게이지는 `Gauge` 만 쓴다. 값은 backend 진행 이벤트만 반영한다.

## 프로젝트 레지스트리

- 목록의 원천은 `src/main/security/project-registry.ts`다. 항목은 사용자가 디렉터리 선택 대화상자로 고른 경로만이고, renderer가 준 경로를 그대로 넣지 않는다.
- renderer가 경로를 보내는 채널(`projects:open`, `projects:reveal`, `projects:delete-analysis`)은 `authorizeRegisteredRoot`를 거친다. 레지스트리에 없는 경로는 `PROJECT_DIRECTORY_NOT_REGISTERED`로 거절한다.
- 경로가 사라진 항목을 목록에서 지우지 않는다. 「경로 없음」으로 보여주고 다시 지정하게 한다. 조용히 지우면 사용자는 자기 프로젝트가 어디로 갔는지 알 수 없다.
- 연결 해제와 삭제를 분리한다. 해제는 되돌리기 토스트가 붙는 가역 동작이고, 되돌릴 경로는 main이 세션 메모리에 들고 있는다. renderer가 되돌릴 경로를 보내지 않는다.
- 분석 결과 삭제는 되돌릴 수 없다. 지우는 대상은 프로젝트 루트 바로 아래의 `.scenarioforge` 하나뿐이고, 그 경로가 루트 안에 있음을 다시 확인한다. 원본 소스코드는 건드리지 않는다.
- 그 프로젝트에서 분석이 진행 중이면 삭제를 거절한다(`orchestrator.isAnalysisRunning`).
- 삭제 확인 대화상자는 삭제량을 먼저 보여주고, 확인 버튼 라벨에 결과를 쓴다. 「확인」만 있으면 무엇이 지워지는지 모른다.
- 레지스트리 문서는 `project-directory.v1.json` 파일 이름을 유지한다. v1(경로 하나)을 읽어 첫 항목으로 옮기므로 기존 설치가 프로젝트를 잃지 않는다.

## 생성 이력 원천

- 목록의 원천은 `.scenarioforge/runs` 다. `run-summary.ts`가 manifest 와 등록된 산출물에서 만든다. renderer 저장소에 두지 않는다. 예전에는 localStorage 였고, 새 프로필이나 다른 기기에서는 디스크에 run 이 있어도 목록이 비어 보였다.
- manifest 를 못 읽는 run 도 목록에 남긴다. `complete: false` 로 표시하고 열기를 막는다. 조용히 숨기면 디스크에 있는 run 을 사용자가 볼 수 없다.
- 산출물이 없는 칸은 「대기」로 둔다. 0 으로 채우면 아무것도 안 나온 것과 아직 안 만든 것을 구별할 수 없다.
- 소요 시간은 디스크에 남지 않으므로 표시하지 않는다. 없는 값을 추정해 채우지 않는다.
- 목록은 등록 여부만 본다. content hash 는 run 을 열 때 `loadCanonicalRun` 이 검증한다.

## 목록 표시 형식

- 날짜·시각과 바이트 크기는 `renderer/src/format.ts` 만 쓴다. 화면마다 다른 형식을 쓰면 같은 값이 다르게 보인다.
- 목록의 시각은 24시간제이고 초를 쓰지 않는다. 목업이 그렇고, 초는 결정에 쓰이지 않으면서 컬럼 폭만 먹는다.
- 바이트는 값 크기에 단위를 맞춘다. 201 B 를 「0 KB」로 내리면 증적이 없다고 읽힌다.

## 프로젝트 범위 탭

- 탭은 개요 / 생성 이력 / 테스트 실행 / 증적 네 개이고 각각 자체 라우트를 갖는다.
- 「테스트 실행」과 「증적」은 프로젝트 범위다. 사용자가 보는 단위는 「내가 돌린 테스트 전부」이고 「run X의 테스트」가 아니다. `loadTestExecutions`·`loadEvidenceLibrary` 를 run 없이 부르면 `listRunIds` 로 모든 run 을 걷는다.
- run 하나가 정본 검증에 실패해도 나머지 목록을 지우지 않는다. 실패한 run 은 「생성 이력」에서 진단한다.
- 증적 항목은 소속 `runId` 를 함께 나른다. 없으면 다른 run 의 증적을 잘못된 트리에서 읽는다.
- 탭을 비활성으로 잠그지 않는다. 비어 있으면 빈 상태가 왜 비었는지와 다음 동작을 말한다.

## 테스트 수행 입력 규칙

- 테스트 설정 폼의 필드 목록은 renderer 가 정하지 않는다. `src/main/application/test-requirements-view.ts`가 정본 artifact 에서 도출한 `TestExecutionRequirements`가 결정한다.
- 자유 형식 JSON 을 기본 입력으로 두지 않는다. 사용자가 스키마를 암기해야 하고, 검증이 전부-아니면-전무가 되어 어느 값이 왜 틀렸는지 말할 수 없다.
- 비밀값은 마스킹 입력으로 받고 화면에 되돌려 표시하지 않는다. 예시나 placeholder 에 비밀값 형태 문자열을 넣지 않는다.
- 마스킹 대상은 필수 입력이다. 가려지지 않으면 실행이 중단되므로 무엇이 가려지는지 실행 전에 보여준다.
- 판정 사유 코드는 main 이 주고 표시 문구는 renderer 가 소유한다. 사유를 감춘 채 「확인 필요」만 표시하지 않는다.

정본 artifact 를 읽을 때는 manifest `schema_version` 1·2 를 모두 받고 artifact type 은 `scenario-set`, `fact-bundle`, `wiki-bundle` 을 쓴다. 하네스가 그렇게 등록한다.

## 실행 상태 소유권

- `executionId` 와 `batchId` 는 `TestCoordinator` 가 만든다. renderer 도 main 도 ID 를 만들지 않는다.
- renderer 는 실행 객체를 조립하지 않는다. `test:list-executions` 로 main 이 투영한 상태만 읽는다.
- `queued` 결과를 받은 뒤에만 테스트 센터로 이동한다. CTA 를 누른 시점에 이동하지 않는다.
- 사람이 읽는 동작·기대 결과는 정본 시나리오에서 온다. 실행 계획은 참조만 갖는다.

## 대상 화면 실행 규칙

`src/main/application/test-vista-service.ts`가 대상 화면을 소유한다.

- 실행마다 **격리된 in-memory session**(`partition: test-vista-{executionId}`)을 쓴다. `persist:` 를 붙이지 않는다. 기본 session 을 공유하면 이전 실행이나 사용자가 남긴 로그인 상태가 시나리오의 진입 전제를 깬다. 실측에서 이미 로그인된 화면이 캡처돼 대상을 찾지 못한 사례가 있다.
- 진입 URL 로드 뒤 화면이 그려질 때까지 기다린 다음 첫 캡처를 한다. `loadURL` 은 load 이벤트에서 끝나고 프레임워크 렌더가 남는다.
- `http`, `https` 외 scheme 은 열지 않는다. 새 창과 다른 origin 이동은 차단한다.
- plan 은 정본 batch artifact 에서만 읽는다. renderer 가 준 계획을 실행하지 않는다.
- 아직 `QUEUED` 인 batch 만 수행한다.
- 조작은 `sendInputEvent` 와 `insertText` 로 합성한다. DOM `.click()` 을 쓰지 않는다. 사람과 같은 입력 경로여야 증적이 실사용을 대표한다.
- 마스킹 오버레이는 캡처 직후 제거한다. 선택자 중 하나라도 덮지 못하면 프레임을 넘기지 않는다.

## 수행 모델 호출

`src/main/application/vision-model-client.ts`가 operator 와 observer 호출을 담당한다.

- 두 역할을 별도 요청으로 분리한다. 자기 행동을 스스로 성공 판정하지 않게 하기 위해서다.
- 프롬프트에 자격증명, 데이터 원문, 내부 식별자를 담지 않는다.
- 응답 본문을 오류 메시지로 노출하지 않는다. 상태 코드와 분류만 남긴다.
- 모델이 «못 찾았다»고 답하거나 좌표가 숫자가 아니면 `null` 을 돌려준다. 좌표를 만들어내지 않는다.
- 이 호출은 Pi 가 아니므로 main 에서 직접 수행한다. Pi provider 호출 규칙은 그대로 UtilityProcess 를 따른다. 수행 모델 호출을 UtilityProcess 로 옮기는 것은 후속 과제다.

## 증적 읽기 규칙

- 증적 파일은 renderer 가 직접 열지 않는다. `src/main/application/evidence-view.ts`가 정본 실행 트리 안에서만 읽어 data URL 로 넘긴다.
- 모든 경로는 실행 트리 안에 있어야 한다. `.png` 외 확장자와 크기 상한 초과는 거절한다.
- 지원하지 않는 `schemaVersion` 은 추측하지 않고 거절한다.
- 증적 상세는 기록이 있으면 fixture 타임라인을 렌더하지 않는다. 가짜 시각을 실제 데이터 옆에 두지 않는다.
- 제안 좌표 오버레이는 `model-input` 프레임에만 겹친다. 그 프레임이 판정 근거다.
- 마스킹된 영역은 「마스킹됨」으로 표시한다. 표시가 없으면 검은 사각형이 렌더링 오류로 읽힌다.

## 증적 라이브러리 규칙

- 목록은 `evidence-library-view.ts`가 정본 실행 트리를 걸어 만든다. fixture 목록과 섞지 않는다.
- 필터 축은 판정, 검토 상태, 사유 코드, `causeTag`, 케이스 ID 다. 하나라도 빠지면 실행이 반복될 때 못 찾는다.
- `causeTag` 집계를 반드시 보여준다. 같은 원인이 반복되면 개별 케이스가 아니라 생성 산출물을 고쳐야 한다는 신호다.
- 증적 삭제는 되돌릴 수 없다. 명시적 요구 없이 추가하지 않는다.

## Fixture 사용 규칙

- `src/renderer/src/test-execution-fixture.ts`는 UI 개발용 fixture다. 실제 분석 결과처럼 화면에 흘리지 않는다.
- fixture 데이터로 기능 완료를 판단하지 않는다. 테스트 수행 기능은 아직 구현되지 않았다고 가정한다.
- fixture는 명시적으로 fixture임이 드러나는 경로에서만 사용하고, 실제 backend 응답과 같은 컴포넌트 상태에 섞지 않는다.

## 집중 테스트

```
npm run test --workspace @scenarioforge/desktop
npm run typecheck --workspace @scenarioforge/desktop
npm run build
```

Electron 실행(`npm run dev`)은 사용자 승인이 필요하다. 자동 검증 단계에서 임의로 띄우지 않는다.
