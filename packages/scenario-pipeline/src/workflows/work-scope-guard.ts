import type { WorkDescriptor } from "@scenarioforge/contracts";

export type OwnedMutation = { entityOwnerWorkId: string };
export type ChildResult = { workId: string; parentWorkId?: string; status: "running" | "settled" | "failed" };

export class WorkScopeGuard {
  assertMutation(work: WorkDescriptor, mutation: OwnedMutation): void {
    if (work.workId !== mutation.entityOwnerWorkId) throw new Error("WORK_SCOPE_VIOLATION");
  }

  assertWriteScope(work: WorkDescriptor, path: string): void {
    const normalized = path.replaceAll("\\", "/").replace(/^\.\//, "");
    const scope = `.scenarioforge/staging/${work.workId}`;
    if (normalized !== scope && !normalized.startsWith(`${scope}/`)) throw new Error("WORK_SCOPE_VIOLATION");
  }
}

export function canIntegrateChild(parent: WorkDescriptor, child: ChildResult): boolean {
  return child.parentWorkId === parent.workId && child.status === "settled";
}
