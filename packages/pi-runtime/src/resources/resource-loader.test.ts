import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ProjectBootstrapper } from "@scenarioforge/project-runtime";
import { generationWorkPolicies } from "@scenarioforge/scenario-pipeline";
import { createConfiguredModelRuntime, createGenerationPiResourceLoader, createStagingJsonTool, hashWorkPolicy, PiSdkDriver, ResourceLoader, workStateToolNames } from "../index.js";

describe("versioned generation resource bundle", () => {
  it("covers every analysis policy with exact policy and protocol hashes", async () => {
    const root = await mkdtemp(join(tmpdir(), "scenarioforge-resources-"));
    await new ProjectBootstrapper().bootstrap({ projectRoot: root, projectId: "project-1", runtimeVersion: "1.0.0", protocolVersion: "1" });
    const bundle = await new ResourceLoader(join(root, ".scenarioforge/runtime")).loadGeneration(generationWorkPolicies, ["author", "reviewer"]);
    for (const [workKind, policy] of Object.entries(generationWorkPolicies).filter(([kind]) => kind.startsWith("analysis."))) {
      expect(bundle.manifest.workKinds[workKind]).toMatchObject({ protocolVersion: bundle.manifest.protocolVersion, policyHash: hashWorkPolicy(policy), harnessDomain: "generation" });
    }
    expect(Object.keys(bundle.resources).some((path) => path.includes("skills/execution"))).toBe(false);
    expect(Object.keys(bundle.resources).some((path) => path.includes("agents/execution"))).toBe(false);
  });

  it("rejects a resource changed after bootstrap", async () => {
    const root = await mkdtemp(join(tmpdir(), "scenarioforge-tamper-"));
    await new ProjectBootstrapper().bootstrap({ projectRoot: root, projectId: "project-1", runtimeVersion: "1.0.0", protocolVersion: "1" });
    await writeFile(join(root, ".scenarioforge/runtime/harnesses/scenario-generation.md"), "tampered", "utf8");
    await expect(new ResourceLoader(join(root, ".scenarioforge/runtime")).loadGeneration(generationWorkPolicies, ["author"])).rejects.toThrow("RESOURCE_HASH_MISMATCH");
  });

  it("loads only role-scoped FACT skills into the real Pi resource loader", async () => {
    const root = await mkdtemp(join(tmpdir(), "scenarioforge-pi-loader-"));
    await new ProjectBootstrapper().bootstrap({ projectRoot: root, projectId: "project-1", runtimeVersion: "1.0.0", protocolVersion: "1" });
    const authorLoader = await createGenerationPiResourceLoader({ projectRoot: root, runtimeRoot: join(root, ".scenarioforge/runtime"), expectedPolicies: generationWorkPolicies, modelRoles: ["author", "reviewer"], modelRole: "author", workKind: "analysis.fact-extract" });
    const reviewerLoader = await createGenerationPiResourceLoader({ projectRoot: root, runtimeRoot: join(root, ".scenarioforge/runtime"), expectedPolicies: generationWorkPolicies, modelRoles: ["author", "reviewer"], modelRole: "reviewer", workKind: "analysis.fact-extract" });
    expect(authorLoader.getSkills().diagnostics.filter((entry) => entry.type === "error")).toEqual([]);
    expect(authorLoader.getSkills().skills.map((skill) => skill.name).sort()).toEqual(["edge-linking", "fact-extraction-react"]);
    expect(reviewerLoader.getSkills().skills.map((skill) => skill.name)).toEqual(["gate-review"]);
  });

  it("loads one-purpose resources for every LLM generation step", async () => {
    const root = await mkdtemp(join(tmpdir(), "scenarioforge-fine-resources-"));
    await new ProjectBootstrapper().bootstrap({ projectRoot: root, projectId: "project-1", runtimeVersion: "1.0.0", protocolVersion: "1" });
    const expected = {
      "analysis.fact-catalog": ["fact-catalog-author", "fact-catalog-review"],
      "analysis.edge-ledger": ["edge-ledger-author", "edge-ledger-review"],
      "analysis.common-wiki": ["common-wiki-author", "common-wiki-review"],
      "analysis.business-catalog": ["business-catalog-author", "business-catalog-review"],
      "analysis.scenario-narration": ["scenario-narration-author", "scenario-narration-review"],
    } as const;

    for (const [workKind, [authorSkill, reviewerSkill]] of Object.entries(expected)) {
      const author = await createGenerationPiResourceLoader({ projectRoot: root, runtimeRoot: join(root, ".scenarioforge/runtime"), expectedPolicies: generationWorkPolicies, modelRoles: ["author", "reviewer"], modelRole: "author", workKind });
      const reviewer = await createGenerationPiResourceLoader({ projectRoot: root, runtimeRoot: join(root, ".scenarioforge/runtime"), expectedPolicies: generationWorkPolicies, modelRoles: ["author", "reviewer"], modelRole: "reviewer", workKind });
      expect(author.getSkills().skills.map((skill) => skill.name)).toEqual([authorSkill]);
      expect(reviewer.getSkills().skills.map((skill) => skill.name)).toEqual([reviewerSkill]);
    }
  });

  it("exposes only structured lifecycle tools", () => {
    expect(workStateToolNames).toEqual(["work.getContext", "work.begin", "work.requestChild", "work.updateProgress", "work.recordActivity", "work.submitArtifacts", "work.discardDraft", "work.reportFailure", "work.requestCompletion"]);
    expect(workStateToolNames.join(" ")).not.toMatch(/patchState|hardDelete|runner|raw/i);
  });

  it("keeps ScenarioForge custom tools active while disabling Pi built-in tools", async () => {
    const root = await mkdtemp(join(tmpdir(), "scenarioforge-pi-tools-"));
    await new ProjectBootstrapper().bootstrap({ projectRoot: root, projectId: "project-1", runtimeVersion: "1.0.0", protocolVersion: "1" });
    const resourceLoader = await createGenerationPiResourceLoader({
      projectRoot: root,
      runtimeRoot: join(root, ".scenarioforge/runtime"),
      expectedPolicies: generationWorkPolicies,
      modelRoles: ["author"],
      modelRole: "author",
      workKind: "analysis.fact-extract",
    });
    const binding = { role: "author" as const, provider: "local-test", api: "openai-completions" as const, modelId: "model", endpoint: "http://127.0.0.1:11434", credentialRef: "session:model:author", dataPolicyAccepted: true };
    const runtime = await createConfiguredModelRuntime([binding], () => "test-key");
    const customTool = createStagingJsonTool("work-1", async () => ({ path: "unused", contentHash: "hash" }));
    const driver = new PiSdkDriver(runtime, async () => resourceLoader, () => { throw new Error("not restored"); }, () => undefined, () => [customTool]);
    const handle = await driver.create({ projectId: "project-1", workId: "work-1", cwd: root, agentDir: join(root, ".scenarioforge/runtime/agents/generation"), source: "analysis", models: [binding], resourceProfile: "generation", workKind: "analysis.fact-extract", modelRole: "author", resourceRole: "author" });

    const session = (driver as unknown as { sessions: Map<string, { getActiveToolNames(): string[] }> }).sessions.get(handle.sessionId)!;
    expect(session.getActiveToolNames()).toEqual(["staging.writeJson"]);
    await driver.dispose(handle.sessionId);
  });
});
