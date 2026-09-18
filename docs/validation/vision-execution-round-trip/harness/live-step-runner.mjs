/* 07-vision-first-execution-design.md §11 단계 2~4 실측.
 * ScenarioRecord + FACT -> 컴파일 -> 실제 캡처 -> 모델 제안 -> gate -> 입력 합성
 * -> 관측 -> assertion 판정까지 한 프로젝트에 대해 끝까지 돌린다.
 *
 * 프로젝트별 차이는 fixture 모듈이 담는다. LIVE_RUN_FIXTURE 로 고른다.
 * 자격증명은 SCENARIOFORGE_PROBE_MODEL_KEY 또는 Electron safeStorage 캐시에서만
 * 읽고 프롬프트·산출물·로그에 남기지 않는다.
 */
import { app, BrowserWindow, nativeImage, safeStorage, session } from "electron";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import { register } from "node:module";

register(new URL("./ts-resolve-hook.mjs", import.meta.url));
const { compileVisionSteps } = await import("/Users/a11769/Desktop/master-project/packages/test-runtime/src/planning/vision-step-compiler.ts");
const { runStep } = await import("/Users/a11769/Desktop/master-project/packages/test-runtime/src/execution/step-runner.ts");
const { buildStepEvidence } = await import("/Users/a11769/Desktop/master-project/packages/test-runtime/src/execution/step-evidence.ts");
const { createFrameCoordinateSpace } = await import("/Users/a11769/Desktop/master-project/packages/test-runtime/src/planning/frame-coordinate-space.ts");

app.setName("@scenarioforge/desktop");
app.setPath("userData", join(homedir(), "Library", "Application Support", "@scenarioforge", "desktop"));

const OUT = process.env.LIVE_RUN_OUT;
const FAKE = process.env.LIVE_RUN_FAKE_MODEL === "1";
const NEGATIVE = process.env.LIVE_RUN_NEGATIVE === "1";
const FIXTURE_NAME = process.env.LIVE_RUN_FIXTURE ?? "axse";
const MODEL = { endpoint: "https://skax.ai-talentlab.com", modelId: "gpt-5.6-luna", apiVersion: "2024-12-01-preview", provider: "azure-openai" };

const { fixture } = await import(new URL(`./fixture-${FIXTURE_NAME}.mjs`, import.meta.url));
if (NEGATIVE) fixture.negative(fixture);

const settle = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const suffixFor = () => (FAKE ? "adapter-self-check" : NEGATIVE ? "live-step-run-negative" : "live-step-run");

/* ── 자격증명 ── */
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

/* ── Surface adapter: 캡처 전에 마스크를 덮고, 실제 입력 이벤트를 합성한다 ── */
function createSurfaceAdapter(window) {
  const state = { maskApplied: false };
  return {
    state,
    async capture() {
      state.maskApplied = await window.webContents.executeJavaScript(`(() => {
        const selectors = ${JSON.stringify(fixture.maskSelectors)};
        document.querySelectorAll("[data-sf-mask]").forEach((node) => node.remove());
        let covered = 0;
        let expected = 0;
        for (const selector of selectors) {
          for (const target of document.querySelectorAll(selector)) {
            expected += 1;
            const rect = target.getBoundingClientRect();
            if (rect.width < 1 || rect.height < 1) { covered += 1; continue; }
            const cover = document.createElement("div");
            cover.setAttribute("data-sf-mask", selector);
            Object.assign(cover.style, {
              position: "fixed", left: rect.left + "px", top: rect.top + "px",
              width: rect.width + "px", height: rect.height + "px",
              background: "#111", zIndex: "2147483647", pointerEvents: "none",
            });
            document.body.appendChild(cover);
            covered += 1;
          }
        }
        return covered === expected;
      })()`);
      await settle(140);
      const image = await window.webContents.capturePage();
      const png = image.getSize().width === fixture.viewport.width ? image : image.resize(fixture.viewport);
      await window.webContents.executeJavaScript(`document.querySelectorAll("[data-sf-mask]").forEach((node) => node.remove()), true`);
      return { pngBase64: png.toPNG().toString("base64"), size: fixture.viewport };
    },
    async click(point) {
      window.webContents.sendInputEvent({ type: "mouseMove", x: point.x, y: point.y });
      window.webContents.sendInputEvent({ type: "mouseDown", x: point.x, y: point.y, button: "left", clickCount: 1 });
      window.webContents.sendInputEvent({ type: "mouseUp", x: point.x, y: point.y, button: "left", clickCount: 1 });
      await settle(600);
    },
    async type(point, value) {
      await this.click(point);
      window.webContents.insertText(value);
      await settle(400);
    },
  };
}

