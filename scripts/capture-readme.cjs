/* README 화면 캡처.
 *
 * fixture preview 창은 앱의 mainWindow 가 아니므로 `assertTrustedSender` 가 그
 * 창의 IPC 를 거절한다. 정상 동작이고, 그래서 정본 산출물을 읽는 화면(테스트
 * 수행 설정)은 요구사항이 빈 상태로 찍힌다. README 가 그 상태를 그대로 설명한다.
 *
 * 두 갈래로 찍는다:
 *  - fixture preview: 빌드된 renderer 를 직접 열어 `?preview=` 모드를 찍는다.
 *    dev 서버가 필요 없다.
 *  - 실앱: 제품 main 을 그대로 띄워 프로젝트 목록·탭이 있는 화면을 찍는다.
 *    임시 userData 와 임시 프로젝트만 쓰고 사용자 디렉터리는 건드리지 않는다.
 *
 * 먼저 `npm run build` 로 renderer 와 main 을 빌드해야 한다.
 *
 * 사용법: npm run capture:readme
 */
const { app, BrowserWindow } = require("electron");
const { mkdirSync, mkdtempSync, writeFileSync, rmSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { tmpdir } = require("node:os");

const REPO = resolve(__dirname, "..");
const RENDERER = join(REPO, "apps/desktop/out/renderer/index.html");
const MAIN = join(REPO, "apps/desktop/out/main/index.js");
const OUT = join(REPO, "artifacts");
const VIEWPORT = { width: 1440, height: 1024 };
/* 캡처에 찍혀도 무해한 짧은 경로. 스크린샷에 사용자 식별자를 남기지 않는다. */
const TMP_ROOT = process.platform === "win32" ? join(tmpdir(), "scenarioforge-readme") : "/private/tmp/scenarioforge-readme";

/* 캡처마다 어떤 상태를 찍는지. `click` 은 캡처 전에 눌러야 하는 컨트롤이다. */
const FIXTURE_SHOTS = [
  { preview: null, file: "electron-onboarding.png", expect: "소스 디렉터리 선택" },
  { preview: "modal", file: "screen-modal.png", expect: "LLM 연결 설정" },
  { preview: "progress", file: "screen-progress.png", expect: "단계 수행 중" },
  { preview: "result", file: "screen-result-aligned.png", expect: "사용자 시나리오" },
  {
    preview: "result-selected",
    file: "screen-result-selected.png",
    // 설정 드로어는 선택만으로 열리지 않는다. 케이스를 고르는 동안 시트를 가리지 않기 위해서다.
    click: ".panel-f .btn.pri",
    expect: "테스트 수행 설정",
  },
  { preview: "test-running", file: "screen-test-running.png", expect: "테스트 수행" },
  { preview: "test-failed", file: "screen-executions.png", clickTab: 2, expect: "테스트 실행" },
  { preview: "evidence-failure", file: "screen-test-failure-evidence.png", expect: "증적 상세" },
];

const APP_SHOTS = [
  { file: "screen-projects.png", expect: "프로젝트" },
  { file: "screen-workspace.png", clickCard: true, expect: "단계를 실행합니다" },
  { file: "screen-runs.png", clickTab: 1, expect: "생성 이력" },
  /* 증적 목록은 정본 실행 트리가 있어야 필터와 원인 태그 집계가 나온다.
   * fixture 경로에서는 실행 단위 목록만 보여 README 설명과 어긋난다. */
  { file: "screen-evidence-library.png", clickTab: 3, expect: "저장된 증적" },
];

const settle = (ms) => new Promise((done) => setTimeout(done, ms));

async function paint(window) {
  await window.webContents.executeJavaScript("document.fonts.ready");
  await window.webContents.executeJavaScript(
    "new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))",
  );
  await settle(350);
}

async function click(window, selector, index = 0) {
  const hit = await window.webContents.executeJavaScript(`(() => {
    const node = [...document.querySelectorAll(${JSON.stringify(selector)})][${index}];
    if (!node) return false;
    node.click();
    return true;
  })()`);
  if (!hit) throw new Error(`control not found: ${selector}[${index}]`);
  await settle(700);
}

/** 화면이 기대한 내용을 실제로 그렸는지 확인한 뒤에만 저장한다. */
async function save(window, file, expect) {
  await paint(window);
  const text = await window.webContents.executeJavaScript(
    "document.getElementById('root')?.textContent ?? ''",
  );
  if (!text.includes(expect)) throw new Error(`${file}: expected text not rendered: ${expect}`);
  const image = await window.webContents.capturePage();
  const size = image.getSize();
  const output =
    size.width > VIEWPORT.width
      ? image.resize({ width: VIEWPORT.width, height: Math.round((size.height * VIEWPORT.width) / size.width) })
      : image;
  writeFileSync(join(OUT, file), output.toPNG());
  console.log(`  ${file}`);
}

/* 실앱 캡처용 임시 프로젝트. 증적이 있는 프로젝트 하나와 분석 전 프로젝트 하나. */
function seedWorkspace() {
  /* 경로가 캡처에 그대로 찍힌다. `tmpdir()` 은 macOS 에서 사용자 고유
   * 식별자가 들어간 난수 경로라 공개 README 스크린샷에 넣지 않는다. */
  const workspace = join(TMP_ROOT, "workspace");
  rmSync(workspace, { recursive: true, force: true });
  const withRuns = join(workspace, "commerce-platform");
  const withoutRuns = join(workspace, "ra-dar");
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==",
    "base64",
  );

  mkdirSync(join(withoutRuns, "src"), { recursive: true });
  mkdirSync(join(withRuns, "src"), { recursive: true });

  const runId = "RUN-9f1c2e4a";
  const runRoot = join(withRuns, ".scenarioforge", "runs", runId);
  mkdirSync(join(runRoot, "facts"), { recursive: true });
  writeFileSync(
    join(runRoot, "scenario-set.json"),
    JSON.stringify({ scenarios: Array.from({ length: 24 }, (_v, i) => ({ scenario_id: `SCN-${i}` })) }),
  );
  writeFileSync(
    join(runRoot, "facts", `FACT-${runId}.json`),
    JSON.stringify({ screens: Array(40).fill({}), edges: Array(50).fill({}), predicates: Array(6).fill({}) }),
  );
  writeFileSync(join(runRoot, "wiki-bundle.json"), JSON.stringify({ workflows: Array(36).fill({}) }));
  writeFileSync(
    join(runRoot, "manifest.json"),
    JSON.stringify({
      schema_version: 2,
      analysis_run_id: runId,
      created_at: "2026-09-07T06:42:00.000Z",
      final_revision: 12,
      artifacts: [
        { artifact_id: `SCENARIOS-${runId}`, artifact_type: "scenario-set", content_hash: "h" },
        { artifact_id: `FACT-${runId}`, artifact_type: "fact-bundle", content_hash: "h" },
        { artifact_id: `WIKI-${runId}`, artifact_type: "wiki-bundle", content_hash: "h" },
      ],
    }),
  );

  for (const [order, verdict] of [[1, "PASSED"], [2, "PASSED"], [3, "INCONCLUSIVE"]]) {
    const step = join(
      runRoot,
      "tests",
      "EXE-20260907-0006",
      "cases",
      "SCN-CHECKOUT-001",
      `SCN-CHECKOUT-001-step-${order}`,
    );
    mkdirSync(join(step, "frames"), { recursive: true });
    for (const frame of ["model-input-1", "after-action-1", "after-action-2"]) {
      writeFileSync(join(step, "frames", `${frame}.png`), png);
    }
    writeFileSync(
      join(step, "evidence.json"),
      JSON.stringify({
        schemaVersion: 1,
        stepId: `SCN-CHECKOUT-001#${order}`,
        verdict,
        ...(verdict === "INCONCLUSIVE"
          ? { reason: { code: "ACTION_OUTCOME_UNKNOWN", detail: "기대 결과가 관찰되지 않았습니다" } }
          : {}),
        frameSpace: { captureSize: { width: 1440, height: 900 }, modelSize: { width: 1229, height: 768 }, scale: 0.8533 },
        maskedRegions: [],
        attempts: [{ attempt: 1, outcome: "accepted" }],
        assertions: [],
        observations: 2,
        frames: [],
      }),
    );
  }
  writeFileSync(
    join(runRoot, "tests", "EXE-20260907-0006", "manifest.json"),
    JSON.stringify({ schemaVersion: 1, executionId: "EXE-20260907-0006", createdAt: "2026-09-07T07:10:00.000Z" }),
  );

  return { workspace, projects: [withRuns, withoutRuns] };
}

