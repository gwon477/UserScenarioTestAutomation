import type { AnalysisDataMeasure, ProjectSummary } from "./projects";
import type { RunSummary } from "./runs";
import type { GenerationStep } from "@scenarioforge/contracts";
import type { ScenarioResult } from "./scenario";
import type { HumanReviewView, ReviewCauseTag, ReviewDecision, StepEvidenceView } from "./evidence";
import type { EvidenceLibraryView } from "./evidence-library";
import type { TestExecution } from "./test-execution";
import type { TestExecutionRequirements } from "./test-requirements";

export const IPC_CHANNELS = {
  selectProjectDirectory: "project:select-directory",
  restoreProjectDirectory: "project:restore-directory",
  listProjects: "projects:list",
  listRuns: "runs:list",
  openProject: "projects:open",
  revealProject: "projects:reveal",
  disconnectProject: "projects:disconnect",
  undoDisconnectProject: "projects:undo-disconnect",
  relinkProject: "projects:relink",
  measureAnalysisData: "projects:measure-analysis",
  deleteAnalysisData: "projects:delete-analysis",
  getAnalysisState: "analysis:get-state",
  saveModelSettings: "settings:save-model",
  getModelCredentialStatus: "settings:get-model-credential-status",
  clearModelCredentials: "settings:clear-model-credentials",
  startAnalysis: "analysis:start",
  analysisProgress: "analysis:progress",
  loadScenarioResult: "scenario:load-result",
  askScenarioQuestion: "scenario:ask-question",
  getTestExecutionRequirements: "test:get-requirements",
  listTestExecutions: "test:list-executions",
  runQueuedExecution: "test:run-queued",
  enqueueScenarioTests: "test:enqueue",
  retryScenarioTests: "test:retry",
  cancelScenarioTests: "test:cancel",
  testExecutionProgress: "test:progress",
  readStepEvidence: "evidence:read-step",
  readEvidenceFrame: "evidence:read-frame",
  listStepReviews: "evidence:list-reviews",
  addStepReview: "evidence:add-review",
  listEvidenceLibrary: "evidence:list-library",
  startScenarioTests: "test:start",
} as const;

export type { AnalysisDataMeasure, ProjectSummary } from "./projects";
export type { RunSummary } from "./runs";

export type SelectedDirectory = {
  name: string;
  path?: string;
};

export type ModelRoleSettings = {
  provider: "openai-compatible" | "azure-openai" | "anthropic" | "custom";
  endpoint: string;
  model: string;
  apiVersion?: string;
  dataPolicyAccepted: boolean;
};

export type ModelSettings = ModelRoleSettings & {
  reviewer?: ModelRoleSettings;
};

export type ModelSettingsWithSecret = ModelSettings & {
  apiKey?: string;
  reviewerApiKey?: string;
};

export type ModelCredentialStatus = {
  storageAvailable: boolean;
  hasAuthorCredential: boolean;
  hasReviewerCredential: boolean;
};

export type AnalysisProgressEvent = {
  stage: "src" | "fact" | "wiki" | "scenario";
  progress: number;
  message: string;
  planningStatus?: "started" | "completed";
  step?: GenerationStep;
  stepStatus?: "started" | "completed";
  role?: "deterministic" | "author" | "reviewer" | "repair";
  completedSteps?: number;
  totalSteps?: number;
};

export type AnalysisStartMode = "new" | "continue";
export type AnalysisStage = "src" | "fact" | "wiki" | "scenario";

export type AnalysisStateSummary = {
  analysisRunId: string;
  progress: number;
  nextStage: AnalysisStage | null;
  nextStep: GenerationStep | null;
  canContinue: boolean;
  completed: boolean;
};

export type AnalysisRunSummary = {
  analysisRunId: string;
  stage: "src" | "fact" | "wiki" | "scenario";
  completed: boolean;
  progress: number;
  factCount: number;
  wikiPages: number;
  scenarios: number;
  durationMs: number;
};

export type ScenarioQuestion = {
  project: SelectedDirectory;
  runId: string;
  scenarioIds: string[];
  question: string;
};

export type TestExecutionRequirementsRequest = {
  project: SelectedDirectory;
  runId: string;
  scenarioIds: string[];
  /** 이미 값이 채워진 binding key. 원문 값은 보내지 않는다. */
  providedBindingKeys?: string[];
};

export type TestExecutionRequest = {
  project: SelectedDirectory;
  runId: string;
  /** 멱등 키. 같은 요청의 재전송은 같은 결과를 돌려준다. */
  operationId: string;
  scenarioIds: string[];
  targetUrl: string;
  /** binding key 별 원문 값. main 메모리에만 존재하고 artifact 에 기록되지 않는다. */
  dataBindings: Record<string, string>;
  /** 프레임 전송 전에 가릴 대상. 요구사항이 낸 기본값을 모두 포함해야 한다. */
  maskElementRefs: string[];
  destructiveAllowed: boolean;
};

