import type { ObservedFrame, VisionActionProposal, VisionStepEnvelope } from "@scenarioforge/test-runtime";
import type { VisionModels } from "./test-vista-runner";

/* operator 와 observer 모델 호출.
 *
 * 두 역할을 별도 요청으로 분리한다. 자기 행동을 스스로 성공 판정하지 않게
 * 하기 위해서다. 프롬프트에는 자격증명도 데이터 원문도 담지 않는다.
 *
 * 계약은 docs/architecture/07-vision-first-execution-design.md §9 를 따른다.
 */

const OPERATOR_SYSTEM = `You locate one named UI control inside a screenshot.
- The screenshot is WIDTH x HEIGHT pixels. Top-left is (0, 0).
- Return the integer point a user would click to operate that control.
- Report the text you actually read at that point in observedLabel.
- If you cannot see it, set found to false. Never guess a coordinate.
Answer with JSON only: {"found":true,"point":{"x":0,"y":0},"observedLabel":"...","confidence":0.0}`;

const OBSERVER_SYSTEM = `You read a screenshot and report which of the given strings are actually visible.
- Include a string in visibleTexts only if you can read it on the screen.
- Do not infer, complete, or normalize. Do not add anything you did not read.
- Report the text as it appears.
Answer with JSON only: {"visibleTexts":["..."]}`;

export type VisionModelBinding = {
  endpoint: string;
  modelId: string;
  apiVersion: string;
  maxCompletionTokens?: number;
};

export type VisionModelTransport = (input: {
  binding: VisionModelBinding;
  messages: unknown[];
}) => Promise<string>;

/** 기본 전송. Azure OpenAI chat completions 형식이다. */
export function createAzureVisionTransport(secretFor: () => string): VisionModelTransport {
  return async ({ binding, messages }) => {
    const url = `${binding.endpoint}/openai/deployments/${encodeURIComponent(binding.modelId)}/chat/completions?api-version=${binding.apiVersion}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "api-key": secretFor() },
      body: JSON.stringify({
        messages,
        max_completion_tokens: binding.maxCompletionTokens ?? 2000,
        response_format: { type: "json_object" },
      }),
    });
    const text = await response.text();
    // 응답 본문을 그대로 노출하지 않는다. 상태 코드와 분류만 남긴다.
    if (!response.ok) throw new Error(`VISION_MODEL_CALL_FAILED_${response.status}`);
    const payload = JSON.parse(text) as { choices?: Array<{ message?: { content?: string } }> };
    const content = payload.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new Error("VISION_MODEL_RESPONSE_EMPTY");
    return content;
  };
}

function parseJson(content: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(content);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("shape");
    return parsed as Record<string, unknown>;
  } catch {
    throw new Error("VISION_MODEL_RESPONSE_UNPARSEABLE");
  }
}

export function createVisionModels(input: {
  binding: VisionModelBinding;
  transport: VisionModelTransport;
}): VisionModels {
  const call = async (system: string, text: string, pngBase64: string) =>
    parseJson(
      await input.transport({
        binding: input.binding,
        messages: [
          { role: "system", content: system },
          {
            role: "user",
            content: [
              { type: "text", text },
              { type: "image_url", image_url: { url: `data:image/png;base64,${pngBase64}`, detail: "high" } },
            ],
          },
        ],
      }),
    );

  return {
    async propose({ pngBase64, frameSize, envelope }) {
      const answer = await call(
        OPERATOR_SYSTEM.replace("WIDTH", String(frameSize.width)).replace("HEIGHT", String(frameSize.height)),
        `Locate the ${envelope.target.controlKind} labelled "${envelope.target.visibleLabel}" on the ${envelope.target.surfaceHint} screen.`,
        pngBase64,
      );
      const point = answer.point as { x?: unknown; y?: unknown } | undefined;
      // 못 찾았다는 답은 추측이 아니다. 좌표를 만들어내지 않는다.
      if (answer.found !== true || !point || typeof point.x !== "number" || typeof point.y !== "number") return null;
      return {
        stepId: envelope.stepId,
        action: envelope.allowedActions[0]!,
        point: { x: Math.round(point.x), y: Math.round(point.y) },
        observedLabel: typeof answer.observedLabel === "string" ? answer.observedLabel : "",
        confidence: typeof answer.confidence === "number" ? answer.confidence : 0,
      } satisfies VisionActionProposal;
    },

    async observe({ pngBase64, frameSize, questions }) {
      const answer = await call(
        OBSERVER_SYSTEM,
        `Screenshot is ${frameSize.width}x${frameSize.height}. Which of these are visible?\n${questions.map((question) => `- ${question}`).join("\n")}`,
        pngBase64,
      );
      const texts = Array.isArray(answer.visibleTexts) ? answer.visibleTexts.filter((entry): entry is string => typeof entry === "string") : [];
      return { texts } satisfies ObservedFrame;
    },
  };
}
