export type RegisteredHarnessPolicy = Readonly<{ workKind: string; resourceProfile: string; writableEntities: readonly string[] }>;

export class HarnessPolicyRegistry {
  private readonly policies: ReadonlyMap<string, RegisteredHarnessPolicy>;

  constructor(policies: readonly RegisteredHarnessPolicy[]) {
    this.policies = new Map(policies.map((policy) => [policy.workKind, Object.freeze({ ...policy, writableEntities: Object.freeze([...policy.writableEntities]) })]));
  }

  get(workKind: string): RegisteredHarnessPolicy {
    const policy = this.policies.get(workKind);
    if (!policy) throw new Error("HARNESS_POLICY_NOT_FOUND");
    return policy;
  }
}
