import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Electron main module path resolution", () => {
  it("uses ESM-compatible module directory resolution", async () => {
    const source = await readFile(new URL("./index.ts", import.meta.url), "utf8");

    expect(source).not.toContain("__dirname");
    expect(source).toContain("fileURLToPath(import.meta.url)");
  });

  it("uses a CommonJS preload while keeping the renderer sandboxed", async () => {
    const source = await readFile(new URL("./index.ts", import.meta.url), "utf8");
    const buildConfig = await readFile(
      new URL("../../electron.vite.config.ts", import.meta.url),
      "utf8",
    );

    expect(buildConfig).toContain('format: "cjs"');
    expect(source).toContain('../preload/index.cjs');
    expect(source).toContain("sandbox: true");
  });

  it("restores only a previously selected canonical project directory", async () => {
    const source = await readFile(new URL("./index.ts", import.meta.url), "utf8");

    expect(source).toContain("IPC_CHANNELS.restoreProjectDirectory");
    expect(source).toContain("requireProjectRegistry().load()");
    expect(source).toContain("await requireProjectRegistry().add(canonical, new Date().toISOString())");
    expect(source).toContain("selectedProjectRoots.add(canonical)");
  });

  it("only reads a project root that the registry holds", async () => {
    const source = await readFile(new URL("./index.ts", import.meta.url), "utf8");

    /* renderer 가 준 경로를 그대로 신뢰하지 않는다. 목록에 있는 항목만
     * 읽기 권한을 되살린다. */
    expect(source).toContain("PROJECT_DIRECTORY_NOT_REGISTERED");
    for (const channel of [
      "IPC_CHANNELS.openProject",
      "IPC_CHANNELS.revealProject",
      "IPC_CHANNELS.deleteAnalysisData",
    ]) {
      expect(source).toContain(channel);
    }
    expect(source).toContain("authorizeRegisteredRoot(path)");
  });

  it("refuses to delete analysis data while that project is analyzing", async () => {
    const source = await readFile(new URL("./index.ts", import.meta.url), "utf8");

    expect(source).toContain("orchestrator.isAnalysisRunning(canonical)");
    expect(source).toContain('throw new Error("ANALYSIS_ALREADY_RUNNING")');
  });

  it("delegates recovery to the fine-grained generation checkpoint summary", async () => {
    const source = await readFile(new URL("./index.ts", import.meta.url), "utf8");

    expect(source).toContain("summarizeGenerationCheckpoint(state)");
    expect(source).not.toContain("state.stages[nextStage]");
  });
});

describe("app icon", () => {
  /* 아이콘 로드 실패는 조용히 넘어가므로, 자산이 사라져도 앱은 그대로 뜬다.
   * 경로가 깨진 것을 알려주는 곳이 여기뿐이다. */
  it("resolves the brand icon that main points at", async () => {
    const source = await readFile(new URL("./index.ts", import.meta.url), "utf8");
    const relative = source.match(/join\(mainDirectory, "(\.\.\/\.\.\/resources\/brand\/[^"]+)"\)/)?.[1];

    expect(relative).toBeDefined();
    // main 은 out/main 에서 실행되므로 소스 기준으로는 두 단계 위가 패키지 루트다.
    const asset = new URL(`../../${relative!.replace("../../", "")}`, import.meta.url);
    await expect(readFile(asset)).resolves.toBeInstanceOf(Buffer);
  });

  it("sets the dock icon on macOS where the window icon is ignored", async () => {
    const source = await readFile(new URL("./index.ts", import.meta.url), "utf8");

    expect(source).toContain("app.dock?.setIcon(icon)");
  });
});
