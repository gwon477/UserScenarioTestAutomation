import { nativeImage, type BrowserWindow } from "electron";
import type { FrameCapture, FrameCoordinateSpace, Point } from "@scenarioforge/test-runtime";
import type { VisionSurface } from "./test-vista-runner";

/* 대상 화면 어댑터. 캡처 직전 페이지에 마스크를 덮고, 실제 입력 이벤트를 합성한다.
 *
 * DOM `.click()` 을 쓰지 않는다. 사람과 같은 입력 경로로 조작해야 증적이
 * 실사용을 대표한다.
 */

const settle = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export type ElectronVisionSurfaceOptions = {
  window: BrowserWindow;
  viewport: { width: number; height: number };
  /** 프레임 전송 전에 가릴 대상 선택자. 하나라도 덮지 못하면 실패로 알린다. */
  maskSelectors: readonly string[];
  actionSettleMs?: number;
};

export function createElectronVisionSurface(options: ElectronVisionSurfaceOptions): VisionSurface {
  const actionSettle = options.actionSettleMs ?? 600;

  async function applyMask(): Promise<boolean> {
    return options.window.webContents.executeJavaScript(`(() => {
      const selectors = ${JSON.stringify(options.maskSelectors)};
      document.querySelectorAll("[data-sf-mask]").forEach((node) => node.remove());
      let covered = 0;
      let expected = 0;
      for (const selector of selectors) {
        for (const target of document.querySelectorAll(selector)) {
          expected += 1;
          const rect = target.getBoundingClientRect();
          if (rect.width < 1 || rect.height < 1) { covered += 1; continue; }
          const cover = document.createElement("div");
          cover.setAttribute("data-sf-mask", selector);
          Object.assign(cover.style, {
            position: "fixed", left: rect.left + "px", top: rect.top + "px",
            width: rect.width + "px", height: rect.height + "px",
            background: "#111", zIndex: "2147483647", pointerEvents: "none",
          });
          document.body.appendChild(cover);
          covered += 1;
        }
      }
      return covered === expected;
    })()`) as Promise<boolean>;
  }

  return {
    async capture() {
      const maskApplied = await applyMask();
      await settle(140);
      const image = await options.window.webContents.capturePage();
      const normalized = image.getSize().width === options.viewport.width ? image : image.resize(options.viewport);
      await options.window.webContents.executeJavaScript(
        `document.querySelectorAll("[data-sf-mask]").forEach((node) => node.remove()), true`,
      );
      return {
        maskApplied,
        capture: { pngBase64: normalized.toPNG().toString("base64"), size: options.viewport },
      };
    },

    async click(point: Point) {
      options.window.webContents.sendInputEvent({ type: "mouseMove", x: point.x, y: point.y });
      options.window.webContents.sendInputEvent({ type: "mouseDown", x: point.x, y: point.y, button: "left", clickCount: 1 });
      options.window.webContents.sendInputEvent({ type: "mouseUp", x: point.x, y: point.y, button: "left", clickCount: 1 });
      await settle(actionSettle);
    },

    async type(point: Point, value: string) {
      await this.click(point);
      options.window.webContents.insertText(value);
      await settle(400);
    },

    async resize(capture: FrameCapture, space: FrameCoordinateSpace) {
      const image = nativeImage.createFromBuffer(Buffer.from(capture.pngBase64, "base64")).resize(space.modelSize);
      return { pngBase64: image.toPNG().toString("base64"), size: space.modelSize };
    },
  };
}
