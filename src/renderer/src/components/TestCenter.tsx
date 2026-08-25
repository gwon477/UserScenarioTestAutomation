import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Camera,
  Check,
  ChevronRight,
  Circle,
  Clock3,
  Eye,
  LoaderCircle,
  RotateCcw,
  Square,
} from "lucide-react";
import type {
  StepEvidence,
  TestCaseResult,
  TestExecution,
  TestStepStatus,
} from "../../../shared/test-execution";
import { EvidenceViewport } from "./EvidenceViewport";

type Props = {
  execution: TestExecution;
  history: TestExecution[];
  currentExecutionId?: string;
  onBackToScenarios: () => void;
  onOpenScenario: (scenarioId: string) => void;
  onOpenEvidence: (evidence: StepEvidence) => void;
  onSelectExecution: (execution: TestExecution) => void;
  onCancel: () => void;
  onRetry: () => void;
};

const statusLabels: Record<TestStepStatus, string> = {
  queued: "대기",
  running: "수행 중",
  passed: "성공",
  failed: "실패",
  inconclusive: "확인 필요",
  cancelled: "중단",
  skipped: "건너뜀",
};

function StatusIcon({
  status,
}: {
  status: TestStepStatus | TestExecution["status"];
}) {
  if (status === "passed") return <Check size={14} aria-hidden="true" />;
  if (status === "failed") return <AlertTriangle size={14} aria-hidden="true" />;
  if (status === "running") return <LoaderCircle size={14} aria-hidden="true" />;
  if (status === "skipped" || status === "cancelled") {
    return <Square size={12} aria-hidden="true" />;
  }
  return <Circle size={12} aria-hidden="true" />;
}

function latestEvidence(testCase: TestCaseResult): StepEvidence | null {
  return [...testCase.steps]
    .reverse()
    .find((step) => step.evidence)?.evidence ?? null;
}

function executionProgress(execution: TestExecution) {
  const steps = execution.cases.flatMap((testCase) => testCase.steps);
  const complete = steps.filter((step) =>
    ["passed", "failed", "inconclusive", "skipped", "cancelled"].includes(
      step.status,
    ),
  ).length;
  return { complete, total: steps.length };
}

function executionStatusLabel(execution: TestExecution) {
  if (execution.status === "running") return "순차 실행 중";
  if (execution.status === "failed") return "실패로 종료";
  if (execution.status === "passed") return "실행 완료";
  if (execution.status === "preparing") return "환경 준비 중";
  return statusLabels[execution.status];
}

function preferredCase(execution: TestExecution) {
  return (
    execution.cases.find((testCase) => testCase.status === "failed") ??
    execution.cases.find((testCase) => testCase.status === "running") ??
    execution.cases[0]
  );
}

