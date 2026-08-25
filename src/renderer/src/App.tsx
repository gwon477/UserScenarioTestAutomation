import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  FileCode2,
  Folder,
  FolderOpen,
  GitBranch,
  Settings2,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { AnalysisProgress, type AnalysisStatus } from "./components/AnalysisProgress";
import {
  GenerationHistory,
  type GenerationRecord,
} from "./components/GenerationHistory";
import { ModelSettingsModal } from "./components/ModelSettingsModal";
import { EvidenceDetail } from "./components/EvidenceDetail";
import { EvidenceLibrary } from "./components/EvidenceLibrary";
import {
  ProjectNavigation,
  type ProjectView,
} from "./components/ProjectNavigation";
import { ScenarioResults } from "./components/ScenarioResults";
import { TestCenter } from "./components/TestCenter";
import {
  loadScenarioResult,
  saveModelSettings,
  selectProjectDirectory,
  startProjectAnalysis,
  type ModelSettings,
  type SelectedDirectory,
} from "./desktop";
import {
  createDemoScenarioResult,
  type ScenarioResult,
} from "./scenario-result";
import {
  createDemoExecutionHistory,
  createDemoTestExecution,
  findFirstFailure,
} from "./test-execution-fixture";
import type {
  StepEvidence,
  TestExecution,
} from "../../shared/test-execution";

type SelectionStatus = "idle" | "selecting" | "error";
type AnalysisState = { status: AnalysisStatus; progress: number };
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
  | null;
type ViewMode =
  | "workspace"
  | "result"
  | "loading"
  | "error"
  | "test-center"
  | "evidence-library"
  | "evidence-detail";

const STORAGE = {
  project: "scenarioforge.project.v1",
  model: "scenarioforge.model.v1",
  historyPrefix: "scenarioforge.history.v1",
};

const onboardingSteps = ["프로젝트", "모델", "확인"];
const previewMode = new URLSearchParams(window.location.search).get(
  "preview",
) as PreviewMode;

const previewProject: SelectedDirectory = {
  name: "commerce-platform",
  path: "/workspace/commerce-platform",
};

const previewSettings: ModelSettings = {
  provider: "openai-compatible",
  endpoint: "https://api.openai.com/v1",
  model: "gpt-5",
};

const previewHistory: GenerationRecord[] = [
  {
    id: "preview-02",
    createdAt: "2026. 8. 25. 15:42",
    duration: "03:18",
    factCount: 428,
    wikiPages: 36,
    scenarios: 24,
  },
  {
    id: "preview-01",
    createdAt: "2026. 8. 22. 10:16",
    duration: "02:51",
    factCount: 391,
    wikiPages: 31,
    scenarios: 19,
  },
];

const executionPreviewModes: PreviewMode[] = [
  "test-running",
  "test-failed",
  "evidence-library",
  "evidence-failure",
];
const hasExecutionPreview = executionPreviewModes.includes(previewMode);
const previewScenarioResult = createDemoScenarioResult(previewHistory[0].id);
const previewExecution = hasExecutionPreview
  ? createDemoTestExecution(
      previewHistory[0].id,
      previewMode === "test-running" ? "running" : "failed",
      undefined,
      previewMode === "test-running"
        ? "EXE-20260825-0007"
        : "EXE-20260825-0006",
    )
  : null;
const previewExecutionHistory = hasExecutionPreview
  ? createDemoExecutionHistory(previewHistory[0].id).filter(
      (execution) => execution.executionId !== previewExecution?.executionId,
    )
  : [];

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

function historyStorageKey(project: SelectedDirectory) {
  return `${STORAGE.historyPrefix}:${encodeURIComponent(project.path ?? project.name)}`;
}

function ForgeMark() {
  return (
    <svg
      aria-hidden="true"
      className="forge-mark"
      viewBox="0 0 36 36"
      fill="none"
    >
      <path d="M9 10.5h18M9 18h12M9 25.5h18" />
      <path d="m22 14 5 4-5 4" />
    </svg>
  );
}

