import { AlertTriangle, Check, LockKeyhole } from "lucide-react";

type Props = {
  failed?: boolean;
  compact?: boolean;
};

export function EvidenceViewport({ failed = false, compact = false }: Props) {
  return (
    <div
      className={`evidence-viewport${failed ? " is-failed" : ""}${compact ? " is-compact" : ""}`}
      role="img"
      aria-label={failed ? "결제 요청 실패 시점에 캡처한 대상 화면" : "테스트 단계 완료 시 캡처한 대상 화면"}
    >
      <div className="captured-browser-bar">
        <span />
        <span />
        <span />
        <div>
          <LockKeyhole size={11} aria-hidden="true" />
          staging.commerce.example/checkout
        </div>
      </div>
      <div className="captured-page">
        <header>
          <strong>COMMERCE</strong>
          <span>장바구니 · 주문/결제 · 완료</span>
        </header>
        <main>
          <div className="captured-checkout-copy">
            <small>ORDER / PAYMENT</small>
            <h3>주문 결제</h3>
            <p>테스트 주문의 결제 수단을 확인해 주세요.</p>
          </div>
          <div className="captured-payment-card">
            <div className="captured-card-title">
              <span>신용카드</span>
              <strong>42,000원</strong>
            </div>
            <label>
              테스트 카드
              <span>•••• •••• •••• 4242</span>
            </label>
            {failed ? (
              <div className="captured-error">
                <AlertTriangle size={14} aria-hidden="true" />
                <span>
                  <strong>결제를 완료하지 못했습니다.</strong>
                  잠시 후 다시 시도해 주세요.
                </span>
              </div>
            ) : (
              <div className="captured-valid">
                <Check size={13} aria-hidden="true" /> 테스트 카드 확인 완료
              </div>
            )}
            <span className="captured-pay-action">42,000원 결제하기</span>
          </div>
        </main>
      </div>
    </div>
  );
}
