import type { CSSProperties } from "react";
import { useState } from "react";
import { Icon } from "./Icon";
import type { IconName } from "./IconSprite";
import type { EvidenceLibraryView } from "../../../shared/evidence-library";
import type { TestExecution, TestExecutionStatus, TestStepStatus } from "../../../shared/test-execution";
import { formatBytes, formatDateTime } from "../format";

/* 「테스트 실행」 탭. 목업 S9 의 `.rows.tbl` 레이아웃을 따른다.
 *
 * 목록의 원천은 `.scenarioforge/runs/{runId}/tests/` 이므로 재시작 후에도
 * 살아 있다. 프로젝트가 남긴 실행 전부를 최신순으로 센다.
 *
 * 중단과 재시도는 여기에 두지 않는다. 두 동작 모두 실행이 속한 run 의 정본
 * 시나리오 맥락을 필요로 하므로 실행 상세가 소유한다. 실행을 시작하는 곳도
 * 여기가 아니다. 수행할 케이스를 골라야 시작할 수 있다.
 *
 * 목록 단위는 실행이 아니라 «실행 안의 시나리오 케이스»다. 사용자가 찾는 것은
 * 「어느 케이스가 어떻게 됐나」이고, 실행 ID 만 늘어놓으면 케이스를 보려고
 * 한 단계를 더 들어가야 한다. 케이스를 펴면 단계와 그 단계의 증적이 나온다. */

type Props = {
  executions: TestExecution[];
  runningExecutionId?: string;
  /* 어느 단계에 증적이 남았는지는 정본 증적 목록이 안다. 실행 투영은 증적
   * 경로를 담지 않으므로 여기서 대조한다. */
  library?: EvidenceLibraryView;
  onOpenExecution: (execution: TestExecution) => void;
  onOpenStepEvidence: (runId: string, executionId: string, scenarioId: string, order: number) => void;
  onGoToRuns: () => void;
};

const marks: Record<TestExecutionStatus, { tone: string; icon: IconName; label: string }> = {
  passed: { tone: "ok", icon: "i-check", label: "실행 완료" },
  failed: { tone: "bad", icon: "i-alert", label: "실패로 종료" },
  inconclusive: { tone: "warn", icon: "i-help", label: "확인 필요" },
  cancelled: { tone: "idle", icon: "i-square", label: "사용자 중단" },
  running: { tone: "run", icon: "i-loader", label: "순차 실행 중" },
  preparing: { tone: "run", icon: "i-loader", label: "환경 준비 중" },
  queued: { tone: "idle", icon: "i-clock", label: "실행 대기" },
};

const caseMarks: Record<TestStepStatus, { tone: string; icon: IconName; label: string }> = {
  passed: { tone: "ok", icon: "i-check", label: "성공" },
  failed: { tone: "bad", icon: "i-alert", label: "실패" },
  inconclusive: { tone: "warn", icon: "i-help", label: "확인 필요" },
  cancelled: { tone: "idle", icon: "i-square", label: "중단" },
  skipped: { tone: "idle", icon: "i-square", label: "건너뜀" },
  queued: { tone: "idle", icon: "i-clock", label: "대기" },
  running: { tone: "run", icon: "i-loader", label: "수행 중" },
};

const COLS: CSSProperties = {
  "--cols": "28px minmax(0,1fr) 136px 96px 112px",
} as CSSProperties;

function tally(execution: TestExecution) {
  let done = 0;
  let steps = 0;
  let passed = 0;
  let failed = 0;
  let open = 0;
  for (const testCase of execution.cases) {
    for (const step of testCase.steps) {
      steps += 1;
      if (step.status !== "queued" && step.status !== "running") done += 1;
    }
    if (testCase.status === "passed") passed += 1;
    else if (testCase.status === "failed") failed += 1;
    else open += 1;
  }
  return { done, steps, passed, failed, open };
}

