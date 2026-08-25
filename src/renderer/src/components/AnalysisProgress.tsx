import {
  BookOpenText,
  Check,
  Code2,
  DatabaseZap,
  Workflow,
} from "lucide-react";

export type AnalysisStatus = "idle" | "running" | "complete";

type Props = {
  progress: number;
  status: Exclude<AnalysisStatus, "idle">;
};

const stages = [
  { code: "SRC", label: "소스 구조 수집", icon: Code2 },
  { code: "FACT", label: "코드 사실 추출", icon: DatabaseZap },
  { code: "WIKI", label: "코드 위키 작성", icon: BookOpenText },
  { code: "SCENARIO", label: "사용자 시나리오 생성", icon: Workflow },
];

export function AnalysisProgress({ progress, status }: Props) {
  const currentIndex = status === "complete" ? 3 : Math.min(3, Math.floor(progress / 25));
  const currentStage = stages[currentIndex];

  return (
    <section className="analysis-progress" aria-labelledby="analysis-progress-title">
      <header className="analysis-progress-header">
        <div>
          <span className="eyebrow">FORGING PIPELINE</span>
          <h2 id="analysis-progress-title">
            {status === "complete" ? "정보 셋 생성 완료" : "프로젝트 분석 중"}
          </h2>
        </div>
        <strong className="progress-percent">{Math.round(progress)}%</strong>
      </header>

      <div
        className="overall-progress"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress)}
        aria-label="전체 분석 진행률"
      >
        <span style={{ width: `${progress}%` }} />
      </div>

      <ol className="pipeline" aria-label="분석 공정">
        {stages.map((stage, index) => {
          const isComplete = status === "complete" || index < currentIndex;
          const isCurrent = status !== "complete" && index === currentIndex;
          const Icon = stage.icon;
          return (
            <li
              key={stage.code}
              className={
                isComplete ? "is-complete" : isCurrent ? "is-current" : undefined
              }
            >
              <div className="pipeline-node">
                <span className="pipeline-index">
                  {isComplete ? <Check size={15} aria-hidden="true" /> : `0${index + 1}`}
                </span>
                <Icon size={21} strokeWidth={1.7} aria-hidden="true" />
                <strong>{stage.code}</strong>
                <span>{stage.label}</span>
              </div>
              {index < stages.length - 1 && <span className="pipeline-connector" />}
            </li>
          );
        })}
      </ol>

      <div className="current-operation" aria-live="polite">
        <span>{status === "complete" ? "4 / 4" : `${currentIndex + 1} / 4`}</span>
        <p>
          {status === "complete"
            ? "Wiki와 사용자 시나리오 정보 셋을 생성했습니다."
            : `${currentStage.label} 공정을 수행하고 있습니다.`}
        </p>
      </div>
    </section>
  );
}
