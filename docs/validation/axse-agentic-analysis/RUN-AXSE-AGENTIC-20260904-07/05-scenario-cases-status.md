# AXSE 05 scenario-cases 진행 상태

기준일: 2026-09-07

## 현재 판정

- `05-scenario-cases`는 아직 성공 단계가 아니다.
- run marker는 마지막으로 로컬 검증된 `04-user-journeys`에 유지되어 있다.
- 제품 backend artifact 등록과 product stage acceptance는 시도하지 않았다.
- AXSE 05가 통과하기 전에는 RA-DAR 또는 coverage 단계로 진행하지 않는다.

## 생성·평가 이력

1. 최초 유효 후보는 정상·경계·예외·복구 각 1건, 총 4건을 생성했고 로컬 계약 및 소스 검토를 통과했다.
2. 후보 생성 이후에만 실행한 외부 golden 평가는 여정 2/2와 핵심 capability 6/6을 확인했지만, case breadth 4/44와 보수적 explicit transition coverage 25/90으로 불충분하다고 판정했다.
3. 해당 후보와 검토 자료는 `05-scenario-cases-external-evaluation-failed-02`에 보존했다.
4. 첫 보정 시도는 허용되지 않은 artifact ID 요청으로 실패했으며 `05-scenario-cases-correction-failed-03`에 보존했다. runner는 이후 허용 ID를 명시하고 미등록 ID 요청을 즉시 중단하도록 수정했다.
5. 후속 보정 시도 두 건은 공급자 `PROVIDER_RATE_LIMIT`으로 종료됐으며 각각 `05-scenario-cases-correction-rate-limited-04`, `05-scenario-cases-correction-rate-limited-05`에 보존했다.
6. 교체한 author credential로 실행한 보정은 rate limit 없이 artifact 작성까지 진행했지만, J002 전용 C015·C031·C033을 J001 case에 적용해 `SCENARIO_CASE_CLASSIFICATION_REF_INVALID`로 종료됐다. 해당 실행은 `05-scenario-cases-correction-classification-ref-failed-06`에 보존했다.
7. 모델 입력의 평면 classification catalog를 여정별 허용 classification 그룹으로 교체한 뒤 실행한 보정은 source closure 중 다시 `PROVIDER_RATE_LIMIT`으로 종료됐다. 해당 실행은 `05-scenario-cases-correction-rate-limited-07`에 보존했다.
8. 전체 05 재생성 대신 backend correction plan과 patch-only 제출 계약을 적용한 첫 실행은 모델이 잘못된 addition과 누락 target을 제출해 `SCENARIO_CASE_NOT_WRITTEN`으로 종료됐다. 해당 실행은 `05-scenario-cases-correction-not-written-08`에 보존했다.
9. target별 독립 컴파일과 부분 병합을 추가한 실행은 partial merge 뒤 갱신된 base hash를 모델이 다시 읽지 않아 `SCENARIO_CASE_CORRECTION_BASE_MISMATCH`로 fail-closed했다. 해당 실행은 `05-scenario-cases-correction-base-mismatch-09`에 보존했다.
10. 동적 prior/plan 재읽기를 backend가 강제한 실행은 모델이 milestone과 다른 canonical source-area ref를 제출해 `SCENARIO_CASE_STEP_AREA_MISMATCH`로 fail-closed했다. 해당 실행은 `05-scenario-cases-correction-step-area-mismatch-10`에 보존했다.
11. correction addition에서 `kind`, `journey_ref`, `source_area_refs`를 제거하고 backend가 주입하도록 바꾼 실행에서는 부분 보정이 실제 동작했다. 두 번째 patch의 CT002 case만 base에 병합되어 hash가 변경됐고 retry plan은 CT001·CT003·CT004로 축소됐으며, 모델도 갱신된 prior와 plan을 다시 읽었다. 이후 provider `PROVIDER_RATE_LIMIT`으로 종료되어 최종 revision은 저장하지 않았고, 실행은 `05-scenario-cases-correction-rate-limited-11`에 보존했다.
12. 동일 입력을 다시 실행한 결과 provider rate limit 없이 revision 2 전체 병합과 로컬 계약 검증까지 완료했다. 첫 patch의 CT001·CT004는 유지되고 실패한 CT002·CT003만 재검토되어 두 번째 patch로 보정됐다. 다만 소스·외부 의미 검토에서 전체 case 수가 4개에서 8개로만 증가했고 다수의 독립 source branch가 여전히 별도 case로 누락됐음을 확인했다. 따라서 05 성공으로 확정하지 않고 후보를 `05-scenario-cases-external-evaluation-failed-12`에 보존하며 run marker를 04에 유지한다.
13. 04 transition correction 사전검증에서 survey가 분모에 포함하지 못한 interaction을 발견해 공통 scanner 계약을 수정했다. 검증된 04 revision 2는 69개 obligation 중 33개를 milestone에 연결하고 36개를 unresolved로 보존했다.
14. 05 입력 검증의 transition 전용 source scope와 revision 간 evidence-grant 탐색을 공통 backend 경계에서 보강했다. 모델 호출 전 실패는 각각 `05-scenario-cases-transition-source-scope-failed-13`, `05-scenario-cases-evidence-lineage-failed-14`에 보존했다.
15. 첫 Luna correction patch는 35개 target 중 34개가 유효했고 CT035만 unchanged로 실패했다. backend replay/resume 계약을 추가해 성공 target을 보존했으며 실패 후보는 `05-scenario-cases-partial-patch-failed-15`에 보존했다.
16. CT035-only 재검토 중 잘못된 source ref 요청은 fail-closed했고 `05-scenario-cases-resume-source-scope-failed-16`에 보존했다. 같은 한 target만 새 세션에서 재시도해 revision 3 로컬 계약 검증을 완료했다.
17. 외부 의미 평가에서 33개 transition ref가 첫 normal case의 여섯 coarse step에 집중된 사실을 확인했다. 이는 executable branch coverage가 아니라 lower-bound linkage이므로 05 성공으로 승격하지 않았다. 후보와 평가는 `05-scenario-cases-transition-linkage-evaluation-failed-17`에 보존했고 run marker를 검증된 04 revision 2로 복원했다.