export function ExecutionList({
  executions,
  runningExecutionId,
  library,
  onOpenExecution,
  onOpenStepEvidence,
  onGoToRuns,
}: Props) {
  const [expandedCases, setExpandedCases] = useState<Set<string>>(new Set());
  /* 증적이 남은 단계. `실행#케이스#순번` 으로 찾는다. */
  const evidenceSteps = new Set(
    (library?.entries ?? []).map((entry) => `${entry.executionId}#${entry.scenarioId}#${entry.order}`),
  );

  function toggleCase(key: string) {
    setExpandedCases((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const totals = executions.reduce(
    (carry, execution) => ({
      passed: carry.passed + (execution.status === "passed" ? 1 : 0),
      failed: carry.failed + (execution.status === "failed" ? 1 : 0),
      bytes: carry.bytes + execution.evidenceBytes,
    }),
    { passed: 0, failed: 0, bytes: 0 },
  );

  return (
    <>
      <div className="between hd">
        <div>
          <span className="eyebrow">TEST EXECUTIONS</span>
          <h1 className="h1">테스트 실행</h1>
          <p className="sub" style={{ marginTop: 6 }}>
            케이스와 단계는 위에서 아래로 순차 수행됩니다. 실행마다 소속 run 과 증적이 함께
            남습니다.
          </p>
        </div>
        {executions.length > 0 && (
          <div className="stats">
            <div className="stat">
              <p className="num sm">{executions.length}</p>
              <span className="path">실행</span>
            </div>
            <div className="stat">
              <p className="num sm" style={{ color: "var(--ok)" }}>
                {totals.passed}
              </p>
              <span className="path">성공</span>
            </div>
            <div className="stat">
              <p className="num sm" style={{ color: totals.failed > 0 ? "var(--bad)" : undefined }}>
                {totals.failed}
              </p>
              <span className="path">실패</span>
            </div>
          </div>
        )}
      </div>

      {executions.length === 0 ? (
        <div className="card flat">
          <div className="empty">
            <span className="ic">
              <Icon name="sf-queue" />
            </span>
            <h3>아직 실행한 테스트가 없습니다</h3>
            <p>
              실행은 도출된 시나리오 케이스를 골라 시작합니다. 생성 이력에서 run 을 열어 수행할
              케이스를 선택하세요.
            </p>
            <button className="btn pri" type="button" onClick={onGoToRuns}>
              <Icon name="sf-scenario" size="sm" />
              생성 이력으로 이동
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="card flat pathbar">
            <Icon name="i-db" size="sm" />
            <code className="path">.scenarioforge/runs/{"{runId}"}/tests/{"{executionId}"}</code>
            <span className="path" style={{ marginLeft: "auto" }}>
              증적 {formatBytes(totals.bytes)}
            </span>
          </div>

          {executions.map((execution) => {
            const mark = marks[execution.status];
            const { done, steps, passed, failed, open } = tally(execution);
            const tone =
              execution.status === "failed"
                ? " bad"
                : execution.status === "passed"
                  ? " ok"
                  : execution.status === "cancelled"
                    ? " idle"
                    : "";
            return (
              <div
                className={`card${execution.executionId === runningExecutionId ? " on" : ""}`}
                key={execution.executionId}
                style={{ overflow: "hidden", marginBottom: 16 }}
              >
                {/* 실행 머리말. 케이스가 어느 실행과 run 에 속하는지 여기서만 말한다. */}
                <div className="card-h">
                  <span className={`mark ${mark.tone}`}>
                    <Icon name={mark.icon} size="sm" />
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <strong className="t">{execution.executionId}</strong>
                    <p className="path">
                      <code>{execution.scenarioRunId}</code>
                      {execution.targetUrl && ` · ${execution.targetUrl}`}
                    </p>
                  </div>
                  <span className={`chip ${mark.tone}`}>
                    <Icon name={mark.icon} />
                    {mark.label}
                  </span>
                  {execution.retryOfExecutionId && (
                    <span className="chip mono">
                      <Icon name="i-retry" />
                      재시도
                    </span>
                  )}
                  <span className="end">
                    <span className="cell-bar">
                      <span className={`bar${tone}`}>
                        <span style={{ width: `${steps === 0 ? 0 : Math.round((done / steps) * 100)}%` }} />
                      </span>
                      <span className="path">
                        {done}/{steps} steps
                      </span>
                    </span>
                    <span className="metric">
                      <Icon name="i-camera" size="sm" />
                      {formatBytes(execution.evidenceBytes)}
                    </span>
                    <span className="metric r">{formatDateTime(execution.createdAt)}</span>
                    <button className="btn sm" type="button" onClick={() => onOpenExecution(execution)}>
                      실행 열기
                      <Icon name="i-right" size="sm" />
                    </button>
                  </span>
                </div>

                <div className="exec-cases">
                  <p className="path exec-cases-h">
                    시나리오 케이스 {execution.cases.length}건 · 성공 {passed} · 실패 {failed}
                    {open > 0 && ` · 미판정 ${open}`}
                  </p>
                  {execution.cases.map((testCase) => {
                    const key = `${execution.executionId}#${testCase.scenarioId}`;
                    const expanded = expandedCases.has(key);
                    const caseMark = caseMarks[testCase.status];
                    const done = testCase.steps.filter(
                      (step) => step.status !== "queued" && step.status !== "running",
                    ).length;
                    return (
                      <div className="exec-case" key={key}>
                        <button
                          className="exec-case-rw"
                          type="button"
                          onClick={() => toggleCase(key)}
                          aria-expanded={expanded}
                          aria-controls={`case-steps-${key}`}
                        >
                          <span className={`mark ${caseMark.tone}`}>
                            <Icon name={caseMark.icon} size="sm" />
                          </span>
                          <code>{testCase.scenarioId}</code>
                          <span className="exec-case-ti">
                            <strong>{testCase.title}</strong>
                          </span>
                          <span className={`chip ${caseMark.tone}`}>
                            <Icon name={caseMark.icon} />
                            {caseMark.label}
                          </span>
                          <span className="path">
                            {done}/{testCase.steps.length} steps
                          </span>
                          <Icon name={expanded ? "i-up" : "i-down"} size="sm" />
                        </button>

                        {expanded && (
                          <ol className="exec-steps" id={`case-steps-${key}`}>
                            {testCase.steps.map((step) => {
                              const stepMark = caseMarks[step.status];
                              const hasEvidence = evidenceSteps.has(
                                `${execution.executionId}#${testCase.scenarioId}#${step.order}`,
                              );
                              return (
                                <li key={step.order}>
                                  <span className="num sm">{String(step.order).padStart(2, "0")}</span>
                                  <span className={`chip ${stepMark.tone}`}>
                                    <Icon name={stepMark.icon} />
                                    {stepMark.label}
                                  </span>
                                  <span className="exec-step-ti">
                                    <strong>{step.action}</strong>
                                    <span>{step.expected}</span>
                                    {step.diagnostics?.reason && (
                                      <code className="path">{step.diagnostics.reason.code}</code>
                                    )}
                                  </span>
                                  {/* 증적이 없는 단계에 버튼을 두지 않는다. 눌러 보고 나서야 없다는 것을 알게 된다. */}
                                  {hasEvidence ? (
                                    <button
                                      className="btn sm"
                                      type="button"
                                      onClick={() =>
                                        onOpenStepEvidence(
                                          execution.scenarioRunId,
                                          execution.executionId,
                                          testCase.scenarioId,
                                          step.order,
                                        )
                                      }
                                    >
                                      <Icon name="i-images" size="sm" />
                                      증적
                                    </button>
                                  ) : (
                                    <span className="path">증적 없음</span>
                                  )}
                                </li>
                              );
                            })}
                          </ol>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </>
      )}
    </>
  );
}
