import { useEffect, useMemo, useRef, useState } from "react";
import { REVIEW_DECISION_OPTIONS, type ReviewDecision } from "../../../shared/evidence";
import type {
  GateRejectionCode,
  StepDiagnostics,
  StepEvidence,
  StepReasonCode,
  TestCaseResult,
  TestExecution,
  TestStepStatus,
} from "../../../shared/test-execution";
import { EvidenceViewport } from "./EvidenceViewport";
import { Icon } from "./Icon";
import type { IconName } from "./IconSprite";

/* 실행 상세. 목업 S10 레이아웃(헤더 카드 + 실행 이력 / 수행 대기열 / 최근 화면)을
 * 따른다. 판정 사유·assertion·실행 경로·관측 횟수를 단계마다 드러내고,
 * 「확인 필요」를 사유 없이 표시하지 않는다. */

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
  /** 대기열에 올라간 실행을 시작한다. queued 상태에서만 제공한다. */
  onStart?: (dataBindings: Record<string, string>) => void | Promise<void>;
  starting?: boolean;
  /** 실행 중 마지막으로 보고된 단계. backend event 로만 채운다. */
  lastStep?: { stepId: string; verdict: string };
  /** 명령이 거절된 사유 코드. 문구는 이 화면이 소유한다. */
  commandError?: string;
  /** 정본 실행의 step 증적을 연다. fixture 경로에는 없다. */
  onOpenStepEvidence?: (scenarioId: string, order: number) => void;
  /** 실패·미판정 케이스만 새 실행으로 다시 돌린다. */
  onRetrySelected?: (scenarioIds: string[]) => void | Promise<void>;
  /** step 행에서 빠르게 남기는 검토. 메모 없이 판단만 기록한다. */
  onQuickReview?: (scenarioId: string, order: number, decision: ReviewDecision) => void | Promise<void>;
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

/* 상태 -> 색조와 글리프. 색만으로 구분하지 않는다. 「확인 필요」는 「대기」와
 * 다른 글리프를 쓴다. */
const tones: Record<TestStepStatus, { tone: string; icon: IconName }> = {
  passed: { tone: "ok", icon: "i-check" },
  failed: { tone: "bad", icon: "i-alert" },
  inconclusive: { tone: "warn", icon: "i-help" },
  cancelled: { tone: "idle", icon: "i-square" },
  skipped: { tone: "idle", icon: "i-minus" },
  running: { tone: "run", icon: "i-loader" },
  queued: { tone: "idle", icon: "i-circle" },
};

/* 판정 사유 문구. 코드는 main 이 주고 문구는 renderer 가 소유한다.
 * 계약은 docs/screens/05-test-center.md 를 따른다. */
const reasonLabels: Record<StepReasonCode, string> = {
  TARGET_NOT_FOUND: "화면에서 대상을 찾지 못함",
  BUDGET_EXHAUSTED: "관측 예산 소진",
  ACTION_OUTCOME_UNKNOWN: "조작 결과 확인 불가",
  GATE_REJECTED: "제안 거절",
  FRAME_MASKING_FAILED: "마스킹 실패로 중단",
  SCREEN_TEXT_INSTRUCTION_DETECTED: "화면 텍스트의 지시 시도 감지",
  MISSING_DATA_BINDING: "테스트 데이터 연결 누락",
};

const gateLabels: Record<GateRejectionCode, string> = {
  STEP_MISMATCH: "응답이 다른 단계를 가리킴",
  ACTION_NOT_ALLOWED: "허용되지 않은 동작",
  LOCUS_OUT_OF_BOUNDS: "화면 밖 좌표",
  OBSERVED_LABEL_MISMATCH: "읽은 라벨이 대상과 다름",
  TARGET_NOT_DISAMBIGUATED: "대상을 구별하지 못함",
  CANDIDATE_VERIFICATION_FAILED: "대조 실패",
  CONFIDENCE_BELOW_THRESHOLD: "신뢰도 미달",
  DESTRUCTIVE_ACTION_NOT_PERMITTED: "파괴적 동작 미허용",
  BUDGET_EXHAUSTED: "예산 소진",
};

