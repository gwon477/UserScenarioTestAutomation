# RUN-AXSE-AGENTIC-20260904-07 business-classification review

## 판정

- 실제 Pi/Azure 실행: `gpt-5.6-luna`로 성공
- artifact 상태: locally validated, unregistered probe
- 제품 stage acceptance: 수행하지 않음
- source snapshot: `SS-19f2efec-21de-4298-bfdd-30b76f39b940`
- source root hash: `sha256:c19d65de32e7f75ccde82a97b70c1fe32f4f4f5eba5753e05e85c5e435a5f4e0`
- prior artifact hash: `sha256:04217cf3497715c04b72a8283bae1aac2c382c24dedb61d405e5bd4cc90de187`
- agent artifact hash: `sha256:02d66f6b530e6a52f19f7aa6e964da5b84309389d22d0406849b0063e3e4e266`
- final artifact hash: `sha256:c63a24f0e06f5fa9543a2a46519eab18acafcd969afecd77559bb6130f95a5b1`
- tool usage: required artifact 3개 읽기, bounded closure 6회, cumulative 41,465 bytes, durable artifact write 1회
- 분류 결과: 표준 관점 14개 평가, 12개 classified, 2개 not-evidenced, category 33개, unresolved 2개
- evidence: 현재 단계 6개 grant를 backend가 33개 category에 결합, 빈 binding 0개
- Pi transcript: in-memory session을 사용해 파일을 생성하지 않음

이 판정은 다축 `03-business-classification`의 로컬 계약과 원본 의미 검토를 통과했다는 뜻이다. backend artifact 등록, work scope 승인 또는 ScenarioForge 제품 stage 완료를 의미하지 않는다.

## 분류 체계

`business-capability`는 사용자 결과 중심의 1차 taxonomy다. 검증된 source area 6개를 정확히 한 번씩 분류한다. 나머지 관점은 같은 source area가 여러 category에 속할 수 있는 교차 taxonomy다.

| 관점 | 판정 | category 수 | AXSE에서 확인된 구분 |
| --- | --- | ---: | --- |
| user-role | classified | 1 | 테스트 시나리오 생성 작업 수행자 |
| authorization-scope | classified | 1 | 인증 세션과 선택 프로젝트에 한정된 작업 접근 |
| organization-scope | not-evidenced | 0 | 테넌트·팀·부서·소유권 경계 미확인 |
| business-capability | classified | 6 | 인증/프로젝트, 작업/단계, 업로드/파싱, 데이터 검토, 매핑/생성 요청, 결과/내보내기 |
| business-responsibility | classified | 2 | 입력·파싱 준비, 매핑 정합성·생성 범위 확인 |
| workflow-stage | classified | 4 | 진입, 업로드/파싱, 검토/매핑, 생성/결과 |
| lifecycle-state | classified | 3 | 문서 파싱, 시나리오 생성, TS 작업 단계 상태 |
| data-domain | classified | 2 | 파싱된 업무 구조, 시나리오 추적성 데이터 |
| channel-surface | classified | 3 | 대화형 화면, 파일 업로드, 파일 다운로드 |
| input-source | classified | 2 | MD/TXT 문서, 업무흐름 선택·검색 조건 |
| output-deliverable | classified | 3 | 파싱 검토, 매핑·생성 진행, CSV/Excel 추적성 파일 |
| integration-boundary | classified | 3 | 인증/세션, 작업·파싱·조회, 생성·exporter 연계 |
| risk-recovery | classified | 3 | 로그인·조회, 업로드·파싱, 생성·다운로드 복구 |
| compliance-policy | not-evidenced | 0 | 감사·개인정보·보존·규제 정책 미확인 |

분류 agent는 category ID나 executable target을 만들지 않았다. 의미 category와 prior source-area/journey 참조만 작성했고, evidence ref·grant·hash는 backend가 결합했다.

## 원본 대조

- 로그인 폼과 프로젝트 선택 화면은 인증·프로젝트 진입, 세션 범위, 진입 단계 분류를 지원한다.
- 메인 셸의 작업 자동 선택·생성, bootstrap, 단계 guard는 TS 작업 및 단계 관리와 lifecycle 분류를 지원한다.
- 업로드 화면은 MD/TXT 입력, 업로드·파싱 상태, 실패 후 재선택·재업로드 분류를 지원한다.
- Parsed DB의 탭·검색·페이징·진단은 파싱 데이터 검토와 data-domain 분류를 지원한다.
- 업무 매핑 화면의 선택·정합성·프리셋·생성 요청은 business responsibility와 capability 분류를 지원한다.
- 생성 진행, 실행 이력, 결과 필터·검색·상세, CSV/Excel은 결과 검토·산출물·integration 분류를 지원한다.
- 실제 사용자 역할 차이, 세부 권한 정책, 조직 경계는 source가 확정하지 않으므로 별도 역할이나 권한을 창작하지 않았다.
- 생성 실패·부분 완료 뒤 재요청 및 기존 결과 보존 규칙도 unresolved로 유지했다.

## 골든 사후 비교

후보 생성과 원본 검토 전에는 골든을 모델에 제공하지 않았다. 후보가 생성된 뒤 `SCENARIOFORGE_GOLDEN_DATASET.md`의 업무 분류만 외부 기준으로 비교했다.

| 후보 1차 업무 기능 | 골든 대응 |
| --- | --- |
| 인증하고 프로젝트 작업공간에 진입하기 | `AXSE-BC-001` |
| TS 작업 수명주기와 단계 접근을 관리하기 | `AXSE-BC-002` |
| TS 작업에 문서를 업로드하고 구조화 데이터로 준비하기 | `AXSE-BC-003` |
| 파싱된 업무 데이터를 조회하고 진단하기 | `AXSE-BC-004` |
| 업무흐름과 연결 화면의 매핑을 검증하고 생성 요청하기 | `AXSE-BC-005` |
| 생성 결과를 확인하고 추적성 산출물을 내보내기 | `AXSE-BC-006` |

핵심 업무 분류 범위는 6/6 대응한다. 역할·권한·단계·상태·데이터·입출력·복구 등의 27개 교차 category는 골든 정답을 복제한 것이 아니라 동일 source를 다른 사용자 관점으로 탐색한 결과다.

## 실패 및 보정 이력

- `failed-01`, `failed-02`: 모델이 영역별 evidence ref를 반복 배치하지 않아 거부됐다. evidence 소유권을 backend로 옮겨 의미 분류와 증거 결합을 분리했다.
- `failed-03`: closure 전 미기록 제출이 single-write 기회를 소비했다. 전제조건 실패는 durable write로 계산하지 않도록 수정했다.
- `rejected-04`: 계약은 통과했지만 1차 업무 기능을 하나의 umbrella category로 합쳐 원본·골든 사후 검토에서 거부했다.
- `failed-05`: 영역과 source ref 연결을 모델이 다시 추론하다 closure를 생략했다. backend가 source-area support metadata를 제공하고 필수 도구 순서를 명시했다.

## 다음 단계 경계

다음 proof는 별도 승인 뒤 같은 AXSE run의 `04-user-journeys` 한 단계다. `03-business-classification`의 6개 1차 업무 기능과 source survey의 정상·복구 thread를 연결하되, unresolved 권한·조직·재요청 규칙을 확정 사실로 바꾸지 않는다. scenario case, coverage, RA-DAR 일반화는 계속 보류한다.
