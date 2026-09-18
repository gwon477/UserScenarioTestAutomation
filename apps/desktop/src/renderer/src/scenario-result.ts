import type { ScenarioResult } from "../../shared/scenario";

export type {
  ScenarioCase,
  ScenarioGroup,
  ScenarioResult,
  ScenarioStep,
} from "../../shared/scenario";

/* 시연용 표본 시나리오. 실제 분석 산출물이 아니다.
 *
 * 화면 흐름을 보여주기 위한 preview 전용 데이터이고, 정본 경로
 * (`loadScenarioView` → run manifest → journal 등록 → hash)를 타지 않는다.
 * 문구는 RA-DAR 소스 스냅샷에 실재하는 화면·조작 이름에서 가져왔지만,
 * 이 값들이 그 프로젝트를 분석해 나온 결과인 것은 아니다.
 * preview 화면은 항상 표본임을 표시해야 한다.
 */
export function createDemoScenarioResult(runId: string): ScenarioResult {
  return {
    runId,
    generatedAt: "2026. 9. 8. 17:24",
    storagePath: `.scenarioforge/runs/${runId}/scenario-set.json`,
    wikiPages: 12,
    groups: [
      {
        code: "AUTH",
        name: "인증·진입",
        scenarios: [
          {
            id: "SCN-AUTH-001",
            title: "사번 인증 후 개정 원장 진입",
            summary:
              "담당자가 사번과 비밀번호로 인증하고 개정 원장 화면까지 진입한다.",
            precondition: "유효한 사번 계정이 존재한다.",
            source: "FrontEnd/src/features/landing/LoginCard.tsx",
            steps: [
              {
                order: 1,
                action: "랜딩 화면에서 '바로 시작하기'를 선택한다.",
                expected: "사번 인증 카드가 표시된다.",
              },
              {
                order: 2,
                action: "사번과 비밀번호를 입력한다.",
                expected: "'사번으로 인증하고 시작' 버튼이 활성화된다.",
              },
              {
                order: 3,
                action: "'사번으로 인증하고 시작'을 선택한다.",
                expected: "인증 후 개정 원장 화면으로 이동한다.",
              },
            ],
          },
          {
            id: "SCN-AUTH-002",
            title: "사번 없이 둘러보기로 진입",
            summary:
              "인증 없이 '사번 없이 확인하기'로 진입해 읽기 범위만 열람한다.",
            precondition: "없음",
            source: "FrontEnd/src/features/landing/LoginCard.tsx",
            steps: [
              {
                order: 1,
                action: "인증 카드에서 '사번 없이 확인하기'를 선택한다.",
                expected: "인증 없이 개정 원장 화면으로 이동한다.",
              },
              {
                order: 2,
                action: "RA 에이전트 패널을 연다.",
                expected:
                  "'사번 로그인 후 채팅할 수 있습니다' 안내로 입력이 막힌다.",
              },
            ],
          },
        ],
      },
      {
        code: "LEDGER",
        name: "개정 원장 조회",
        scenarios: [
          {
            id: "SCN-LEDGER-001",
            title: "규정명으로 개정 건 검색",
            summary: "규정명 또는 문서번호로 원장을 검색해 대상 건을 찾는다.",
            precondition: "원장에 등재된 개정 건이 1건 이상 존재한다.",
            source: "FrontEnd/src/screens/MainScreen.tsx",
            steps: [
              {
                order: 1,
                action: "원장 화면에서 '검색'을 선택한다.",
                expected: "'규정명 또는 문서번호 검색' 입력창이 열린다.",
              },
              {
                order: 2,
                action: "규정명을 입력한다.",
                expected: "입력한 규정명과 일치하는 개정 건만 목록에 남는다.",
              },
              {
                order: 3,
                action: "'검색 닫기'를 선택한다.",
                expected: "검색 입력창이 닫히고 전체 목록으로 돌아온다.",
              },
            ],
          },
          {
            id: "SCN-LEDGER-002",
            title: "내가 검토자인 건만 필터",
            summary:
              "검토자 필터를 켜서 자신이 지정된 개정 건만 원장에 남긴다.",
            precondition: "인증된 담당자가 검토자로 지정된 건이 존재한다.",
            source: "FrontEnd/src/screens/MainScreen.tsx",
            steps: [
              {
                order: 1,
                action: "'내가 검토자로 지정된 건만 봅니다' 필터를 켠다.",
                expected: "본인이 검토자인 개정 건만 목록에 남는다.",
              },
              {
                order: 2,
                action: "같은 필터를 다시 선택해 해제한다.",
                expected: "필터 이전의 전체 목록이 복원된다.",
              },
            ],
          },
        ],
      },
      {
        code: "REVIEW",
        name: "개정 건 검토",
        scenarios: [
          {
            id: "SCN-REVIEW-001",
            title: "변경 내용과 근거 원문 확인",
            summary:
              "개정 건의 변경 전후를 비교하고 판단 근거가 된 원문 위치까지 확인한다.",
            precondition: "변경 항목과 근거 문서가 등재된 개정 건이 존재한다.",
            source: "FrontEnd/src/features/detail/CaseModal.tsx",
            steps: [
              {
                order: 1,
                action: "원장 목록에서 '변경 내용 확인'을 선택한다.",
                expected: "개정 건 상세가 열리고 변경 전후가 나란히 표시된다.",
              },
              {
                order: 2,
                action: "'근거 : 열기'를 선택한다.",
                expected: "판단 근거가 된 근거 문서가 표시된다.",
              },
              {
                order: 3,
                action: "'· 원문 위치로 이동'을 선택한다.",
                expected: "근거 문서의 해당 원문 위치로 이동한다.",
              },
              {
                order: 4,
                action: "'근거 문서 닫기'를 선택한다.",
                expected: "근거 문서가 닫히고 변경 비교 화면으로 돌아온다.",
              },
            ],
          },
          {
            id: "SCN-REVIEW-002",
            title: "개정의도 수정 후 되돌리기",
            summary:
              "개정의도를 수정한 뒤 되돌리기로 수정 전 내용을 복원한다.",
            precondition: "개정의도가 기록된 개정 건이 열려 있다.",
            source: "FrontEnd/src/features/detail/CaseModal.tsx",
            steps: [
              {
                order: 1,
                action: "'개정의도 수정'을 선택한다.",
                expected: "개정의도가 편집 가능한 상태로 바뀐다.",
              },
              {
                order: 2,
                action: "개정의도 본문을 수정하고 확정한다.",
                expected: "수정한 개정의도가 상세에 반영된다.",
              },
              {
                order: 3,
                action: "'되돌리기'를 선택한다.",
                expected: "수정 전 개정의도가 복원된다.",
              },
            ],
          },
          {
            id: "SCN-REVIEW-003",
            title: "변경 전후 문구 직접 수정",
            summary: "비교 화면에서 변경 전후 문구를 직접 고치고 완료한다.",
            precondition: "변경 항목이 있는 개정 건의 비교 화면이 열려 있다.",
            source: "FrontEnd/src/features/detail/Compare.tsx",
            steps: [
              {
                order: 1,
                action: "'변경 후 수정'을 선택한다.",
                expected: "변경 후 문구가 편집 가능한 상태로 바뀐다.",
              },
              {
                order: 2,
                action: "변경 후 문구를 고치고 '완료 / 수정'을 선택한다.",
                expected: "수정한 문구가 비교 화면에 반영된다.",
              },
            ],
          },
        ],
      },
      {
        code: "ENTRY",
        name: "개정 건 수동 등재",
        scenarios: [
          {
            id: "SCN-ENTRY-001",
            title: "개정 건 수동 등재와 변경 항목 입력",
            summary:
              "필수 항목과 변경 항목을 입력해 개정 건을 검토중 상태로 등재한다.",
            precondition: "인증된 담당자가 원장 화면에 있다.",
            source: "FrontEnd/src/features/manual-entry/ManualCaseModal.tsx",
            steps: [
              {
                order: 1,
                action: "수동 등재를 열고 '규정명 *'과 '개정번호 *'를 입력한다.",
                expected: "필수 항목 입력이 유효한 것으로 표시된다.",
              },
              {
                order: 2,
                action: "'게시 단계 *'를 고르고 공포일과 시행일을 입력한다.",
                expected: "선택한 게시 단계에 맞는 날짜 항목이 채워진다.",
              },
              {
                order: 3,
                action: "'변경 항목 추가'를 선택한다.",
                expected: "조항과 변경 전후를 입력하는 편집기가 열린다.",
              },
              {
                order: 4,
                action: "'조항 *', '변경 유형 *', '판정 *'을 입력한다.",
                expected: "변경 항목의 필수 입력이 모두 채워진다.",
              },
              {
                order: 5,
                action: "'검토중으로 등록'을 선택한다.",
                expected: "개정 건이 검토중 상태로 원장에 등재된다.",
              },
            ],
          },
        ],
      },
      {
        code: "AGENT",
        name: "RA 에이전트",
        scenarios: [
          {
            id: "SCN-AGENT-001",
            title: "에이전트 질의 후 변경사항 반영",
            summary:
              "등재된 개정 건을 에이전트에게 질의하고 제안된 변경사항을 반영한다.",
            precondition: "인증된 담당자와 등재된 개정 건이 존재한다.",
            source: "FrontEnd/src/features/main/Chat.tsx",
            steps: [
              {
                order: 1,
                action: "'RA 에이전트 열기'를 선택한다.",
                expected: "에이전트 대화 패널이 열린다.",
              },
              {
                order: 2,
                action: "등재된 건에 대한 질문을 입력하고 '메시지 전송'한다.",
                expected: "질문에 대한 에이전트 응답이 표시된다.",
              },
              {
                order: 3,
                action: "'Agent 판단 근거 열기'를 선택한다.",
                expected: "응답의 판단 근거가 표시된다.",
              },
              {
                order: 4,
                action: "'변경사항 반영'을 선택한다.",
                expected: "제안된 변경사항이 개정 건에 반영된다.",
              },
            ],
          },
        ],
      },
    ],
  };
}
