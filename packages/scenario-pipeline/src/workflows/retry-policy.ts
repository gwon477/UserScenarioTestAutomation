export function retryDelay(category: string, attempt: number): number | null {
  if (!["provider-timeout", "provider-rate-limit", "network-transient"].includes(category)) return null;
  const schedule = category === "provider-rate-limit" ? [60_000, 120_000] : [1_000, 3_000];
  return schedule[attempt - 1] ?? null;
}
