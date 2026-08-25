import type { ScenarioResult } from "../../shared/scenario";

export type {
  ScenarioCase,
  ScenarioGroup,
  ScenarioResult,
  ScenarioStep,
} from "../../shared/scenario";

export function createDemoScenarioResult(runId: string): ScenarioResult {
  return {
    runId,
    generatedAt: "2026. 8. 25. 15:42",
    storagePath: `.scenarioforge/runs/${runId}/scenario-set.json`,
    wikiPages: 36,
    groups: [
      {
        code: "ORD",
        name: "주문",
        scenarios: [
          {
            id: "SCN-ORD-001",
            title: "비회원 상품 주문 완료",
            summary: "비회원 사용자가 배송지와 연락처를 입력해 주문을 완료한다.",
            precondition: "판매 중인 상품의 재고가 1개 이상 존재한다.",
            source: "src/checkout/guest-order.tsx",
            steps: [
              { order: 1, action: "상품 상세에서 구매하기를 선택한다.", expected: "비회원 주문 화면으로 이동한다." },
              { order: 2, action: "수령인과 연락처를 입력한다.", expected: "입력값이 유효한 것으로 표시된다." },
              { order: 3, action: "배송지 주소를 입력한다.", expected: "배송 가능 지역이 확인된다." },
              { order: 4, action: "주문 내용을 확인하고 결제를 요청한다.", expected: "결제 승인 후 주문 번호가 생성된다." },
            ],
          },
          {
            id: "SCN-ORD-002",
            title: "장바구니 수량 변경 후 주문",
            summary: "장바구니의 상품 수량을 변경하고 변경 금액으로 주문한다.",
            precondition: "장바구니에 수량 변경이 가능한 상품이 담겨 있다.",
            source: "src/cart/cart-item.tsx",
            steps: [
              { order: 1, action: "장바구니에서 상품 수량을 2개로 변경한다.", expected: "상품 금액과 총액이 다시 계산된다." },
              { order: 2, action: "주문하기를 선택한다.", expected: "변경된 수량이 주문서에 유지된다." },
              { order: 3, action: "주문을 완료한다.", expected: "2개 수량으로 주문이 생성된다." },
            ],
          },
        ],
      },
      {
        code: "PAY",
        name: "결제",
        scenarios: [
          {
            id: "SCN-PAY-001",
            title: "신용카드 결제 승인",
            summary: "유효한 테스트 카드로 결제를 승인하고 영수증을 확인한다.",
            precondition: "결제 가능한 주문서와 테스트 카드 토큰이 준비되어 있다.",
            source: "src/payment/card-payment.ts",
            steps: [
              { order: 1, action: "결제 수단에서 신용카드를 선택한다.", expected: "카드 결제 입력 영역이 표시된다." },
              { order: 2, action: "테스트 카드 정보를 입력한다.", expected: "카드 정보가 유효한 것으로 확인된다." },
              { order: 3, action: "결제를 요청한다.", expected: "승인 번호와 주문 완료 화면이 표시된다." },
              { order: 4, action: "영수증 보기를 선택한다.", expected: "승인 금액과 결제 수단이 표시된다." },
            ],
          },
          {
            id: "SCN-PAY-002",
            title: "결제 승인 실패 후 재시도",
            summary: "승인 실패 원인을 확인하고 다른 카드로 결제를 재시도한다.",
            precondition: "승인 거절 응답을 반환하는 테스트 카드가 준비되어 있다.",
            source: "src/payment/payment-retry.ts",
            steps: [
              { order: 1, action: "승인 거절 테스트 카드로 결제한다.", expected: "거절 사유와 재시도 동작이 표시된다." },
              { order: 2, action: "다른 결제 수단을 선택한다.", expected: "기존 주문 정보가 유지된다." },
              { order: 3, action: "유효한 카드로 다시 결제한다.", expected: "중복 주문 없이 결제가 완료된다." },
            ],
          },
        ],
      },
      {
        code: "MEM",
        name: "회원",
        scenarios: [
          {
            id: "SCN-MEM-001",
            title: "회원 로그인 후 주문 정보 복원",
            summary: "로그인 전에 구성한 장바구니를 로그인 후에도 유지한다.",
            precondition: "활성 회원 계정과 비로그인 장바구니가 존재한다.",
            source: "src/auth/cart-merge.ts",
            steps: [
              { order: 1, action: "비로그인 상태에서 상품을 장바구니에 담는다.", expected: "로컬 장바구니에 상품이 추가된다." },
              { order: 2, action: "회원 계정으로 로그인한다.", expected: "서버 장바구니와 로컬 장바구니가 병합된다." },
              { order: 3, action: "장바구니를 연다.", expected: "로그인 전에 담은 상품이 표시된다." },
            ],
          },
          {
            id: "SCN-MEM-002",
            title: "배송지 개인정보 수정",
            summary: "회원이 기본 배송지의 수령인과 연락처를 수정한다.",
            precondition: "회원 계정에 기본 배송지가 등록되어 있다.",
            source: "src/account/address-form.tsx",
            steps: [
              { order: 1, action: "내 정보에서 배송지 관리를 연다.", expected: "기본 배송지가 표시된다." },
              { order: 2, action: "수령인과 연락처를 수정한다.", expected: "개인정보 형식 검증을 통과한다." },
              { order: 3, action: "변경 내용을 저장한다.", expected: "다음 주문서에 변경된 배송지가 반영된다." },
            ],
          },
        ],
      },
    ],
  };
}
