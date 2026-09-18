import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInitialProjectRuntimeState, type EdgeLedger, type FactBundle, type FactCatalog, type ScenarioSet, type SourceSnapshot, type ValidationIssue, type WikiBundle, type WorkDescriptor, type WorkStateMutation } from "@scenarioforge/contracts";
import { JournalRepository, RuntimeStateCoordinator, WorkStateService } from "@scenarioforge/runtime-state";
import { generationStepRegistry } from "@scenarioforge/scenario-pipeline";
import { describe, expect, it, vi } from "vitest";
import type { SourceInteractionBehavior } from "./fact-source-behavior.js";
import { buildGenerationContextPack, canonicalJson } from "./generation-context-pack.js";
import { edgePartitionRepairAvailable, actionableFactCatalogReviewIssue, alignFactCorrectionPredicateKeys, alignFactCorrectionSourceStatePredicates, appendBoundedFactReviewDecision, assertFactCatalogInventoryPreserved, assertFactCatalogPartitionPatchScope, completeFactCorrectionPatchArrays, correctableFactPatchContractError, createEdgeLinkingPartitions, createEdgeLinkingPayload, createFactCatalogPartitions, createFactCatalogPayload, createFactCatalogRepairPayload, createFactCatalogReviewPartitions, createFactEnrichmentPayload, createFactRepairPayload, createScenarioCompositionPayload, createScenarioRepairPayload, createSemanticReviewPayload, createWikiCompositionPayload, createWikiRepairPayload, factArtifactFingerprint, factCatalogPartitionPayloadHash, generationPartitionArtifactId, generationPartitionPayloadHash, mergeEdgeProposalPatches, mergeFactCatalogPartitionPatches, mergeFactCatalogRepairPatch, opaqueFactCatalogIssueCodes, PiGenerationExecutor, promptForSubmittedArtifact, readFactCatalogPartitionCheckpoint, readGenerationPartitionCheckpoint, validateEdgeProposalReferences, writeFactCatalogPartitionCheckpoint, writeGenerationPartitionCheckpoint } from "./pi-generation-executor";

type EvidenceSlice = {
  evidence: {
    start_line: number;
    end_line: number;
  };
  content: string;
};

