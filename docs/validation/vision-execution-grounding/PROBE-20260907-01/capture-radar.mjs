import { app, BrowserWindow, session } from "electron";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const BASE = "http://localhost:45190";
const OUT = process.env.GROUNDING_OUT;
const VIEWPORT = { width: 1440, height: 900 };

const GROUND_TRUTH = `(() => {
  // 잘린 요소를 제외한다. 스크롤 컨테이너 안에서 화면 밖으로 밀린 셀은
  // 스크린샷에 존재하지 않으므로 grounding 대상이 될 수 없다.
  const clippedRect = (element) => {
    let rect = element.getBoundingClientRect();
    let box = { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      if (!/auto|scroll|hidden|clip/.test(style.overflowX + style.overflowY)) continue;
      const bounds = parent.getBoundingClientRect();
      box = {
        left: Math.max(box.left, bounds.left),
        top: Math.max(box.top, bounds.top),
        right: Math.min(box.right, bounds.right),
        bottom: Math.min(box.bottom, bounds.bottom),
      };
    }
    box.left = Math.max(box.left, 0);
    box.top = Math.max(box.top, 0);
    box.right = Math.min(box.right, window.innerWidth);
    box.bottom = Math.min(box.bottom, window.innerHeight);
    const width = box.right - box.left;
    const height = box.bottom - box.top;
    if (width < 8 || height < 8) return null;
    // 원래 크기의 대부분이 남아 있어야 «화면에 보이는 그 컨트롤»이다.
    if (width * height < rect.width * rect.height * 0.6) return null;
    return { x: Math.round(box.left), y: Math.round(box.top), width: Math.round(width), height: Math.round(height) };
  };
  const rendered = (element) => {
    const style = getComputedStyle(element);
    return style.visibility !== "hidden" && style.display !== "none" && Number(style.opacity) > 0.1;
  };
  // 화면에 실제로 읽히는 텍스트를 우선한다. aria-label 은 보이는 텍스트가
  // 없을 때만 쓴다 - 비전 모델은 보이지 않는 라벨을 읽을 수 없다.
  const label = (element) => {
    const text = (element.textContent || "").replace(/\\s+/g, " ").trim();
    if (text) return { text: text.slice(0, 40), source: "visible-text" };
    const placeholder = (element.getAttribute("placeholder") || "").trim();
    if (placeholder) return { text: placeholder.slice(0, 40), source: "placeholder" };
    if (element.id) {
      const bound = document.querySelector('label[for="' + element.id + '"]');
      const boundText = (bound?.textContent || "").replace(/\\s+/g, " ").trim();
      if (boundText) return { text: boundText.slice(0, 40), source: "bound-label" };
    }
    const aria = (element.getAttribute("aria-label") || "").trim();
    if (aria) return { text: aria.slice(0, 40), source: "aria-label" };
    return null;
  };
  const kind = (element) => {
    const tag = element.tagName.toLowerCase();
    if (tag === "input") return element.type === "password" ? "password-textbox" : element.type === "file" ? "file-upload" : "textbox";
    if (tag === "select") return "select";
    if (tag === "textarea") return "textbox";
    if (tag === "a") return "link";
    if (element.getAttribute("role") === "button") return "button";
    if (element.className && String(element.className).includes("nav-item")) return "nav-item";
    return "button";
  };
  const nodes = [...document.querySelectorAll('button, input, select, textarea, a[href], [role="button"], .nav-item')];
  const seen = new Set();
  const entries = [];
  for (const element of nodes) {
    if (!rendered(element)) continue;
    const rect = clippedRect(element);
    if (!rect) continue;
    const named = label(element);
    if (!named) continue;
    const controlKind = kind(element);
    const key = named.text + "|" + controlKind;
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({
      label: named.text,
      labelSource: named.source,
      controlKind,
      rect,
      center: { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) },
    });
  }
  return entries;
})()`;

const settle = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function snap(window, screenId, description) {
  await window.webContents.executeJavaScript("document.fonts.ready");
  await settle(500);
  const elements = await window.webContents.executeJavaScript(GROUND_TRUTH);
  const heading = await window.webContents.executeJavaScript(
    `(document.querySelector("h1, h2, .login-form-title, .page-title")?.textContent ?? "").trim()`,
  );
  const image = await window.webContents.capturePage();
  const size = image.getSize();
  const normalized = size.width === VIEWPORT.width ? image : image.resize({ width: VIEWPORT.width, height: VIEWPORT.height });
  const file = `${screenId}.png`;
  await writeFile(join(OUT, file), normalized.toPNG());
  return { screenId, description, heading, file, viewport: VIEWPORT, capturedSize: size, elementCount: elements.length, elements };
}

