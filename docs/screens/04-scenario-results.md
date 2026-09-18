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
- 각 케이스는 실행 준비 상태를 표시: `실행 가능`, `데이터 연결 필요`, `자동화 불가`, `미확인 근거 포함`
- 위 상태는 target 선택 전 생성 자산 기준이다. target과 환경을 선택한 뒤에는 `대상 실행 가능`, `대상 미지원`, `환경 차단`, `CUA 필요`를 별도 preflight 결과로 표시한다.
- 상세에서 `actionRef`·`assertionRefs`의 사용자용 요약과 관련 FACT/WIKI 근거를 조회할 수 있게 하되 내부 locator 문자열은 기본 화면에서 숨긴다.
- 행 전체는 채팅으로 드래그할 수 있지만 drag preview와 전송 payload에는 ID만 포함

시트 상단에는 run 전체의 all-transitions·each-choice 커버리지, unresolved/assumed 수, model assurance(`independent-reviewer` 또는 `single-model`)를 요약한다. 수치는 검증된 artifact에서 읽고 생성 중 활동량으로 계산하지 않는다.

## 테스트 선택

각 케이스의 실행 준비 상태는 손으로 표시하지 않는다. `compileVisionSteps`(`packages/test-runtime`)의 결과에서 파생한다. 컴파일러가 step 단위로 무엇이 부족한지 이미 확정하므로, 화면은 그 사유를 사용자 언어로 옮기기만 한다.

| 컴파일 결과 | 시트 표시 | 선택 | 사용자가 할 일 |
| --- | --- | --- | --- |
| envelope 생성됨 | `실행 가능` | 가능 | 없음 |
| `MISSING_DATA_BINDING` | `데이터 연결 필요` | 가능 | 설정 패널에서 해당 값 입력 |
| `NO_VISUAL_TARGET_EVIDENCE` | `자동화 불가 · 화면 대상 근거 없음` | 불가 | 생성 트랙에 FACT 라벨 보완 요청 |
| `AMBIGUOUS_VISUAL_TARGET` | `자동화 불가 · 대상 구별 불가` | 불가 | 같은 화면에 같은 라벨이 여럿이고 대조 후보도 없음 |
| `ACTION_KIND_UNRESOLVED` | `미확인 근거 포함 · 동작 미확정` | 불가 | FACT 재확인 |
| `ACTION_KIND_UNSUPPORTED` | `자동화 불가 · 미지원 동작` | 불가 | 실행 IR 확장 검토 대상 |
| `MISSING_ASSERTION_REFERENCE` | `미확인 근거 포함 · 판정 기준 없음` | 불가 | 판정할 것이 없는 step |
| `EDGE_NOT_FOUND` / `ELEMENT_NOT_FOUND` | `미확인 근거 포함 · 근거 참조 불일치` | 불가 | 생성 산출물 참조 무결성 문제 |

- 사유는 행 안에 텍스트로 표시한다. hover tooltip만으로 제공하지 않는다.
- 헤더 전체 선택은 `실행 가능`과 값이 채워진 `데이터 연결 필요`만 선택한다.
- 선택 불가 케이스의 체크박스는 비활성으로 두고 사유를 그 자리에 남긴다. 숨기지 않는다. 사용자는 왜 못 고르는지 알아야 한다.
- 케이스 하나를 선택했다고 설정 패널을 자동으로 열지 않는다. 하단에 `N개 선택` 액션 바를 띄우고, 사용자가 `테스트 설정`을 눌렀을 때 패널을 연다.
- 패널을 닫거나 `선택 해제`를 누르면 선택 상태를 초기화한다.

## 테스트 설정 패널

### 설계 원칙

폼을 손으로 설계하지 않는다. **선택한 케이스의 컴파일 결과가 필요한 필드 목록을 결정한다.** 필요 없는 섹션은 렌더링하지 않는다. 자유 형식 JSON을 기본 입력으로 쓰지 않는다. JSON은 고급 탭의 escape hatch로만 남긴다.

이유는 두 가지다. 자유 JSON은 사용자에게 스키마를 암기시키고, 검증이 전부-아니면-전무가 되어 어느 값이 왜 틀렸는지 말할 수 없다.

### 섹션과 컨트롤

1. **대상 유형** - 라디오 그룹: `웹 / Windows 앱 / Android / iOS / 원격 화면`. 미구현 유형은 목록에서 지우지 않고 비활성 상태와 사유를 함께 표시한다.
2. **유형별 진입 정보** - schema-driven 필드
   - 웹: entry URL, browser/channel(번들 또는 설치본 라디오), 허용 origin 목록
   - Windows: 설치 앱 또는 executable reference, process/window 범위, 실행 desktop
   - Android/iOS: device, app package/bundle, 시작 context
   - 원격 화면: 승인된 session과 window 범위
