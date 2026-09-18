/* 제품 경로로 실행한다.
 *
 *   TestCoordinator.createExecution  -> batch artifact
 *   -> runQueuedExecution           -> Electron 표면 + 실제 모델
 *   -> executeBatch                 -> ExecutionWriter
 *   -> loadTestExecutions           -> 화면 투영
 *
 * harness 고유 코드는 fixture 와 자격증명 로딩뿐이다. 실행 로직은 제품 모듈이다.
 * 자격증명은 SCENARIOFORGE_PROBE_MODEL_KEY 또는 safeStorage 캐시에서만 읽는다.
 */
import { app, safeStorage } from "electron";
import { mkdir, readFile } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir, tmpdir } from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { register } from "node:module";

register(new URL("./ts-resolve-hook.mjs", import.meta.url));
const REPO = "/Users/a11769/Desktop/master-project";
const { compileVisionSteps } = await import(`${REPO}/packages/test-runtime/src/planning/vision-step-compiler.ts`);
const { TestCoordinator } = await import(`${REPO}/packages/test-runtime/src/coordination/test-coordinator.ts`);
const { runQueuedExecution } = await import(`${REPO}/apps/desktop/src/main/application/test-vista-service.ts`);
const { createVisionModels, createAzureVisionTransport } = await import(`${REPO}/apps/desktop/src/main/application/vision-model-client.ts`);

app.setName("@scenarioforge/desktop");
app.setPath("userData", join(homedir(), "Library", "Application Support", "@scenarioforge", "desktop"));

const OUT = resolve(process.env.LIVE_RUN_OUT ?? ".");
const FIXTURE_NAME = process.env.LIVE_RUN_FIXTURE ?? "axse";
const MODEL = { endpoint: "https://skax.ai-talentlab.com", modelId: "gpt-5.6-luna", apiVersion: "2024-12-01-preview", provider: "azure-openai" };

const { fixture } = await import(new URL(`./fixture-${FIXTURE_NAME}.mjs`, import.meta.url));

function identity(role) {
  const endpoint = new URL(MODEL.endpoint);
  endpoint.username = ""; endpoint.password = ""; endpoint.search = ""; endpoint.hash = "";
  return createHash("sha256").update(JSON.stringify({ role, provider: MODEL.provider, endpoint: endpoint.toString().replace(/\/$/, ""), apiVersion: MODEL.apiVersion })).digest("hex");
}
async function credential() {
  const injected = process.env.SCENARIOFORGE_PROBE_MODEL_KEY;
  if (injected?.trim()) return injected.trim();
  const document = JSON.parse(await readFile(join(app.getPath("userData"), "model-credentials.v1.json"), "utf8"));
  if (document.author.identity !== identity("author")) throw new Error("MODEL_CREDENTIAL_IDENTITY_MISMATCH");
  return safeStorage.decryptString(Buffer.from(document.author.ciphertext, "base64"));
}

app.whenReady().then(async () => {
  await mkdir(OUT, { recursive: true });
  const key = await credential();

  // 실행 산출물을 남길 임시 프로젝트. 대상 앱 소스에는 아무것도 쓰지 않는다.
  const projectRoot = join(tmpdir(), `sf-live-exec-${randomUUID()}`);
  const runId = "RUN-live-exec";
  await mkdir(join(projectRoot, ".scenarioforge", "runs", runId), { recursive: true });

  const compiled = fixture.scenario.steps.length
    ? compileVisionSteps({
        scenario: fixture.scenario,
        screens: fixture.screens,
        edges: fixture.edges,
        dataBindingKeys: Object.keys(fixture.values),
      })
    : { envelopes: [], nonAutomatable: [] };
  console.log(`[${fixture.name}] compiled ${compiled.envelopes.length} envelopes, ${compiled.nonAutomatable.length} non-automatable`);
  if (compiled.envelopes.length === 0) throw new Error("NOTHING_TO_RUN");

  const queued = await new TestCoordinator().createExecution({
    projectRoot,
    runId,
    projectId: "P-live",
    operationId: randomUUID(),
    sourceSnapshotId: "SS-live",
    scenarioArtifactHash: "live-scenario",
    factArtifactHash: "live-fact",
    target: {
      kind: "web",
      entryUrl: fixture.base,
      maskElementRefs: fixture.maskSelectors,
      destructiveAllowed: false,
    },
    dataBindingKeys: Object.keys(fixture.values).map((bindingKey) => ({ bindingKey, secret: /password|패스워드/i.test(bindingKey) })),
    plans: [{ scenarioId: fixture.scenario.scenario_id, title: fixture.scenario.workflow, envelopes: compiled.envelopes }],
    createdAt: new Date().toISOString(),
  });
  console.log(`queued ${queued.executionId} / ${queued.batchId}`);

  const result = await runQueuedExecution({
    projectRoot,
    runId,
    executionId: queued.executionId,
    screens: fixture.screens,
    values: fixture.values,
    models: createVisionModels({
      binding: { endpoint: MODEL.endpoint, modelId: MODEL.modelId, apiVersion: MODEL.apiVersion },
      transport: createAzureVisionTransport(() => key),
    }),
    onStep: (progress) => console.log(`  step ${progress.stepId}: ${progress.verdict}`),
  });

  /* 요약을 먼저 동기로 남긴다. app.exit 는 stdout 을 flush 하지 않으므로
   * 뒤따르는 로그가 사라져도 기록은 남아야 한다. */
  writeFileSync(
    join(OUT, "live-execution-run.json"),
    `${JSON.stringify(
      {
        probe: "product-path-execution",
        project: fixture.name,
        modelId: MODEL.modelId,
        executionId: queued.executionId,
        batchId: queued.batchId,
        projectRoot,
        result,
      },
      null,
      2,
    )}\n`,
  );

  console.log(`\nruntimeStatus=${result.runtimeStatus}`);
  for (const record of result.cases) {
    console.log(`  case ${record.scenarioId}: ${record.verdict}`);
    for (const step of record.steps) console.log(`    ${step.stepId}: ${step.verdict}${step.reason ? ` (${step.reason.code})` : ""}`);
  }

  /* 화면 투영(loadTestExecutions)은 정본 run 을 요구하므로 여기서는 확인하지 않는다.
   * 그 경로는 tests/e2e/test-execution-requirements.test.ts 가 실제 run 으로 검증한다.
   * 여기서는 실행기가 남긴 정본 결과 파일을 그대로 읽어 확인한다. */
  const persisted = JSON.parse(
    await readFile(join(projectRoot, ".scenarioforge", "runs", runId, "tests", queued.executionId, "execution-result.json"), "utf8"),
  );
  console.log(`persisted runtimeStatus=${persisted.runtimeStatus} verdicts=${JSON.stringify(persisted.verdictCounts)}`);

  app.exit(result.runtimeStatus === "COMPLETED" ? 0 : 1);
}).catch((error) => {
  console.error("LIVE_EXECUTION_FAILED", String(error?.message ?? error));
  app.exit(2);
});