function Brand() {
  return (
    <a className="brand" href="/" aria-label="ScenarioForge 처음으로">
      <ForgeMark />
      <span>ScenarioForge</span>
    </a>
  );
}

function BlueprintVisual() {
  return (
    <section className="blueprint" aria-label="소스코드 분석 과정 미리보기">
      <svg className="blueprint-grid" aria-hidden="true">
        <defs>
          <pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse">
            <path d="M 24 0 L 0 0 0 24" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#grid)" />
      </svg>

      <header className="blueprint-header">
        <div>
          <span className="eyebrow">WORKSPACE BLUEPRINT</span>
          <h2>소스에서 시나리오까지</h2>
        </div>
        <span className="drawing-number">SF–01</span>
      </header>

      <div className="source-window">
        <div className="source-window-title">
          <Folder size={16} strokeWidth={1.8} aria-hidden="true" />
          <span>source-directory</span>
        </div>
        <ul className="file-tree" aria-label="예시 프로젝트 파일 구조">
          <li>
            <Folder size={14} aria-hidden="true" /> src
          </li>
          <li className="file-tree-child is-active">
            <FileCode2 size={14} aria-hidden="true" /> checkout.tsx
          </li>
          <li className="file-tree-child">
            <FileCode2 size={14} aria-hidden="true" /> payment.ts
          </li>
          <li className="file-tree-child">
            <FileCode2 size={14} aria-hidden="true" /> receipt.tsx
          </li>
        </ul>
      </div>

      <div className="route-map" aria-label="워크플로우 도출 예시">
        <div className="route-node">
          <span>01</span>
          <strong>장바구니</strong>
        </div>
        <ArrowRight size={18} aria-hidden="true" />
        <div className="route-node is-current">
          <span>02</span>
          <strong>결제</strong>
        </div>
        <ArrowRight size={18} aria-hidden="true" />
        <div className="route-node">
          <span>03</span>
          <strong>완료</strong>
        </div>
      </div>

      <div className="blueprint-caption">
        <GitBranch size={17} aria-hidden="true" />
        <span>코드의 연결을 따라 사용자 경로를 도출합니다.</span>
      </div>
    </section>
  );
}

function OnboardingHeader() {
  return (
    <header className="topbar">
      <Brand />
      <ol className="setup-progress" aria-label="도입 설정 진행 상황">
        {onboardingSteps.map((step, index) => (
          <li key={step} className={index === 0 ? "is-current" : undefined}>
            <span>{index + 1}</span>
            {step}
          </li>
        ))}
      </ol>
    </header>
  );
}

function WorkspaceHeader({
  project,
  onOpenSettings,
  activeView,
  scenarioReady,
  executionReady,
  evidenceReady,
  executionRunning,
  onNavigate,
}: {
  project: SelectedDirectory;
  onOpenSettings: () => void;
  activeView: ProjectView;
  scenarioReady: boolean;
  executionReady: boolean;
  evidenceReady: boolean;
  executionRunning: boolean;
  onNavigate: (view: ProjectView) => void;
}) {
  return (
    <header className="topbar workspace-topbar">
      <Brand />
      <ProjectNavigation
        active={activeView}
        scenarioReady={scenarioReady}
        executionReady={executionReady}
        evidenceReady={evidenceReady}
        executionRunning={executionRunning}
        onNavigate={onNavigate}
      />
      <div className="workspace-nav">
        <span className="active-project-name">
          <Folder size={16} aria-hidden="true" /> {project.name}
        </span>
        <button className="outline-action compact" type="button" onClick={onOpenSettings}>
          <Settings2 size={16} aria-hidden="true" /> LLM 설정
        </button>
      </div>
    </header>
  );
}

