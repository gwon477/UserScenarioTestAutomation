import type { EdgeLedger, FactBundle, FactCatalog, FactEdge } from "@scenarioforge/contracts";
import { applyFactEnrichmentPatch, type FactEnrichmentPatch } from "./fact-draft-compiler.js";

export type FactCatalogPatch = FactEnrichmentPatch;
export type EdgeProposalPatch = { schema_version: 1; edges: FactEnrichmentPatch["edges"] };

const identity = (facts: FactBundle | FactCatalog | EdgeLedger) => ({
  project_id: facts.project_id,
  analysis_run_id: facts.analysis_run_id,
  source_snapshot_id: facts.source_snapshot_id,
});

const orderedEdges = (edges: FactEdge[]): FactEdge[] => [...edges]
  .map((edge) => structuredClone(edge))
  .sort((left, right) => left.edge_id.localeCompare(right.edge_id));

export function createFactCatalog(facts: FactBundle): FactCatalog {
  return {
    schema_version: 1,
    ...identity(facts),
    screens: [...facts.screens].map((screen) => structuredClone(screen)).sort((left, right) => left.screen_id.localeCompare(right.screen_id)),
    predicates: [...facts.predicates].map((predicate) => structuredClone(predicate)).sort((left, right) => left.pred_id.localeCompare(right.pred_id)),
  };
}

export function applyFactCatalogPatch(draft: FactBundle, patch: FactCatalogPatch): FactCatalog {
  const candidate = patch as unknown as Record<string, unknown> | undefined;
  const normalizedPatch = candidate && candidate.edges === undefined
    ? { ...patch, edges: [] }
    : patch;
  if (!Array.isArray(normalizedPatch?.edges) || normalizedPatch.edges.length !== 0) throw new Error("FACT_CATALOG_EDGE_FORBIDDEN");
  const compiled = applyFactEnrichmentPatch(draft, normalizedPatch);
  let elementNumber = 0;
  const elements = new Map<string, FactBundle["screens"][number]["elements"][number]>(compiled.screens.flatMap((screen) => screen.elements.map((element) => [`U${++elementNumber}`, element] as const)));
  for (const update of normalizedPatch.element_updates) {
    if (update.action_kind !== undefined) elements.get(update.element_ref)!.interaction.action_kind = update.action_kind;
  }
  return createFactCatalog(compiled);
}

export function applyEdgeProposalPatch(catalog: FactCatalog, evidenceDraft: FactBundle, patch: EdgeProposalPatch): EdgeLedger {
  if (!patch || patch.schema_version !== 1 || !Array.isArray(patch.edges) || Object.keys(patch).some((key) => !["schema_version", "edges"].includes(key))) {
    throw new Error("EDGE_PROPOSAL_PATCH_INVALID");
  }
  const disjunctiveGuardPaths = patch.edges.flatMap((edge, index) => {
    const candidate = edge as unknown as Record<string, unknown>;
    return (["guard", "effect"] as const).flatMap((field) => {
      const expression = candidate[field];
      return expression && typeof expression === "object" && !Array.isArray(expression) && Object.hasOwn(expression, "any")
        ? [`edges.${index}.${field}`]
        : [];
    });
  });
  if (disjunctiveGuardPaths.length) {
    throw new Error(`FACT_PATCH_SCHEMA_INVALID:${disjunctiveGuardPaths.join(",")}:ANY_UNSUPPORTED`);
  }
  if (catalog.project_id !== evidenceDraft.project_id || catalog.analysis_run_id !== evidenceDraft.analysis_run_id || catalog.source_snapshot_id !== evidenceDraft.source_snapshot_id) {
    throw new Error("EDGE_PROPOSAL_IDENTITY_MISMATCH");
  }
  const catalogElementRefs = new Map<string, string>();
  let elementNumber = 0;
  catalog.screens.forEach((screen) => screen.elements.forEach((element) => catalogElementRefs.set(element.id, `U${++elementNumber}`)));
  const evidenceKey = (entry: FactBundle["predicates"][number]["evidence"][number]) =>
    `${entry.source_id}:${entry.path}:${entry.start_line}:${entry.end_line}:${entry.content_hash}`;
  const elementRefsByEvidence = new Map<string, string[]>();
  catalog.screens.forEach((screen) => screen.elements.forEach((element) => element.evidence.forEach((entry) => {
    const key = evidenceKey(entry);
    elementRefsByEvidence.set(key, [...(elementRefsByEvidence.get(key) ?? []), catalogElementRefs.get(element.id)!]);
  })));
  const predicates = catalog.predicates.map((predicate) => {
    const evidenceElementRefs = [...new Set(predicate.evidence.flatMap((entry) => elementRefsByEvidence.get(evidenceKey(entry)) ?? []))].sort();
    if (!evidenceElementRefs.length) throw new Error(`EDGE_LEDGER_PREDICATE_EVIDENCE_UNMAPPABLE:${predicate.pred_id}`);
    return {
      key: predicate.pred_id.replace(/^PRED-/, ""),
      values: [...predicate.values],
      source: predicate.source,
      evidence_element_refs: evidenceElementRefs,
    };
  });
  const compiled = applyFactEnrichmentPatch(evidenceDraft, {
    schema_version: 2,
    screen_updates: [],
    element_updates: [],
    api_updates: [],
    predicates,
    edges: patch.edges,
  });
  const expectedPredicateIds = catalog.predicates.map((predicate) => predicate.pred_id).sort();
  const actualPredicateIds = compiled.predicates.map((predicate) => predicate.pred_id).sort();
  if (JSON.stringify(expectedPredicateIds) !== JSON.stringify(actualPredicateIds)) throw new Error("EDGE_LEDGER_PREDICATE_IDENTITY_CHANGED");
  return createEdgeLedger(compiled);
}

