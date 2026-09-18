// 07-vision-first-execution-design.md §11 단계 1 실측:
// 배포된 GPT 계열 모델이 이미지 입력을 받는지, 좌표 출력 정확도가 얼마인지.
import { app, nativeImage, safeStorage } from "electron";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

app.setName("@scenarioforge/desktop");
app.setPath("userData", join(homedir(), "Library", "Application Support", "@scenarioforge", "desktop"));

const MODEL_SETTINGS = {
  provider: "azure-openai",
  endpoint: "https://skax.ai-talentlab.com",
  model: "gpt-5.6-luna",
  modelId: "gpt-5.6-luna",
  api: "azure-openai-chat-completions",
  apiVersion: "2024-12-01-preview",
  dataPolicyAccepted: true,
};

const CAPTURE_DIR = process.env.GROUNDING_CAPTURE_DIR;
const RESULT_PATH = process.env.GROUNDING_RESULT_PATH;
const PROJECT_LABEL = process.env.GROUNDING_PROJECT ?? "unknown";
const TARGETS_PER_SCREEN = Number(process.env.GROUNDING_TARGETS ?? 6);
// 모델 전처리 좌표계 가설 검증용. 설정하면 짧은 변을 이 값으로 맞춰 보내고
// ground truth도 같은 배율로 환산해 같은 좌표계에서 비교한다.
const SHORT_SIDE = process.env.GROUNDING_SHORT_SIDE ? Number(process.env.GROUNDING_SHORT_SIDE) : null;

function rescaleScreen(screen, imageBuffer) {
  if (!SHORT_SIDE) return { screen, imageBuffer, scale: 1 };
  const { width, height } = screen.viewport;
  const scale = SHORT_SIDE / Math.min(width, height);
  const target = { width: Math.round(width * scale), height: Math.round(height * scale) };
  const resized = nativeImage.createFromBuffer(imageBuffer).resize(target);
  const map = (value) => Math.round(value * scale);
  return {
    scale,
    imageBuffer: resized.toPNG(),
    screen: {
      ...screen,
      viewport: target,
      elements: (screen.elements ?? []).map((element) => ({
        ...element,
        rect: { x: map(element.rect.x), y: map(element.rect.y), width: map(element.rect.width), height: map(element.rect.height) },
        center: { x: map(element.center.x), y: map(element.center.y) },
      })),
    },
  };
}

function credentialIdentity(role, settings) {
  const endpoint = new URL(settings.endpoint);
  endpoint.username = "";
  endpoint.password = "";
  endpoint.search = "";
  endpoint.hash = "";
  const identity = JSON.stringify({
    role,
    provider: settings.provider,
    endpoint: endpoint.toString().replace(/\/$/, ""),
    ...(settings.provider === "azure-openai" ? { apiVersion: settings.apiVersion ?? "" } : {}),
  });
  return createHash("sha256").update(identity).digest("hex");
}

async function loadCachedCredential() {
  // 환경변수로 전달된 키를 우선한다. 값은 어디에도 기록하지 않는다.
  const injected = process.env.SCENARIOFORGE_PROBE_MODEL_KEY;
  if (injected && injected.trim()) return injected.trim();
  if (!safeStorage.isEncryptionAvailable()) throw new Error("MODEL_CREDENTIAL_STORAGE_UNAVAILABLE");
  const candidates = [
    join(app.getPath("userData"), "model-credentials.v1.json"),
    join(app.getPath("appData"), "@scenarioforge", "desktop", "model-credentials.v1.json"),
  ];
  const expected = credentialIdentity("author", MODEL_SETTINGS);
  for (const path of candidates) {
    let encoded;
    try {
      encoded = await readFile(path, "utf8");
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw new Error("MODEL_CREDENTIAL_CACHE_READ_FAILED");
    }
    const document = JSON.parse(encoded);
    if (document?.schemaVersion !== 1 || typeof document?.author?.ciphertext !== "string") continue;
    if (document.author.identity !== expected) {
      console.error("credential record identity did not match expected author identity");
      continue;
    }
    const credential = safeStorage.decryptString(Buffer.from(document.author.ciphertext, "base64"));
    if (credential.trim()) return credential;
  }
  throw new Error("MODEL_CREDENTIAL_NOT_AVAILABLE");
}

