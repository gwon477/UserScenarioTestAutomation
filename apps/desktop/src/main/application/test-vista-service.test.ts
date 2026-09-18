import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

/* Electron 창을 띄우는 부분은 단위 테스트로 확인할 수 없다.
 * 실측에서 확인된 결정을 소스에 고정한다.
 * 실제 구동 확인은 docs/validation/vision-execution-round-trip 를 따른다. */

const source = () => readFile(new URL("./test-vista-service.ts", import.meta.url), "utf8");

describe("test vista service boundaries", () => {
  it("runs each execution in an isolated in-memory session", async () => {
    const code = await source();

    // 기본 session 을 공유하면 남은 로그인 상태가 진입 전제를 깬다.
    // 실측에서 이미 로그인된 화면이 캡처돼 대상을 찾지 못했다.
    expect(code).toContain("partition: `test-vista-${input.executionId}`");
    // `persist:` 접두사가 붙으면 창을 닫아도 상태가 남는다. 실행 코드에 없어야 한다.
    const executable = code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(executable).not.toContain("persist:");
  });

  it("waits for the entry screen to render before the first capture", async () => {
    const code = await source();

    expect(code).toContain("waitForEntryReady");
    expect(code).toContain("document.readyState");
    expect(code).toContain("document.fonts.ready");
  });

  it("opens only http or https entry points", async () => {
    const code = await source();

    expect(code).toContain("TARGET_ENTRY_SCHEME_FORBIDDEN");
    expect(code).toContain('["http:", "https:"]');
  });

  it("blocks navigation away from the declared origin and new windows", async () => {
    const code = await source();

    expect(code).toContain('setWindowOpenHandler(() => ({ action: "deny" }))');
    expect(code).toContain('on("will-navigate"');
    expect(code).toContain("event.preventDefault()");
  });

  it("reads the plan from the canonical batch artifacts, not from the renderer", async () => {
    const code = await source();

    expect(code).toContain("runner-plan.json");
    expect(code).toContain("execution-target-profile.json");
    expect(code).toContain("batch-manifest.json");
  });

  it("only runs a batch that is still queued", async () => {
    const code = await source();

    expect(code).toContain('(batchManifest.runtimeStatus ?? "QUEUED") !== "QUEUED"');
  });

  it("destroys the target window even when the run throws", async () => {
    const code = await source();

    expect(code).toContain("} finally {");
    expect(code).toContain("window.destroy()");
  });

  it("gives each execution its own cancel watcher instead of module state", async () => {
    const code = await source();

    expect(code).toContain("export function watchCancelRequest");
    expect(code).toContain("let requested = false;");
    expect(code).not.toMatch(/^let cancel/m);
  });
});
