import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { buildAzureOpenAIChatCompletionsBaseUrl, createAzureOpenAIChatCompletionsStreamSimple } from "./azure-openai-chat-completions.js";
import type { ModelBinding } from "./model-binding.js";
import { assertModelBinding } from "./model-binding.js";

export async function createConfiguredModelRuntime(bindings: ModelBinding[], secretFor: (credentialRef: string) => string | undefined): Promise<ModelRuntime> {
  const runtime = await ModelRuntime.create({ refreshOnCreate: false, allowModelNetwork: false });
  for (const binding of bindings) {
    assertModelBinding(binding);
    const azureChatCompletions = binding.api === "azure-openai-chat-completions";
    const runtimeApi = azureChatCompletions ? "openai-completions" : binding.api ?? "openai-completions";
    runtime.registerProvider(binding.provider, {
      name: binding.provider,
      baseUrl: azureChatCompletions ? buildAzureOpenAIChatCompletionsBaseUrl(binding) : binding.endpoint,
      api: runtimeApi,
      ...(azureChatCompletions ? { streamSimple: createAzureOpenAIChatCompletionsStreamSimple(binding) } : {}),
      models: [{ id: binding.modelId, name: binding.modelId, api: runtimeApi, reasoning: !azureChatCompletions, input: ["text", "image"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128_000, maxTokens: 16_384 }],
    });
    const secret = secretFor(binding.credentialRef);
    if (secret) await runtime.setRuntimeApiKey(binding.provider, secret);
  }
  return runtime;
}
