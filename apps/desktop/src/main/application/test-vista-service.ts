import { BrowserWindow } from "electron";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { FactScreen } from "@scenarioforge/contracts";
import { executionRoot, TestCoordinator, type BatchCase, type BatchResultRecord, type MaskedRegionRecord, type VisionStepEnvelope } from "@scenarioforge/test-runtime";
import { createElectronVisionSurface } from "./electron-vision-surface";
import { runQueuedBatch } from "./test-vista-runner";
import type { VisionModels } from "./test-vista-runner";

/* 대기열에 올라간 실행을 실제로 구동한다.
 *
 * 대상 화면은 이 서비스가 소유하는 별도 BrowserWindow 다. 앱 창을 대상으로
 * 쓰지 않는다. plan 은 정본 batch artifact 에서만 읽고 renderer 가 준 값을
 * 신뢰하지 않는다.
 */

const VIEWPORT = { width: 1440, height: 900 };
/* 진입 화면이 그려지기를 기다린다. loadURL 은 load 이벤트에서 끝나므로 그 뒤에
 * 프레임워크 렌더가 남는다. 기다리지 않으면 첫 프레임이 빈 화면이고 모델은
 * 대상을 찾지 못한다. 환경 준비이며 시나리오 동작이 아니다. */
const ENTRY_READY_TIMEOUT_MS = 10_000;
const ENTRY_SETTLE_MS = 1_200;

const settle = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForEntryReady(window: BrowserWindow, settleMs: number): Promise<void> {
  const deadline = Date.now() + ENTRY_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const ready = await window.webContents
      .executeJavaScript(`(async () => {
        if (document.readyState !== "complete") return false;
        await document.fonts.ready;
        // 첫 화면이 실제로 그려졌는지 본다. 빈 body 는 준비된 것이 아니다.
        return (document.body?.innerText ?? "").trim().length > 0;
      })()`)
      .catch(() => false);
    if (ready === true) break;
    await settle(200);
  }
  await settle(settleMs);
}

type BatchManifest = { schemaVersion: 1; batchId: string; ordinal: number; runtimeStatus?: string };
type RunnerPlan = { schemaVersion: 1; cases: Array<{ scenarioId: string; title: string; steps: VisionStepEnvelope[] }> };
type TargetProfile = { schemaVersion: 1; kind: string; entryUrl: string; maskElementRefs: string[]; destructiveAllowed: boolean };
type ExecutionManifest = { schemaVersion: 1; executionId: string; batches: Array<{ batchId: string; ordinal: number }> };

export type QueuedBatchPlan = {
  batchId: string;
  cases: BatchCase[];
  entryUrl: string;
  maskSelectors: string[];
  maskedRegions: MaskedRegionRecord[];
  destructiveAllowed: boolean;
};

/** 아직 수행되지 않은 첫 batch 를 정본 artifact 에서 읽는다. */
export async function readNextQueuedBatch(
  projectRoot: string,
  runId: string,
  executionId: string,
): Promise<QueuedBatchPlan | null> {
  const directory = executionRoot(projectRoot, runId, executionId);
  const manifest = JSON.parse(await readFile(join(directory, "manifest.json"), "utf8")) as ExecutionManifest;
  if (manifest.schemaVersion !== 1 || manifest.executionId !== executionId) throw new Error("EXECUTION_MANIFEST_INVALID");

  for (const entry of [...manifest.batches].sort((left, right) => left.ordinal - right.ordinal)) {
    const batchDirectory = join(directory, "batches", entry.batchId);
    const batchManifest = JSON.parse(await readFile(join(batchDirectory, "batch-manifest.json"), "utf8")) as BatchManifest;
    if ((batchManifest.runtimeStatus ?? "QUEUED") !== "QUEUED") continue;
    const plan = JSON.parse(await readFile(join(batchDirectory, "runner-plan.json"), "utf8")) as RunnerPlan;
    const profile = JSON.parse(await readFile(join(batchDirectory, "execution-target-profile.json"), "utf8")) as TargetProfile;
    if (profile.kind !== "web") throw new Error("TARGET_KIND_UNSUPPORTED");
    return {
      batchId: entry.batchId,
      cases: plan.cases.map((planCase) => ({ scenarioId: planCase.scenarioId, title: planCase.title, envelopes: planCase.steps })),
      entryUrl: profile.entryUrl,
      maskSelectors: profile.maskElementRefs,
      maskedRegions: profile.maskElementRefs.map((ref) => ({ elementRef: ref, label: ref })),
      destructiveAllowed: profile.destructiveAllowed,
    };
  }
  return null;
}

