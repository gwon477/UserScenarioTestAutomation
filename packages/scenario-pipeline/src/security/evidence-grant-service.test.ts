import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SourceScanner } from "../scanning/source-scanner.js";
import { EvidenceGrantService } from "./evidence-grant-service.js";

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

describe("EvidenceGrantService isolated evidence", () => {
  it("creates and reads full-file slices in an external grant directory", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "scenarioforge-evidence-project-"));
    const grantDirectory = await mkdtemp(join(tmpdir(), "scenarioforge-evidence-grants-"));
    await mkdir(join(projectRoot, "src"), { recursive: true });
    await writeFile(join(projectRoot, "src/App.tsx"), "export function App() {\n  return <button>Run</button>;\n}\n", "utf8");
    const snapshot = await new SourceScanner().scan({
      projectRoot, projectId: "P-test", analysisRunId: "RUN-test", sourceSnapshotId: "SS-test",
    });
    const source = snapshot.files.find((file) => file.path === "src/App.tsx")!;
    const service = new EvidenceGrantService(projectRoot, { grantDirectory });

    const { grant, slices } = await service.createFileGrant(snapshot, "work-test", [source.source_id], 10_000);

    expect(grant.evidence).toEqual([expect.objectContaining({
      source_id: source.source_id,
      path: "src/App.tsx",
      start_line: 1,
      end_line: 4,
      evidence_grant_id: grant.evidence_grant_id,
    })]);
    expect(slices).toEqual([{ evidence: grant.evidence[0], content: "export function App() {\n  return <button>Run</button>;\n}\n" }]);
    expect(await exists(join(projectRoot, ".scenarioforge"))).toBe(false);
    expect(JSON.parse(await readFile(join(grantDirectory, `${grant.evidence_grant_id}.json`), "utf8"))).toEqual(grant);
  });

  it("rejects a secret-bearing source before returning any slice", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "scenarioforge-evidence-secret-"));
    const grantDirectory = await mkdtemp(join(tmpdir(), "scenarioforge-evidence-grants-"));
    await writeFile(join(projectRoot, "config.ts"), 'const apiKey = "definitely-secret-value";\n', "utf8");
    const snapshot = await new SourceScanner().scan({
      projectRoot, projectId: "P-test", analysisRunId: "RUN-test", sourceSnapshotId: "SS-test",
    });
    const service = new EvidenceGrantService(projectRoot, { grantDirectory });

    await expect(service.createFileGrant(snapshot, "work-test", [snapshot.files[0].source_id], 10_000))
      .rejects.toThrow("EVIDENCE_SECRET_DETECTED");
  });

  it("can omit a secret-bearing file while granting the remaining safe source", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "scenarioforge-evidence-omit-"));
    const grantDirectory = await mkdtemp(join(tmpdir(), "scenarioforge-evidence-grants-"));
    await writeFile(join(projectRoot, "secret.ts"), 'const apiKey = "definitely-secret-value";\n', "utf8");
    await writeFile(join(projectRoot, "safe.ts"), "export const run = () => true;\n", "utf8");
    const snapshot = await new SourceScanner().scan({
      projectRoot, projectId: "P-test", analysisRunId: "RUN-test", sourceSnapshotId: "SS-test",
    });
    const service = new EvidenceGrantService(projectRoot, { grantDirectory });

    const result = await service.createFileGrant(
      snapshot,
      "work-test",
      snapshot.files.map((file) => file.source_id),
      10_000,
      { secretPolicy: "omit-source" },
    );

    expect(result.slices.map((slice) => slice.evidence.path)).toEqual(["safe.ts"]);
    expect(result.omitted).toEqual([{ source_id: snapshot.files.find((file) => file.path === "secret.ts")!.source_id, reason: "EVIDENCE_SECRET_DETECTED" }]);
  });

  it.each([
    ["GitHub token", 'export const value = "ghp_1234567890abcdefghijkl";\n'],
    ["OpenAI-style token", 'export const value = "sk-1234567890abcdefghijkl";\n'],
    ["JWT", 'export const value = "eyJabcdefghijklmno.eyJpqrstuvwxyz123.abcdefghijklmnop";\n'],
    ["query credential", 'export const url = "https://example.test/run?api_key=1234567890abcdef";\n'],
    ["Stripe secret", 'export const value = "sk_live_1234567890abcdefghijkl";\n'],
    ["Slack token", 'export const value = "xoxb-123456789012-abcdefghijkl";\n'],
    ["Google API key", 'export const value = "AIza1234567890abcdefghijklmnopqrst";\n'],
    ["GitLab token", 'export const value = "glpat-1234567890abcdefghijkl";\n'],
    ["AWS secret access key", 'AWS_SECRET_ACCESS_KEY=1234567890abcdefghijklmnopqrst\n'],
  ])("omits a %s before returning source content", async (_label, content) => {
    const projectRoot = await mkdtemp(join(tmpdir(), "scenarioforge-evidence-expanded-secret-"));
    const grantDirectory = await mkdtemp(join(tmpdir(), "scenarioforge-evidence-grants-"));
    await writeFile(join(projectRoot, "secret.ts"), content, "utf8");
    const snapshot = await new SourceScanner().scan({
      projectRoot, projectId: "P-test", analysisRunId: "RUN-test", sourceSnapshotId: "SS-test",
    });
    const service = new EvidenceGrantService(projectRoot, { grantDirectory });

    const result = await service.createFileGrant(snapshot, "work-test", [snapshot.files[0].source_id], 10_000, { secretPolicy: "omit-source" });

    expect(result.slices).toEqual([]);
    expect(result.omitted).toEqual([{ source_id: snapshot.files[0].source_id, reason: "EVIDENCE_SECRET_DETECTED" }]);
  });

  it("allows credential references that do not contain a hard-coded value", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "scenarioforge-evidence-credential-reference-"));
    const grantDirectory = await mkdtemp(join(tmpdir(), "scenarioforge-evidence-grants-"));
    await writeFile(join(projectRoot, "safe.ts"), "const payload = { password: credentials.password };\n", "utf8");
    const snapshot = await new SourceScanner().scan({
      projectRoot, projectId: "P-test", analysisRunId: "RUN-test", sourceSnapshotId: "SS-test",
    });
    const service = new EvidenceGrantService(projectRoot, { grantDirectory });

    const result = await service.createFileGrant(snapshot, "work-test", [snapshot.files[0].source_id], 10_000, { secretPolicy: "omit-source" });

    expect(result.slices).toHaveLength(1);
  });
});
