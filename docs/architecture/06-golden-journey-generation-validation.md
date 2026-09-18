# 골든 사용자 여정 생성 설계 검증

- 작성일: 2026-09-03
- 대상: `test_project_source/axse-agents`
- 모델: 실제 Azure OpenAI `gpt-5.6-luna`
- 단계: 1차 격리 설계 검증 및 단계형 Pi `01-source-survey`·`02-source-gap-review` 실증 완료
- 검증 산출물: `/private/tmp/scenarioforge-axse-journey-probe-20260903-20/result.json`, `docs/validation/axse-agentic-analysis/RUN-AXSE-AGENTIC-20260904-07/01-source-survey.json`, `docs/validation/axse-agentic-analysis/RUN-AXSE-AGENTIC-20260904-07/02-source-gap-review/02-source-gap-review.json`

## 1. 검증 질문과 판정

검증 질문은 “골든 문서를 모델 입력으로 주지 않고 실제 소스만 분석했을 때, ScenarioForge가 업무 분류를 근거 있게 도출하고 그 분류를 따라 로그인부터 업무 결과와 로그아웃까지 이어지는 사용자 여정을 만들 수 있는가”이다.

**판정: 조건부 적합.** 독립 설계 probe는 AXSE 골든의 업무 분류 6개, 업무흐름 10개, 필수 사용자 여정 2개를 모두 의미적으로 재현했다. 다만 이 결과는 새로운 계약의 타당성을 입증한 것이며, 현재 제품의 `SRC → FACT → WIKI → SCENARIO` 구현이 이미 이 계약으로 동작한다는 뜻은 아니다. 시나리오 44건의 분기 확장과 transition coverage 판정도 이번 단계 범위가 아니다.

## 2. 평가 기준

골든 데이터셋은 다음 구조를 기준으로 한다.

| 단위 | 골든 수 | 이번 단계의 합격 기준 |
| --- | ---: | --- |
| 업무 분류 | 6 | 의미 recall 80% 이상 |
| 업무흐름 | 10 | 의미 recall 80% 이상 |
| 사용자 여정 | 2 | 정상·복구 여정 모두 존재 |
| 분기 시나리오 | 44 | 이번 단계에서는 생성·coverage 평가하지 않음 |
| 전이 | 90 | 향후 골든 coverage 원장으로 사용 |

구조 검증은 별도로 다음을 강제했다.

- 업무 분류, 업무흐름, 여정의 참조 ID가 실제 후보 안에 존재한다.
- 모든 milestone은 사용자가 수행하거나 관찰할 action/outcome과 실제 파일·라인 근거를 갖는다.
- 단계 간 상태 전달은 `produced_by → consumed_by` handoff로 연결된다.
- 여정은 업무 산출물과 로그아웃·handoff·process-end 중 하나의 명시적 종료를 갖는다.
- 복구 여정은 실패 milestone과 정상 흐름으로 재진입하는 milestone을 모두 갖는다.

## 3. 기존 생성 결과의 기준선

기존 완료 run `RUN-e4e375ef-f74f-439c-9c46-222ab084989b`은 65/65 edge, 즉 100% transition coverage를 기록했다. 그러나 생성된 67개 시나리오의 최대 길이는 3 step이었고, 인증을 포함한 시나리오 11개, 다운로드를 포함한 시나리오 6개, 로그아웃을 포함한 시나리오 2개가 서로 분리되어 있었다. 로그인 → 업무 산출물 → 로그아웃을 한 흐름으로 완주한 시나리오는 0개였다.

따라서 개별 edge coverage만으로 “사용자가 화면을 따라 솔루션을 end-to-end로 경험할 수 있다”는 목표를 증명할 수 없다. 사용자 여정은 coverage보다 앞선 별도 합격 게이트여야 한다.

## 4. 검증한 생성 구조

```text
실제 소스 37개
  → chunk별 원천 finding 109개
  → backend가 실행 가능한 UI finding 28개를 1:1 보존
  → LLM은 scope / journey role / recovery 의미만 annotation
  → source reviewer
  → 업무 분류 7개 / 업무흐름 11개
  → taxonomy reviewer
  → 정상·복구 사용자 여정 조립
  → source reviewer
  → 마지막에만 골든과 독립 비교
```

핵심 소유권은 다음과 같다.

