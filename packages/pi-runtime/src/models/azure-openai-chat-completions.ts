import { streamSimple as streamSimpleOpenAICompletions } from "@earendil-works/pi-ai/api/openai-completions";
import type { Api, Context, Model, SimpleStreamOptions } from "@earendil-works/pi-ai";
import type { ModelBinding } from "./model-binding.js";

export function buildAzureOpenAIChatCompletionsBaseUrl(binding: ModelBinding): string {
  const endpoint = new URL(binding.endpoint);
  const basePath = endpoint.pathname.replace(/\/+$/, "");
  endpoint.pathname = `${basePath}/openai/deployments/${encodeURIComponent(binding.modelId)}`;
  endpoint.search = "";
  endpoint.hash = "";
  return endpoint.toString().replace(/\/$/, "");
}

export function createAzureOpenAIChatCompletionsFetch(input: {
  apiKey: string;
  apiVersion: string;
  upstreamFetch: typeof fetch;
  promptCache?: { key: string; explicit: boolean };
}): typeof fetch {
  return async (requestInput, requestInit) => {
    const request = new Request(requestInput, requestInit);
    const url = new URL(request.url);
    url.searchParams.set("api-version", input.apiVersion);
    const headers = new Headers(request.headers);
    headers.delete("authorization");
    headers.set("api-key", input.apiKey);
    let body: BodyInit | null | undefined = request.method === "GET" || request.method === "HEAD" ? undefined : request.body;
    if (body && input.promptCache && headers.get("content-type")?.includes("application/json")) {
      const payload = await request.clone().json() as Record<string, unknown>;
      payload.prompt_cache_key = input.promptCache.key;
      if (input.promptCache.explicit) {
        payload.prompt_cache_options = { mode: "explicit", ttl: "30m" };
        const messages = Array.isArray(payload.messages) ? payload.messages : [];
        const breakpointMessage = messages.find((message) => message && typeof message === "object" && ["system", "developer"].includes(String((message as { role?: unknown }).role))) as { content?: unknown } | undefined;
        if (breakpointMessage) {
          if (typeof breakpointMessage.content === "string") {
            breakpointMessage.content = [{ type: "text", text: breakpointMessage.content, prompt_cache_breakpoint: { mode: "explicit" } }];
          } else if (Array.isArray(breakpointMessage.content) && breakpointMessage.content.length) {
            const last = breakpointMessage.content.at(-1);
            if (last && typeof last === "object") (last as Record<string, unknown>).prompt_cache_breakpoint = { mode: "explicit" };
          }
        }
      }
      body = JSON.stringify(payload);
      headers.delete("content-length");
    }
    const init: RequestInit & { duplex?: "half" } = {
      method: request.method,
      headers,
      body,
      cache: request.cache,
      credentials: request.credentials,
      integrity: request.integrity,
      keepalive: request.keepalive,
      mode: request.mode,
      redirect: request.redirect,
      referrer: request.referrer,
      referrerPolicy: request.referrerPolicy,
      signal: request.signal,
      duplex: body && typeof body !== "string" ? "half" : undefined,
    };
    return input.upstreamFetch(url, init);
  };
}

export function createAzureOpenAIChatCompletionsStreamSimple(binding: ModelBinding) {
  return (model: Model<Api>, context: Context, options?: SimpleStreamOptions) => {
    const apiKey = options?.apiKey;
    if (!apiKey) throw new Error(`No API key for provider: ${model.provider}`);
    const azureModel = {
      ...model,
      api: "openai-completions" as const,
      baseUrl: buildAzureOpenAIChatCompletionsBaseUrl(binding),
    };
    return streamSimpleOpenAICompletions(azureModel, context, {
      ...options,
      apiKey,
      fetch: createAzureOpenAIChatCompletionsFetch({
        apiKey,
        apiVersion: binding.apiVersion!,
        upstreamFetch: options?.fetch ?? globalThis.fetch,
        ...(binding.modelId.startsWith("gpt-5.6") ? { promptCache: { key: `scenarioforge:${binding.role}:${binding.modelId}:generation-v2`, explicit: true } } : {}),
      }),
    });
  };
}
