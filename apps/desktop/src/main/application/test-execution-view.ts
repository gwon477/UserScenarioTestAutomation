import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { executionRoot, testsRoot } from "@scenarioforge/test-runtime";
import { listRunIds } from "./run-inventory";
import type {
  RequiredBinding,
  StepDiagnostics,
  StepReasonCode,
  TestCaseResult,
  TestExecution,
  TestStepStatus,
} from "../../shared/test-execution";
import { loadCanonicalRun } from "./test-requirements-view";

/* 실행 상태를 UI 뷰로 투영한다. renderer 는 실행 객체를 조립하지 않는다.
 *
 * 지금 읽을 수 있는 것은 대기열에 올라간 batch 다. 수행 결과 병합은 실행
 * 커널이 결과를 남긴 뒤에 붙는다. 결과가 없으면 없다고 표시한다.
 */

type ExecutionManifest = {
  schemaVersion: 1;
  executionId: string;
  analysisRunId: string;
  createdAt: string;
  batches: Array<{ batchId: string; ordinal: number; scenarioIds: string[] }>;
};

type BatchManifest = {
  schemaVersion: 1;
  batchId: string;
  runtimeStatus?: TestExecution["status"] | "QUEUED" | "PREPARING" | "RUNNING" | "COMPLETED" | "CANCELLED" | "ABORTED";
};

type RunnerPlan = {
  schemaVersion: 1;
  cases: Array<{ scenarioId: string; title: string; steps: Array<{ stepId: string; actionRef: string }> }>;
};

type TargetProfile = { entryUrl: string };

type DataBindingManifest = { schemaVersion: 1; bindings: RequiredBinding[] };

type StepResult = {
  stepId: string;
  order: number;
  verdict: "PASSED" | "FAILED" | "INCONCLUSIVE" | "SKIPPED" | "CANCELLED";
  reason?: { code: string; detail: string };
};

type CaseResult = {
  schemaVersion: 1;
  scenarioId: string;
  verdict: "PASSED" | "FAILED" | "INCONCLUSIVE" | "CANCELLED";
  steps: StepResult[];
};

type BatchResult = {
  schemaVersion: 1;
  runtimeStatus: "COMPLETED" | "CANCELLED" | "ABORTED";
};

const stepOrderOf = (stepId: string): number => Number(stepId.split("#").at(-1) ?? 0);

const verdictToStatus: Record<StepResult["verdict"], TestStepStatus> = {
  PASSED: "passed",
  FAILED: "failed",
  INCONCLUSIVE: "inconclusive",
  SKIPPED: "skipped",
  CANCELLED: "cancelled",
};

/* 실행기가 남긴 사유 코드를 UI 계약의 코드로 좁힌다.
 * 모르는 코드는 사유 없이 상태만 표시한다. 임의로 문구를 만들지 않는다. */
const REASON_CODES = new Set<StepReasonCode>([
  "TARGET_NOT_FOUND",
  "BUDGET_EXHAUSTED",
  "ACTION_OUTCOME_UNKNOWN",
  "GATE_REJECTED",
  "FRAME_MASKING_FAILED",
  "SCREEN_TEXT_INSTRUCTION_DETECTED",
  "MISSING_DATA_BINDING",
]);

function diagnosticsOf(step: StepResult): StepDiagnostics | undefined {
  if (!step.reason) return undefined;
  if (!REASON_CODES.has(step.reason.code as StepReasonCode)) return undefined;
  return { reason: { code: step.reason.code as StepReasonCode, detail: step.reason.detail } };
}

const caseStatusOf = (verdict: CaseResult["verdict"]): TestStepStatus =>
  verdict === "PASSED" ? "passed" : verdict === "FAILED" ? "failed" : verdict === "CANCELLED" ? "cancelled" : "inconclusive";

async function directorySize(path: string): Promise<number> {
  let total = 0;
  let entries;
  try {
    entries = await readdir(path, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) total += await directorySize(child);
    else total += (await stat(child)).size;
  }
  return total;
}

/* runId 를 주면 그 run 의 실행만, 생략하면 프로젝트 전체 실행을 모은다.
 * 사용자가 보는 단위는 「내가 돌린 테스트 전부」이고 「run X의 테스트」가 아니다.
 * 각 실행은 `scenarioRunId` 로 소속 run 을 드러낸다. */
