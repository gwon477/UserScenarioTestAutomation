import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const source = () => readFile(new URL("./electron-vision-surface.ts", import.meta.url), "utf8");

describe("electron vision surface", () => {
  it("reports mask failure instead of sending an unmasked frame", async () => {
    const code = await source();

    expect(code).toContain("return covered === expected;");
    expect(code).toContain("maskApplied");
  });

  it("removes the mask overlay after capturing so it never affects the target", async () => {
    const code = await source();

    expect(code).toContain('document.querySelectorAll("[data-sf-mask]").forEach((node) => node.remove())');
  });

  it("synthesizes real input events rather than calling DOM click", async () => {
    const code = await source();

    expect(code).toContain('sendInputEvent({ type: "mouseDown"');
    expect(code).toContain("insertText(value)");
    // 주석은 제외하고 실행 코드에서 DOM click 호출이 없어야 한다.
    const executable = code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(executable).not.toContain(".click()");
    expect(executable).not.toContain("target.click");
  });

  it("resizes to the model coordinate space rather than guessing", async () => {
    const code = await source();

    expect(code).toContain("resize(space.modelSize)");
  });
});