function Onboarding({
  status,
  onSelectProject,
}: {
  status: SelectionStatus;
  onSelectProject: () => void;
}) {
  return (
    <main id="main-content" className="onboarding">
      <section className="intro-copy" aria-labelledby="welcome-title">
        <div className="product-kicker">
          <span>TEST DESIGN</span>
          <span aria-hidden="true">·</span>
          <span>SI 통합 테스트 설계</span>
        </div>

        <h1 id="welcome-title">
          소스코드에서,
          <br />
          사용자가 걷는 길을
          <br />
          <em>단조합니다.</em>
        </h1>

        <p className="intro-description">
          분석할 로컬 소스 디렉터리를 선택하세요. 코드 구조와 연결을 읽어 테스트
          설계의 원천이 되는 사용자 경로를 도출합니다.
        </p>

        <button
          className="primary-action"
          type="button"
          onClick={onSelectProject}
          disabled={status === "selecting"}
        >
          <FolderOpen size={19} strokeWidth={1.8} aria-hidden="true" />
          <span>{status === "selecting" ? "디렉터리 여는 중" : "소스 디렉터리 선택"}</span>
          <ArrowRight className="action-arrow" size={19} aria-hidden="true" />
        </button>

        {status === "error" && (
          <p className="form-error" role="alert">
            디렉터리를 열 수 없습니다. 접근 권한을 확인한 뒤 다시 선택하세요.
          </p>
        )}

        <div className="scope-note">
          <ShieldCheck size={17} strokeWidth={1.8} aria-hidden="true" />
          <span>선택한 디렉터리를 분석 작업 범위로 사용합니다.</span>
        </div>
      </section>
      <BlueprintVisual />
    </main>
  );
}

function providerName(provider: ModelSettings["provider"]) {
  if (provider === "anthropic") return "Anthropic";
  if (provider === "custom") return "사용자 지정";
  return "OpenAI 호환";
}

function ProjectWorkspace({
  project,
  settings,
  analysis,
  records,
  onStartAnalysis,
  onOpenSettings,
  onOpenRecord,
}: {
  project: SelectedDirectory;
  settings: ModelSettings | null;
  analysis: AnalysisState;
  records: GenerationRecord[];
  onStartAnalysis: () => void;
  onOpenSettings: () => void;
  onOpenRecord: (record: GenerationRecord) => void;
}) {
  return (
    <main id="main-content" className="workspace">
      <section className="workspace-heading" aria-labelledby="project-title">
        <div>
          <span className="eyebrow">ACTIVE PROJECT</span>
          <h1 id="project-title">{project.name}</h1>
          <p>{project.path ?? `로컬 프로젝트 / ${project.name}`}</p>
        </div>
        <dl className="project-facts">
          <div>
            <dt>작업 범위</dt>
            <dd>선택 디렉터리 내부</dd>
          </div>
          <div>
            <dt>연결 모델</dt>
            <dd>{settings ? settings.model : "설정 필요"}</dd>
          </div>
          <div>
            <dt>생성 이력</dt>
            <dd>{records.length}건</dd>
          </div>
        </dl>
      </section>

      {analysis.status === "idle" ? (
        <section className="analysis-launch" aria-labelledby="analysis-launch-title">
          <div className="launch-copy">
            <span className="eyebrow">READY TO FORGE</span>
            <h2 id="analysis-launch-title">프로젝트 분석 준비</h2>
            <p>
              SRC 수집부터 FACT, WIKI, SCENARIO 생성까지 하나의 공정으로 진행합니다.
            </p>
          </div>

          <div className="model-summary">
            {settings ? (
              <>
                <span>{providerName(settings.provider)}</span>
                <strong>{settings.model}</strong>
                <small>{settings.endpoint}</small>
              </>
            ) : (
              <>
                <span>모델 연결</span>
                <strong>설정이 필요합니다.</strong>
                <button type="button" onClick={onOpenSettings}>
                  연결 설정 열기
                </button>
              </>
            )}
          </div>

          <button className="primary-action launch-button" type="button" onClick={onStartAnalysis}>
            <Sparkles size={19} strokeWidth={1.8} aria-hidden="true" />
            <span>분석 시작</span>
            <ArrowRight className="action-arrow" size={19} aria-hidden="true" />
          </button>
        </section>
      ) : (
        <AnalysisProgress status={analysis.status} progress={analysis.progress} />
      )}

      <GenerationHistory records={records} onOpen={onOpenRecord} />
    </main>
  );
}

