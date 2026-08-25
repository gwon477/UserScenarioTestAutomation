const { app, BrowserWindow } = require("electron");
const { mkdir, writeFile } = require("node:fs/promises");
const { resolve } = require("node:path");

const baseUrl = process.env.SCENARIOFORGE_PREVIEW_URL ?? "http://127.0.0.1:5173";
const captures = [
  ["test-running", "screen-test-running.png"],
  ["evidence-failure", "screen-test-failure-evidence.png"],
];

async function capturePreview(window, preview, fileName) {
  await window.loadURL(`${baseUrl}/?preview=${preview}`);
  await window.webContents.executeJavaScript("document.fonts.ready");
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 350));
  const heading = await window.webContents.executeJavaScript(
    "document.querySelector('main h1')?.textContent ?? ''",
  );
  if (!heading) throw new Error(`${preview} preview did not render a heading`);
  const image = await window.webContents.capturePage();
  const size = image.getSize();
  const output = size.width > 1440
    ? image.resize({ width: 1440, height: Math.round((size.height * 1440) / size.width) })
    : image;
  await writeFile(resolve("artifacts", fileName), output.toPNG());
}

async function verifyNavigation(window) {
  const clicked = await window.webContents.executeJavaScript(`(() => {
    const button = [...document.querySelectorAll("button")].find(
      (candidate) => candidate.textContent?.includes("시나리오에서 보기"),
    );
    button?.click();
    return Boolean(button);
  })()`);
  if (!clicked) throw new Error("scenario navigation action was not found");
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 120));
  const result = await window.webContents.executeJavaScript(`({
    heading: document.querySelector("main h1")?.textContent ?? "",
    focused: Boolean(document.querySelector(".scenario-case.is-focused")),
  })`);
  if (result.heading !== "분석 결과" || !result.focused) {
    throw new Error("evidence-to-scenario navigation did not preserve the scenario ID");
  }
}

async function verifyExecutionControls(window) {
  const historyClicked = await window.webContents.executeJavaScript(`(() => {
    const button = [...document.querySelectorAll(".execution-history-list button")].find(
      (candidate) => candidate.textContent?.includes("EXE-20260825-0006"),
    );
    button?.click();
    return Boolean(button);
  })()`);
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  const historyResult = await window.webContents.executeJavaScript(`({
    id: document.querySelector(".execution-heading code")?.textContent ?? "",
    status: document.querySelector(".execution-title-line .status-badge")?.textContent ?? "",
  })`);
  if (
    !historyClicked ||
    historyResult.id !== "EXE-20260825-0006" ||
    !historyResult.status.includes("실패")
  ) {
    throw new Error("execution history did not switch the active execution");
  }

  await window.webContents.executeJavaScript(`(() => {
    const button = [...document.querySelectorAll("button")].find(
      (candidate) => candidate.textContent?.includes("증적 상세 보기"),
    );
    button?.click();
  })()`);
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  await window.webContents.executeJavaScript(
    "document.querySelector('.text-back-action')?.click()",
  );
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  const returnedExecutionId = await window.webContents.executeJavaScript(
    "document.querySelector('.execution-heading code')?.textContent ?? ''",
  );
  if (returnedExecutionId !== "EXE-20260825-0006") {
    throw new Error("evidence back action did not restore the viewed execution");
  }

  await window.loadURL(`${baseUrl}/?preview=test-running`);
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  const cancelClicked = await window.webContents.executeJavaScript(`(() => {
    const button = [...document.querySelectorAll("button")].find(
      (candidate) => candidate.textContent?.includes("실행 중단"),
    );
    button?.click();
    return Boolean(button);
  })()`);
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  const confirmationSummary = await window.webContents.executeJavaScript(
    "document.querySelector('.cancel-confirm')?.textContent ?? ''",
  );
  if (
    !confirmationSummary.includes("저장된 화면") ||
    !confirmationSummary.includes("남은 케이스")
  ) {
    throw new Error("execution cancel confirmation is missing impact details");
  }
  const initialFocus = await window.webContents.executeJavaScript(
    "document.activeElement?.textContent?.trim() ?? ''",
  );
  if (!initialFocus.includes("계속 수행")) {
    throw new Error("cancel confirmation did not move focus to a safe action");
  }
  const focusTrapped = await window.webContents.executeJavaScript(`(() => {
    const confirm = document.querySelector(".cancel-confirm .evidence-primary-action");
    confirm?.focus();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    return document.activeElement?.textContent?.includes("계속 수행") ?? false;
  })()`);
  if (!focusTrapped) throw new Error("cancel confirmation did not trap keyboard focus");
  await window.webContents.executeJavaScript(
    "document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))",
  );
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 80));
  const escapeRestoredFocus = await window.webContents.executeJavaScript(`({
    dialogClosed: !document.querySelector(".cancel-confirm"),
    triggerFocused: document.activeElement?.textContent?.includes("실행 중단") ?? false,
  })`);
  if (!escapeRestoredFocus.dialogClosed || !escapeRestoredFocus.triggerFocused) {
    throw new Error("cancel confirmation did not close and restore focus on Escape");
  }
  await window.webContents.executeJavaScript(
    "document.activeElement?.click()",
  );
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 80));
  await window.webContents.executeJavaScript(
    "document.querySelector('.cancel-confirm .evidence-primary-action')?.click()",
  );
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  const cancelStatus = await window.webContents.executeJavaScript(
    "document.querySelector('.execution-title-line .status-badge')?.textContent ?? ''",
  );
  if (!cancelClicked || !cancelStatus.includes("중단")) {
    throw new Error("execution cancel did not update the domain view state");
  }
}

async function verifyCaseRetry(window) {
  await window.loadURL(`${baseUrl}/?preview=evidence-failure`);
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  await window.webContents.executeJavaScript(`(() => {
    const button = [...document.querySelectorAll("button")].find(
      (candidate) => candidate.textContent?.includes("동일 케이스 재시도"),
    );
    button?.click();
  })()`);
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  const caseCount = await window.webContents.executeJavaScript(
    "document.querySelector('.execution-queue-panel .panel-heading > span')?.textContent ?? ''",
  );
  if (caseCount.trim() !== "1 cases") {
    throw new Error("single-case retry created more than one queued case");
  }
}

async function verifyMobileLayout(window) {
  window.setContentSize(390, 844);
  await window.loadURL(`${baseUrl}/?preview=test-running`);
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 120));
  const sizes = await window.webContents.executeJavaScript(`({
    viewport: window.innerWidth,
    content: document.documentElement.scrollWidth,
  })`);
  if (sizes.content > sizes.viewport) {
    throw new Error(`mobile layout overflows: ${sizes.content}px > ${sizes.viewport}px`);
  }
}

app.commandLine.appendSwitch("force-device-scale-factor", "1");

app.whenReady().then(async () => {
  await mkdir(resolve("artifacts"), { recursive: true });
  const window = new BrowserWindow({
    width: 1440,
    height: 1024,
    useContentSize: true,
    show: false,
    backgroundColor: "#f9f7f7",
    webPreferences: {
      sandbox: true,
    },
  });
  await capturePreview(window, captures[0][0], captures[0][1]);
  await verifyExecutionControls(window);
  await capturePreview(window, captures[1][0], captures[1][1]);
  await verifyNavigation(window);
  await verifyCaseRetry(window);
  await verifyMobileLayout(window);
  window.destroy();
  app.quit();
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