async function captureFixtures() {
  const window = new BrowserWindow({
    ...VIEWPORT,
    show: false,
    webPreferences: {
      preload: join(REPO, "apps/desktop/out/preload/index.cjs"),
      contextIsolation: true,
      sandbox: true,
    },
  });
  console.log("fixture preview:");
  for (const shot of FIXTURE_SHOTS) {
    await window.loadFile(RENDERER, shot.preview ? { query: { preview: shot.preview } } : {});
    await settle(900);
    if (shot.clickTab !== undefined) await click(window, ".tabs button", shot.clickTab);
    if (shot.click) await click(window, shot.click);
    await save(window, shot.file, shot.expect);
  }
  window.destroy();
}

async function captureApp(seed) {
  console.log("real app:");
  let window;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    [window] = BrowserWindow.getAllWindows();
    if (window && !window.webContents.isLoading()) break;
    await settle(100);
  }
  if (!window) throw new Error("app window was not created");
  window.setSize(VIEWPORT.width, VIEWPORT.height);
  await settle(1500);
  // 복원된 프로젝트가 있으면 개요로 열리므로 스위처로 목록으로 간다.
  await click(window, ".switcher");
  for (const shot of APP_SHOTS) {
    if (shot.clickCard) await click(window, ".pcard .cta-row.foot .btn");
    if (shot.clickTab !== undefined) await click(window, ".tabs button", shot.clickTab);
    await save(window, shot.file, shot.expect);
  }
  rmSync(seed.workspace, { recursive: true, force: true });
}

const seed = seedWorkspace();
const userData = mkdtempSync(join(tmpdir(), "scenarioforge-readme-userdata-"));
app.setName("@scenarioforge/desktop");
app.setPath("userData", userData);
writeFileSync(
  join(userData, "project-directory.v1.json"),
  JSON.stringify({
    schemaVersion: 2,
    projects: [
      { path: seed.projects[0], addedAt: "2026-09-01T00:00:00.000Z", lastOpenedAt: "2026-09-07T06:00:00.000Z" },
      { path: seed.projects[1], addedAt: "2026-09-03T00:00:00.000Z" },
    ],
  }),
);
mkdirSync(OUT, { recursive: true });
require(MAIN);

app
  .whenReady()
  .then(async () => {
    await captureFixtures();
    await captureApp(seed);
    rmSync(userData, { recursive: true, force: true });
    console.log("done");
    app.exit(0);
  })
  .catch((error) => {
    console.error("CAPTURE_FAILED", String(error?.message ?? error));
    rmSync(seed.workspace, { recursive: true, force: true });
    rmSync(userData, { recursive: true, force: true });
    app.exit(1);
  });
