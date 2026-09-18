import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

/* 셸 레이아웃을 지탱하는 규칙들. 죽은 CSS 정리에서 실수로 지워진 적이 있고,
 * 지워지면 화면이 조용히 깨진다(3분할이 세로로 쌓임). 여기서 고정한다. */

const css = async () =>
  (await readFile(new URL("./base.css", import.meta.url), "utf8")) +
  (await readFile(new URL("./system.css", import.meta.url), "utf8"));

describe("shell layout contract", () => {
  it("pins the shell to the viewport so only the body scrolls", async () => {
    const source = await css();

    expect(source).toMatch(/\.app-shell\s*\{[^}]*height:\s*100vh/);
    expect(source).toMatch(/\.app-shell\s*\{[^}]*display:\s*flex/);
    expect(source).toMatch(/\.app-shell\s*\{[^}]*overflow:\s*hidden/);
  });

  it("keeps the split body from scrolling so panels can size themselves", async () => {
    const source = await css();

    expect(source).toMatch(/\.body-split\{[^}]*display:flex/);
    expect(source).toMatch(/\.body-split\{[^}]*overflow:hidden/);
    expect(source).toMatch(/\.body-split > \.split-3\{[^}]*display:grid/);
    expect(source).toMatch(/\.body-split > \.split-3\{[^}]*flex:1/);
  });

  it("keeps the page body scrollable", async () => {
    const source = await css();

    expect(source).toMatch(/\.body\{[^}]*overflow:auto/);
    expect(source).toMatch(/\.body\{[^}]*flex:1/);
  });
});
