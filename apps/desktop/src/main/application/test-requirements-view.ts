import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import type { FactBundle, ScenarioSet } from "@scenarioforge/contracts";
import { getVerifiedJournal } from "./journal-cache";
import { compileVisionSteps, deriveExecutionRequirements, type ScenarioPlan } from "@scenarioforge/test-runtime";
import type { TestExecutionRequirements } from "../../shared/test-requirements";

type ManifestArtifact = {
  artifact_id: string;
  artifact_type: string;
  content_hash: string;
  final_path?: string;
};

type RunManifest = {
  schema_version: 1 | 2;
  analysis_run_id: string;
  created_at: string;
  final_revision: number;
  artifacts: ManifestArtifact[];
};

const sha = (content: Buffer): string => createHash("sha256").update(content).digest("hex");

/** 컴파일 결과를 폼이 쓸 형태로 옮긴다. I/O 가 없어 그대로 테스트한다. */
export function projectTestExecutionRequirements(input: {
  runId: string;
  scenarioSet: ScenarioSet;
  facts: FactBundle;
  scenarioIds: readonly string[];
  providedBindingKeys?: readonly string[];
}): TestExecutionRequirements {
  const selected = new Set(input.scenarioIds);
  const scenarios = input.scenarioSet.scenarios.filter((scenario) => selected.has(scenario.scenario_id));
  // renderer 가 보낸 ID 관계를 신뢰하지 않는다. 정본에 없는 ID 는 거부한다.
  if (scenarios.length !== selected.size) throw new Error("SCENARIO_SELECTION_NOT_IN_RUN");

  const requirements = deriveExecutionRequirements({
    scenarios,
    screens: input.facts.screens,
    edges: input.facts.edges,
    providedBindingKeys: input.providedBindingKeys ?? [],
  });

  return {
    runId: input.runId,
    scenarios: requirements.scenarios.map((entry) => ({
      scenarioId: entry.scenarioId,
      state: entry.state,
      compiledSteps: entry.compiledSteps,
      missingBindings: [...entry.missingBindings],
      // MISSING_DATA_BINDING 은 missingBindings 로 전달되므로 blocker 가 아니다.
      blockers: entry.blockers.flatMap((blocker) =>
        blocker.reason === "MISSING_DATA_BINDING"
          ? []
          : [{ stepId: blocker.stepId, reason: blocker.reason, detail: blocker.detail }],
      ),
    })),
    dataBindings: requirements.dataBindings.map((field) => ({
      bindingKey: field.bindingKey,
      label: field.label,
      controlKind: field.controlKind,
      secret: field.secret,
      usedBy: field.usedBy.map((use) => ({ ...use })),
    })),
    maskDefaults: requirements.maskDefaults.map((mask) => ({
      elementRef: mask.elementRef,
      label: mask.label,
      screenId: mask.screenId,
    })),
    hasDestructiveStep: requirements.hasDestructiveStep,
    budgetDefaults: { ...requirements.budgetDefaults },
  };
}

function artifactPath(runRoot: string, artifact: ManifestArtifact, fallback: string): string {
  const candidate = artifact.final_path ? resolve(artifact.final_path) : join(runRoot, fallback);
  if (candidate !== runRoot && !candidate.startsWith(`${runRoot}${sep}`)) throw new Error("ARTIFACT_PATH_ESCAPE");
  return candidate;
}

export type CanonicalRun = {
  scenarioSet: ScenarioSet;
  facts: FactBundle;
  scenarioArtifactHash: string;
  factArtifactHash: string;
  sourceSnapshotId: string;
};

/* 정본 artifact 만 읽는다. scenario-view 와 같은 검증 순서를 따른다:
 * manifest, journal revision, artifact 등록, content hash. 어느 하나라도
 * 어긋나면 실패한다. */
