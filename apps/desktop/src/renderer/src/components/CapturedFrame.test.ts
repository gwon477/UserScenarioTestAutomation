import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const source = () => readFile(new URL("./CapturedFrame.tsx", import.meta.url), "utf8");

describe("captured frame", () => {
  it("overlays the proposal only on the frame that was sent to the model", async () => {
    const code = await source();

    expect(code).toContain('frame.kind === "model-input"');
    expect(code).toContain("frame-marker");
  });

  it("positions the marker in the model frame coordinate space", async () => {
    const code = await source();

    expect(code).toContain("(proposalPoint.x / frame.size.width) * 100");
    expect(code).toContain("(proposalPoint.y / frame.size.height) * 100");
  });

  it("labels the masked regions so a black box is not read as a fault", async () => {
    const code = await source();

    expect(code).toContain("마스킹됨");
  });

  it("names which frame is shown rather than showing a bare image", async () => {
    const code = await source();

    for (const label of ["조작 전", "모델 전송본", "조작 후 관측"]) {
      expect(code).toContain(label);
    }
  });

  it("says so when the capture could not be loaded instead of showing a blank box", async () => {
    const code = await source();

    expect(code).toContain("캡처를 불러오지 못했습니다");
  });
});
