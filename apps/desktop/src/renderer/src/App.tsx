import { useEffect, useMemo, useRef, useState } from "react";
import { GENERATION_STEPS, type AnalysisStage, type GenerationStep } from "@scenarioforge/contracts";
import {
  AnalysisProgress,
  Pipeline,
  STAGES,
  stageIndexFor,
  type AnalysisStatus,
} from "./components/AnalysisProgress";
import { Gauge } from "./components/Gauge";
import { Icon } from "./components/Icon";
import { GenerationHistory } from "./components/GenerationHistory";
import type { HumanReviewView, ReviewCauseTag, ReviewDecision, StepEvidenceView } from "../../shared/evidence";
import type { EvidenceLibraryView } from "../../shared/evidence-library";
import { ModelSettingsModal } from "./components/ModelSettingsModal";
import { EvidenceDetail } from "./components/EvidenceDetail";
import { EvidenceLibrary } from "./components/EvidenceLibrary";
import { AppShell } from "./components/AppShell";
import { IconSprite } from "./components/IconSprite";
import { ExecutionList } from "./components/ExecutionList";
import { ProjectList } from "./components/ProjectList";
import type { ProjectView } from "./components/ProjectTabs";
import { ScenarioResults } from "./components/ScenarioResults";
import { TestCenter } from "./components/TestCenter";
import {
  clearModelCredentials,
  getProjectAnalysisState,
  getModelCredentialStatus,
  loadScenarioResult,
  onProjectAnalysisProgress,
  restoreProjectDirectory,
  saveModelSettings,
  selectProjectDirectory,
  startProjectAnalysis,
  type ModelSettings,
  type AnalysisRunSummary,
  type SelectedDirectory,
  listTestExecutions,
  runQueuedExecution,
  cancelScenarioTests,
  onTestExecutionProgress,
  readStepEvidence,
  readEvidenceFrame,
  listStepReviews,
  addStepReview,
  listEvidenceLibrary,
  retryScenarioTests,
  listProjects,
  listRuns,
  openProject,
  revealProject,
  disconnectProject,
  undoDisconnectProject,
  relinkProject,
  measureAnalysisData,
  deleteAnalysisData,
  type ProjectSummary,
  type RunSummary,
} from "./desktop";
import {
  createDemoScenarioResult,
  type ScenarioResult,
} from "./scenario-result";
import { classifyAnalysisError } from "./analysis-error";
import { formatDateTime } from "./format";
import {
  appRouteHash,
  parseAppRoute,
  type AppRoute,
} from "./navigation-state";
import {
  createDemoEvidenceLibrary,
  createDemoExecutionHistory,
  createDemoProjectSummary,
  createDemoTestExecution,
  findFirstFailure,
} from "./test-execution-fixture";
import type {
  StepEvidence,
  TestExecution,
} from "../../shared/test-execution";

type SelectionStatus = "idle" | "selecting" | "error";
/* `code` 는 main 이 분류해 던진 오류 코드다. 원문 메시지는 담지 않는다. */
type AnalysisState = {
  status: AnalysisStatus;
  progress: number;
  message?: string;
  startMode?: "new" | "continue";
  code?: string;
  currentStep?: GenerationStep;
  stage?: AnalysisStage;
  stepStatus?: "started" | "completed";
  completedSteps?: number;
  totalSteps?: number;
};
type PreviewMode =
  | "modal"
  | "workspace"
  | "progress"
  | "result"
  | "result-selected"
  | "test-running"
  | "test-failed"
  | "evidence-library"
  | "evidence-failure"
  /* 시연용. 생성 이력에서 시작해 시나리오 케이스와 수행 증적까지 한 흐름으로
   * 넘긴다. 표본 데이터이며 정본 실행 결과가 아니다. */
  | "demo"
  | null;
type ViewMode =
  | "projects"
  | "workspace"
  | "runs"
  | "executions"
  | "result"
  | "loading"
  | "error"
  | "test-center"
  | "evidence-library"
  | "evidence-detail";

const STORAGE = {
  // 검토자 이름은 비밀값이 아니므로 renderer 저장소에 남긴다.
  reviewAuthor: "scenarioforge.reviewAuthor",
  project: "scenarioforge.project.v1",
  model: "scenarioforge.model.v1",
  executionPrefix: "scenarioforge.execution.v1",
};

type StoredExecutionState = {
  current: TestExecution | null;
  history: TestExecution[];
};

const previewMode = new URLSearchParams(window.location.search).get(
  "preview",
) as PreviewMode;
const initialAppRoute = parseAppRoute(window.location.hash);

const previewProject: SelectedDirectory = {
  name: "RA-DAR",
  path: "/Users/a11769/Desktop/RA-DAR",
};

const previewSettings: ModelSettings = {
  provider: "openai-compatible",
  endpoint: "https://api.openai.com/v1",
  model: "gpt-5",
  dataPolicyAccepted: true,
};

const previewHistory: RunSummary[] = [
  {
    runId: "RUN-preview-02",
    createdAt: "2026-09-08T17:24:00.000Z",
    complete: true,
    facts: 214,
    wikiPages: 12,
    scenarios: 9,
  },
  {
    runId: "RUN-preview-01",
    createdAt: "2026-09-05T11:38:00.000Z",
    complete: true,
    facts: 198,
    wikiPages: 11,
    scenarios: 7,
  },
];

const executionPreviewModes: PreviewMode[] = [
  "test-running",
  "test-failed",
  "evidence-library",
  "evidence-failure",
  "demo",
];
const hasExecutionPreview = executionPreviewModes.includes(previewMode);
const previewScenarioResult = createDemoScenarioResult(previewHistory[0].runId);
const previewExecution = hasExecutionPreview
  ? createDemoTestExecution(
      previewHistory[0].runId,
      previewMode === "test-running" ? "running" : "failed",
      undefined,
      previewMode === "test-running"
        ? "EXE-20260908-0051"
        : "EXE-20260908-0042",
    )
  : null;
const previewExecutionHistory = hasExecutionPreview
  ? createDemoExecutionHistory(previewHistory[0].runId).filter(
      (execution) => execution.executionId !== previewExecution?.executionId,
    )
  : [];

/* 시연 모드에서만 런처에 프로젝트 카드를 세운다. 다른 preview 모드는 지금까지
 * 그랬듯 목록 없이 해당 화면만 보여준다. */
const previewProjects: ProjectSummary[] =
  previewMode === "demo"
    ? [
        createDemoProjectSummary(
          previewProject,
          previewHistory[0].runId,
          previewHistory.length,
        ),
      ]
    : [];
const previewEvidenceLibrary =
  previewMode === "demo"
    ? createDemoEvidenceLibrary(previewHistory[0].runId)
    : undefined;