export type TestExecutionRunRequest = {
  project: SelectedDirectory;
  runId: string;
  executionId: string;
  /** binding key 별 원문 값. 저장되지 않고 실행 중에만 쓰인다. */
  dataBindings: Record<string, string>;
};

export type TestExecutionCommandRequest = {
  project: SelectedDirectory;
  runId: string;
  executionId: string;
};

export type StepEvidenceRequest = {
  project: SelectedDirectory;
  runId: string;
  executionId: string;
  scenarioId: string;
  stepId: string;
};

export type EvidenceFrameRequest = {
  project: SelectedDirectory;
  runId: string;
  executionId: string;
  relativePath: string;
};

export type StepReviewListRequest = StepEvidenceRequest;

export type StepReviewRequest = StepEvidenceRequest & {
  decision: ReviewDecision;
  causeTag?: ReviewCauseTag;
  note: string;
  author: string;
};

export type TestExecutionProgressEvent = {
  executionId: string;
  scenarioId: string;
  stepId: string;
  verdict: string;
};

export type TestExecutionRunResult =
  | { outcome: "completed"; executionId: string; runtimeStatus: "COMPLETED" | "CANCELLED" | "ABORTED" }
  | { outcome: "rejected"; code: string; detail?: string };

/** 실행 명령의 처리 결과. 대기열 등록 event 가 오기 전에는 queued 가 아니다. */
export type TestExecutionAcceptance =
  | { outcome: "queued"; executionId: string; batchId: string }
  | {
      outcome: "rejected";
      stage: "request" | "environment" | "planning";
      code: string;
      detail?: string;
      scenarioIds?: string[];
    };

export type ScenarioForgeDesktopApi = {
  selectProjectDirectory: () => Promise<SelectedDirectory | null>;
  restoreProjectDirectory: () => Promise<SelectedDirectory | null>;
  listProjects: () => Promise<ProjectSummary[]>;
  listRuns: (project: SelectedDirectory) => Promise<RunSummary[]>;
  openProject: (path: string) => Promise<SelectedDirectory | null>;
  revealProject: (path: string) => Promise<boolean>;
  disconnectProject: (path: string) => Promise<boolean>;
  undoDisconnectProject: () => Promise<boolean>;
  relinkProject: (path: string) => Promise<SelectedDirectory | null>;
  measureAnalysisData: (path: string) => Promise<AnalysisDataMeasure | null>;
  deleteAnalysisData: (path: string) => Promise<boolean>;
  getAnalysisState: (project: SelectedDirectory) => Promise<AnalysisStateSummary | null>;
  saveModelSettings: (settings: ModelSettingsWithSecret) => Promise<void>;
  getModelCredentialStatus: (settings: ModelSettings) => Promise<ModelCredentialStatus>;
  clearModelCredentials: () => Promise<void>;
  startAnalysis: (project: SelectedDirectory, mode: AnalysisStartMode) => Promise<AnalysisRunSummary>;
  onAnalysisProgress: (
    listener: (event: AnalysisProgressEvent) => void,
  ) => () => void;
  loadScenarioResult: (
    project: SelectedDirectory,
    runId: string,
  ) => Promise<ScenarioResult | null>;
  askScenarioQuestion: (question: ScenarioQuestion) => Promise<string>;
  getTestExecutionRequirements: (
    request: TestExecutionRequirementsRequest,
  ) => Promise<TestExecutionRequirements | null>;
  startScenarioTests: (request: TestExecutionRequest) => Promise<TestExecutionAcceptance>;
  listTestExecutions: (project: SelectedDirectory, runId?: string) => Promise<TestExecution[]>;
  runQueuedExecution: (request: TestExecutionRunRequest) => Promise<TestExecutionRunResult>;
  enqueueScenarioTests: (request: TestExecutionRequest & { executionId: string }) => Promise<TestExecutionAcceptance>;
  retryScenarioTests: (request: TestExecutionRequest & { retryOfExecutionId: string }) => Promise<TestExecutionAcceptance>;
  cancelScenarioTests: (request: TestExecutionCommandRequest) => Promise<void>;
  onTestExecutionProgress: (listener: (event: TestExecutionProgressEvent) => void) => () => void;
  readStepEvidence: (request: StepEvidenceRequest) => Promise<StepEvidenceView | null>;
  readEvidenceFrame: (request: EvidenceFrameRequest) => Promise<string | null>;
  listStepReviews: (request: StepReviewListRequest) => Promise<HumanReviewView[]>;
  addStepReview: (request: StepReviewRequest) => Promise<HumanReviewView | null>;
  listEvidenceLibrary: (project: SelectedDirectory, runId?: string) => Promise<EvidenceLibraryView | null>;
};
