import { describe, expect, it } from "vitest";
import {
  createFrameCoordinateSpace,
  MODEL_FRAME_SHORT_SIDE,
  toCaptureSpace,
  toModelSpace,
} from "./frame-coordinate-space.js";

describe("frame coordinate space", () => {
  it("normalizes the short side to the measured model frame size", () => {
    const space = createFrameCoordinateSpace({ width: 1440, height: 900 });

    expect(MODEL_FRAME_SHORT_SIDE).toBe(768);
    expect(space.modelSize).toEqual({ width: 1229, height: 768 });
    expect(space.scale).toBeCloseTo(0.8533, 4);
  });

  it("recovers the capture coordinate the probe measured as a systematic miss", () => {
    // PROBE-20260907-01 AXSE 01-login-form: 「로그인」 버튼의 실제 사각형은
    // x 557..883, y 544..585 이고 모델은 (615, 482)를 답해 134px 어긋난
    // miss 로 집계됐다. 환산하면 버튼 안으로 들어온다.
    const space = createFrameCoordinateSpace({ width: 1440, height: 900 });

    const point = toCaptureSpace(space, { x: 615, y: 482 });

    expect(point).toEqual({ x: 721, y: 565 });
    expect(point.x).toBeGreaterThanOrEqual(557);
    expect(point.x).toBeLessThanOrEqual(883);
    expect(point.y).toBeGreaterThanOrEqual(544);
    expect(point.y).toBeLessThanOrEqual(585);
  });

  it("round-trips a capture coordinate within a pixel", () => {
    const space = createFrameCoordinateSpace({ width: 1440, height: 900 });
    const original = { x: 1337, y: 844 };

    const restored = toCaptureSpace(space, toModelSpace(space, original));

    expect(Math.abs(restored.x - original.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(restored.y - original.y)).toBeLessThanOrEqual(1);
  });

  it("does not upscale a capture smaller than the target short side", () => {
    const space = createFrameCoordinateSpace({ width: 800, height: 600 });

    expect(space.scale).toBe(1);
    expect(space.modelSize).toEqual({ width: 800, height: 600 });
  });

  it("rejects an unusable frame size", () => {
    expect(() => createFrameCoordinateSpace({ width: 0, height: 900 })).toThrow("FRAME_SIZE_INVALID");
    expect(() => createFrameCoordinateSpace({ width: 1440, height: 900 }, 0)).toThrow("FRAME_SHORT_SIDE_INVALID");
  });
});
