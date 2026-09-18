import type { CSSProperties } from "react";
import { useState } from "react";
import type { EvidenceLibraryView } from "../../../shared/evidence-library";
import type { StepEvidence, TestExecution } from "../../../shared/test-execution";
import { EvidenceLibraryTable } from "./EvidenceLibraryTable";
import { formatBytes } from "../format";
import { Icon } from "./Icon";
import type { IconName } from "./IconSprite";

/* 「증적」 탭. 목업 S11 레이아웃을 따른다.
 *
 * 목록의 원천은 디스크이므로 재시작 후에도 살아 있다. 증적 삭제는 되돌릴 수
 * 없으므로 명시적 요구 없이 두지 않는다. */

type Props = {
  executions: TestExecution[];
  /* 정본 실행 트리에서 만든 목록. 있으면 이것을 보여준다.
   * 없으면 fixture 목록을 그대로 쓴다. */
  library?: EvidenceLibraryView;
  onBackToScenarios: () => void;
  onOpenEvidence: (evidence: StepEvidence) => void;
  onOpenStepEvidence?: (runId: string, executionId: string, scenarioId: string, order: number) => void;
};

const marks: Record<TestExecution["status"], { tone: string; icon: IconName; label: string }> = {
  passed: { tone: "ok", icon: "i-check", label: "실행 완료" },
  failed: { tone: "bad", icon: "i-alert", label: "실패로 종료" },
  inconclusive: { tone: "warn", icon: "i-help", label: "확인 필요" },
  cancelled: { tone: "idle", icon: "i-square", label: "사용자 중단" },
  running: { tone: "run", icon: "i-loader", label: "순차 실행 중" },
  preparing: { tone: "run", icon: "i-loader", label: "환경 준비 중" },
  queued: { tone: "idle", icon: "i-clock", label: "실행 대기" },
};

const RUN_COLS: CSSProperties = {
  "--cols": "28px minmax(0,1fr) 96px 96px 128px",
} as CSSProperties;

function allEvidence(execution: TestExecution) {
  return execution.cases.flatMap((testCase) =>
    testCase.steps.flatMap((step) => (step.evidence ? [step.evidence] : [])),
  );
}

export function EvidenceLibrary({
  executions,
  library,
  onBackToScenarios,
  onOpenEvidence,
  onOpenStepEvidence,
}: Props) {
  const storagePath = ".scenarioforge/runs/{runId}/tests/{executionId}/cases/";
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");

  async function copyStoragePath() {
    try {
      await navigator.clipboard.writeText(storagePath);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
    }
    window.setTimeout(() => setCopyStatus("idle"), 1800);
  }

  /* 정본 목록이 있으면 실행 수도 그 목록에서 센다. 실행 투영은 정본 run 검증을
   * 통과한 run 만 담으므로, 증적이 있는데 「실행 0」으로 보이는 일이 생긴다. */
  const executionCount = library
    ? new Set(library.entries.map((entry) => entry.executionId)).size
    : executions.length;
  const screens = library
    ? library.totals.frames
    : executions.reduce(
        (total, execution) =>
          total + allEvidence(execution).reduce((count, evidence) => count + evidence.captures.length, 0),
        0,
      );
  const bytes = library
    ? library.totals.bytes
    : executions.reduce((total, execution) => total + execution.evidenceBytes, 0);

  return (
    <>
      <div className="between hd">
        <div>
          <button className="btn link" type="button" onClick={onBackToScenarios}>
            <Icon name="i-arrow-l" size="sm" />
            시나리오 도출로 돌아가기
          </button>
          <span className="eyebrow" style={{ marginTop: 6 }}>
            LOCAL EVIDENCE
          </span>
          <h1 className="h1">테스트 증적</h1>
          <p className="sub" style={{ marginTop: 6 }}>
            단계별 화면과 판정 근거를 실행 ID 기준으로 보관합니다.
          </p>
        </div>
        <div className="stats">
          <div className="stat">
            <p className="num sm">{executionCount}</p>
            <span className="path">실행</span>
          </div>
          <div className="stat">
            <p className="num sm">{screens}</p>
            <span className="path">화면</span>
          </div>
          <div className="stat">
            <p className="num sm">{formatBytes(bytes)}</p>
            <span className="path">용량</span>
          </div>
        </div>
      </div>

      <div className="card flat pathbar">
        <Icon name="i-db" size="sm" />
        <code className="path" title={storagePath}>
          {storagePath}
        </code>
        <span className="end">
          <button className="btn sm" type="button" onClick={() => void copyStoragePath()}>
            <Icon name="i-copy" size="sm" />
            {copyStatus === "copied" ? "복사됨" : copyStatus === "failed" ? "복사 실패" : "경로 복사"}
          </button>
        </span>
        <span className="vh" role="status" aria-live="polite">
          {copyStatus === "copied"
            ? "증적 저장 경로를 복사했습니다."
            : copyStatus === "failed"
              ? "증적 저장 경로를 복사하지 못했습니다."
              : ""}
        </span>
      </div>

      {library && onOpenStepEvidence ? (
        <EvidenceLibraryTable library={library} onOpenStepEvidence={onOpenStepEvidence} />
      ) : (
        /* fixture 경로. 정본 목록이 없을 때만 실행 단위로 대표 증적을 보여준다. */
        <div className="card" style={{ overflow: "hidden" }}>
          <div className="rows tbl" style={RUN_COLS}>
            {executions.map((execution) => {
              const items = allEvidence(execution);
              const failure = items.find((item) => item.status === "failed");
              const representative = failure ?? items.at(-1);
              const mark = marks[execution.status];
              const captureCount = items.reduce((total, item) => total + item.captures.length, 0);
              return (
                <div className="row" key={execution.executionId}>
                  <span className={`mark ${mark.tone}`}>
                    <Icon name={mark.icon} size="sm" />
                  </span>
                  <span className="row-main">
                    <strong>
                      <span className="t">{execution.executionId}</span>
                      <span className={`chip ${mark.tone}`}>
                        <Icon name={mark.icon} />
                        {mark.label}
                      </span>
                    </strong>
                    <span>{execution.targetUrl}</span>
                  </span>
                  <span className="metric">
                    <Icon name="i-images" size="sm" />
                    <b>{captureCount}</b>장
                  </span>
                  <span className="metric">
                    <Icon name="i-camera" size="sm" />
                    {formatBytes(execution.evidenceBytes)}
                  </span>
                  <span className="end">
                    {representative ? (
                      <button
                        className={`btn sm${failure ? " pri" : ""}`}
                        type="button"
                        onClick={() => onOpenEvidence(representative)}
                      >
                        {failure ? "실패 증적" : "증적 보기"}
                        <Icon name="i-right" size="sm" />
                      </button>
                    ) : (
                      <span className="path">증적 생성 중</span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}