export default function App() {
  const usesPreviewProject = previewMode !== null;
  const [project, setProject] = useState<SelectedDirectory | null>(() =>
    usesPreviewProject ? previewProject : readStored<SelectedDirectory>(STORAGE.project),
  );
  const [settings, setSettings] = useState<ModelSettings | null>(() =>
    usesPreviewProject ? previewSettings : readStored<ModelSettings>(STORAGE.model),
  );
  const [hasSessionApiKey, setHasSessionApiKey] = useState(usesPreviewProject);
  const [records, setRecords] = useState<GenerationRecord[]>(() =>
    usesPreviewProject
      ? previewHistory
      : (() => {
          const storedProject = readStored<SelectedDirectory>(STORAGE.project);
          return storedProject
            ? (readStored<GenerationRecord[]>(historyStorageKey(storedProject)) ?? [])
            : [];
        })(),
  );
  const [selectionStatus, setSelectionStatus] = useState<SelectionStatus>("idle");
  const [settingsOpen, setSettingsOpen] = useState(previewMode === "modal");
  const [analysis, setAnalysis] = useState<AnalysisState>(() =>
    previewMode === "progress"
      ? { status: "running", progress: 62 }
      : { status: "idle", progress: 0 },
  );
  const [viewMode, setViewMode] = useState<ViewMode>(() =>
    previewMode === "result" || previewMode === "result-selected"
      ? "result"
      : previewMode === "test-running" || previewMode === "test-failed"
        ? "test-center"
        : previewMode === "evidence-library"
          ? "evidence-library"
          : previewMode === "evidence-failure"
            ? "evidence-detail"
            : "workspace",
  );
  const [scenarioResult, setScenarioResult] = useState<ScenarioResult | null>(() =>
    previewMode === "result" ||
    previewMode === "result-selected" ||
    hasExecutionPreview
      ? previewScenarioResult
      : null,
  );
  const [testExecution, setTestExecution] = useState<TestExecution | null>(
    previewExecution,
  );
  const [executionHistory, setExecutionHistory] = useState<TestExecution[]>(
    previewExecutionHistory,
  );
  const [selectedExecutionId, setSelectedExecutionId] = useState<string | null>(
    previewExecution?.executionId ?? null,
  );
  const [selectedEvidence, setSelectedEvidence] = useState<StepEvidence | null>(
    previewMode === "evidence-failure" && previewExecution
      ? findFirstFailure(previewExecution)
      : null,
  );
  const [focusedScenarioId, setFocusedScenarioId] = useState<string>();
  const historyRecorded = useRef(false);

  const allExecutions = [
    ...(testExecution ? [testExecution] : []),
    ...executionHistory.filter(
      (execution) => execution.executionId !== testExecution?.executionId,
    ),
  ];
  const evidenceExecution = selectedEvidence
    ? allExecutions.find(
        (execution) => execution.executionId === selectedEvidence.executionId,
      ) ?? null
    : null;
  const activeExecution =
    allExecutions.find(
      (execution) => execution.executionId === selectedExecutionId,
    ) ?? testExecution;
  const evidenceReady = allExecutions.some((execution) =>
    execution.cases.some((testCase) =>
      testCase.steps.some((step) => Boolean(step.evidence)),
    ),
  );
  const activeProjectView: ProjectView =
    viewMode === "result"
      ? "scenario"
      : viewMode === "test-center"
        ? "test"
        : viewMode === "evidence-library" || viewMode === "evidence-detail"
          ? "evidence"
          : "workspace";

  useEffect(() => {
    if (analysis.status !== "running" || previewMode === "progress") return;

    const timer = window.setInterval(() => {
      setAnalysis((current) => {
        if (current.status !== "running") return current;
        const nextProgress = Math.min(100, current.progress + 2);
        return {
          status: nextProgress === 100 ? "complete" : "running",
          progress: nextProgress,
        };
      });
    }, 260);

    return () => window.clearInterval(timer);
  }, [analysis.status]);

  useEffect(() => {
    if (analysis.status !== "complete" || historyRecorded.current || previewMode) return;
    historyRecorded.current = true;

    const record: GenerationRecord = {
      id: crypto.randomUUID(),
      createdAt: new Intl.DateTimeFormat("ko-KR", {
        year: "numeric",
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(new Date()),
      duration: "00:13",
      factCount: 428,
      wikiPages: 36,
      scenarios: 24,
    };

    setRecords((current) => {
      const nextRecords = [record, ...current];
      if (project) writeStored(historyStorageKey(project), nextRecords);
      return nextRecords;
    });

    if (project) {
      void loadScenarioResult(project, record.id).then((result) => {
        // 실제 Agent Runtime 연결 전에는 새 분석에만 예시 결과를 사용한다.
        setScenarioResult(result ?? createDemoScenarioResult(record.id));
        window.setTimeout(() => setViewMode("result"), 700);
      });
    }
  }, [analysis.status, project]);

  async function handleSelectProject() {
    setSelectionStatus("selecting");
    try {
      const selected = await selectProjectDirectory();
      if (!selected) {
        setSelectionStatus("idle");
        return;
      }
      setProject(selected);
      writeStored(STORAGE.project, selected);
      setRecords(readStored<GenerationRecord[]>(historyStorageKey(selected)) ?? []);
      setAnalysis({ status: "idle", progress: 0 });
      setSelectionStatus("idle");
      setSettingsOpen(true);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setSelectionStatus("idle");
        return;
      }
      setSelectionStatus("error");
    }
  }

  async function handleSaveSettings(nextSettings: ModelSettings, apiKey: string) {
    await saveModelSettings({
      ...nextSettings,
      ...(apiKey ? { apiKey } : {}),
    });
    if (apiKey) setHasSessionApiKey(true);
    setSettings(nextSettings);
    writeStored(STORAGE.model, nextSettings);
    setSettingsOpen(false);
  }

  async function handleStartAnalysis() {
    if (!project) return;
    if (!settings || !hasSessionApiKey) {
      setSettingsOpen(true);
      return;
    }

    historyRecorded.current = false;
    await startProjectAnalysis(project);
    setAnalysis({ status: "running", progress: 1 });
  }

  async function handleOpenRecord(record: GenerationRecord) {
    if (!project) return;
    setViewMode("loading");
    try {
      const result = await loadScenarioResult(project, record.id);
      setScenarioResult(result);
      setViewMode(result ? "result" : "error");
    } catch {
      setScenarioResult(null);
      setViewMode("error");
    }
  }

  function handleProjectNavigation(target: ProjectView) {
    if (target === "workspace") {
      setViewMode("workspace");
      return;
    }
    if (target === "scenario" && scenarioResult) {
      setViewMode("result");
      return;
    }
    if (target === "test" && testExecution) {
      setViewMode("test-center");
      return;
    }
    if (target === "evidence" && evidenceReady) {
      setViewMode("evidence-library");
    }
  }

  function handleExecutionStarted(targetUrl: string, scenarioIds: string[]) {
    if (!scenarioResult) return;
    const execution = {
      ...createDemoTestExecution(
        scenarioResult.runId,
        "running",
        scenarioIds,
        createRendererExecutionId(),
      ),
      targetUrl,
      createdAt: new Date().toISOString(),
    };
    if (testExecution) {
      setExecutionHistory((current) => [testExecution, ...current]);
    }
    setTestExecution(execution);
    setSelectedExecutionId(execution.executionId);
    setSelectedEvidence(null);
    setViewMode("test-center");
  }

  function handleOpenEvidence(evidence: StepEvidence) {
    setSelectedEvidence(evidence);
    setViewMode("evidence-detail");
  }

  function handleOpenScenario(scenarioId: string) {
    if (!scenarioResult) return;
    setFocusedScenarioId(scenarioId);
    setViewMode("result");
  }

  function handleRetry(
    sourceExecution?: TestExecution,
    scenarioIds?: string[],
  ) {
    const executionToRetry = sourceExecution ?? testExecution;
    if (!executionToRetry) return;
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
  }

  function handleSelectExecution(execution: TestExecution) {
    setSelectedExecutionId(execution.executionId);
    setSelectedEvidence(null);
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
      <div
        className={`app-shell${settingsOpen ? " has-modal" : ""}`}
        data-brand="forge"
        aria-hidden={settingsOpen || undefined}
        inert={settingsOpen || undefined}
      >
        <a className="skip-link" href="#main-content">
          본문으로 건너뛰기
        </a>

        {project ? (
          <WorkspaceHeader
            project={project}
            onOpenSettings={() => setSettingsOpen(true)}
            activeView={activeProjectView}
            scenarioReady={Boolean(scenarioResult)}
            executionReady={Boolean(testExecution)}
            evidenceReady={evidenceReady}
            executionRunning={testExecution?.status === "running"}
            onNavigate={handleProjectNavigation}
          />
        ) : (
          <OnboardingHeader />
        )}

        {project && viewMode === "result" && scenarioResult ? (
          <ScenarioResults
            project={project}
            result={scenarioResult}
            initialSelectedIds={
              previewMode === "result-selected"
                ? ["SCN-ORD-001", "SCN-PAY-001"]
                : []
            }
            focusedScenarioId={focusedScenarioId}
            onBack={() => setViewMode("workspace")}
            onExecutionStarted={handleExecutionStarted}
          />
        ) : project && viewMode === "test-center" && activeExecution ? (
          <TestCenter
            execution={activeExecution}
            history={allExecutions.filter(
              (execution) => execution.executionId !== activeExecution.executionId,
            )}
            currentExecutionId={testExecution?.executionId}
            onBackToScenarios={() => setViewMode("result")}
            onOpenScenario={handleOpenScenario}
            onOpenEvidence={handleOpenEvidence}
            onSelectExecution={handleSelectExecution}
            onCancel={handleCancelExecution}
            onRetry={() => handleRetry(activeExecution)}
          />
        ) : project && viewMode === "evidence-library" ? (
          <EvidenceLibrary
            executions={allExecutions}
            onBackToScenarios={() => setViewMode("result")}
            onOpenEvidence={handleOpenEvidence}
          />
        ) : project &&
          viewMode === "evidence-detail" &&
          selectedEvidence &&
          evidenceExecution ? (
          <EvidenceDetail
            execution={evidenceExecution}
            evidence={selectedEvidence}
            onBack={() => handleReturnToExecution(evidenceExecution)}
            onOpenScenario={handleOpenScenario}
            onRetry={() =>
              handleRetry(evidenceExecution, [selectedEvidence.scenarioId])
            }
          />
        ) : project && viewMode === "loading" ? (
          <main className="result-loading" id="main-content" aria-live="polite">
            <span className="eyebrow">LOCAL DATA</span>
            <h1>저장된 결과를 여는 중</h1>
            <p>프로젝트 디렉터리의 시나리오 정보 셋을 읽고 있습니다.</p>
          </main>
        ) : project && viewMode === "error" ? (
          <main className="result-loading" id="main-content" role="alert">
            <span className="eyebrow">LOCAL DATA ERROR</span>
            <h1>저장된 결과를 열 수 없습니다.</h1>
            <p>시나리오 정보 셋이 없거나 형식이 올바르지 않습니다.</p>
            <button
              className="outline-action"
              type="button"
              onClick={() => setViewMode("workspace")}
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
            onStartAnalysis={handleStartAnalysis}
            onOpenSettings={() => setSettingsOpen(true)}
            onOpenRecord={(record) => void handleOpenRecord(record)}
          />
        ) : (
          <Onboarding status={selectionStatus} onSelectProject={handleSelectProject} />
        )}

        <footer className="app-footer">
          <span>통합 테스트 설계, 추측이 아니라 도출.</span>
          <span className="version">DESIGN SYSTEM v1.0</span>
        </footer>
      </div>

      {settingsOpen && (
        <ModelSettingsModal
          initialSettings={settings}
          hasSessionApiKey={hasSessionApiKey}
          onClose={() => setSettingsOpen(false)}
          onSave={handleSaveSettings}
        />
      )}
    </>
  );
}