const SYSTEM_PROMPT = `You locate a single named UI control inside one screenshot of a desktop web application.

Rules:
- The screenshot is exactly WIDTH x HEIGHT CSS pixels. The top-left pixel is (0, 0).
- For each requested target, return the integer coordinate of the point a user would click to operate that control.
- Report the text you actually read at that point in observedLabel. Do not copy the requested label if you cannot read it on the screen.
- If you cannot find the target, set found to false. Never guess a coordinate for a target you cannot see.
- Answer with JSON only. No prose, no markdown fence.`;

function userPrompt(screen, targets) {
  return `Screenshot: ${screen.description} (${screen.viewport.width} x ${screen.viewport.height} CSS pixels).

Locate these targets:
${targets.map((target) => `- ${target.targetId}: ${target.controlKind} labelled "${target.visibleLabel}"`).join("\n")}

Return exactly:
{"results":[{"targetId":"...","found":true,"point":{"x":0,"y":0},"observedLabel":"...","confidence":0.0}]}`;
}

function pickTargets(screen) {
  const usable = (screen.elements ?? []).filter((element) => {
    const label = element.label.trim();
    if (label.length < 2 || label.length > 30) return false;
    if (/^[=⌄↺⏏]+$/.test(label)) return false;
    return element.rect.width >= 24 && element.rect.height >= 18;
  });
  const spread = [];
  const step = Math.max(1, Math.floor(usable.length / TARGETS_PER_SCREEN));
  for (let index = 0; index < usable.length && spread.length < TARGETS_PER_SCREEN; index += step) spread.push(usable[index]);
  return spread.map((element, index) => ({
    targetId: `T${index + 1}`,
    visibleLabel: element.label,
    controlKind: element.controlKind,
    truthRect: element.rect,
    truthCenter: element.center,
  }));
}

async function callModel(credential, screen, targets, imageBase64) {
  const url = `${MODEL_SETTINGS.endpoint}/openai/deployments/${MODEL_SETTINGS.modelId}/chat/completions?api-version=${MODEL_SETTINGS.apiVersion}`;
  const body = {
    messages: [
      { role: "system", content: SYSTEM_PROMPT.replace("WIDTH", String(screen.viewport.width)).replace("HEIGHT", String(screen.viewport.height)) },
      {
        role: "user",
        content: [
          { type: "text", text: userPrompt(screen, targets) },
          { type: "image_url", image_url: { url: `data:image/png;base64,${imageBase64}`, detail: "high" } },
        ],
      },
    ],
    max_completion_tokens: 4000,
    response_format: { type: "json_object" },
  };
  const started = Date.now();
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "api-key": credential },
    body: JSON.stringify(body),
  });
  const elapsedMs = Date.now() - started;
  const text = await response.text();
  if (!response.ok) {
    return { ok: false, status: response.status, elapsedMs, error: text.slice(0, 600) };
  }
  const payload = JSON.parse(text);
  const content = payload.choices?.[0]?.message?.content ?? "";
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { ok: false, status: response.status, elapsedMs, error: `UNPARSEABLE_CONTENT: ${content.slice(0, 300)}` };
  }
  return { ok: true, status: response.status, elapsedMs, usage: payload.usage, results: parsed.results ?? [] };
}

const normalize = (value) => (value ?? "").replace(/\s+/g, "").toLowerCase();

function score(targets, results) {
  const byId = new Map(results.map((entry) => [entry.targetId, entry]));
  return targets.map((target) => {
    const answer = byId.get(target.targetId);
    if (!answer || answer.found === false || !answer.point) {
      return { ...target, outcome: "not-found", reportedFound: Boolean(answer?.found), confidence: answer?.confidence ?? null };
    }
    const x = Number(answer.point.x);
    const y = Number(answer.point.y);
    const rect = target.truthRect;
    const inside = x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
    const distance = Math.round(Math.hypot(x - target.truthCenter.x, y - target.truthCenter.y));
    const labelMatch = normalize(answer.observedLabel).includes(normalize(target.visibleLabel))
      || normalize(target.visibleLabel).includes(normalize(answer.observedLabel));
    return {
      ...target,
      outcome: inside ? "hit" : "miss",
      point: { x, y },
      centerDistancePx: distance,
      observedLabel: answer.observedLabel ?? "",
      labelMatch,
      confidence: answer.confidence ?? null,
    };
  });
}

