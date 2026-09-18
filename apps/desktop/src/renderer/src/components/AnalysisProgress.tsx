import { Gauge } from "./Gauge";
import { Icon } from "./Icon";
import type { IconName } from "./IconSprite";
import { GENERATION_STEPS, type AnalysisStage, type GenerationStep } from "@scenarioforge/contracts";

/* 생성 공정 카드. 목업 S5 의 왼쪽 카드를 따른다.
 *
 * 진행률과 현재 작업은 backend 이벤트만 반영한다. renderer 가 추정해 채우지
 * 않는다. 단계는 검증·저장 후 멈추므로 「진행 중」과 「다음 단계 대기」가 다르다.
 */

export type AnalysisStatus = "idle" | "running" | "complete" | "error";

type Props = {
  progress: number;
  status: "running" | "complete";
  message?: string;
  /** 진행 중인 분석 run. 없으면 표시하지 않는다. */
  runId?: string;
  currentStep?: GenerationStep;
  stage?: AnalysisStage;
  stepStatus?: "started" | "completed";
  completedSteps?: number;
  totalSteps?: number;
};

export const STAGES: readonly { code: string; label: string; icon: IconName }[] = [
  { code: "SRC", label: "소스 구조 수집", icon: "sf-src" },
  { code: "FACT", label: "코드 사실 추출", icon: "sf-fact" },
  { code: "WIKI", label: "업무 분류·여정", icon: "sf-wiki" },
  { code: "SCENARIO", label: "시나리오 케이스", icon: "sf-scenario" },
];

const STEP_LABELS: Record<GenerationStep, string> = {
  "source-scan": "소스 스캔",
  "fact-catalog": "FACT 카탈로그",
  "edge-ledger": "전이·분기 원장",
  "assembled-fact": "FACT 결합",
  "reachable-workflow-skeleton": "도달 가능 워크플로",
  "common-wiki": "공통 WIKI",
  "business-catalog": "업무 분류",
  "scenario-skeleton": "시나리오 골격",
  "scenario-narration": "시나리오 서술",
  "coverage-manifest": "커버리지 검증",
};

/** 진행률에서 현재 단계를 고른다. 0-100 을 네 단계로 나눈 것 이상을 추정하지 않는다. */
export function stageIndexFor(progress: number) {
  return Math.min(STAGES.length - 1, Math.max(0, Math.floor(progress / 25)));
}

type PipelineState = "done" | "on" | "next" | "fail" | "idle";

export function Pipeline({
  states,
  labels,
}: {
  states: readonly PipelineState[];
  labels?: readonly string[];
}) {
  return (
    <ol className="pipe" aria-label="생성 공정">
      {STAGES.map((stage, index) => (
        <li key={stage.code} className={states[index] === "idle" ? undefined : states[index]}>
          <div className="nd">
            <b>
              <Icon name={stage.icon} size="sm" />
              {stage.code}
            </b>
            <span>{labels?.[index] ?? stage.label}</span>
          </div>
          <span className="cn" />
        </li>
      ))}
    </ol>
  );
}

export function AnalysisProgress({ progress, status, message, runId, currentStep, stage, completedSteps = 0, totalSteps = GENERATION_STEPS.length }: Props) {
  const stageIndex = stage ? ["src", "fact", "wiki", "scenario"].indexOf(stage) : stageIndexFor(progress);
  const currentIndex = status === "complete" ? STAGES.length - 1 : stageIndex;
  const currentStage = STAGES[currentIndex]!;
  const complete = status === "complete";
  const states = STAGES.map((_stage, index): PipelineState =>
    complete || index < currentIndex ? "done" : index === currentIndex ? "on" : "idle",
  );

  return (
    <>
      <div className="between">
        <div style={{ minWidth: 0 }}>
          <span className="eyebrow">FORGING PIPELINE</span>
          <h2 className="h1" style={{ fontSize: 22 }}>
            {complete ? "정보 셋 생성 완료" : `${currentStage.code} 단계 수행 중`}
          </h2>
          <p className="sub" style={{ marginTop: 6, fontSize: 12.5 }}>
            {complete
              ? "업무 분류와 사용자 시나리오까지 검증·저장했습니다. 생성 이력에서 결과를 엽니다."
              : `${currentStage.label} 작업을 하고 있습니다. 단계가 끝나면 검증·저장 후 멈춥니다.`}
          </p>
          {runId && (
            <span className="chip mono" style={{ marginTop: 10 }}>
              {runId}
            </span>
          )}
        </div>
        <Gauge
          value={progress}
          tone={complete ? "ok" : "prog"}
          label={complete ? "생성 완료율" : "생성 진행률"}
        />
      </div>

      <div style={{ margin: "20px 0 18px" }}>
        <Pipeline states={states} />
      </div>

      <ol aria-label="세부 생성 단계" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 6, margin: "0 0 18px", padding: 0, listStyle: "none" }}>
        {GENERATION_STEPS.map((step, index) => {
          const done = complete || index < completedSteps;
          const active = !done && step === currentStep;
          return (
            <li key={step} className={`chip ${done ? "ok" : active ? "run" : ""}`} aria-current={active ? "step" : undefined}>
              <Icon name={done ? "i-check" : active ? "i-loader" : "i-clock"} size="sm" />
              {index + 1}. {STEP_LABELS[step]}
            </li>
          );
        })}
      </ol>

      <span className="sr-only">세부 단계 {Math.min(completedSteps, totalSteps)} / {totalSteps} 완료</span>

      <div className="card flat actrow" role="status" aria-live="polite">
        <span className={`mark ${complete ? "ok" : "run"}`}>
          <Icon name={complete ? "i-check" : "i-loader"} size="sm" />
        </span>
        <div style={{ minWidth: 0 }}>
          <strong style={{ fontSize: 12.5 }}>
            {currentIndex + 1} / {STAGES.length} · {currentStage.code.toLowerCase()}
          </strong>
          {/* 문구는 backend event 가 준 것만 쓴다. 없으면 단계 이름까지만 말한다. */}
          <p className="path">{message ?? `${currentStage.label} 진행 중`}</p>
        </div>
        <span className={`chip ${complete ? "ok" : "run"}`} style={{ marginLeft: "auto" }}>
          <Icon name={complete ? "i-check" : "i-loader"} />
          {complete ? "완료" : "진행 중"}
        </span>
      </div>
    </>
  );
}