| 정보 | 소유자 | 이유 |
| --- | --- | --- |
| finding ID, action, outcome, source path/range | backend | LLM repair가 근거를 병합·삭제·변조하지 못하게 함 |
| scope, journey role, recovery scope | LLM semantic patch | 소스 전반을 읽고 사용자 의미를 연결해야 함 |
| 업무 분류와 업무흐름 설명 | LLM + source reviewer | 프로젝트마다 다른 업무 언어를 허용하되 근거로 검증 |
| state handoff, 업무 결과, 종료 | LLM + 구조 validator + source reviewer | 화면 단위 사실을 연속 사용자 여정으로 조립 |
| 골든 유사성 | 독립 evaluator | 생성 prompt가 정답을 보지 못하게 분리 |

이 구조는 단계별로 완벽한 문서를 요구하지 않는다. 누락·애매함은 `unresolved` 또는 reviewer issue로 다음 보정 단계에 전달한다. 단, ID·근거 경로·실행 가능한 UI finding 보존·참조 무결성처럼 다음 단계가 안전하게 보정할 수 없는 경계는 fail-closed한다.

## 5. 실제 Azure 결과

### 5.1 소스와 중간 산출물

| 항목 | 결과 |
| --- | ---: |
| 선택 소스 | 37 files |
| source map chunk | 8 |
| 원천 finding | 109 |
| 실행 가능한 UI linked finding | 28 |
| backend 결정론적 보정 | 0 |
| source-link 독립 review | 첫 시도 통과, issue 0 |
| 후보 업무 분류 | 7 |
| 후보 업무흐름 | 11 |
| taxonomy review | 3회째 통과 |

후보 개수는 골든과 일치하도록 강제하지 않았다. 하나의 후보 분류가 여러 골든 범위를 포함하거나 업무 경계가 더 세분화될 수 있으므로 의미 범위와 진입/종료 조건을 비교했다.

### 5.2 골든 유사성

| 평가 | 결과 |
| --- | ---: |
| 업무 분류 recall | 6/6 = 100% |
| 업무흐름 recall | 10/10 = 100% |
| 필수 사용자 여정 recall | 2/2 = 100% |
| 정상 E2E `J-001` | similarity 0.98 |
| 복구 E2E `J-002` | similarity 0.98 |
| critical gap | 0 |

`J-001`은 로그인 → 프로젝트/작업 → 업로드/파싱 데이터 → 업무 분류/매핑 CSV/프리셋 → 생성/결과 매트릭스 → CSV/Excel → 로그아웃을 18 milestones와 13 handoffs로 연결했다.

`J-002`는 파싱 실패 → 파일 제거·교체 → 교체 파일 재파싱 성공을 명시적으로 연결한 뒤, 파싱 데이터 검토 → 업무 분류 → 매핑 CSV → 생성/결과 매트릭스 → CSV/Excel → 로그아웃까지 14 milestones와 10 handoffs로 연결했다.

최종 source reviewer는 `pass=true`를 반환했다. 함께 반환한 내용 없는 placeholder issue 1건은 reviewer 출력 정규화 규칙에 따라 의미 있는 issue가 아닌 것으로 제외되었다.

## 6. 반복 실패에서 확인한 설계 결함과 해소

초기 probe가 계속 실패한 주된 이유는 소스가 사용자 여정을 지지하지 않아서가 아니라 생성·repair 단위가 너무 컸기 때문이다.

1. taxonomy와 사용자 여정을 한 번에 생성하면 응답 길이 한계에 도달해 빈 결과가 발생했다.
2. reviewer issue를 반영할 때 전체 객체를 다시 쓰게 하면 이미 맞는 업무 분류·근거·여정을 합치거나 지우는 회귀가 발생했다.
3. chunk 단위 finding을 LLM이 병합하게 하면 실행 가능한 UI action이 유실되거나 backend-only 동작이 사용자 action으로 승격될 수 있었다.

해소한 원칙은 다음과 같다.

- source extraction, semantic annotation, taxonomy, journey assembly를 분리한다.
- backend가 원천 UI finding을 1:1 보존하고 LLM은 semantic patch만 제출한다.
- taxonomy가 source review를 통과하면 journey repair에서 immutable로 둔다.
- repair는 해당 단계의 semantic payload만 교체하고 이전 단계 산출물은 유지한다.
- reviewer의 빈 placeholder는 실패 사유로 해석하지 않는다.
- 골든은 생성 중 사용하지 않고 최종 독립 평가에만 사용한다.

