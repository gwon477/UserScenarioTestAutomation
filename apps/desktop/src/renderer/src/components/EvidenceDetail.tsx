import { useEffect, useMemo, useState } from "react";
import {
  orderEvidenceCaptures,
  type EvidenceCapture,
  type StepEvidence,
} from "../../../shared/test-execution";
import type {
  HumanReviewView,
  ReviewCauseTag,
  ReviewDecision,
  StepEvidenceView,
} from "../../../shared/evidence";
import { CapturedFrame, FRAME_LABELS } from "./CapturedFrame";
import { StepReviewThread } from "./StepReviewThread";
import { EvidenceViewport } from "./EvidenceViewport";
import { Icon } from "./Icon";
import type { IconName } from "./IconSprite";

/* 증적 상세. 목업 S12 레이아웃(단계 타임라인 / 대상 화면 캡처 + 필름스트립 /
 * 판정 근거)을 따른다.
 *
 * 기록이 있으면 fixture 타임라인을 렌더하지 않는다. 가짜 시각을 실제 데이터
 * 옆에 두지 않는다. */

type Props = {
  /* 증적이 이미 소속 실행을 알고 있다. 실행 목록 투영에 묶지 않는다.
   * 정본 run 검증이 실패한 프로젝트에서는 실행 투영이 비는데, 증적은
   * 그대로 남아 있고 열려야 한다. */
  executionId: string;
  evidence: StepEvidence;
  /* 정본 실행이 남긴 기록. 있으면 실제 프레임과 제안 좌표를 보여준다.
   * 없으면 fixture 화면을 그대로 쓴다. */
  record?: StepEvidenceView;
  frames?: Readonly<Record<string, string>>;
  /* 사람 검토. 기록이 있는 정본 증적에서만 제공한다. */
  reviews?: readonly HumanReviewView[];
  reviewAuthor?: string;
  onReviewAuthorChange?: (author: string) => void;
  onAddReview?: (input: { decision: ReviewDecision; causeTag?: ReviewCauseTag; note: string }) => Promise<void>;
  onBack: () => void;
  /** 돌아갈 곳의 이름. 실행 상세로 갈 수 없으면 증적 목록으로 돌아간다. */
  backLabel: string;
  onOpenScenario: (scenarioId: string) => void;
  /* 재시도는 실행 맥락이 있어야 한다. 없으면 버튼을 두지 않는다.
   * 없는 동작을 버튼으로 두면 눌러 보고 나서야 없다는 것을 알게 된다. */
  onRetry?: () => void;
};

const captureLabels: Record<EvidenceCapture["kind"], string> = {
  failure: "실패 시점",
  "before-failure": "실패 직전",
  "action-complete": "이전 단계 완료",
};

