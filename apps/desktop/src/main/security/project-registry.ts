import { randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

/* 연결한 프로젝트 목록.
 *
 * 항목은 사용자가 디렉터리 선택 대화상자로 고른 경로만이다. renderer 가 준
 * 경로를 그대로 넣지 않는다.
 *
 * 경로가 사라진 항목도 목록에 남긴다. 조용히 지우면 사용자는 자기 프로젝트가
 * 어디로 갔는지 알 수 없다. 「경로 없음」으로 보여주고 다시 지정하게 한다.
 *
 * v1 문서(경로 하나)는 읽어서 첫 항목으로 옮긴다.
 */

export type ProjectRegistryEntry = {
  /** 등록 시점의 정규화된 경로. 지금 존재하는지는 보장하지 않는다. */
  path: string;
  addedAt: string;
  lastOpenedAt?: string;
};

type RegistryDocumentV1 = { schemaVersion: 1; path: string };
type RegistryDocumentV2 = {
  schemaVersion: 2;
  projects: ProjectRegistryEntry[];
  lastOpenedPath?: string;
};

function isEntry(value: unknown): value is ProjectRegistryEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<ProjectRegistryEntry>;
  return (
    typeof entry.path === "string" &&
    Boolean(entry.path.trim()) &&
    typeof entry.addedAt === "string" &&
    (entry.lastOpenedAt === undefined || typeof entry.lastOpenedAt === "string")
  );
}

function parse(value: unknown): RegistryDocumentV2 | null {
  if (!value || typeof value !== "object") return null;
  /* v1 과 v2 는 `schemaVersion` 리터럴이 달라 교차 타입이 never 가 된다.
   * 읽을 때는 두 모양을 함께 볼 수 있는 느슨한 형태로 좁힌다. */
  const document = value as {
    schemaVersion?: RegistryDocumentV1["schemaVersion"] | RegistryDocumentV2["schemaVersion"];
    path?: unknown;
    projects?: unknown;
    lastOpenedPath?: unknown;
  };
  if (document.schemaVersion === 1 && typeof document.path === "string" && document.path.trim()) {
    // v1 은 경로 하나만 담았다. 등록 시각은 알 수 없으므로 비워 둘 수 없어 epoch 을 쓴다.
    return {
      schemaVersion: 2,
      projects: [{ path: document.path, addedAt: new Date(0).toISOString() }],
      lastOpenedPath: document.path,
    };
  }
  if (document.schemaVersion !== 2 || !Array.isArray(document.projects)) return null;
  const projects = document.projects.filter(isEntry);
  return {
    schemaVersion: 2,
    projects,
    ...(typeof document.lastOpenedPath === "string" ? { lastOpenedPath: document.lastOpenedPath } : {}),
  };
}

/** 실제 디렉터리인지 확인하고 심볼릭 링크를 푼다. 없으면 던진다. */
export async function canonicalDirectory(pathInput: string): Promise<string> {
  const canonical = await realpath(resolve(pathInput));
  const metadata = await stat(canonical);
  if (!metadata.isDirectory()) throw new Error("PROJECT_DIRECTORY_INVALID");
  return canonical;
}

export class ProjectRegistry {
  constructor(private readonly filePath: string) {}

  private async read(): Promise<RegistryDocumentV2> {
    try {
      return parse(JSON.parse(await readFile(this.filePath, "utf8"))) ?? { schemaVersion: 2, projects: [] };
    } catch {
      return { schemaVersion: 2, projects: [] };
    }
  }

  private async write(document: RegistryDocumentV2): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, `${JSON.stringify(document, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
      await rename(temporaryPath, this.filePath);
    } finally {
      await rm(temporaryPath, { force: true });
    }
  }

  /** 마지막으로 연 프로젝트. 경로가 사라졌으면 null 이다. */
  async load(): Promise<string | null> {
    const document = await this.read();
    const candidate = document.lastOpenedPath ?? document.projects[0]?.path;
    if (!candidate) return null;
    try {
      return await canonicalDirectory(candidate);
    } catch {
      return null;
    }
  }

  /** 등록 순서와 무관하게 최근 열람순으로 준다. 자주 쓰는 것이 위에 온다. */
  async list(): Promise<ProjectRegistryEntry[]> {
    const { projects } = await this.read();
    return [...projects].sort(
      (left, right) =>
        (right.lastOpenedAt ?? right.addedAt).localeCompare(left.lastOpenedAt ?? left.addedAt) ||
        left.path.localeCompare(right.path),
    );
  }

  async add(pathInput: string, at: string): Promise<string> {
    const canonical = await canonicalDirectory(pathInput);
    const document = await this.read();
    const existing = document.projects.find((entry) => entry.path === canonical);
    if (existing) existing.lastOpenedAt = at;
    else document.projects.push({ path: canonical, addedAt: at, lastOpenedAt: at });
    document.lastOpenedPath = canonical;
    await this.write(document);
    return canonical;
  }

  /** 이미 등록된 항목의 열람 시각만 올린다. 없는 경로를 만들지 않는다. */
  async touch(canonical: string, at: string): Promise<void> {
    const document = await this.read();
    const entry = document.projects.find((candidate) => candidate.path === canonical);
    if (!entry) return;
    entry.lastOpenedAt = at;
    document.lastOpenedPath = canonical;
    await this.write(document);
  }

  /** 목록에서만 뺀다. 디스크의 분석 결과는 그대로 둔다.
   * 되돌리기를 위해 지운 항목을 그대로 돌려준다. */
  async remove(canonical: string): Promise<ProjectRegistryEntry | null> {
    const document = await this.read();
    const removed = document.projects.find((entry) => entry.path === canonical) ?? null;
    document.projects = document.projects.filter((entry) => entry.path !== canonical);
    if (document.lastOpenedPath === canonical) delete document.lastOpenedPath;
    await this.write(document);
    return removed;
  }

  /** 해제한 항목을 등록 시각까지 그대로 되돌린다. */
  async restore(entry: ProjectRegistryEntry): Promise<void> {
    const document = await this.read();
    if (document.projects.some((candidate) => candidate.path === entry.path)) return;
    document.projects.push(entry);
    await this.write(document);
  }

  /** 경로를 옮긴 프로젝트를 다시 지정한다. 등록 시각은 유지한다. */
  async relink(previous: string, pathInput: string, at: string): Promise<string> {
    const canonical = await canonicalDirectory(pathInput);
    const document = await this.read();
    const moved = document.projects.find((candidate) => candidate.path === previous);
    const kept = document.projects.filter(
      (candidate) => candidate.path !== previous && candidate.path !== canonical,
    );
    document.projects = [
      ...kept,
      { path: canonical, addedAt: moved?.addedAt ?? at, lastOpenedAt: at },
    ];
    document.lastOpenedPath = canonical;
    await this.write(document);
    return canonical;
  }
}