## 7. 제품 설계에 대한 결론

ScenarioForge가 어느 프로젝트에서든 사용자 여정을 만들려면 기존 `SRC → FACT → WIKI → SCENARIO`를 다음 의미로 유지해야 한다.

- `SRC`: 실행 가능한 UI 동작과 이를 뒷받침하는 API/상태 근거를 손실 없이 inventory한다.
- `FACT`: backend 소유 ID·근거에 LLM semantic annotation을 더하며, 부분 누락은 unresolved로 전달한다.
- `WIKI`: 업무 분류와 workflow뿐 아니라 persona, entry, business outcome, state handoff, recovery rejoin을 갖는 사용자 여정 골격을 만든다.
- `SCENARIO`: 확정된 여정 골격을 정상·경계·예외·복구 case로 확장한다. workflow·edge·element ID를 바꾸지 않는다.

합격 순서는 `근거 무결성 → 사용자 여정 완결성 → 분기 시나리오 충실도 → 골든 transition coverage`여야 한다. 의미적 부족은 다음 단계에서 보정할 수 있지만, 근거 유실과 참조 변조를 허용해서는 안 된다.

## 8. 남은 검증

이번 결과만으로 다음 항목은 아직 증명되지 않았다.

- 새 계약을 실제 ScenarioForge FACT/WIKI/SCENARIO runtime에 통합했을 때 동일하게 생성되는지
- AXSE 골든 44개 분기 시나리오가 유사하게 생성되는지
- 골든 90개 transition 기준 coverage가 얼마인지
- 다른 구조의 RA-DAR에서도 같은 설계가 일반화되는지
- 데스크톱 UI에서 로그인부터 결과 다운로드와 로그아웃까지 제품 E2E가 성공하는지

다음 단계는 이 계약을 제품 전체에 한꺼번에 적용하지 않고, 먼저 단계형 Pi의 `02-source-gap-review`에서 artifact-to-artifact 보정이 성립하는지 AXSE로 검증하는 것이다. 그 후 FACT→WIKI 경계의 journey skeleton 통합 여부를 판단한다.

## 9. 단계형 Pi agent 실증 checkpoint — 2026-09-04

격리 JSON 변환 probe와 별도로, 실제 `@earendil-works/pi-coding-agent`에 Azure `gpt-5.6-luna`를 연결하고 한 assignment씩 source를 다시 읽는 구조의 첫 단계가 `RUN-AXSE-AGENTIC-20260904-07`에서 성공했다.

### 9.1 실행 경계와 결과

| 항목 | RUN-07 결과 |
| --- | ---: |
| model-facing source inventory | 95 files |
| scanner route / API / interaction | 8 / 2 / 63 |
| inventory read | 1회 |
| bounded source closure | 10회 |
| cumulative granted source | 197,166 bytes |
| artifact write | 1회 |
| source area | 5개 |
| provisional thread | 2개 |
| explicit source gap | 4개 |
| cited evidence | 16개 |

test, fixture, docs/generated scenario, hidden metadata, mock data, golden-like path는 server-owned allowlist로 inventory와 closure 양쪽에서 제외했다. Pi session은 in-memory로 실행해 source와 prompt transcript를 남기지 않았다. 모델 출력은 strict schema, source snapshot, granted evidence, source ref, secret, raw-source overlap을 durable write 전에 검사했다.

결과 artifact는 `locally-validated-unregistered-probe`다. 실제 source-capable Pi가 유효한 1단계 산출물을 만들 수 있음을 증명하지만 backend 등록이나 ScenarioForge 제품 stage acceptance를 증명하지 않는다.

### 9.2 원본 및 골든 사후 판정

생성 agent는 골든을 보지 않았다. 원본 대조 후 골든 구조와 비교한 결과는 다음과 같다.

- 인증·프로젝트, 업로드·파싱, 파싱 데이터, 업무흐름 매핑·생성 요청, 시나리오 결과·CSV/Excel의 5개 범위는 source area로 도출됐다.
- TS 작업 선택·생성 및 단계 내비게이션은 정상 thread milestone으로는 도출됐지만 독립 source area가 아니다.
- 정상 thread는 로그인에서 결과까지 연결하지만 마지막을 “CSV/Excel 다운로드 또는 로그아웃”으로 표현해 다운로드 후 로그아웃이라는 순차 terminal이 확정되지 않았다.
- 로컬 업로드/파싱 recovery는 도출했지만 같은 로그인 진입에서 복구 후 결과 다운로드와 로그아웃까지 가는 full recovery thread는 없다.
- 프리셋 미리보기는 전체 사용자 여정이 아니라 workflow-sized thread로 올바르게 분리했다.

