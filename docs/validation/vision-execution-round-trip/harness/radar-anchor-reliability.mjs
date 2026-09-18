/* 같은 프레임에 대해 앵커 후보별로 observer 를 반복 호출해 신뢰도를 잰다.
 * 화면이 고정된 상태이므로 응답 차이는 전부 observer 변동이다. */
import { app, BrowserWindow, safeStorage, session } from "electron";
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
async function observe(key, png, size, questions) {
  const url = `${MODEL.endpoint}/openai/deployments/${MODEL.modelId}/chat/completions?api-version=${MODEL.apiVersion}`;
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "api-key": key }, body: JSON.stringify({
    messages: [
      { role: "system", content: OBSERVER_SYSTEM },
      { role: "user", content: [
        { type: "text", text: `Screenshot is ${size.width}x${size.height}. Which of these are visible?\n${questions.map((q) => `- ${q}`).join("\n")}` },
        { type: "image_url", image_url: { url: `data:image/png;base64,${png}`, detail: "high" } },
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
  const w = new BrowserWindow({ width: 1440, height: 900, show: false, webPreferences: { contextIsolation: true } });
  w.setContentSize(1440, 900);
  await w.loadURL("http://localhost:45190/login");
  await settle(1500);
  for (let i = 0; i < 20; i += 1) {
    const ok = await w.webContents.executeJavaScript(`(() => { const s=document.querySelector("#s10"); if(s) s.scrollIntoView({block:"start"}); const t=document.querySelector('button[type="submit"].btn.pri'); if(!t) return false; const r=t.getBoundingClientRect(); return r.top>=0 && r.bottom<=window.innerHeight; })()`);
    if (ok) break; await settle(400);
  }
  await w.webContents.executeJavaScript(`document.querySelector('button[type="submit"].btn.pri').click(), true`);
  await settle(3000);
  const image = await w.webContents.capturePage();
  const png = image.resize({ width: 1229, height: 768 }).toPNG().toString("base64");
  const size = { width: 1229, height: 768 };

  const domPresent = await w.webContents.executeJavaScript(`(() => {
    const body = document.body.innerText || "";
    return ${JSON.stringify(["새로 생성된 대조 조항","RADAR 야간 작업 보고","규제 대응 자산","AI 작업 결과","직접 확인 필요","품목 허가 취소 완료"])}.map((t) => [t, body.includes(t)]);
  })()`);
  const truth = Object.fromEntries(domPresent);
  console.log("DOM 기준 존재:", JSON.stringify(truth, null, 0));

  const rows = [];
  for (const anchor of Object.keys(truth)) {
    const seen = [];
    for (let round = 0; round < 3; round += 1) {
      const answer = await observe(key, png, size, [anchor]);
      seen.push(Array.isArray(answer.visibleTexts) && answer.visibleTexts.length > 0);
    }
    const hits = seen.filter(Boolean).length;
    const agrees = seen.every((value) => value === truth[anchor]);
    console.log(`${agrees ? "OK  " : "VARY"} ${anchor}: dom=${truth[anchor]} observer=${JSON.stringify(seen)} (${hits}/3)`);
    rows.push({ anchor, domPresent: truth[anchor], observer: seen, hits, agrees });
  }
  await writeFile(process.env.RELIABILITY_OUT, JSON.stringify({ probe: "observer-anchor-reliability", modelId: MODEL.modelId, screen: "RA-DAR 야간 작업 대시보드", frame: size, rows }, null, 2));
  console.log(`\n모든 앵커 일치: ${rows.every((r) => r.agrees)}`);
  app.exit(0);
}).catch((error) => { console.error("FAILED", String(error?.message ?? error)); app.exit(2); });