export async function loadCanonicalRun(projectRoot: string, runId: string): Promise<CanonicalRun> {
  const runRoot = join(projectRoot, ".scenarioforge", "runs", runId);
  const manifest = JSON.parse(await readFile(join(runRoot, "manifest.json"), "utf8")) as RunManifest;
  if (
    (manifest.schema_version !== 1 && manifest.schema_version !== 2) ||
    manifest.analysis_run_id !== runId ||
    !Array.isArray(manifest.artifacts)
  ) {
    throw new Error("RUN_MANIFEST_INVALID");
  }

  const journal = await getVerifiedJournal(projectRoot);
  if (!journal || journal.revision < manifest.final_revision) throw new Error("RUN_JOURNAL_REVISION_MISSING");

  // 정본 artifact type 은 `scenario-set` 과 `fact-bundle` 이다(하네스가 그렇게 등록한다).
  const scenarioRecord = manifest.artifacts.find(
    (artifact) => artifact.artifact_type === "scenario-set" && artifact.artifact_id.startsWith("SCENARIOS-"),
  );
  if (!scenarioRecord || journal.state.artifacts[scenarioRecord.artifact_id]?.contentHash !== scenarioRecord.content_hash) {
    throw new Error("SCENARIO_ARTIFACT_NOT_CANONICAL");
  }
  const scenarioContent = await readFile(artifactPath(runRoot, scenarioRecord, "scenario-set.json"));
  if (sha(scenarioContent) !== scenarioRecord.content_hash) throw new Error("SCENARIO_ARTIFACT_HASH_MISMATCH");

  const factRecord = manifest.artifacts.find(
    (artifact) => artifact.artifact_type === "fact-bundle" && artifact.artifact_id.startsWith("FACT-"),
  );
  if (!factRecord || journal.state.artifacts[factRecord.artifact_id]?.contentHash !== factRecord.content_hash) {
    throw new Error("FACT_ARTIFACT_NOT_CANONICAL");
  }
  const factContent = await readFile(artifactPath(runRoot, factRecord, join("facts", `${factRecord.artifact_id}.json`)));
  if (sha(factContent) !== factRecord.content_hash) throw new Error("FACT_ARTIFACT_HASH_MISMATCH");

  const scenarioSet = JSON.parse(scenarioContent.toString("utf8")) as ScenarioSet;
  return {
    scenarioSet,
    facts: JSON.parse(factContent.toString("utf8")) as FactBundle,
    scenarioArtifactHash: scenarioRecord.content_hash,
    factArtifactHash: factRecord.content_hash,
    sourceSnapshotId: scenarioSet.source_snapshot_id,
  };
}

export async function loadTestExecutionRequirements(
  projectRoot: string,
  runId: string,
  scenarioIds: readonly string[],
  providedBindingKeys: readonly string[] = [],
): Promise<TestExecutionRequirements> {
  const run = await loadCanonicalRun(projectRoot, runId);
  return projectTestExecutionRequirements({
    runId,
    scenarioSet: run.scenarioSet,
    facts: run.facts,
    scenarioIds,
    providedBindingKeys,
  });
}

export type ExecutionPlanSource = CanonicalRun & {
  /** 값을 넣기 전 기준의 요구사항. binding key 의 secret 여부를 여기서 얻는다. */
  requirements: TestExecutionRequirements;
  plans: ScenarioPlan[];
};

/* 실행 명령이 쓸 계획. 값이 채워진 상태로 컴파일해 envelope 를 얻고,
 * secret 여부는 값을 넣기 전 요구사항에서 가져온다. */
export async function loadExecutionPlan(
  projectRoot: string,
  runId: string,
  scenarioIds: readonly string[],
  providedBindingKeys: readonly string[],
): Promise<ExecutionPlanSource> {
  const run = await loadCanonicalRun(projectRoot, runId);
  const requirements = projectTestExecutionRequirements({
    runId,
    scenarioSet: run.scenarioSet,
    facts: run.facts,
    scenarioIds,
  });

  const selected = new Set(scenarioIds);
  const plans = run.scenarioSet.scenarios
    .filter((scenario) => selected.has(scenario.scenario_id))
    .map((scenario) => {
      const compiled = compileVisionSteps({
        scenario,
        screens: run.facts.screens,
        edges: run.facts.edges,
        dataBindingKeys: [...providedBindingKeys],
      });
      return {
        scenarioId: scenario.scenario_id,
        title: `${scenario.workflow} · ${scenario.kind}`,
        envelopes: compiled.envelopes,
      };
    })
    .filter((plan) => plan.envelopes.length > 0);

  return { ...run, requirements, plans };
}
