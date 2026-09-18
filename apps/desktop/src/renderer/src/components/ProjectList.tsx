import { useEffect, useMemo, useRef, useState } from "react";
import type { AnalysisDataMeasure, ProjectSummary } from "../desktop";
import { formatBytes } from "../format";
import { Icon } from "./Icon";
import type { IconName } from "./IconSprite";

/* 프로젝트 목록 홈. 목업 S1·S1d 를 따른다.
 *
 * 카드의 숫자는 전부 main 이 디스크에서 읽어 준 값이다. renderer 가 기억한
 * 값을 보여주지 않는다.
 *
 * 연결 해제와 삭제를 분리한다. 해제는 되돌리기 토스트가 붙는 가역 동작이고,
 * 삭제는 확인 대화상자가 붙는 비가역 동작이다.
 */

type Props = {
  projects: ProjectSummary[];
  /** 지금 열려 있는 프로젝트 경로. 있으면 카드에 표시한다. */
  activePath?: string;
  onAddProject: () => void;
  onOpenProject: (project: ProjectSummary) => void;
  onRevealProject: (project: ProjectSummary) => void;
  onDisconnectProject: (project: ProjectSummary) => void;
  onUndoDisconnect: () => void;
  onRelinkProject: (project: ProjectSummary) => void;
  onMeasureAnalysisData: (project: ProjectSummary) => Promise<AnalysisDataMeasure | null>;
  onDeleteAnalysisData: (project: ProjectSummary) => Promise<void>;
  /** 마지막 해제 안내. 되돌리기를 누를 수 있는 동안만 있다. */
  disconnected?: string;
};

/* 합계는 단위를 값 크기에 맞춘다. 201 B 를 「0 KB」로 내리면 증적이 없다고
 * 읽힌다. */
function formatTotal(bytes: number) {
  if (bytes >= 1024 * 1024 * 1024) return { value: (bytes / 1024 / 1024 / 1024).toFixed(1), unit: "GB" };
  if (bytes >= 1024 * 1024) return { value: String(Math.round(bytes / 1024 / 1024)), unit: "MB" };
  if (bytes >= 1024) return { value: String(Math.round(bytes / 1024)), unit: "KB" };
  return { value: String(bytes), unit: "B" };
}

