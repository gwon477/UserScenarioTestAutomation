import { describe, expect, it } from "vitest";
import desktopConfig from "../../electron.vite.config";

type EmittedFile = {
  type: string;
  fileName?: string;
};

type BuildStartHandler = (
  this: { emitFile: (file: EmittedFile) => string },
  options: unknown,
) => void | Promise<void>;

type ConfigPlugin = {
  name?: string;
  buildStart?: BuildStartHandler | { handler: BuildStartHandler };
};

describe("desktop runtime template bundle", () => {
  it("emits the shared harness resources beside the bundled main process", async () => {
    const plugins = (
      desktopConfig as unknown as { main?: { plugins?: Array<ConfigPlugin | null> } }
    ).main?.plugins ?? [];
    const plugin = plugins.find((candidate) => candidate?.name === "scenarioforge-runtime-template");
    const emittedFiles: string[] = [];
    const hook = plugin?.buildStart;

    if (hook) {
      const handler = typeof hook === "function" ? hook : hook.handler;
      await handler.call({
        emitFile(file) {
          if (file.type === "asset" && file.fileName) emittedFiles.push(file.fileName);
          return file.fileName ?? "runtime-template-asset";
        },
      }, {});
    }

    expect(emittedFiles).toContain("runtime-template/WORK_PROTOCOL.md");
    expect(emittedFiles).toContain("runtime-template/harnesses/scenario-generation.md");
    expect(emittedFiles).toContain("runtime-template/agents/generation/fact-analyst.md");
  });
});