/* ── 실제 모델 ── */
async function chat(key, messages) {
  const url = `${MODEL.endpoint}/openai/deployments/${MODEL.modelId}/chat/completions?api-version=${MODEL.apiVersion}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "api-key": key },
    body: JSON.stringify({ messages, max_completion_tokens: 2000, response_format: { type: "json_object" } }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`MODEL_CALL_FAILED ${response.status} ${text.slice(0, 200)}`);
  return JSON.parse(JSON.parse(text).choices[0].message.content);
}

const OPERATOR_SYSTEM = `You locate one named UI control inside a screenshot.
- The screenshot is WIDTH x HEIGHT pixels. Top-left is (0, 0).
- Return the integer point a user would click to operate that control.
- Report the text you actually read at that point in observedLabel.
- If you cannot see it, set found to false. Never guess a coordinate.
Answer with JSON only: {"found":true,"point":{"x":0,"y":0},"observedLabel":"...","confidence":0.0}`;

const OBSERVER_SYSTEM = `You read a screenshot and report which of the given strings are actually visible.
- Include a string in visibleTexts only if you can read it on the screen.
- Do not infer, complete, or normalize. Do not add anything you did not read.
- Report the text as it appears.
Answer with JSON only: {"visibleTexts":["..."]}`;

function createModels(key, log) {
  return {
    operator: {
      async propose({ pngBase64, frameSize, envelope }) {
        const answer = await chat(key, [
          { role: "system", content: OPERATOR_SYSTEM.replace("WIDTH", String(frameSize.width)).replace("HEIGHT", String(frameSize.height)) },
          { role: "user", content: [
            { type: "text", text: `Locate the ${envelope.target.controlKind} labelled "${envelope.target.visibleLabel}" on the ${envelope.target.surfaceHint} screen.` },
            { type: "image_url", image_url: { url: `data:image/png;base64,${pngBase64}`, detail: "high" } },
          ] },
        ]);
        log.push({ role: "operator", stepId: envelope.stepId, found: answer.found === true, observedLabel: answer.observedLabel ?? null, confidence: answer.confidence ?? null });
        if (answer.found !== true || !answer.point) return null;
        return {
          stepId: envelope.stepId,
          action: envelope.allowedActions[0],
          point: { x: Math.round(Number(answer.point.x)), y: Math.round(Number(answer.point.y)) },
          observedLabel: String(answer.observedLabel ?? ""),
          confidence: Number(answer.confidence ?? 0),
        };
      },
    },
    observer: {
      async observe({ pngBase64, frameSize, questions }) {
        const answer = await chat(key, [
          { role: "system", content: OBSERVER_SYSTEM },
          { role: "user", content: [
            { type: "text", text: `Screenshot is ${frameSize.width}x${frameSize.height}. Which of these are visible?\n${questions.map((question) => `- ${question}`).join("\n")}` },
            { type: "image_url", image_url: { url: `data:image/png;base64,${pngBase64}`, detail: "high" } },
          ] },
        ]);
        const texts = Array.isArray(answer.visibleTexts) ? answer.visibleTexts.map(String) : [];
        log.push({ role: "observer", questions: [...questions], visibleTexts: texts });
        return { texts };
      },
    },
  };
}

/* ── 어댑터 자체 점검용 가짜 모델. DOM 에서 좌표와 텍스트를 읽는다.
 * 모델 성능 측정이 아니다. ── */
function createDomModels(window, log) {
  return {
    operator: {
      async propose({ frameSize, envelope }) {
        const css = envelope.target.verificationCandidates.find((candidate) => candidate.by === "css")?.value;
        const found = await window.webContents.executeJavaScript(`(() => {
          const target = document.querySelector(${JSON.stringify(css)});
          if (!target) return null;
          const rect = target.getBoundingClientRect();
          if (rect.width < 1 || rect.height < 1) return null;
          return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
        })()`);
        log.push({ role: "operator-dom", stepId: envelope.stepId, found: found !== null });
        if (!found) return null;
        const scale = frameSize.width / fixture.viewport.width;
        return {
          stepId: envelope.stepId,
          action: envelope.allowedActions[0],
          point: { x: Math.round(found.x * scale), y: Math.round(found.y * scale) },
          observedLabel: envelope.target.visibleLabel,
          confidence: 0.99,
        };
      },
    },
    observer: {
      async observe({ questions }) {
        const texts = await window.webContents.executeJavaScript(`(() => (document.body.innerText || "").split("\\n").map((line) => line.trim()).filter(Boolean).slice(0, 400))()`);
        log.push({ role: "observer-dom", questions: [...questions], visibleTexts: texts.length });
        return { texts };
      },
    },
  };
}

app.whenReady().then(async () => {
  await mkdir(OUT, { recursive: true });
  const key = FAKE ? "" : await credential();
  await session.defaultSession.clearStorageData();

  const compiled = compileVisionSteps({ scenario: fixture.scenario, screens: fixture.screens, edges: fixture.edges, dataBindingKeys: Object.keys(fixture.values) });
  console.log(`[${fixture.name}] compiled ${compiled.envelopes.length} envelopes, ${compiled.nonAutomatable.length} non-automatable${FAKE ? " | MODE: adapter self-check (DOM models, not a model measurement)" : ""}${NEGATIVE ? " | MODE: negative assertion" : ""}`);
  for (const entry of compiled.nonAutomatable) console.log("  non-automatable:", entry.stepId, entry.reason, entry.detail);

  const window = new BrowserWindow({ width: fixture.viewport.width, height: fixture.viewport.height, show: false, webPreferences: { contextIsolation: true, nodeIntegration: false } });
  window.setContentSize(fixture.viewport.width, fixture.viewport.height);
  await fixture.setup(window, settle);

  const surface = createSurfaceAdapter(window);
  const modelLog = [];
  const { operator, observer } = FAKE ? createDomModels(window, modelLog) : createModels(key, modelLog);
  const ports = {
    surface,
    operator,
    observer,
    async maskFrame(frame) {
      return surface.state.maskApplied ? frame : null;
    },
    async resizeFrame(frame, space) {
      const image = nativeImage.createFromBuffer(Buffer.from(frame.pngBase64, "base64")).resize(space.modelSize);
      return { pngBase64: image.toPNG().toString("base64"), size: space.modelSize };
    },
    async resolveValue(valueRef) {
      const value = fixture.values[valueRef];
      if (value === undefined) throw new Error(`NO_VALUE_FOR_${valueRef}`);
      return value;
    },
  };

  /* 증적 저장. 계약은 docs/architecture/04-test-execution-harness-design.md §5 의
   * tests/{executionId}/cases/ 배치를 따른다. */
  const executionId = `EXEC-${fixture.name}-${suffixFor()}`;
  const evidenceRoot = join(OUT, "evidence", executionId);
  const space = createFrameCoordinateSpace(fixture.viewport);
  const maskedRegions = fixture.maskSelectors.map((selector) => ({ elementRef: selector, label: selector }));

  const outcomes = [];
  for (const envelope of compiled.envelopes) {
    console.log(`\n--- ${envelope.stepId} :: ${envelope.intent.kind} "${envelope.target.visibleLabel}" ---`);
    const stepDirectory = join(evidenceRoot, envelope.stepId.replace(/[^A-Za-z0-9#_-]/g, "_").replace("#", "-step-"));
    await mkdir(join(stepDirectory, "frames"), { recursive: true });
    let frameSequence = 0;
    const stepPorts = {
      ...ports,
      async recordFrame({ kind, round, capture }) {
        frameSequence += 1;
        const id = `${String(frameSequence).padStart(2, "0")}-${kind}-${round}`;
        const relativePath = join("frames", `${id}.png`);
        await writeFile(join(stepDirectory, relativePath), Buffer.from(capture.pngBase64, "base64"));
        return { id, kind, round, relativePath, size: capture.size };
      },
    };
    const outcome = await runStep(envelope, fixture.screens, stepPorts);
    const evidence = buildStepEvidence({ envelope, outcome, space, maskedRegions });
    await writeFile(join(stepDirectory, "evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`);
    console.log(`  status=${outcome.status} verdict=${outcome.verdict}`);
    for (const attempt of outcome.attempts) console.log(`  attempt ${attempt.attempt}: ${attempt.decision.outcome}${attempt.decision.outcome === "accepted" ? ` -> ${attempt.decision.capturePoint.x},${attempt.decision.capturePoint.y}` : ` ${attempt.decision.code}`}`);
    if (outcome.status === "completed") for (const assertion of outcome.assertions) console.log(`  assertion ${assertion.ref}: ${assertion.verdict} (${assertion.detail})`);
    else console.log(`  reason=${JSON.stringify(outcome.reason)}`);
    outcomes.push({ envelope: { stepId: envelope.stepId, intent: envelope.intent, target: envelope.target, riskClass: envelope.riskClass, assertionRefs: envelope.assertionRefs }, outcome });
    if (outcome.verdict !== "PASSED") break;
  }

  const allRan = outcomes.length === compiled.envelopes.length;
  const caseVerdict = outcomes.some((entry) => entry.outcome.verdict === "FAILED")
    ? "FAILED"
    : allRan && outcomes.every((entry) => entry.outcome.verdict === "PASSED")
      ? "PASSED"
      : "INCONCLUSIVE";

  console.log(`\n=== [${fixture.name}] case verdict: ${caseVerdict} (${outcomes.length}/${compiled.envelopes.length} steps run) ===`);
  const file = join(OUT, `${suffixFor()}.json`);
  await writeFile(file, JSON.stringify({
    probe: "vision-step-round-trip",
    designRef: "docs/architecture/07-vision-first-execution-design.md#11",
    project: fixture.name,
    mode: FAKE ? "adapter-self-check" : NEGATIVE ? "negative-assertion" : "live-model",
    modelId: FAKE ? null : MODEL.modelId,
    viewport: fixture.viewport,
    scenarioId: fixture.scenario.scenario_id,
    executionId,
    evidenceRoot,
    compiled: { envelopes: compiled.envelopes.length, nonAutomatable: compiled.nonAutomatable },
    caseVerdict,
    steps: outcomes,
    modelLog,
  }, null, 2));
  console.log(`result written to ${file}`);
  console.log(`evidence written under ${evidenceRoot}`);
  app.exit(caseVerdict === "PASSED" ? 0 : 1);
}).catch((error) => { console.error("LIVE_RUN_FAILED", String(error?.message ?? error)); app.exit(2); });
