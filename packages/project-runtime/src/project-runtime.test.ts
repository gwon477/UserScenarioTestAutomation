import { mkdtemp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ProjectBootstrapper, ProjectPathPolicy } from "./index.js";

describe("project runtime bootstrap", () => {
  it("teaches the FACT agent to return opaque references instead of canonical IDs", async () => {
    const skill = await readFile(new URL("../runtime-template/skills/generation/fact-extraction-react/SKILL.md", import.meta.url), "utf8");
    const agent = await readFile(new URL("../runtime-template/agents/generation/fact-analyst.md", import.meta.url), "utf8");

    expect(skill).toContain("screen_ref");
    expect(skill).toContain("element_ref");
    expect(skill).toContain("api_ref");
    expect(`${skill}\n${agent}`).toContain("opaque");
    expect(skill).not.toContain("Use `SCR-*`, `EL-*`, and `API-*`");
  });

  it("teaches the WIKI agent to omit workflows without FACT-supported terminals", async () => {
    const skill = await readFile(new URL("../runtime-template/skills/generation/wiki-compose/SKILL.md", import.meta.url), "utf8");
    const agent = await readFile(new URL("../runtime-template/agents/generation/wiki-writer.md", import.meta.url), "utf8");

    expect(`${skill}\n${agent}`).toContain("reachable FACT edge path");
    expect(`${skill}\n${agent}`).toContain("Omit workflows");
  });

  it("teaches FACT authors to distinguish initial artifacts from limited correction patches", async () => {
    const resources = await Promise.all([
      "../runtime-template/harnesses/generation/fact-catalog.md",
      "../runtime-template/harnesses/generation/edge-ledger.md",
      "../runtime-template/skills/generation/fact-catalog-author/SKILL.md",
      "../runtime-template/skills/generation/edge-ledger-author/SKILL.md",
    ].map((path) => readFile(new URL(path, import.meta.url), "utf8")));

    expect(resources.every((resource) => resource.includes("fact-correction-patch-v1"))).toBe(true);
    expect(resources.every((resource) => resource.includes("correction_plan"))).toBe(true);
    expect(resources.join("\n")).toContain("omit every untargeted edge");
  });

  it("is idempotent and never modifies project source files", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "scenarioforge-project-"));
    await mkdir(join(projectRoot, "src"));
    const sourcePath = join(projectRoot, "src", "index.ts");
    await writeFile(sourcePath, "export const source = true;\n", "utf8");
    const bootstrapper = new ProjectBootstrapper();
    const request = { projectRoot, projectId: "project-1", runtimeVersion: "1.0.0", protocolVersion: "1" };
    await bootstrapper.bootstrap(request);
    await bootstrapper.bootstrap(request);
    expect(await readFile(sourcePath, "utf8")).toBe("export const source = true;\n");
    expect(JSON.parse(await readFile(join(projectRoot, ".scenarioforge/runtime/runtime-manifest.json"), "utf8")).files["WORK_PROTOCOL.md"]).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects a staging symlink that escapes the selected project", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "scenarioforge-policy-"));
    const outside = await mkdtemp(join(tmpdir(), "scenarioforge-outside-"));
    const staging = join(projectRoot, ".scenarioforge", "staging", "work-1");
    await mkdir(staging, { recursive: true });
    await symlink(outside, join(staging, "escape"));
    const policy = await ProjectPathPolicy.create(projectRoot);
    await expect(policy.assertWritableStagingPath("work-1", join(staging, "escape", "artifact.json"))).rejects.toMatchObject({ code: "STAGING_SCOPE_VIOLATION" });
  });

  it("rejects a pre-existing .scenarioforge symlink that escapes the project", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "scenarioforge-bootstrap-escape-"));
    const outside = await mkdtemp(join(tmpdir(), "scenarioforge-runtime-outside-"));
    await symlink(outside, join(projectRoot, ".scenarioforge"));
    await expect(new ProjectBootstrapper().bootstrap({ projectRoot, projectId: "project-1", runtimeVersion: "1", protocolVersion: "1" })).rejects.toMatchObject({ code: "RUNTIME_ROOT_ESCAPE" });
  });

  it("rejects a nested symlink before installing runtime resources", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "scenarioforge-nested-escape-"));
    const outside = await mkdtemp(join(tmpdir(), "scenarioforge-nested-outside-"));
    await mkdir(join(projectRoot, ".scenarioforge", "runtime"), { recursive: true });
    await symlink(outside, join(projectRoot, ".scenarioforge", "runtime", "harnesses"));
    await expect(new ProjectBootstrapper().bootstrap({ projectRoot, projectId: "project-1", runtimeVersion: "1", protocolVersion: "1" })).rejects.toThrow("RUNTIME_SYMLINK_FORBIDDEN");
  });
});