따라서 `01-source-survey` 계약은 통과했고, 완결 사용자 여정은 아직 불합격이다. 다음 `02-source-gap-review`는 `orchestrator-gaps.json`의 세 semantic gap만 보정하며, business classification·scenario case·coverage로 진행하지 않는다.

### 9.3 현재 설계 판정

단계형 source-capable Pi 구조는 유효하다. 이전처럼 모든 단계의 완전한 결과를 한 응답에 강제할 필요 없이, 1단계가 source-backed 의미와 명시적 gap을 남기고 다음 assignment가 특정 source를 다시 읽도록 할 수 있다.

첫 checkpoint에서 남은 증명 항목은 artifact-to-artifact continuation이었다. 이어지는 `02-source-gap-review` 결과는 아래와 같으며, FACT/WIKI/SCENARIO 제품 통합이나 RA-DAR 일반화는 별도 후속 검증으로 남긴다.

### 9.4 artifact-to-artifact correction 결과

같은 RUN-07과 source snapshot에서 실제 Pi/Azure `02-source-gap-review`를 수행했다. 모델은 prior survey, orchestrator gap, model-safe inventory를 읽고 gap에 허용된 source ref 6개만 두 번의 bounded closure로 다시 읽었다. prior artifact hash, snapshot ID, root hash를 서버가 검사했고, correction은 source area 1개와 journey thread 2개에 제한됐다.

세 semantic gap은 모두 해소됐다. TS 작업 선택·생성, bootstrap, 단계 guard, 메인 로그아웃이 독립 source area로 추가됐다. 정상 thread는 로그인부터 프로젝트, 작업, 업로드, Parsed DB, 업무흐름, 생성, 최종 매트릭스, CSV, Excel, 로그아웃까지 순차화됐다. 복구 thread는 동일한 로그인 진입에서 업로드/파싱 실패, 파일 재선택 또는 재업로드, 정상 흐름 재합류, Excel 다운로드와 로그아웃까지 이어진다. 원본 검토 뒤에만 골든과 비교했고 `AXSE-J-001`, `AXSE-J-002`, `AXSE-BC-002`의 필수 범위와 대응했다.

기존 비대상 source area, 프리셋 thread, supporting systems, internal exclusion, explicit source gap은 보존됐다. 코드 리뷰에서 최초 병합 artifact가 prior evidence catalog를 누락한 것을 발견해 그 시도는 별도 rejected 디렉터리에 보존했다. 수정 실행은 prior 16개와 stage-local 6개 evidence grant를 각각 재검증하고 merged catalog 22개를 기록했으며, survey의 고유 evidence ref 22개와 정확히 대응한다. correction과 merged artifact의 실제 파일 hash도 validation metadata와 일치했다. 따라서 artifact-to-artifact continuation과 명명 section correction checkpoint는 통과했다.

결과는 여전히 `locally-validated-unregistered-probe`이며 backend 등록이나 제품 stage acceptance가 아니다. 다음 proof는 별도 승인 뒤 `03-business-classification` 한 단계만 수행한다. scenario case, coverage, RA-DAR 일반화는 계속 보류한다.

### 9.5 다축 business classification 결과

같은 RUN-07과 source snapshot에서 실제 Pi/Azure `03-business-classification`을 수행했다. 단일 고정 taxonomy 대신 사용자 역할, 접근 권한, 조직 범위, 업무 기능, 업무 책임, workflow 단계, lifecycle 상태, data domain, channel, input, output, integration, recovery, compliance의 14개 표준 관점을 모두 평가하고 source가 지원하는 관점만 분류했다. 별도의 `project-specific` 관점도 source가 요구할 때 추가할 수 있다.

`business-capability`는 source area별 1차 업무 taxonomy로 제한했다. 인증·프로젝트, TS 작업·단계, 문서 업로드·파싱, 파싱 데이터 검토, 업무흐름 매핑·생성 요청, 생성 결과·추적성 산출물의 6개 category가 각각 한 source area를 소유한다. 나머지 관점은 같은 area를 중첩 참조할 수 있고 총 27개 교차 category가 도출됐다. 조직 범위와 compliance는 근거가 없어 `not-evidenced`로 남겼고, 실제 역할별 권한 및 생성 실패 후 재요청·결과 보존 규칙은 unresolved로 유지했다.