function assertAllowedEntry(entryUrl: string): URL {
  const url = new URL(entryUrl);
  // target profile 이 허용한 scheme 만 연다. file:// 로 로컬 파일을 읽지 않는다.
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("TARGET_ENTRY_SCHEME_FORBIDDEN");
  return url;
}

export async function runQueuedExecution(input: {
  projectRoot: string;
  runId: string;
  executionId: string;
  screens: readonly FactScreen[];
  values: Readonly<Record<string, string>>;
  models: VisionModels;
  onStep?: (event: { scenarioId: string; stepId: string; verdict: string }) => void;
  /** 중단 요청 확인. step 사이에서만 호출된다. */
  isCancelled?: () => boolean;
  /** 진입 화면 안정화 대기. 기본값은 환경 준비에 충분한 값이다. */
  entrySettleMs?: number;
}): Promise<BatchResultRecord> {
  const plan = await readNextQueuedBatch(input.projectRoot, input.runId, input.executionId);
  if (!plan) throw new Error("NO_QUEUED_BATCH");
  const entry = assertAllowedEntry(plan.entryUrl);

  /* 실행마다 격리된 in-memory session 을 쓴다. `persist:` 접두사가 없으면
   * 창을 닫을 때 사라진다.
   *
   * 앱의 기본 session 을 공유하면 이전 실행이나 사용자가 남긴 로그인 상태가
   * 대상 화면에 남아 시나리오의 진입 전제가 깨진다. 실측에서 실제로 이미
   * 로그인된 화면이 캡처돼 대상을 찾지 못했다. */
  const window = new BrowserWindow({
    width: VIEWPORT.width,
    height: VIEWPORT.height,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      partition: `test-vista-${input.executionId}`,
    },
  });
  window.setContentSize(VIEWPORT.width, VIEWPORT.height);
  // 대상 화면은 선언된 진입점만 연다. 다른 origin 으로의 이동은 막는다.
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    if (new URL(url).origin !== entry.origin) event.preventDefault();
  });

  try {
    await window.loadURL(entry.toString());
    await waitForEntryReady(window, input.entrySettleMs ?? ENTRY_SETTLE_MS);
    const surface = createElectronVisionSurface({
      window,
      viewport: VIEWPORT,
      maskSelectors: plan.maskSelectors,
    });

    return await runQueuedBatch({
      projectRoot: input.projectRoot,
      runId: input.runId,
      executionId: input.executionId,
      batchId: plan.batchId,
      cases: plan.cases,
      screens: input.screens,
      values: input.values,
      maskedRegions: plan.maskedRegions,
      viewport: VIEWPORT,
      surface,
      models: input.models,
      destructiveAllowed: plan.destructiveAllowed,
      ...(input.isCancelled ? { isCancelled: input.isCancelled } : {}),
      ...(input.onStep ? { onStep: input.onStep } : {}),
    });
  } finally {
    if (!window.isDestroyed()) window.destroy();
  }
}

/* 중단 요청 감시. executeBatch 는 step 사이에서 동기 함수로 확인하므로
 * 파일 신호를 주기적으로 읽어 둔다. 실행마다 독립 인스턴스를 쓴다. */
export function watchCancelRequest(input: {
  projectRoot: string;
  runId: string;
  executionId: string;
  intervalMs?: number;
}): { isCancelled: () => boolean; stop: () => void } {
  const coordinator = new TestCoordinator();
  let requested = false;
  const timer = setInterval(() => {
    void coordinator
      .isCancelRequested(input.projectRoot, input.runId, input.executionId)
      .then((value) => {
        requested = value;
      })
      .catch(() => undefined);
  }, input.intervalMs ?? 500);
  return {
    isCancelled: () => requested,
    stop: () => clearInterval(timer),
  };
}
