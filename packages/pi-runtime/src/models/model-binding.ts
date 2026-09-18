export type ModelRole = "author" | "reviewer";

export type ModelBinding = {
  role: ModelRole;
  provider: string;
  api?: "openai-completions" | "openai-responses" | "anthropic-messages" | "azure-openai-chat-completions";
  modelId: string;
  endpoint: string;
  apiVersion?: string;
  credentialRef: string;
  dataPolicyAccepted: boolean;
};

export function assertModelBinding(binding: ModelBinding): void {
  if (!binding.provider.trim() || !binding.modelId.trim() || !binding.endpoint.trim()) throw new Error("INVALID_MODEL_BINDING");
  if (binding.api === "azure-openai-chat-completions" && !binding.apiVersion?.trim()) throw new Error("AZURE_OPENAI_API_VERSION_REQUIRED");
  if (!binding.credentialRef.trim()) throw new Error("CREDENTIAL_REFERENCE_REQUIRED");
  if (!binding.dataPolicyAccepted) throw new Error("DATA_POLICY_CONSENT_REQUIRED");
  const endpoint = new URL(binding.endpoint);
  if (endpoint.username || endpoint.password) throw new Error("MODEL_ENDPOINT_CREDENTIAL_FORBIDDEN");
  if (endpoint.hash || [...endpoint.searchParams.keys()].some((key) => /(?:api.?key|token|secret|password|auth)/i.test(key))) throw new Error("MODEL_ENDPOINT_CREDENTIAL_FORBIDDEN");
  const protocol = endpoint.protocol;
  const localHttp = protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(endpoint.hostname);
  if (protocol !== "https:" && !localHttp) {
    throw new Error("INSECURE_MODEL_ENDPOINT");
  }
}