async function clickByText(window, selector, text) {
  const clicked = await window.webContents.executeJavaScript(`(() => {
    const target = [...document.querySelectorAll(${JSON.stringify(selector)})]
      .find((candidate) => (candidate.textContent || "").includes(${JSON.stringify(text)}));
    if (!target) return false;
    target.click();
    return true;
  })()`);
  if (!clicked) throw new Error(`CLICK_TARGET_NOT_FOUND: ${selector} :: ${text}`);
  await settle(700);
}

app.whenReady().then(async () => {
  await mkdir(OUT, { recursive: true });
  await session.defaultSession.clearStorageData();
  const window = new BrowserWindow({
    width: VIEWPORT.width,
    height: VIEWPORT.height,
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  window.setContentSize(VIEWPORT.width, VIEWPORT.height);
  window.webContents.on("console-message", (event) => {
    const level = event.level ?? "log";
    if (level === "error" || level === "warning") console.log(`[renderer:${level}]`, String(event.message).slice(0, 300));
  });
  const screens = [];
  try {
    await window.loadURL(`${BASE}/login`);
    await settle(1200);
    screens.push(await snap(window, "01-landing-hero", "RA-DAR 랜딩 첫 장면"));

    const scrolled = await window.webContents.executeJavaScript(`(() => {
      const deck = document.querySelector(".landing");
      const scene = document.querySelector("#s10");
      if (!deck || !scene) return false;
      scene.scrollIntoView({ block: "start" });
      return true;
    })()`);
    if (!scrolled) throw new Error("LOGIN_SCENE_NOT_FOUND");
    await settle(1200);
    screens.push(await snap(window, "02-login", "담당자 계정 로그인 장면"));

    await window.webContents.executeJavaScript(`(() => {
      const button = [...document.querySelectorAll("button")].find((candidate) => /사번으로 인증하고 시작/.test(candidate.textContent || ""));
      if (!button) return false;
      button.click();
      return true;
    })()`);
    await settle(2000);
    screens.push(await snap(window, "04-dashboard", "로그인 직후 야간 작업 대시보드"));

    const toLedger = await window.webContents.executeJavaScript(`(() => {
      const link = [...document.querySelectorAll("a")].find((candidate) => (candidate.getAttribute("href") || "").startsWith("/ledger"));
      if (link) { link.click(); return "link"; }
      const button = [...document.querySelectorAll("button")].find((candidate) => /원장/.test(candidate.textContent || ""));
      if (button) { button.click(); return "button"; }
      return "none";
    })()`);
    console.log("ledger navigation:", toLedger);
    await settle(2500);
    screens.push(await snap(window, "06-ledger", "누적관리 원장 목록"));

    const opened = await window.webContents.executeJavaScript(`(() => {
      const trigger = [...document.querySelectorAll("button")].find((candidate) => /상태/.test(candidate.textContent || ""));
      if (!trigger) return false;
      trigger.click();
      return true;
    })()`);
    console.log("status filter open:", opened);
    await settle(900);
    screens.push(await snap(window, "07-ledger-status-filter", "원장 상태 필터가 열린 화면"));

    await window.webContents.executeJavaScript(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })), true`);
    await settle(500);
    const asked = await window.webContents.executeJavaScript(`(() => {
      const input = document.querySelector("textarea, input[placeholder*='원장']");
      if (!input) return false;
      const setter = Object.getOwnPropertyDescriptor(input instanceof HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype, "value").set;
      setter.call(input, "대응 기한이 7일 이내인 건만 보여주세요");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    })()`);
    console.log("agent prompt filled:", asked);
    await settle(700);
    screens.push(await snap(window, "08-ledger-agent-prompt", "RA 에이전트 질문이 입력된 원장 화면"));

  } catch (error) {
    screens.push({ screenId: "fatal", error: String(error?.stack ?? error) });
  }
  await writeFile(join(OUT, "ground-truth.json"), JSON.stringify({ base: BASE, viewport: VIEWPORT, screens }, null, 2));
  console.log(JSON.stringify(screens.map((s) => ({ id: s.screenId, heading: s.heading, elements: s.elementCount, error: s.error })), null, 2));
  app.exit(0);
});