/* 실행 명령 거절 사유. 코드는 main 이 주고 문구는 이 화면이 소유한다. */
const commandErrorLabels: Record<string, string> = {
  VISION_MODEL_BINDING_UNAVAILABLE: "모델 설정이 이 세션에 저장되지 않았습니다. 설정을 다시 저장하세요",
  MODEL_CREDENTIAL_UNAVAILABLE: "저장된 API 키를 찾을 수 없습니다",
  NO_QUEUED_BATCH: "실행할 대기열 batch가 없습니다",
  TARGET_KIND_UNSUPPORTED: "이 대상 유형은 아직 수행할 수 없습니다",
  TARGET_ENTRY_SCHEME_FORBIDDEN: "허용되지 않은 진입 주소입니다",
  EXECUTION_MANIFEST_INVALID: "실행 기록이 손상됐습니다",
  DESKTOP_BRIDGE_UNAVAILABLE: "데스크톱 앱에서만 실행할 수 있습니다",
  PROJECT_OR_RUN_INVALID: "프로젝트 또는 생성 이력이 올바르지 않습니다",
  REVIEW_AUTHOR_REQUIRED: "증적 상세에서 검토자 이름을 먼저 입력하세요",
  ENQUEUE_FAILED: "대기열에 추가하지 못했습니다",
  RETRY_FAILED: "재시도를 만들지 못했습니다",
  SCENARIO_ALREADY_IN_EXECUTION: "이미 이 실행에 담긴 시나리오입니다",
  EXECUTION_ALREADY_SETTLED: "결과가 확정된 실행에는 추가할 수 없습니다",
  TARGET_PROFILE_MISMATCH: "대상 설정이 기존 실행과 다릅니다",
};

function reasonText(diagnostics: StepDiagnostics): string | null {
  const reason = diagnostics.reason;
  if (!reason) return null;
  const base = reasonLabels[reason.code];
  return reason.code === "GATE_REJECTED" && reason.gateCode
    ? `${base} · ${gateLabels[reason.gateCode]}`
    : base;
}

function StepDiagnosticsView({ diagnostics }: { diagnostics: StepDiagnostics }) {
  const reason = reasonText(diagnostics);
  const retries = diagnostics.attempts?.filter((attempt) => attempt.outcome !== "accepted").length ?? 0;
  if (!reason && !diagnostics.assertions?.length && !diagnostics.path) return null;

  return (
    <div className="diag">
      {reason && (
        <p>
          <Icon name="i-alert" size="sm" />
          {reason}
          {diagnostics.reason?.detail ? ` · ${diagnostics.reason.detail}` : ""}
        </p>
      )}
      {diagnostics.assertions?.map((assertion) => (
        <div className="asrt" key={assertion.ref}>
          <code>{assertion.ref}</code>
          <span className={`chip ${tones[assertion.status].tone}`}>{statusLabels[assertion.status]}</span>
          <span>{assertion.detail}</span>
        </div>
      ))}
      <dl>
        {diagnostics.path && (
          <div>
            <dt>실행 경로</dt>
            <dd>
              {diagnostics.path.adapter} · {diagnostics.path.surface === "visual" ? "비전" : "구조화"}
              {diagnostics.path.fallbackFrom ? ` · ${diagnostics.path.fallbackFrom}에서 전환` : ""}
            </dd>
          </div>
        )}
        {retries > 0 && (
          <div>
            <dt>제안 재시도</dt>
            <dd>{retries}회</dd>
          </div>
        )}
        {diagnostics.observations !== undefined && (
          <div>
            <dt>관측</dt>
            <dd>{diagnostics.observations}회</dd>
          </div>
        )}
      </dl>
    </div>
  );
}

function latestEvidence(testCase: TestCaseResult): StepEvidence | null {
  return [...testCase.steps].reverse().find((step) => step.evidence)?.evidence ?? null;
}