const results: Record<StepEvidence["status"], { label: string; tone: string; icon: IconName }> = {
  passed: { label: "성공", tone: "ok", icon: "i-check" },
  failed: { label: "실패", tone: "bad", icon: "i-alert" },
  inconclusive: { label: "확인 필요", tone: "warn", icon: "i-help" },
  cancelled: { label: "중단", tone: "idle", icon: "i-square" },
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
  executionId,
  evidence,
  record,
  frames,
  reviews,
  reviewAuthor,
  onReviewAuthorChange,
  onAddReview,
  onBack,
  backLabel,
  onOpenScenario,
  onRetry,
}: Props) {
  const captures = useMemo(() => orderEvidenceCaptures(evidence.captures), [evidence.captures]);
  const [selectedCaptureId, setSelectedCaptureId] = useState(captures[0]?.id ?? "");
  /* 타임라인용 시간순 정렬. 필름스트립은 실패 시점을 먼저 보여주지만 타임라인은
   * 일어난 순서여야 한다. */
  const timeline = useMemo(
    () => [...captures].sort((left, right) => left.capturedAt.localeCompare(right.capturedAt)),
    [captures],
  );
  const selectedCapture = captures.find((capture) => capture.id === selectedCaptureId) ?? captures[0];

  /* 기록된 프레임 중 판정 근거가 되는 것을 먼저 띄운다. 모델 전송본이 그 프레임이다. */
  const recordedFrames = record?.frames ?? [];
  const defaultFrameId =
    recordedFrames.find((frame) => frame.kind === "model-input")?.id ?? recordedFrames[0]?.id ?? "";
  const [selectedFrameId, setSelectedFrameId] = useState(defaultFrameId);
  useEffect(() => {
    setSelectedFrameId(defaultFrameId);
  }, [defaultFrameId]);
  const selectedFrame = recordedFrames.find((frame) => frame.id === selectedFrameId) ?? recordedFrames[0];

  const result = results[evidence.status];
  const stageSize = record
    ? selectedFrame?.size
    : selectedCapture
      ? { width: selectedCapture.width, height: selectedCapture.height }
      : undefined;

  return (
    <>
      <div className="between" style={{ flex: "none" }}>
        <div style={{ minWidth: 0 }}>
          <button className="btn link" type="button" onClick={onBack}>
            <Icon name="i-arrow-l" size="sm" />
            {backLabel}
          </button>
          <div style={{ display: "flex", alignItems: "center", gap: 9, marginTop: 5 }}>
            <h1 className="h1" style={{ fontSize: 19 }}>
              {evidence.status === "failed" ? "실패 증적 상세" : "단계 증적 상세"}
            </h1>
            <span className={`chip ${result.tone}`}>
              <Icon name={result.icon} />
              {result.label}
            </span>
          </div>
          <p className="path" style={{ marginTop: 4 }}>
            {evidence.evidenceId} · {executionId}
          </p>
        </div>
        <div className="end">
          {onRetry && (
            <button className="btn pri" type="button" onClick={onRetry}>
              <Icon name="i-retry" />
              동일 케이스 재시도
            </button>
          )}
          <button className="btn link" type="button" onClick={() => onOpenScenario(evidence.scenarioId)}>
            시나리오에서 보기
            <Icon name="i-right" />
          </button>
        </div>
      </div>

      <div className="split-3" style={{ gridTemplateColumns: "236px minmax(0,1fr) 274px" }}>
        <aside className="panel" aria-label="단계 타임라인">
          <div className="panel-h">
            <h2 className="h3">단계 타임라인</h2>
          </div>
          <div className="panel-s">
            <div style={{ display: "flex", gap: 8, padding: "13px 16px 4px" }}>
              <code className="path">{evidence.scenarioId}</code>
              <strong style={{ fontSize: 11.5, marginLeft: "auto" }}>
                STEP {String(evidence.stepOrder).padStart(2, "0")}
              </strong>
            </div>
            {record ? (
              /* 기록이 있으면 gate 제안 회차와 확정 판정만 보여준다. 시각을
               * 만들어내지 않는다. */
              <ol className="tl">
                {record.attempts.map((attempt) => (
                  <li key={`${attempt.attempt}-${attempt.outcome}`}>
                    <span className={`dt2 mark ${attempt.outcome === "accepted" ? "ok" : "bad"}`}>
                      <Icon name={attempt.outcome === "accepted" ? "i-check" : "i-alert"} size="sm" />
                    </span>
                    <div>
                      <small>제안 {attempt.attempt}회차</small>
                      <strong>
                        {attempt.outcome === "accepted"
                          ? "gate 통과"
                          : `gate 거절${attempt.code ? ` · ${attempt.code}` : ""}`}
                      </strong>
                    </div>
                  </li>
                ))}
                <li>
                  <span className={`dt2 mark ${record.verdict === "PASSED" ? "ok" : record.verdict === "FAILED" ? "bad" : "warn"}`}>
                    <Icon
                      name={record.verdict === "PASSED" ? "i-check" : record.verdict === "FAILED" ? "i-alert" : "i-help"}
                      size="sm"
                    />
                  </span>
                  <div>
                    <small>관측 {record.observations}회</small>
                    <strong>판정: {record.verdict}</strong>
                    {record.reason && (
                      <p>
                        {record.reason.code} · {record.reason.detail}
                      </p>
                    )}
                  </div>
                </li>
              </ol>
            ) : (
              /* fixture 경로. 저장된 캡처의 시각만 쓰고 문구를 붙인다.
               * 타임라인은 시간순이다. 필름스트립의 정렬(실패 시점 우선)을 그대로
               * 쓰면 진행이 거꾸로 읽힌다. */
              <ol className="tl">
                {timeline.map((capture) => (
                  <li key={capture.id}>
                    <span className={`dt2 mark ${capture.kind === "failure" ? "bad" : "idle"}`}>
                      <Icon name={capture.kind === "failure" ? "i-alert" : "i-camera"} size="sm" />
                    </span>
                    <div>
                      <small>{capturedTime(capture.capturedAt)}</small>
                      <strong>{captureLabels[capture.kind]}</strong>
                      {/* 라벨이 제목과 같으면 같은 문구를 두 번 보여주지 않는다. */}
                      {capture.label !== captureLabels[capture.kind] && (
                        <p>{capture.label ?? "대상 화면을 저장했습니다."}</p>
                      )}
                    </div>
                  </li>
                ))}
                <li>
                  <span className={`dt2 mark ${result.tone}`}>
                    <Icon name={result.icon} size="sm" />
                  </span>
                  <div>
                    <small>{selectedCapture ? capturedTime(selectedCapture.capturedAt) : "-"}</small>
                    <strong>판정: {result.label}</strong>
                  </div>
                </li>
              </ol>
            )}
          </div>
        </aside>

        <section className="panel" aria-labelledby="capture-inspector-title">
          <div className="panel-h">
            <h2 className="h3" id="capture-inspector-title">
              대상 화면 캡처
            </h2>
            <span className="end path">
              {stageSize ? `${stageSize.width} × ${stageSize.height}` : "-"}
            </span>
          </div>
          <div
            className="panel-s"
            style={{ padding: 16, display: "grid", placeItems: "center", background: "var(--surface-3)" }}
          >
            {record && selectedFrame ? (
              <CapturedFrame
                frame={selectedFrame}
                {...(frames?.[selectedFrame.relativePath]
                  ? { dataUrl: frames[selectedFrame.relativePath] }
                  : {})}
                {...(record.proposal ? { proposalPoint: record.proposal.modelPoint } : {})}
                maskedRegions={record.maskedRegions}
              />
            ) : (
              <EvidenceViewport failed={selectedCapture?.kind === "failure"} />
            )}
          </div>
          <div className="film" aria-label="저장된 화면 목록">
            {record
              ? recordedFrames.map((frame) => {
                  const dataUrl = frames?.[frame.relativePath];
                  return (
                    <button
                      className={`${frame.id === selectedFrame?.id ? "on " : ""}${
                        frame.kind === "model-input" ? "fail" : ""
                      }`}
                      type="button"
                      key={frame.id}
                      onClick={() => setSelectedFrameId(frame.id)}
                      aria-pressed={frame.id === selectedFrame?.id}
                    >
                      <span className="th">{dataUrl && <img src={dataUrl} alt="" />}</span>
                      <strong>{FRAME_LABELS[frame.kind] ?? frame.kind}</strong>
                      <small>{frame.round}회차</small>
                    </button>
                  );
                })
              : captures.map((capture) => (
                  <button
                    className={`${capture.id === selectedCapture?.id ? "on " : ""}${
                      capture.kind === "failure" ? "fail" : ""
                    }`}
                    type="button"
                    key={capture.id}
                    onClick={() => setSelectedCaptureId(capture.id)}
                    aria-pressed={capture.id === selectedCapture?.id}
                  >
                    <span className="th" />
                    <strong>
                      {evidence.status === "passed" && capture.kind === "action-complete"
                        ? "단계 완료"
                        : captureLabels[capture.kind]}
                    </strong>
                    <small>{capturedTime(capture.capturedAt)}</small>
                  </button>
                ))}
          </div>
        </section>

        <aside className="panel" aria-label="판정 근거">
          <div className="panel-h">
            <h2 className="h3">판정 근거</h2>
          </div>
          <div className="panel-s" style={{ padding: 16 }}>
            <dl className="kv" style={{ marginBottom: 12 }}>
              <div className="col">
                <dt>수행 동작</dt>
                <dd className="wrap">{evidence.action}</dd>
              </div>
              <div className="col">
                <dt>기대 결과</dt>
                <dd className="wrap">{evidence.expected}</dd>
              </div>
              <div className="col" style={{ background: evidence.status === "failed" ? "var(--bad-soft)" : undefined }}>
                <dt style={{ color: evidence.status === "failed" ? "var(--bad)" : undefined }}>실제 결과</dt>
                <dd className="wrap">{evidence.actual}</dd>
              </div>
            </dl>

            {evidence.error && (
              <div className="diag" style={{ marginBottom: 12 }}>
                <p>
                  <Icon name="i-alert" size="sm" />
                  오류 정보
                </p>
                <div style={{ marginTop: 7, display: "flex", flexDirection: "column", gap: 4 }}>
                  {evidence.error.code && <code className="path">{evidence.error.code}</code>}
                  <strong style={{ fontSize: 11.5 }}>{evidence.error.category}</strong>
                  <p style={{ color: "var(--ink-2)", fontWeight: 400 }}>{evidence.error.message}</p>
                </div>
              </div>
            )}

            {record ? (
              /* 좌표계를 세 값으로 모두 보여준다. 실측에서 이 세 값의 불일치가
               * 정확한 모델을 못 맞히는 것처럼 보이게 한 원인이었다. */
              <dl className="kv">
                <div className="col">
                  <dt>
                    <Icon name="i-monitor" size="sm" /> 좌표계
                  </dt>
                  <dd className="wrap">
                    캡처 {record.frameSpace.captureSize.width}×{record.frameSpace.captureSize.height} · 전송{" "}
                    {record.frameSpace.modelSize.width}×{record.frameSpace.modelSize.height} · 배율{" "}
                    {record.frameSpace.scale.toFixed(4)}
                  </dd>
                </div>
                {record.proposal && (
                  <>
                    <div className="col">
                      <dt>
                        <Icon name="i-grip" size="sm" /> 제안 좌표
                      </dt>
                      <dd className="wrap">
                        전송 {record.proposal.modelPoint.x},{record.proposal.modelPoint.y} · 실제{" "}
                        {record.proposal.capturePoint.x},{record.proposal.capturePoint.y}
                      </dd>
                    </div>
                    <div className="col">
                      <dt>
                        <Icon name="i-eye" size="sm" /> 모델이 읽은 텍스트
                      </dt>
                      <dd className="wrap">{record.proposal.observedLabel || "(없음)"}</dd>
                    </div>
                  </>
                )}
                {record.valueRef && (
                  <div className="col">
                    <dt>
                      <Icon name="i-key" size="sm" /> 사용한 데이터
                    </dt>
                    <dd className="wrap">{record.valueRef} (참조만 기록)</dd>
                  </div>
                )}
                <div className="col">
                  <dt>
                    <Icon name="i-route" size="sm" /> 연결 ID
                  </dt>
                  <dd className="path wrap">{evidence.scenarioId}</dd>
                </div>
              </dl>
            ) : (
              <dl className="kv">
                <div className="col">
                  <dt>
                    <Icon name="i-monitor" size="sm" /> 화면
                  </dt>
                  <dd>
                    Chromium · {selectedCapture?.width ?? "-"} × {selectedCapture?.height ?? "-"}
                  </dd>
                </div>
                <div className="col">
                  <dt>
                    <Icon name="i-clock" size="sm" /> 캡처
                  </dt>
                  <dd>{selectedCapture ? capturedTime(selectedCapture.capturedAt) : "-"}</dd>
                </div>
                <div className="col">
                  <dt>
                    <Icon name="i-route" size="sm" /> 연결 ID
                  </dt>
                  <dd className="path wrap">{evidence.scenarioId}</dd>
                </div>
              </dl>
            )}

            {record && onAddReview && onReviewAuthorChange && (
              <StepReviewThread
                reviews={reviews ?? []}
                author={reviewAuthor ?? ""}
                onAuthorChange={onReviewAuthorChange}
                onSubmit={onAddReview}
              />
            )}
          </div>
        </aside>
      </div>
    </>
  );
}