describe("Pi generation source evidence", () => {
  it("takes the edge partition repair boundary from the generation registry", () => {
    const maxRepairs = generationStepRegistry["edge-ledger"].maxRepairs;
    expect(edgePartitionRepairAvailable(maxRepairs - 1)).toBe(true);
    expect(edgePartitionRepairAvailable(maxRepairs)).toBe(false);
  });

  it("keeps each action-partitioned edge payload below the context token budget", () => {
    const identity = { project_id: "PRJ-test", analysis_run_id: "RUN-test", source_snapshot_id: "SNAP-test" };
    const evidenceFor = (index: number) => [{ source_snapshot_id: identity.source_snapshot_id, evidence_grant_id: `EVG-${index}`, source_id: `SRC-${index}`, path: `${index}.tsx`, start_line: 1, end_line: 2, content_hash: `sha256:${index}` }];
    const draft = {
      schema_version: 2 as const,
      ...identity,
      predicates: [],
      edges: [],
      screens: [{
        schema_version: 3 as const,
        ...identity,
        screen_id: "SCR-main",
        title: "Main",
        entry_guards: [],
        elements: [1, 2].map((index) => ({ id: `EL-${index}`, type: "button", label: `Action ${index}`, interaction: { action_kind: "submit", surface_kind: "web" as const, target_candidates: [] }, evidence: evidenceFor(index) })),
        apis: [], feedback: [], displays: [], status: "draft" as const,
      }],
    } satisfies FactBundle;
    const catalog = { schema_version: 1 as const, ...identity, screens: draft.screens, predicates: [] } satisfies FactCatalog;
    const behaviors = [1, 2].map((index) => ({ element_id: `EL-${index}`, source_id: `SRC-${index}`, path: `${index}.tsx`, line: 1, handler_lines: [1], called_symbols: [`api.action${index}`], local_state_keys: [], downstream_consumed_state_keys: [], literal_navigation_targets: [], explicit_failure: false, local_view_only: false, journey_required: true })) satisfies SourceInteractionBehavior[];
    const slices = [1, 2].map((index) => ({ evidence: { source_id: `SRC-${index}` }, content: String(index).repeat(80_000) }));
    const work = {
      schemaVersion: 1 as const, projectId: identity.project_id, analysisRunId: identity.analysis_run_id, sourceSnapshotId: identity.source_snapshot_id,
      sessionId: "SESSION-test", workId: "WORK-edge", kind: "analysis.edge-ledger" as const, stage: "fact" as const,
      generationStep: "edge-ledger" as const, role: "author" as const, outputArtifactType: "edge-ledger" as const,
      inputArtifacts: [], attemptId: "ATTEMPT-test", expectedRevision: 1, inputIds: [], stagingPath: ".scenarioforge/staging/WORK-edge",
      status: "running" as const, createdAt: "2026-09-09T00:00:00.000Z", updatedAt: "2026-09-09T00:00:00.000Z", progress: 0, completionRequested: false,
    } satisfies WorkDescriptor;

    const partitions = createEdgeLinkingPartitions(catalog, draft, slices, undefined, behaviors);

    expect(partitions).toHaveLength(2);
    expect(new Set(partitions.map((partition) => partition.partitionRef)).size).toBe(2);
    expect(partitions.every((partition) => buildGenerationContextPack({ work, role: "author", payload: partition.payload }).manifest.estimatedTokens < 30_000)).toBe(true);
  });

  it("does not create an edge-author partition for an unresolved connection", () => {
    const identity = { project_id: "PRJ-test", analysis_run_id: "RUN-test", source_snapshot_id: "SNAP-test" };
    const element = { id: "EL-run", type: "button", label: "Run", interaction: { action_kind: "unresolved", surface_kind: "web" as const, target_candidates: [] }, evidence: [] };
    const screen = { schema_version: 3 as const, ...identity, screen_id: "SCR-main", title: "Main", entry_guards: [], elements: [element], apis: [], feedback: [], displays: [], status: "unresolved" as const };
    const draft = { schema_version: 2 as const, ...identity, screens: [screen], predicates: [], edges: [] } satisfies FactBundle;
    const catalog = { schema_version: 1 as const, ...identity, screens: [screen], predicates: [] } satisfies FactCatalog;
    const unresolved = {
      element_id: element.id,
      source_id: "SRC-main",
      path: "Main.tsx",
      line: 1,
      handler_lines: [1],
      called_symbols: ["externalApi.run"],
      local_state_keys: [],
      downstream_consumed_state_keys: [],
      literal_navigation_targets: [],
      explicit_failure: false,
      local_view_only: false,
      journey_required: true,
      feasibility: "unresolved" as const,
      branches: [],
      unresolved: ["API_CLIENT_OPERATION_UNRESOLVED:externalApi.run"],
    } satisfies SourceInteractionBehavior;

    expect(createEdgeLinkingPartitions(catalog, draft, [], undefined, [unresolved])).toEqual([]);
  });

  it("limits a local-view edge partition to predicates matching its source state", () => {
    const identity = { project_id: "PRJ-test", analysis_run_id: "RUN-test", source_snapshot_id: "SNAP-test" };
    const evidence = [{ source_id: "SRC-main", source_snapshot_id: identity.source_snapshot_id, path: "Main.tsx", start_line: 10, end_line: 12, content_hash: "sha256:main", evidence_grant_id: "EVG-main" }];
    const element = { id: "EL-panel", type: "button", label: "Panel", interaction: { action_kind: "toggle_panel", surface_kind: "web" as const, target_candidates: [] }, evidence };
    const screen = { schema_version: 3 as const, ...identity, screen_id: "SCR-main", title: "Main", entry_guards: [], elements: [element], apis: [], feedback: [], displays: [], status: "verified" as const };
    const predicates = [
      { schema_version: 2 as const, ...identity, pred_id: "PRED-panel", values: ["open", "closed"], source: "code" as const, evidence },
      { schema_version: 2 as const, ...identity, pred_id: "PRED-stable-outcome", values: ["normal"], source: "code" as const, evidence },
    ];
    const catalog = { schema_version: 1 as const, ...identity, screens: [screen], predicates } satisfies FactCatalog;
    const draft = { schema_version: 2 as const, ...identity, screens: [screen], predicates, edges: [] } satisfies FactBundle;
    const behavior = {
      element_id: element.id,
      source_id: "SRC-main",
      path: "Main.tsx",
      line: 10,
      handler_lines: [10],
      called_symbols: ["setPanel"],
      local_state_keys: ["panel"],
      downstream_consumed_state_keys: [],
      literal_navigation_targets: [],
      stable_outcomes: [],
      explicit_failure: false,
      local_view_only: true,
      journey_required: false,
    } satisfies SourceInteractionBehavior;

    const [partition] = createEdgeLinkingPartitions(catalog, draft, [], undefined, [behavior]);

    expect(partition?.payload.predicate_vocabulary.map(({ key }) => key)).toEqual(["panel"]);
  });

  it("partitions FACT catalog prompts by screen and merges predicates deterministically", () => {
    const draft = {
      schema_version: 2 as const, project_id: "PRJ-test", analysis_run_id: "RUN-test", source_snapshot_id: "SNAP-test", predicates: [], edges: [],
      screens: ["one", "two"].map((name, index) => ({ schema_version: 3 as const, project_id: "PRJ-test", analysis_run_id: "RUN-test", source_snapshot_id: "SNAP-test", screen_id: `SCR-${name}`, title: name, entry_guards: [], elements: [{ id: `EL-${name}`, type: "button", label: name, interaction: { action_kind: "unresolved", surface_kind: "web" as const, target_candidates: [] }, evidence: [{ source_snapshot_id: "SNAP-test", evidence_grant_id: "G", source_id: `SRC-${name}`, path: `${name}.tsx`, start_line: 1, end_line: 1, content_hash: `sha256:${index}` }] }], apis: [], feedback: [], displays: [], status: "draft" as const })),
    } satisfies FactBundle;
    const slices = ["one", "two"].map((name) => ({ evidence: { source_id: `SRC-${name}` }, content: name }));
    const partitions = createFactCatalogPartitions(draft, slices);
    expect(partitions).toHaveLength(2);
    expect(partitions[0]!.payload.deterministic_fact_draft.screens).toHaveLength(1);
    expect(partitions[0]!.payload.evidence_slices).toEqual([slices[0]]);
    expect(() => assertFactCatalogPartitionPatchScope(partitions[0]!.payload, {
      schema_version: 2,
      screen_updates: [],
      element_updates: [{ element_ref: "U2", action_kind: "cross-screen-update" }],
      api_updates: [],
      predicates: [],
      edges: [],
    })).toThrow("FACT_CATALOG_PARTITION_SCOPE_VIOLATION:element_ref:U2");

    expect(mergeFactCatalogPartitionPatches([
      { schema_version: 2, screen_updates: [], element_updates: [], api_updates: [], predicates: [{ key: "status", values: ["ready"], source: "code", evidence_element_refs: ["U1"] }], edges: [] },
      { schema_version: 2, screen_updates: [], element_updates: [], api_updates: [], predicates: [{ key: "status", values: ["done"], source: "code", evidence_element_refs: ["U2"] }], edges: [] },
    ]).predicates).toEqual([{ key: "status", values: ["done", "ready"], source: "code", evidence_element_refs: ["U1", "U2"] }]);
    expect(() => mergeFactCatalogPartitionPatches([
      { schema_version: 2, screen_updates: [], element_updates: [], api_updates: [], predicates: [{ key: "frontend.pending", values: ["true", "false"], source: "code", evidence_element_refs: ["U1"] }], edges: [] },
      { schema_version: 2, screen_updates: [], element_updates: [], api_updates: [], predicates: [{ key: "frontend:pending", values: ["true", "false"], source: "code", evidence_element_refs: ["U2"] }], edges: [] },
    ])).toThrow("FACT_CATALOG_PREDICATE_ALIAS_CONFLICT:frontend-pending");
    expect(() => mergeFactCatalogPartitionPatches([
      { schema_version: 2, screen_updates: [], element_updates: [], api_updates: [], predicates: [{ key: "frontend.pending", values: ["true"], source: "code", evidence_element_refs: ["U1"] }], edges: [] },
      { schema_version: 2, screen_updates: [], element_updates: [], api_updates: [], predicates: [{ key: "frontend:pending", values: ["unknown"], source: "assumed", evidence_element_refs: ["U2"] }], edges: [] },
    ])).toThrow("FACT_CATALOG_PREDICATE_SOURCE_CONFLICT:frontend-pending");

    const catalog = {
      schema_version: 1 as const,
      project_id: draft.project_id,
      analysis_run_id: draft.analysis_run_id,
      source_snapshot_id: draft.source_snapshot_id,
      screens: draft.screens,
      predicates: draft.screens.map((screen, index) => ({ schema_version: 2 as const, project_id: draft.project_id, analysis_run_id: draft.analysis_run_id, source_snapshot_id: draft.source_snapshot_id, pred_id: `PRED-${index}`, values: ["ready"], source: "code" as const, evidence: screen.elements[0]!.evidence })),
    } satisfies FactCatalog;
    const missingInventory = structuredClone(catalog);
    missingInventory.screens[0]!.elements = [];
    expect(() => assertFactCatalogInventoryPreserved(draft, missingInventory)).toThrow("FACT_CATALOG_INVENTORY_MISMATCH");
    const relevantBehavior = { element_id: "EL-one", source_id: "SRC-one", path: "one.tsx", line: 1, handler_lines: [1], called_symbols: ["submit"], local_state_keys: [], downstream_consumed_state_keys: [], literal_navigation_targets: [], explicit_failure: false, local_view_only: true, journey_required: false } satisfies SourceInteractionBehavior;
    const reviewPartitions = createFactCatalogReviewPartitions(catalog, slices, [relevantBehavior]);
    expect(reviewPartitions).toHaveLength(2);
    expect(reviewPartitions[0]!.payload.fact_catalog.screens).toHaveLength(1);
    expect(reviewPartitions[0]!.payload.fact_catalog.predicates.map((predicate) => predicate.pred_id)).toEqual(["PRED-0"]);
    expect(reviewPartitions[0]!.payload.reviewer_evidence_slices).toEqual([slices[0]]);
    expect(actionableFactCatalogReviewIssue(catalog, `ELEMENT-${catalog.screens[0]!.elements[0]!.id}-action-kind-unresolved`, [relevantBehavior]))
      .toContain(`FACT_CATALOG_ELEMENT_SEMANTICS:${catalog.screens[0]!.elements[0]!.id}`);
    expect(actionableFactCatalogReviewIssue(catalog, `ELEMENT-${catalog.screens[1]!.elements[0]!.id}-action-kind-unresolved`, [relevantBehavior])).toBeUndefined();
    expect(actionableFactCatalogReviewIssue(catalog, "UNRESOLVED_ACTION_KIND-model-invented-alias", [relevantBehavior])).toBeUndefined();
    expect(actionableFactCatalogReviewIssue(catalog, `${catalog.screens[0]!.screen_id}-api-createCase-missing`, [relevantBehavior])).toBeUndefined();
    expect(actionableFactCatalogReviewIssue(catalog, "PREDICATE-VALUE-MISSING:PRED-0", [relevantBehavior], new Map([["PRED-0", ["U1"]]])))
      .toBe("FACT_CATALOG_PREDICATE_SEMANTICS:U1:PRED-0:PREDICATE-VALUE-MISSING:PRED-0");
  });

  it("merges valid FACT catalog partitions independently of arrival order", () => {
    const first = {
      schema_version: 2 as const,
      screen_updates: [{ screen_ref: "S2", title: "Two" }],
      element_updates: [{ element_ref: "U2", action_kind: "submit" }],
      api_updates: [],
      predicates: [{ key: "status", values: ["ready"], source: "code" as const, evidence_element_refs: ["U2"] }],
      edges: [],
    };
    const second = {
      schema_version: 2 as const,
      screen_updates: [{ screen_ref: "S1", title: "One" }],
      element_updates: [{ element_ref: "U1", action_kind: "login" }],
      api_updates: [],
      predicates: [{ key: "status", values: ["done"], source: "code" as const, evidence_element_refs: ["U1"] }],
      edges: [],
    };

    expect(mergeFactCatalogPartitionPatches([first, second]))
      .toEqual(mergeFactCatalogPartitionPatches([second, first]));
  });

  it("plans FACT catalog evidence per screen before enforcing the source byte budget", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "scenarioforge-fact-screen-evidence-"));
    const contentFor = (name: string) => `export const ${name}=()=> <button onClick={run}>${"x".repeat(205_000)}</button>;\n`;
    const screens = ["one", "two"].map((name) => {
      const content = contentFor(name);
      return {
        name,
        content,
        sourceId: `SRC-${name}`,
        screenId: `SCR-${name}`,
        elementId: `EL-${name}`,
      };
    });
    await Promise.all(screens.map(({ name, content }) => writeFile(join(projectRoot, `${name}.tsx`), content, "utf8")));
    const snapshot = {
      schema_version: 1 as const,
      project_id: "PRJ-test",
      analysis_run_id: "RUN-test",
      source_snapshot_id: "SNAP-test",
      created_at: "2026-09-10T00:00:00.000Z",
      root_hash: "sha256:root",
      ui_stacks: ["react"],
      unsupported_ui_stacks: [],
      files: screens.map(({ name, content, sourceId }) => ({
        source_id: sourceId,
        path: `${name}.tsx`,
        language: "tsx",
        content_hash: `sha256:${createHash("sha256").update(content).digest("hex")}`,
        size_bytes: Buffer.byteLength(content),
        imports: [],
      })),
      routes: screens.map(({ screenId, sourceId }) => ({ screen_id: screenId, route: `/${screenId}`, source_id: sourceId, line: 1 })),
      apis: [],
      interactions: screens.map(({ name, screenId, sourceId, elementId }) => ({
        element_id: elementId,
        screen_id: screenId,
        kind: "button",
        label: name,
        source_id: sourceId,
        line: 1,
        target_candidates: [{ by: "role-name", role: "button", name }],
      })),
      source_behaviors: screens.map(({ name, screenId, sourceId, elementId }) => ({
        element_id: elementId,
        screen_id: screenId,
        source_id: sourceId,
        path: `${name}.tsx`,
        line: 1,
        handler_lines: [1],
        called_symbols: ["run"],
        local_state_keys: [],
        downstream_consumed_state_keys: [],
        literal_navigation_targets: [],
        explicit_failure: false,
        local_view_only: true,
        journey_required: false,
        feasibility: "verified" as const,
        branches: [],
      })),
      i18n: {},
    } satisfies SourceSnapshot;
    const work = {
      schemaVersion: 1 as const,
      projectId: snapshot.project_id,
      analysisRunId: snapshot.analysis_run_id,
      sourceSnapshotId: snapshot.source_snapshot_id,
      sessionId: "SESSION-test",
      workId: "WORK-fact-catalog",
      kind: "analysis.fact-catalog" as const,
      stage: "fact" as const,
      generationStep: "fact-catalog" as const,
      role: "author" as const,
      outputArtifactType: "fact-catalog" as const,
      inputArtifacts: [],
      attemptId: "ATTEMPT-test",
      expectedRevision: 1,
      inputIds: [],
      stagingPath: ".scenarioforge/staging/WORK-fact-catalog",
      status: "running" as const,
      createdAt: "2026-09-10T00:00:00.000Z",
      updatedAt: "2026-09-10T00:00:00.000Z",
      progress: 0,
      completionRequested: false,
    } satisfies WorkDescriptor;
    const executor = new PiGenerationExecutor({ projectRoot, models: [], secretFor: () => undefined });
    const runArtifact = vi.spyOn(executor as unknown as {
      runArtifact: (role: "author" | "reviewer", currentWork: WorkDescriptor, artifactId: string, payload: unknown) => Promise<unknown>;
    }, "runArtifact").mockResolvedValue({ schema_version: 2, screen_updates: [], element_updates: [], api_updates: [], predicates: [], edges: [] });

    const catalog = await executor.extractFactCatalog({ snapshot, work });

    expect(catalog.screens.map((screen) => screen.screen_id)).toEqual(["SCR-one", "SCR-two"]);
    expect(catalog.screens.flatMap((screen) => screen.elements.map((element) => element.id))).toEqual(["EL-one", "EL-two"]);
    expect(runArtifact).toHaveBeenCalledTimes(2);
    const payloads = runArtifact.mock.calls.map((call) => call[3] as {
      partition_scope: { screen_ref: string };
      evidence_slices: Array<{ evidence: { source_id: string } }>;
    });
    expect(payloads.map((payload) => payload.partition_scope.screen_ref)).toEqual(["S1", "S2"]);
    expect(payloads.map((payload) => [...new Set(payload.evidence_slices.map((slice) => slice.evidence.source_id))])).toEqual([["SRC-one"], ["SRC-two"]]);
  });

  it("reuses only hash-valid FACT partition checkpoints while evidence grant IDs rotate", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "scenarioforge-fact-partition-checkpoint-"));
    const payload = {
      partition_scope: { screen_ref: "S1", element_refs: ["U1"], api_refs: [], screen_update_allowed: true },
      evidence_slices: [{ evidence: { evidence_grant_id: "EVG-first", source_id: "SRC-one", content_hash: "sha256:evidence" }, content: "source" }],
    } as unknown as Parameters<typeof factCatalogPartitionPayloadHash>[0];
    const patch = { schema_version: 2 as const, screen_updates: [], element_updates: [], api_updates: [], predicates: [], edges: [] };
    const artifactContent = `${JSON.stringify(patch)}\n`;
    const artifactContentHash = createHash("sha256").update(artifactContent).digest("hex");
    const identity = { projectId: "PRJ-test", analysisRunId: "RUN-test", sourceSnapshotId: "SNAP-test", partitionRef: "S1", artifactId: "FACT-CATALOG-RUN-test-S1" };
    await writeFactCatalogPartitionCheckpoint({
      projectRoot,
      ...identity,
      payloadHash: factCatalogPartitionPayloadHash(payload),
      artifactContent,
      artifactContentHash,
      contextManifest: {
        schemaVersion: 2,
        generationStep: "fact-catalog",
        role: "author",
        cacheKey: "scenarioforge:fact-catalog:author:v2",
        contextBytes: 100,
        estimatedTokens: 25,
        payloadHash: "context-hash",
        inputArtifactIds: [],
        optimizationStrategy: "step-role-lane-compaction",
        sessionDisposition: "disposed-at-step-end",
      },
    });
    const rotatedPayload = structuredClone(payload);
    (rotatedPayload.evidence_slices[0]!.evidence as { evidence_grant_id: string }).evidence_grant_id = "EVG-second";

    await expect(readFactCatalogPartitionCheckpoint({ projectRoot, ...identity, payloadHash: factCatalogPartitionPayloadHash(rotatedPayload) }))
      .resolves.toMatchObject({ patch });
    await expect(readFactCatalogPartitionCheckpoint({ projectRoot, ...identity, payloadHash: "0".repeat(64) }))
      .resolves.toBeUndefined();
  });

  it("keeps checkpointed artifact IDs stable while evidence grant IDs rotate", () => {
    const first = { edge_ref: "E-1", evidence: [{ evidence_grant_id: "EVG-first", source_id: "SRC-one", content_hash: "sha256:one" }] };
    const rotated = { edge_ref: "E-1", evidence: [{ evidence_grant_id: "EVG-second", source_id: "SRC-one", content_hash: "sha256:one" }] };

    expect(generationPartitionArtifactId("EDGE-PARTITION-RUN-test-S1-U1", first))
      .toBe(generationPartitionArtifactId("EDGE-PARTITION-RUN-test-S1-U1", rotated));
    expect(generationPartitionArtifactId("EDGE-PARTITION-RUN-test-S1-U1", { ...rotated, edge_ref: "E-2" }))
      .not.toBe(generationPartitionArtifactId("EDGE-PARTITION-RUN-test-S1-U1", rotated));
  });

  it("binds reusable partition checkpoints to the exact step, role, payload, and artifact hash while allowing transient artifact ID migration", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "scenarioforge-role-partition-checkpoint-"));
    const firstPayload = { edge_ref: "E-1", evidence: [{ evidence_grant_id: "EVG-first", source_id: "SRC-one" }] };
    const rotatedPayload = { edge_ref: "E-1", evidence: [{ evidence_grant_id: "EVG-second", source_id: "SRC-one" }] };
    const artifact = { pass: true, issueCodes: [] };
    const artifactContent = `${JSON.stringify(artifact)}\n`;
    const artifactContentHash = createHash("sha256").update(artifactContent).digest("hex");
    const identity = {
      projectRoot,
      projectId: "PRJ-test",
      analysisRunId: "RUN-test",
      sourceSnapshotId: "SNAP-test",
      generationStep: "edge-ledger" as const,
      partitionRef: "EL-one",
      artifactId: "VERDICT-edge-EL-one",
    };
    await writeGenerationPartitionCheckpoint({
      ...identity,
      role: "reviewer",
      payloadHash: generationPartitionPayloadHash(firstPayload),
      artifactContent,
      artifactContentHash,
      contextManifest: {
        schemaVersion: 2,
        generationStep: "edge-ledger",
        role: "reviewer",
        cacheKey: "scenarioforge:edge-ledger:reviewer:v2",
        contextBytes: 100,
        estimatedTokens: 25,
        payloadHash: "context-hash",
        inputArtifactIds: [],
        optimizationStrategy: "step-role-lane-compaction",
        sessionDisposition: "disposed-at-step-end",
      },
    });

    await expect(readGenerationPartitionCheckpoint({ ...identity, role: "reviewer", payloadHash: generationPartitionPayloadHash(rotatedPayload) }))
      .resolves.toMatchObject({ artifact });
    await expect(readGenerationPartitionCheckpoint({ ...identity, artifactId: "VERDICT-edge-EL-one-stable", role: "reviewer", payloadHash: generationPartitionPayloadHash(rotatedPayload) }))
      .resolves.toMatchObject({ artifact });
    await expect(readGenerationPartitionCheckpoint({ ...identity, role: "repair", payloadHash: generationPartitionPayloadHash(rotatedPayload) }))
      .resolves.toBeUndefined();
    await expect(readGenerationPartitionCheckpoint({ ...identity, role: "reviewer", payloadHash: generationPartitionPayloadHash({ ...rotatedPayload, edge_ref: "E-2" }) }))
      .resolves.toBeUndefined();
  });

  it("records completed checkpoint status and quarantines a stale payload for explicit recovery", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "scenarioforge-stale-partition-checkpoint-"));
    const payload = { edge_ref: "E-1" };
    const artifactContent = `${JSON.stringify({ schema_version: 1, edges: [] })}\n`;
    const identity = {
      projectRoot,
      projectId: "PRJ-test",
      analysisRunId: "RUN-test",
      sourceSnapshotId: "SNAP-test",
      generationStep: "edge-ledger" as const,
      role: "author" as const,
      partitionRef: "S1-U1",
      artifactId: "EDGE-PARTITION-RUN-test-S1-U1",
    };
    await writeGenerationPartitionCheckpoint({
      ...identity,
      payloadHash: generationPartitionPayloadHash(payload),
      artifactContent,
      artifactContentHash: createHash("sha256").update(artifactContent).digest("hex"),
      contextManifest: {
        schemaVersion: 2,
        generationStep: "edge-ledger",
        role: "author",
        cacheKey: "scenarioforge:edge-ledger:author:v2",
        contextBytes: 100,
        estimatedTokens: 25,
        payloadHash: "context-hash",
        inputArtifactIds: [],
        optimizationStrategy: "step-role-lane-compaction",
        sessionDisposition: "disposed-at-step-end",
      },
    });
    const checkpointPath = join(projectRoot, ".scenarioforge/state/checkpoints/RUN-test/edge-ledger/author/S1-U1.json");
    expect(JSON.parse(await readFile(checkpointPath, "utf8"))).toMatchObject({ status: "completed" });

    await expect(readGenerationPartitionCheckpoint({
      ...identity,
      payloadHash: generationPartitionPayloadHash({ edge_ref: "E-2" }),
    })).resolves.toBeUndefined();
    await expect(readFile(checkpointPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    const orphanRoot = join(projectRoot, ".scenarioforge/state/orphans/checkpoints/RUN-test/edge-ledger/author");
    const orphanNames = await readdir(orphanRoot);
    expect(orphanNames).toHaveLength(1);
    expect(await readFile(join(orphanRoot, orphanNames[0]!), "utf8")).toContain('"partition_ref": "S1-U1"');
  });

  it("quarantines an interrupted checkpoint temporary during partition recovery", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "scenarioforge-interrupted-partition-checkpoint-"));
    const checkpointRoot = join(projectRoot, ".scenarioforge/state/checkpoints/RUN-test/edge-ledger/author");
    const temporaryPath = join(checkpointRoot, "S1-U1.json.INTERRUPTED.tmp");
    await mkdir(checkpointRoot, { recursive: true });
    await writeFile(temporaryPath, "incomplete checkpoint");

    await expect(readGenerationPartitionCheckpoint({
      projectRoot,
      projectId: "PRJ-test",
      analysisRunId: "RUN-test",
      sourceSnapshotId: "SNAP-test",
      generationStep: "edge-ledger",
      role: "author",
      partitionRef: "S1-U1",
      payloadHash: generationPartitionPayloadHash({ edge_ref: "E-1" }),
      artifactId: "EDGE-PARTITION-RUN-test-S1-U1",
    })).resolves.toBeUndefined();

    await expect(readFile(temporaryPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    const orphanRoot = join(projectRoot, ".scenarioforge/state/orphans/checkpoints/RUN-test/edge-ledger/author");
    const orphanNames = await readdir(orphanRoot);
    expect(orphanNames).toHaveLength(1);
    expect(await readFile(join(orphanRoot, orphanNames[0]!), "utf8")).toBe("incomplete checkpoint");
  });

  it("reuses a completed checkpoint without a model call and reruns only an uncheckpointed failure", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "scenarioforge-checkpoint-executor-reuse-"));
    const firstPayload = { edge_ref: "E-1", evidence: [{ evidence_grant_id: "EVG-first", source_id: "SRC-one", content_hash: "sha256:one" }] };
    const rotatedPayload = { edge_ref: "E-1", evidence: [{ evidence_grant_id: "EVG-second", source_id: "SRC-one", content_hash: "sha256:one" }] };
    const artifact = { schema_version: 1 as const, edges: [] };
    const artifactContent = `${JSON.stringify(artifact)}\n`;
    await writeGenerationPartitionCheckpoint({
      projectRoot,
      projectId: "PRJ-test",
      analysisRunId: "RUN-test",
      sourceSnapshotId: "SNAP-test",
      generationStep: "edge-ledger",
      role: "author",
      partitionRef: "S1-U1",
      payloadHash: generationPartitionPayloadHash(firstPayload),
      artifactId: "EDGE-PARTITION-RUN-test-S1-U1-legacy",
      artifactContent,
      artifactContentHash: createHash("sha256").update(artifactContent).digest("hex"),
      contextManifest: {
        schemaVersion: 2,
        generationStep: "edge-ledger",
        role: "author",
        cacheKey: "scenarioforge:edge-ledger:author:v2",
        contextBytes: 100,
        estimatedTokens: 25,
        payloadHash: "context-hash",
        inputArtifactIds: [],
        optimizationStrategy: "step-role-lane-compaction",
        sessionDisposition: "disposed-at-step-end",
      },
    });
    const checkpointPath = join(projectRoot, ".scenarioforge/state/checkpoints/RUN-test/edge-ledger/author/S1-U1.json");
    const legacyCheckpoint = JSON.parse(await readFile(checkpointPath, "utf8")) as Record<string, unknown>;
    legacyCheckpoint.schema_version = 1;
    delete legacyCheckpoint.status;
    const legacyBase = { ...legacyCheckpoint };
    delete legacyBase.record_hash;
    legacyCheckpoint.record_hash = createHash("sha256").update(canonicalJson(legacyBase)).digest("hex");
    await writeFile(checkpointPath, `${JSON.stringify(legacyCheckpoint, null, 2)}\n`);
    const work = {
      schemaVersion: 1 as const,
      projectId: "PRJ-test",
      analysisRunId: "RUN-test",
      sourceSnapshotId: "SNAP-test",
      sessionId: "SESSION-test",
      workId: "WORK-root",
      kind: "analysis.edge-ledger" as const,
      stage: "fact" as const,
      generationStep: "edge-ledger" as const,
      role: "author" as const,
      outputArtifactType: "edge-ledger" as const,
      inputArtifacts: [],
      attemptId: "ATTEMPT-root",
      expectedRevision: 1,
      inputIds: [],
      stagingPath: ".scenarioforge/staging/WORK-root",
      status: "running" as const,
      createdAt: "2026-09-11T00:00:00.000Z",
      updatedAt: "2026-09-11T00:00:00.000Z",
      progress: 0,
      completionRequested: false,
    } satisfies WorkDescriptor;
    const executor = new PiGenerationExecutor({ projectRoot, models: [], secretFor: () => undefined });
    let revision = 1;
    let liveWork: WorkDescriptor = work;
    const progressMutations: WorkStateMutation[] = [];
    Object.assign(executor, {
      workStateService: {
        getState: () => ({ revision, works: { [work.workId]: liveWork } }),
        mutate: async ({ mutation }: { mutation: WorkStateMutation }) => {
          progressMutations.push(mutation);
          if (mutation.op === "update-progress") liveWork = { ...liveWork, progress: mutation.patch.progress, partitionProgress: mutation.patch.partitionProgress };
          revision += 1;
        },
      },
    });
    const internals = executor as unknown as {
      runCheckpointedPartitionArtifact: <T>(role: "author", work: WorkDescriptor, artifactId: string, partitionRef: string, payload: unknown) => Promise<T>;
      runArtifact: () => Promise<never>;
    };
    const runArtifact = vi.spyOn(internals, "runArtifact").mockRejectedValue(new Error("MODEL_CALL_FORBIDDEN"));

    await expect(internals.runCheckpointedPartitionArtifact("author", work, generationPartitionArtifactId("EDGE-PARTITION-RUN-test-S1-U1", rotatedPayload), "S1-U1", rotatedPayload))
      .resolves.toEqual(artifact);
    expect(runArtifact).not.toHaveBeenCalled();
    expect(progressMutations).toEqual([
      { op: "update-progress", patch: { workId: work.workId, progress: 0, currentActivity: "edge-ledger:author:S1-U1", partitionProgress: { generationStep: "edge-ledger", role: "author", completed: 0, failed: 0, currentPartition: "S1-U1" } } },
      { op: "update-progress", patch: { workId: work.workId, progress: 0, currentActivity: "edge-ledger:author:S1-U1", partitionProgress: { generationStep: "edge-ledger", role: "author", completed: 1, failed: 0, currentPartition: "S1-U1" } } },
    ]);

    const failedPayload = { edge_ref: "E-2" };
    const failedArtifactId = generationPartitionArtifactId("EDGE-PARTITION-RUN-test-S1-U2", failedPayload);
    await expect(internals.runCheckpointedPartitionArtifact("author", work, failedArtifactId, "S1-U2", failedPayload)).rejects.toThrow("MODEL_CALL_FORBIDDEN");
    await expect(internals.runCheckpointedPartitionArtifact("author", work, failedArtifactId, "S1-U2", failedPayload)).rejects.toThrow("MODEL_CALL_FORBIDDEN");
    expect(runArtifact).toHaveBeenCalledTimes(2);
    expect(progressMutations.slice(-4)).toEqual([
      { op: "update-progress", patch: { workId: work.workId, progress: 0, currentActivity: "edge-ledger:author:S1-U2", partitionProgress: { generationStep: "edge-ledger", role: "author", completed: 1, failed: 0, currentPartition: "S1-U2" } } },
      { op: "update-progress", patch: { workId: work.workId, progress: 0, currentActivity: "edge-ledger:author:S1-U2", partitionProgress: { generationStep: "edge-ledger", role: "author", completed: 1, failed: 1, currentPartition: "S1-U2" } } },
      { op: "update-progress", patch: { workId: work.workId, progress: 0, currentActivity: "edge-ledger:author:S1-U2", partitionProgress: { generationStep: "edge-ledger", role: "author", completed: 1, failed: 1, currentPartition: "S1-U2" } } },
      { op: "update-progress", patch: { workId: work.workId, progress: 0, currentActivity: "edge-ledger:author:S1-U2", partitionProgress: { generationStep: "edge-ledger", role: "author", completed: 1, failed: 2, currentPartition: "S1-U2" } } },
    ]);
  });

  it("persists executor partition progress through the real runtime journal", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "scenarioforge-executor-partition-progress-"));
    const work = {
      schemaVersion: 1 as const,
      projectId: "PRJ-test",
      analysisRunId: "RUN-test",
      sourceSnapshotId: "SNAP-test",
      sessionId: "SESSION-test",
      workId: "WORK-root",
      kind: "analysis.fact-catalog" as const,
      stage: "fact" as const,
      generationStep: "fact-catalog" as const,
      role: "author" as const,
      outputArtifactType: "fact-catalog" as const,
      inputArtifacts: [],
      attemptId: "ATTEMPT-root",
      expectedRevision: 0,
      inputIds: [],
      stagingPath: ".scenarioforge/staging/WORK-root",
      status: "running" as const,
      createdAt: "2026-09-12T00:00:00.000Z",
      updatedAt: "2026-09-12T00:00:00.000Z",
      progress: 0,
      completionRequested: false,
    } satisfies WorkDescriptor;
    const initial = { ...createInitialProjectRuntimeState(work.projectId), works: { [work.workId]: work } };
    const repository = new JournalRepository(projectRoot);
    await repository.initialize(initial);
    const service = new WorkStateService(new RuntimeStateCoordinator(initial, repository));
    const executor = new PiGenerationExecutor({ projectRoot, models: [], secretFor: () => undefined });
    Object.assign(executor, { workStateService: service });

    await (executor as unknown as {
      recordPartitionProgress: (currentWork: WorkDescriptor, step: "fact-catalog", role: "author", partitionRef: string, outcome: "completed") => Promise<void>;
    }).recordPartitionProgress(work, "fact-catalog", "author", "S1", "completed");

    const recovered = await repository.recoverLatest();
    expect(recovered?.state.currentActivity).toBe("fact-catalog:author:S1");
    expect(recovered?.state.works[work.workId]?.partitionProgress).toEqual({ generationStep: "fact-catalog", role: "author", completed: 1, failed: 0, currentPartition: "S1" });
  });

  it("releases a checkpointed repair partition before compacting its child work", async () => {
    const rootWork = {
      schemaVersion: 1 as const,
      projectId: "PRJ-test",
      analysisRunId: "RUN-test",
      sourceSnapshotId: "SNAP-test",
      sessionId: "SESSION-test",
      workId: "WORK-root",
      kind: "analysis.fact-catalog" as const,
      stage: "fact" as const,
      generationStep: "fact-catalog" as const,
      role: "author" as const,
      outputArtifactType: "fact-catalog" as const,
      inputArtifacts: [],
      attemptId: "ATTEMPT-root",
      expectedRevision: 1,
      inputIds: [],
      stagingPath: ".scenarioforge/staging/WORK-root",
      status: "running" as const,
      createdAt: "2026-09-11T00:00:00.000Z",
      updatedAt: "2026-09-11T00:00:00.000Z",
      progress: 0,
      completionRequested: false,
    } satisfies WorkDescriptor;
    const childWork = {
      ...rootWork,
      workId: "WORK-repair",
      parentWorkId: rootWork.workId,
      role: "repair" as const,
      attemptId: "ATTEMPT-repair",
      stagingPath: ".scenarioforge/staging/WORK-repair",
    } satisfies WorkDescriptor;
    const events: string[] = [];
    const executor = new PiGenerationExecutor({ projectRoot: "/tmp/project", models: [], secretFor: () => undefined });
    const internals = executor as unknown as {
      prepareRoleWork: () => Promise<WorkDescriptor>;
      runArtifactAttempt: () => Promise<{ schema_version: 1 }>;
      runArtifact: (
        role: "author",
        work: WorkDescriptor,
        artifactId: string,
        payload: unknown,
        generationRole: "repair",
        beforeChildSettle: () => Promise<void>,
      ) => Promise<{ schema_version: 1 }>;
    };
    vi.spyOn(internals, "prepareRoleWork").mockResolvedValue(childWork);
    vi.spyOn(internals, "runArtifactAttempt").mockResolvedValue({ schema_version: 1 });
    Object.assign(executor, {
      workStateService: {
        getState: () => ({ revision: 9 }),
        releaseCheckpointedWork: async () => { events.push("compact-work"); },
      },
    });

    await internals.runArtifact("author", rootWork, "FACT-repair", {}, "repair", async () => {
      events.push("release");
    });

    expect(events).toEqual(["release", "compact-work"]);
  });

  it("subpartitions one oversized FACT catalog screen without losing element or behavior refs", () => {
    const identity = { project_id: "PRJ-test", analysis_run_id: "RUN-test", source_snapshot_id: "SNAP-test" };
    const evidenceFor = (index: number) => [{
      source_snapshot_id: identity.source_snapshot_id,
      evidence_grant_id: `EVG-${index}`,
      source_id: `SRC-${index}`,
      path: `${index}.tsx`,
      start_line: 1,
      end_line: 20,
      content_hash: `sha256:${index}`,
    }];
    const elements = Array.from({ length: 12 }, (_, index) => ({
      id: `EL-${index + 1}`,
      type: "button",
      label: `Action ${index + 1}`,
      interaction: { action_kind: "submit", surface_kind: "web" as const, target_candidates: [] },
      evidence: evidenceFor(index + 1),
    }));
    const draft = {
      schema_version: 2 as const,
      ...identity,
      predicates: [],
      edges: [],
      screens: [{
        schema_version: 3 as const,
        ...identity,
        screen_id: "SCR-large",
        title: "Large",
        entry_guards: [],
        elements,
        apis: [],
        feedback: [],
        displays: [],
        status: "verified" as const,
      }],
    } satisfies FactBundle;
    const behaviors = elements.map((element, index) => ({
      element_id: element.id,
      source_id: `SRC-${index + 1}`,
      path: `${index + 1}.tsx`,
      line: 1,
      handler_lines: [1],
      called_symbols: [`api.action${index + 1}`],
      local_state_keys: [],
      downstream_consumed_state_keys: [],
      literal_navigation_targets: [],
      explicit_failure: false,
      local_view_only: false,
      journey_required: true,
    })) satisfies SourceInteractionBehavior[];
    const slices = elements.map((_element, index) => ({
      evidence: { source_id: `SRC-${index + 1}`, start_line: 1, end_line: 20 },
      content: String(index + 1).repeat(12_000),
    }));
    const work = {
      schemaVersion: 1 as const,
      projectId: identity.project_id,
      analysisRunId: identity.analysis_run_id,
      sourceSnapshotId: identity.source_snapshot_id,
      sessionId: "SESSION-test",
      workId: "WORK-fact-catalog",
      kind: "analysis.fact-catalog" as const,
      stage: "fact" as const,
      generationStep: "fact-catalog" as const,
      role: "author" as const,
      outputArtifactType: "fact-catalog" as const,
      inputArtifacts: [],
      attemptId: "ATTEMPT-test",
      expectedRevision: 1,
      inputIds: [],
      stagingPath: ".scenarioforge/staging/WORK-fact-catalog",
      status: "running" as const,
      createdAt: "2026-09-10T00:00:00.000Z",
      updatedAt: "2026-09-10T00:00:00.000Z",
      progress: 0,
      completionRequested: false,
    } satisfies WorkDescriptor;

    const partitions = createFactCatalogPartitions(draft, slices, undefined, behaviors);

    expect(partitions.length).toBeGreaterThan(1);
    expect(partitions.every(({ payload }) => buildGenerationContextPack({ work, role: "author", payload }).manifest.estimatedTokens <= 28_000)).toBe(true);
    expect(partitions.flatMap(({ payload }) => payload.deterministic_fact_draft.screens[0]!.elements.map((element) => element.element_ref)))
      .toEqual(elements.map((_element, index) => `U${index + 1}`));
    expect(partitions.flatMap(({ payload }) => payload.source_behavior_contracts.map((behavior) => behavior.element_ref)))
      .toEqual(elements.map((_element, index) => `U${index + 1}`));
  });

  it("subpartitions an oversized FACT catalog review for one screen", () => {
    const identity = { project_id: "PRJ-test", analysis_run_id: "RUN-test", source_snapshot_id: "SNAP-test" };
    const evidenceFor = (index: number) => [{
      source_snapshot_id: identity.source_snapshot_id,
      evidence_grant_id: `EVG-${index}`,
      source_id: `SRC-${index}`,
      path: `${index}.tsx`,
      start_line: 1,
      end_line: 20,
      content_hash: `sha256:${index}`,
    }];
    const elements = Array.from({ length: 12 }, (_, index) => ({
      id: `EL-${index + 1}`,
      type: "button",
      label: `Action ${index + 1}`,
      interaction: { action_kind: "submit", surface_kind: "web" as const, target_candidates: [] },
      evidence: evidenceFor(index + 1),
    }));
    const screen = {
      schema_version: 3 as const,
      ...identity,
      screen_id: "SCR-large",
      title: "Large",
      entry_guards: [],
      elements,
      apis: [],
      feedback: [],
      displays: [],
      status: "verified" as const,
    };
    const catalog = {
      schema_version: 1 as const,
      ...identity,
      screens: [screen],
      predicates: elements.map((element, index) => ({
        schema_version: 2 as const,
        ...identity,
        pred_id: `PRED-state-${index + 1}`,
        values: ["ready", "done"],
        source: "code" as const,
        evidence: element.evidence,
      })),
    } satisfies FactCatalog;
    const behaviors = elements.map((element, index) => ({
      element_id: element.id,
      source_id: `SRC-${index + 1}`,
      path: `${index + 1}.tsx`,
      line: 1,
      handler_lines: [1],
      called_symbols: [`api.action${index + 1}`],
      local_state_keys: [],
      downstream_consumed_state_keys: [],
      literal_navigation_targets: [],
      explicit_failure: false,
      local_view_only: false,
      journey_required: true,
    })) satisfies SourceInteractionBehavior[];
    const slices = elements.map((_element, index) => ({
      evidence: { source_id: `SRC-${index + 1}`, start_line: 1, end_line: 20 },
      content: String(index + 1).repeat(12_000),
    }));
    const work = {
      schemaVersion: 1 as const,
      projectId: identity.project_id,
      analysisRunId: identity.analysis_run_id,
      sourceSnapshotId: identity.source_snapshot_id,
      sessionId: "SESSION-test",
      workId: "WORK-fact-review",
      kind: "analysis.fact-catalog" as const,
      stage: "fact" as const,
      generationStep: "fact-catalog" as const,
      role: "reviewer" as const,
      outputArtifactType: "semantic-verdict" as const,
      inputArtifacts: [],
      attemptId: "ATTEMPT-test",
      expectedRevision: 1,
      inputIds: [],
      stagingPath: ".scenarioforge/staging/WORK-fact-review",
      status: "running" as const,
      createdAt: "2026-09-10T00:00:00.000Z",
      updatedAt: "2026-09-10T00:00:00.000Z",
      progress: 0,
      completionRequested: false,
    } satisfies WorkDescriptor;

    const partitions = createFactCatalogReviewPartitions(catalog, slices, behaviors);

    expect(partitions.length).toBeGreaterThan(1);
    expect(partitions.every(({ payload }) => buildGenerationContextPack({ work, role: "reviewer", payload }).manifest.estimatedTokens <= 28_000)).toBe(true);
    expect(partitions.flatMap(({ payload }) => payload.fact_catalog.screens[0]!.elements.map((element) => element.id)))
      .toEqual(elements.map((element) => element.id));
    expect(partitions.flatMap(({ payload }) => payload.source_behavior_contracts.map((behavior) => behavior.element_id)))
      .toEqual(elements.map((element) => element.id));
  });

  it("aligns correction predicate aliases to the existing canonical slug", () => {
    const rejected = { schema_version: 2 as const, screen_updates: [], element_updates: [], api_updates: [], predicates: [{ key: "case.reviewer_dialog.open", values: ["false"], source: "code" as const, evidence_element_refs: ["U1"] }], edges: [] };
    const correction = { schema_version: 1 as const, base_patch_hash: "sha256:test", screen_update_upserts: [], element_update_upserts: [], api_update_upserts: [], predicate_upserts: [{ key: "case.reviewer.dialog.open", values: ["true"], source: "code" as const, evidence_element_refs: ["U2"] }], predicate_removals: [], edge_changes: [] };
    expect(alignFactCorrectionPredicateKeys(rejected, correction).predicate_upserts[0]?.key).toBe("case.reviewer_dialog.open");
  });

  it("aligns only targeted correction predicates to backend-required source state keys", () => {
    const rejected = {
      schema_version: 2 as const,
      screen_updates: [],
      element_updates: [],
      api_updates: [],
      predicates: [
        { key: "login.employee_number.prefilled", values: ["true", "false"], source: "code" as const, evidence_element_refs: ["U59"] },
        { key: "untouched.status", values: ["ready"], source: "code" as const, evidence_element_refs: ["U99"] },
      ],
      edges: [],
    };
    const correction = {
      schema_version: 1 as const,
      base_patch_hash: "sha256:test",
      screen_update_upserts: [],
      element_update_upserts: [],
      api_update_upserts: [],
      predicate_upserts: [
        { key: "case.check.checked", values: ["true", "false"], source: "code" as const, evidence_element_refs: ["U27"] },
        { key: "case.reviewer.dialog.open", values: ["rejected", "null"], source: "code" as const, evidence_element_refs: ["U10", "U12"] },
        { key: "case.review_comment", values: ["null", "nonempty"], source: "code" as const, evidence_element_refs: ["U48"] },
        { key: "login.employee_number.prefilled", values: ["true", "false"], source: "code" as const, evidence_element_refs: ["U59"] },
      ],
      predicate_removals: [],
      edge_changes: [],
    };
    const issues = [
      "FACT_SOURCE_STATE_PREDICATE_MISSING:U27 changes source-backed view state; states=checks.",
      "FACT_SOURCE_STATE_PREDICATE_MISSING:U10 changes source-backed view state; states=reviewerDecisionOpen.",
      "FACT_SOURCE_STATE_PREDICATE_MISSING:U12 changes source-backed view state; states=reviewerDecisionOpen.",
      "FACT_SOURCE_STATE_PREDICATE_MISSING:U48 changes source-backed view state; states=reviewerComment.",
      "FACT_SOURCE_STATE_PREDICATE_MISSING:U60 changes source-backed view state; states=prefilled.",
    ];

    const aligned = alignFactCorrectionSourceStatePredicates(rejected, correction, issues);

    expect(aligned.predicate_upserts).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: expect.stringContaining("checks"), evidence_element_refs: expect.arrayContaining(["U27"]) }),
      expect.objectContaining({ key: expect.stringContaining("reviewerDecisionOpen"), evidence_element_refs: expect.arrayContaining(["U10", "U12"]) }),
      expect.objectContaining({ key: expect.stringContaining("reviewerComment"), evidence_element_refs: expect.arrayContaining(["U48"]) }),
      expect.objectContaining({ key: "login.employee_number.prefilled", evidence_element_refs: expect.arrayContaining(["U59", "U60"]) }),
    ]));
    expect(rejected.predicates[1]).toEqual({ key: "untouched.status", values: ["ready"], source: "code", evidence_element_refs: ["U99"] });
  });

  it("keeps FACT catalog and edge prompts single-purpose", () => {
    const draft = { schema_version: 2 as const, project_id: "PRJ-test", analysis_run_id: "RUN-test", source_snapshot_id: "SNAP-test", screens: [], edges: [], predicates: [] } satisfies FactBundle;
    const catalog = { schema_version: 1 as const, project_id: draft.project_id, analysis_run_id: draft.analysis_run_id, source_snapshot_id: draft.source_snapshot_id, screens: [], predicates: [] } satisfies FactCatalog;

    const catalogPayload = createFactCatalogPayload(draft, []);
    const edgePayload = createEdgeLinkingPayload(catalog, draft, []);

    expect(catalogPayload.output_contract.edges).toEqual([]);
    expect(catalogPayload.task).toContain("Never emit an edge");
    expect(catalogPayload.task).toContain("never JSON null");
    expect(Object.keys(edgePayload.output_contract)).toEqual(["schema_version", "edges"]);
    expect(edgePayload.output_contract.edges[0]?.source_branch_ref).toContain("branch_ref");
    expect(edgePayload).not.toHaveProperty("deterministic_fact_draft");
    expect(edgePayload.task).toContain("never submit an empty effect.all");
  });

  it("partitions edge author context by source screen while retaining global destination refs", () => {
    const identity = { project_id: "PRJ-test", analysis_run_id: "RUN-test", source_snapshot_id: "SNAP-test" };
    const evidence = (name: string) => [{ source_id: `SRC-${name}`, source_snapshot_id: identity.source_snapshot_id, path: `${name}.tsx`, start_line: 1, end_line: 20, content_hash: `sha256:${name}`, evidence_grant_id: `EVG-${name}` }];
    const screens = ["one", "two"].map((name) => ({ schema_version: 3 as const, ...identity, screen_id: `SCR-${name}`, route: `/${name}`, title: name, entry_guards: [], elements: [{ id: `EL-${name}`, type: "button", label: name, interaction: { action_kind: "submit", surface_kind: "web" as const, target_candidates: [] }, evidence: evidence(name) }], apis: [], feedback: [], displays: [], status: "verified" as const }));
    const predicate = { schema_version: 2 as const, ...identity, pred_id: "PRED-status", values: ["ready", "done"], source: "code" as const, evidence: evidence("one") };
    const catalog = { schema_version: 1 as const, ...identity, screens, predicates: [predicate] } satisfies FactCatalog;
    const draft = { schema_version: 2 as const, ...identity, screens: [...screens].reverse(), predicates: [predicate], edges: [] } satisfies FactBundle;
    const behaviors = screens.map((screen, index) => ({ element_id: screen.elements[0]!.id, source_id: `SRC-${index ? "two" : "one"}`, path: `${index ? "two" : "one"}.tsx`, line: 5, handler_lines: [5], called_symbols: ["navigate"], local_state_keys: [], downstream_consumed_state_keys: [], literal_navigation_targets: [index ? "/one" : "/two"], explicit_failure: false, local_view_only: false, journey_required: true })) satisfies SourceInteractionBehavior[];
    const slices = ["one", "two"].map((name) => ({ evidence: { source_id: `SRC-${name}` }, content: `${name} source` }));

    const partitions = createEdgeLinkingPartitions(catalog, draft, slices, undefined, behaviors);

    expect(partitions).toHaveLength(2);
    expect(partitions[0]!.payload.source_behavior_contracts.map((entry) => entry.element_ref)).toEqual(["U1"]);
    expect(partitions[0]!.payload.source_behavior_contracts[0]?.literal_navigation_targets).toEqual(["/two"]);
    expect(partitions[0]!.payload.evidence_slices).toEqual([slices[0]]);
    expect(partitions[0]!.payload.opaque_catalog.screens.map((screen) => screen.screen_ref)).toEqual(["S1", "S2"]);
    expect(partitions[0]!.payload.opaque_catalog.screens.flatMap((screen) => screen.elements.map((element) => element.element_ref))).toEqual(["U1"]);
    expect(partitions[1]!.payload.opaque_catalog.screens.flatMap((screen) => screen.elements.map((element) => element.element_ref))).toEqual(["U2"]);
    expect(mergeEdgeProposalPatches([
      { schema_version: 1, edges: [{ kind: "normal", from_screen_ref: "S1", on_element_ref: "U1", to_screen_ref: "S2" }] },
      { schema_version: 1, edges: [{ kind: "normal", from_screen_ref: "S2", on_element_ref: "U2", to_screen_ref: "S1" }] },
    ])).toEqual({ schema_version: 1, edges: [
      { kind: "normal", from_screen_ref: "S1", on_element_ref: "U1", to_screen_ref: "S2" },
      { kind: "normal", from_screen_ref: "S2", on_element_ref: "U2", to_screen_ref: "S1" },
    ] });
    expect(validateEdgeProposalReferences(catalog, {
      schema_version: 1,
      edges: [{ kind: "exception", from_screen_ref: "S1", on_element_ref: "U1", to_screen_ref: "S2", effect: { all: [{ predicate_key: "status", value: "missing" }] } }],
    })).toEqual([expect.objectContaining({ code: "FACT_PATCH_REFERENCE_INVALID", path: "edges.0.effect", message: expect.stringContaining("status=missing") })]);

  });

  it("reviews an edge through the same opaque one-action behavior contract used by the author", async () => {
    const identity = { project_id: "PRJ-test", analysis_run_id: "RUN-test", source_snapshot_id: "SNAP-test" };
    const element = { id: "EL-run", type: "button", label: "Run", interaction: { action_kind: "submit", surface_kind: "web" as const, target_candidates: [] }, evidence: [] };
    const screen = { schema_version: 3 as const, ...identity, screen_id: "SCR-main", title: "Main", entry_guards: [], elements: [element], apis: [], feedback: [], displays: [], status: "verified" as const };
    const catalog = { schema_version: 1 as const, ...identity, screens: [screen], predicates: [] } satisfies FactCatalog;
    const edge = { schema_version: 2 as const, ...identity, edge_id: "E-0001", kind: "normal" as const, from: screen.screen_id, on: element.id, to: screen.screen_id, feedback: [], evidence: [], status: "verified" as const };
    const facts = { schema_version: 2 as const, ...identity, screens: [screen], predicates: [], edges: [edge] } satisfies FactBundle;
    const ledger = { schema_version: 1 as const, ...identity, edges: [edge], audit: [] } satisfies EdgeLedger;
    const behavior = {
      element_id: element.id,
      source_id: "SRC-main",
      path: "Main.tsx",
      line: 7,
      handler_lines: [7],
      called_symbols: ["taskApi.run"],
      local_state_keys: [],
      downstream_consumed_state_keys: [],
      literal_navigation_targets: [],
      explicit_failure: false,
      local_view_only: false,
      journey_required: true,
      feasibility: "verified" as const,
      branches: [{ branch_ref: "normal:1", outcome: "normal" as const, guard_keys: [], feasibility: "verified" as const, source_refs: [] }],
    } satisfies SourceInteractionBehavior;
    const snapshot = { schema_version: 1 as const, ...identity, created_at: "2026-09-09T00:00:00.000Z", root_hash: "sha256:root", ui_stacks: ["react"], unsupported_ui_stacks: [], files: [], routes: [], apis: [], interactions: [], source_behaviors: [], i18n: {} } satisfies SourceSnapshot;
    const work = { schemaVersion: 1 as const, projectId: identity.project_id, analysisRunId: identity.analysis_run_id, sourceSnapshotId: identity.source_snapshot_id, sessionId: "SESSION-test", workId: "WORK-review", kind: "analysis.edge-ledger" as const, stage: "fact" as const, generationStep: "edge-ledger" as const, role: "reviewer" as const, outputArtifactType: "edge-ledger" as const, inputArtifacts: [], attemptId: "ATTEMPT-test", expectedRevision: 1, inputIds: [], stagingPath: ".scenarioforge/staging/WORK-review", status: "running" as const, createdAt: "2026-09-09T00:00:00.000Z", updatedAt: "2026-09-09T00:00:00.000Z", progress: 0, completionRequested: false } satisfies WorkDescriptor;
    const executor = new PiGenerationExecutor({ projectRoot: "/tmp/project", models: [], secretFor: () => undefined });
    Object.assign(executor, { lastSnapshot: snapshot, lastFactDraft: facts, lastFacts: facts, lastFactBehaviors: [behavior] });
    const runArtifact = vi.spyOn(executor as unknown as { runArtifact: (_role: string, _work: WorkDescriptor, _artifactId: string, payload: Record<string, unknown>) => Promise<unknown> }, "runArtifact").mockResolvedValue({ pass: true, issueCodes: [] });

    await executor.reviewEdgeLedger({ catalog, artifact: ledger, work });

    const payload = runArtifact.mock.calls[0]![3] as { source_behavior_contracts: Array<Record<string, unknown>> };
    expect(payload.source_behavior_contracts).toEqual([expect.objectContaining({ element_ref: "U1", branches: [expect.objectContaining({ branch_ref: "normal:1" })] })]);
    expect(payload.source_behavior_contracts[0]).not.toHaveProperty("element_id");
    expect(payload.source_behavior_contracts[0]).not.toHaveProperty("source_id");
    expect(payload.source_behavior_contracts[0]).not.toHaveProperty("path");
  });

  it("normalizes omitted no-op arrays in a limited edge correction", () => {
    const correction = {
      schema_version: 1,
      base_patch_hash: "sha256:test",
      edge_changes: [{ operation: "replace", edge_index: 0, edge: { kind: "normal", from_screen_ref: "S1", on_element_ref: "U1", to_screen_ref: "S1" } }],
    } as unknown as Parameters<typeof completeFactCorrectionPatchArrays>[0];

    expect(completeFactCorrectionPatchArrays(correction)).toMatchObject({
      screen_update_upserts: [],
      element_update_upserts: [],
      api_update_upserts: [],
      predicate_upserts: [],
      predicate_removals: [],
      edge_changes: correction.edge_changes,
    });
  });

  it("maps catalog reviewer IDs back to opaque repair refs when the compiled catalog is omitted", () => {
    const draft = {
      schema_version: 2 as const,
      project_id: "PRJ-test",
      analysis_run_id: "RUN-test",
      source_snapshot_id: "SNAP-test",
      screens: [{
        schema_version: 3 as const,
        project_id: "PRJ-test",
        analysis_run_id: "RUN-test",
        source_snapshot_id: "SNAP-test",
        screen_id: "SCR-main",
        title: "Main",
        entry_guards: [],
        elements: [{ id: "EL-refresh", type: "button", label: "Refresh", interaction: { action_kind: "unresolved", surface_kind: "web" as const, target_candidates: [] }, evidence: [] }],
        apis: [{ id: "API-refresh", reads: [], writes: [], evidence: [] }],
        feedback: [],
        displays: [],
        status: "draft" as const,
      }],
      predicates: [],
      edges: [],
    } satisfies FactBundle;

    expect(opaqueFactCatalogIssueCodes(draft, ["ELEMENT-EL-refresh-action", "SCREEN-SCR-main", "API-API-refresh"])).toEqual(["ELEMENT-U1-action", "SCREEN-S1", "API-A1"]);
    const catalog = { schema_version: 1 as const, project_id: draft.project_id, analysis_run_id: draft.analysis_run_id, source_snapshot_id: draft.source_snapshot_id, screens: draft.screens, predicates: [] } satisfies FactCatalog;
    const edgePayload = createEdgeLinkingPayload(catalog, draft, [], undefined, [{ element_id: "EL-refresh", source_id: "SRC-main", path: "Main.tsx", line: 10, handler_lines: [5, 10], called_symbols: ["taskApi.refresh"], local_state_keys: [], downstream_consumed_state_keys: [], literal_navigation_targets: [], explicit_failure: true, local_view_only: false, journey_required: true }]);
    expect(edgePayload.source_behavior_contracts).toEqual([{ element_ref: "U1", called_symbols: ["taskApi.refresh"], local_state_keys: [], downstream_consumed_state_keys: [], literal_navigation_targets: [], explicit_failure: true, local_view_only: false, journey_required: true }]);
    expect(edgePayload.source_behavior_contracts[0]).not.toHaveProperty("handler_lines");
  });

  it("bounds FACT catalog review to scanner-owned records while retaining local-view semantics", async () => {
    const snapshot = {
      schema_version: 1 as const,
      project_id: "PRJ-test",
      analysis_run_id: "RUN-test",
      source_snapshot_id: "SNAP-test",
      created_at: "2026-09-02T00:00:00.000Z",
      root_hash: "sha256:root",
      ui_stacks: ["react"],
      unsupported_ui_stacks: [],
      files: [],
      routes: [],
      apis: [],
      interactions: [],
      i18n: {},
    } satisfies SourceSnapshot;
    const catalog = {
      schema_version: 1 as const,
      project_id: snapshot.project_id,
      analysis_run_id: snapshot.analysis_run_id,
      source_snapshot_id: snapshot.source_snapshot_id,
      screens: [{
        schema_version: 3 as const,
        project_id: snapshot.project_id,
        analysis_run_id: snapshot.analysis_run_id,
        source_snapshot_id: snapshot.source_snapshot_id,
        screen_id: "SCR-login",
        title: "Login",
        entry_guards: [],
        elements: [{
          id: "EL-login-submit",
          type: "button",
          label: "Login",
          interaction: { action_kind: "submit", surface_kind: "web" as const, target_candidates: [{ by: "test-id", value: "login-submit" }] },
          evidence: [{ source_id: "SRC-login", source_snapshot_id: snapshot.source_snapshot_id, path: "Login.tsx", start_line: 1, end_line: 10, content_hash: "sha256:owned", evidence_grant_id: "EVG-owned" }],
        }],
        apis: [],
        feedback: [],
        displays: [],
        status: "verified" as const,
      }],
      predicates: [{
        schema_version: 2 as const,
        project_id: snapshot.project_id,
        analysis_run_id: snapshot.analysis_run_id,
        source_snapshot_id: snapshot.source_snapshot_id,
        pred_id: "PRED-document-present",
        values: ["true", "false"],
        source: "code" as const,
        evidence: [{ source_id: "SRC-login", source_snapshot_id: snapshot.source_snapshot_id, path: "Login.tsx", start_line: 1, end_line: 10, content_hash: "sha256:owned", evidence_grant_id: "EVG-owned" }],
      }],
    } satisfies FactCatalog;
    const work = {
      schemaVersion: 1 as const,
      projectId: snapshot.project_id,
      analysisRunId: snapshot.analysis_run_id,
      sourceSnapshotId: snapshot.source_snapshot_id,
      sessionId: "SESSION-test",
      workId: "WORK-catalog",
      kind: "analysis.fact-catalog" as const,
      stage: "fact" as const,
      generationStep: "fact-catalog" as const,
      role: "author" as const,
      outputArtifactType: "fact-catalog" as const,
      attemptId: "ATTEMPT-test",
      expectedRevision: 1,
      inputIds: [],
      inputArtifacts: [],
      stagingPath: ".scenarioforge/staging/WORK-catalog",
      status: "running" as const,
      createdAt: "2026-09-02T00:00:00.000Z",
      updatedAt: "2026-09-02T00:00:00.000Z",
      progress: 0,
      completionRequested: false,
    } satisfies WorkDescriptor;
    const executor = new PiGenerationExecutor({ projectRoot: "/tmp/project", models: [], secretFor: () => undefined });
    const behavior = { element_id: "EL-login-submit", source_id: "SRC-login", path: "Login.tsx", line: 5, handler_lines: [5], called_symbols: ["submitLogin"], local_state_keys: [], downstream_consumed_state_keys: [], literal_navigation_targets: [], explicit_failure: false, local_view_only: true, journey_required: false } satisfies SourceInteractionBehavior;
    Object.assign(executor, {
      lastSnapshot: snapshot,
      lastFactBehaviors: [behavior],
      lastFactCatalogPatch: { schema_version: 2, screen_updates: [], element_updates: [], api_updates: [], predicates: [{ key: "document-present", values: ["true", "false"], source: "code", evidence_element_refs: ["U1"] }], edges: [] },
    });
    vi.spyOn(executor as unknown as { reviewEvidence: () => Promise<[]> }, "reviewEvidence").mockResolvedValue([]);
    const runArtifact = vi.spyOn(executor as unknown as {
      runArtifact: (role: "author" | "reviewer", currentWork: WorkDescriptor, artifactId: string, payload: { task: string }) => Promise<unknown>;
    }, "runArtifact").mockResolvedValue({
      pass: false,
      issueCodes: [
        "FACT-API-MISSING-SCENARIO-CSV-EXPORT",
        "FACT-ELEMENT-UNRESOLVED:EL-login-submit",
        "FACT-PREDICATE-MISSING:PRED-document-present",
      ],
    });

    const verdict = await executor.reviewFactCatalog({ artifact: catalog, work });

    expect(runArtifact.mock.calls[0]?.[3].task).toContain("scanner-owned inventory");
    expect(runArtifact.mock.calls[0]?.[3].task).toContain("local_view_only behaviors");
    expect(runArtifact.mock.calls[0]?.[3].task).toContain("global union");
    expect(JSON.stringify(runArtifact.mock.calls[0]?.[3])).not.toContain("evidence_grant_id");
    expect(JSON.stringify(runArtifact.mock.calls[0]?.[3])).not.toContain("target_candidates");
    expect(verdict).toEqual({ pass: false, issueCodes: [
      "FACT_CATALOG_ELEMENT_SEMANTICS:EL-login-submit:FACT-ELEMENT-UNRESOLVED:EL-login-submit",
      "FACT_CATALOG_PREDICATE_SEMANTICS:U1:PRED-document-present:FACT-PREDICATE-MISSING:PRED-document-present",
    ] });
  });

  it("requires semantics and predicates for backend-classified local-view elements", async () => {
    const identity = { project_id: "PRJ-test", analysis_run_id: "RUN-test", source_snapshot_id: "SNAP-test" };
    const evidence = [{ source_id: "SRC-main", source_snapshot_id: identity.source_snapshot_id, path: "Main.tsx", start_line: 1, end_line: 20, content_hash: "sha256:main", evidence_grant_id: "EVG-main" }];
    const localElement = { id: "EL-category-tab", type: "button", label: "Category", interaction: { action_kind: "unresolved", surface_kind: "web" as const, target_candidates: [] }, evidence };
    const screen = { schema_version: 3 as const, ...identity, screen_id: "SCR-main", title: "Main", entry_guards: [], elements: [localElement], apis: [], feedback: [], displays: [], status: "draft" as const };
    const catalog = { schema_version: 1 as const, ...identity, screens: [screen], predicates: [] } satisfies FactCatalog;
    const snapshot = { schema_version: 1 as const, ...identity, created_at: "2026-09-02T00:00:00.000Z", root_hash: "sha256:root", ui_stacks: ["react"], unsupported_ui_stacks: [], files: [], routes: [], apis: [], interactions: [], i18n: {} } satisfies SourceSnapshot;
    const work = { schemaVersion: 1 as const, projectId: identity.project_id, analysisRunId: identity.analysis_run_id, sourceSnapshotId: identity.source_snapshot_id, sessionId: "SESSION-test", workId: "WORK-review", kind: "analysis.fact-catalog" as const, stage: "fact" as const, generationStep: "fact-catalog" as const, role: "reviewer" as const, outputArtifactType: "fact-catalog", inputArtifacts: [], attemptId: "ATTEMPT-test", expectedRevision: 1, inputIds: [], stagingPath: ".scenarioforge/staging/WORK-review", status: "running" as const, createdAt: "2026-09-02T00:00:00.000Z", updatedAt: "2026-09-02T00:00:00.000Z", progress: 0, completionRequested: false } satisfies WorkDescriptor;
    const localBehavior = { element_id: localElement.id, source_id: "SRC-main", path: "Main.tsx", line: 7, handler_lines: [7], called_symbols: ["setPanel"], local_state_keys: ["panel"], downstream_consumed_state_keys: [], literal_navigation_targets: [], explicit_failure: false, local_view_only: true, journey_required: false } satisfies SourceInteractionBehavior;
    const executor = new PiGenerationExecutor({ projectRoot: "/tmp/project", models: [], secretFor: () => undefined });
    Object.assign(executor, { lastSnapshot: snapshot, lastFactDraft: { schema_version: 2, ...identity, screens: [screen], predicates: [], edges: [] }, lastFactBehaviors: [localBehavior] });
    vi.spyOn(executor as unknown as { reviewEvidence: () => Promise<[]> }, "reviewEvidence").mockResolvedValue([]);
    vi.spyOn(executor as unknown as { runArtifact: () => Promise<unknown> }, "runArtifact").mockResolvedValue({
      pass: false,
      issueCodes: [
        "FACT-ACTION-CATEGORY-TAB-UNRESOLVED: EL-category-tab is a scanner-owned category-panel selector.",
        "FACT-PREDICATE-DOCUMENT-PRESENT-MISSING",
      ],
    });

    await expect(executor.reviewFactCatalog({ artifact: catalog, work })).resolves.toEqual({
      pass: false,
      issueCodes: [
        "FACT_SOURCE_ACTION_UNRESOLVED:U1 at Main.tsx:7 is a backend-classified view action but its semantic action_kind remains unresolved.",
        "FACT_SOURCE_STATE_PREDICATE_MISSING:U1 at Main.tsx:7 changes source-backed view state without evidence-linked predicates; states=panel.",
      ],
    });
  });

  it("runs backend source-behavior gates before the fine-grained catalog and edge reviewers", async () => {
    const identity = { project_id: "PRJ-test", analysis_run_id: "RUN-test", source_snapshot_id: "SNAP-test" };
    const evidence = [{ source_id: "SRC-download", source_snapshot_id: identity.source_snapshot_id, path: "Download.tsx", start_line: 1, end_line: 20, content_hash: "sha256:download", evidence_grant_id: "EVG-download" }];
    const element = { id: "EL-download", type: "button", label: "Download", interaction: { action_kind: "download", surface_kind: "web" as const, target_candidates: [{ by: "role-name" as const, role: "button", name: "Download" }] }, evidence };
    const screen = { schema_version: 3 as const, ...identity, screen_id: "SCR-download", title: "Download", entry_guards: [], elements: [element], apis: [], feedback: [], displays: [], status: "draft" as const };
    const predicate = { schema_version: 2 as const, ...identity, pred_id: "PRED-download-status", values: ["idle", "downloading", "failure"], source: "code" as const, evidence };
    const draft = { schema_version: 2 as const, ...identity, screens: [screen], predicates: [predicate], edges: [] } satisfies FactBundle;
    const catalog = { schema_version: 1 as const, ...identity, screens: [screen], predicates: [predicate] } satisfies FactCatalog;
    const snapshot = { schema_version: 1 as const, ...identity, created_at: "2026-09-02T00:00:00.000Z", root_hash: "sha256:root", ui_stacks: ["react"], unsupported_ui_stacks: [], files: [], routes: [], apis: [], interactions: [], i18n: {} } satisfies SourceSnapshot;
    const work = { schemaVersion: 1 as const, projectId: identity.project_id, analysisRunId: identity.analysis_run_id, sourceSnapshotId: identity.source_snapshot_id, sessionId: "SESSION-test", workId: "WORK-review", kind: "analysis.edge-ledger" as const, stage: "fact" as const, generationStep: "edge-ledger" as const, role: "reviewer" as const, outputArtifactType: "edge-ledger", inputArtifacts: [], attemptId: "ATTEMPT-test", expectedRevision: 1, inputIds: [], stagingPath: ".scenarioforge/staging/WORK-review", status: "running" as const, createdAt: "2026-09-02T00:00:00.000Z", updatedAt: "2026-09-02T00:00:00.000Z", progress: 0, completionRequested: false } satisfies WorkDescriptor;
    const behavior = { element_id: element.id, source_id: "SRC-download", path: "Download.tsx", line: 7, handler_lines: [7], called_symbols: ["taskApi.downloadCsv"], local_state_keys: [], downstream_consumed_state_keys: [], literal_navigation_targets: [], explicit_failure: true, local_view_only: false, journey_required: true } satisfies SourceInteractionBehavior;
    const executor = new PiGenerationExecutor({ projectRoot: "/tmp/project", models: [], secretFor: () => undefined });
    Object.assign(executor, { lastSnapshot: snapshot, lastFactDraft: draft, lastFactBehaviors: [behavior] });
    const runArtifact = vi.spyOn(executor as unknown as { runArtifact: () => Promise<unknown> }, "runArtifact").mockResolvedValue({ pass: true, issueCodes: [] });

    const catalogVerdict = await executor.reviewFactCatalog({ artifact: catalog, work });

    expect(catalogVerdict.pass).toBe(false);
    expect(catalogVerdict.issueCodes.join(" ")).toContain("FACT_SOURCE_STABLE_OUTCOME_PREDICATE_MISSING");
    expect(catalogVerdict.issueCodes.join(" ")).toContain("U1");
    expect(runArtifact).not.toHaveBeenCalled();

    catalog.predicates[0]!.values.push("downloaded");
    const ledger = {
      schema_version: 1 as const,
      ...identity,
      edges: [{ schema_version: 2 as const, ...identity, edge_id: "E-0001", kind: "exception" as const, from: screen.screen_id, on: element.id, to: screen.screen_id, effect: "PRED-download-status=failure", feedback: [], evidence, status: "draft" as const }],
      audit: [],
    } satisfies EdgeLedger;

    const edgeVerdict = await executor.reviewEdgeLedger({ catalog, artifact: ledger, work });

    expect(edgeVerdict.pass).toBe(false);
    expect(edgeVerdict.issueCodes.join(" ")).toContain("FACT_NORMAL_EDGE_MISSING");
    expect(edgeVerdict.issueCodes.join(" ")).toContain("U1");
    expect(runArtifact).not.toHaveBeenCalled();
  });

  it("repairs a FACT catalog from the compact rejected patch instead of duplicating the compiled catalog", async () => {
    const snapshot = { schema_version: 1 as const, project_id: "PRJ-test", analysis_run_id: "RUN-test", source_snapshot_id: "SNAP-test", created_at: "2026-09-02T00:00:00.000Z", root_hash: "sha256:root", ui_stacks: ["react"], unsupported_ui_stacks: [], files: [], routes: [], apis: [], interactions: [], i18n: {} } satisfies SourceSnapshot;
    const evidence = { source_id: "SRC-one", source_snapshot_id: "SNAP-test", path: "One.tsx", start_line: 1, end_line: 1, content_hash: "sha256:one", evidence_grant_id: "EVG-one" };
    const screen = { schema_version: 3 as const, project_id: "PRJ-test", analysis_run_id: "RUN-test", source_snapshot_id: "SNAP-test", screen_id: "SCR-one", title: "One", entry_guards: [], elements: [{ id: "EL-one", type: "button", label: "One", interaction: { action_kind: "submit", surface_kind: "web" as const, target_candidates: [] }, evidence: [evidence] }], apis: [], feedback: [], displays: [], status: "draft" as const };
    const draft = { schema_version: 2 as const, project_id: "PRJ-test", analysis_run_id: "RUN-test", source_snapshot_id: "SNAP-test", screens: [screen], predicates: [], edges: [] } satisfies FactBundle;
    const catalog = { schema_version: 1 as const, project_id: "PRJ-test", analysis_run_id: "RUN-test", source_snapshot_id: "SNAP-test", screens: [screen], predicates: [] } satisfies FactCatalog;
    const rejectedPatch = { schema_version: 2 as const, screen_updates: [], element_updates: [], api_updates: [], predicates: [{ key: "status", values: ["idle"], source: "code" as const, evidence_element_refs: ["U1"] }], edges: [] };
    const work = { schemaVersion: 1 as const, projectId: "PRJ-test", analysisRunId: "RUN-test", sourceSnapshotId: "SNAP-test", sessionId: "SESSION-test", workId: "WORK-test", kind: "analysis.fact-catalog" as const, stage: "fact" as const, generationStep: "fact-catalog" as const, role: "repair" as const, outputArtifactType: "fact-catalog", inputArtifacts: [], attemptId: "ATTEMPT-test", expectedRevision: 1, inputIds: [], stagingPath: ".scenarioforge/staging/WORK-test", status: "running" as const, createdAt: "2026-09-02T00:00:00.000Z", updatedAt: "2026-09-02T00:00:00.000Z", progress: 0, completionRequested: false } satisfies WorkDescriptor;
    const executor = new PiGenerationExecutor({ projectRoot: "/tmp/project", models: [], secretFor: () => undefined });
    Object.assign(executor, { lastFactCatalogPatch: rejectedPatch, lastFactDraft: draft, lastSnapshot: snapshot });
    vi.spyOn(executor as unknown as { sourceBehaviors: () => Promise<[]> }, "sourceBehaviors").mockResolvedValue([]);
    vi.spyOn(executor as unknown as { correctionSourceSlices: () => Promise<[]> }, "correctionSourceSlices").mockResolvedValue([]);
    let correctionAttempt = 0;
    const runArtifact = vi.spyOn(executor as unknown as { runArtifact: (_role: string, _work: WorkDescriptor, _artifactId: string, payload: Record<string, unknown>) => Promise<unknown> }, "runArtifact").mockImplementation(async (_role, _work, _artifactId, payload) => {
      correctionAttempt += 1;
      const basePatchHash = (payload.correction_plan as { base_patch_hash: string }).base_patch_hash;
      return correctionAttempt === 1
        ? { schema_version: 1, base_patch_hash: basePatchHash, element_update_upserts: [{ element_ref: "U1", label: "Unchanged label" }], predicate_upserts: [], edge_changes: [] }
        : { schema_version: 1, base_patch_hash: basePatchHash, element_update_upserts: [], predicate_upserts: [{ key: "status", values: ["idle", "completed"], source: "code", evidence_element_refs: ["U1"] }], edge_changes: [] };
    });

    const repaired = await executor.repairFactCatalog({ snapshot, catalog, issueCodes: ["FACT_CATALOG_PREDICATE_VALUE_MISSING:U1:completed"], work });

    expect(runArtifact.mock.calls[0]?.[3]).toMatchObject({ correction_plan: { predicate_element_refs: ["U1"] } });
    expect(runArtifact.mock.calls[0]?.[3]).not.toHaveProperty("rejected_catalog_patch");
    expect(runArtifact.mock.calls[0]?.[3]).not.toHaveProperty("rejected_catalog");
    expect(runArtifact).toHaveBeenCalledTimes(2);
    expect(runArtifact.mock.calls[1]?.[3]).toMatchObject({ deterministic_correction_error: "FACT_CORRECTION_ELEMENT_OUT_OF_SCOPE:U1" });
    expect(runArtifact.mock.calls[1]?.[2]).not.toBe(runArtifact.mock.calls[0]?.[2]);
    expect(repaired.predicates[0]?.values).toEqual(["idle", "completed"]);
  });

  it("scopes repeated FACT catalog repair context to issue-referenced opaque elements", () => {
    const identity = { project_id: "PRJ-test", analysis_run_id: "RUN-test", source_snapshot_id: "SNAP-test" };
    const evidence = (source_id: string, path: string) => ({ source_id, source_snapshot_id: identity.source_snapshot_id, path, start_line: 1, end_line: 20, content_hash: `sha256:${source_id}`, evidence_grant_id: "EVG-test" });
    const element = (id: string, label: string, ownedEvidence: ReturnType<typeof evidence>) => ({ id, type: "button", label, interaction: { action_kind: "download", surface_kind: "web" as const, target_candidates: [] }, evidence: [ownedEvidence] });
    const firstEvidence = evidence("SRC-one", "One.tsx");
    const secondEvidence = evidence("SRC-two", "Two.tsx");
    const draft = {
      schema_version: 2 as const,
      ...identity,
      screens: [
        { schema_version: 3 as const, ...identity, screen_id: "SCR-one", title: "One", entry_guards: [], elements: [element("EL-one", "One", firstEvidence)], apis: [], feedback: [], displays: [], status: "draft" as const },
        { schema_version: 3 as const, ...identity, screen_id: "SCR-two", title: "Two", entry_guards: [], elements: [element("EL-two", "Two", secondEvidence)], apis: [], feedback: [], displays: [], status: "draft" as const },
      ],
      predicates: [],
      edges: [],
    } satisfies FactBundle;
    const rejectedPatch = { schema_version: 2 as const, screen_updates: [], element_updates: [], api_updates: [], predicates: [], edges: [] };
    const snapshot = {
      schema_version: 1 as const, ...identity, created_at: "2026-09-02T00:00:00.000Z", root_hash: "sha256:root", ui_stacks: ["react"], unsupported_ui_stacks: [], routes: [], apis: [], i18n: {},
      files: [
        { source_id: "SRC-one", path: "One.tsx", language: "tsx", content_hash: "sha256:one", size_bytes: 1, imports: [] },
        { source_id: "SRC-two", path: "Two.tsx", language: "tsx", content_hash: "sha256:two", size_bytes: 1, imports: [] },
      ],
      interactions: [
        { element_id: "EL-one", screen_id: "SCR-one", kind: "button", label: "One", source_id: "SRC-one", line: 7, target_candidates: [] },
        { element_id: "EL-two", screen_id: "SCR-two", kind: "button", label: "Two", source_id: "SRC-two", line: 7, target_candidates: [] },
      ],
    } satisfies SourceSnapshot;
    const behaviors = [
      { element_id: "EL-one", source_id: "SRC-one", path: "One.tsx", line: 7, handler_lines: [7], called_symbols: ["taskApi.downloadOne"], local_state_keys: [], downstream_consumed_state_keys: [], literal_navigation_targets: [], explicit_failure: true, local_view_only: false, journey_required: true },
      { element_id: "EL-two", source_id: "SRC-two", path: "Two.tsx", line: 7, handler_lines: [7], called_symbols: ["taskApi.downloadTwo"], local_state_keys: [], downstream_consumed_state_keys: [], literal_navigation_targets: [], explicit_failure: true, local_view_only: false, journey_required: true },
    ] satisfies SourceInteractionBehavior[];

    const payload = createFactCatalogRepairPayload(
      draft,
      [{ evidence: firstEvidence, content: "one source" }, { evidence: secondEvidence, content: "two source" }],
      rejectedPatch,
      ["FACT_SOURCE_STABLE_OUTCOME_PREDICATE_MISSING:U2 requires a stable download outcome"],
      snapshot,
      behaviors,
    );

    expect(payload).not.toHaveProperty("rejected_catalog_patch");
    expect(payload).toHaveProperty("correction_plan");
    expect(payload.deterministic_fact_draft.screens.map((screen) => screen.screen_ref)).toEqual(["S2"]);
    expect(payload.deterministic_fact_draft.screens.flatMap((screen) => screen.elements.map((entry) => entry.element_ref))).toEqual(["U2"]);
    expect(payload.source_behavior_contracts).toEqual([expect.objectContaining({ element_ref: "U2" })]);
    expect(payload.evidence_slices).toEqual([{ evidence: secondEvidence, content: "two source" }]);

    const predicateScopedPayload = createFactCatalogRepairPayload(
      draft,
      [{ evidence: firstEvidence, content: "one source" }, { evidence: secondEvidence, content: "two source" }],
      {
        ...rejectedPatch,
        predicates: [{ key: "preset.status", values: ["idle", "error"], source: "code", evidence_element_refs: ["U2"] }],
      },
      ["PRED-preset-status-missing-request-failure-state:U2"],
      snapshot,
      [{ ...behaviors[1]!, called_symbols: ["largeSourceContract".repeat(8_000)] }],
    );

    expect(predicateScopedPayload.deterministic_fact_draft.screens.map((screen) => screen.screen_ref)).toEqual(["S2"]);
    expect(predicateScopedPayload.deterministic_fact_draft.screens.flatMap((screen) => screen.elements.map((entry) => entry.element_ref))).toEqual(["U2"]);
    expect(predicateScopedPayload.source_behavior_contracts).toEqual([]);
    const repairWork = {
      schemaVersion: 1 as const, projectId: identity.project_id, analysisRunId: identity.analysis_run_id, sourceSnapshotId: identity.source_snapshot_id,
      sessionId: "SESSION-test", workId: "WORK-repair", kind: "analysis.fact-catalog" as const, stage: "fact" as const,
      generationStep: "fact-catalog" as const, role: "repair" as const, outputArtifactType: "fact-catalog" as const,
      inputArtifacts: [], attemptId: "ATTEMPT-test", expectedRevision: 1, inputIds: [], stagingPath: ".scenarioforge/staging/WORK-repair",
      status: "running" as const, createdAt: "2026-09-10T00:00:00.000Z", updatedAt: "2026-09-10T00:00:00.000Z", progress: 0, completionRequested: false,
    } satisfies WorkDescriptor;
    expect(buildGenerationContextPack({ work: repairWork, role: "repair", payload: predicateScopedPayload }).manifest.estimatedTokens).toBeLessThan(28_000);
  });

  it("merges a scoped FACT catalog repair without deleting untouched annotations", () => {
    const rejected = {
      schema_version: 2 as const,
      screen_updates: [{ screen_ref: "S1", title: "Main" }],
      element_updates: [
        { element_ref: "U1", action_kind: "navigate" },
        { element_ref: "U2", action_kind: "download" },
      ],
      api_updates: [{ api_ref: "A1", reads: [], writes: ["POST /generate"] }],
      predicates: [{ key: "download.result", values: ["failure"], source: "code" as const, evidence_element_refs: ["U2"] }],
      edges: [],
    };
    const repair = {
      schema_version: 2 as const,
      screen_updates: [],
      element_updates: [{ element_ref: "U2", action_kind: "download-csv" }],
      api_updates: [],
      predicates: [{ key: "download.result", values: ["downloaded"], source: "code" as const, evidence_element_refs: ["U2"] }],
      edges: [],
    };

    expect(mergeFactCatalogRepairPatch(rejected, repair, ["PRED-u2-download-result-missing-success"])).toEqual({
      schema_version: 2,
      screen_updates: rejected.screen_updates,
      element_updates: [
        { element_ref: "U1", action_kind: "navigate" },
        { element_ref: "U2", action_kind: "download-csv" },
      ],
      api_updates: rejected.api_updates,
      predicates: [{ key: "download.result", values: ["failure", "downloaded"], source: "code", evidence_element_refs: ["U2"] }],
      edges: [],
    });
  });

  it("does not serialize a FACT bundle twice in its semantic review payload", () => {
    const facts = {
      schema_version: 2,
      project_id: "PRJ-test",
      analysis_run_id: "RUN-test",
      source_snapshot_id: "SNAP-test",
      screens: [],
      edges: [],
      predicates: [],
    } satisfies FactBundle;

    const payload = createSemanticReviewPayload("fact", facts, facts, undefined, []);

    expect(payload).toMatchObject({ artifact: facts });
    expect(payload).not.toHaveProperty("verified_facts");
  });

  it("reviews only compact scenario narration context after deterministic validation", () => {
    const facts = {
      schema_version: 2,
      project_id: "PRJ-test",
      analysis_run_id: "RUN-test",
      source_snapshot_id: "SNAP-test",
      screens: [],
      edges: [],
      predicates: [],
    } satisfies FactBundle;
    const wiki = {
      schema_version: 2,
      project_id: "PRJ-test",
      analysis_run_id: "RUN-test",
      source_snapshot_id: "SNAP-test",
      workflows: [{ schema_version: 2, project_id: "PRJ-test", analysis_run_id: "RUN-test", source_snapshot_id: "SNAP-test", workflow: "WF-test", goal: "Open a project workspace", entry_screens: [], success_terminal: "at(SCR-workspace)", failure_terminals: [], variation_axes: [], combination: { strategy: "base-choice", axis_defaults: {} }, depends_on: [], cites: [], status: "draft" }],
    } satisfies WikiBundle;
    const scenario = {
      schema_version: 2,
      project_id: "PRJ-test",
      analysis_run_id: "RUN-test",
      source_snapshot_id: "SNAP-test",
      scenarios: [{
        schema_version: 2,
        project_id: "PRJ-test",
        analysis_run_id: "RUN-test",
        source_snapshot_id: "SNAP-test",
        scenario_id: "SCN-test-001",
        workflow: "WF-test",
        kind: "normal",
        variation: {},
        preconditions: [],
        path: ["E-0001"],
        steps: [{ n: 1, action: "Select the project.", action_ref: { edge: "E-0001", element: "EL-project" }, expected: "The workspace opens.", assertion_refs: ["SCR-workspace"] }],
        status: "draft",
      }],
    } satisfies ScenarioSet;
    const payload = createSemanticReviewPayload("scenario", scenario, facts, wiki, [], [], undefined, [], scenario);

    expect(payload).not.toHaveProperty("artifact");
    expect(payload).not.toHaveProperty("verified_facts");
    expect(payload).not.toHaveProperty("verified_wiki");
    expect(payload).toMatchObject({
      deterministic_scenario_narration_view: [{ scenario_ref: "SCN-test-001", business_goal: "Open a project workspace" }],
      narrated_scenarios: [{ scenario_ref: "SCN-test-001", steps: [{ n: 1, action: "Select the project.", expected: "The workspace opens." }] }],
    });
  });

  it("asks the scenario author for narration patches without FACT, WIKI, paths, or action refs", () => {
    const identity = { project_id: "PRJ-test", analysis_run_id: "RUN-test", source_snapshot_id: "SNAP-test" };
    const wiki = { schema_version: 2 as const, ...identity, workflows: [{ schema_version: 2 as const, ...identity, workflow: "WF-test", goal: "Open a project workspace", entry_screens: [], success_terminal: "at(SCR-workspace)", failure_terminals: [], variation_axes: [], combination: { strategy: "base-choice" as const, axis_defaults: {} }, depends_on: [], cites: [], status: "draft" as const }] } satisfies WikiBundle;
    const draft = { schema_version: 2 as const, ...identity, scenarios: [{ schema_version: 2 as const, ...identity, scenario_id: "SCN-test-001", workflow: "WF-test", kind: "normal" as const, variation: {}, preconditions: [], path: ["E-0001"], steps: [{ n: 1, action: "'Project' click", action_ref: { edge: "E-0001", element: "EL-project" }, expected: "at SCR-workspace", assertion_refs: ["SCR-workspace"] }], status: "draft" as const }] } satisfies ScenarioSet;

    const payload = createScenarioCompositionPayload(draft, wiki);

    expect(payload.output_contract).toMatchObject({ schema_version: 1, scenario_updates: [{ scenario_ref: "exact SCN-*" }] });
    expect(payload).not.toHaveProperty("facts");
    expect(payload).not.toHaveProperty("wiki");
    expect(JSON.stringify(payload)).not.toContain("E-0001");
    expect(JSON.stringify(payload)).not.toContain("EL-project");
    expect(payload.task).toContain("exception");
    expect(payload.task).toContain("reversible toggle");
    expect(payload.task).toContain("unresolved");
    expect(payload.deterministic_scenario_narration_view).toMatchObject([{ scenario_ref: "SCN-test-001", business_goal: "Open a project workspace", steps: [{ n: 1, action: "'Project' click", expected: "at SCR-workspace" }] }]);
  });

  it("scopes a scenario repair to a targeted narration correction patch", () => {
    const identity = { project_id: "PRJ-test", analysis_run_id: "RUN-test", source_snapshot_id: "SNAP-test" };
    const wiki = { schema_version: 2 as const, ...identity, workflows: [{ schema_version: 2 as const, ...identity, workflow: "WF-test", goal: "Open a project workspace", entry_screens: [], success_terminal: "at(SCR-workspace)", failure_terminals: [], variation_axes: [], combination: { strategy: "base-choice" as const, axis_defaults: {} }, depends_on: [], cites: [], status: "draft" as const }] } satisfies WikiBundle;
    const scenarios = { schema_version: 2 as const, ...identity, scenarios: [{ schema_version: 2 as const, ...identity, scenario_id: "SCN-test-001", workflow: "WF-test", kind: "exception" as const, variation: {}, preconditions: [], path: ["E-0001"], steps: [{ n: 1, action: "'Project' click", action_ref: { edge: "E-0001", element: "EL-project" }, expected: "at SCR-workspace", assertion_refs: ["SCR-workspace"] }], status: "draft" as const }] } satisfies ScenarioSet;

    const scope = { base_artifact_hash: "sha256:base", scenario_refs: ["SCN-test-001"], fields: { "SCN-test-001": { precondition_indexes: [], step_fields: { "1": ["action", "expected"] as Array<"action" | "expected"> } } } };
    const payload = createScenarioRepairPayload(scenarios, wiki, scenarios, scope, ["SCENARIO_NARRATION_EXCEPTION_OUTCOME_MISSING:SCN-test-001"]);

    expect(payload.task).toContain("limited correction patch");
    expect(payload.task).toContain("untrusted defect reports");
    expect(payload.reviewer_issue_codes).toEqual(["SCENARIO_NARRATION_EXCEPTION_OUTCOME_MISSING:SCN-test-001"]);
    expect(payload.rejected_narration).toEqual([{ scenario_ref: "SCN-test-001", preconditions: [], steps: [{ n: 1, action: "'Project' click", expected: "at SCR-workspace" }] }]);
  });

  it("applies a model narration patch to the backend-owned scenario structure", async () => {
    const identity = { project_id: "PRJ-test", analysis_run_id: "RUN-test", source_snapshot_id: "SNAP-test" };
    const facts = { schema_version: 2 as const, ...identity, screens: [], edges: [], predicates: [] } satisfies FactBundle;
    const wiki = { schema_version: 2 as const, ...identity, workflows: [{ schema_version: 2 as const, ...identity, workflow: "WF-test", goal: "Open a project workspace", entry_screens: [], success_terminal: "at(SCR-workspace)", failure_terminals: [], variation_axes: [], combination: { strategy: "base-choice" as const, axis_defaults: {} }, depends_on: [], cites: [], status: "draft" as const }] } satisfies WikiBundle;
    const draft = { schema_version: 2 as const, ...identity, scenarios: [{ schema_version: 2 as const, ...identity, scenario_id: "SCN-test-001", workflow: "WF-test", kind: "normal" as const, variation: {}, preconditions: [], path: ["E-0001"], steps: [{ n: 1, action: "'Project' click", action_ref: { edge: "E-0001", element: "EL-project" }, expected: "at SCR-workspace", assertion_refs: ["SCR-workspace"] }], status: "draft" as const }] } satisfies ScenarioSet;
    const snapshot = { schema_version: 1 as const, ...identity, created_at: "2026-09-01T00:00:00.000Z", root_hash: "sha256:root", ui_stacks: ["react"], unsupported_ui_stacks: [], files: [], routes: [], apis: [], interactions: [], i18n: {} } satisfies SourceSnapshot;
    const work = { schemaVersion: 1 as const, projectId: "PRJ-test", analysisRunId: "RUN-test", sourceSnapshotId: "SNAP-test", sessionId: "SESSION-test", workId: "WORK-scenario", kind: "analysis.scenario-compose" as const, stage: "scenario" as const, attemptId: "ATTEMPT-test", expectedRevision: 1, inputIds: [], stagingPath: ".scenarioforge/staging/WORK-scenario", status: "running" as const, createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z", progress: 0, completionRequested: false } satisfies WorkDescriptor;
    const executor = new PiGenerationExecutor({ projectRoot: "/tmp/project", models: [], secretFor: () => undefined });
    vi.spyOn(executor as unknown as { runArtifact: () => Promise<unknown> }, "runArtifact").mockResolvedValue({
      schema_version: 1,
      scenario_updates: [{ scenario_ref: "SCN-test-001", preconditions: [], steps: [{ n: 1, action: "Select the project.", expected: "The workspace opens." }] }],
    });

    const narrated = await executor.composeScenarios({ snapshot, facts, wiki, draft, work });

    expect(narrated.scenarios[0].steps[0]).toMatchObject({ action: "Select the project.", expected: "The workspace opens.", action_ref: { edge: "E-0001", element: "EL-project" }, assertion_refs: ["SCR-workspace"] });
    expect(narrated.scenarios[0].path).toEqual(["E-0001"]);
  });

  it("fails closed when a scenario reviewer returns a non-narration issue", async () => {
    const identity = { project_id: "PRJ-test", analysis_run_id: "RUN-test", source_snapshot_id: "SNAP-test" };
    const facts = { schema_version: 2 as const, ...identity, screens: [], edges: [], predicates: [] } satisfies FactBundle;
    const wiki = { schema_version: 2 as const, ...identity, workflows: [] } satisfies WikiBundle;
    const scenarios = { schema_version: 2 as const, ...identity, scenarios: [] } satisfies ScenarioSet;
    const work = { schemaVersion: 1 as const, projectId: "PRJ-test", analysisRunId: "RUN-test", sourceSnapshotId: "SNAP-test", sessionId: "SESSION-test", workId: "WORK-scenario", kind: "analysis.scenario-compose" as const, stage: "scenario" as const, attemptId: "ATTEMPT-test", expectedRevision: 1, inputIds: [], stagingPath: ".scenarioforge/staging/WORK-scenario", status: "running" as const, createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z", progress: 0, completionRequested: false } satisfies WorkDescriptor;
    const executor = new PiGenerationExecutor({ projectRoot: "/tmp/project", models: [], secretFor: () => undefined });
    Object.assign(executor, { lastFacts: facts, lastWiki: wiki, lastScenarioDraft: scenarios });
    const runArtifact = vi.spyOn(executor as unknown as {
      runArtifact: (role: "author" | "reviewer", currentWork: WorkDescriptor, artifactId: string, payload: unknown) => Promise<unknown>;
    }, "runArtifact")
      .mockResolvedValueOnce({ pass: false, issueCodes: ["SCENARIO_PATH_CHANGED:invented structural issue"] })
      .mockResolvedValueOnce({ pass: false, issueCodes: ["SCENARIO_NARRATION_UNSUPPORTED:SCN-test-001:expected result overclaims FACT"] });

    await expect(executor.review({ stage: "scenario", artifact: scenarios, work })).resolves.toEqual({ pass: false, issueCodes: ["SCENARIO_PATH_CHANGED:invented structural issue"] });
    await expect(executor.review({ stage: "scenario", artifact: scenarios, work })).resolves.toEqual({ pass: false, issueCodes: ["SCENARIO_NARRATION_UNSUPPORTED:SCN-test-001:expected result overclaims FACT"] });
    expect(runArtifact).toHaveBeenCalledTimes(2);
  });

  it("bounds WIKI review to the same verified FACT graph available to its author", () => {
    const facts = {
      schema_version: 2,
      project_id: "PRJ-test",
      analysis_run_id: "RUN-test",
      source_snapshot_id: "SNAP-test",
      screens: [],
      edges: [],
      predicates: [],
    } satisfies FactBundle;
    const wiki = {
      schema_version: 2,
      project_id: "PRJ-test",
      analysis_run_id: "RUN-test",
      source_snapshot_id: "SNAP-test",
      workflows: [],
    } satisfies WikiBundle;

    const payload = createSemanticReviewPayload("wiki", wiki, facts, undefined, [{ evidence: { source_id: "SRC-hidden" }, content: "source-only behavior" }]);

    expect(payload.reviewer_evidence_slices).toEqual([]);
    expect(payload.task).toContain("author-owned workflow goals");
    expect(payload.task).toContain("WIKI_GOAL_*");
    expect(payload.task).toContain("backend has already deterministically validated");
    expect(payload).not.toHaveProperty("verified_facts");
    expect(payload).toMatchObject({
      artifact: { workflows: [] },
      verified_fact_graph: { screens: [], edges: [] },
    });
  });

  it("fails closed when a WIKI reviewer returns a non-goal issue", async () => {
    const identity = { project_id: "PRJ-test", analysis_run_id: "RUN-test", source_snapshot_id: "SNAP-test" };
    const facts = { schema_version: 2 as const, ...identity, screens: [], edges: [], predicates: [] } satisfies FactBundle;
    const wiki = { schema_version: 2 as const, ...identity, workflows: [] } satisfies WikiBundle;
    const work = {
      schemaVersion: 1 as const,
      projectId: "PRJ-test",
      analysisRunId: "RUN-test",
      sourceSnapshotId: "SNAP-test",
      sessionId: "SESSION-test",
      workId: "WORK-wiki",
      kind: "analysis.wiki-compose" as const,
      stage: "wiki" as const,
      attemptId: "ATTEMPT-test",
      expectedRevision: 1,
      inputIds: [],
      stagingPath: ".scenarioforge/staging/WORK-wiki",
      status: "running" as const,
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
      progress: 0,
      completionRequested: false,
    } satisfies WorkDescriptor;
    const executor = new PiGenerationExecutor({ projectRoot: "/tmp/project", models: [], secretFor: () => undefined });
    Object.assign(executor, { lastFacts: facts });
    const runArtifact = vi.spyOn(executor as unknown as {
      runArtifact: (role: "author" | "reviewer", currentWork: WorkDescriptor, artifactId: string, payload: unknown) => Promise<unknown>;
    }, "runArtifact")
      .mockResolvedValueOnce({ pass: false, issueCodes: [
        "WIKI_WORKFLOW_DEPENDENCY_CYCLE:invented structural relationship",
        "WIKI_WORKFLOW_TERMINAL_MISMATCH:E-0016:WF-invented",
      ] })
      .mockResolvedValueOnce({ pass: false, issueCodes: [
        "WIKI_GOAL_UNSUPPORTED:WF-real:goal claims an outcome absent from FACT",
      ] });

    await expect(executor.review({ stage: "wiki", artifact: wiki, work })).resolves.toEqual({
      pass: false,
      issueCodes: [
        "WIKI_WORKFLOW_DEPENDENCY_CYCLE:invented structural relationship",
        "WIKI_WORKFLOW_TERMINAL_MISMATCH:E-0016:WF-invented",
      ],
    });
    await expect(executor.review({ stage: "wiki", artifact: wiki, work })).resolves.toEqual({
      pass: false,
      issueCodes: ["WIKI_GOAL_UNSUPPORTED:WF-real:goal claims an outcome absent from FACT"],
    });
    expect(runArtifact).toHaveBeenCalledTimes(2);
  });

  it("asks the model for a semantic FACT patch without delegating IDs or evidence provenance", () => {
    const draft = {
      schema_version: 2,
      project_id: "PRJ-test",
      analysis_run_id: "RUN-test",
      source_snapshot_id: "SNAP-test",
      screens: [{ schema_version: 3, project_id: "PRJ-test", analysis_run_id: "RUN-test", source_snapshot_id: "SNAP-test", screen_id: "SCR-login", title: "Login", entry_guards: [], elements: [{ id: "EL-login-submit", type: "button", label: "Sign in", interaction: { action_kind: "click", surface_kind: "web", target_candidates: [{ by: "test-id", value: "submit" }] }, evidence: [{ source_id: "SRC-login", source_snapshot_id: "SNAP-test", path: "Login.tsx", start_line: 1, end_line: 20, content_hash: "sha256:owned", evidence_grant_id: "EVG-work-1" }] }], apis: [], feedback: [], displays: [], status: "draft" }],
      edges: [], predicates: [],
    } satisfies FactBundle;

    const snapshot = {
      schema_version: 1, project_id: "PRJ-test", analysis_run_id: "RUN-test", source_snapshot_id: "SNAP-test", root_hash: "sha256:root", created_at: "2026-09-01T00:00:00.000Z",
      ui_stacks: ["react"], unsupported_ui_stacks: [], files: [{ source_id: "SRC-login", path: "Login.tsx", language: "tsx", content_hash: "sha256:file", size_bytes: 1, imports: [] }], routes: [], apis: [],
      interactions: [{ element_id: "EL-login-submit", screen_id: "SCR-login", kind: "button", label: "Sign in", source_id: "SRC-login", line: 7, target_candidates: [{ by: "test-id", value: "submit" }] }], i18n: {},
    } satisfies SourceSnapshot;
    const sourceBehavior = { element_id: "EL-login-submit", source_id: "SRC-login", path: "Login.tsx", line: 7, handler_lines: [7], called_symbols: ["handleLogin"], local_state_keys: [], downstream_consumed_state_keys: [], literal_navigation_targets: [], explicit_failure: true, local_view_only: false, journey_required: true };
    const payload = createFactEnrichmentPayload(draft, [{ evidence: draft.screens[0].elements[0].evidence[0], content: "<button>Sign in</button>" }], snapshot, [sourceBehavior]);
    const contract = JSON.stringify(payload.output_contract);

    expect(payload.output_contract.schema_version).toBe(2);
    expect(payload).toMatchObject({ task: expect.stringContaining("patch"), deterministic_fact_draft: { screens: [{ screen_ref: "S1", elements: [{ element_ref: "U1", source_anchor: { path: "Login.tsx", line: 7 } }] }] } });
    expect(contract).not.toMatch(/content_hash|evidence_grant_id|start_line|end_line/);
    expect(contract).toContain('"all"');
    expect(JSON.stringify(payload.deterministic_fact_draft)).not.toMatch(/SCR-login|EL-login-submit/);
    expect(JSON.stringify(payload)).toContain("Backend-owned IDs and evidence are immutable");
    expect(payload.task).toContain("conditionally rendered or enabled");
    expect(payload.task).toContain("Use [] rather than null");
    expect(payload.task).toContain("every conjunct");
    expect(payload.task).toContain("Omit guard for unconditional");
    expect(payload.task).toContain("disabled={condition}");
    expect(payload.task).toContain("Conditional wording in effect does not count");
    expect(payload.task).toContain("journey-defining");
    expect(payload.task).toContain("source_anchor");
    expect(payload.task).toContain("self-loop");
    expect(payload.task).toContain("Every retained normal same-screen journey edge");
    expect(payload.task).toContain("eligibility or payload");
    expect(payload.task).toContain("Element existence is not action evidence");
    expect(payload.task).toContain("exception edge");
    expect(payload.task).toContain("failure-specific predicate effect");
    expect(payload.task).toContain("Never create a separate request-start edge");
    expect(payload.task).toContain("one user trigger");
    expect(payload.task).toContain("input-rejection exception uses the evidenced invalid or missing-input guard");
    expect(payload.task).toContain("post-request failure");
    expect(payload.task).toContain("repopulates or restores controls consumed by a later journey action");
    expect(payload.task).toContain("source_behavior_contracts");
    expect(payload.source_behavior_contracts).toEqual([{ element_ref: "U1", path: "Login.tsx", line: 7, handler_lines: [7], called_symbols: ["handleLogin"], local_state_keys: [], downstream_consumed_state_keys: [], literal_navigation_targets: [], explicit_failure: true, local_view_only: false, journey_required: true }]);
    expect(JSON.stringify(payload.source_behavior_contracts)).not.toContain("EL-login-submit");
  });

  it("gives the FACT reviewer exact element source anchors for repeated dynamic controls", () => {
    const facts = {
      schema_version: 2, project_id: "PRJ-test", analysis_run_id: "RUN-test", source_snapshot_id: "SNAP-test", edges: [], predicates: [],
      screens: [{ schema_version: 3, project_id: "PRJ-test", analysis_run_id: "RUN-test", source_snapshot_id: "SNAP-test", screen_id: "SCR-main", title: "Main", entry_guards: [], apis: [], feedback: [], displays: [], status: "draft", elements: [
        { id: "EL-category-parent", type: "checkbox", label: "선택", interaction: { action_kind: "toggle", surface_kind: "web", target_candidates: [{ by: "role-name", role: "checkbox", name: "선택" }] }, evidence: [] },
        { id: "EL-category-child", type: "checkbox", label: "선택", interaction: { action_kind: "toggle", surface_kind: "web", target_candidates: [{ by: "role-name", role: "checkbox", name: "선택" }] }, evidence: [] },
      ] }],
    } satisfies FactBundle;
    const snapshot = {
      schema_version: 1, project_id: "PRJ-test", analysis_run_id: "RUN-test", source_snapshot_id: "SNAP-test", root_hash: "sha256:root", created_at: "2026-09-01T00:00:00.000Z", ui_stacks: ["react"], unsupported_ui_stacks: [],
      files: [{ source_id: "SRC-main", path: "Main.jsx", language: "jsx", content_hash: "sha256:file", size_bytes: 1, imports: [] }], routes: [], apis: [], i18n: {},
      interactions: [
        { element_id: "EL-category-parent", screen_id: "SCR-main", kind: "checkbox", label: "선택", source_id: "SRC-main", line: 640, target_candidates: [{ by: "role-name", role: "checkbox", name: "선택" }] },
        { element_id: "EL-category-child", screen_id: "SCR-main", kind: "checkbox", label: "선택", source_id: "SRC-main", line: 661, target_candidates: [{ by: "role-name", role: "checkbox", name: "선택" }] },
      ],
    } satisfies SourceSnapshot;

    const payload = createSemanticReviewPayload("fact", facts, facts, undefined, [], [], snapshot);

    expect(payload).toMatchObject({ fact_source_inventory: { elements: [
      { element_id: "EL-category-parent", path: "Main.jsx", line: 640 },
      { element_id: "EL-category-child", path: "Main.jsx", line: 661 },
    ] } });
    expect(payload.task).toContain("repopulates or restores controls consumed by a later journey action");
  });

  it("scopes a FACT repair to one full replacement patch and untrusted reviewer issues", () => {
    const draft = {
      schema_version: 2,
      project_id: "PRJ-test",
      analysis_run_id: "RUN-test",
      source_snapshot_id: "SNAP-test",
      screens: [],
      edges: [],
      predicates: [],
    } satisfies FactBundle;
    const rejectedPatch = {
      schema_version: 2 as const,
      screen_updates: [],
      element_updates: [],
      api_updates: [],
      predicates: [{ key: "stable", values: ["true"], source: "code" as const, evidence_element_refs: ["U2"] }],
      edges: [{
        kind: "normal" as const,
        from_screen_ref: "S2",
        on_element_ref: "U2",
        to_screen_ref: "S2",
        effect: { predicate_key: "stable", value: "true" },
      }, {
        kind: "normal" as const,
        from_screen_ref: "S1",
        on_element_ref: "U1",
        to_screen_ref: "S1",
        guard: { predicate_key: "flow_id_present", value: "true" },
      }],
    };
    const currentFacts = {
      ...draft,
      edges: [{
        schema_version: 2 as const,
        project_id: draft.project_id,
        analysis_run_id: draft.analysis_run_id,
        source_snapshot_id: draft.source_snapshot_id,
        edge_id: "E-0001",
        kind: "normal" as const,
        from: "SCR-one",
        on: "EL-one",
        to: "SCR-one",
        feedback: [],
        evidence: [],
        status: "draft" as const,
      }, {
        schema_version: 2 as const,
        project_id: draft.project_id,
        analysis_run_id: draft.analysis_run_id,
        source_snapshot_id: draft.source_snapshot_id,
        edge_id: "E-0002",
        kind: "normal" as const,
        from: "SCR-two",
        on: "EL-two",
        effect: "PRED-stable=true",
        to: "SCR-two",
        feedback: [],
        evidence: [],
        status: "draft" as const,
      }],
    } satisfies FactBundle;

    const validationIssue = { code: "FACT_SELF_LOOP_OUTCOME_MISSING", severity: "error", path: "edges.6", message: "A same-screen journey edge must record an observable effect or feedback outcome." } satisfies ValidationIssue;
    const reviewerIssue = `${validationIssue.code}:E-0001 has no observable outcome`;
    const payload = createFactRepairPayload(draft, [], rejectedPatch, [reviewerIssue], [validationIssue], undefined, [], currentFacts);

    expect(payload.task).toContain("one complete corrected patch");
    expect(payload.task).toContain("untrusted defect reports");
    expect(payload.task).toContain("every guard/effect predicate key");
    expect(payload.task).toContain("omit that edge");
    expect(payload.task).not.toContain("omit an unnecessary effect");
    expect(payload.rejected_patch).toBe(rejectedPatch);
    expect(payload.reviewer_issue_codes).toEqual([reviewerIssue]);
    expect(payload.deterministic_validation_issues).toEqual([{ code: validationIssue.code, path: validationIssue.path, message: validationIssue.message }]);
    expect(payload.deterministic_reviewer_edge_obligations).toEqual([{
      edge_id: "E-0001",
      kind: "normal",
      from_screen_ref: "S1",
      on_element_ref: "U1",
      to_screen_ref: "S1",
    }]);
    expect(payload.deterministic_predicate_reference_obligations).toEqual([{
      predicate_key: "flow_id_present",
      location: "guard",
      from_screen_ref: "S1",
      on_element_ref: "U1",
      to_screen_ref: "S1",
      required_resolution: "declare_evidence_backed_predicate_or_remove_reference",
    }]);
    expect(payload.deterministic_self_loop_outcome_obligations).toEqual([{
      from_screen_ref: "S1",
      on_element_ref: "U1",
      to_screen_ref: "S1",
      required_resolution: "add_evidence_backed_registered_effect_or_remove_edge",
    }]);
  });

  it("limits FACT repair evidence and draft context to reviewer-referenced opaque refs", () => {
    const identity = { project_id: "PRJ-test", analysis_run_id: "RUN-test", source_snapshot_id: "SNAP-test" };
    const evidenceOne = { source_id: "SRC-one", source_snapshot_id: identity.source_snapshot_id, path: "One.tsx", start_line: 1, end_line: 20, content_hash: "sha256:one", evidence_grant_id: "EVG-work-1" };
    const evidenceTwo = { source_id: "SRC-two", source_snapshot_id: identity.source_snapshot_id, path: "Two.tsx", start_line: 1, end_line: 20, content_hash: "sha256:two", evidence_grant_id: "EVG-work-1" };
    const draft = {
      schema_version: 2 as const, ...identity, predicates: [], edges: [], screens: [
        { schema_version: 3 as const, ...identity, screen_id: "SCR-one", title: "One", entry_guards: [], apis: [], feedback: [], displays: [], status: "draft" as const, elements: [{ id: "EL-one", type: "button", label: "One action", interaction: { action_kind: "click", surface_kind: "web" as const, target_candidates: [{ by: "role-name" as const, role: "button", name: "One action" }] }, evidence: [evidenceOne] }] },
        { schema_version: 3 as const, ...identity, screen_id: "SCR-two", title: "Two", entry_guards: [], apis: [], feedback: [], displays: [], status: "draft" as const, elements: [{ id: "EL-two", type: "button", label: "Two action", interaction: { action_kind: "click", surface_kind: "web" as const, target_candidates: [{ by: "role-name" as const, role: "button", name: "Two action" }] }, evidence: [evidenceTwo] }] },
      ],
    } satisfies FactBundle;
    const rejectedPatch = {
      schema_version: 2 as const,
      screen_updates: [],
      element_updates: [],
      api_updates: [],
      predicates: [],
      edges: [{ kind: "normal" as const, from_screen_ref: "S1", on_element_ref: "U1", to_screen_ref: "S1" }],
    };
    const currentFacts = {
      ...draft,
      edges: [{ schema_version: 2 as const, ...identity, edge_id: "E-0001", kind: "normal" as const, from: "SCR-one", on: "EL-one", to: "SCR-one", feedback: [], evidence: [evidenceOne], status: "draft" as const }],
    } satisfies FactBundle;
    const snapshot = {
      schema_version: 1 as const, ...identity, root_hash: "sha256:root", created_at: "2026-09-01T00:00:00.000Z", ui_stacks: ["react"], unsupported_ui_stacks: [], routes: [], apis: [], i18n: {},
      files: [
        { source_id: "SRC-one", path: "One.tsx", language: "tsx", content_hash: "sha256:file-one", size_bytes: 1, imports: [] },
        { source_id: "SRC-two", path: "Two.tsx", language: "tsx", content_hash: "sha256:file-two", size_bytes: 1, imports: [] },
      ],
      interactions: [
        { element_id: "EL-one", screen_id: "SCR-one", kind: "button", label: "One action", source_id: "SRC-one", line: 7, target_candidates: [{ by: "role-name" as const, role: "button", name: "One action" }] },
        { element_id: "EL-two", screen_id: "SCR-two", kind: "button", label: "Two action", source_id: "SRC-two", line: 7, target_candidates: [{ by: "role-name" as const, role: "button", name: "Two action" }] },
      ],
    } satisfies SourceSnapshot;
    const behaviors = [
      { element_id: "EL-one", source_id: "SRC-one", path: "One.tsx", line: 7, handler_lines: [7], called_symbols: ["setOne"], local_state_keys: ["one"], downstream_consumed_state_keys: ["one"], literal_navigation_targets: [], explicit_failure: false, local_view_only: false, journey_required: true },
      { element_id: "EL-two", source_id: "SRC-two", path: "Two.tsx", line: 7, handler_lines: [7], called_symbols: ["setTwo"], local_state_keys: ["two"], downstream_consumed_state_keys: ["two"], literal_navigation_targets: [], explicit_failure: false, local_view_only: false, journey_required: true },
    ];

    const payload = createFactRepairPayload(
      draft,
      [{ evidence: evidenceOne, content: "one source" }, { evidence: evidenceTwo, content: "two source" }],
      rejectedPatch,
      ["FACT_TARGET_MISMATCH:E-0001 should target SCR-two"],
      [],
      snapshot,
      behaviors,
      currentFacts,
    );

    expect(payload.deterministic_reviewer_edge_obligations).toEqual([expect.objectContaining({ edge_id: "E-0001", on_element_ref: "U1" })]);
    expect(payload.deterministic_reviewer_screen_obligations).toEqual([{ screen_id: "SCR-two", screen_ref: "S2" }]);
    expect(payload.source_behavior_contracts).toEqual([expect.objectContaining({ element_ref: "U1" })]);
    expect(payload.evidence_slices).toEqual([{ evidence: evidenceOne, content: "one source" }]);
    expect(payload.deterministic_fact_draft.screens.map((screen) => screen.screen_ref)).toEqual(["S1", "S2"]);
    expect(payload.deterministic_fact_draft.screens.flatMap((screen) => screen.elements.map((element) => element.element_ref))).toEqual(["U1"]);
  });

  it("maps validation-message refs before building a bounded FACT repair context", () => {
    const identity = { project_id: "PRJ-test", analysis_run_id: "RUN-test", source_snapshot_id: "SNAP-test" };
    const element = (id: string, label: string) => ({ id, type: "button", label, interaction: { action_kind: "click", surface_kind: "web" as const, target_candidates: [] }, evidence: [] });
    const draft = {
      schema_version: 2 as const,
      ...identity,
      screens: [
        { schema_version: 3 as const, ...identity, screen_id: "SCR-one", title: "One", entry_guards: [], elements: [element("EL-one", "One")], apis: [], feedback: [], displays: [], status: "draft" as const },
        { schema_version: 3 as const, ...identity, screen_id: "SCR-two", title: "Two", entry_guards: [], elements: [element("EL-two", "Two")], apis: [], feedback: [], displays: [], status: "draft" as const },
      ],
      edges: [],
      predicates: [],
    } satisfies FactBundle;
    const rejectedPatch = { schema_version: 2 as const, screen_updates: [], element_updates: [], api_updates: [], predicates: [], edges: [] };

    const payload = createFactRepairPayload(
      draft,
      [],
      rejectedPatch,
      ["FACT_JOURNEY_ACTION_MISSING"],
      [{ code: "FACT_JOURNEY_ACTION_MISSING", severity: "error", path: "screens.1.elements.0", message: "U2 must have an evidence-backed journey edge." }],
    );

    expect(payload.deterministic_reviewer_element_obligations).toEqual([{ element_id: "EL-two", element_ref: "U2" }]);
    expect(payload.deterministic_fact_draft.screens.map((screen) => screen.screen_ref)).toEqual(["S2"]);
    expect(payload.deterministic_fact_draft.screens.flatMap((screen) => screen.elements.map((entry) => entry.element_ref))).toEqual(["U2"]);
  });

  it("scopes predicate-collision repair through the predicate's evidence elements", () => {
    const draft = {
      schema_version: 2 as const,
      project_id: "PRJ-test",
      analysis_run_id: "RUN-test",
      source_snapshot_id: "SNAP-test",
      screens: [{
        schema_version: 3 as const,
        project_id: "PRJ-test",
        analysis_run_id: "RUN-test",
        source_snapshot_id: "SNAP-test",
        screen_id: "SCR-one",
        title: "One",
        entry_guards: [],
        elements: [{ id: "EL-one", type: "button", label: "One", interaction: { action_kind: "click", surface_kind: "web" as const, target_candidates: [] }, evidence: [] }],
        apis: [],
        feedback: [],
        displays: [],
        status: "draft" as const,
      }],
      edges: [],
      predicates: [],
    } satisfies FactBundle;
    const rejectedPatch = {
      schema_version: 2 as const,
      screen_updates: [],
      element_updates: [],
      api_updates: [],
      predicates: [{ key: "one.state", values: ["true"], source: "code" as const, evidence_element_refs: ["U1"] }],
      edges: [],
    };

    const payload = createFactRepairPayload(
      draft,
      [],
      rejectedPatch,
      ["FACT_PATCH_PREDICATE_ID_COLLISION"],
      [{ code: "FACT_PATCH_PREDICATE_ID_COLLISION", severity: "error", path: "predicates.0.key", message: "Predicate IDs collide." }],
    );

    expect(payload.deterministic_validation_predicate_obligations).toEqual([{
      predicate_index: 0,
      key: "one.state",
      evidence_element_refs: ["U1"],
    }]);
    expect(payload.deterministic_fact_draft.screens.flatMap((screen) => screen.elements.map((entry) => entry.element_ref))).toEqual(["U1"]);
  });

  it("fails repair context construction instead of widening an unmappable issue to the full project", () => {
    const draft = { schema_version: 2 as const, project_id: "PRJ-test", analysis_run_id: "RUN-test", source_snapshot_id: "SNAP-test", screens: [], edges: [], predicates: [] } satisfies FactBundle;
    const rejectedPatch = { schema_version: 2 as const, screen_updates: [], element_updates: [], api_updates: [], predicates: [], edges: [] };

    expect(() => createFactRepairPayload(draft, [], rejectedPatch, ["FACT_UNKNOWN_GLOBAL_ISSUE"])).toThrow("FACT_REPAIR_CONTEXT_SCOPE_UNMAPPABLE");
  });

  it("requests one final contract correction when a semantic FACT replacement references an undeclared predicate", async () => {
    const evidence = { source_id: "SRC-form", source_snapshot_id: "SNAP-test", path: "Form.tsx", start_line: 1, end_line: 10, content_hash: "sha256:owned", evidence_grant_id: "EVG-work-1" };
    const draft = {
      schema_version: 2,
      project_id: "PRJ-test",
      analysis_run_id: "RUN-test",
      source_snapshot_id: "SNAP-test",
      screens: [{ schema_version: 3, project_id: "PRJ-test", analysis_run_id: "RUN-test", source_snapshot_id: "SNAP-test", screen_id: "SCR-form", title: "Form", entry_guards: [], elements: [{ id: "EL-form-search", type: "button", label: "Search", interaction: { action_kind: "click", surface_kind: "web", target_candidates: [{ by: "role", role: "button", name: "Search" }] }, evidence: [evidence] }], apis: [], feedback: [], displays: [], status: "draft" }],
      edges: [],
      predicates: [],
    } satisfies FactBundle;
    const rejectedPatch = { schema_version: 2 as const, screen_updates: [], element_updates: [], api_updates: [], predicates: [], edges: [] };
    const invalidReplacement = {
      ...rejectedPatch,
      edges: [{ kind: "normal" as const, from_screen_ref: "S1", on_element_ref: "U1", to_screen_ref: "S1", effect: { predicate_key: "query_applied", value: "true" } }],
    };
    const correctedReplacement = {
      ...invalidReplacement,
      predicates: [{ key: "query_applied", values: ["true", "false"], source: "code" as const, evidence_element_refs: ["U1"] }],
    };
    const snapshot = { schema_version: 1 as const, project_id: "PRJ-test", analysis_run_id: "RUN-test", source_snapshot_id: "SNAP-test", created_at: "2026-08-28T00:00:00.000Z", root_hash: "sha256:root", ui_stacks: ["react"], unsupported_ui_stacks: [], files: [], routes: [], apis: [], interactions: [], i18n: {} } satisfies SourceSnapshot;
    const work = { schemaVersion: 1 as const, projectId: "PRJ-test", analysisRunId: "RUN-test", sourceSnapshotId: "SNAP-test", sessionId: "SESSION-test", workId: "WORK-test", kind: "analysis.fact-extract" as const, stage: "fact" as const, attemptId: "ATTEMPT-test", expectedRevision: 1, inputIds: [], stagingPath: ".scenarioforge/staging/WORK-test", status: "running" as const, createdAt: "2026-08-28T00:00:00.000Z", updatedAt: "2026-08-28T00:00:00.000Z", progress: 0, completionRequested: false } satisfies WorkDescriptor;
    const executor = new PiGenerationExecutor({ projectRoot: "/tmp/project", models: [], secretFor: () => undefined });
    Object.assign(executor, { lastFactDraft: draft, lastFactSlices: [], lastFactPatch: rejectedPatch, lastSnapshot: snapshot });
    const runArtifact = vi.spyOn(executor as unknown as {
      runArtifact: (role: "author" | "reviewer", currentWork: WorkDescriptor, artifactId: string, payload: unknown) => Promise<unknown>;
    }, "runArtifact")
      .mockResolvedValueOnce(invalidReplacement)
      .mockResolvedValueOnce(correctedReplacement);

    const repaired = await executor.repairFacts({ snapshot, facts: draft, issueCodes: ["MISSING_JOURNEY_ACTION:U1"], work });

    expect(runArtifact).toHaveBeenCalledTimes(2);
    expect(runArtifact.mock.calls[1]?.[3]).toMatchObject({ reviewer_issue_codes: ["FACT_PATCH_REFERENCE_INVALID:predicate_key:query_applied"] });
    expect(repaired.predicates.map((predicate) => predicate.pred_id)).toEqual(["PRED-query-applied"]);
    expect(repaired.edges[0]?.effect).toBe("PRED-query-applied=true");
  });

  it("allows one bounded correction for a structurally malformed FACT patch but not identity or evidence failures", () => {
    expect(correctableFactPatchContractError("FACT_PATCH_SCHEMA_INVALID")).toBe(true);
    expect(correctableFactPatchContractError("FACT_PATCH_SCHEMA_INVALID:edges.0.guard:ANY_UNSUPPORTED")).toBe(true);
    expect(correctableFactPatchContractError("FACT_PATCH_REFERENCE_INVALID:predicate_key:missing")).toBe(true);
    expect(correctableFactPatchContractError("FACT_PATCH_REFERENCE_INVALID:predicate_value:csv_export_failed=false,excel_export_failed=false")).toBe(true);
    expect(correctableFactPatchContractError("FACT_PATCH_REFERENCE_INVALID:element_ref:U999")).toBe(false);
    expect(correctableFactPatchContractError("FACT_PATCH_EVIDENCE_INVALID")).toBe(false);
  });

  it("requests one predicate-only contract correction for the initial FACT patch", async () => {
    const evidence = { source_id: "SRC-form", source_snapshot_id: "SNAP-test", path: "Form.tsx", start_line: 1, end_line: 1, content_hash: "sha256:owned", evidence_grant_id: "EVG-WORK-test-owned" };
    const snapshot = {
      schema_version: 1 as const,
      project_id: "PRJ-test",
      analysis_run_id: "RUN-test",
      source_snapshot_id: "SNAP-test",
      created_at: "2026-08-28T00:00:00.000Z",
      root_hash: "sha256:root",
      ui_stacks: ["react"],
      unsupported_ui_stacks: [],
      files: [{ source_id: "SRC-form", path: "Form.tsx", language: "tsx", content_hash: "sha256:file", size_bytes: 1, imports: [] }],
      routes: [{ screen_id: "SCR-form", route: "/form", source_id: "SRC-form", line: 1 }],
      apis: [],
      interactions: [{ element_id: "EL-form-submit", screen_id: "SCR-form", kind: "button", label: "Submit", source_id: "SRC-form", line: 1, target_candidates: [{ by: "role-name", role: "button", name: "Submit" }] }],
      i18n: {},
    } satisfies SourceSnapshot;
    const work = { schemaVersion: 1 as const, projectId: "PRJ-test", analysisRunId: "RUN-test", sourceSnapshotId: "SNAP-test", sessionId: "SESSION-test", workId: "WORK-test", kind: "analysis.fact-extract" as const, stage: "fact" as const, attemptId: "ATTEMPT-test", expectedRevision: 1, inputIds: [], stagingPath: ".scenarioforge/staging/WORK-test", status: "running" as const, createdAt: "2026-08-28T00:00:00.000Z", updatedAt: "2026-08-28T00:00:00.000Z", progress: 0, completionRequested: false } satisfies WorkDescriptor;
    const basePatch = { schema_version: 2 as const, screen_updates: [], element_updates: [], api_updates: [], predicates: [], edges: [] };
    const invalidPatch = { ...basePatch, edges: [{ kind: "normal" as const, from_screen_ref: "S1", on_element_ref: "U1", to_screen_ref: "S1", effect: { predicate_key: "generation_failed", value: "true" } }] };
    const correctedPatch = { ...invalidPatch, predicates: [{ key: "generation_failed", values: ["true"], source: "code" as const, evidence_element_refs: ["U1"] }] };
    const executor = new PiGenerationExecutor({ projectRoot: "/tmp/project", models: [], secretFor: () => undefined });
    vi.spyOn(executor as unknown as {
      sourceSlices: (currentSnapshot: SourceSnapshot, workId: string) => Promise<{ grant: { schema_version: 1; evidence_grant_id: string; project_id: string; work_id: string; source_snapshot_id: string; evidence: typeof evidence[]; created_at: string }; slices: Array<{ evidence: typeof evidence; content: string }> }>;
    }, "sourceSlices").mockResolvedValue({
      grant: { schema_version: 1, evidence_grant_id: "EVG-WORK-test-owned", project_id: "PRJ-test", work_id: "WORK-test", source_snapshot_id: "SNAP-test", evidence: [evidence], created_at: "2026-08-28T00:00:00.000Z" },
      slices: [{ evidence, content: "<button onClick={submit}>Submit</button>" }],
    });
    vi.spyOn(executor as unknown as { sourceBehaviors: (currentSnapshot: SourceSnapshot) => Promise<[]> }, "sourceBehaviors").mockResolvedValue([]);
    const runArtifact = vi.spyOn(executor as unknown as {
      runArtifact: (role: "author" | "reviewer", currentWork: WorkDescriptor, artifactId: string, payload: unknown) => Promise<unknown>;
    }, "runArtifact").mockResolvedValueOnce(invalidPatch).mockResolvedValueOnce(correctedPatch);

    const facts = await executor.extractFacts({ snapshot, work });

    expect(runArtifact).toHaveBeenCalledTimes(2);
    expect(runArtifact.mock.calls[1]?.[3]).toMatchObject({ reviewer_issue_codes: ["FACT_PATCH_REFERENCE_INVALID:predicate_key:generation_failed"] });
    expect(facts.edges[0]?.effect).toBe("PRED-generation-failed=true");
  });

  it("requests one structural contract correction for the initial FACT catalog patch", async () => {
    const evidence = { source_id: "SRC-form", source_snapshot_id: "SNAP-test", path: "Form.tsx", start_line: 1, end_line: 1, content_hash: "sha256:owned", evidence_grant_id: "EVG-WORK-test-owned" };
    const snapshot = {
      schema_version: 1 as const,
      project_id: "PRJ-test",
      analysis_run_id: "RUN-test",
      source_snapshot_id: "SNAP-test",
      created_at: "2026-08-28T00:00:00.000Z",
      root_hash: "sha256:root",
      ui_stacks: ["react"],
      unsupported_ui_stacks: [],
      files: [{ source_id: "SRC-form", path: "Form.tsx", language: "tsx", content_hash: "sha256:file", size_bytes: 1, imports: [] }],
      routes: [{ screen_id: "SCR-form", route: "/form", source_id: "SRC-form", line: 1 }],
      apis: [],
      interactions: [{ element_id: "EL-form-submit", screen_id: "SCR-form", kind: "button", label: "Submit", source_id: "SRC-form", line: 1, target_candidates: [{ by: "role-name", role: "button", name: "Submit" }] }],
      i18n: {},
    } satisfies SourceSnapshot;
    const work = { schemaVersion: 1 as const, projectId: "PRJ-test", analysisRunId: "RUN-test", sourceSnapshotId: "SNAP-test", sessionId: "SESSION-test", workId: "WORK-test", kind: "analysis.fact-catalog" as const, stage: "fact" as const, generationStep: "fact-catalog" as const, role: "author" as const, outputArtifactType: "fact-catalog", inputArtifacts: [], attemptId: "ATTEMPT-test", expectedRevision: 1, inputIds: [], stagingPath: ".scenarioforge/staging/WORK-test", status: "running" as const, createdAt: "2026-08-28T00:00:00.000Z", updatedAt: "2026-08-28T00:00:00.000Z", progress: 0, completionRequested: false } satisfies WorkDescriptor;
    const invalidPatch = { schema_version: 2, screen_updates: [], element_updates: [], api_updates: [], predicates: [{ key: "form.ready", values: ["true"], evidence_element_refs: ["U1"] }], edges: [] };
    const correctedPatch = { ...invalidPatch, schema_version: 2 as const, predicates: [{ ...invalidPatch.predicates[0]!, source: "code" as const }] };
    const executor = new PiGenerationExecutor({ projectRoot: "/tmp/project", models: [], secretFor: () => undefined });
    vi.spyOn(executor as unknown as {
      sourceSlices: () => Promise<{ grant: { schema_version: 1; evidence_grant_id: string; project_id: string; work_id: string; source_snapshot_id: string; evidence: typeof evidence[]; created_at: string }; slices: Array<{ evidence: typeof evidence; content: string }> }>;
    }, "sourceSlices").mockResolvedValue({
      grant: { schema_version: 1, evidence_grant_id: "EVG-WORK-test-owned", project_id: "PRJ-test", work_id: "WORK-test", source_snapshot_id: "SNAP-test", evidence: [evidence], created_at: "2026-08-28T00:00:00.000Z" },
      slices: [{ evidence, content: "<button onClick={submit}>Submit</button>" }],
    });
    vi.spyOn(executor as unknown as { sourceBehaviors: () => Promise<[]> }, "sourceBehaviors").mockResolvedValue([]);
    const runArtifact = vi.spyOn(executor as unknown as {
      runArtifact: (role: "author" | "reviewer", currentWork: WorkDescriptor, artifactId: string, payload: unknown) => Promise<unknown>;
    }, "runArtifact")
      .mockResolvedValueOnce(invalidPatch)
      .mockImplementationOnce(async (_role, _work, _artifactId, payload) => ({
        schema_version: 1,
        base_patch_hash: ((payload as { correction_plan: { base_patch_hash: string } }).correction_plan.base_patch_hash),
        element_update_upserts: [],
        predicate_upserts: correctedPatch.predicates,
      }));

    const catalog = await executor.extractFactCatalog({ snapshot, work });

    expect(runArtifact).toHaveBeenCalledTimes(2);
    expect(runArtifact.mock.calls[1]?.[3]).toMatchObject({ reviewer_issue_codes: ["FACT_PATCH_SCHEMA_INVALID"] });
    expect((runArtifact.mock.calls[1]?.[3] as { task: string }).task).toContain("edge_changes as JSON arrays");
    expect(runArtifact.mock.calls[1]?.[3]).not.toHaveProperty("rejected_catalog_patch");
    expect(catalog.predicates.map((predicate) => predicate.pred_id)).toEqual(["PRED-form-ready"]);
  });

  it("retains local-view FACT issues without a scope-relaxation re-review", async () => {
    const facts = { schema_version: 2 as const, project_id: "PRJ-test", analysis_run_id: "RUN-test", source_snapshot_id: "SNAP-test", screens: [], edges: [], predicates: [] } satisfies FactBundle;
    const snapshot = { schema_version: 1 as const, project_id: "PRJ-test", analysis_run_id: "RUN-test", source_snapshot_id: "SNAP-test", created_at: "2026-08-28T00:00:00.000Z", root_hash: "sha256:root", ui_stacks: ["react"], unsupported_ui_stacks: [], files: [], routes: [], apis: [], interactions: [], i18n: {} } satisfies SourceSnapshot;
    const work = { schemaVersion: 1 as const, projectId: "PRJ-test", analysisRunId: "RUN-test", sourceSnapshotId: "SNAP-test", sessionId: "SESSION-test", workId: "WORK-test", kind: "analysis.fact-extract" as const, stage: "fact" as const, attemptId: "ATTEMPT-test", expectedRevision: 1, inputIds: [], stagingPath: ".scenarioforge/staging/WORK-test", status: "running" as const, createdAt: "2026-08-28T00:00:00.000Z", updatedAt: "2026-08-28T00:00:00.000Z", progress: 0, completionRequested: false } satisfies WorkDescriptor;
    const executor = new PiGenerationExecutor({ projectRoot: "/tmp/project", models: [], secretFor: () => undefined });
    Object.assign(executor, { lastFacts: facts, lastSnapshot: snapshot });
    const runArtifact = vi.spyOn(executor as unknown as {
      runArtifact: (role: "author" | "reviewer", currentWork: WorkDescriptor, artifactId: string, payload: unknown) => Promise<unknown>;
    }, "runArtifact")
      .mockResolvedValueOnce({ pass: false, issueCodes: [
        "MISSING_SELF_LOOP_EDGE:modal-close-action-is-evidence-backed",
        "MISSING_SELF_LOOP_EDGE:pagination-next-action-updates-same-screen-results",
        "UNSUPPORTED_EDGE:refresh is a local-only view control",
      ] });

    await expect(executor.review({ stage: "fact", artifact: facts, work })).resolves.toEqual({
      pass: false,
      issueCodes: [
        "MISSING_SELF_LOOP_EDGE:modal-close-action-is-evidence-backed",
        "MISSING_SELF_LOOP_EDGE:pagination-next-action-updates-same-screen-results",
        "UNSUPPORTED_EDGE:refresh is a local-only view control",
      ],
    });
    expect(runArtifact).toHaveBeenCalledTimes(1);
  });

  it("retains local-view-control and journey issues in the same FACT verdict", async () => {
    const facts = { schema_version: 2 as const, project_id: "PRJ-test", analysis_run_id: "RUN-test", source_snapshot_id: "SNAP-test", screens: [], edges: [], predicates: [] } satisfies FactBundle;
    const snapshot = { schema_version: 1 as const, project_id: "PRJ-test", analysis_run_id: "RUN-test", source_snapshot_id: "SNAP-test", created_at: "2026-08-28T00:00:00.000Z", root_hash: "sha256:root", ui_stacks: ["react"], unsupported_ui_stacks: [], files: [], routes: [], apis: [], interactions: [], i18n: {} } satisfies SourceSnapshot;
    const work = { schemaVersion: 1 as const, projectId: "PRJ-test", analysisRunId: "RUN-test", sourceSnapshotId: "SNAP-test", sessionId: "SESSION-test", workId: "WORK-test", kind: "analysis.fact-extract" as const, stage: "fact" as const, attemptId: "ATTEMPT-test", expectedRevision: 1, inputIds: [], stagingPath: ".scenarioforge/staging/WORK-test", status: "running" as const, createdAt: "2026-08-28T00:00:00.000Z", updatedAt: "2026-08-28T00:00:00.000Z", progress: 0, completionRequested: false } satisfies WorkDescriptor;
    const executor = new PiGenerationExecutor({ projectRoot: "/tmp/project", models: [], secretFor: () => undefined });
    Object.assign(executor, { lastFacts: facts, lastSnapshot: snapshot });
    const runArtifact = vi.spyOn(executor as unknown as {
      runArtifact: (role: "author" | "reviewer", currentWork: WorkDescriptor, artifactId: string, payload: unknown) => Promise<unknown>;
    }, "runArtifact").mockResolvedValueOnce({ pass: false, issueCodes: [
      "MISSING_SELF_LOOP_EDGE:modal-close-action-is-evidence-backed",
      "UNSUPPORTED_EDGE:E-0001:category-tree tab is a local panel toggle; local-only view controls are outside journey coverage",
      "UNSUPPORTED_EDGE:E-0021:refresh is a local-only view control and should not have a normal journey self-loop edge",
      "MISSING_SCENARIO_RESULT_CONFIRMATION_BRANCH",
      "MISSING_PROJECT_REFRESH_RECOVERY:refresh-action repopulates project controls consumed by selection",
    ] });

    await expect(executor.review({ stage: "fact", artifact: facts, work })).resolves.toEqual({
      pass: false,
      issueCodes: [
        "MISSING_SELF_LOOP_EDGE:modal-close-action-is-evidence-backed",
        "UNSUPPORTED_EDGE:E-0001:category-tree tab is a local panel toggle; local-only view controls are outside journey coverage",
        "UNSUPPORTED_EDGE:E-0021:refresh is a local-only view control and should not have a normal journey self-loop edge",
        "MISSING_SCENARIO_RESULT_CONFIRMATION_BRANCH",
        "MISSING_PROJECT_REFRESH_RECOVERY:refresh-action repopulates project controls consumed by selection",
      ],
    });
    expect(runArtifact).toHaveBeenCalledTimes(1);
  });

  it("bounds an oversized FACT verdict so one extra issue cannot abort the repair loop", async () => {
    const facts = { schema_version: 2 as const, project_id: "PRJ-test", analysis_run_id: "RUN-test", source_snapshot_id: "SNAP-test", screens: [], edges: [], predicates: [] } satisfies FactBundle;
    const snapshot = { schema_version: 1 as const, project_id: "PRJ-test", analysis_run_id: "RUN-test", source_snapshot_id: "SNAP-test", created_at: "2026-08-28T00:00:00.000Z", root_hash: "sha256:root", ui_stacks: ["react"], unsupported_ui_stacks: [], files: [], routes: [], apis: [], interactions: [], i18n: {} } satisfies SourceSnapshot;
    const work = { schemaVersion: 1 as const, projectId: "PRJ-test", analysisRunId: "RUN-test", sourceSnapshotId: "SNAP-test", sessionId: "SESSION-test", workId: "WORK-test", kind: "analysis.fact-extract" as const, stage: "fact" as const, attemptId: "ATTEMPT-test", expectedRevision: 1, inputIds: [], stagingPath: ".scenarioforge/staging/WORK-test", status: "running" as const, createdAt: "2026-08-28T00:00:00.000Z", updatedAt: "2026-08-28T00:00:00.000Z", progress: 0, completionRequested: false } satisfies WorkDescriptor;
    const executor = new PiGenerationExecutor({ projectRoot: "/tmp/project", models: [], secretFor: () => undefined });
    Object.assign(executor, { lastFacts: facts, lastSnapshot: snapshot });
    vi.spyOn(executor as unknown as {
      runArtifact: (role: "author" | "reviewer", currentWork: WorkDescriptor, artifactId: string, payload: unknown) => Promise<unknown>;
    }, "runArtifact").mockResolvedValueOnce({ pass: false, issueCodes: Array.from({ length: 21 }, (_, index) => `ISSUE-${index + 1}`) });

    const verdict = await executor.review({ stage: "fact", artifact: facts, work });

    expect(verdict).toEqual({ pass: false, issueCodes: Array.from({ length: 20 }, (_, index) => `ISSUE-${index + 1}`) });
  });

  it("limits WIKI author output to goals for backend-owned workflow refs", () => {
    const facts = {
      schema_version: 2,
      project_id: "PRJ-test",
      analysis_run_id: "RUN-test",
      source_snapshot_id: "SNAP-test",
      screens: [],
      edges: [],
      predicates: [],
    } satisfies FactBundle;
    const skeleton = {
      schema_version: 2,
      project_id: "PRJ-test",
      analysis_run_id: "RUN-test",
      source_snapshot_id: "SNAP-test",
      workflows: [],
    } satisfies WikiBundle;
    const payload = createWikiCompositionPayload(facts, skeleton);

    expect(payload.task).toContain("goal");
    expect(payload.task).toContain("Do not rewrite");
    expect(payload.verified_fact_graph).toEqual({ screens: [], edges: [] });
    expect(payload.backend_owned_workflow_skeleton).toEqual({ workflows: [] });
    expect(payload.output_contract).toEqual({
      schema_version: 1,
      workflow_updates: [{ workflow_ref: "exact WF-* from backend_owned_workflow_skeleton", goal: "evidence-grounded human-readable business goal" }],
    });
  });

  it("scopes a WIKI repair to a targeted correction and untrusted issue codes", () => {
    const facts = {
      schema_version: 2,
      project_id: "PRJ-test",
      analysis_run_id: "RUN-test",
      source_snapshot_id: "SNAP-test",
      screens: [],
      edges: [],
      predicates: [],
    } satisfies FactBundle;
    const rejectedWiki = {
      schema_version: 2,
      project_id: "PRJ-test",
      analysis_run_id: "RUN-test",
      source_snapshot_id: "SNAP-test",
      workflows: [],
    } satisfies WikiBundle;

    const scope = { base_artifact_hash: "sha256:base", workflow_refs: [] };
    const payload = createWikiRepairPayload(facts, rejectedWiki, rejectedWiki, scope, ["WIKI_GOAL_AMBIGUOUS"]);

    expect(payload.task).toContain("limited correction patch");
    expect(payload.task).toContain("untrusted defect reports");
    expect(payload.backend_owned_workflow_skeleton).toEqual({ workflows: [] });
    expect(payload.rejected_workflow_goals).toEqual({ workflows: [] });
    expect(payload).not.toHaveProperty("rejected_wiki");
    expect(payload.reviewer_issue_codes).toEqual(["WIKI_GOAL_AMBIGUOUS"]);
  });

  it("requires FACT review to reject missing conditional transition guards", () => {
    const facts = {
      schema_version: 2,
      project_id: "PRJ-test",
      analysis_run_id: "RUN-test",
      source_snapshot_id: "SNAP-test",
      screens: [],
      edges: [],
      predicates: [],
    } satisfies FactBundle;

    const payload = createSemanticReviewPayload("fact", facts, facts, undefined, []);

    expect(payload.task).toContain("conditional source prerequisite");
    expect(payload.task).toContain("all supported omissions in one verdict");
    expect(payload.task).toContain("eligibility or payload");
    expect(payload.task).toContain("Element existence is not action evidence");
    expect(payload.task).toContain("exception edge");
    expect(payload.task).toContain("state-driven transitions");
    expect(payload.task).toContain("reject separate request-start edges");
    expect(payload.task).toContain("single user-trigger edge");
    expect(payload.task).toContain("immediate handler only starts the request");
    expect(payload.task).toContain("downstream polling or result-state evidence");
    expect(payload.task).toContain("input-rejection branch must use its evidenced invalid-input guard");
    expect(payload.task).toContain("post-request failure branch");
  });

  it("fails FACT review on backend-derived source behavior issues before asking the model reviewer", async () => {
    const identity = { project_id: "PRJ-test", analysis_run_id: "RUN-test", source_snapshot_id: "SNAP-test" };
    const element = { id: "EL-product", type: "button", label: "Product", interaction: { action_kind: "navigate", surface_kind: "web" as const, target_candidates: [] }, evidence: [] };
    const facts = {
      schema_version: 2 as const,
      ...identity,
      screens: [
        { schema_version: 3 as const, ...identity, screen_id: "SCR-main", route: "component:MainPage", title: "Main", entry_guards: [], elements: [element], apis: [], feedback: [], displays: [], status: "draft" as const },
        { schema_version: 3 as const, ...identity, screen_id: "SCR-scenario", route: "component:ScenarioPage", title: "Scenario", entry_guards: [], elements: [], apis: [], feedback: [], displays: [], status: "draft" as const },
      ],
      edges: [{ schema_version: 2 as const, ...identity, edge_id: "E-1", kind: "normal" as const, from: "SCR-main", on: "EL-product", to: "SCR-scenario", feedback: [], evidence: [], status: "draft" as const }],
      predicates: [],
    } satisfies FactBundle;
    const work = { schemaVersion: 1 as const, projectId: "PRJ-test", analysisRunId: "RUN-test", sourceSnapshotId: "SNAP-test", sessionId: "SESSION-test", workId: "WORK-test", kind: "analysis.fact-extract" as const, stage: "fact" as const, attemptId: "ATTEMPT-test", expectedRevision: 1, inputIds: [], stagingPath: ".scenarioforge/staging/WORK-test", status: "running" as const, createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z", progress: 0, completionRequested: false } satisfies WorkDescriptor;
    const executor = new PiGenerationExecutor({ projectRoot: "/tmp/project", models: [], secretFor: () => undefined });
    Object.assign(executor, { lastFactDraft: facts, lastFactBehaviors: [{ element_id: "EL-product", source_id: "SRC-main", path: "Main.jsx", line: 10, handler_lines: [10], called_symbols: ["setPage"], local_state_keys: [], downstream_consumed_state_keys: [], literal_navigation_targets: ["upload"], explicit_failure: false, local_view_only: false, journey_required: true }] });
    const runArtifact = vi.spyOn(executor as unknown as { runArtifact: () => Promise<unknown> }, "runArtifact");

    const verdict = await executor.review({ stage: "fact", artifact: facts, work });

    expect(verdict).toMatchObject({ pass: false, issueCodes: [expect.stringContaining("FACT_LITERAL_NAVIGATION_TARGET_MISMATCH")] });
    expect(verdict.issueCodes[0]).toContain("U1");
    expect(verdict.issueCodes[0]).not.toContain("EL-product");
    expect(runArtifact).not.toHaveBeenCalled();
  });

  it("carries bounded prior FACT reviewer decisions into the next independent review", () => {
    const facts = {
      schema_version: 2,
      project_id: "PRJ-test",
      analysis_run_id: "RUN-test",
      source_snapshot_id: "SNAP-test",
      screens: [],
      edges: [],
      predicates: [],
    } satisfies FactBundle;

    const artifactHash = factArtifactFingerprint(facts);
    const payload = createSemanticReviewPayload("fact", facts, facts, undefined, [], [{ review: 1, artifactHash, issueCodes: ["UNSUPPORTED_EXCEPTION:flow-text-has-no-error-output"] }]);

    expect(payload.task).toContain("prior reviewer decision history");
    expect(payload).toMatchObject({ current_artifact_hash: artifactHash });
    expect(payload.prior_reviewer_decisions).toEqual([{ review: 1, artifactHash, issueCodes: ["UNSUPPORTED_EXCEPTION:flow-text-has-no-error-output"] }]);
  });

  it("does not treat a repaired FACT version as the same reviewer decision scope", () => {
    const before = { schema_version: 2 as const, project_id: "PRJ-test", analysis_run_id: "RUN-test", source_snapshot_id: "SNAP-test", screens: [], edges: [], predicates: [] } satisfies FactBundle;
    const after = { ...before, predicates: [{ schema_version: 2 as const, project_id: "PRJ-test", analysis_run_id: "RUN-test", source_snapshot_id: "SNAP-test", pred_id: "PRED-complete", values: ["true", "false"], source: "code" as const, evidence: [] }] } satisfies FactBundle;
    const history = [{ review: 1, artifactHash: factArtifactFingerprint(before), issueCodes: ["MISSING_COMPLETION_STATE"] }];

    const payload = createSemanticReviewPayload("fact", after, after, undefined, [], history);

    expect(payload).toMatchObject({ current_artifact_hash: factArtifactFingerprint(after) });
    expect(payload.prior_reviewer_decisions).toEqual([]);
    expect((payload as typeof payload & { previous_repair_obligations: string[] }).previous_repair_obligations).toEqual(["MISSING_COMPLETION_STATE"]);
  });

  it("bounds total FACT reviewer decision history to 16 KB across versions", () => {
    let history = [] as ReturnType<typeof appendBoundedFactReviewDecision>;
    for (let review = 0; review < 8; review += 1) {
      const facts = { schema_version: 2 as const, project_id: "PRJ-test", analysis_run_id: "RUN-test", source_snapshot_id: "SNAP-test", screens: [], edges: [], predicates: [], revision_marker: review } as unknown as FactBundle;
      history = appendBoundedFactReviewDecision(history, facts, Array.from({ length: 20 }, (_, index) => `ISSUE-${review}-${index}-${"x".repeat(990)}`));
    }

    expect(Buffer.byteLength(JSON.stringify(history), "utf8")).toBeLessThanOrEqual(16_000);
    expect(history.at(-1)?.review).toBe(8);
  });

  it("uses bounded line windows for required records in a large source file", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "scenarioforge-large-evidence-"));
    const lines = Array.from({ length: 1_200 }, (_, index) =>
      index === 599
        ? '<button data-testid="analyze">분석 시작</button>'
        : `export const filler${index} = "${"x".repeat(60)}";`,
    );
    const content = lines.join("\n");
    const sourceId = "SRC-large-page";
    await writeFile(join(projectRoot, "large-page.tsx"), content, "utf8");

    const snapshot: SourceSnapshot = {
      schema_version: 1,
      project_id: "PRJ-test",
      analysis_run_id: "RUN-test",
      source_snapshot_id: "SNAP-test",
      created_at: "2026-08-27T00:00:00.000Z",
      root_hash: "sha256:root",
      ui_stacks: ["react"],
      unsupported_ui_stacks: [],
      files: [{
        source_id: sourceId,
        path: "large-page.tsx",
        language: "tsx",
        content_hash: `sha256:${createHash("sha256").update(content).digest("hex")}`,
        size_bytes: Buffer.byteLength(content),
        imports: [],
      }],
      routes: [],
      apis: [],
      interactions: [{
        element_id: "EL-analyze",
        kind: "button",
        label: "분석 시작",
        source_id: sourceId,
        line: 600,
        target_candidates: [{ by: "test-id", value: "analyze" }],
      }],
      i18n: {},
    };
    const executor = new PiGenerationExecutor({
      projectRoot,
      models: [],
      secretFor: () => undefined,
    });

    const result = await (
      executor as unknown as {
        sourceSlices: (snapshot: SourceSnapshot, workId: string, generationStep: "fact-catalog") => Promise<{ slices: EvidenceSlice[] }>;
      }
    ).sourceSlices(snapshot, "work-large-source", "fact-catalog");

    expect(result.slices).toHaveLength(1);
    expect(result.slices[0].content).toContain("분석 시작");
    expect(result.slices[0].content).not.toContain("filler0");
    expect(result.slices[0].evidence.start_line).toBeGreaterThan(1);
    expect(result.slices[0].evidence.end_line).toBeLessThan(lines.length);
    expect(Buffer.byteLength(result.slices[0].content)).toBeLessThanOrEqual(120_000);
  });

  it("keeps complete backend evidence grants while omitting non-journey interaction source from the model payload", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "scenarioforge-relevant-evidence-"));
    const includedContent = 'export function Included(){ return <button onClick={() => taskApi.run()}>Run</button>; }\n';
    const excludedContent = 'export function Excluded(){ return <button onClick={() => setFilter("x")}>Filter</button>; }\n';
    await writeFile(join(projectRoot, "Included.tsx"), includedContent, "utf8");
    await writeFile(join(projectRoot, "Excluded.tsx"), excludedContent, "utf8");
    const sourceFile = (source_id: string, path: string, content: string) => ({
      source_id,
      path,
      language: "tsx",
      content_hash: `sha256:${createHash("sha256").update(content).digest("hex")}`,
      size_bytes: Buffer.byteLength(content),
      imports: [],
    });
    const snapshot = {
      schema_version: 1 as const,
      project_id: "PRJ-test",
      analysis_run_id: "RUN-test",
      source_snapshot_id: "SNAP-test",
      created_at: "2026-09-02T00:00:00.000Z",
      root_hash: "sha256:root",
      ui_stacks: ["react"],
      unsupported_ui_stacks: [],
      files: [sourceFile("SRC-included", "Included.tsx", includedContent), sourceFile("SRC-excluded", "Excluded.tsx", excludedContent)],
      routes: [],
      apis: [],
      interactions: [
        { element_id: "EL-included", kind: "button", label: "Run", source_id: "SRC-included", line: 1, target_candidates: [{ by: "role-name", role: "button", name: "Run" }] },
        { element_id: "EL-excluded", kind: "button", label: "Filter", source_id: "SRC-excluded", line: 1, target_candidates: [{ by: "role-name", role: "button", name: "Filter" }] },
      ],
      i18n: {},
    } satisfies SourceSnapshot;
    const executor = new PiGenerationExecutor({ projectRoot, models: [], secretFor: () => undefined });

    const behaviors = await (executor as unknown as { sourceBehaviors: (source: SourceSnapshot) => Promise<SourceInteractionBehavior[]> }).sourceBehaviors(snapshot);
    const result = await (executor as unknown as {
      sourceSlices: (source: SourceSnapshot, workId: string, generationStep: "fact-catalog", includedBehaviors: SourceInteractionBehavior[]) => Promise<{ grant: { evidence: EvidenceSlice["evidence"][] }; slices: EvidenceSlice[] }>;
    }).sourceSlices(snapshot, "work-relevant-evidence", "fact-catalog", behaviors.filter((behavior) => behavior.journey_required && !behavior.local_view_only));

    expect(result.grant.evidence).toHaveLength(2);
    expect(result.slices).toHaveLength(1);
    expect(result.slices[0].content).toContain("taskApi.run");
    expect(result.slices[0].content).not.toContain("setFilter");
  });

  it("does not re-include a local-view handler when its evidence range overlaps a journey interaction in the same component", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "scenarioforge-overlapping-evidence-"));
    const content = [
      "export function Page({ api }) {",
      "  const handleFilter = () => setFilter('hidden-local-view');",
      ...Array.from({ length: 45 }, (_, index) => `  const filler${index} = ${index};`),
      "  const handleRun = () => api.run();",
      "  return <>",
      "    <button onClick={handleRun}>Run</button>",
      "    <button onClick={handleFilter}>Filter</button>",
      "  </>;",
      "}",
    ].join("\n");
    await writeFile(join(projectRoot, "Page.tsx"), content, "utf8");
    const snapshot = await new (await import("@scenarioforge/scenario-pipeline")).SourceScanner().scan({
      projectRoot,
      projectId: "PRJ-test",
      analysisRunId: "RUN-test",
      sourceSnapshotId: "SNAP-test",
      now: "2026-09-02T00:00:00.000Z",
    });
    const included = snapshot.interactions.find((interaction) => interaction.label === "Run");
    expect(included).toBeDefined();
    const executor = new PiGenerationExecutor({ projectRoot, models: [], secretFor: () => undefined });

    const behaviors = await (executor as unknown as { sourceBehaviors: (source: SourceSnapshot) => Promise<SourceInteractionBehavior[]> }).sourceBehaviors(snapshot);
    const result = await (executor as unknown as {
      sourceSlices: (source: SourceSnapshot, workId: string, generationStep: "fact-catalog", includedBehaviors: SourceInteractionBehavior[]) => Promise<{ grant: { evidence: EvidenceSlice["evidence"][] }; slices: EvidenceSlice[] }>;
    }).sourceSlices(snapshot, "work-overlapping-evidence", "fact-catalog", behaviors.filter((behavior) => behavior.element_id === included!.element_id));

    const filterLine = content.split("\n").findIndex((line) => line.includes("Filter</button>")) + 1;
    expect(result.grant.evidence.some((entry) => entry.start_line <= filterLine && entry.end_line >= filterLine)).toBe(true);
    expect(result.slices.some((slice) => slice.content.includes("api.run"))).toBe(true);
    expect(result.slices.every((slice) => !slice.content.includes("hidden-local-view"))).toBe(true);
  });

  it("keeps the enclosing API function effect inside the evidence slice", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "scenarioforge-api-effect-evidence-"));
    const lines = [
      ...Array.from({ length: 10 }, (_, index) => `export const prefix${index} = ${index};`),
      "const handleLogin = async () => {",
      "  const response = await fetch('/api/auth/login', { method: 'POST' });",
      "  const { accessToken, refreshToken } = await response.json();",
      ...Array.from({ length: 22 }, (_, index) => `  const intermediate${index} = ${index};`),
      "  dispatch(loginDone({ token: accessToken, refreshToken }));",
      "};",
      ...Array.from({ length: 30 }, (_, index) => `export const suffix${index} = ${index};`),
    ];
    const content = lines.join("\n");
    const sourceId = "SRC-login-page";
    const apiLine = lines.findIndex((line) => line.includes("fetch('/api/auth/login'")) + 1;
    const effectLine = lines.findIndex((line) => line.includes("dispatch(loginDone")) + 1;
    await writeFile(join(projectRoot, "login-page.tsx"), content, "utf8");

    const snapshot: SourceSnapshot = {
      schema_version: 1,
      project_id: "PRJ-test",
      analysis_run_id: "RUN-test",
      source_snapshot_id: "SNAP-test",
      created_at: "2026-08-27T00:00:00.000Z",
      root_hash: "sha256:root",
      ui_stacks: ["react"],
      unsupported_ui_stacks: [],
      files: [{
        source_id: sourceId,
        path: "login-page.tsx",
        language: "tsx",
        content_hash: `sha256:${createHash("sha256").update(content).digest("hex")}`,
        size_bytes: Buffer.byteLength(content),
        imports: [],
      }],
      routes: [],
      apis: [{
        api_id: "API-POST-api-auth-login",
        method: "POST",
        path: "/api/auth/login",
        source_id: sourceId,
        line: apiLine,
      }],
      interactions: [],
      i18n: {},
    };
    const executor = new PiGenerationExecutor({ projectRoot, models: [], secretFor: () => undefined });

    const result = await (
      executor as unknown as {
        sourceSlices: (source: SourceSnapshot, workId: string, generationStep: "fact-catalog") => Promise<{ slices: EvidenceSlice[] }>;
      }
    ).sourceSlices(snapshot, "work-api-effect", "fact-catalog");

    expect(result.slices).toHaveLength(1);
    expect(result.slices[0].content).toContain("dispatch(loginDone({ token: accessToken, refreshToken }))");
    expect(result.slices[0].evidence.end_line).toBeGreaterThanOrEqual(effectLine);
  });

  it("keeps an interaction's enclosing Page handler inside the evidence slice", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "scenarioforge-interaction-handler-evidence-"));
    const prefix = Array.from({ length: 28 }, (_, index) => `  const prefix${index} = ${index};`);
    const body = Array.from({ length: 58 }, (_, index) => `  const intermediate${index} = ${index};`);
    const content = [
      "export function UploadPage({ setPage, uploadApi }) {",
      ...prefix,
      "  const handleUpload = async () => {",
      "    await uploadApi.parseDocument('TASK-1', selectedFile);",
      ...body,
      "    setPage('db');",
      "  };",
      "  return <button onClick={handleUpload}>업로드 및 파싱 시작</button>;",
      "}",
    ].join("\n");
    await writeFile(join(projectRoot, "UploadPage.jsx"), content, "utf8");
    const snapshot = await new (await import("@scenarioforge/scenario-pipeline")).SourceScanner().scan({
      projectRoot,
      projectId: "PRJ-test",
      analysisRunId: "RUN-test",
      sourceSnapshotId: "SNAP-test",
      now: "2026-08-27T00:00:00.000Z",
    });
    const executor = new PiGenerationExecutor({ projectRoot, models: [], secretFor: () => undefined });

    const result = await (executor as unknown as {
      sourceSlices: (source: SourceSnapshot, workId: string, generationStep: "fact-catalog") => Promise<{ slices: EvidenceSlice[] }>;
    }).sourceSlices(snapshot, "work-interaction-handler", "fact-catalog");

    expect(result.slices.some((slice) => slice.content.includes("uploadApi.parseDocument"))).toBe(true);
    expect(result.slices.some((slice) => slice.content.includes("setPage('db')"))).toBe(true);
  });

  it("includes state-driven screen composition and its direct state dependency", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "scenarioforge-composition-evidence-"));
    await writeFile(join(projectRoot, "store.js"), [
      "export const loginDone = () => ({ type: 'loginDone' });",
      "export const authSet = () => ({ type: 'authSet' });",
      "export const reducer = { loginDone: (state) => { state.loginReady = true; }, authSet: (state) => { state.sessionReady = true; } };",
    ].join("\n"), "utf8");
    await writeFile(join(projectRoot, "LoginFormPage.jsx"), "export function LoginFormPage(){ return <button>로그인</button>; }\n", "utf8");
    await writeFile(join(projectRoot, "LoginPage.jsx"), "export function LoginPage(){ return <button>프로젝트 선택</button>; }\n", "utf8");
    await writeFile(join(projectRoot, "MainPage.jsx"), "export function MainPage(){ return <button>새 작업</button>; }\n", "utf8");
    await writeFile(join(projectRoot, "App.jsx"), [
      "import { LoginFormPage } from './LoginFormPage.jsx';",
      "import { LoginPage } from './LoginPage.jsx';",
      "import { MainPage } from './MainPage.jsx';",
      "import { reducer } from './store.js';",
      "export function AppContent({ loginReady, sessionReady }) {",
      "  if (!loginReady) return <LoginFormPage />;",
      "  if (!sessionReady) return <LoginPage />;",
      "  return <MainPage reducer={reducer} />;",
      "}",
    ].join("\n"), "utf8");
    const snapshot = await new (await import("@scenarioforge/scenario-pipeline")).SourceScanner().scan({
      projectRoot,
      projectId: "PRJ-test",
      analysisRunId: "RUN-test",
      sourceSnapshotId: "SNAP-test",
      now: "2026-08-27T00:00:00.000Z",
    });
    const executor = new PiGenerationExecutor({ projectRoot, models: [], secretFor: () => undefined });

    const result = await (executor as unknown as {
      sourceSlices: (source: SourceSnapshot, workId: string, generationStep: "fact-catalog") => Promise<{ slices: EvidenceSlice[] }>;
    }).sourceSlices(snapshot, "work-composition", "fact-catalog");

    expect(result.slices.some((slice) => slice.content.includes("if (!loginReady) return <LoginFormPage />"))).toBe(true);
    expect(result.slices.some((slice) => slice.content.includes("state.sessionReady = true"))).toBe(true);
  });
});

