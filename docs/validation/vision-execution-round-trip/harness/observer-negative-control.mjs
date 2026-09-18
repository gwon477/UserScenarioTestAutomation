/* observer 가 질문을 되뇌지 않는지 확인한다.
 * 로그인 화면에 대해 «프로젝트 선택»과 존재하지 않는 문구를 물어본다.
 * 되뇌면 assertion 판정 전체가 무의미하므로 이 대조가 필요하다. */
import { app, BrowserWindow, nativeImage, safeStorage, session } from "electron";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
app.setName("@scenarioforge/desktop");
app.setPath("userData", join(homedir(), "Library", "Application Support", "@scenarioforge", "desktop"));
const MODEL = { endpoint: "https://skax.ai-talentlab.com", modelId: "gpt-5.6-luna", apiVersion: "2024-12-01-preview", provider: "azure-openai" };
const settle = (ms) => new Promise((r) => setTimeout(r, ms));

function identity(role) {
  const e = new URL(MODEL.endpoint); e.username=""; e.password=""; e.search=""; e.hash="";
  return createHash("sha256").update(JSON.stringify({ role, provider: MODEL.provider, endpoint: e.toString().replace(/\/$/,""), apiVersion: MODEL.apiVersion })).digest("hex");
}
async function credential() {
  const injected = process.env.SCENARIOFORGE_PROBE_MODEL_KEY;
  if (injected?.trim()) return injected.trim();
  const doc = JSON.parse(await readFile(join(app.getPath("userData"), "model-credentials.v1.json"), "utf8"));
  if (doc.author.identity !== identity("author")) throw new Error("IDENTITY_MISMATCH");
  return safeStorage.decryptString(Buffer.from(doc.author.ciphertext, "base64"));
}

const OBSERVER_SYSTEM = `You read a screenshot and report which of the given strings are actually visible.
- Include a string in visibleTexts only if you can read it on the screen.
- Do not infer, complete, or normalize. Do not add anything you did not read.
- Report the text as it appears.
Answer with JSON only: {"visibleTexts":["..."]}`;

async function observe(key, pngBase64, size, questions) {
  const url = `${MODEL.endpoint}/openai/deployments/${MODEL.modelId}/chat/completions?api-version=${MODEL.apiVersion}`;
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "api-key": key }, body: JSON.stringify({
    messages: [
      { role: "system", content: OBSERVER_SYSTEM },
      { role: "user", content: [
        { type: "text", text: `Screenshot is ${size.width}x${size.height}. Which of these are visible?\n${questions.map((q) => `- ${q}`).join("\n")}` },
        { type: "image_url", image_url: { url: `data:image/png;base64,${pngBase64}`, detail: "high" } },
      ] },
    ], max_completion_tokens: 800, response_format: { type: "json_object" },
  }) });
  const text = await response.text();
  if (!response.ok) throw new Error(`CALL_FAILED ${response.status} ${text.slice(0,180)}`);
  return JSON.parse(JSON.parse(text).choices[0].message.content);
}

app.whenReady().then(async () => {
  const key = await credential();
  await session.defaultSession.clearStorageData();
  const window = new BrowserWindow({ width: 1440, height: 900, show: false, webPreferences: { contextIsolation: true } });
  window.setContentSize(1440, 900);
  await window.loadURL("http://localhost:45180");
  await settle(1500);
  const image = await window.webContents.capturePage();
  const resized = image.resize({ width: 1229, height: 768 });
  const png = resized.toPNG().toString("base64");
  const size = { width: 1229, height: 768 };

  const cases = [
    { name: "present-anchor", questions: ["로그인"], expect: ["로그인"] },
    { name: "absent-anchor (다음 화면 앵커)", questions: ["프로젝트 선택"], expect: [] },
    { name: "absent-invented", questions: ["결제 승인 완료"], expect: [] },
    { name: "mixed", questions: ["로그인", "프로젝트 선택", "결제 승인 완료"], expect: ["로그인"] },
  ];
  const results = [];
  for (const testCase of cases) {
    const answer = await observe(key, png, size, testCase.questions);
    const got = Array.isArray(answer.visibleTexts) ? answer.visibleTexts.map(String) : [];
    const pass = JSON.stringify(got) === JSON.stringify(testCase.expect);
    console.log(`${pass ? "OK  " : "FAIL"} ${testCase.name}: asked ${JSON.stringify(testCase.questions)} -> ${JSON.stringify(got)} (expected ${JSON.stringify(testCase.expect)})`);
    results.push({ ...testCase, got, pass });
  }
  await writeFile(process.env.NEGATIVE_OUT, JSON.stringify({ probe: "observer-negative-control", modelId: MODEL.modelId, frame: size, screen: "AXSE 로그인", results }, null, 2));
  console.log(`\nall passed: ${results.every((r) => r.pass)}`);
  app.exit(results.every((r) => r.pass) ? 0 : 1);
}).catch((error) => { console.error("FAILED", String(error?.message ?? error)); app.exit(2); });
