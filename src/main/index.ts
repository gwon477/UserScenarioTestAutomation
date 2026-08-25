import { app, BrowserWindow, dialog, ipcMain } from "electron";
import type { IpcMainInvokeEvent } from "electron";
import { readFile } from "node:fs/promises";
import { basename, join, resolve, sep } from "node:path";
import {
  IPC_CHANNELS,
  type ModelSettingsWithSecret,
  type ScenarioQuestion,
  type SelectedDirectory,
  type TestExecutionRequest,
} from "../shared/desktop-api";
import { isScenarioResult } from "../shared/scenario";

let mainWindow: BrowserWindow | null = null;
let sessionModelSettings: ModelSettingsWithSecret | null = null;

function assertTrustedSender(event: IpcMainInvokeEvent) {
  if (!mainWindow || event.sender.id !== mainWindow.webContents.id) {
    throw new Error("허용되지 않은 렌더러 요청입니다.");
  }
}

function registerIpcHandlers() {
  ipcMain.handle(IPC_CHANNELS.selectProjectDirectory, async (event) => {
    assertTrustedSender(event);
    if (!mainWindow) return null;

    const selection = await dialog.showOpenDialog(mainWindow, {
      title: "ScenarioForge 분석 프로젝트 선택",
      buttonLabel: "이 디렉터리 선택",
      properties: ["openDirectory", "createDirectory"],
    });

    const selectedPath = selection.filePaths[0];
    if (selection.canceled || !selectedPath) return null;

    return {
      name: basename(selectedPath),
      path: selectedPath,
    } satisfies SelectedDirectory;
  });

  ipcMain.handle(
    IPC_CHANNELS.saveModelSettings,
    (event, settings: ModelSettingsWithSecret) => {
      assertTrustedSender(event);
      // 목업 단계에서는 키를 디스크에 기록하지 않고 Electron 세션 메모리에만 둔다.
      sessionModelSettings = {
        ...settings,
        ...(settings.apiKey
          ? { apiKey: settings.apiKey }
          : sessionModelSettings?.apiKey
            ? { apiKey: sessionModelSettings.apiKey }
            : {}),
      };
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.startAnalysis,
    (event, _project: SelectedDirectory) => {
      assertTrustedSender(event);
      // pi-coding-agent 런타임은 후속 백엔드 작업에서 이 채널에 연결한다.
      void sessionModelSettings;
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.loadScenarioResult,
    async (event, project: SelectedDirectory, runId: string) => {
      assertTrustedSender(event);
      if (!project.path || !/^[a-zA-Z0-9_-]+$/.test(runId)) return null;

      const projectRoot = resolve(project.path);
      const resultPath = resolve(
        projectRoot,
        ".scenarioforge",
        "runs",
        runId,
        "scenario-set.json",
      );
      if (!resultPath.startsWith(`${projectRoot}${sep}`)) return null;

      try {
        const result: unknown = JSON.parse(await readFile(resultPath, "utf8"));
        return isScenarioResult(result) ? result : null;
      } catch {
        return null;
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.askScenarioQuestion,
    (event, question: ScenarioQuestion) => {
      assertTrustedSender(event);
      const target = question.scenarioIds.length
        ? question.scenarioIds.map((id) => `\`${id}\``).join(", ")
        : "현재 시나리오 정보 셋";
      return `${target}의 전제 조건과 세부 스텝을 기준으로 확인했습니다. 질문하신 항목은 기대 결과와 원천 코드까지 함께 비교할 수 있습니다.`;
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.startScenarioTests,
    (event, _request: TestExecutionRequest) => {
      assertTrustedSender(event);
      // TestVista 실행기는 다음 작업에서 이 채널에 연결한다.
    },
  );
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 1024,
    minWidth: 960,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#f9f7f7",
    title: "ScenarioForge",
    ...(process.platform === "darwin" ? { titleBarStyle: "hiddenInset" as const } : {}),
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event) => event.preventDefault());
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

registerIpcHandlers();

void app.whenReady().then(() => {
  if (process.platform === "win32") {
    app.setAppUserModelId("com.scenarioforge.desktop");
  }

  createMainWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