describe("Pi generation artifact handoff", () => {
  it("uses the backend-expected staging path when submitted path metadata drifts but scope and hash match", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "scenarioforge-submitted-path-drift-"));
    const workId = "work-fact";
    const artifactId = "FACT-RUN-test";
    const stagingPath = `.scenarioforge/staging/${workId}/${artifactId}.json`;
    const content = `${JSON.stringify({ schema_version: 2, screen_updates: [], element_updates: [], api_updates: [], predicates: [], edges: [] })}\n`;
    await mkdir(join(projectRoot, ".scenarioforge", "staging", workId), { recursive: true });
    await writeFile(join(projectRoot, stagingPath), content, "utf8");
    const state = createInitialProjectRuntimeState("PRJ-test");
    state.artifacts[artifactId] = {
      artifactId,
      artifactType: "fact",
      stagingPath: `.scenarioforge/staging/${workId}/FACT-RUN-tast.json`,
      relatedIds: [],
      contentHash: createHash("sha256").update(content).digest("hex"),
      projectId: "PRJ-test",
      analysisRunId: "RUN-test",
      sourceSnapshotId: "SNAP-test",
      workId,
      status: "staged",
      createdAt: "2026-08-28T00:00:00.000Z",
    };

    await expect(promptForSubmittedArtifact({
      projectRoot,
      workId,
      artifactId,
      prompt: async () => undefined,
      getState: () => state,
    })).resolves.toMatchObject({ schema_version: 2, edges: [] });
  });

  it("uses an artifact that was submitted before a terminal provider error", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "scenarioforge-submitted-artifact-"));
    const workId = "work-review";
    const artifactId = "VERDICT-fact-work-review";
    const stagingPath = `.scenarioforge/staging/${workId}/${artifactId}.json`;
    const content = `${JSON.stringify({ pass: true, issueCodes: [] }, null, 2)}\n`;
    await mkdir(join(projectRoot, ".scenarioforge", "staging", workId), { recursive: true });
    await writeFile(join(projectRoot, stagingPath), content, "utf8");

    const state = createInitialProjectRuntimeState("PRJ-test");
    state.artifacts[artifactId] = {
      artifactId,
      artifactType: "fact",
      stagingPath,
      relatedIds: [],
      contentHash: createHash("sha256").update(content).digest("hex"),
      projectId: "PRJ-test",
      analysisRunId: "RUN-test",
      sourceSnapshotId: "SNAP-test",
      workId,
      status: "staged",
      createdAt: "2026-08-27T00:00:00.000Z",
    };

    await expect(promptForSubmittedArtifact({
      projectRoot,
      workId,
      artifactId,
      prompt: async () => { throw new Error("429: rate_limit_tpm"); },
      getState: () => state,
    })).resolves.toEqual({ pass: true, issueCodes: [] });
  });

  it("does not trust an unsubmitted staging file after a provider error", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "scenarioforge-unsubmitted-artifact-"));
    const workId = "work-review";
    const artifactId = "VERDICT-fact-work-review";
    const stagingPath = `.scenarioforge/staging/${workId}/${artifactId}.json`;
    await mkdir(join(projectRoot, ".scenarioforge", "staging", workId), { recursive: true });
    await writeFile(join(projectRoot, stagingPath), "{\"pass\":true}\n", "utf8");

    await expect(promptForSubmittedArtifact({
      projectRoot,
      workId,
      artifactId,
      prompt: async () => { throw new Error("429: rate_limit_tpm"); },
      getState: () => createInitialProjectRuntimeState("PRJ-test"),
    })).rejects.toThrow("429: rate_limit_tpm");
  });

  it("requires a fresh artifact submission when a repair reuses an artifact ID", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "scenarioforge-stale-repair-artifact-"));
    const workId = "work-fact";
    const artifactId = "FACT-RUN-test";
    const stagingPath = `.scenarioforge/staging/${workId}/${artifactId}.json`;
    const content = `${JSON.stringify({ schema_version: 2, screen_updates: [], element_updates: [], api_updates: [], predicates: [], edges: [] })}\n`;
    await mkdir(join(projectRoot, ".scenarioforge", "staging", workId), { recursive: true });
    await writeFile(join(projectRoot, stagingPath), content, "utf8");
    const state = createInitialProjectRuntimeState("PRJ-test");
    state.artifacts[artifactId] = {
      artifactId,
      artifactType: "fact",
      stagingPath,
      relatedIds: [],
      contentHash: createHash("sha256").update(content).digest("hex"),
      projectId: "PRJ-test",
      analysisRunId: "RUN-test",
      sourceSnapshotId: "SNAP-test",
      workId,
      status: "staged",
      createdAt: "2026-08-27T00:00:00.000Z",
    };

    await expect(promptForSubmittedArtifact({
      projectRoot,
      workId,
      artifactId,
      previousSubmission: { contentHash: state.artifacts[artifactId].contentHash, createdAt: state.artifacts[artifactId].createdAt },
      prompt: async () => undefined,
      getState: () => state,
    })).rejects.toThrow("MODEL_ARTIFACT_NOT_RESUBMITTED");
  });
});

