import { FlaskConical, FolderKanban, Images, Route } from "lucide-react";

export type ProjectView = "workspace" | "scenario" | "test" | "evidence";

type Props = {
  active: ProjectView;
  scenarioReady: boolean;
  executionReady: boolean;
  evidenceReady: boolean;
  executionRunning: boolean;
  onNavigate: (view: ProjectView) => void;
};

const items = [
  { id: "workspace", label: "작업대", icon: FolderKanban },
  { id: "scenario", label: "시나리오", icon: Route },
  { id: "test", label: "테스트 수행", icon: FlaskConical },
  { id: "evidence", label: "증적", icon: Images },
] as const;

export function ProjectNavigation({
  active,
  scenarioReady,
  executionReady,
  evidenceReady,
  executionRunning,
  onNavigate,
}: Props) {
  const availability: Record<ProjectView, boolean> = {
    workspace: true,
    scenario: scenarioReady,
    test: executionReady,
    evidence: evidenceReady,
  };

  return (
    <nav className="project-navigation" aria-label="프로젝트 화면">
      {items.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          className={active === id ? "is-active" : undefined}
          type="button"
          disabled={!availability[id]}
          onClick={() => onNavigate(id)}
          aria-current={active === id ? "page" : undefined}
          aria-label={label}
        >
          <Icon size={15} aria-hidden="true" />
          <span>{label}</span>
          {id === "test" && executionRunning && (
            <i className="navigation-live-dot" aria-label="실행 중" />
          )}
        </button>
      ))}
    </nav>
  );
}