app.whenReady().then(async () => {
  const started = new Date().toISOString();
  const credential = await loadCachedCredential();
  const truth = JSON.parse(await readFile(join(CAPTURE_DIR, "ground-truth.json"), "utf8"));
  const screens = [];
  for (const screen of truth.screens) {
    if (!screen.file || screen.error) continue;
    const targets = pickTargets(screen);
    if (!targets.length) continue;
    const rescaled = rescaleScreen(screen, await readFile(join(CAPTURE_DIR, screen.file)));
    const scaledTargets = pickTargets(rescaled.screen);
    const imageBase64 = rescaled.imageBuffer.toString("base64");
    let call;
    try {
      call = await callModel(credential, rescaled.screen, scaledTargets, imageBase64);
    } catch (error) {
      call = { ok: false, error: String(error?.message ?? error) };
    }
    if (!call.ok) {
      console.log(`${screen.screenId}: CALL_FAILED status=${call.status ?? "-"} ${String(call.error).slice(0, 200)}`);
      screens.push({ screenId: screen.screenId, description: screen.description, imageBytes: imageBase64.length, call: { ok: false, status: call.status, error: call.error, elapsedMs: call.elapsedMs } });
      continue;
    }
    const scored = score(scaledTargets, call.results);
    const hits = scored.filter((entry) => entry.outcome === "hit").length;
    const distances = scored.filter((entry) => entry.outcome !== "not-found").map((entry) => entry.centerDistancePx).sort((a, b) => a - b);
    const summary = {
      targets: scored.length,
      hits,
      misses: scored.filter((entry) => entry.outcome === "miss").length,
      notFound: scored.filter((entry) => entry.outcome === "not-found").length,
      hitRate: Number((hits / scored.length).toFixed(3)),
      medianCenterDistancePx: distances.length ? distances[Math.floor(distances.length / 2)] : null,
      labelMatchRate: Number((scored.filter((entry) => entry.labelMatch).length / scored.length).toFixed(3)),
    };
    console.log(`${screen.screenId}: hit ${hits}/${scored.length} medianDist=${summary.medianCenterDistancePx}px labelMatch=${summary.labelMatchRate} ${call.elapsedMs}ms`);
    screens.push({
      screenId: screen.screenId,
      description: screen.description,
      heading: screen.heading,
      viewport: rescaled.screen.viewport,
      preprocessScale: rescaled.scale,
      elementCount: screen.elementCount,
      call: { ok: true, status: call.status, elapsedMs: call.elapsedMs, usage: call.usage },
      summary,
      targets: scored,
    });
  }
  const measured = screens.filter((screen) => screen.summary);
  const overall = measured.length
    ? {
        screens: measured.length,
        targets: measured.reduce((sum, screen) => sum + screen.summary.targets, 0),
        hits: measured.reduce((sum, screen) => sum + screen.summary.hits, 0),
        misses: measured.reduce((sum, screen) => sum + screen.summary.misses, 0),
        notFound: measured.reduce((sum, screen) => sum + screen.summary.notFound, 0),
      }
    : null;
  if (overall) overall.hitRate = Number((overall.hits / overall.targets).toFixed(3));
  const result = {
    probe: "vision-grounding-accuracy",
    designRef: "docs/architecture/07-vision-first-execution-design.md#11",
    project: PROJECT_LABEL,
    modelId: MODEL_SETTINGS.modelId,
    provider: MODEL_SETTINGS.provider,
    api: MODEL_SETTINGS.api,
    startedAt: started,
    finishedAt: new Date().toISOString(),
    imageInputAccepted: screens.some((screen) => screen.call.ok),
    overall,
    screens,
  };
  await mkdir(dirname(RESULT_PATH), { recursive: true });
  await writeFile(RESULT_PATH, JSON.stringify(result, null, 2));
  console.log("\nimageInputAccepted:", result.imageInputAccepted);
  console.log("overall:", JSON.stringify(overall));
  app.exit(0);
}).catch((error) => {
  console.error("PROBE_FAILED", String(error?.message ?? error));
  app.exit(1);
});