describe("Pi generation retry ownership", () => {
  it("gives an omitted artifact submission exactly one correction attempt", async () => {
    const executor = new PiGenerationExecutor({ projectRoot: "/project", models: [], secretFor: () => undefined });
    let attempts = 0;
    (executor as unknown as { runArtifactAttempt: () => Promise<{ pass: boolean }> }).runArtifactAttempt = async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("MODEL_ARTIFACT_NOT_SUBMITTED");
      return { pass: true };
    };

    await expect((executor as unknown as {
      runArtifact: (role: "reviewer", work: WorkDescriptor, artifactId: string, payload: unknown) => Promise<{ pass: boolean }>;
    }).runArtifact("reviewer", { stage: "fact" } as WorkDescriptor, "VERDICT-fact-work", {})).resolves.toEqual({ pass: true });
    expect(attempts).toBe(2);
  });

  it("gives a missing fresh artifact submission exactly one correction attempt", async () => {
    const executor = new PiGenerationExecutor({ projectRoot: "/project", models: [], secretFor: () => undefined });
    let attempts = 0;
    (executor as unknown as { runArtifactAttempt: () => Promise<{ pass: boolean }> }).runArtifactAttempt = async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("MODEL_ARTIFACT_NOT_RESUBMITTED");
      return { pass: true };
    };

    await expect((executor as unknown as {
      runArtifact: (role: "author", work: WorkDescriptor, artifactId: string, payload: unknown) => Promise<{ pass: boolean }>;
    }).runArtifact("author", { stage: "fact" } as WorkDescriptor, "FACT-RUN-test", {})).resolves.toEqual({ pass: true });
    expect(attempts).toBe(2);
  });

  it("fails when the one fresh artifact submission correction is also omitted", async () => {
    const executor = new PiGenerationExecutor({ projectRoot: "/project", models: [], secretFor: () => undefined });
    let attempts = 0;
    (executor as unknown as { runArtifactAttempt: () => Promise<{ pass: boolean }> }).runArtifactAttempt = async () => {
      attempts += 1;
      throw new Error("MODEL_ARTIFACT_NOT_RESUBMITTED");
    };

    await expect((executor as unknown as {
      runArtifact: (role: "author", work: WorkDescriptor, artifactId: string, payload: unknown) => Promise<{ pass: boolean }>;
    }).runArtifact("author", { stage: "fact" } as WorkDescriptor, "FACT-RUN-test", {})).rejects.toThrow("MODEL_ARTIFACT_NOT_RESUBMITTED");
    expect(attempts).toBe(2);
  });

  it("uses one executor-owned rate-limit schedule and emits sanitized retry metadata", async () => {
    const retryEvents: unknown[] = [];
    const waited: number[] = [];
    const executor = new PiGenerationExecutor({
      projectRoot: "/project",
      models: [],
      secretFor: () => undefined,
      onRetry: (event) => retryEvents.push(event),
      waitForRetry: async (delayMs) => { waited.push(delayMs); },
    });
    let attempts = 0;
    (executor as unknown as { runArtifactAttempt: () => Promise<{ pass: boolean }> }).runArtifactAttempt = async () => {
      attempts += 1;
      if (attempts < 3) throw new Error('429: {"code":"rate_limit_tpm","message":"secret provider response"}');
      return { pass: true };
    };

    const result = await (executor as unknown as {
      runArtifact: (role: "reviewer", work: WorkDescriptor, artifactId: string, payload: unknown) => Promise<{ pass: boolean }>;
    }).runArtifact("reviewer", { stage: "fact" } as WorkDescriptor, "VERDICT-fact-work", { privatePayload: true });

    expect(result).toEqual({ pass: true });
    expect(waited).toEqual([60_000, 120_000]);
    expect(retryEvents).toEqual([
      { stage: "fact", role: "reviewer", category: "provider-rate-limit", attempt: 1, delayMs: 60_000 },
      { stage: "fact", role: "reviewer", category: "provider-rate-limit", attempt: 2, delayMs: 120_000 },
    ]);
    expect(JSON.stringify(retryEvents)).not.toContain("secret provider response");
    expect(JSON.stringify(retryEvents)).not.toContain("privatePayload");
  });

  it("retries an incomplete provider stream that ended before artifact submission", async () => {
    const retryEvents: unknown[] = [];
    const waited: number[] = [];
    const executor = new PiGenerationExecutor({
      projectRoot: "/project",
      models: [],
      secretFor: () => undefined,
      onRetry: (event) => retryEvents.push(event),
      waitForRetry: async (delayMs) => { waited.push(delayMs); },
    });
    let attempts = 0;
    (executor as unknown as { runArtifactAttempt: () => Promise<{ pass: boolean }> }).runArtifactAttempt = async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("Stream ended without finish_reason");
      return { pass: true };
    };

    await expect((executor as unknown as {
      runArtifact: (role: "reviewer", work: WorkDescriptor, artifactId: string, payload: unknown) => Promise<{ pass: boolean }>;
    }).runArtifact("reviewer", { stage: "fact" } as WorkDescriptor, "VERDICT-fact-work", {})).resolves.toEqual({ pass: true });
    expect(waited).toEqual([1_000]);
    expect(retryEvents).toEqual([
      { stage: "fact", role: "reviewer", category: "network-transient", attempt: 1, delayMs: 1_000 },
    ]);
  });

  it("retries the provider SDK's generic connection error", async () => {
    const waited: number[] = [];
    const executor = new PiGenerationExecutor({
      projectRoot: "/project",
      models: [],
      secretFor: () => undefined,
      waitForRetry: async (delayMs) => { waited.push(delayMs); },
    });
    let attempts = 0;
    (executor as unknown as { runArtifactAttempt: () => Promise<{ pass: boolean }> }).runArtifactAttempt = async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("Connection error.");
      return { pass: true };
    };

    await expect((executor as unknown as {
      runArtifact: (role: "author", work: WorkDescriptor, artifactId: string, payload: unknown) => Promise<{ pass: boolean }>;
    }).runArtifact("author", { stage: "fact" } as WorkDescriptor, "EDGE-LEDGER-RUN-test", {})).resolves.toEqual({ pass: true });
    expect(waited).toEqual([1_000]);
  });
});

