import { realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

export class ProjectPathPolicyError extends Error {
  constructor(public readonly code: string, message = code) {
    super(message);
    this.name = "ProjectPathPolicyError";
  }
}

const inside = (root: string, candidate: string): boolean => {
  const relation = relative(root, candidate);
  return relation === "" || (!relation.startsWith(`..${sep}`) && relation !== ".." && !isAbsolute(relation));
};

async function nearestExistingCanonical(path: string): Promise<{ canonicalParent: string; suffix: string[] }> {
  const suffix: string[] = [];
  let cursor = resolve(path);
  while (true) {
    try {
      await stat(cursor);
      return { canonicalParent: await realpath(cursor), suffix };
    } catch {
      const parent = dirname(cursor);
      if (parent === cursor) throw new ProjectPathPolicyError("PATH_NOT_RESOLVABLE");
      suffix.unshift(cursor.slice(parent.length + 1));
      cursor = parent;
    }
  }
}

async function canonicalCandidate(path: string): Promise<string> {
  const { canonicalParent, suffix } = await nearestExistingCanonical(path);
  return resolve(canonicalParent, ...suffix);
}

export class ProjectPathPolicy {
  private constructor(public readonly projectRoot: string) {}

  static async create(projectRoot: string): Promise<ProjectPathPolicy> {
    return new ProjectPathPolicy(await realpath(projectRoot));
  }

  async assertReadableProjectPath(path: string): Promise<string> {
    const canonical = await realpath(resolve(path));
    if (!inside(this.projectRoot, canonical)) throw new ProjectPathPolicyError("PROJECT_PATH_ESCAPE");
    return canonical;
  }

  async assertWritableStagingPath(workId: string, path: string): Promise<string> {
    if (!workId.trim()) throw new ProjectPathPolicyError("EMPTY_WORK_ID");
    const stagingRoot = resolve(this.projectRoot, ".scenarioforge", "staging", workId);
    const canonicalRoot = await canonicalCandidate(stagingRoot);
    const canonical = await canonicalCandidate(path);
    if (!inside(canonicalRoot, canonical)) throw new ProjectPathPolicyError("STAGING_SCOPE_VIOLATION");
    return canonical;
  }

  async assertManagedRuntimeRoot(path: string): Promise<string> {
    const canonical = await canonicalCandidate(path);
    if (!inside(this.projectRoot, canonical)) throw new ProjectPathPolicyError("RUNTIME_ROOT_ESCAPE");
    return canonical;
  }

  async assertRuntimeStateWriteDenied(path: string): Promise<void> {
    const stateRoot = await canonicalCandidate(resolve(this.projectRoot, ".scenarioforge", "state"));
    const canonical = await canonicalCandidate(path);
    if (inside(stateRoot, canonical)) throw new ProjectPathPolicyError("CANONICAL_STATE_WRITE_DENIED");
  }
}