모델은 category ID, evidence metadata, executable target을 만들지 않는다. 모델은 의미와 prior source-area/journey 참조만 작성하고 backend가 현재 grant를 area support와 결합했다. 이번 실행은 source ref 6개를 6회의 bounded closure로 다시 읽고 41,465 bytes를 grant했으며, 33개 category 모두에 최소 하나의 현재 evidence binding이 있다. agent artifact와 final artifact hash는 validation metadata와 일치한다.

첫 contract-pass 후보는 모든 업무 기능을 하나의 umbrella category로 합쳐 원본 검토에서 거부했다. 최종 계약은 각 source area를 정확히 하나의 1차 업무 기능으로 유지하고, source가 여러 값을 보이는 교차 관점은 복수 category로 나누도록 한다. 후보 생성과 원본 검토 뒤 골든 업무 분류와 비교한 결과 `AXSE-BC-001`~`AXSE-BC-006` 범위가 6/6 대응했다.

결과는 `locally-validated-unregistered-probe`이며 backend 등록이나 제품 stage acceptance가 아니다. 다음 proof는 별도 승인 뒤 `04-user-journeys` 한 단계만 수행한다. scenario case, coverage, RA-DAR 일반화는 계속 보류한다.

### 9.6 complete user journeys 결과

같은 RUN-07과 source snapshot에서 실제 Pi/Azure `04-user-journeys`를 수행했다. 모델에는 locally validated 02·03 의미 산출물과 backend가 투영한 불투명 `C001…` 분류 참조만 제공했고, canonical journey ID, executable target, evidence metadata, golden 내용은 제공하지 않았다. 모델은 13개 source slice를 다시 읽고 정상 1개와 복구 1개의 complete journey를 만들었다.

정상 여정은 로그인에서 프로젝트·TS 작업, 문서 업로드·파싱, Parsed DB 검토, 업무흐름 매핑·생성 요청, 진행 확인, 시나리오·테스트 케이스 및 CSV·Excel 추적성 산출물, 로그아웃까지 연결한다. 복구 여정은 같은 진입과 persona에서 업로드/API 또는 파싱 실패를 확인하고 파일 제거·재선택 및 재업로드로 정상 흐름에 합류해 같은 핵심 산출물과 로그아웃까지 도달한다. 프리셋 미리보기는 workflow-sized fragment로 제외했다. 두 여정 모두 6개 primary business capability를 포함하고, 13개 milestone과 11개 인접 state handoff가 있으며 모든 milestone에 현재 evidence가 결합됐다.

첫 실제 후보는 source thread와 맞지 않는 분류 참조를 사용해 거부됐고, 분류별 허용 thread 투영을 추가했다. 이후 source review는 정상/복구 결과 표현 차이와 혼합 문자 오타를 gap으로 반환했다. 여정 순서 같은 의미 오류를 수정한 두 번째 제출이 기존 실행기의 duplicate guard에 막히는 문제도 발견했다. 최종 실행기는 trust-boundary 위반은 즉시 종료하되, 영구 기록 전에 발견된 의미 오류는 동일 Pi session에서 최대 3회 교정하고 실제 성공 write 뒤에만 duplicate를 차단한다. 최종 audit는 3회 의미 제출 중 1회만 영구 기록됐음을 보여준다.

후보를 원본과 대조한 뒤 외부 평가와 비교했고 필수 정상·복구 여정과 6개 업무 범위가 대응했다. 복구 prerequisite가 실패 입력과 유효 교체 입력을 명시적으로 구분하지 않은 점은 다음 case 생성 단계의 비종결 correction input으로 남겼다. 다음 생성 agent에는 외부 평가 문서가 아니라 원본에서 다시 확인할 질문과 source ref만 담은 model-safe gap을 제공한다. scenario case breadth, transition coverage, RA-DAR는 평가하지 않았다.

결과는 `locally-validated-unregistered-probe`이며 backend 등록이나 제품 stage acceptance가 아니다. 다음 proof는 별도 승인 뒤 `05-scenario-cases` 한 단계만 수행한다.