function executionProgress(execution: TestExecution) {
  const steps = execution.cases.flatMap((testCase) => testCase.steps);
  const complete = steps.filter((step) =>
    ["passed", "failed", "inconclusive", "skipped", "cancelled"].includes(step.status),
  ).length;
  return { complete, total: steps.length };
}

function executionResultCounts(execution: TestExecution) {
  const steps = execution.cases.flatMap((testCase) => testCase.steps);
  return {
    passed: steps.filter((step) => step.status === "passed").length,
    failed: steps.filter((step) => step.status === "failed").length,
    remaining: steps.filter((step) => ["queued", "running"].includes(step.status)).length,
  };
}

function executionStatusLabel(execution: TestExecution) {
  if (execution.status === "running") return "순차 실행 중";
  if (execution.status === "failed") return "실패로 종료";
  if (execution.status === "passed") return "실행 완료";
  if (execution.status === "preparing") return "환경 준비 중";
  if (execution.status === "cancelled") return "사용자 중단";
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
  onStart,
  starting = false,
  lastStep,
  commandError,
  onOpenStepEvidence,
  onRetrySelected,
  onQuickReview,
}: Props) {
  const initialCase = preferredCase(execution);
  const [selectedScenarioId, setSelectedScenarioId] = useState(initialCase?.scenarioId ?? "");
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);
  /* 값은 저장되지 않으므로 실행 시점에 다시 받는다. 실행 요청 뒤 즉시 비운다. */
  const [runValues, setRunValues] = useState<Record<string, string>>({});
  const requiredBindings = execution.requiredBindings ?? [];
  /* 성공한 케이스까지 다시 돌리지 않는다. 긴 여정에서는 실패한 것만 다시 도는
   * 것이 기본이다. */
  const retryableScenarioIds = execution.cases
    .filter((testCase) =>
      ["failed", "inconclusive", "queued", "cancelled", "skipped"].includes(testCase.status),
    )
    .map((testCase) => testCase.scenarioId);
  const missingBindings = requiredBindings.filter(
    (binding) => !(runValues[binding.bindingKey] ?? "").trim(),
  );
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
        cancelDialogRef.current?.querySelectorAll<HTMLButtonElement>("button:not([disabled])") ?? [],
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
  const resultCounts = useMemo(() => executionResultCounts(execution), [execution]);
  const progressPercent = progress.total
    ? Math.round((progress.complete / progress.total) * 100)
    : 0;
  const historyRecords = useMemo(
    () =>
      [execution, ...history]
        .filter(
          (record, index, records) =>
            records.findIndex((candidate) => candidate.executionId === record.executionId) === index,
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
      total + testCase.steps.reduce((stepTotal, step) => stepTotal + (step.evidence?.captures.length ?? 0), 0),
    0,
  );
  const remainingCases = execution.cases.filter((testCase) =>
    ["running", "queued"].includes(testCase.status),
  ).length;
  const executionTone = tones[execution.status as TestStepStatus] ?? tones.queued;
  const barTone =
    execution.status === "failed"
      ? " bad"
      : execution.status === "passed"
        ? " ok"
        : execution.status === "cancelled"
          ? " idle"
          : "";

  return (
    <>
      <div
        className="card"
        style={{ padding: "16px 20px", flex: "none" }}
        aria-hidden={cancelConfirmOpen || undefined}
        inert={cancelConfirmOpen || undefined}
      >
        <div className="between">
          <div style={{ minWidth: 0 }}>
            <button className="btn link" type="button" onClick={onBackToScenarios}>
              <Icon name="i-arrow-l" size="sm" />
              시나리오 도출로 돌아가기
            </button>
            <div style={{ display: "flex", alignItems: "center", gap: 9, marginTop: 5 }}>
              <h1 className="h1" style={{ fontSize: 19 }}>
                테스트 수행
              </h1>
              <span className={`chip ${executionTone.tone}`}>
                <Icon name={executionTone.icon} />
                {executionStatusLabel(execution)}
              </span>
            </div>
            <p className="path" style={{ marginTop: 5 }}>
              {execution.executionId}
              {execution.targetUrl ? ` · ${execution.targetUrl}` : ""}
            </p>
          </div>
          <div className="end" style={{ gap: 20, alignItems: "center" }}>
            <div className="stat">
              <p className="num sm">
                {progressPercent}
                <u>%</u>
              </p>
              <span className="path">
                {progress.complete}/{progress.total} steps
              </span>
            </div>
            <div className="prog-cell">
              <p className="counts">
                <span style={{ color: "var(--ok)" }}>성공 {resultCounts.passed}</span>
                <span style={{ color: resultCounts.failed > 0 ? "var(--bad)" : undefined }}>
                  실패 {resultCounts.failed}
                </span>
                <span className="mut">미수행 {resultCounts.remaining}</span>
              </p>
              <div
                className={`bar${barTone}`}
                role="progressbar"
                aria-label="테스트 수행 진행률"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={progressPercent}
                aria-valuetext={`${progress.complete}/${progress.total}단계 수행, 성공 ${resultCounts.passed}, 실패 ${resultCounts.failed}, 미수행 ${resultCounts.remaining}`}
              >
                <span style={{ width: `${progressPercent}%` }} />
              </div>
            </div>
            {execution.status === "running" && execution.executionId === currentExecutionId ? (
              <button
                ref={cancelTriggerRef}
                className="btn"
                type="button"
                onClick={() => setCancelConfirmOpen(true)}
              >
                <Icon name="i-square" size="sm" />
                실행 중단
              </button>
            ) : execution.status !== "running" && execution.status !== "queued" ? (
              <div className="cta-row">
                {onRetrySelected && retryableScenarioIds.length > 0 && (
                  <button
                    className="btn pri"
                    type="button"
                    onClick={() => void onRetrySelected(retryableScenarioIds)}
                  >
                    <Icon name="i-retry" size="sm" />
                    실패·미판정 {retryableScenarioIds.length}개 재시도
                  </button>
                )}
                <button className="btn" type="button" onClick={onRetry}>
                  <Icon name="i-retry" size="sm" />
                  동일 조건 재시도
                </button>
              </div>
            ) : null}
          </div>
        </div>

        {commandError && (
          <p className="cta-why" style={{ marginTop: 12 }} role="alert">
            <Icon name="i-alert" size="sm" />
            {commandErrorLabels[commandError] ?? commandError}
          </p>
        )}
        {lastStep && (
          <p className="path" style={{ marginTop: 10 }} role="status">
            {lastStep.stepId} ·{" "}
            {statusLabels[lastStep.verdict.toLowerCase() as TestStepStatus] ?? lastStep.verdict}
          </p>
        )}

        {execution.status === "queued" && onStart && (
          <div style={{ marginTop: 14, borderTop: "1px solid var(--line)", paddingTop: 14 }}>
            {requiredBindings.length > 0 && (
              <fieldset className="fs" style={{ marginBottom: 12 }}>
                <legend>
                  <Icon name="i-key" size="sm" />
                  실행에 필요한 데이터
                </legend>
                <p className="note">값은 저장되지 않습니다. 실행할 때마다 다시 입력합니다.</p>
                <div className="g2">
                  {requiredBindings.map((binding) => {
                    const inputId = `run-binding-${binding.bindingKey}`;
                    return (
                      <label className="field" style={{ marginBottom: 0 }} key={binding.bindingKey} htmlFor={inputId}>
                        <span className="lb">
                          {binding.secret && <Icon name="i-lock" size="sm" />}
                          {binding.bindingKey}
                        </span>
                        <input
                          className="inp"
                          id={inputId}
                          type={binding.secret ? "password" : "text"}
                          autoComplete="off"
                          value={runValues[binding.bindingKey] ?? ""}
                          onChange={(changeEvent) =>
                            setRunValues((current) => ({
                              ...current,
                              [binding.bindingKey]: changeEvent.target.value,
                            }))
                          }
                        />
                        {binding.secret && <span className="hint">참조만 저장됩니다</span>}
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            )}
            <div className="cta-row">
              <button
                className="btn pri"
                type="button"
                onClick={() => {
                  const values = { ...runValues };
                  // 값을 화면 상태에 남기지 않는다.
                  setRunValues({});
                  void onStart(values);
                }}
                disabled={starting || missingBindings.length > 0}
              >
                <Icon name="i-play" size="sm" />
                {starting ? "수행 중" : "대기열 실행"}
              </button>
              {missingBindings.length > 0 && (
                <span className="cta-why">
                  <Icon name="i-alert" size="sm" />
                  테스트 데이터 {missingBindings.length}개가 비어 있습니다.
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      <div
        className="split-3"
        style={{ gridTemplateColumns: "214px minmax(0,1fr) 268px" }}
        aria-hidden={cancelConfirmOpen || undefined}
        inert={cancelConfirmOpen || undefined}
      >
        <aside className="panel" aria-label="테스트 실행 이력">
          <div className="panel-h">
            <h2 className="h3">실행 이력</h2>
            <span className="end">{historyRecords.length}</span>
          </div>
          <div className="panel-s">
            {historyRecords.map((record) => {
              const tone = tones[record.status as TestStepStatus] ?? tones.queued;
              return (
                <button
                  className={`row${record.executionId === execution.executionId ? " on" : ""}`}
                  style={{ minHeight: 52, padding: "0 12px" }}
                  type="button"
                  key={record.executionId}
                  onClick={() => onSelectExecution(record)}
                  aria-current={record.executionId === execution.executionId ? "true" : undefined}
                >
                  <span className={`mark sm ${tone.tone}`}>
                    <Icon name={tone.icon} size="sm" />
                  </span>
                  <span className="row-main">
                    <strong style={{ fontSize: 11.5 }}>{record.executionId}</strong>
                    <span>
                      {record.executionId === currentExecutionId ? "현재 실행 · " : ""}
                      {executionStatusLabel(record)}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
          <div className="panel-f">
            <Icon name="i-clock" size="sm" />
            <span style={{ fontSize: 11.5, color: "var(--ink-2)" }}>위에서 아래로 순차 수행</span>
          </div>
        </aside>

        <section className="panel" aria-labelledby="execution-queue-title">
          <div className="panel-h">
            <h2 className="h3" id="execution-queue-title">
              수행 대기열
            </h2>
            <span className="end">{execution.cases.length} cases</span>
          </div>
          <div className="panel-s">
            {execution.cases.map((testCase, caseIndex) => {
              const open = selectedCase?.scenarioId === testCase.scenarioId;
              const tone = tones[testCase.status];
              return (
                <article className={`qcase${open ? " on" : ""}`} key={testCase.scenarioId}>
                  <button
                    className="qhd"
                    type="button"
                    onClick={() => setSelectedScenarioId(testCase.scenarioId)}
                    aria-expanded={open}
                    aria-controls={`execution-steps-${testCase.scenarioId}`}
                  >
                    <span className="qno">{String(caseIndex + 1).padStart(2, "0")}</span>
                    <span className="qti">
                      <code>{testCase.scenarioId}</code>
                      <strong>{testCase.title}</strong>
                    </span>
                    <span className={`chip ${tone.tone}`}>
                      <Icon name={tone.icon} />
                      {statusLabels[testCase.status]}
                    </span>
                  </button>
                  {open && (
                    <ol className="qsteps" id={`execution-steps-${testCase.scenarioId}`}>
                      {testCase.steps.map((step) => {
                        const stepTone = tones[step.status];
                        const canOpenEvidence = Boolean(step.evidence) ||
                          (Boolean(onOpenStepEvidence) && step.status !== "queued");
                        return (
                          <li key={step.order}>
                            <span className={`sic mark ${stepTone.tone}`}>
                              <Icon name={stepTone.icon} size="sm" />
                            </span>
                            <div>
                              <small>STEP {String(step.order).padStart(2, "0")}</small>
                              <strong>{step.action}</strong>
                              <span className="exp">{step.expected}</span>
                              {step.diagnostics && <StepDiagnosticsView diagnostics={step.diagnostics} />}
                              {onQuickReview && step.status !== "queued" && (
                                <div
                                  className="qrev"
                                  role="group"
                                  aria-label={`${testCase.scenarioId} ${step.order}단계 빠른 검토`}
                                >
                                  <span>빠른 검토</span>
                                  {REVIEW_DECISION_OPTIONS.map((decision) => (
                                    <button
                                      className="btn sm"
                                      key={decision}
                                      type="button"
                                      onClick={() => void onQuickReview(testCase.scenarioId, step.order, decision)}
                                    >
                                      {decision}
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                            <span className={`chip ${stepTone.tone}`}>
                              <Icon name={stepTone.icon} />
                              {statusLabels[step.status]}
                            </span>
                            {canOpenEvidence ? (
                              <button
                                className="btn icon sm"
                                type="button"
                                onClick={() =>
                                  step.evidence
                                    ? onOpenEvidence(step.evidence)
                                    : onOpenStepEvidence?.(testCase.scenarioId, step.order)
                                }
                                aria-label={`${testCase.scenarioId} ${step.order}단계 증적 열기`}
                              >
                                <Icon name="i-camera" size="sm" />
                              </button>
                            ) : (
                              <span />
                            )}
                          </li>
                        );
                      })}
                    </ol>
                  )}
                </article>
              );
            })}
          </div>
        </section>

        <aside className="panel" aria-label="선택한 케이스 증적">
          <div className="panel-h">
            <h2 className="h3">최근 화면</h2>
            <span className="end">
              <Icon name="i-camera" size="sm" />
            </span>
          </div>
          {selectedCase && evidence ? (
            <div className="panel-s" style={{ padding: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <code className="path">{evidence.evidenceId}</code>
                <span className={`chip ${tones[evidence.status].tone}`} style={{ marginLeft: "auto" }}>
                  <Icon name={tones[evidence.status].icon} />
                  {statusLabels[evidence.status]}
                </span>
              </div>
              <EvidenceViewport failed={evidence.status === "failed"} compact />
              <dl className="kv" style={{ margin: "12px 0" }}>
                <div className="col">
                  <dt>단계</dt>
                  <dd className="wrap">
                    {String(evidence.stepOrder).padStart(2, "0")}. {evidence.action}
                  </dd>
                </div>
                <div className="col">
                  <dt>실제 결과</dt>
                  <dd className="wrap">{evidence.actual}</dd>
                </div>
              </dl>
              <div className="stack" style={{ gap: 8 }}>
                <button className="btn pri sm" type="button" onClick={() => onOpenEvidence(evidence)}>
                  <Icon name="i-eye" size="sm" />
                  증적 상세 보기
                </button>
                <button
                  className="btn link"
                  style={{ justifyContent: "center" }}
                  type="button"
                  onClick={() => onOpenScenario(selectedCase.scenarioId)}
                >
                  시나리오에서 보기
                  <Icon name="i-right" size="sm" />
                </button>
              </div>
            </div>
          ) : (
            <div className="panel-s">
              <div className="empty">
                <span className="ic">
                  <Icon name="i-camera" />
                </span>
                <h3>단계 수행 대기 중</h3>
                <p>완료된 단계마다 화면 1장이 자동 저장됩니다.</p>
              </div>
            </div>
          )}
        </aside>
      </div>

      {cancelConfirmOpen && (
        <div className="scrim">
          <section
            ref={cancelDialogRef}
            className="dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="cancel-confirm-title"
          >
            <span className="dic mark idle">
              <Icon name="i-square" />
            </span>
            <h2 id="cancel-confirm-title">현재 실행을 중단할까요?</h2>
            <p>
              지금까지 저장한 증적은 유지되고, 수행하지 않은 케이스는 건너뜀으로 기록됩니다.
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
            <div className="acts">
              <button
                ref={continueButtonRef}
                className="btn"
                type="button"
                onClick={() => setCancelConfirmOpen(false)}
              >
                계속 수행
              </button>
              <button
                className="btn dan"
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
    </>
  );
}