function createRendererExecutionId() {
  const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return `EXE-${date}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

function readStored<T>(key: string): T | null {
  try {
    const value = window.localStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : null;
  } catch {
    return null;
  }
}

function writeStored(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Electron에서는 main process의 영속 저장소로 대체한다.
  }
}

function executionStorageKey(project: SelectedDirectory) {
  return `${STORAGE.executionPrefix}:${encodeURIComponent(project.path ?? project.name)}`;
}

function findEvidenceById(
  executions: TestExecution[],
  evidenceId: string,
): StepEvidence | null {
  for (const execution of executions) {
    for (const testCase of execution.cases) {
      for (const step of testCase.steps) {
        if (step.evidence?.evidenceId === evidenceId) return step.evidence;
      }
    }
  }
  return null;
}

function viewModeForRoute(route: AppRoute | null): ViewMode | null {
  if (!route) return null;
  if (route.view === "projects") return "projects";
  if (route.view === "workspace") return "workspace";
  if (route.view === "runs") return "runs";
  if (route.view === "executions") return "executions";
  if (route.view === "scenario") return "result";
  if (route.view === "test") return "test-center";
  if (route.view === "evidence-library") return "evidence-library";
  return "evidence-detail";
}

function viewModeForPreview(mode: PreviewMode): ViewMode {
  if (mode === "result" || mode === "result-selected") return "result";
  if (mode === "test-running" || mode === "test-failed") return "test-center";
  if (mode === "evidence-library") return "evidence-library";
  if (mode === "evidence-failure") return "evidence-detail";
  /* 시연은 런처에서 시작한다. 분석이 끝난 프로젝트를 눌러 업무 분류별
   * 시나리오 케이스로 들어가고, 거기서 실행·증적 탭으로 이어진다. */
  if (mode === "demo") return "projects";
  return "workspace";
}

function updateAppRoute(route: AppRoute, replace = false) {
  const nextHash = appRouteHash(route);
  if (window.location.hash === nextHash) return;
  window.history[replace ? "replaceState" : "pushState"](null, "", nextHash);
}

/* 프로젝트가 없는 상태. 목업 S0 를 따른다. 주 동작은 하나뿐이다. */
function Onboarding({
  status,
  onSelectProject,
}: {
  status: SelectionStatus;
  onSelectProject: () => void;
}) {
  return (
    <div className="hero">
      <div className="hero-box">
        <span className="orb" />
        <div className="hero-copy">
        <span className="eyebrow" style={{ textAlign: "center" }}>
          TEST DESIGN · SI 통합 테스트 설계
        </span>
        <h1 className="h1" style={{ fontSize: 32, marginBottom: 12 }}>
          소스코드에서
          <br />
          사용자가 걷는 길을 단조합니다.
        </h1>
        <p className="sub" style={{ margin: "0 auto 22px" }}>
          분석할 로컬 소스 디렉터리를 등록하면 프로젝트가 만들어집니다. 생성 이력과 증적은
          프로젝트별로 따로 보관됩니다.
        </p>
        <button
          className="btn pri lg"
          type="button"
          onClick={onSelectProject}
          disabled={status === "selecting"}
        >
          <Icon name="i-folder" size="lg" />
          {status === "selecting" ? "디렉터리 여는 중" : "소스 디렉터리 선택"}
          <Icon name="i-arrow-r" />
        </button>
        {status === "error" && (
          <p className="cta-why" style={{ justifyContent: "center", marginTop: 14 }} role="alert">
            <Icon name="i-alert" size="sm" />
            디렉터리를 열 수 없습니다. 접근 권한을 확인한 뒤 다시 선택하세요.
          </p>
        )}
          <p className="pill" style={{ margin: "20px auto 0" }}>
            <Icon name="i-shield" size="sm" />
            선택한 디렉터리만 분석 작업 범위로 사용합니다.
          </p>
        </div>
      </div>
    </div>
  );
}

function providerName(provider: ModelSettings["provider"]) {
  if (provider === "azure-openai") return "Azure OpenAI";
  if (provider === "anthropic") return "Anthropic";
  if (provider === "custom") return "사용자 지정";
  return "OpenAI 호환";
}

/* 개요 탭. 목업 S5(진행 중) / S5e(실패) 를 따른다.
 *
 * 오류는 stage 와 분류된 코드까지만 노출한다. 불완전한 결과를 예시 데이터로
 * 대체하지 않는다. provider 응답 본문과 stack trace 는 표시하지 않는다. */
function ProjectWorkspace({
  project,
  settings,
  analysis,
  records,
  runId,
  summary,
  onStartAnalysis,
  onStartNewAnalysis,
  onOpenSettings,
  onRevealPath,
  onNavigate,
}: {
  project: SelectedDirectory;
  settings: ModelSettings | null;
  analysis: AnalysisState;
  records: RunSummary[];
  runId?: string;
  summary: { executions: number; failedExecutions: number; frames?: number; bytes?: number };
  onStartAnalysis: () => void;
  onStartNewAnalysis: () => void;
  onOpenSettings: () => void;
  onRevealPath: () => void;
  onNavigate: (view: ProjectView) => void;
}) {
  const stageIndex = stageIndexFor(analysis.progress);
  const running = analysis.status === "running" || analysis.status === "complete";

  const side = (
    <div className="stack">
      <div className="card p-20">
        <span className="eyebrow">PROJECT</span>
        <dl className="kv plain">
          <div>
            <dt>작업 범위</dt>
            <dd className="path" style={{ fontSize: 11.5 }} title={project.path ?? project.name}>
              {project.path ?? project.name}
            </dd>
          </div>
          <div>
            <dt>연결 모델</dt>
            <dd>{settings ? settings.model : "설정 필요"}</dd>
          </div>
          <div>
            <dt>reviewer</dt>
            <dd className={settings?.reviewer ? undefined : "mut"}>
              {settings?.reviewer ? settings.reviewer.model : "사용하지 않음"}
            </dd>
          </div>
        </dl>
        <div className="cta-row" style={{ marginTop: 6 }}>
          {/* 목업 S5 와 같다. LLM 설정은 셸 topbar 가 소유한다. */}
          <button className="btn sm" type="button" onClick={onRevealPath}>
            <Icon name="i-ext" size="sm" />
            경로 열기
          </button>
        </div>
      </div>

      <div className="card p-20">
        <span className="eyebrow">SUMMARY</span>
        <div className="stack" style={{ gap: 14, marginTop: 4 }}>
          <button className="stat-row" type="button" onClick={() => onNavigate("runs")}>
            <p className="num sm">{records.length}</p>
            <span className="connect">
              <span className="ln" />
              <span className="dt" />
            </span>
            <span className="lb">
              생성 이력
              {records[0]?.createdAt && (
                <span className="path"> · 최근 {formatDateTime(records[0].createdAt)}</span>
              )}
            </span>
          </button>
          <button className="stat-row" type="button" onClick={() => onNavigate("executions")}>
            <p className="num sm">{summary.executions}</p>
            <span className="connect">
              <span className="ln" />
              <span className="dt" />
            </span>
            <span className="lb">
              테스트 실행
              {summary.failedExecutions > 0 && (
                <span className="path"> · 실패 {summary.failedExecutions}건</span>
              )}
            </span>
          </button>
          <button className="stat-row" type="button" onClick={() => onNavigate("evidence")}>
            <p className="num sm">{summary.frames ?? 0}</p>
            <span className="connect">
              <span className="ln" />
              <span className="dt" />
            </span>
            <span className="lb">
              증적 화면
              {summary.bytes !== undefined && (
                <span className="path"> · {Math.max(1, Math.round(summary.bytes / 1024 / 1024))} MB</span>
              )}
            </span>
          </button>
        </div>
      </div>
    </div>
  );

  if (analysis.status === "error") {
    const states = STAGES.map((_stage, index) =>
      index < stageIndex ? "done" : index === stageIndex ? "fail" : "idle",
    ) as ("done" | "fail" | "idle")[];
    const failedStage = STAGES[stageIndex]!;
    return (
      <div className="overview">
        <div className="card p-24" style={{ borderColor: "var(--bad-line)" }}>
          <div className="between">
            <div style={{ display: "flex", gap: 14 }}>
              <span className="mark bad" style={{ width: 38, height: 38 }}>
                <Icon name="i-alert" size="lg" />
              </span>
              <div>
                <span className="eyebrow" style={{ color: "var(--bad)" }}>
                  ANALYSIS FAILED · {failedStage.code}
                </span>
                <h2 className="h1" style={{ fontSize: 21 }}>
                  {failedStage.code} 단계를 완료하지 못했습니다
                </h2>
                <p className="sub" style={{ marginTop: 6, fontSize: 12.5 }}>
                  직전까지 검증·저장한 산출물은 그대로 있습니다. 이 단계만 다시 실행할 수 있습니다.
                </p>
              </div>
            </div>
          </div>
          <dl className="kv" style={{ margin: "18px 0" }}>
            <div>
              <dt>단계</dt>
              <dd>
                {failedStage.code} · {failedStage.label}
              </dd>
            </div>
            {runId && (
              <div>
                <dt>생성 이력</dt>
                <dd className="path">{runId}</dd>
              </div>
            )}
            <div>
              <dt>오류 코드</dt>
              {/* main 이 분류해 던진 코드만 표시한다. 원문 메시지는 노출하지 않는다. */}
              <dd className={analysis.code ? "path" : "mut"}>{analysis.code ?? "분류되지 않음"}</dd>
            </div>
          </dl>
          <div style={{ marginBottom: 18 }}>
            <Pipeline
              states={states}
              labels={STAGES.map((_stage, index) =>
                index < stageIndex ? "완료" : index === stageIndex ? "실패" : "대기",
              )}
            />
          </div>
          <div className="cta-row">
            <button className="btn pri" type="button" onClick={onStartAnalysis}>
              <Icon name="i-retry" />
              {failedStage.code} 단계 다시 실행
            </button>
            <button className="btn" type="button" onClick={onStartNewAnalysis}>
              처음부터 새 분석
            </button>
          </div>
        </div>
        {side}
      </div>
    );
  }

  return (
    <div className="overview">
      <div className="card p-24">
        {running ? (
          <AnalysisProgress
            status={analysis.status === "complete" ? "complete" : "running"}
            progress={analysis.progress}
            {...(analysis.message ? { message: analysis.message } : {})}
            {...(runId ? { runId } : {})}
            {...(analysis.currentStep ? { currentStep: analysis.currentStep } : {})}
            {...(analysis.stage ? { stage: analysis.stage } : {})}
            {...(analysis.stepStatus ? { stepStatus: analysis.stepStatus } : {})}
            {...(analysis.completedSteps !== undefined ? { completedSteps: analysis.completedSteps } : {})}
            {...(analysis.totalSteps !== undefined ? { totalSteps: analysis.totalSteps } : {})}
          />
        ) : (
          <>
            <div className="between">
              <div style={{ minWidth: 0 }}>
                <span className="eyebrow">
                  {analysis.progress > 0 ? "STAGE VERIFIED" : "READY TO FORGE"}
                </span>
                <h2 className="h1" style={{ fontSize: 22 }}>
                  {analysis.progress > 0
                    ? "다음 단계를 실행합니다"
                    : "이 설정으로 첫 단계를 실행합니다"}
                </h2>
                <p className="sub" style={{ marginTop: 6, fontSize: 12.5 }}>
                  {analysis.message ??
                    "SRC 단계가 소스 인벤토리와 근거 스냅샷을 만듭니다. 단계마다 검증·저장한 뒤 멈추므로 중간에 확인할 수 있습니다."}
                </p>
                {runId && (
                  <span className="chip mono" style={{ marginTop: 10 }}>
                    {runId}
                  </span>
                )}
              </div>
              {analysis.progress > 0 && (
                <Gauge value={analysis.progress} label="생성 진행률" />
              )}
            </div>
            <div style={{ margin: "20px 0 18px" }}>
              <Pipeline
                states={STAGES.map((_stage, index) =>
                  analysis.progress > 0 && index < stageIndex
                    ? "done"
                    : index === (analysis.progress > 0 ? stageIndex : 0)
                      ? "next"
                      : "idle",
                )}
              />
            </div>
            <div className="cta-row">
              <button className="btn pri lg" type="button" onClick={onStartAnalysis}>
                <Icon name="i-spark" size="lg" />
                {analysis.progress > 0 ? "다음 단계 실행" : "SRC 단계 실행"}
                <Icon name="i-arrow-r" />
              </button>
              {analysis.progress > 0 && (
                <button className="btn ghost" type="button" onClick={onStartNewAnalysis}>
                  처음부터 새 분석
                </button>
              )}
              {!settings && (
                <span className="cta-why">
                  <Icon name="i-alert" size="sm" />
                  모델 연결 설정이 필요합니다.
                </span>
              )}
            </div>
          </>
        )}
        {analysis.status === "complete" && (
          <div className="cta-row" style={{ marginTop: 18 }}>
            <button className="btn pri" type="button" onClick={() => onNavigate("runs")}>
              <Icon name="sf-scenario" size="sm" />
              생성 이력에서 결과 열기
              <Icon name="i-arrow-r" size="sm" />
            </button>
            <button className="btn ghost" type="button" onClick={onStartNewAnalysis}>
              새 분석 시작
            </button>
          </div>
        )}
      </div>
      {side}
    </div>
  );
}

export default function App() {
  const usesPreviewProject = previewMode !== null;
  const [project, setProject] = useState<SelectedDirectory | null>(() =>
    usesPreviewProject ? previewProject : window.scenarioForge ? null : readStored<SelectedDirectory>(STORAGE.project),
  );
  const [settings, setSettings] = useState<ModelSettings | null>(() =>
    usesPreviewProject ? previewSettings : readStored<ModelSettings>(STORAGE.model),
  );
  const [hasSessionApiKey, setHasSessionApiKey] = useState(usesPreviewProject);
  const [hasSessionReviewerApiKey, setHasSessionReviewerApiKey] = useState(false);
  const [secureStorageAvailable, setSecureStorageAvailable] = useState(usesPreviewProject);
  /* 생성 이력은 디스크가 원천이다. renderer 는 투영을 읽어 표시만 한다. */
  const [records, setRecords] = useState<RunSummary[]>(() =>
    usesPreviewProject ? previewHistory : [],
  );
  const [selectionStatus, setSelectionStatus] = useState<SelectionStatus>(() =>
    !usesPreviewProject && window.scenarioForge ? "selecting" : "idle",
  );
  const [settingsOpen, setSettingsOpen] = useState(previewMode === "modal");
  const [analysis, setAnalysis] = useState<AnalysisState>(() =>
    previewMode === "progress"
      ? { status: "running", progress: 62 }
      : { status: "idle", progress: 0 },
  );
  const [lastAnalysisSummary, setLastAnalysisSummary] = useState<AnalysisRunSummary | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>(() =>
    viewModeForRoute(initialAppRoute) ?? viewModeForPreview(previewMode),
  );
  const [scenarioResult, setScenarioResult] = useState<ScenarioResult | null>(() =>
    previewMode === "result" ||
    previewMode === "result-selected" ||
    hasExecutionPreview
      ? previewScenarioResult
      : null,
  );
  const [executionSeed] = useState<StoredExecutionState>(() => {
    const stored = project
      ? readStored<StoredExecutionState>(executionStorageKey(project))
      : null;
    const routeNeedsExecution =
      initialAppRoute?.view === "test" ||
      initialAppRoute?.view === "evidence-library" ||
      initialAppRoute?.view === "evidence-detail";

    if (routeNeedsExecution && stored) return stored;
    if (hasExecutionPreview) {
      return { current: previewExecution, history: previewExecutionHistory };
    }
    if (!usesPreviewProject && stored) return stored;
    return { current: null, history: [] };
  });
  const [testExecution, setTestExecution] = useState<TestExecution | null>(
    executionSeed.current,
  );
  const [executionHistory, setExecutionHistory] = useState<TestExecution[]>(
    executionSeed.history,
  );
  /* 「테스트 실행」·「증적」 탭은 프로젝트 범위다. 특정 run 이 아니라 이
   * 프로젝트가 남긴 실행 전부를 main 이 투영해 준다. */
  const [projectExecutions, setProjectExecutions] = useState<TestExecution[]>([]);
  const [projects, setProjects] = useState<ProjectSummary[]>(previewProjects);
  /* 마지막으로 해제한 프로젝트 이름. 되돌리기 토스트를 띄우는 동안만 있다. */
  const [disconnected, setDisconnected] = useState<string | undefined>(undefined);
  const [selectedExecutionId, setSelectedExecutionId] = useState<string | null>(
    initialAppRoute?.view === "test" || initialAppRoute?.view === "evidence-detail"
      ? initialAppRoute.executionId
      : executionSeed.current?.executionId ?? null,
  );
  const [selectedEvidence, setSelectedEvidence] = useState<StepEvidence | null>(
    initialAppRoute?.view === "evidence-detail"
      ? findEvidenceById(
          [
            ...(executionSeed.current ? [executionSeed.current] : []),
            ...executionSeed.history,
          ],
          initialAppRoute.evidenceId,
        )
      : previewMode === "evidence-failure" && executionSeed.current
        ? findFirstFailure(executionSeed.current)
        : null,
  );
  const [executionStarting, setExecutionStarting] = useState(false);
  const [executionError, setExecutionError] = useState<string | undefined>(undefined);
  const [lastExecutionStep, setLastExecutionStep] = useState<{ stepId: string; verdict: string } | undefined>(undefined);
  const [evidenceRecord, setEvidenceRecord] = useState<StepEvidenceView | undefined>(undefined);
  const [evidenceFrames, setEvidenceFrames] = useState<Record<string, string>>({});
  const [stepReviews, setStepReviews] = useState<HumanReviewView[]>([]);
  const [evidenceLibrary, setEvidenceLibrary] = useState<EvidenceLibraryView | undefined>(
    previewEvidenceLibrary,
  );
  const [reviewAuthor, setReviewAuthor] = useState(() => readStored<string>(STORAGE.reviewAuthor) ?? "");
  const [focusedScenarioId, setFocusedScenarioId] = useState<string | undefined>(
    initialAppRoute?.view === "scenario"
      ? initialAppRoute.scenarioId
      : undefined,
  );
  const historyRecorded = useRef(false);

  const allExecutions = useMemo(() => {
    const merged = [
      ...(testExecution ? [testExecution] : []),
      ...executionHistory,
      ...projectExecutions,
    ];
    return merged.filter(
      (execution, index) =>
        merged.findIndex((candidate) => candidate.executionId === execution.executionId) === index,
    );
  }, [executionHistory, projectExecutions, testExecution]);
  const evidenceExecution = selectedEvidence
    ? allExecutions.find(
        (execution) => execution.executionId === selectedEvidence.executionId,
      ) ?? null
    : null;
  const activeExecution =
    allExecutions.find(
      (execution) => execution.executionId === selectedExecutionId,
    ) ?? testExecution;
  /* 탭은 화면의 소속을 말한다. run 상세(시나리오)는 생성 이력에, 실행 상세는
   * 테스트 실행에, 증적 상세는 증적에 속한다. */
  const activeProjectView: ProjectView =
    viewMode === "runs" || viewMode === "result" || viewMode === "loading" || viewMode === "error"
      ? "runs"
      : viewMode === "executions" || viewMode === "test-center"
        ? "executions"
        : viewMode === "evidence-library" || viewMode === "evidence-detail"
          ? "evidence"
          : "overview";

  /* 프로젝트를 열 때의 준비 작업. 시작 시 복원과 목록에서 열기가 같은 경로를
   * 쓴다. 두 곳이 갈라지면 한쪽에서만 이력이 비어 보인다. */
  async function hydrateProject(selected: SelectedDirectory) {
    const checkpoint = await getProjectAnalysisState(selected);
    setProject(selected);
    writeStored(STORAGE.project, selected);
    setRecords(await listRuns(selected));
    const storedExecution = readStored<StoredExecutionState>(executionStorageKey(selected));
    setTestExecution(storedExecution?.current ?? null);
    setExecutionHistory(storedExecution?.history ?? []);
    setSelectedExecutionId(storedExecution?.current?.executionId ?? null);
    setProjectExecutions([]);
    setEvidenceLibrary(undefined);
    setScenarioResult(null);
    setSelectedEvidence(null);
    if (checkpoint?.canContinue && checkpoint.nextStep) {
      setAnalysis({
        status: "idle",
        progress: checkpoint.progress,
        message: `${checkpoint.nextStep.toUpperCase()} 단계 실행 준비`,
        startMode: "continue",
      });
    } else {
      setAnalysis(
        checkpoint?.completed
          ? { status: "complete", progress: 100 }
          : { status: "idle", progress: 0, startMode: "new" },
      );
    }
  }

  async function refreshProjects() {
    setProjects(await listProjects());
  }

  useEffect(() => {
    if (usesPreviewProject || !window.scenarioForge) return;
    let cancelled = false;
    void listProjects().then((next) => {
      if (!cancelled) setProjects(next);
    });
    return () => {
      cancelled = true;
    };
  }, [usesPreviewProject]);

  useEffect(() => {
    if (usesPreviewProject || !window.scenarioForge) return;
    let cancelled = false;
    void restoreProjectDirectory().then(async (restored) => {
      if (cancelled) return;
      if (!restored) {
        setSelectionStatus("idle");
        /* 연결된 프로젝트가 있으면 목록을 보여준다. 하나도 없을 때만 첫 화면이
         * 디렉터리 등록 히어로다. */
        if ((await listProjects()).length > 0 && !initialAppRoute) {
          setViewMode("projects");
          updateAppRoute({ view: "projects" }, true);
        }
        return;
      }

      const checkpoint = await getProjectAnalysisState(restored);
      if (cancelled) return;

      setProject(restored);
      writeStored(STORAGE.project, restored);
      setRecords(await listRuns(restored));
      const storedExecution = readStored<StoredExecutionState>(executionStorageKey(restored));
      if (storedExecution) {
        setTestExecution(storedExecution.current);
        setExecutionHistory(storedExecution.history);
        setSelectedExecutionId(storedExecution.current?.executionId ?? null);
      }
      setViewMode("workspace");
      if (checkpoint?.canContinue && checkpoint.nextStep) {
        setAnalysis({
          status: "idle",
          progress: checkpoint.progress,
          message: `${checkpoint.nextStep.toUpperCase()} 단계 실행 준비`,
          startMode: "continue",
        });
      } else {
        setAnalysis(checkpoint?.completed
          ? { status: "complete", progress: 100 }
          : { status: "idle", progress: 0, startMode: "new" });
      }
      updateAppRoute({ view: "workspace" }, true);
      setSelectionStatus("idle");
    }).catch(() => {
      if (!cancelled) setSelectionStatus("error");
    });
    return () => {
      cancelled = true;
    };
  }, [usesPreviewProject]);

  useEffect(() => {
    if (usesPreviewProject || !settings) return;
    let cancelled = false;
    void getModelCredentialStatus(settings).then((status) => {
      if (cancelled) return;
      setSecureStorageAvailable(status.storageAvailable);
      setHasSessionApiKey(status.hasAuthorCredential);
      setHasSessionReviewerApiKey(status.hasReviewerCredential);
    }).catch(() => {
      if (cancelled) return;
      setHasSessionApiKey(false);
      setHasSessionReviewerApiKey(false);
    });
    return () => {
      cancelled = true;
    };
  }, [settings, usesPreviewProject]);

  useEffect(() => {
    if (initialAppRoute) return;
    if (viewMode === "result") {
      updateAppRoute(
        focusedScenarioId
          ? { view: "scenario", scenarioId: focusedScenarioId }
          : { view: "scenario" },
        true,
      );
      return;
    }
    if (viewMode === "test-center" && activeExecution) {
      updateAppRoute(
        { view: "test", executionId: activeExecution.executionId },
        true,
      );
      return;
    }
    if (viewMode === "evidence-library") {
      updateAppRoute({ view: "evidence-library" }, true);
      return;
    }
    if (viewMode === "evidence-detail" && selectedEvidence) {
      updateAppRoute(
        {
          view: "evidence-detail",
          executionId: selectedEvidence.executionId,
          evidenceId: selectedEvidence.evidenceId,
        },
        true,
      );
      return;
    }
    updateAppRoute({ view: "workspace" }, true);
  }, []);

  /* 프로젝트 범위 실행·증적 투영. run 을 열지 않아도 탭 카운트와 목록이 있어야
   * 한다. testExecution 이 바뀔 때 다시 읽어 실행 직후 상태를 반영한다. */
  useEffect(() => {
    if (!project || usesPreviewProject || !window.scenarioForge) return;
    let alive = true;
    void Promise.all([listTestExecutions(project), listEvidenceLibrary(project)])
      .then(([executions, library]) => {
        if (!alive) return;
        setProjectExecutions(executions);
        if (library) setEvidenceLibrary(library);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [project, usesPreviewProject, testExecution?.executionId, testExecution?.status]);

  useEffect(() => {
    if (!project) return;
    writeStored(executionStorageKey(project), {
      current: testExecution,
      history: executionHistory,
    } satisfies StoredExecutionState);
  }, [executionHistory, project, testExecution]);

  useEffect(() => {
    if (!project || scenarioResult || !activeExecution) return;
    let cancelled = false;
    void loadScenarioResult(project, activeExecution.scenarioRunId).then((result) => {
      if (!cancelled && result) setScenarioResult(result);
    });
    return () => {
      cancelled = true;
    };
  }, [activeExecution, project, scenarioResult]);

  useEffect(() => {
    function syncRouteFromHistory() {
      const route = parseAppRoute(window.location.hash);
      if (!route) {
        const fallbackView = viewModeForPreview(previewMode);
        if (fallbackView === "test-center" && testExecution) {
          setSelectedExecutionId(testExecution.executionId);
          setSelectedEvidence(null);
        }
        setViewMode(fallbackView);
        return;
      }

      if (route.view === "projects") {
        setViewMode("projects");
        return;
      }
      if (route.view === "workspace") {
        setViewMode("workspace");
        return;
      }
      if (route.view === "runs") {
        setViewMode("runs");
        return;
      }
      if (route.view === "executions") {
        setViewMode("executions");
        return;
      }
      if (route.view === "scenario") {
        setFocusedScenarioId(route.scenarioId);
        if (scenarioResult) setViewMode("result");
        return;
      }
      if (route.view === "evidence-library") {
        if (allExecutions.length > 0) setViewMode("evidence-library");
        return;
      }
      if (route.view === "test") {
        const execution = allExecutions.find(
          (candidate) => candidate.executionId === route.executionId,
        );
        if (execution) {
          setSelectedExecutionId(execution.executionId);
          setSelectedEvidence(null);
          setViewMode("test-center");
        }
        return;
      }

      const evidence = findEvidenceById(allExecutions, route.evidenceId);
      if (evidence && evidence.executionId === route.executionId) {
        setSelectedExecutionId(route.executionId);
        setSelectedEvidence(evidence);
        setViewMode("evidence-detail");
      }
    }

    window.addEventListener("popstate", syncRouteFromHistory);
    window.addEventListener("hashchange", syncRouteFromHistory);
    return () => {
      window.removeEventListener("popstate", syncRouteFromHistory);
      window.removeEventListener("hashchange", syncRouteFromHistory);
    };
  }, [allExecutions, scenarioResult]);

  useEffect(() => onProjectAnalysisProgress((event) => {
    setAnalysis((current) => current.status === "complete" ? current : {
      ...current,
      status: "running",
      progress: Math.min(event.progress, 99),
      message: event.message,
      ...(event.step ? { currentStep: event.step } : {}),
      stage: event.stage,
      ...(event.stepStatus ? { stepStatus: event.stepStatus } : {}),
      ...(event.completedSteps !== undefined ? { completedSteps: event.completedSteps } : {}),
      ...(event.totalSteps !== undefined ? { totalSteps: event.totalSteps } : {}),
    });
  }), []);

  useEffect(() => {
    if (analysis.status !== "complete" || !lastAnalysisSummary || historyRecorded.current || previewMode) return;
    historyRecorded.current = true;

    const runId = lastAnalysisSummary.analysisRunId;
    // 목록은 디스크에서 다시 읽는다. renderer 가 기록을 만들어 넣지 않는다.
    if (project) void listRuns(project).then(setRecords);

    if (project) {
      void loadScenarioResult(project, runId).then((result) => {
        const resolved = result ?? (!window.scenarioForge ? createDemoScenarioResult(runId) : null);
        if (!resolved) {
          historyRecorded.current = false;
          setAnalysis({ status: "error", progress: 100 });
          return;
        }
        setScenarioResult(resolved);
        window.setTimeout(() => {
          setViewMode("result");
          updateAppRoute({ view: "scenario" });
        }, 700);
      });
    }
  }, [analysis.status, lastAnalysisSummary, project]);

  async function handleSelectProject() {
    setSelectionStatus("selecting");
    try {
      const selected = await selectProjectDirectory();
      if (!selected) {
        setSelectionStatus("idle");
        return;
      }
      /* 새로 고른 디렉터리도 이미 분석 결과가 있을 수 있다. 복원과 같은 준비
       * 경로를 쓴다. */
      await hydrateProject(selected);
      setDisconnected(undefined);
      setViewMode("workspace");
      updateAppRoute({ view: "workspace" }, true);
      setSelectionStatus("idle");
      void refreshProjects();
      let authorCredentialAvailable = hasSessionApiKey;
      let reviewerCredentialAvailable = hasSessionReviewerApiKey;
      if (settings) {
        try {
          const status = await getModelCredentialStatus(settings);
          setSecureStorageAvailable(status.storageAvailable);
          setHasSessionApiKey(status.hasAuthorCredential);
          setHasSessionReviewerApiKey(status.hasReviewerCredential);
          authorCredentialAvailable = status.hasAuthorCredential;
          reviewerCredentialAvailable = status.hasReviewerCredential;
        } catch {
          authorCredentialAvailable = false;
          reviewerCredentialAvailable = false;
        }
      }
      setSettingsOpen(!settings || !authorCredentialAvailable || Boolean(settings.reviewer && !reviewerCredentialAvailable));
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setSelectionStatus("idle");
        return;
      }
      setSelectionStatus("error");
    }
  }

  async function handleSaveSettings(nextSettings: ModelSettings, apiKey: string, reviewerApiKey: string) {
    await saveModelSettings({
      ...nextSettings,
      ...(apiKey ? { apiKey } : {}),
      ...(reviewerApiKey ? { reviewerApiKey } : {}),
    });
    if (apiKey) setHasSessionApiKey(true);
    setHasSessionReviewerApiKey(nextSettings.reviewer ? (Boolean(reviewerApiKey) || hasSessionReviewerApiKey) : false);
    setSettings(nextSettings);
    writeStored(STORAGE.model, nextSettings);
    setSettingsOpen(false);
  }

  async function handleClearModelCredentials() {
    await clearModelCredentials();
    setHasSessionApiKey(false);
    setHasSessionReviewerApiKey(false);
  }

  async function handleStartAnalysis(modeOverride?: "new" | "continue") {
    if (!project) return;
    if (!settings || !hasSessionApiKey || (settings.reviewer && !hasSessionReviewerApiKey)) {
      setSettingsOpen(true);
      return;
    }

    historyRecorded.current = false;
    setAnalysis({ status: "running", progress: 1, completedSteps: 0, totalSteps: GENERATION_STEPS.length });
    try {
      const result = await startProjectAnalysis(project, modeOverride ?? analysis.startMode ?? (analysis.status === "error" || analysis.progress === 0 ? "new" : "continue"));
      const combined = lastAnalysisSummary?.analysisRunId === result.analysisRunId
        ? {
            ...result,
            factCount: result.factCount || lastAnalysisSummary.factCount,
            wikiPages: result.wikiPages || lastAnalysisSummary.wikiPages,
            scenarios: result.scenarios || lastAnalysisSummary.scenarios,
            durationMs: result.durationMs + lastAnalysisSummary.durationMs,
          }
        : result;
      setLastAnalysisSummary(combined);
      setAnalysis(result.completed
        ? { status: "complete", progress: 100 }
        : { status: "idle", progress: result.progress, message: `${result.stage.toUpperCase()} 단계 검증 및 저장 완료`, startMode: "continue" });
    } catch (error) {
      const code = classifyAnalysisError(error);
      // 실패한 단계를 알 수 있어야 하므로 진행률을 0 으로 되돌리지 않는다.
      setAnalysis((current) => ({
        status: "error",
        progress: current.progress,
        ...(code ? { code } : {}),
      }));
    }
  }

  async function handleOpenRecord(run: RunSummary) {
    if (!project) return;
    /* preview 는 정본 run 을 읽지 않는다. 디스크에 run 이 없어도 화면 흐름을
     * 보여줘야 하므로 표본 케이스를 그대로 넘긴다. */
    if (previewMode !== null) {
      setScenarioResult(createDemoScenarioResult(run.runId));
      setViewMode("result");
      updateAppRoute({ view: "scenario" });
      return;
    }
    setViewMode("loading");
    try {
      const result = await loadScenarioResult(project, run.runId);
      setScenarioResult(result);
      setViewMode(result ? "result" : "error");
      if (result) updateAppRoute({ view: "scenario" });
    } catch {
      setScenarioResult(null);
      setViewMode("error");
    }
  }

  /* 탭은 항상 열려 있다. 내용이 없으면 빈 상태가 왜 비었는지 말한다.
   * 잠긴 탭은 그 이유를 말해주지 못한다. */
  function handleProjectNavigation(target: ProjectView) {
    setFocusedScenarioId(undefined);
    if (target === "overview") {
      setViewMode("workspace");
      updateAppRoute({ view: "workspace" });
      return;
    }
    if (target === "runs") {
      setViewMode("runs");
      updateAppRoute({ view: "runs" });
      return;
    }
    if (target === "executions") {
      setViewMode("executions");
      updateAppRoute({ view: "executions" });
      return;
    }
    setViewMode("evidence-library");
    updateAppRoute({ view: "evidence-library" });
  }

  function handleGoToProjects() {
    setViewMode("projects");
    updateAppRoute({ view: "projects" });
    void refreshProjects();
  }

  async function handleOpenProjectFromList(summary: ProjectSummary) {
    /* preview 는 디스크의 정본 run 을 열지 않는다. 분석이 끝난 프로젝트를
     * 가정하고 업무 분류별 시나리오 케이스 화면으로 바로 들어간다. */
    if (previewMode !== null) {
      setProject({ name: summary.name, path: summary.path });
      setScenarioResult(createDemoScenarioResult(previewHistory[0].runId));
      setViewMode("result");
      updateAppRoute({ view: "scenario" });
      return;
    }
    /* 여는 동안 무엇을 하고 있는지 보여준다. 경로·이름은 목록이 이미 디스크에서
     * 읽어 보여준 값이라 새로 추정하는 것이 아니다. 정본 검증이 끝날 때까지
     * 빈 화면을 두면 사용자는 눌린 것인지 알 수 없다. */
    setProject({ name: summary.name, path: summary.path });
    setScenarioResult(null);
    setViewMode("loading");
    const opened = await openProject(summary.path);
    if (!opened) {
      setProject(null);
      setViewMode("projects");
      return;
    }
    await hydrateProject(opened);
    /* 분석 결과가 있는 프로젝트는 시나리오 케이스로 바로 들어간다. 사용자가
     * 「열기」를 누른 이유는 도출된 케이스를 보기 위해서다. 개요를 먼저 거치면
     * 같은 프로젝트를 열 때마다 한 번 더 눌러야 한다. 읽지 못하면 개요로 둔다. */
    const result = summary.latestRunId
      ? await loadScenarioResult(opened, summary.latestRunId).catch(() => null)
      : null;
    setScenarioResult(result);
    setViewMode(result ? "result" : "workspace");
    updateAppRoute({ view: result ? "scenario" : "workspace" });
    void refreshProjects();
  }

  async function handleDisconnectProject(summary: ProjectSummary) {
    if (!(await disconnectProject(summary.path))) return;
    /* 열려 있던 프로젝트를 해제하면 화면을 목록으로 되돌린다. 해제한 프로젝트의
     * 작업대에 남아 있으면 어디에도 속하지 않은 상태가 된다. */
    if (project?.path === summary.path) {
      setProject(null);
      setScenarioResult(null);
      setTestExecution(null);
      setExecutionHistory([]);
      setProjectExecutions([]);
      setEvidenceLibrary(undefined);
    }
    setViewMode("projects");
    updateAppRoute({ view: "projects" });
    setDisconnected(summary.name);
    await refreshProjects();
  }

  async function handleUndoDisconnect() {
    if (await undoDisconnectProject()) await refreshProjects();
    setDisconnected(undefined);
  }

  async function handleRelinkProject(summary: ProjectSummary) {
    if (await relinkProject(summary.path)) await refreshProjects();
  }

  async function handleDeleteAnalysisData(summary: ProjectSummary) {
    await deleteAnalysisData(summary.path);
    if (project?.path === summary.path) {
      // 지운 결과를 화면에 남기지 않는다.
      setRecords([]);
      setScenarioResult(null);
      setTestExecution(null);
      setExecutionHistory([]);
      setProjectExecutions([]);
      setEvidenceLibrary(undefined);
      setAnalysis({ status: "idle", progress: 0, startMode: "new" });
    }
    await refreshProjects();
  }

  function handleOpenExecution(execution: TestExecution) {
    handleSelectExecution(execution);
    setViewMode("test-center");
  }

  /* 실행 구동·중단은 backend 명령이다. renderer 는 결과를 다시 읽어 표시한다. */
  async function refreshExecutions(executionId?: string) {
    if (!project || !scenarioResult) return;
    const executions = await listTestExecutions(project, scenarioResult.runId);
    const targetId = executionId ?? selectedExecutionId ?? testExecution?.executionId;
    const current = executions.find((execution) => execution.executionId === targetId) ?? executions[0];
    if (!current) return;
    setExecutionHistory(executions.filter((execution) => execution.executionId !== current.executionId));
    setTestExecution(current);
    setSelectedExecutionId(current.executionId);
  }

  async function handleStartExecution(dataBindings: Record<string, string>) {
    if (!project || !scenarioResult || !testExecution) return;
    setExecutionStarting(true);
    setExecutionError(undefined);
    try {
      const result = await runQueuedExecution({
        project,
        runId: scenarioResult.runId,
        executionId: testExecution.executionId,
        // 값은 이 호출 동안만 존재한다. 저장하지 않는다.
        dataBindings,
      });
      if (result.outcome === "rejected") setExecutionError(result.code);
      await refreshExecutions(testExecution.executionId);
    } finally {
      setExecutionStarting(false);
      setLastExecutionStep(undefined);
    }
  }

  /* 선택 재시도는 새 실행을 만들고 원본을 참조로 남긴다.
   * 기존 결과와 증적은 그대로 둔다. */
  async function handleRetrySelected(scenarioIds: string[]) {
    if (!project || !scenarioResult || !testExecution) return;
    setExecutionError(undefined);
    const acceptance = await retryScenarioTests({
      project,
      runId: scenarioResult.runId,
      operationId: crypto.randomUUID(),
      scenarioIds,
      targetUrl: testExecution.targetUrl,
      dataBindings: {},
      maskElementRefs: [],
      destructiveAllowed: false,
      retryOfExecutionId: testExecution.executionId,
    });
    if (acceptance.outcome === "rejected") {
      setExecutionError(acceptance.code);
      return;
    }
    await handleExecutionQueued(acceptance.executionId);
  }

  /* step 행에서 남기는 빠른 검토. 메모 없이 판단만 기록한다. */
  async function handleQuickReview(scenarioId: string, order: number, decision: ReviewDecision) {
    if (!project || !scenarioResult || !testExecution || !reviewAuthor.trim()) {
      setExecutionError(reviewAuthor.trim() ? undefined : "REVIEW_AUTHOR_REQUIRED");
      return;
    }
    await addStepReview({
      project,
      runId: scenarioResult.runId,
      executionId: testExecution.executionId,
      scenarioId,
      stepId: `${scenarioId}#${order}`,
      decision,
      note: "",
      author: reviewAuthor,
    });
  }

  async function handleCancelExecutionCommand() {
    if (!project || !scenarioResult || !testExecution) return;
    await cancelScenarioTests({ project, runId: scenarioResult.runId, executionId: testExecution.executionId });
  }

  /* 대기열 등록 뒤에는 backend 투영으로 실행 상태를 읽어 이동한다.
   * renderer 가 실행 객체를 만들지 않는다. */
  async function handleExecutionQueued(executionId: string) {
    if (!project || !scenarioResult) return;
    const executions = await listTestExecutions(project, scenarioResult.runId);
    const queued = executions.find((execution) => execution.executionId === executionId);
    if (!queued) return;
    setExecutionHistory(executions.filter((execution) => execution.executionId !== executionId));
    setTestExecution(queued);
    setSelectedExecutionId(queued.executionId);
    setSelectedEvidence(null);
    setViewMode("test-center");
    updateAppRoute({ view: "test", executionId: queued.executionId });
  }

  useEffect(() => {
    // 진행 상태는 backend event 만 반영한다. renderer 가 추정하지 않는다.
    return onTestExecutionProgress((event) => {
      setLastExecutionStep({ stepId: event.stepId, verdict: event.verdict });
    });
  }, []);

  /* 정본 증적을 읽는다. 프레임은 main 이 data URL 로 넘긴다.
   * renderer 가 파일을 직접 열지 않는다. */
  async function handleOpenStepEvidence(
    scenarioId: string,
    order: number,
    executionId?: string,
    runId?: string,
  ) {
    if (!project) return;
    const targetExecutionId = executionId ?? testExecution?.executionId;
    /* 증적은 소속 run 트리 안에서만 읽는다. 프로젝트 범위 목록에서 열 때는
     * 항목의 run 을 쓰고, 실행 상세에서 열 때는 열려 있는 run 을 쓴다. */
    const targetRunId =
      runId ??
      allExecutions.find((execution) => execution.executionId === targetExecutionId)?.scenarioRunId ??
      scenarioResult?.runId;
    if (!targetExecutionId || !targetRunId) return;
    const request = {
      project,
      runId: targetRunId,
      executionId: targetExecutionId,
      scenarioId,
      stepId: `${scenarioId}#${order}`,
    };
    const record = await readStepEvidence(request);
    if (!record) return;
    const frames: Record<string, string> = {};
    for (const frame of record.frames) {
      const dataUrl = await readEvidenceFrame({
        project,
        runId: targetRunId,
        executionId: targetExecutionId,
        relativePath: frame.relativePath,
      });
      if (dataUrl) frames[frame.relativePath] = dataUrl;
    }
    setEvidenceRecord(record);
    setEvidenceFrames(frames);
    setStepReviews(await listStepReviews(request));
    setSelectedEvidence({
      evidenceId: record.stepId,
      executionId: targetExecutionId,
      scenarioId,
      stepOrder: order,
      status: record.verdict === "PASSED" ? "passed" : record.verdict === "FAILED" ? "failed" : "inconclusive",
      action: record.target.visibleLabel,
      expected: record.assertions.map((assertion: { ref: string }) => assertion.ref).join(", "),
      actual: record.assertions.map((assertion: { verdict: string; detail: string }) => `${assertion.verdict} · ${assertion.detail}`).join(" / ") || (record.reason ? `${record.reason.code} · ${record.reason.detail}` : ""),
      captures: [],
    });
    setViewMode("evidence-detail");
    updateAppRoute({ view: "evidence-detail", executionId: targetExecutionId, evidenceId: record.stepId });
  }

  /* 라이브러리에서 열 때는 실행을 먼저 맞춘 뒤 기록을 읽는다. */
  async function handleOpenLibraryEvidence(
    runId: string,
    executionId: string,
    scenarioId: string,
    order: number,
  ) {
    const execution = allExecutions.find((candidate) => candidate.executionId === executionId);
    if (execution) {
      setTestExecution(execution);
      setSelectedExecutionId(executionId);
    }
    await handleOpenStepEvidence(scenarioId, order, executionId, runId);
  }

  async function handleAddReview(input: { decision: ReviewDecision; causeTag?: ReviewCauseTag; note: string }) {
    if (!project || !scenarioResult || !selectedEvidence) return;
    const saved = await addStepReview({
      project,
      runId: scenarioResult.runId,
      executionId: selectedEvidence.executionId,
      scenarioId: selectedEvidence.scenarioId,
      stepId: `${selectedEvidence.scenarioId}#${selectedEvidence.stepOrder}`,
      decision: input.decision,
      ...(input.causeTag ? { causeTag: input.causeTag } : {}),
      note: input.note,
      author: reviewAuthor,
    });
    if (!saved) throw new Error("REVIEW_NOT_SAVED");
    setStepReviews((current) => [...current, saved]);
  }

  function handleReviewAuthorChange(author: string) {
    setReviewAuthor(author);
    writeStored(STORAGE.reviewAuthor, author);
  }

  function handleOpenEvidence(evidence: StepEvidence) {
    setEvidenceRecord(undefined);
    setEvidenceFrames({});
    setStepReviews([]);
    setSelectedEvidence(evidence);
    setViewMode("evidence-detail");
    updateAppRoute({
      view: "evidence-detail",
      executionId: evidence.executionId,
      evidenceId: evidence.evidenceId,
    });
  }

  function handleOpenScenario(scenarioId: string) {
    if (!scenarioResult) return;
    setFocusedScenarioId(scenarioId);
    setViewMode("result");
    updateAppRoute({ view: "scenario", scenarioId });
  }

  function handleRetry(
    sourceExecution?: TestExecution,
    scenarioIds?: string[],
  ) {
    const executionToRetry = sourceExecution ?? testExecution;
    if (!executionToRetry) return;
    /* 재시도는 backend 명령이다. fixture 실행 조립은 preview 경로에서만 한다.
     * 실제 실행 이력은 TestCoordinator 가 연결된 뒤 hydration 으로 만든다. */
    if (previewMode === null) return;
    const retriedExecution = {
      ...createDemoTestExecution(
        executionToRetry.scenarioRunId,
        "running",
        scenarioIds ?? executionToRetry.cases.map((testCase) => testCase.scenarioId),
        createRendererExecutionId(),
      ),
      targetUrl: executionToRetry.targetUrl,
      retryOfExecutionId: executionToRetry.executionId,
      createdAt: new Date().toISOString(),
    };
    setExecutionHistory((current) => {
      const next = [...(testExecution ? [testExecution] : []), ...current];
      return next.filter(
        (execution, index) =>
          next.findIndex(
            (candidate) => candidate.executionId === execution.executionId,
          ) === index,
      );
    });
    setTestExecution(retriedExecution);
    setSelectedExecutionId(retriedExecution.executionId);
    setSelectedEvidence(null);
    setViewMode("test-center");
    updateAppRoute({
      view: "test",
      executionId: retriedExecution.executionId,
    });
  }

  function handleSelectExecution(execution: TestExecution) {
    setSelectedExecutionId(execution.executionId);
    setSelectedEvidence(null);
    updateAppRoute({ view: "test", executionId: execution.executionId });
  }

  function handleReturnToExecution(execution: TestExecution) {
    handleSelectExecution(execution);
    setViewMode("test-center");
  }

  function handleCancelExecution() {
    setTestExecution((current) => {
      if (!current || current.status !== "running") return current;
      return {
        ...current,
        status: "cancelled",
        completedAt: new Date().toISOString(),
        cases: current.cases.map((testCase) =>
          testCase.status === "running" || testCase.status === "queued"
            ? {
                ...testCase,
                status: "cancelled",
                steps: testCase.steps.map((step) => ({
                  ...step,
                  status:
                    step.status === "running"
                      ? "cancelled"
                      : step.status === "queued"
                        ? "skipped"
                        : step.status,
                })),
              }
            : testCase,
        ),
      };
    });
  }

  return (
    <>
      {/* 스프라이트는 문서에 한 번만 있어야 한다. `<use href="#...">` 가 이걸 참조한다. */}
      <IconSprite />
      <div
        className={`app-shell${settingsOpen ? " has-modal" : ""}`}
        data-brand="forge"
        aria-hidden={settingsOpen || undefined}
        inert={settingsOpen || undefined}
      >
        <a className="skip-link" href="#main-content">
          본문으로 건너뛰기
        </a>


        <AppShell
          project={viewMode === "projects" ? null : project}
          onOpenSettings={() => setSettingsOpen(true)}
          layout={viewMode === "test-center" || viewMode === "evidence-detail" || viewMode === "result" ? "split" : "page"}
          {...(previewMode !== null
            ? {
                /* preview 화면을 실제 수행 결과로 오인하면 안 된다. 표본이라는
                 * 사실을 어느 화면에서도 지우지 않는다. */
                banner: (
                  <div className="notice warn" style={{ margin: "10px 16px 0" }} role="status">
                    <Icon name="i-alert" size="sm" />
                    <span>
                      <b>표본 데이터 (preview)</b> · 화면 흐름을 보여주기 위한 예시이며
                      실제 분석 산출물이나 테스트 수행 증적이 아닙니다.
                    </span>
                  </div>
                ),
              }
            : {})}
          {...(project && viewMode !== "projects"
            ? {
                onGoToProjects: handleGoToProjects,
                activeView: activeProjectView,
                counts: {
                  runs: records.length,
                  executions: allExecutions.length,
                  ...(evidenceLibrary ? { evidence: evidenceLibrary.totals.steps } : {}),
                },
                executionRunning:
                  testExecution?.status === "running" || testExecution?.status === "preparing",
                onNavigate: handleProjectNavigation,
              }
            : {})}
        >
        {viewMode === "projects" || (!project && projects.length > 0) ? (
          <ProjectList
            projects={projects}
            {...(project?.path ? { activePath: project.path } : {})}
            {...(disconnected ? { disconnected } : {})}
            onAddProject={handleSelectProject}
            onOpenProject={(summary) => void handleOpenProjectFromList(summary)}
            onRevealProject={(summary) => void revealProject(summary.path)}
            onDisconnectProject={(summary) => void handleDisconnectProject(summary)}
            onUndoDisconnect={() => void handleUndoDisconnect()}
            onRelinkProject={(summary) => void handleRelinkProject(summary)}
            onMeasureAnalysisData={(summary) => measureAnalysisData(summary.path)}
            onDeleteAnalysisData={(summary) => handleDeleteAnalysisData(summary)}
          />
        ) : project && viewMode === "runs" ? (
          <GenerationHistory runs={records} onOpen={(run) => void handleOpenRecord(run)} />
        ) : project && viewMode === "executions" ? (
          <ExecutionList
            executions={allExecutions}
            {...(testExecution ? { runningExecutionId: testExecution.executionId } : {})}
            {...(evidenceLibrary ? { library: evidenceLibrary } : {})}
            onOpenExecution={handleOpenExecution}
            onOpenStepEvidence={handleOpenLibraryEvidence}
            onGoToRuns={() => handleProjectNavigation("runs")}
          />
        ) : project && viewMode === "result" && scenarioResult ? (
          <ScenarioResults
            project={project}
            result={scenarioResult}
            initialSelectedIds={
              previewMode === "result-selected"
                ? ["SCN-AUTH-001", "SCN-LEDGER-001"]
                : []
            }
            focusedScenarioId={focusedScenarioId}
            onExecutionQueued={handleExecutionQueued}
            {...(testExecution && ["queued", "preparing", "running"].includes(testExecution.status)
              ? {
                  activeExecution: {
                    executionId: testExecution.executionId,
                    targetUrl: testExecution.targetUrl,
                  },
                }
              : {})}
            onBack={() => {
              setViewMode("workspace");
              updateAppRoute({ view: "workspace" });
            }}
          />
        ) : project && viewMode === "test-center" && activeExecution ? (
          <TestCenter
            execution={activeExecution}
            history={allExecutions.filter(
              (execution) => execution.executionId !== activeExecution.executionId,
            )}
            currentExecutionId={testExecution?.executionId}
            onBackToScenarios={() => {
              setFocusedScenarioId(undefined);
              setViewMode("result");
              updateAppRoute({ view: "scenario" });
            }}
            onOpenScenario={handleOpenScenario}
            onOpenEvidence={handleOpenEvidence}
            onStart={handleStartExecution}
            starting={executionStarting}
            {...(lastExecutionStep ? { lastStep: lastExecutionStep } : {})}
            {...(executionError ? { commandError: executionError } : {})}
            onOpenStepEvidence={handleOpenStepEvidence}
            onRetrySelected={handleRetrySelected}
            onQuickReview={handleQuickReview}
            onSelectExecution={handleSelectExecution}
            onCancel={() => {
              // 중단은 backend 명령이다. preview 경로에서는 fixture 상태만 바꾼다.
              if (previewMode === null) void handleCancelExecutionCommand().then(() => refreshExecutions());
              else handleCancelExecution();
            }}
            onRetry={() => handleRetry(activeExecution)}
          />
        ) : project && viewMode === "evidence-library" ? (
          <EvidenceLibrary
            executions={allExecutions}
            onBackToScenarios={() => {
              setFocusedScenarioId(undefined);
              setViewMode("result");
              updateAppRoute({ view: "scenario" });
            }}
            onOpenEvidence={handleOpenEvidence}
            {...(evidenceLibrary ? { library: evidenceLibrary } : {})}
            onOpenStepEvidence={handleOpenLibraryEvidence}
          />
        ) : project && viewMode === "evidence-detail" && selectedEvidence ? (
          /* 증적 상세는 실행 투영을 요구하지 않는다. 증적이 소속 실행을 이미
           * 알고 있고, 실행 투영이 비어도 증적은 열려야 한다. */
          <EvidenceDetail
            executionId={selectedEvidence.executionId}
            evidence={selectedEvidence}
            {...(evidenceRecord
              ? {
                  record: evidenceRecord,
                  frames: evidenceFrames,
                  reviews: stepReviews,
                  reviewAuthor,
                  onReviewAuthorChange: handleReviewAuthorChange,
                  onAddReview: handleAddReview,
                }
              : {})}
            backLabel={evidenceExecution ? "테스트 수행으로 돌아가기" : "증적 목록으로 돌아가기"}
            onBack={() => {
              if (evidenceExecution) {
                handleReturnToExecution(evidenceExecution);
                return;
              }
              setViewMode("evidence-library");
              updateAppRoute({ view: "evidence-library" });
            }}
            onOpenScenario={handleOpenScenario}
            {...(evidenceExecution
              ? { onRetry: () => handleRetry(evidenceExecution, [selectedEvidence.scenarioId]) }
              : {})}
          />
        ) : project && viewMode === "loading" ? (
          <main className="result-loading" aria-live="polite">
            <span className="eyebrow">LOCAL DATA</span>
            <h1>저장된 결과를 여는 중</h1>
            <p>시나리오 정보 셋을 읽고 기록 무결성을 확인하고 있습니다.</p>
            <p className="path">{project.path}</p>
          </main>
        ) : project && viewMode === "error" ? (
          <main className="result-loading" role="alert">
            <span className="eyebrow">LOCAL DATA ERROR</span>
            <h1>저장된 결과를 열 수 없습니다.</h1>
            <p>시나리오 정보 셋이 없거나 형식이 올바르지 않습니다.</p>
            <button
              className="outline-action"
              type="button"
              onClick={() => {
                setViewMode("workspace");
                updateAppRoute({ view: "workspace" });
              }}
            >
              프로젝트 작업대로 돌아가기
            </button>
          </main>
        ) : project ? (
          <ProjectWorkspace
            project={project}
            settings={settings}
            analysis={analysis}
            records={records}
            {...(lastAnalysisSummary ? { runId: lastAnalysisSummary.analysisRunId } : {})}
            summary={{
              executions: allExecutions.length,
              failedExecutions: allExecutions.filter((execution) => execution.status === "failed").length,
              ...(evidenceLibrary
                ? { frames: evidenceLibrary.totals.frames, bytes: evidenceLibrary.totals.bytes }
                : {}),
            }}
            onStartAnalysis={() => void handleStartAnalysis()}
            onStartNewAnalysis={() => void handleStartAnalysis("new")}
            onOpenSettings={() => setSettingsOpen(true)}
            onRevealPath={() => void revealProject(project.path ?? "")}
            onNavigate={handleProjectNavigation}
          />
        ) : (
          <Onboarding status={selectionStatus} onSelectProject={handleSelectProject} />
        )}
        </AppShell>
      </div>

      {settingsOpen && (
        <ModelSettingsModal
          initialSettings={settings}
          hasSessionApiKey={hasSessionApiKey}
          hasSessionReviewerApiKey={hasSessionReviewerApiKey}
          secureStorageAvailable={secureStorageAvailable}
          onClose={() => setSettingsOpen(false)}
          onSave={handleSaveSettings}
          onClearCredentials={handleClearModelCredentials}
        />
      )}
    </>
  );
}