describe("Pi generation session isolation", () => {
  it("isolates author, reviewer, and repair lanes within one step and disposes them at step end", async () => {
    const created: string[] = [];
    const rebound: string[] = [];
    const disposed: string[] = [];
    const host = {
      create: async () => {
        const sessionId = `PI-${created.length + 1}`;
        created.push(sessionId);
        return { sessionId };
      },
      rebind: (sessionId: string) => { rebound.push(sessionId); },
      dispose: async (sessionId: string) => { disposed.push(sessionId); },
    };
    const executor = new PiGenerationExecutor({ projectRoot: "/tmp/project", models: [], secretFor: () => undefined });
    const lanes = executor as unknown as {
      acquireSessionLane: (currentHost: typeof host, input: object, step: "fact-catalog", role: "author" | "reviewer" | "repair") => Promise<{ sessionId: string }>;
      disposeStepSessionLanes: (step: "fact-catalog") => Promise<void>;
    };

    await expect(lanes.acquireSessionLane(host, {}, "fact-catalog", "author")).resolves.toEqual({ sessionId: "PI-1" });
    await expect(lanes.acquireSessionLane(host, {}, "fact-catalog", "author")).resolves.toEqual({ sessionId: "PI-1" });
    await expect(lanes.acquireSessionLane(host, {}, "fact-catalog", "reviewer")).resolves.toEqual({ sessionId: "PI-2" });
    await expect(lanes.acquireSessionLane(host, {}, "fact-catalog", "repair")).resolves.toEqual({ sessionId: "PI-3" });
    expect(rebound).toEqual(["PI-1"]);

    await lanes.disposeStepSessionLanes("fact-catalog");

    expect(disposed).toEqual(["PI-1", "PI-2", "PI-3"]);
  });

  it("keeps a completed artifact when transient context compaction fails", async () => {
    const disposed: string[] = [];
    const host = {
      compact: async () => { throw new Error("Summarization failed: Stream ended without finish_reason"); },
      dispose: async (sessionId: string) => { disposed.push(sessionId); },
    };
    const handle = { sessionId: "PI-completed" };
    const executor = new PiGenerationExecutor({ projectRoot: "/tmp/project", models: [], secretFor: () => undefined });
    Object.assign(executor, { sessionLanes: new Map([["fact-catalog:author", { host, handle }]]) });

    await expect((executor as unknown as {
      compactCompletedSession: (currentHost: typeof host, currentHandle: typeof handle) => Promise<void>;
    }).compactCompletedSession(host, handle)).resolves.toBeUndefined();

    expect(disposed).toEqual(["PI-completed"]);
    expect((executor as unknown as { sessionLanes: Map<string, unknown> }).sessionLanes.size).toBe(0);
  });

  it("propagates the verified step plan into reviewer and repair child work", async () => {
    const registered: WorkDescriptor[] = [];
    const stepPlan = { entryChecks: ["check input"], executionActions: ["review candidate"], completionChecks: ["record verdict"], correctionMode: "targeted-patch" as const, contextStrategy: "step-role-lane" as const };
    const rootWork = { schemaVersion: 1 as const, projectId: "PRJ-test", analysisRunId: "RUN-test", sourceSnapshotId: "SNAP-test", sessionId: "SESSION-test", workId: "WORK-root", kind: "analysis.fact-catalog" as const, stage: "fact" as const, generationStep: "fact-catalog" as const, role: "author" as const, outputArtifactType: "fact-catalog" as const, objective: "Create the FACT catalog.", stepPlan, inputArtifacts: [], attemptId: "ATTEMPT-test", expectedRevision: 1, inputIds: ["SNAP-test"], stagingPath: ".scenarioforge/staging/WORK-root", status: "running" as const, createdAt: "2026-09-08T00:00:00.000Z", updatedAt: "2026-09-08T00:00:00.000Z", progress: 0, completionRequested: false } satisfies WorkDescriptor;
    const executor = new PiGenerationExecutor({ projectRoot: "/tmp/project", models: [], secretFor: () => undefined });
    Object.assign(executor, { workStateService: {
      transitionStepRole: async () => undefined,
      getState: () => ({ revision: 7 }),
      register: async (descriptor: WorkDescriptor) => { registered.push(descriptor); },
      getContext: async () => ({ revision: 7, contextToken: "CTX-test" }),
      begin: async () => undefined,
    } });

    const child = await (executor as unknown as {
      prepareRoleWork: (work: WorkDescriptor, role: "reviewer", output: "semantic-verdict") => Promise<WorkDescriptor>;
    }).prepareRoleWork(rootWork, "reviewer", "semantic-verdict");

    expect(registered[0]).toMatchObject({ stepPlan, objective: "Review only the fact-catalog candidate against its verified plan and evidence." });
    expect(child.stepPlan).toEqual(stepPlan);
  });

  it("creates every generation attempt as memory-only and disposes it on failure", async () => {
    const created: unknown[] = [];
    const disposed: string[] = [];
    const host = {
      create: async (input: unknown) => { created.push(input); return { sessionId: "PI-memory" }; },
      prompt: async () => { throw new Error("PROVIDER_STOP"); },
      dispose: async (sessionId: string) => { disposed.push(sessionId); },
    };
    const work = { schemaVersion: 1 as const, projectId: "PRJ-test", analysisRunId: "RUN-test", sourceSnapshotId: "SNAP-test", sessionId: "SESSION-test", workId: "WORK-test", kind: "analysis.fact-catalog" as const, stage: "fact" as const, generationStep: "fact-catalog" as const, role: "author" as const, outputArtifactType: "fact-catalog" as const, inputArtifacts: [], attemptId: "ATTEMPT-test", expectedRevision: 1, inputIds: ["SNAP-test"], stagingPath: ".scenarioforge/staging/WORK-test", status: "running" as const, createdAt: "2026-09-08T00:00:00.000Z", updatedAt: "2026-09-08T00:00:00.000Z", progress: 0, completionRequested: false } satisfies WorkDescriptor;
    const executor = new PiGenerationExecutor({ projectRoot: "/tmp/project", models: [], secretFor: () => undefined });
    Object.assign(executor, {
      hostPromise: Promise.resolve(host),
      workStateService: { getState: () => ({ artifacts: {} }) },
      artifactWriter: {},
    });

    await expect((executor as unknown as {
      runArtifactAttempt: (role: "author", generationRole: "author", currentWork: WorkDescriptor, artifactId: string, payload: unknown) => Promise<unknown>;
    }).runArtifactAttempt("author", "author", work, "FACT-CATALOG-RUN-test", {})).rejects.toThrow("PROVIDER_STOP");

    expect(created).toEqual([expect.objectContaining({ sessionPersistence: "memory", allowedArtifactIds: ["SNAP-test"] })]);
    expect(disposed).toEqual(["PI-memory"]);
  });

  it("allows only payload-scoped artifact IDs and removes executable target candidates", () => {
    const facts = {
      schema_version: 2,
      project_id: "PRJ-test",
      analysis_run_id: "RUN-test",
      source_snapshot_id: "SNAP-test",
      screens: [{ schema_version: 3, project_id: "PRJ-test", analysis_run_id: "RUN-test", source_snapshot_id: "SNAP-test", screen_id: "SCR-one", title: "One", entry_guards: [], elements: [{ id: "EL-one", type: "button", label: "One", interaction: { action_kind: "click", surface_kind: "web", target_candidates: [{ by: "test-id", value: "secret-selector" }] }, evidence: [] }], apis: [], feedback: [], displays: [], status: "verified" }],
      predicates: [],
      edges: [],
    } satisfies FactBundle;
    const executor = new PiGenerationExecutor({ projectRoot: "/tmp/project", models: [], secretFor: () => undefined });
    Object.assign(executor, { lastFacts: facts });
    const work = { inputIds: ["FACT-RUN-test"] } as WorkDescriptor;
    const allowed = (executor as unknown as { allowedArtifactIds: (currentWork: WorkDescriptor, payload: unknown) => string[] }).allowedArtifactIds(work, { target: "EL-one" });
    const view = (executor as unknown as { boundedArtifactById: (id: string) => unknown }).boundedArtifactById("EL-one");

    expect(allowed).toEqual(["EL-one", "FACT-RUN-test"]);
    expect(JSON.stringify(view)).not.toContain("target_candidates");
    expect(JSON.stringify(view)).not.toContain("secret-selector");
  });
});