function formatWhen(value?: string) {
  if (!value) return "열람 기록 없음";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "열람 기록 없음";
  const minutes = Math.round((Date.now() - parsed.getTime()) / 60_000);
  if (minutes < 1) return "방금 열람";
  if (minutes < 60) return `${minutes}분 전 열람`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)}시간 전 열람`;
  return `${parsed.toLocaleDateString("ko-KR")} 열람`;
}

/* 카드의 상태. 디스크에서 읽은 것만으로 판단한다. 진행 중 여부는 이 목록이
 * 알 수 없으므로 말하지 않는다. */
function stateOf(project: ProjectSummary): { tone: string; icon: IconName; label: string } {
  if (!project.reachable) return { tone: "bad", icon: "i-alert", label: "경로 없음" };
  if (project.runs === 0) return { tone: "idle", icon: "i-folder", label: "분석 없음" };
  if (project.failedExecutions > 0) return { tone: "warn", icon: "i-help", label: "실패한 실행 있음" };
  return { tone: "ok", icon: "i-check", label: "분석 결과 있음" };
}

export function ProjectList({
  projects,
  activePath,
  onAddProject,
  onOpenProject,
  onRevealProject,
  onDisconnectProject,
  onUndoDisconnect,
  onRelinkProject,
  onMeasureAnalysisData,
  onDeleteAnalysisData,
  disconnected,
}: Props) {
  const [query, setQuery] = useState("");
  const [menuPath, setMenuPath] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ProjectSummary | null>(null);
  const [measure, setMeasure] = useState<AnalysisDataMeasure | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | undefined>(undefined);
  const keepButtonRef = useRef<HTMLButtonElement>(null);

  /* 메뉴는 바깥을 누르거나 Escape 로 닫힌다. 열어 둔 채 다른 카드를 조작하면
   * 어느 프로젝트에 대한 메뉴인지 알 수 없다. */
  useEffect(() => {
    if (menuPath === null) return;
    function close(event: Event) {
      if (event instanceof KeyboardEvent && event.key !== "Escape") return;
      setMenuPath(null);
    }
    document.addEventListener("keydown", close);
    document.addEventListener("pointerdown", close);
    return () => {
      document.removeEventListener("keydown", close);
      document.removeEventListener("pointerdown", close);
    };
  }, [menuPath]);

  useEffect(() => {
    if (!pendingDelete) return;
    keepButtonRef.current?.focus();
    setMeasure(null);
    setDeleteError(undefined);
    let alive = true;
    void onMeasureAnalysisData(pendingDelete).then((next) => {
      if (alive) setMeasure(next);
    });
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setPendingDelete(null);
    }
    document.addEventListener("keydown", handleEscape);
    return () => {
      alive = false;
      document.removeEventListener("keydown", handleEscape);
    };
  }, [pendingDelete, onMeasureAnalysisData]);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return projects;
    return projects.filter(
      (project) =>
        project.name.toLowerCase().includes(needle) || project.path.toLowerCase().includes(needle),
    );
  }, [projects, query]);

  const totals = projects.reduce(
    (carry, project) => ({
      runs: carry.runs + project.runs,
      bytes: carry.bytes + project.bytes,
    }),
    { runs: 0, bytes: 0 },
  );
  const total = formatTotal(totals.bytes);

  return (
    <>
      <div className="between hd">
        <div>
          <span className="eyebrow">PROJECTS</span>
          <h1 className="h1">프로젝트</h1>
          <p className="sub" style={{ marginTop: 6 }}>
            연결된 소스 디렉터리별로 생성 이력과 증적을 따로 보관합니다.
          </p>
        </div>
        <div className="stats">
          <div className="stat">
            <p className="num sm">{projects.length}</p>
            <span className="path">연결</span>
          </div>
          <div className="stat">
            <p className="num sm">{totals.runs}</p>
            <span className="path">생성 이력</span>
          </div>
          <div className="stat">
            <p className="num sm">
              {total.value}
              <u>{total.unit}</u>
            </p>
            <span className="path">증적</span>
          </div>
        </div>
      </div>

      <div className="project-tools">
        <span className="inp-wrap" style={{ width: 240 }}>
          <input
            className="inp"
            style={{ paddingLeft: 32 }}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="프로젝트 검색"
            aria-label="프로젝트 검색"
          />
          <Icon name="i-search" className="inp-lead" />
        </span>
        <span className="end">
          {/* LLM 설정은 셸 topbar 가 소유한다. 여기 한 번 더 두면 같은 동작이
            * 한 화면에 두 개가 된다. */}
          <button className="btn pri sm" type="button" onClick={onAddProject}>
            <Icon name="i-plus" size="sm" />
            프로젝트 추가
          </button>
        </span>
      </div>

      {rows.length === 0 ? (
        <div className="card flat">
          <div className="empty">
            <span className="ic">
              <Icon name="i-folder" />
            </span>
            <h3>{projects.length === 0 ? "연결된 프로젝트가 없습니다" : "검색 결과가 없습니다"}</h3>
            <p>
              {projects.length === 0
                ? "분석할 로컬 소스 디렉터리를 등록하면 프로젝트가 만들어집니다."
                : "이름이나 경로의 일부로 다시 찾아보세요."}
            </p>
            {projects.length === 0 && (
              <button className="btn pri" type="button" onClick={onAddProject}>
                <Icon name="i-folder" size="sm" />
                소스 디렉터리 선택
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="g2">
          {rows.map((project) => {
            const state = stateOf(project);
            return (
              <article
                className="card pcard"
                key={project.path}
                style={project.reachable ? undefined : { borderColor: "var(--bad-line)" }}
              >
                <div className="pchd">
                  <span className={`mark ${state.tone}`}>
                    <Icon name={state.icon} size="sm" />
                  </span>
                  <div className="pctitle">
                    <h2 className="h3">{project.name}</h2>
                    <p
                      className="path"
                      title={project.path}
                      style={project.reachable ? undefined : { textDecoration: "line-through" }}
                    >
                      {project.path}
                    </p>
                  </div>
                  <button
                    className="btn icon sm"
                    type="button"
                    aria-label={`${project.name} 관리`}
                    aria-expanded={menuPath === project.path}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={() => setMenuPath(menuPath === project.path ? null : project.path)}
                  >
                    <Icon name="i-more" size="sm" />
                  </button>
                </div>

                <div className="pcst">
                  <span className={`chip ${state.tone}`}>
                    <Icon name={state.icon} />
                    {state.label}
                  </span>
                  {project.latestRunId && (
                    <span className="chip mono" title={project.latestRunId}>
                      {project.latestRunId}
                    </span>
                  )}
                  {project.path === activePath && <span className="chip run">열려 있음</span>}
                </div>

                <hr />

                {project.reachable ? (
                  <div className="pcmt">
                    <span className="metric">
                      <Icon name="i-route" size="sm" />
                      <b>{project.runs}</b> run
                    </span>
                    <span className="metric">
                      <Icon name="i-flask" size="sm" />
                      <b>{project.executions}</b> 실행
                    </span>
                    {project.frames > 0 ? (
                      <span className="metric">
                        <Icon name="i-images" size="sm" />
                        <b>{project.frames}</b>장 · {formatBytes(project.bytes)}
                      </span>
                    ) : (
                      <span className="metric mut">
                        <Icon name="sf-evidence" size="sm" />
                        증적 없음
                      </span>
                    )}
                  </div>
                ) : (
                  <p className="pcnote">
                    디렉터리를 찾을 수 없습니다. 이동했거나 외부 볼륨이 연결되지 않았습니다.
                  </p>
                )}

                {project.reachable && project.runs === 0 && (
                  <p className="pcnote">
                    아직 분석을 실행하지 않았습니다. 열어서 SRC 단계부터 시작할 수 있습니다.
                  </p>
                )}

                <div className="cta-row foot">
                  {project.reachable ? (
                    <>
                      <button className="btn sm" type="button" onClick={() => onOpenProject(project)}>
                        열기
                        <Icon name="i-right" size="sm" />
                      </button>
                      <span className="path">{formatWhen(project.lastOpenedAt)}</span>
                    </>
                  ) : (
                    <>
                      <button className="btn sm" type="button" onClick={() => onRelinkProject(project)}>
                        <Icon name="i-folder" size="sm" />
                        경로 다시 지정
                      </button>
                      <button
                        className="btn ghost sm"
                        type="button"
                        onClick={() => onDisconnectProject(project)}
                      >
                        목록에서 제거
                      </button>
                    </>
                  )}
                </div>

                {menuPath === project.path && (
                  <div
                    className="menu"
                    style={{ right: 20, top: 56 }}
                    onPointerDown={(event) => event.stopPropagation()}
                  >
                    <button
                      type="button"
                      disabled={!project.reachable}
                      onClick={() => {
                        setMenuPath(null);
                        onRevealProject(project);
                      }}
                    >
                      <Icon name="i-ext" size="sm" />
                      경로 열기
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setMenuPath(null);
                        onDisconnectProject(project);
                      }}
                    >
                      <Icon name="i-unlink" size="sm" />
                      연결 해제
                      <span className="r">디스크 유지</span>
                    </button>
                    <hr />
                    <button
                      className="dan"
                      type="button"
                      disabled={!project.reachable || project.runs === 0}
                      onClick={() => {
                        setMenuPath(null);
                        setPendingDelete(project);
                      }}
                    >
                      <Icon name="i-trash" size="sm" />
                      분석 결과 전체 삭제
                    </button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      {disconnected && (
        <div className="toast" role="status">
          <Icon name="i-check" size="sm" />
          {disconnected} 연결을 해제했습니다. 디스크의 분석 결과는 그대로 있습니다.
          <button type="button" onClick={onUndoDisconnect}>
            실행 취소
          </button>
        </div>
      )}

      {pendingDelete && (
        <div className="scrim">
          <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="delete-analysis-title">
            <span className="dic" style={{ background: "var(--bad-soft)" }}>
              <Icon name="i-trash" size="lg" className="dic-bad" />
            </span>
            <span className="eyebrow">DELETE ANALYSIS DATA</span>
            <h2 id="delete-analysis-title">{pendingDelete.name}의 분석 결과를 삭제할까요?</h2>
            <p>
              <code>.scenarioforge</code> 아래의 생성 이력과 증적을 디스크에서 지웁니다. 되돌릴 수
              없습니다. 원본 소스코드는 건드리지 않습니다.
            </p>
            <dl>
              <div>
                <dt>생성 이력</dt>
                <dd>{measure ? `${measure.runs} run` : "확인 중"}</dd>
              </div>
              <div>
                <dt>테스트 실행</dt>
                <dd>{measure ? `${measure.executions}건` : "확인 중"}</dd>
              </div>
              <div>
                <dt>증적</dt>
                <dd>{measure ? `${measure.frames}장` : "확인 중"}</dd>
              </div>
              <div>
                <dt>회수 용량</dt>
                <dd>{measure ? formatBytes(measure.bytes) : "확인 중"}</dd>
              </div>
            </dl>
            {deleteError && (
              <p className="cta-why" style={{ marginBottom: 12 }} role="alert">
                <Icon name="i-alert" size="sm" />
                {deleteError}
              </p>
            )}
            <div className="acts">
              <button ref={keepButtonRef} className="btn" type="button" onClick={() => setPendingDelete(null)}>
                그대로 두기
              </button>
              {/* 확인 버튼이 결과를 이름으로 말한다. 「확인」만 있으면 무엇이 지워지는지 모른다. */}
              <button
                className="btn dan"
                type="button"
                disabled={measure === null || deleting}
                onClick={() => {
                  setDeleting(true);
                  setDeleteError(undefined);
                  void onDeleteAnalysisData(pendingDelete)
                    .then(() => setPendingDelete(null))
                    .catch((error: unknown) =>
                      setDeleteError(
                        error instanceof Error && error.message.includes("ANALYSIS_ALREADY_RUNNING")
                          ? "이 프로젝트에서 분석이 진행 중입니다. 끝난 뒤에 삭제하세요."
                          : "분석 결과를 삭제하지 못했습니다.",
                      ),
                    )
                    .finally(() => setDeleting(false));
                }}
              >
                <Icon name="i-trash" />
                {measure
                  ? `run ${measure.runs}건과 증적 ${measure.frames}장 삭제`
                  : "삭제량 확인 중"}
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