export async function applyEdgeProposalPatchWithCorrection(
  catalog: FactCatalog,
  evidenceDraft: FactBundle,
  patch: EdgeProposalPatch,
  correct: (message: string, rejected: EdgeProposalPatch) => Promise<EdgeProposalPatch>,
): Promise<EdgeLedger> {
  try {
    return applyEdgeProposalPatch(catalog, evidenceDraft, patch);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/^FACT_PATCH_SCHEMA_INVALID(?:$|:)/.test(message) && !/^FACT_PATCH_REFERENCE_INVALID:predicate_(?:key|value):/.test(message)) throw error;
    return applyEdgeProposalPatch(catalog, evidenceDraft, await correct(message, patch));
  }
}

export function edgeProposalPatchFromLedger(catalog: FactCatalog, ledger: EdgeLedger): EdgeProposalPatch {
  const screenRefs = new Map(catalog.screens.map((screen, index) => [screen.screen_id, `S${index + 1}`] as const));
  const elementRefs = new Map<string, string>();
  let elementNumber = 0;
  catalog.screens.forEach((screen) => screen.elements.forEach((element) => elementRefs.set(element.id, `U${++elementNumber}`)));
  const expression = (value: string | undefined) => {
    if (!value) return undefined;
    const clauses = value.split(/\s*&&\s*/).map((clause) => {
      const match = clause.match(/^(PRED-[A-Za-z0-9_.-]+)=(.*)$/);
      if (!match) throw new Error(`EDGE_LEDGER_EXPRESSION_INVALID:${clause}`);
      return { predicate_key: match[1].replace(/^PRED-/, ""), value: match[2] };
    });
    return clauses.length === 1 ? clauses[0] : { all: clauses };
  };
  return {
    schema_version: 1,
    edges: ledger.edges.map((edge) => {
      const fromScreenRef = screenRefs.get(edge.from.split("[")[0]);
      const toScreenRef = screenRefs.get(edge.to.split("[")[0]);
      const onElementRef = elementRefs.get(edge.on);
      if (!fromScreenRef || !toScreenRef || !onElementRef) throw new Error(`EDGE_LEDGER_CATALOG_REFERENCE_INVALID:${edge.edge_id}`);
      const guard = expression(edge.guard);
      const effect = expression(edge.effect);
      return {
        ...(edge.source_branch_ref ? { source_branch_ref: edge.source_branch_ref } : {}),
        kind: edge.kind,
        from_screen_ref: fromScreenRef,
        on_element_ref: onElementRef,
        to_screen_ref: toScreenRef,
        ...(guard ? { guard } : {}),
        ...(effect ? { effect } : {}),
      };
    }),
  };
}

export function createEdgeLedger(facts: FactBundle): EdgeLedger {
  const edges = orderedEdges(facts.edges);
  const outcomeKinds = new Map<string, Set<FactEdge["kind"]>>();
  edges.forEach((edge) => {
    const key = `${edge.from}:${edge.on}`;
    outcomeKinds.set(key, new Set([...(outcomeKinds.get(key) ?? []), edge.kind]));
  });
  return {
    schema_version: 1,
    ...identity(facts),
    edges,
    audit: edges.map((edge) => {
      const outcomes = outcomeKinds.get(`${edge.from}:${edge.on}`)!;
      return {
        edge_id: edge.edge_id,
        journey_action_ref: `${edge.from}:${edge.on}`,
        normal_outcome: outcomes.has("normal"),
        exception_outcome: outcomes.has("exception"),
        guard_status: edge.guard ? "present" : "not-required",
        effect_status: edge.effect ? "present" : "not-required",
        evidence_status: edge.evidence.length ? "present" : "missing",
      };
    }),
  };
}

export function assembleFactBundle(catalog: FactCatalog, ledger: EdgeLedger): FactBundle {
  if (catalog.project_id !== ledger.project_id || catalog.analysis_run_id !== ledger.analysis_run_id || catalog.source_snapshot_id !== ledger.source_snapshot_id) {
    throw new Error("FACT_ASSEMBLY_IDENTITY_MISMATCH");
  }
  const screens = new Set(catalog.screens.map((screen) => screen.screen_id));
  const elements = new Set(catalog.screens.flatMap((screen) => screen.elements.map((element) => element.id)));
  const predicates = new Set(catalog.predicates.map((predicate) => predicate.pred_id));
  for (const edge of ledger.edges) {
    if (!screens.has(edge.from) || !screens.has(edge.to) || !elements.has(edge.on)) throw new Error(`EDGE_LEDGER_CATALOG_REFERENCE_INVALID:${edge.edge_id}`);
    for (const expression of [edge.guard, edge.effect]) {
      for (const predicateRef of expression?.match(/PRED-[A-Za-z0-9._-]+/g) ?? []) {
        if (!predicates.has(predicateRef)) throw new Error(`EDGE_LEDGER_PREDICATE_REFERENCE_INVALID:${edge.edge_id}:${predicateRef}`);
      }
    }
  }
  if (ledger.audit.length !== ledger.edges.length || ledger.audit.some((row, index) => row.edge_id !== orderedEdges(ledger.edges)[index].edge_id || row.evidence_status !== "present")) {
    throw new Error("EDGE_LEDGER_AUDIT_INVALID");
  }
  return {
    schema_version: 2,
    ...identity(catalog),
    screens: catalog.screens.map((screen) => structuredClone(screen)),
    edges: orderedEdges(ledger.edges),
    predicates: catalog.predicates.map((predicate) => structuredClone(predicate)),
  };
}
