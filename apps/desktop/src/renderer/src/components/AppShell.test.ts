import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const source = () => readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");

describe("app shell", () => {
  it("switches the body class on the layout prop", async () => {
    const code = await source();

    /* 상세 화면은 패널이 각자 스크롤한다. 본문이 스크롤하면 3분할 패널의 높이가
     * 정해지지 않아 세로로 쌓인다. 실제로 그렇게 깨진 적이 있다. */
    expect(code).toContain('layout === "split" ? "body body-split" : "body pad-lg"');
    expect(code).not.toMatch(/className="body pad-lg"/);
  });

  it("keeps the skip link target on the body landmark", async () => {
    const code = await source();

    expect(code).toContain('id="main-content"');
    expect(code).toContain("<main");
  });

  it("hides the project chrome when no project is open", async () => {
    const code = await source();

    expect(code).toContain("{project && activeView && onNavigate && (");
    expect(code).toContain("{project && (");
  });
});
