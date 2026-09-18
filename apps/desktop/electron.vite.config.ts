import { readFile, readdir } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";

const configDirectory = dirname(fileURLToPath(import.meta.url));
const runtimeTemplateSource = resolve(
  configDirectory,
  "../../packages/project-runtime/runtime-template",
);

function runtimeTemplatePlugin(): Plugin {
  return {
    name: "scenarioforge-runtime-template",
    apply: "build",
    async buildStart() {
      const visit = async (directory: string): Promise<void> => {
        const entries = await readdir(directory, { withFileTypes: true });
        entries.sort((left, right) => left.name.localeCompare(right.name));

        for (const entry of entries) {
          const path = join(directory, entry.name);
          if (entry.isDirectory()) {
            await visit(path);
            continue;
          }
          if (!entry.isFile()) continue;

          const assetPath = relative(runtimeTemplateSource, path)
            .split(sep)
            .join("/");
          this.emitFile({
            type: "asset",
            fileName: `runtime-template/${assetPath}`,
            source: await readFile(path),
          });
        }
      };

      await visit(runtimeTemplateSource);
    },
  };
}

export default defineConfig({
  main: {
    plugins: [runtimeTemplatePlugin(), externalizeDepsPlugin({
      /* 워크스페이스 패키지는 TS 소스로 배포되므로 반드시 번들에 넣는다.
       * 외부로 남기면 빌드된 main 이 런타임에 `src/*.ts` 를 임포트하려다
       * ERR_MODULE_NOT_FOUND 로 죽는다. 새 워크스페이스 패키지를 main 에서
       * 쓰기 시작하면 여기에도 추가해야 한다. */
      exclude: [
        "@scenarioforge/contracts",
        "@scenarioforge/pi-runtime",
        "@scenarioforge/project-runtime",
        "@scenarioforge/runtime-state",
        "@scenarioforge/scenario-pipeline",
        "@scenarioforge/test-runtime",
      ],
    })],
    build: {
      rollupOptions: {
        external: ["typescript-compiler"],
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        output: {
          format: "cjs",
        },
      },
    },
  },
  renderer: {
    plugins: [react()],
  },
});