export function TestCenter({
  execution,
  history,
  currentExecutionId,
  onBackToScenarios,
  onOpenScenario,
  onOpenEvidence,
  onSelectExecution,
  onCancel,
  onRetry,
}: Props) {
  const initialCase = preferredCase(execution);
  const [selectedScenarioId, setSelectedScenarioId] = useState(
    initialCase?.scenarioId ?? "",
  );
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);
  const cancelTriggerRef = useRef<HTMLButtonElement>(null);
  const cancelDialogRef = useRef<HTMLElement>(null);
  const continueButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    setSelectedScenarioId(preferredCase(execution)?.scenarioId ?? "");
  }, [execution.executionId]);
  useEffect(() => {
    if (!cancelConfirmOpen) return;
    continueButtonRef.current?.focus();

    function handleDialogKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setCancelConfirmOpen(false);
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = Array.from(
        cancelDialogRef.current?.querySelectorAll<HTMLButtonElement>(
          "button:not([disabled])",
        ) ?? [],
      );
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleDialogKeyDown);
    return () => {
      document.removeEventListener("keydown", handleDialogKeyDown);
      cancelTriggerRef.current?.focus();
    };
  }, [cancelConfirmOpen]);
  const selectedCase =
    execution.cases.find((testCase) => testCase.scenarioId === selectedScenarioId) ??
    execution.cases[0];
  const evidence = selectedCase ? latestEvidence(selectedCase) : null;
  const progress = useMemo(() => executionProgress(execution), [execution]);
  const progressPercent = progress.total
    ? Math.round((progress.complete / progress.total) * 100)
    : 0;
  const historyRecords = useMemo(
    () =>
      [execution, ...history]
        .filter(
          (record, index, records) =>
            records.findIndex(
              (candidate) => candidate.executionId === record.executionId,
            ) === index,
        )
        .sort(
          (left, right) =>
            right.createdAt.localeCompare(left.createdAt) ||
            right.executionId.localeCompare(left.executionId),
        ),
    [execution, history],
  );
  const capturedScreens = execution.cases.reduce(
    (total, testCase) =>
      total +
      testCase.steps.reduce(
        (stepTotal, step) =>
          stepTotal + (step.evidence?.captures.length ?? 0),
        0,
      ),
    0,
  );
  const remainingCases = execution.cases.filter((testCase) =>
    ["running", "queued"].includes(testCase.status),
  ).length;

  return (
    <main className="test-center" id="main-content">
      <header
        className="execution-heading"
        aria-hidden={cancelConfirmOpen || undefined}
        inert={cancelConfirmOpen || undefined}
      >
        <div>
          <button className="text-back-action" type="button" onClick={onBackToScenarios}>
            <ArrowLeft size={15} aria-hidden="true" /> 시나리오 도출로 돌아가기
          </button>
          <span className="eyebrow">SEQUENTIAL TEST EXECUTION</span>
          <div className="execution-title-line">
            <h1>테스트 수행</h1>
            <span className={`status-badge is-${execution.status}`}>
              {executionStatusLabel(execution)}
            </span>
          </div>
          <p>
            <code>{execution.executionId}</code>
            <span>{execution.targetUrl}</span>
          </p>
        </div>
        <div className="execution-controls">
          <div className="execution-progress-copy">
            <span>{progress.complete}/{progress.total} steps</span>
            <strong>{progressPercent}%</strong>
          </div>
          <div
            className="execution-progress-track"
            role="progressbar"
            aria-label="테스트 수행 진행률"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progressPercent}
          >
            <span style={{ width: `${progressPercent}%` }} />
          </div>
          {execution.status === "running" && execution.executionId === currentExecutionId ? (
            <button
              ref={cancelTriggerRef}
              className="outline-action"
              type="button"
              onClick={() => setCancelConfirmOpen(true)}
            >
              <Square size={13} aria-hidden="true" /> 실행 중단
            </button>
          ) : execution.status !== "running" ? (
            <button className="outline-action" type="button" onClick={onRetry}>
              <RotateCcw size={14} aria-hidden="true" /> 동일 조건 재시도
            </button>
          ) : null}
        </div>
      </header>

      <div
        className="test-center-layout"
        aria-hidden={cancelConfirmOpen || undefined}
        inert={cancelConfirmOpen || undefined}
      >
        <aside className="execution-history-panel" aria-label="테스트 실행 이력">
          <header className="panel-heading">
            <div>
              <span className="eyebrow">EXECUTIONS</span>
              <h2>실행 이력</h2>
            </div>
            <span>{historyRecords.length}</span>
          </header>
          <div className="execution-history-list">
            {historyRecords.map((record) => (
              <button
                className={
                  record.executionId === execution.executionId
                    ? "is-current"
                    : undefined
                }
                type="button"
                key={record.executionId}
                onClick={() => onSelectExecution(record)}
                aria-current={
                  record.executionId === execution.executionId
                    ? "true"
                    : undefined
                }
              >
                <span className={`execution-status-mark is-${record.status}`}>
                  <StatusIcon status={record.status} />
                </span>
                <span>
                  <code>{record.executionId}</code>
                  <strong>{executionStatusLabel(record)}</strong>
                  <small>
                    {record.executionId === currentExecutionId
                      ? "현재 실행"
                      : "이전 실행"}
                  </small>
                </span>
                <ChevronRight size={14} aria-hidden="true" />
              </button>
            ))}
          </div>
          <div className="execution-contract-note">
            <Clock3 size={15} aria-hidden="true" />
            <p>
              케이스와 단계는 <strong>위에서 아래로 순차 수행</strong>됩니다.
            </p>
          </div>
        </aside>

        <section className="execution-queue-panel" aria-labelledby="execution-queue-title">
          <header className="panel-heading">
            <div>
              <span className="eyebrow">CASE QUEUE</span>
              <h2 id="execution-queue-title">수행 대기열</h2>
            </div>
            <span>{execution.cases.length} cases</span>
          </header>
          <div className="case-queue">
            {execution.cases.map((testCase, caseIndex) => (
              <article
                key={testCase.scenarioId}
                className={`execution-case is-${testCase.status}${
                  selectedCase?.scenarioId === testCase.scenarioId ? " is-selected" : ""
                }`}
              >
                <button
                  className="execution-case-header"
                  type="button"
                  onClick={() => setSelectedScenarioId(testCase.scenarioId)}
                >
                  <span className="queue-order">{String(caseIndex + 1).padStart(2, "0")}</span>
                  <span className="execution-case-title">
                    <code>{testCase.scenarioId}</code>
                    <strong>{testCase.title}</strong>
                  </span>
                  <span className={`step-status is-${testCase.status}`}>
                    <StatusIcon status={testCase.status} />
                    {statusLabels[testCase.status]}
                  </span>
                </button>
                <ol className="execution-steps">
                  {testCase.steps.map((step) => (
                    <li key={step.order} className={`is-${step.status}`}>
                      <span className="step-status-icon">
                        <StatusIcon status={step.status} />
                      </span>
                      <span className="execution-step-copy">
                        <small>STEP {String(step.order).padStart(2, "0")}</small>
                        <strong>{step.action}</strong>
                        <span>{step.expected}</span>
                      </span>
                      <span className={`step-status is-${step.status}`}>
                        {statusLabels[step.status]}
                      </span>
                      {step.evidence && (
                        <button
                          className="step-evidence-action"
                          type="button"
                          onClick={() => onOpenEvidence(step.evidence!)}
                          aria-label={`${testCase.scenarioId} ${step.order}단계 증적 열기`}
                        >
                          <Camera size={14} aria-hidden="true" />
                        </button>
                      )}
                    </li>
                  ))}
                </ol>
              </article>
            ))}
          </div>
        </section>

        <aside className="evidence-preview-panel" aria-label="선택한 케이스 증적">
          <header className="panel-heading">
            <div>
              <span className="eyebrow">LATEST EVIDENCE</span>
              <h2>최근 화면</h2>
            </div>
            <Camera size={17} aria-hidden="true" />
          </header>
          {selectedCase && evidence ? (
            <div className="evidence-preview-content">
              <div className="evidence-preview-meta">
                <code>{evidence.evidenceId}</code>
                <span className={`status-badge is-${evidence.status}`}>
                  {statusLabels[evidence.status]}
                </span>
              </div>
              <EvidenceViewport failed={evidence.status === "failed"} compact />
              <dl className="preview-assertion">
                <div>
                  <dt>단계</dt>
                  <dd>{evidence.stepOrder}. {evidence.action}</dd>
                </div>
                <div>
                  <dt>실제 결과</dt>
                  <dd>{evidence.actual}</dd>
                </div>
              </dl>
              <button
                className="evidence-primary-action"
                type="button"
                onClick={() => onOpenEvidence(evidence)}
              >
                <Eye size={15} aria-hidden="true" /> 증적 상세 보기
              </button>
              <button
                className="scenario-link-action"
                type="button"
                onClick={() => onOpenScenario(selectedCase.scenarioId)}
              >
                시나리오에서 보기 <ChevronRight size={14} aria-hidden="true" />
              </button>
            </div>
          ) : (
            <div className="evidence-preview-empty">
              <LoaderCircle size={22} aria-hidden="true" />
              <strong>단계 수행 대기 중</strong>
              <p>완료된 단계마다 화면 1장이 자동 저장됩니다.</p>
            </div>
          )}
        </aside>
      </div>
      {cancelConfirmOpen && (
        <div className="cancel-confirm-layer">
          <section
            ref={cancelDialogRef}
            className="cancel-confirm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="cancel-confirm-title"
          >
            <span className="cancel-confirm-icon">
              <Square size={18} aria-hidden="true" />
            </span>
            <span className="eyebrow">CANCEL EXECUTION</span>
            <h2 id="cancel-confirm-title">현재 실행을 중단할까요?</h2>
            <p>
              지금까지 저장한 증적은 유지되고, 수행하지 않은 케이스는 건너뜀으로
              기록됩니다.
            </p>
            <dl>
              <div>
                <dt>저장된 화면</dt>
                <dd>{capturedScreens}장</dd>
              </div>
              <div>
                <dt>남은 케이스</dt>
                <dd>{remainingCases}개</dd>
              </div>
            </dl>
            <div className="cancel-confirm-actions">
              <button
                ref={continueButtonRef}
                className="outline-action"
                type="button"
                onClick={() => setCancelConfirmOpen(false)}
              >
                계속 수행
              </button>
              <button
                className="evidence-primary-action"
                type="button"
                onClick={() => {
                  onCancel();
                  setCancelConfirmOpen(false);
                }}
              >
                실행 중단
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
