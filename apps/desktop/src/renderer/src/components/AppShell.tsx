import type { ReactNode } from "react";
import { Icon } from "./Icon";
import { ProjectTabs, type ProjectView } from "./ProjectTabs";
import type { SelectedDirectory } from "../desktop";

/* 앱 셸: titlebar -> topbar -> tabs -> body.
 *
 * 목업 `docs/mockups/redesign-v2.html` 의 셸이 정본이다. 프로젝트가 없으면
 * 탭도 브레드크럼도 없다. 갈 곳이 하나뿐인 상태에서 탭을 보여주면 아직
 * 아무것도 못 한다는 사실을 숨기게 된다. */

type Props = {
  project: SelectedDirectory | null;
  activeView?: ProjectView;
  counts?: { runs?: number; executions?: number; evidence?: number };
  executionRunning?: boolean;
  onNavigate?: (view: ProjectView) => void;
  onOpenSettings: () => void;
  /* 프로젝트 목록으로 돌아간다. 목록 화면 자체에서는 주지 않는다. */
  onGoToProjects?: () => void;
  /* `page` 는 본문이 스크롤하는 목록 화면, `split` 은 패널이 각자 스크롤하는
   * 상세 화면이다. 상세 화면에서 본문 전체가 스크롤하면 3분할 패널의 높이가
   * 정해지지 않아 내부 스크롤이 죽는다. */
  layout?: "page" | "split";
  /* 셸 전체에 걸리는 알림 한 줄. tabs 와 body 사이에 놓는다. body 안에 넣으면
   * `split` 레이아웃의 패널 그리드에 항목으로 끼어 컬럼이 깨진다. */
  banner?: ReactNode;
  children: ReactNode;
};

export function AppShell({
  project,
  activeView,
  counts,
  executionRunning = false,
  onNavigate,
  onOpenSettings,
  onGoToProjects,
  layout = "page",
  banner,
  children,
}: Props) {
  return (
    <>
      <div className="titlebar">
        <i />
        <i />
        <i />
        <span>ScenarioForge</span>
      </div>

      <header className="topbar">
        <span className="brand">
          <Icon name="i-forge" />
          ScenarioForge
        </span>
        {project && (
          <nav className="crumb" aria-label="위치">
            {onGoToProjects ? (
              <button className="btn link" type="button" onClick={onGoToProjects}>
                프로젝트
              </button>
            ) : (
              <span>프로젝트</span>
            )}
            <Icon name="i-right" size="sm" />
            <b title={project.path ?? project.name}>{project.name}</b>
          </nav>
        )}
        <div className="topbar-end">
          {project && onGoToProjects && (
            <button
              className="switcher"
              type="button"
              title={project.path ?? project.name}
              onClick={onGoToProjects}
              aria-label="다른 프로젝트 선택"
            >
              <Icon name="i-folder" size="sm" />
              <b>{project.name}</b>
              <Icon name="i-down" size="sm" />
            </button>
          )}
          <button className="btn sm" type="button" onClick={onOpenSettings}>
            <Icon name="i-sliders" size="sm" />
            LLM 설정
          </button>
        </div>
      </header>

      {project && activeView && onNavigate && (
        <ProjectTabs
          active={activeView}
          counts={counts ?? {}}
          executionRunning={executionRunning}
          onNavigate={onNavigate}
        />
      )}

      {banner}

      <main className={layout === "split" ? "body body-split" : "body pad-lg"} id="main-content">
        {children}
      </main>
    </>
  );
}