export async function loadTestExecutions(projectRoot: string, runId?: string): Promise<TestExecution[]> {
  if (runId === undefined) {
    /* run 하나가 정본 검증에 실패해도 나머지 실행 목록을 지우지 않는다. 실패한
     * run 은 「생성 이력」에서 진단한다. 실행 탭이 통째로 비면 사용자는 무엇이
     * 잘못됐는지도 알 수 없다. */
    const perRun = await Promise.all(
      (await listRunIds(projectRoot)).map((id) => loadTestExecutions(projectRoot, id).catch(() => [])),
    );
    return perRun.flat().sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }
  const root = testsRoot(projectRoot, runId);
  let names: string[];
  try {
    names = (await readdir(root, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return [];
  }
  if (names.length === 0) return [];

  const run = await loadCanonicalRun(projectRoot, runId);
  // 사람이 읽는 동작·기대 결과는 정본 시나리오에서만 가져온다. 실행 계획은 참조만 갖는다.
  const displayByStepId = new Map<string, { action: string; expected: string }>();
  for (const scenario of run.scenarioSet.scenarios) {
    for (const step of scenario.steps) {
      displayByStepId.set(`${scenario.scenario_id}#${step.n}`, { action: step.action, expected: step.expected });
    }
  }

  const executions: TestExecution[] = [];
  for (const executionId of names) {
    const directory = executionRoot(projectRoot, runId, executionId);
    let manifest: ExecutionManifest;
    try {
      manifest = JSON.parse(await readFile(join(directory, "manifest.json"), "utf8")) as ExecutionManifest;
    } catch {
      continue;
    }
    if (manifest.schemaVersion !== 1 || manifest.executionId !== executionId) continue;

    /* 결과가 있으면 결과를 쓴다. 없으면 대기열 상태를 그대로 보여준다.
     * renderer 가 진행률을 추정하거나 상태를 채우지 않는다. */
    let batchResult: BatchResult | undefined;
    try {
      batchResult = JSON.parse(await readFile(join(directory, "execution-result.json"), "utf8")) as BatchResult;
    } catch {
      batchResult = undefined;
    }
    const caseResults = new Map<string, CaseResult>();

    const cases: TestCaseResult[] = [];
    const requiredBindings = new Map<string, RequiredBinding>();
    let entryUrl = "";
    let runtimeStatus: BatchManifest["runtimeStatus"] = "QUEUED";
    for (const batch of [...manifest.batches].sort((left, right) => left.ordinal - right.ordinal)) {
      const batchDirectory = join(directory, "batches", batch.batchId);
      try {
        const plan = JSON.parse(await readFile(join(batchDirectory, "runner-plan.json"), "utf8")) as RunnerPlan;
        const profile = JSON.parse(await readFile(join(batchDirectory, "execution-target-profile.json"), "utf8")) as TargetProfile;
        const batchManifest = JSON.parse(await readFile(join(batchDirectory, "batch-manifest.json"), "utf8")) as BatchManifest;
        entryUrl = profile.entryUrl;
        runtimeStatus = batchManifest.runtimeStatus ?? "QUEUED";
        try {
          const bindings = JSON.parse(await readFile(join(batchDirectory, "data-binding-manifest.json"), "utf8")) as DataBindingManifest;
          for (const binding of bindings.bindings) requiredBindings.set(binding.bindingKey, binding);
        } catch {
          // binding manifest 가 없으면 값을 요구하지 않는 batch 다.
        }
        for (const planCase of plan.cases) {
          if (!caseResults.has(planCase.scenarioId)) {
            try {
              const safeId = planCase.scenarioId.replace(/[^A-Za-z0-9_-]/g, "_");
              caseResults.set(
                planCase.scenarioId,
                JSON.parse(await readFile(join(directory, "cases", safeId, "result.json"), "utf8")) as CaseResult,
              );
            } catch {
              // 결과 파일이 없으면 아직 수행되지 않은 케이스다.
            }
          }
          const result = caseResults.get(planCase.scenarioId);
          const stepResults = new Map((result?.steps ?? []).map((step) => [step.stepId, step]));

          cases.push({
            scenarioId: planCase.scenarioId,
            title: planCase.title,
            status: result ? caseStatusOf(result.verdict) : "queued",
            steps: planCase.steps.map((step) => {
              const stepResult = stepResults.get(step.stepId);
              const diagnostics = stepResult ? diagnosticsOf(stepResult) : undefined;
              return {
                order: stepOrderOf(step.stepId),
                action: displayByStepId.get(step.stepId)?.action ?? step.actionRef,
                expected: displayByStepId.get(step.stepId)?.expected ?? "",
                status: stepResult ? verdictToStatus[stepResult.verdict] : "queued",
                ...(diagnostics ? { diagnostics } : {}),
              };
            }),
          });
        }
      } catch {
        continue;
      }
    }
    if (cases.length === 0) continue;

    const status: TestExecution["status"] = batchResult
      ? batchResult.runtimeStatus === "CANCELLED"
        ? "cancelled"
        : batchResult.runtimeStatus === "ABORTED"
          ? "inconclusive"
          : cases.some((entry) => entry.status === "failed")
            ? "failed"
            : cases.some((entry) => entry.status === "inconclusive")
              ? "inconclusive"
              : "passed"
      : runtimeStatus === "QUEUED"
        ? "queued"
        : "preparing";

    executions.push({
      executionId,
      scenarioRunId: runId,
      targetUrl: entryUrl,
      status,
      createdAt: manifest.createdAt,
      cases,
      evidenceBytes: await directorySize(join(directory, "cases")),
      ...(requiredBindings.size > 0 ? { requiredBindings: [...requiredBindings.values()] } : {}),
    });
  }

  return executions.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}
