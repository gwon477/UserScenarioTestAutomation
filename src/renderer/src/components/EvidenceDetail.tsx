import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Camera,
  Check,
  ChevronRight,
  Clock3,
  Code2,
  Monitor,
  RotateCcw,
} from "lucide-react";
import {
  orderEvidenceCaptures,
  type EvidenceCapture,
  type StepEvidence,
  type TestExecution,
} from "../../../shared/test-execution";
import { EvidenceViewport } from "./EvidenceViewport";

type Props = {
  execution: TestExecution;
  evidence: StepEvidence;
  onBack: () => void;
  onOpenScenario: (scenarioId: string) => void;
  onRetry: () => void;
};

const captureLabels: Record<EvidenceCapture["kind"], string> = {
  failure: "실패 시점",
  "before-failure": "실패 직전",
  "action-complete": "이전 단계 완료",
};

const resultLabels: Record<StepEvidence["status"], string> = {
  passed: "성공",
  failed: "실패",
  inconclusive: "확인 필요",
  cancelled: "중단",
};

function capturedTime(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

export function EvidenceDetail({
  execution,
  evidence,
  onBack,
  onOpenScenario,
  onRetry,
}: Props) {
  const captures = useMemo(
    () => orderEvidenceCaptures(evidence.captures),
    [evidence.captures],
  );
  const [selectedCaptureId, setSelectedCaptureId] = useState(
    captures[0]?.id ?? "",
  );
  const selectedCapture =
    captures.find((capture) => capture.id === selectedCaptureId) ?? captures[0];

  return (
    <main className="evidence-detail" id="main-content">
      <header className="evidence-detail-heading">
        <div>
          <button className="text-back-action" type="button" onClick={onBack}>
            <ArrowLeft size={15} aria-hidden="true" /> 테스트 수행으로 돌아가기
          </button>
          <span className="eyebrow">
            {evidence.status === "failed" ? "FAILURE EVIDENCE" : "STEP EVIDENCE"}
          </span>
          <div className="execution-title-line">
            <h1>{evidence.status === "failed" ? "실패 증적 상세" : "단계 증적 상세"}</h1>
            <span className={`status-badge is-${evidence.status}`}>
              {resultLabels[evidence.status]}
            </span>
          </div>
          <p>
            <code>{evidence.evidenceId}</code>
            <span>{execution.executionId}</span>
          </p>
        </div>
        <div className="evidence-detail-actions">
          <button className="outline-action" type="button" onClick={onRetry}>
            <RotateCcw size={14} aria-hidden="true" /> 동일 케이스 재시도
          </button>
          <button
            className="evidence-primary-action"
            type="button"
            onClick={() => onOpenScenario(evidence.scenarioId)}
          >
            시나리오에서 보기 <ChevronRight size={14} aria-hidden="true" />
          </button>
        </div>
      </header>

      <div className="evidence-detail-layout">
        <aside className="failure-timeline" aria-label="실패 단계 정보">
          <header className="panel-heading">
            <div>
              <span className="eyebrow">FAILURE CONTEXT</span>
              <h2>단계 타임라인</h2>
            </div>
          </header>
          <div className="failure-case-id">
            <code>{evidence.scenarioId}</code>
            <strong>STEP {String(evidence.stepOrder).padStart(2, "0")}</strong>
          </div>
          {evidence.status === "failed" ? (
            <ol className="failure-event-list">
              <li className="is-passed">
                <span><Check size={13} aria-hidden="true" /></span>
                <div>
                  <small>15:41:15</small>
                  <strong>이전 단계 완료</strong>
                  <p>입력 값 검증과 결제 수단 선택을 확인했습니다.</p>
                </div>
              </li>
              <li className="is-passed">
                <span><Camera size={13} aria-hidden="true" /></span>
                <div>
                  <small>15:41:18</small>
                  <strong>실패 직전 화면 저장</strong>
                  <p>결제 요청 동작 직전의 대상 화면입니다.</p>
                </div>
              </li>
              <li className="is-failed">
                <span><AlertTriangle size={13} aria-hidden="true" /></span>
                <div>
                  <small>15:41:18</small>
                  <strong>판정: 실패</strong>
                  <p>기대 결과가 관찰되지 않아 오류 정보와 함께 저장했습니다.</p>
                </div>
              </li>
            </ol>
          ) : evidence.status === "passed" ? (
            <ol className="failure-event-list">
              <li className="is-passed">
                <span><Check size={13} aria-hidden="true" /></span>
                <div>
                  <small>{selectedCapture ? capturedTime(selectedCapture.capturedAt) : "-"}</small>
                  <strong>판정: 성공</strong>
                  <p>기대 결과를 확인하고 완료 시점 화면을 저장했습니다.</p>
                </div>
              </li>
            </ol>
          ) : (
            <ol className="failure-event-list">
              <li className="is-failed">
                <span><AlertTriangle size={13} aria-hidden="true" /></span>
                <div>
                  <small>{selectedCapture ? capturedTime(selectedCapture.capturedAt) : "-"}</small>
                  <strong>판정: {resultLabels[evidence.status]}</strong>
                  <p>자동 판정이 확정되지 않아 저장된 근거를 확인해야 합니다.</p>
                </div>
              </li>
            </ol>
          )}
        </aside>

        <section className="capture-inspector" aria-labelledby="capture-inspector-title">
          <header className="panel-heading">
            <div>
              <span className="eyebrow">CAPTURE INSPECTOR</span>
              <h2 id="capture-inspector-title">대상 화면 캡처</h2>
            </div>
            <span>
              {selectedCapture?.width ?? "-"} × {selectedCapture?.height ?? "-"}
            </span>
          </header>
          <div className="capture-stage">
            <EvidenceViewport failed={selectedCapture?.kind === "failure"} />
          </div>
          <div className="capture-filmstrip" aria-label="저장된 화면 목록">
            {captures.map((capture, index) => (
              <button
                key={capture.id}
                className={`${capture.kind === "failure" ? "is-failed" : ""}${
                  selectedCapture?.id === capture.id ? " is-selected" : ""
                }`}
                type="button"
                onClick={() => setSelectedCaptureId(capture.id)}
              >
                <span className="filmstrip-preview">
                  <EvidenceViewport failed={capture.kind === "failure"} compact />
                </span>
                <span>
                  <strong>
                    {evidence.status === "passed" && capture.kind === "action-complete"
                      ? "단계 완료"
                      : captureLabels[capture.kind]}
                  </strong>
                  <small>{capturedTime(capture.capturedAt)}</small>
                </span>
              </button>
            ))}
          </div>
        </section>

        <aside className="failure-analysis" aria-label="실패 판정 정보">
          <header className="panel-heading">
            <div>
              <span className="eyebrow">ASSERTION & ERROR</span>
              <h2>판정 근거</h2>
            </div>
          </header>
          <dl className="failure-assertions">
            <div>
              <dt>수행 동작</dt>
              <dd>{evidence.action}</dd>
            </div>
            <div>
              <dt>기대 결과</dt>
              <dd>{evidence.expected}</dd>
            </div>
            <div className="is-actual">
              <dt>실제 결과</dt>
              <dd>{evidence.actual}</dd>
            </div>
          </dl>
          {evidence.error && (
            <div className="failure-error-box">
              <span><AlertTriangle size={15} aria-hidden="true" /> 오류 정보</span>
              <code>{evidence.error.code}</code>
              <strong>{evidence.error.category}</strong>
              <p>{evidence.error.message}</p>
            </div>
          )}
          <dl className="capture-environment">
            <div>
              <dt><Monitor size={13} aria-hidden="true" /> 화면</dt>
              <dd>
                Chromium · {selectedCapture?.width ?? "-"} × {selectedCapture?.height ?? "-"}
              </dd>
            </div>
            <div>
              <dt><Clock3 size={13} aria-hidden="true" /> 캡처</dt>
              <dd>{selectedCapture ? capturedTime(selectedCapture.capturedAt) : "-"}</dd>
            </div>
            <div>
              <dt><Code2 size={13} aria-hidden="true" /> 연결 ID</dt>
              <dd>{evidence.scenarioId}</dd>
            </div>
          </dl>
        </aside>
      </div>
    </main>
  );
}