3. **환경 확인** - 폼 필드가 아니라 명령이다. 누르면 semantic adapter 가용성, visual/CUA fallback 필요 여부, driver·device·desktop lease, `guiGrounder` 필요 여부를 결과 패널로 보여준다. 확인 전에는 실행 CTA를 비활성으로 두고 그 이유를 CTA 옆에 텍스트로 쓴다.
4. **테스트 데이터** - `dataBindingKeys` 하나당 필드 하나를 생성한다. 필드 타입은 FACT element에서 가져온다.

   | FACT element type | 컨트롤 |
   | --- | --- |
   | `textbox` | 단일행 텍스트 |
   | `password-textbox` | 마스킹 입력 |
   | `select` | 실제 옵션을 담은 select |
   | `file-upload` | 파일 선택 |

   각 필드에는 어느 케이스·step이 그 값을 쓰는지 함께 표시한다. 선택한 케이스가 값을 요구하지 않으면 이 섹션 자체를 표시하지 않는다.
5. **마스킹 대상** - 필수 입력이다. FACT의 password 계열 element에서 기본 목록을 도출하고 사용자가 확인·추가한다. 마스킹 실패는 프레임 전송 생략이 아니라 실행 중단(`FRAME_MASKING_FAILED`)이므로, 무엇이 가려지는지 실행 전에 사용자가 알아야 한다.
6. **파괴적 동작 허용** - 선택한 케이스에 `destructive` step이 있을 때만 표시하는 단일 체크박스. 기본값은 해제다. 허용하지 않으면 gate가 해당 step을 거절한다.
7. **실행 예산** - `maxModelCalls`, `maxScreenshots`, `timeoutMs`. 기본값을 채워 `고급`에 접어 둔다. 숫자 세 개를 기본 노출하지 않는다.
8. **고급 · JSON** - 위 값들의 동등한 JSON 표현. 붙여넣으면 폼 필드로 역파싱해 채운다. 파싱 실패 시 어느 키가 문제인지 필드 옆에 표시한다.

### 비밀값 취급

- 값은 마스킹 입력으로 받고 화면에 되돌려 표시하지 않는다.
- 예시나 placeholder에 비밀값 형태의 문자열을 넣지 않는다. 예시가 평문 붙여넣기를 가르치면 경고문보다 예시가 이긴다.
- plan, event, artifact, 증적에는 binding key와 참조만 기록한다. 원문은 command 처리와 Runner 메모리에만 존재한다.
- 실제 개인정보 대신 테스트 전용 값을 쓰라는 경고를 데이터 섹션 안에 둔다.

### CTA와 요청 상태

- 활성 execution이 없으면 Primary CTA는 `N개 테스트 수행`이다.
- 활성 execution이 있으면 현재 target profile을 읽기 전용으로 표시하고 Primary CTA를 `대기열에 N개 추가`로 바꾼다.
- CTA를 누른 뒤 다음 네 상태를 구분해 표시한다. 하나의 정적 메시지로 합치지 않는다.

  `요청 검증 중 → 환경 확인 중 → 실행 계획 준비 중 → 대기열 등록`

- 대기열 등록 event가 오기 전에는 테스트가 시작됐다고 표시하지 않는다. Renderer가 `executionId`를 만들거나 실행 객체를 조립하지 않는다.
- 계획이 거절되면 선택과 입력을 유지하고 케이스별 미해결 target binding·assertion을 그 자리에 표시한다.

현재 PoC 요청 계약은 웹 fixture용 `startScenarioTests({ project, runId, scenarioIds, targetUrl, personalData })`이다. 목표 backend에서는 이를 `ExecutionTargetProfileInput`과 `DataBindingInput`으로 교체하고, 활성 execution이 없을 때 `test.createExecution`, 있을 때 `test.enqueueScenarios`로 분기한다. create는 새 `executionId`와 최초 `batchId`, enqueue는 기존 snapshot/plan을 변경하지 않는 새 immutable batch를 반환한다. Renderer가 ID를 생성하거나 adapter를 선택하거나 locator·automation ID·좌표를 확정하거나 자연어 step을 Runner 명령으로 변환하지 않는다.

테스트 센터 표시는 [`05-test-center.md`](05-test-center.md), 증적과 코멘트는 [`06-evidence.md`](06-evidence.md)를 따른다.

## termcn/TUI 대응

- 좌측 채팅 → `Chat Thread`, `Chat Message`, `Text Area`
- 시나리오 시트 → `Data Grid`, `Tabbed Content`, `Checkbox`
- 케이스 상세 → `Collapsible` 형태의 행 확장
- 테스트 설정 → `Drawer`, `Path/Input`, `JSON`, `Confirm`

TUI에서 포인터 드래그가 어려운 경우 `참조 추가` 명령으로 같은 백틱 ID 토큰을 입력한다.
