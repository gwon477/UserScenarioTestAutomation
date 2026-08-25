import {
  AlertTriangle,
  ArrowLeft,
  Camera,
  Check,
  ChevronRight,
  Clock3,
  Database,
  FileImage,
  LoaderCircle,
} from "lucide-react";
import type { StepEvidence, TestExecution } from "../../../shared/test-execution";

type Props = {
  executions: TestExecution[];
  onBackToScenarios: () => void;
  onOpenEvidence: (evidence: StepEvidence) => void;
};

function allEvidence(execution: TestExecution) {
  return execution.cases.flatMap((testCase) =>
    testCase.steps.flatMap((step) => (step.evidence ? [step.evidence] : [])),
  );
}

function formatBytes(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function executionLabel(status: TestExecution["status"]) {
  if (status === "failed") return "실패로 종료";
  if (status === "running") return "순차 실행 중";
  if (status === "passed") return "실행 완료";
  if (status === "inconclusive") return "확인 필요";
  if (status === "cancelled") return "실행 중단";
  if (status === "preparing") return "환경 준비 중";
  return "실행 대기";
}

export function EvidenceLibrary({
  executions,
  onBackToScenarios,
  onOpenEvidence,
}: Props) {
  const totalCaptures = executions.reduce(
    (total, execution) =>
      total +
      allEvidence(execution).reduce(
        (captureTotal, evidence) => captureTotal + evidence.captures.length,
        0,
      ),
    0,
  );
  const totalBytes = executions.reduce(
    (total, execution) => total + execution.evidenceBytes,
    0,
  );

  return (
    <main className="evidence-library" id="main-content">
      <header className="execution-heading evidence-library-heading">
        <div>
          <button className="text-back-action" type="button" onClick={onBackToScenarios}>
            <ArrowLeft size={15} aria-hidden="true" /> 시나리오 도출로 돌아가기
          </button>
          <span className="eyebrow">LOCAL EVIDENCE LIBRARY</span>
          <h1>테스트 증적</h1>
          <p>단계별 화면과 판정 근거를 실행 ID 기준으로 저장하고 관리합니다.</p>
        </div>
        <dl className="evidence-summary">
          <div>
            <dt>실행</dt>
            <dd>{executions.length}건</dd>
          </div>
          <div>
            <dt>화면</dt>
            <dd>{totalCaptures}장</dd>
          </div>
          <div>
            <dt>용량</dt>
            <dd>{formatBytes(totalBytes)}</dd>
          </div>
        </dl>
      </header>

      <div className="evidence-library-note">
        <Database size={16} aria-hidden="true" />
        <span>LOCAL PROJECT STORAGE</span>
        <code>.scenarioforge/runs/&#123;runId&#125;/tests/&#123;executionId&#125;/evidence/</code>
      </div>

      <section className="evidence-run-list" aria-labelledby="evidence-run-title">
        <header className="section-header">
          <div>
            <span className="eyebrow">EXECUTION ARCHIVE</span>
            <h2 id="evidence-run-title">실행별 증적</h2>
          </div>
        </header>
        {executions.map((execution) => {
          const evidenceItems = allEvidence(execution);
          const failure = evidenceItems.find((item) => item.status === "failed");
          const representative = failure ?? evidenceItems.at(-1);
          const captureCount = evidenceItems.reduce(
            (total, item) => total + item.captures.length,
            0,
          );
          return (
            <article className={`evidence-run-card is-${execution.status}`} key={execution.executionId}>
              <span className="evidence-run-status">
                {execution.status === "failed" ? (
                  <AlertTriangle size={18} aria-hidden="true" />
                ) : execution.status === "running" || execution.status === "preparing" ? (
                  <LoaderCircle size={18} aria-hidden="true" />
                ) : execution.status === "passed" ? (
                  <Check size={18} aria-hidden="true" />
                ) : (
                  <Clock3 size={18} aria-hidden="true" />
                )}
              </span>
              <div className="evidence-run-main">
                <code>{execution.executionId}</code>
                <strong>{executionLabel(execution.status)}</strong>
                <span>{execution.targetUrl}</span>
              </div>
              <span className="evidence-run-metric">
                <FileImage size={15} aria-hidden="true" />
                <strong>{captureCount}</strong> screens
              </span>
              <span className="evidence-run-metric">
                <Clock3 size={15} aria-hidden="true" />
                {execution.completedAt ? "01:11" : "진행 중"}
              </span>
              <span className="evidence-run-metric">
                <Camera size={15} aria-hidden="true" />
                {formatBytes(execution.evidenceBytes)}
              </span>
              {representative ? (
                <button type="button" onClick={() => onOpenEvidence(representative)}>
                  {failure ? "실패 증적" : "증적 보기"}
                  <ChevronRight size={15} aria-hidden="true" />
                </button>
              ) : (
                <span className="evidence-unavailable">증적 생성 중</span>
              )}
            </article>
          );
        })}
      </section>
    </main>
  );
}
