import { describe, expect, it } from "vitest";
import type { VisionStepEnvelope } from "@scenarioforge/test-runtime";
import { createVisionModels, type VisionModelTransport } from "./vision-model-client";

const binding = { endpoint: "https://example.invalid", modelId: "model", apiVersion: "2024-12-01-preview" };

const envelope = {
  stepId: "SCN-1#1",
  allowedActions: ["click"],
  target: { visibleLabel: "로그인", controlKind: "button", surfaceHint: "/login" },
} as unknown as VisionStepEnvelope;

function transportOf(reply: unknown, capture?: { messages?: unknown[] }): VisionModelTransport {
  return async ({ messages }) => {
    if (capture) capture.messages = messages;
    return JSON.stringify(reply);
  };
}

describe("vision model client", () => {
  it("returns null when the model says it cannot see the target", async () => {
    const models = createVisionModels({ binding, transport: transportOf({ found: false }) });

    expect(await models.propose({ pngBase64: "x", frameSize: { width: 1229, height: 768 }, envelope })).toBeNull();
  });

  it("returns null rather than a guess when the point is not numeric", async () => {
    const models = createVisionModels({ binding, transport: transportOf({ found: true, point: { x: "left", y: 10 } }) });

    expect(await models.propose({ pngBase64: "x", frameSize: { width: 1229, height: 768 }, envelope })).toBeNull();
  });

  it("rounds the reported point and carries the observed label", async () => {
    const models = createVisionModels({
      binding,
      transport: transportOf({ found: true, point: { x: 614.6, y: 481.2 }, observedLabel: "로그인", confidence: 0.99 }),
    });

    expect(await models.propose({ pngBase64: "x", frameSize: { width: 1229, height: 768 }, envelope })).toEqual({
      stepId: "SCN-1#1",
      action: "click",
      point: { x: 615, y: 481 },
      observedLabel: "로그인",
      confidence: 0.99,
    });
  });

  it("tells the model the frame size it is looking at", async () => {
    const capture: { messages?: unknown[] } = {};
    const models = createVisionModels({ binding, transport: transportOf({ found: false }, capture) });

    await models.propose({ pngBase64: "x", frameSize: { width: 1229, height: 768 }, envelope });

    expect(JSON.stringify(capture.messages)).toContain("1229 x 768");
  });

  it("keeps only strings the model reported as visible", async () => {
    const models = createVisionModels({ binding, transport: transportOf({ visibleTexts: ["대시보드", 5, null] }) });

    expect(await models.observe({ pngBase64: "x", frameSize: { width: 1229, height: 768 }, questions: ["대시보드"] })).toEqual({
      texts: ["대시보드"],
    });
  });

  it("treats a missing visibleTexts field as nothing observed", async () => {
    const models = createVisionModels({ binding, transport: transportOf({}) });

    expect(await models.observe({ pngBase64: "x", frameSize: { width: 1229, height: 768 }, questions: ["대시보드"] })).toEqual({
      texts: [],
    });
  });

  it("fails with a classified error rather than leaking the response body", async () => {
    const models = createVisionModels({
      binding,
      transport: async () => "not json",
    });

    await expect(
      models.observe({ pngBase64: "x", frameSize: { width: 1229, height: 768 }, questions: ["대시보드"] }),
    ).rejects.toThrow("VISION_MODEL_RESPONSE_UNPARSEABLE");
  });

  it("never puts the credential into the prompt", async () => {
    const capture: { messages?: unknown[] } = {};
    const models = createVisionModels({ binding, transport: transportOf({ found: false }, capture) });

    await models.propose({ pngBase64: "x", frameSize: { width: 1229, height: 768 }, envelope });

    expect(JSON.stringify(capture.messages)).not.toContain("api-key");
  });
});