## 적용된 부분 보정 계약

- backend가 gap 또는 validator 오류를 `target_ref`, case index, 허용 필드, source area/ref로 변환한다.
- 모델은 전체 `05-scenario-cases`가 아니라 `scenario-case-correction-patch`만 제출한다.
- 기존 case 수정은 target의 `allowed_fields`만 허용하며, 대상 밖 case와 필드는 이전 값과 동일한지 backend가 검증한다.
- 신규 case가 여러 개인 target에서도 실패 case index만 제외하고 정상 sibling case를 유지하며, retry `case_limit`으로 대체 case 수를 제한한다.
- 신규 case의 `kind`, `journey_ref`, step `source_area_refs`는 모델 출력에서 받지 않고 backend target과 journey milestone에서 주입한다.
- 알려진 classification을 잘못된 journey에 사용한 경우만 해당 case 보정 대상으로 취급한다. 존재하지 않는 classification/source area/milestone 및 stale base hash는 계속 fail-closed한다.
- partial merge 뒤에는 `prior-scenario-cases`와 correction plan 재읽기를 강제한다.
- 병합된 전체 artifact에 대해 schema, journey/classification 참조, evidence catalog/binding, persisted grant, hash를 다시 검증하고 전체 성공 시에만 revision을 증가시킨다.

## 다음 보정 입력

- 소스 기반 breadth gap: `04-user-journeys/orchestrator-scenario-breadth-gaps.json`
- 보존할 이전 후보: `05-scenario-cases-external-evaluation-failed-02`
- gap은 golden 식별자·문구·기대 case 수·transition 수를 생성 agent에 전달하지 않는다.
- 8개 허용 소스 ref만 다시 읽어 서로 다른 action, guard, 상태, 입력 경계, 오류, 복구 및 출력 동작을 별도 case로 확장한다.

## 재시도 전 보강된 경계

- 보정 gap 파일과 이전 후보 디렉터리는 run 내부의 실제 파일/디렉터리여야 하며 심볼릭 링크를 거부한다.
- 이전 후보의 agent JSON, wrapper JSON, validation hash, provenance, evidence binding 및 persisted grant를 함께 재검증한다.
- evidence grant가 실제 반환한 source slice만 읽은 것으로 인정하고, 직전 closure 요청 범위를 넘어선 반환을 거부한다.
- 반복 closure는 이미 전달한 동일 slice의 원문을 다시 전송하지 않는다.
- 모델에는 전체 classification catalog 대신 `journey_ref`별 허용 classification 그룹을 전달하며, 다른 여정의 C-ref 사용은 계속 fail-closed한다.

