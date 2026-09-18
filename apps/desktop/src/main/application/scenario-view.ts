import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ScenarioSet, WikiBundle } from "@scenarioforge/contracts";
import { getVerifiedJournal } from "./journal-cache";
import type { ScenarioResult } from "../../shared/scenario";

type RunManifest = {
  schema_version: 1 | 2;
  analysis_run_id: string;
  created_at: string;
  final_revision: number;
  artifacts: Array<{ artifact_id: string; artifact_type: string; content_hash: string }>;
};

const sha = (content: Buffer): string => createHash("sha256").update(content).digest("hex");

export async function loadScenarioView(projectRoot: string, runId: string): Promise<ScenarioResult> {
  const runRoot = join(projectRoot, ".scenarioforge", "runs", runId);
  const manifest = JSON.parse(await readFile(join(runRoot, "manifest.json"), "utf8")) as RunManifest;
  if ((manifest.schema_version !== 1 && manifest.schema_version !== 2) || manifest.analysis_run_id !== runId || !Array.isArray(manifest.artifacts)) throw new Error("RUN_MANIFEST_INVALID");
  const journal = await getVerifiedJournal(projectRoot);
  if (!journal || journal.revision < manifest.final_revision) throw new Error("RUN_JOURNAL_REVISION_MISSING");
  const scenarioRecord = manifest.artifacts.find((artifact) => artifact.artifact_type === "scenario-set" && artifact.artifact_id.startsWith("SCENARIOS-"));
  if (!scenarioRecord || journal.state.artifacts[scenarioRecord.artifact_id]?.contentHash !== scenarioRecord.content_hash) throw new Error("SCENARIO_ARTIFACT_NOT_CANONICAL");
  const scenarioContent = await readFile(join(runRoot, "scenario-set.json"));
  if (sha(scenarioContent) !== scenarioRecord.content_hash) throw new Error("SCENARIO_ARTIFACT_HASH_MISMATCH");
  const scenarios = JSON.parse(scenarioContent.toString("utf8")) as ScenarioSet;
  const wikiFiles = (await import("node:fs/promises")).readdir(join(runRoot, "wiki"));
  const wikiName = (await wikiFiles).find((name) => name.startsWith("WIKI-") && name.endsWith(".json"));
  const wikiRecord = manifest.artifacts.find((artifact) => artifact.artifact_type === "wiki-bundle" && artifact.artifact_id.startsWith("WIKI-"));
  if (!wikiName || !wikiRecord) throw new Error("WIKI_ARTIFACT_NOT_CANONICAL");
  const wikiContent = wikiName && wikiRecord ? await readFile(join(runRoot, "wiki", wikiName)) : undefined;
  if (wikiContent && (sha(wikiContent) !== wikiRecord!.content_hash || journal.state.artifacts[wikiRecord!.artifact_id]?.contentHash !== wikiRecord!.content_hash)) throw new Error("WIKI_ARTIFACT_HASH_MISMATCH");
  const wiki = wikiContent ? JSON.parse(wikiContent.toString("utf8")) as WikiBundle : undefined;
  const workflowMap = new Map(wiki?.workflows.map((workflow) => [workflow.workflow, workflow]) ?? []);
  const grouped = new Map<string, ScenarioSet["scenarios"]>();
  for (const scenario of scenarios.scenarios) grouped.set(scenario.workflow, [...(grouped.get(scenario.workflow) ?? []), scenario]);
  return {
    runId,
    generatedAt: manifest.created_at,
    storagePath: runRoot,
    wikiPages: wiki?.workflows.length ?? 0,
    groups: [...grouped.entries()].map(([workflowId, records]) => ({
      code: workflowId,
      name: workflowMap.get(workflowId)?.goal ?? workflowId,
      scenarios: records.map((scenario) => ({
        id: scenario.scenario_id,
        title: `${workflowMap.get(workflowId)?.goal ?? workflowId} · ${scenario.kind}`,
        summary: scenario.path.join(" → "),
        precondition: scenario.preconditions.map((entry) => entry.text).join(", ") || "없음",
        source: scenario.path.join(", "),
        steps: scenario.steps.map((step) => ({ order: step.n, action: step.action, expected: step.expected })),
      })),
    })),
  };
}
