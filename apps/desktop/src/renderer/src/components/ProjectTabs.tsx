import { Icon } from "./Icon";
import type { IconName } from "./IconSprite";

/* 프로젝트 상세의 최상위 탭. 목업 `.tabs` 를 그대로 쓴다.
 *
 * 네 탭은 프로젝트 범위다. 「테스트 실행」과 「증적」은 특정 run 이 아니라
 * 프로젝트가 지금까지 남긴 실행 전부를 센다. 탭을 비활성으로 잠그지 않고
 * 비어 있으면 빈 상태를 보여준다. 잠긴 탭은 왜 잠겼는지 말해주지 못한다. */

export type ProjectView = "overview" | "runs" | "executions" | "evidence";

type Props = {
  active: ProjectView;
  counts: { runs?: number; executions?: number; evidence?: number };
  executionRunning: boolean;
  onNavigate: (view: ProjectView) => void;
};

const items: readonly { id: ProjectView; label: string; icon: IconName }[] = [
  { id: "overview", label: "개요", icon: "i-board" },
  { id: "runs", label: "생성 이력", icon: "sf-scenario" },
  { id: "executions", label: "테스트 실행", icon: "sf-queue" },
  { id: "evidence", label: "증적", icon: "sf-evidence" },
];

export function ProjectTabs({ active, counts, executionRunning, onNavigate }: Props) {
  const countOf: Record<ProjectView, number | undefined> = {
    overview: undefined,
    runs: counts.runs,
    executions: counts.executions,
    evidence: counts.evidence,
  };

  return (
    <div className="tabs" role="tablist" aria-label="프로젝트 화면">
      {items.map(({ id, label, icon }) => {
        const count = countOf[id];
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={active === id}
            onClick={() => onNavigate(id)}
          >
            <Icon name={icon} size="sm" />
            {label}
            {count !== undefined && count > 0 && <span className="n">{count}</span>}
            {id === "executions" && executionRunning && (
              <span className="live" role="status" aria-label="실행 중" />
            )}
          </button>
        );
      })}
    </div>
  );
}