새 credential과 `gpt-5.6-luna`는 실제 Pi 호출, patch 작성, 부분 병합, 동적 correction-plan 재조회, revision 2 전체 검증까지 정상 동작했다. 이번 실행에서는 provider rate limit이 발생하지 않았다. 그러나 broad gap을 네 개 target으로만 변환한 현재 correction plan은 한 종류당 한 case가 추가되면 로컬 완료가 가능해, source-distinct breadth 누락을 종결 조건에 반영하지 못했다.

다음 실행 전에는 외부 evaluator 내용을 생성 agent에 노출하지 않은 채, `05-scenario-cases-external-evaluation-failed-12/orchestrator-source-review.md`의 남은 source-backed branch만 더 작은 backend correction target으로 구체화해야 한다. 동일한 넓은 gap을 그대로 재호출하지 않는다.

## 전이 분모 보강 감사

- Golden을 사용하지 않은 scanner/AST 감사에서 63개 interaction 중 58개를 실행 가능한 handler 동작으로 분류했다.
- 이들로부터 최소 69개 transition obligation을 얻었다: journey 42개, view 27개이며 35개는 서버 응답 등 런타임 확인이 필요한 `runtime-unverified`다.
- 기존 분석기가 놓치던 부모 DOM click bubbling은 일반 AST 규칙으로 보강했다. 반면 handler와 downstream-consumed effect가 모두 없는 native input을 분모에 넣는 초안은 기존 실행 가능성 계약과 충돌해 제거했다. 남은 5개는 이 두 control과 handler 없는 no-op/상태 표시 control이며 자동 case로 승격하지 않는다.
- 01 source survey의 evidence와 결정론 inventory를 대조하면 73개 route/API/interaction record 중 settings source 1개의 6개 record가 인용되지 않았다. 새 runner는 이 차집합을 `source-survey-inventory-gaps.json`으로 만들어 02 correction 입력에 자동 병합한다.
- 이 inventory 대조는 인용 evidence의 line coverage 백스톱이다. 넓은 evidence slice 안에서 개별 record의 의미가 실제 산출물에 누락된 경우까지 증명하지는 못하므로, 향후 01에 opaque inventory record별 `incorporated`/`excluded`/`unresolved` 판정을 추가해야 완전한 unknown-unknown gate가 된다.
- `05-scenario-cases-external-evaluation-failed-12` 당시 8-case 후보에는 backend transition ref가 0개였으므로 69개 분모에 대한 coverage는 0%가 아니라 **측정 불가**였다. 해당 후보를 broad correction에 다시 넣지 않고 staged 04/05가 backend transition ledger를 참조하도록 연결했다.
- 상세 수치는 `05-scenario-cases-external-evaluation-failed-12/transition-obligation-audit.json`에 보존했다. run marker와 검증된 04 artifact는 변경하지 않았다.

## transition linkage 보정 결과

- 69개 lower-bound obligation은 04에서 33개 milestone linkage와 36개 unresolved로 모두 판정됐다.
- 05 correction patch는 33개 ref를 기존 step에 연결했지만 모두 첫 normal case에 집중됐고, 네 step은 각각 6·2·11·12개 ref를 포함했다.
- 따라서 33/69는 executable coverage로 사용하지 않는다. guard·choice·from/to state와 reachable path가 없는 현재 audit의 공식 상태는 `not-measurable`이다.
- golden 44개 case family에 비해 후보 case body는 8개 그대로이므로 dedicated-case coverage의 상한은 8/44(18.2%)이며, 이전 breadth 실패가 해소되지 않았다.
- 다음 구현은 새 graph를 만들지 않고 기존 FACT edge ledger와 `packages/scenario-pipeline/src/graph/graph-tools.ts`의 guarded path compiler를 staged 03–04 사이 정본 산출물로 연결한다. 04는 backend가 열거한 path를 journey로 묶고, 05는 구조를 바꾸지 않는 narration patch만 작성해야 한다.
