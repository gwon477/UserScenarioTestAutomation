import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { EvidenceReference, FactBundle, SourceSnapshot, ValidationIssue } from "@scenarioforge/contracts";
import type { EvidenceGrant } from "../security/evidence-grant-service.js";
import { edgeId, screenId } from "../scanning/deterministic-id.js";

export type FactEnrichmentPatch = {
  schema_version: 2;
  screen_updates: Array<{ screen_ref: string; title?: string }>;
  element_updates: Array<{ element_ref: string; label?: string; action_kind?: string }>;
  api_updates: Array<{ api_ref: string; reads: string[]; writes: string[] }>;
  predicates: Array<{ key: string; values: string[]; source: "code" | "db" | "assumed"; evidence_element_refs: string[] }>;
  edges: Array<{
    source_branch_ref?: string;
    kind: "normal" | "exception";
    from_screen_ref: string;
    on_element_ref: string;
    to_screen_ref: string;
    guard?: { predicate_key: string; value: string } | { all: Array<{ predicate_key: string; value: string }> };
    effect?: { predicate_key: string; value: string } | { all: Array<{ predicate_key: string; value: string }> };
  }>;
};

export type FactEnrichmentDraftView = {
  screens: Array<{
    screen_ref: string;
    route?: string;
    title: string;
    elements: Array<{ element_ref: string; type: string; label: string; interaction: FactBundle["screens"][number]["elements"][number]["interaction"]; source_anchor?: { path: string; line: number } }>;
    apis: Array<{ api_ref: string; reads: string[]; writes: string[]; source_anchor?: { path: string; line: number } }>;
  }>;
};

export type FactDraftPartitionPlan = {
  screen_ref: string;
  screen_id: string;
  element_ids: string[];
  api_ids: string[];
};

export type FactCorrectionPlan = {
  schema_version: 1;
  base_patch_hash: string;
  screen_update_fields?: Record<string, Array<"title">>;
  element_update_fields: Record<string, Array<"label" | "action_kind">>;
  api_update_fields?: Record<string, Array<"reads" | "writes">>;
  predicate_element_refs: string[];
  remove_predicate_keys: string[];
  replace_edge_indexes: number[];
  remove_edge_indexes: number[];
  replace_edge_identities: Array<{ edge_index: number; on_element_ref: string }>;
  edge_update_fields: Record<string, Array<"source_branch_ref" | "kind" | "from_screen_ref" | "on_element_ref" | "to_screen_ref" | "guard" | "effect">>;
  add_edge_element_refs: string[];
};

export type FactCorrectionPatch = {
  schema_version: 1;
  base_patch_hash: string;
  screen_update_upserts?: FactEnrichmentPatch["screen_updates"];
  element_update_upserts: FactEnrichmentPatch["element_updates"];
  api_update_upserts?: FactEnrichmentPatch["api_updates"];
  predicate_upserts: FactEnrichmentPatch["predicates"];
  predicate_removals?: string[];
  edge_changes: Array<
    | { operation: "replace"; edge_index: number; edge: FactEnrichmentPatch["edges"][number] }
    | { operation: "add"; edge: FactEnrichmentPatch["edges"][number] }
    | { operation: "remove"; edge_index: number }
  >;
};

export function orderedFactEnrichmentEdges(patch: FactEnrichmentPatch): FactEnrichmentPatch["edges"] {
  return [...patch.edges].sort((left, right) =>
    `${left.from_screen_ref}:${left.on_element_ref}:${left.source_branch_ref ?? ""}:${left.to_screen_ref}:${left.kind}`
      .localeCompare(`${right.from_screen_ref}:${right.on_element_ref}:${right.source_branch_ref ?? ""}:${right.to_screen_ref}:${right.kind}`));
}

const semanticSlug = (value: string): string => value.toLowerCase().replace(/^(?:PRED|SCR|EL|API|E)-/i, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "unknown";
const predicateId = (key: string): string => `PRED-${semanticSlug(key)}`;
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every((entry) => typeof entry === "string");
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const guardClause = (value: unknown): value is { predicate_key: string; value: string } =>
  record(value) && typeof value.predicate_key === "string" && typeof value.value === "string";
const patchGuard = (value: unknown): boolean =>
  guardClause(value) || (record(value) && Array.isArray(value.all) && value.all.length > 0 && value.all.every(guardClause));

function factReferences(draft: FactBundle) {
  let elementNumber = 0;
  let apiNumber = 0;
  return draft.screens.map((screen, screenIndex) => ({
    ref: `S${screenIndex + 1}`,
    value: screen,
    elements: screen.elements.map((element) => ({ ref: `U${++elementNumber}`, value: element })),
    apis: screen.apis.map((api) => ({ ref: `A${++apiNumber}`, value: api })),
  }));
}

const factPatchHash = (patch: FactEnrichmentPatch): string =>
  `sha256:${createHash("sha256").update(JSON.stringify(patch)).digest("hex")}`;

export function createFactCorrectionPlan(
  draft: FactBundle,
  rejectedPatch: FactEnrichmentPatch,
  issues: readonly ValidationIssue[],
): FactCorrectionPlan {
  const allReferences = factReferences(draft);
  const references = allReferences.flatMap((screen) => screen.elements.map((element) => ({ id: element.value.id, ref: element.ref })));
  const screenFields = new Map<string, Set<"title">>();
  const elementFields = new Map<string, Set<"label" | "action_kind">>();
  const apiFields = new Map<string, Set<"reads" | "writes">>();
  const predicateElementRefs = new Set<string>();
  const addEdgeElementRefs = new Set<string>();
  const replaceEdgeIndexes = new Set<number>();
  const removeEdgeIndexes = new Set<number>();
  const removePredicateKeys = new Set<string>();
  const edgeUpdateFields = new Map<number, Set<"source_branch_ref" | "kind" | "from_screen_ref" | "on_element_ref" | "to_screen_ref" | "guard" | "effect">>();
  const orderedEdges = orderedFactEnrichmentEdges(rejectedPatch);

  for (const issue of issues) {
    const issueText = `${issue.path}\n${issue.message}`;
    const mentioned = (value: string) => {
      const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`(?:^|[^A-Za-z0-9._-])${escaped}(?:$|[^A-Za-z0-9._-])`).test(issueText);
    };
    allReferences.filter(({ value, ref }) => mentioned(value.screen_id) || mentioned(ref)).forEach(({ ref }) => screenFields.set(ref, new Set(["title"])));
    allReferences.flatMap((screen) => screen.apis).filter(({ value, ref }) => mentioned(value.id) || mentioned(ref)).forEach(({ ref }) => apiFields.set(ref, new Set(["reads", "writes"])));
    const referencedElements = references.filter(({ id, ref }) => mentioned(id) || mentioned(ref));
    for (const { ref } of referencedElements) {
      predicateElementRefs.add(ref);
      if (issue.code === "FACT_CATALOG_ELEMENT_SEMANTICS") elementFields.set(ref, new Set(["label", "action_kind"]));
      if (["FACT_SOURCE_STATE_PREDICATE_MISSING", "FACT_LOCAL_VIEW_EFFECT_UNSUPPORTED"].includes(issue.code)) {
        orderedEdges.forEach((edge, index) => {
          if (edge.on_element_ref === ref) {
            replaceEdgeIndexes.add(index);
            edgeUpdateFields.set(index, new Set([...(edgeUpdateFields.get(index) ?? []), "effect"]));
          }
        });
      }
      if (["FACT_SOURCE_BRANCH_REF_MISSING", "FACT_SOURCE_BRANCH_OUTCOME_MISMATCH", "FACT_SOURCE_BRANCH_UNSUPPORTED", "FACT_SOURCE_BRANCH_DUPLICATE"].includes(issue.code)) {
        orderedEdges.forEach((edge, index) => {
          if (edge.on_element_ref === ref) {
            replaceEdgeIndexes.add(index);
            removeEdgeIndexes.add(index);
            edgeUpdateFields.set(index, new Set([...(edgeUpdateFields.get(index) ?? []), "source_branch_ref", "kind"]));
          }
        });
      }
      if (issue.code === "FACT_SOURCE_STABLE_OUTCOME_PREDICATE_MISSING") {
        orderedEdges.forEach((edge, index) => {
          if (edge.on_element_ref === ref) {
            replaceEdgeIndexes.add(index);
            edgeUpdateFields.set(index, new Set([...(edgeUpdateFields.get(index) ?? []), "effect"]));
          }
        });
      }
      if (issue.code === "FACT_JOURNEY_ACTION_SELF_LOOP_ONLY") {
        orderedEdges.forEach((edge, index) => {
          if (edge.on_element_ref === ref) {
            replaceEdgeIndexes.add(index);
            edgeUpdateFields.set(index, new Set([...(edgeUpdateFields.get(index) ?? []), "to_screen_ref"]));
          }
        });
      }
      if (issue.code === "FACT_LITERAL_NAVIGATION_TARGET_MISMATCH") {
        orderedEdges.forEach((edge, index) => {
          if (edge.on_element_ref === ref) {
            replaceEdgeIndexes.add(index);
            edgeUpdateFields.set(index, new Set([...(edgeUpdateFields.get(index) ?? []), "to_screen_ref"]));
          }
        });
      }
      if (issue.code === "FACT_UNRESOLVED_CONNECTION_EDGE_FORBIDDEN") {
        orderedEdges.forEach((edge, index) => {
          if (edge.on_element_ref !== ref) return;
          replaceEdgeIndexes.add(index);
          removeEdgeIndexes.add(index);
        });
      }
      if (issue.code === "FACT_SOURCE_ACTION_UNRESOLVED") {
        elementFields.set(ref, new Set([...(elementFields.get(ref) ?? []), "action_kind"]));
        addEdgeElementRefs.add(ref);
      }
      if (["FACT_SOURCE_ACTION_MISSING", "FACT_JOURNEY_ACTION_MISSING", "FACT_NORMAL_EDGE_MISSING", "FACT_EXCEPTION_EDGE_MISSING", "FACT_SOURCE_BRANCH_MISSING"].includes(issue.code)) {
        addEdgeElementRefs.add(ref);
      }
    }
    const screenUpdateMatch = issue.path.match(/^screen_updates\.(\d+)(?:\.(title))?/);
    if (screenUpdateMatch) {
      const update = rejectedPatch.screen_updates[Number(screenUpdateMatch[1])];
      if (update) screenFields.set(update.screen_ref, new Set(["title"]));
    }
    const elementUpdateMatch = issue.path.match(/^element_updates\.(\d+)(?:\.(label|action_kind))?/);
    if (elementUpdateMatch) {
      const update = rejectedPatch.element_updates[Number(elementUpdateMatch[1])];
      if (update) elementFields.set(update.element_ref, new Set(elementUpdateMatch[2] ? [elementUpdateMatch[2] as "label" | "action_kind"] : ["label", "action_kind"]));
    }
    const apiUpdateMatch = issue.path.match(/^api_updates\.(\d+)(?:\.(reads|writes))?/);
    if (apiUpdateMatch) {
      const update = rejectedPatch.api_updates[Number(apiUpdateMatch[1])];
      if (update) apiFields.set(update.api_ref, new Set(apiUpdateMatch[2] ? [apiUpdateMatch[2] as "reads" | "writes"] : ["reads", "writes"]));
    }
    const predicateMatch = issue.path.match(/^predicates\.(\d+)/);
    if (predicateMatch) {
      rejectedPatch.predicates[Number(predicateMatch[1])]?.evidence_element_refs?.forEach((ref) => predicateElementRefs.add(ref));
    }
    if (issue.path.startsWith("edges.")) {
      const index = Number(issue.path.slice("edges.".length).match(/^\d+/)?.[0]);
      if (Number.isInteger(index) && index >= 0) {
        replaceEdgeIndexes.add(index);
        const edge = orderedEdges[index];
        if (edge) predicateElementRefs.add(edge.on_element_ref);
        const field = issue.path.slice("edges.".length).match(/^\d+\.(source_branch_ref|kind|from_screen_ref|on_element_ref|to_screen_ref|guard|effect)(?:\.|$)/)?.[1];
        if (field) edgeUpdateFields.set(index, new Set([...(edgeUpdateFields.get(index) ?? []), field as "source_branch_ref" | "kind" | "from_screen_ref" | "on_element_ref" | "to_screen_ref" | "guard" | "effect"]));
        if (issue.message.includes("ANY_UNSUPPORTED") && edge) addEdgeElementRefs.add(edge.on_element_ref);
      }
    }
    orderedEdges.forEach((edge, edgeIndex) => {
      for (const field of ["guard", "effect"] as const) {
        const expression = edge[field];
        const clauses = expression ? ("all" in expression ? expression.all : [expression]) : [];
        if (clauses.some((clause) => mentioned(clause.predicate_key) || mentioned(`${clause.predicate_key}=${clause.value}`))) {
          replaceEdgeIndexes.add(edgeIndex);
          predicateElementRefs.add(edge.on_element_ref);
          edgeUpdateFields.set(edgeIndex, new Set([...(edgeUpdateFields.get(edgeIndex) ?? []), field]));
        }
      }
    });
    if (issue.code === "FACT_PATCH_SCHEMA_INVALID" && issue.path === "$") {
      rejectedPatch.predicates.forEach((predicate) => {
        if (!predicate || typeof predicate.key !== "string" || !Array.isArray(predicate.values)
          || !["code", "db", "assumed"].includes(String(predicate.source)) || !Array.isArray(predicate.evidence_element_refs)) {
          predicate?.evidence_element_refs?.forEach((ref) => predicateElementRefs.add(ref));
        }
      });
    }
    if (issue.code === "FACT_PATCH_PREDICATE_ID_COLLISION") {
      const predicateIndex = Number(issue.path.match(/^predicates\.(\d+)\.key$/)?.[1]);
      const predicate = rejectedPatch.predicates[predicateIndex];
      if (predicate) {
        removePredicateKeys.add(predicate.key);
        predicate.evidence_element_refs.forEach((ref) => predicateElementRefs.add(ref));
        orderedEdges.forEach((edge, edgeIndex) => {
          for (const field of ["guard", "effect"] as const) {
            const expression = edge[field];
            const clauses = expression ? ("all" in expression ? expression.all : [expression]) : [];
            if (clauses.some((clause) => clause.predicate_key === predicate.key)) {
              replaceEdgeIndexes.add(edgeIndex);
              predicateElementRefs.add(edge.on_element_ref);
              edgeUpdateFields.set(edgeIndex, new Set([...(edgeUpdateFields.get(edgeIndex) ?? []), field]));
            }
          }
        });
      }
    }
  }
  if (!screenFields.size && !elementFields.size && !apiFields.size && !predicateElementRefs.size && !removePredicateKeys.size && !replaceEdgeIndexes.size && !addEdgeElementRefs.size) {
    throw new Error("FACT_CORRECTION_SCOPE_UNMAPPABLE");
  }
  return {
    schema_version: 1,
    base_patch_hash: factPatchHash(rejectedPatch),
    screen_update_fields: Object.fromEntries([...screenFields].sort(([left], [right]) => left.localeCompare(right)).map(([ref, fields]) => [ref, [...fields]])),
    element_update_fields: Object.fromEntries([...elementFields]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([ref, fields]) => [ref, [...fields].sort()])),
    api_update_fields: Object.fromEntries([...apiFields].sort(([left], [right]) => left.localeCompare(right)).map(([ref, fields]) => [ref, [...fields].sort()])),
    predicate_element_refs: [...predicateElementRefs].sort(),
    remove_predicate_keys: [...removePredicateKeys].sort(),
    replace_edge_indexes: [...replaceEdgeIndexes].sort((left, right) => left - right),
    remove_edge_indexes: [...removeEdgeIndexes].sort((left, right) => left - right),
    replace_edge_identities: [...replaceEdgeIndexes]
      .sort((left, right) => left - right)
      .flatMap((index) => orderedEdges[index] ? [{ edge_index: index, on_element_ref: orderedEdges[index].on_element_ref }] : []),
    edge_update_fields: Object.fromEntries([...edgeUpdateFields]
      .sort(([left], [right]) => left - right)
      .map(([index, fields]) => [String(index), [...fields].sort()])),
    add_edge_element_refs: [...addEdgeElementRefs].sort(),
  };
}

export function applyFactCorrectionPatch(
  rejectedPatch: FactEnrichmentPatch,
  plan: FactCorrectionPlan,
  correction: FactCorrectionPatch,
): FactEnrichmentPatch {
  if (!record(correction)
    || correction.schema_version !== 1
    || correction.base_patch_hash !== plan.base_patch_hash
    || correction.base_patch_hash !== factPatchHash(rejectedPatch)
    || (correction.screen_update_upserts !== undefined && !Array.isArray(correction.screen_update_upserts))
    || !Array.isArray(correction.element_update_upserts)
    || (correction.api_update_upserts !== undefined && !Array.isArray(correction.api_update_upserts))
    || !Array.isArray(correction.predicate_upserts)
    || (correction.predicate_removals !== undefined && !strings(correction.predicate_removals))
    || !Array.isArray(correction.edge_changes)
    || Object.keys(correction).some((key) => !["schema_version", "base_patch_hash", "screen_update_upserts", "element_update_upserts", "api_update_upserts", "predicate_upserts", "predicate_removals", "edge_changes"].includes(key))) {
    throw new Error("FACT_CORRECTION_PATCH_INVALID");
  }
  const allowedScreenFields = new Map(Object.entries(plan.screen_update_fields ?? {}));
  const screenUpdates = new Map(rejectedPatch.screen_updates.map((update) => [update.screen_ref, structuredClone(update)]));
  for (const update of correction.screen_update_upserts ?? []) {
    if (!record(update) || typeof update.screen_ref !== "string" || !allowedScreenFields.has(update.screen_ref)
      || Object.keys(update).some((field) => field !== "screen_ref" && !allowedScreenFields.get(update.screen_ref)!.includes(field as "title"))) {
      throw new Error("FACT_CORRECTION_SCREEN_OUT_OF_SCOPE");
    }
    screenUpdates.set(update.screen_ref, { ...(screenUpdates.get(update.screen_ref) ?? { screen_ref: update.screen_ref }), ...structuredClone(update) });
  }
  const allowedElementFields = new Map(Object.entries(plan.element_update_fields));
  const elementUpdates = new Map(rejectedPatch.element_updates.map((update) => [update.element_ref, structuredClone(update)]));
  for (const update of correction.element_update_upserts) {
    if (!record(update) || typeof update.element_ref !== "string") throw new Error("FACT_CORRECTION_PATCH_INVALID");
    const allowed = allowedElementFields.get(update.element_ref);
    if (!allowed) throw new Error(`FACT_CORRECTION_ELEMENT_OUT_OF_SCOPE:${update.element_ref}`);
    for (const field of Object.keys(update).filter((key) => key !== "element_ref")) {
      if (!allowed.includes(field as "label" | "action_kind")) throw new Error(`FACT_CORRECTION_ELEMENT_FIELD_OUT_OF_SCOPE:${update.element_ref}:${field}`);
    }
    elementUpdates.set(update.element_ref, { ...(elementUpdates.get(update.element_ref) ?? { element_ref: update.element_ref }), ...structuredClone(update) });
  }

  const allowedApiFields = new Map(Object.entries(plan.api_update_fields ?? {}));
  const apiUpdates = new Map(rejectedPatch.api_updates.map((update) => [update.api_ref, structuredClone(update)]));
  for (const update of correction.api_update_upserts ?? []) {
    if (!record(update) || typeof update.api_ref !== "string" || !allowedApiFields.has(update.api_ref)
      || Object.keys(update).some((field) => field !== "api_ref" && !allowedApiFields.get(update.api_ref)!.includes(field as "reads" | "writes"))) {
      throw new Error("FACT_CORRECTION_API_OUT_OF_SCOPE");
    }
    apiUpdates.set(update.api_ref, { ...(apiUpdates.get(update.api_ref) ?? { api_ref: update.api_ref, reads: [], writes: [] }), ...structuredClone(update) });
  }

  const predicateElementRefs = new Set(plan.predicate_element_refs);
  const predicates = new Map(rejectedPatch.predicates.map((predicate) => [predicate.key, structuredClone(predicate)]));
  const allowedPredicateRemovals = new Set(plan.remove_predicate_keys ?? []);
  for (const key of correction.predicate_removals ?? []) {
    if (!allowedPredicateRemovals.has(key) || !predicates.delete(key)) throw new Error(`FACT_CORRECTION_PREDICATE_REMOVAL_OUT_OF_SCOPE:${key}`);
  }
  for (const predicate of correction.predicate_upserts) {
    if (!record(predicate)
      || typeof predicate.key !== "string"
      || !Array.isArray(predicate.evidence_element_refs)
      || !predicate.evidence_element_refs.length
      || predicate.evidence_element_refs.some((ref) => !predicateElementRefs.has(ref))) {
      throw new Error("FACT_CORRECTION_PREDICATE_OUT_OF_SCOPE");
    }
    if ((correction.predicate_removals ?? []).includes(predicate.key)) throw new Error(`FACT_CORRECTION_PREDICATE_REMOVAL_CONFLICT:${predicate.key}`);
    const previous = predicates.get(predicate.key);
    const previousSourceValid = previous && ["code", "db", "assumed"].includes(previous.source);
    if (previousSourceValid && previous.source !== predicate.source) throw new Error(`FACT_CORRECTION_PREDICATE_SOURCE_CHANGED:${predicate.key}`);
    predicates.set(predicate.key, previous ? {
      ...previous,
      source: predicate.source,
      values: [...new Set([...previous.values, ...predicate.values])],
      evidence_element_refs: [...new Set([...previous.evidence_element_refs, ...predicate.evidence_element_refs])],
    } : structuredClone(predicate));
  }

  const replaceIndexes = new Set(plan.replace_edge_indexes);
  const addElementRefs = new Set(plan.add_edge_element_refs);
  const edges = orderedFactEnrichmentEdges(rejectedPatch);
  const changedIndexes = new Set<number>();
  const removedIndexes = new Set<number>();
  for (const change of correction.edge_changes) {
    if (!record(change) || !["replace", "add", "remove"].includes(String(change.operation))) throw new Error("FACT_CORRECTION_PATCH_INVALID");
    if (change.operation === "remove") {
      if (!Number.isInteger(change.edge_index) || !replaceIndexes.has(change.edge_index) || changedIndexes.has(change.edge_index)
        || Object.keys(change).some((key) => !["operation", "edge_index"].includes(key))) {
        throw new Error(`FACT_CORRECTION_EDGE_OUT_OF_SCOPE:${change.edge_index}`);
      }
      removedIndexes.add(change.edge_index);
      changedIndexes.add(change.edge_index);
      continue;
    }
    if (!record(change.edge)) throw new Error("FACT_CORRECTION_PATCH_INVALID");
    const edge = structuredClone(change.edge) as FactEnrichmentPatch["edges"][number];
    if (change.operation === "replace") {
      if (!Number.isInteger(change.edge_index) || !replaceIndexes.has(change.edge_index) || changedIndexes.has(change.edge_index)) {
        throw new Error(`FACT_CORRECTION_EDGE_OUT_OF_SCOPE:${change.edge_index}`);
      }
      const prior = edges[change.edge_index];
      if (!prior || prior.on_element_ref !== edge.on_element_ref) throw new Error(`FACT_CORRECTION_EDGE_IDENTITY_CHANGED:${change.edge_index}: edge ${change.edge_index} must keep on_element_ref ${prior?.on_element_ref ?? "unknown"}`);
      const allowedFields = plan.edge_update_fields?.[String(change.edge_index)];
      if (allowedFields) {
        for (const field of ["source_branch_ref", "kind", "from_screen_ref", "on_element_ref", "to_screen_ref", "guard", "effect"] as const) {
          if (!allowedFields.includes(field) && Object.hasOwn(edge, field) && !isDeepStrictEqual(prior[field], edge[field])) {
            throw new Error(`FACT_CORRECTION_EDGE_FIELD_OUT_OF_SCOPE:${change.edge_index}:${field}`);
          }
        }
        if (allowedFields.some((field) => !["guard", "effect"].includes(field) && !Object.hasOwn(edge, field))) {
          throw new Error(`FACT_CORRECTION_EDGE_AUTHORIZED_FIELD_MISSING:${change.edge_index}`);
        }
        const replacement = structuredClone(prior);
        for (const field of allowedFields) {
          if (!Object.hasOwn(edge, field) && field === "guard") delete replacement.guard;
          else if (!Object.hasOwn(edge, field) && field === "effect") delete replacement.effect;
          else Object.assign(replacement, { [field]: structuredClone(edge[field]) });
        }
        edges[change.edge_index] = replacement;
      } else {
        edges[change.edge_index] = edge;
      }
      changedIndexes.add(change.edge_index);
    } else {
      if (!addElementRefs.has(edge.on_element_ref)) throw new Error(`FACT_CORRECTION_EDGE_ADD_OUT_OF_SCOPE:${edge.on_element_ref}`);
      edges.push(edge);
    }
  }

  const merged: FactEnrichmentPatch = {
    schema_version: 2,
    screen_updates: [...screenUpdates.values()].sort((left, right) => left.screen_ref.localeCompare(right.screen_ref)),
    element_updates: [...elementUpdates.values()].sort((left, right) => left.element_ref.localeCompare(right.element_ref)),
    api_updates: [...apiUpdates.values()].sort((left, right) => left.api_ref.localeCompare(right.api_ref)),
    predicates: [...predicates.values()].sort((left, right) => left.key.localeCompare(right.key)),
    edges: edges.filter((_, index) => !removedIndexes.has(index))
      .sort((left, right) => `${left.from_screen_ref}:${left.on_element_ref}:${left.source_branch_ref ?? ""}:${left.to_screen_ref}:${left.kind}`.localeCompare(`${right.from_screen_ref}:${right.on_element_ref}:${right.source_branch_ref ?? ""}:${right.to_screen_ref}:${right.kind}`)),
  };
  const normalizedMerged = normalizePatch(merged);
  assertPatch(normalizedMerged);
  return normalizedMerged;
}

const factEdgeSignature = (edge: FactBundle["edges"][number]): string => JSON.stringify({
  source_branch_ref: edge.source_branch_ref,
  kind: edge.kind,
  from: edge.from,
  on: edge.on,
  guard: edge.guard,
  effect: edge.effect,
  to: edge.to,
});

function predicateClauses(expression: string | undefined): Array<{ predId: string; value: string }> {
  return expression?.split(" && ").map((clause) => {
    const separator = clause.indexOf("=");
    if (separator < 1) throw new Error("FACT_TRANSITION_CORRECTION_PREDICATE_INVALID");
    return { predId: clause.slice(0, separator), value: clause.slice(separator + 1) };
  }) ?? [];
}

export function mergeFactTransitionCorrection(
  base: FactBundle,
  candidate: FactBundle,
  targetElementIds: readonly string[],
): FactBundle {
  if (base.project_id !== candidate.project_id
    || base.analysis_run_id !== candidate.analysis_run_id
    || base.source_snapshot_id !== candidate.source_snapshot_id) throw new Error("FACT_TRANSITION_CORRECTION_IDENTITY_INVALID");
  const targets = new Set(targetElementIds);
  if (!targets.size) throw new Error("FACT_TRANSITION_CORRECTION_TARGETS_EMPTY");
  const baseElements = new Map(base.screens.flatMap((screen) => screen.elements.map((element) => [element.id, element] as const)));
  const candidateElements = new Map(candidate.screens.flatMap((screen) => screen.elements.map((element) => [element.id, element] as const)));
  for (const target of targets) {
    if (!baseElements.has(target) || !candidateElements.has(target)) throw new Error(`FACT_TRANSITION_CORRECTION_TARGET_INVALID:${target}`);
  }

  const baseSignatures = new Set(base.edges.map(factEdgeSignature));
  if (base.edges.some((edge) => !candidate.edges.some((candidateEdge) => factEdgeSignature(candidateEdge) === factEdgeSignature(edge)))) {
    throw new Error("FACT_TRANSITION_CORRECTION_BASE_EDGE_CHANGED");
  }
  if (candidate.edges.some((edge) => !targets.has(edge.on) && !baseSignatures.has(factEdgeSignature(edge)))) {
    throw new Error("FACT_TRANSITION_CORRECTION_EDGE_OUT_OF_SCOPE");
  }
  const additions = candidate.edges
    .filter((edge) => targets.has(edge.on) && !baseSignatures.has(factEdgeSignature(edge)))
    .sort((left, right) => factEdgeSignature(left).localeCompare(factEdgeSignature(right)));
  if (!additions.length) throw new Error("FACT_TRANSITION_CORRECTION_NO_EDGE_ADDED");

  const merged = structuredClone(base);
  const mergedElements = new Map(merged.screens.flatMap((screen) => screen.elements.map((element) => [element.id, element] as const)));
  for (const target of targets) {
    mergedElements.get(target)!.interaction.action_kind = candidateElements.get(target)!.interaction.action_kind;
  }

  const candidatePredicates = new Map(candidate.predicates.map((predicate) => [predicate.pred_id, predicate]));
  const mergedPredicates = new Map(merged.predicates.map((predicate) => [predicate.pred_id, predicate]));
  for (const { predId, value } of additions.flatMap((edge) => [...predicateClauses(edge.guard), ...predicateClauses(edge.effect)])) {
    const candidatePredicate = candidatePredicates.get(predId);
    if (!candidatePredicate || !candidatePredicate.values.includes(value)) throw new Error(`FACT_TRANSITION_CORRECTION_PREDICATE_MISSING:${predId}`);
    const existing = mergedPredicates.get(predId);
    if (!existing) {
      const added = structuredClone(candidatePredicate);
      merged.predicates.push(added);
      mergedPredicates.set(predId, added);
    } else {
      if (existing.source !== candidatePredicate.source) throw new Error(`FACT_TRANSITION_CORRECTION_PREDICATE_SOURCE_CHANGED:${predId}`);
      existing.values = [...new Set([...existing.values, value])];
      existing.evidence = uniqueEvidence([...existing.evidence, ...candidatePredicate.evidence]);
    }
  }
  merged.predicates.sort((left, right) => left.pred_id.localeCompare(right.pred_id));
  additions.forEach((edge, index) => {
    const added = structuredClone(edge);
    added.edge_id = edgeId(base.edges.length + index + 1);
    added.evidence = structuredClone(mergedElements.get(added.on)!.evidence);
    merged.edges.push(added);
  });
  return merged;
}

export function createFactTransitionCorrectionDraft(base: FactBundle): FactBundle {
  const draft = structuredClone(base);
  draft.edges = [];
  draft.predicates = [];
  for (const element of draft.screens.flatMap((screen) => screen.elements)) {
    element.interaction.action_kind = "unresolved";
  }
  return draft;
}

export function createFactEnrichmentDraftView(draft: FactBundle, snapshot?: SourceSnapshot): FactEnrichmentDraftView {
  const paths = new Map(snapshot?.files.map((file) => [file.source_id, file.path]) ?? []);
  const elementAnchors = new Map<string, { path: string; line: number }>();
  const apiAnchors = new Map<string, { path: string; line: number }>();
  snapshot?.interactions.forEach((interaction) => {
    const path = paths.get(interaction.source_id);
    if (path) elementAnchors.set(interaction.element_id, { path, line: interaction.line });
  });
  snapshot?.apis.forEach((api) => {
    const path = paths.get(api.source_id);
    if (path) apiAnchors.set(api.api_id, { path, line: api.line });
  });
  return {
    screens: factReferences(draft).map((screen) => ({
      screen_ref: screen.ref,
      ...(screen.value.route ? { route: screen.value.route } : {}),
      title: screen.value.title,
      elements: screen.elements.map((element) => ({ element_ref: element.ref, type: element.value.type, label: element.value.label, interaction: structuredClone(element.value.interaction), ...(elementAnchors.has(element.value.id) ? { source_anchor: elementAnchors.get(element.value.id)! } : {}) })),
      apis: screen.apis.map((api) => ({ api_ref: api.ref, reads: [...api.value.reads], writes: [...api.value.writes], ...(apiAnchors.has(api.value.id) ? { source_anchor: apiAnchors.get(api.value.id)! } : {}) })),
    })),
  };
}

function evidenceFor(evidence: readonly EvidenceReference[], sourceId: string, line: number): EvidenceReference {
  const candidates = evidence
    .filter((entry) => entry.source_id === sourceId && entry.start_line <= line && entry.end_line >= line)
    .sort((left, right) => (left.end_line - left.start_line) - (right.end_line - right.start_line) || left.start_line - right.start_line);
  if (!candidates.length) throw new Error("FACT_DRAFT_EVIDENCE_MISSING");
  return structuredClone(candidates[0]);
}

function surfaceKind(snapshot: SourceSnapshot): "web" | "desktop" | "mobile" | "unknown" {
  if (snapshot.ui_stacks.some((stack) => ["react", "vue", "svelte"].includes(stack))) return "web";
  if (snapshot.ui_stacks.some((stack) => ["android", "swiftui"].includes(stack))) return "mobile";
  if (snapshot.ui_stacks.some((stack) => ["dotnet-desktop", "wpf", "winui"].includes(stack))) return "desktop";
  return "unknown";
}

function factDraftSourceLayout(snapshot: SourceSnapshot) {
  const files = new Map(snapshot.files.map((file) => [file.source_id, file]));
  const routesBySource = new Map<string, SourceSnapshot["routes"]>();
  snapshot.routes.forEach((route) => routesBySource.set(route.source_id, [...(routesBySource.get(route.source_id) ?? []), route]));
  const screenForSource = (sourceId: string): string => {
    const routes = routesBySource.get(sourceId) ?? [];
    if (routes.length === 1) return routes[0].screen_id;
    const file = files.get(sourceId);
    if (!file) throw new Error("FACT_DRAFT_SOURCE_MISSING");
    return screenId(file.path.replace(/\.[^.]+$/, ""));
  };
  return { files, screenForSource };
}

export function createFactDraftPartitionPlans(snapshot: SourceSnapshot): FactDraftPartitionPlan[] {
  const { screenForSource } = factDraftSourceLayout(snapshot);
  const screens = new Map<string, { elementIds: string[]; apiIds: string[] }>();
  const ensure = (id: string) => {
    const existing = screens.get(id);
    if (existing) return existing;
    const created = { elementIds: [], apiIds: [] };
    screens.set(id, created);
    return created;
  };
  snapshot.routes.forEach((route) => ensure(route.screen_id));
  const seenElements = new Set<string>();
  for (const interaction of [...snapshot.interactions].sort((left, right) => left.element_id.localeCompare(right.element_id) || left.line - right.line)) {
    if (seenElements.has(interaction.element_id)) continue;
    seenElements.add(interaction.element_id);
    ensure(interaction.screen_id ?? screenForSource(interaction.source_id)).elementIds.push(interaction.element_id);
  }
  const seenApis = new Set<string>();
  for (const api of [...snapshot.apis].sort((left, right) => left.api_id.localeCompare(right.api_id) || left.line - right.line)) {
    if (seenApis.has(api.api_id)) continue;
    seenApis.add(api.api_id);
    ensure(api.screen_id ?? screenForSource(api.source_id)).apiIds.push(api.api_id);
  }
  return [...screens.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([screenIdValue, entries], index) => ({
      screen_ref: `S${index + 1}`,
      screen_id: screenIdValue,
      element_ids: entries.elementIds,
      api_ids: entries.apiIds,
    }));
}

function compileDeterministicFactDraft(snapshot: SourceSnapshot, evidence: readonly EvidenceReference[]): FactBundle {
  if (evidence.some((entry) => entry.source_snapshot_id !== snapshot.source_snapshot_id)) throw new Error("FACT_DRAFT_EVIDENCE_SCOPE_INVALID");
  const identity = { project_id: snapshot.project_id, analysis_run_id: snapshot.analysis_run_id, source_snapshot_id: snapshot.source_snapshot_id };
  const { files, screenForSource } = factDraftSourceLayout(snapshot);
  const shellByContainedScreen = new Map((snapshot.shells ?? []).flatMap((shell) =>
    shell.contained_screen_ids.map((contained) => [contained, shell.shell_screen_id] as const)));
  const screens = new Map<string, FactBundle["screens"][number]>();
  const ensureScreen = (id: string, sourceId: string): FactBundle["screens"][number] => {
    const existing = screens.get(id);
    if (existing) return existing;
    const route = snapshot.routes.find((entry) => entry.screen_id === id);
    const file = files.get(sourceId);
    const fileTitle = file?.path.split("/").at(-1)?.replace(/\.[^.]+$/, "").replace(/\.page$/, "") ?? id;
    const created: FactBundle["screens"][number] = {
      schema_version: 3,
      ...identity,
      screen_id: id,
      ...(route ? { route: route.route } : {}),
      title: route?.route || fileTitle,
      ...(shellByContainedScreen.has(id) ? { shell_screen_id: shellByContainedScreen.get(id)! } : {}),
      entry_guards: [],
      elements: [],
      apis: [],
      feedback: [],
      displays: [],
      status: "draft",
    };
    screens.set(id, created);
    return created;
  };

  snapshot.routes.forEach((route) => ensureScreen(route.screen_id, route.source_id));
  const seenElements = new Set<string>();
  for (const interaction of [...snapshot.interactions].sort((left, right) => left.element_id.localeCompare(right.element_id) || left.line - right.line)) {
    if (seenElements.has(interaction.element_id)) continue;
    seenElements.add(interaction.element_id);
    const targetScreenId = interaction.screen_id ?? screenForSource(interaction.source_id);
    ensureScreen(targetScreenId, interaction.source_id).elements.push({
      id: interaction.element_id,
      type: interaction.kind,
      label: interaction.label?.trim() || interaction.kind,
      interaction: { action_kind: "unresolved", surface_kind: surfaceKind(snapshot), target_candidates: structuredClone(interaction.target_candidates) },
      evidence: [evidenceFor(evidence, interaction.source_id, interaction.line)],
    });
  }

  const seenApis = new Set<string>();
  for (const api of [...snapshot.apis].sort((left, right) => left.api_id.localeCompare(right.api_id) || left.line - right.line)) {
    if (seenApis.has(api.api_id)) continue;
    seenApis.add(api.api_id);
    const targetScreen = ensureScreen(api.screen_id ?? screenForSource(api.source_id), api.source_id);
    const operation = `${api.method.toUpperCase()} ${api.path}`;
    targetScreen.apis.push({ id: api.api_id, reads: ["GET", "HEAD"].includes(api.method.toUpperCase()) ? [operation] : [], writes: ["GET", "HEAD"].includes(api.method.toUpperCase()) ? [] : [operation], evidence: [evidenceFor(evidence, api.source_id, api.line)] });
  }

  for (const screen of screens.values()) {
    screen.elements.sort((left, right) => left.id.localeCompare(right.id));
    screen.apis.sort((left, right) => left.id.localeCompare(right.id));
  }
  return { schema_version: 2, ...identity, screens: [...screens.values()].sort((left, right) => left.screen_id.localeCompare(right.screen_id)), edges: [], predicates: [] };
}

export function createDeterministicFactDraftFromEvidence(snapshot: SourceSnapshot, evidence: readonly EvidenceReference[]): FactBundle {
  return compileDeterministicFactDraft(snapshot, evidence);
}

export function createDeterministicFactDraft(snapshot: SourceSnapshot, grant: EvidenceGrant): FactBundle {
  if (grant.project_id !== snapshot.project_id || grant.source_snapshot_id !== snapshot.source_snapshot_id) throw new Error("FACT_DRAFT_GRANT_SCOPE_INVALID");
  return compileDeterministicFactDraft(snapshot, grant.evidence);
}

function assertPatch(patch: unknown): asserts patch is FactEnrichmentPatch {
  if (!record(patch) || patch.schema_version !== 2 || !Array.isArray(patch.screen_updates) || !Array.isArray(patch.element_updates) || !Array.isArray(patch.api_updates) || !Array.isArray(patch.predicates) || !Array.isArray(patch.edges)) throw new Error("FACT_PATCH_SCHEMA_INVALID");
  if (patch.screen_updates.some((entry) => !record(entry) || typeof entry.screen_ref !== "string" || (entry.title !== undefined && typeof entry.title !== "string"))) throw new Error("FACT_PATCH_SCHEMA_INVALID");
  if (patch.element_updates.some((entry) => !record(entry) || typeof entry.element_ref !== "string" || (entry.label !== undefined && typeof entry.label !== "string") || (entry.action_kind !== undefined && typeof entry.action_kind !== "string"))) throw new Error("FACT_PATCH_SCHEMA_INVALID");
  if (patch.api_updates.some((entry) => !record(entry) || typeof entry.api_ref !== "string" || !strings(entry.reads) || !strings(entry.writes))) throw new Error("FACT_PATCH_SCHEMA_INVALID");
  if (patch.predicates.some((entry) => !record(entry) || typeof entry.key !== "string" || !entry.key.trim() || !strings(entry.values) || !["code", "db", "assumed"].includes(String(entry.source)) || !strings(entry.evidence_element_refs))) throw new Error("FACT_PATCH_SCHEMA_INVALID");
  if (patch.edges.some((entry) => !record(entry) || !["normal", "exception"].includes(String(entry.kind)) || typeof entry.from_screen_ref !== "string" || typeof entry.on_element_ref !== "string" || typeof entry.to_screen_ref !== "string" || (entry.source_branch_ref !== undefined && (typeof entry.source_branch_ref !== "string" || !/^(?:normal|exception):[1-9]\d*$/.test(entry.source_branch_ref))) || (entry.effect !== undefined && !patchGuard(entry.effect)) || (entry.guard !== undefined && !patchGuard(entry.guard)))) throw new Error("FACT_PATCH_SCHEMA_INVALID");
}

function normalizePredicates(entries: unknown[]): unknown[] {
  const normalized = entries.map((entry) => record(entry) && Array.isArray(entry.values)
    ? {
        ...entry,
        values: entry.values.map((value) => value === null ? "null" : value),
      }
    : entry);
  const merged: unknown[] = [];
  const firstByKey = new Map<string, { index: number; source: string }>();

  for (const entry of normalized) {
    if (!record(entry)
      || typeof entry.key !== "string"
      || !entry.key.trim()
      || !["code", "db", "assumed"].includes(String(entry.source))
      || !strings(entry.values)
      || !strings(entry.evidence_element_refs)) {
      merged.push(entry);
      continue;
    }
    const existing = firstByKey.get(entry.key);
    if (!existing) {
      firstByKey.set(entry.key, { index: merged.length, source: String(entry.source) });
      merged.push(entry);
      continue;
    }
    if (existing.source !== entry.source) {
      merged.push(entry);
      continue;
    }
    const prior = merged[existing.index] as Record<string, unknown>;
    merged[existing.index] = {
      ...prior,
      values: [...new Set([...(prior.values as string[]), ...entry.values])],
      evidence_element_refs: [...new Set([...(prior.evidence_element_refs as string[]), ...entry.evidence_element_refs])],
    };
  }
  return merged;
}

function normalizePredicateExpression(value: unknown): unknown {
  const normalizeClause = (clause: unknown): unknown => record(clause)
    && clause.predicate_key === undefined
    && typeof clause.key === "string"
    && typeof clause.value === "string"
    && Object.keys(clause).every((key) => ["key", "value"].includes(key))
    ? { predicate_key: clause.key, value: clause.value }
    : clause;
  if (!record(value) || !Array.isArray(value.all)) return normalizeClause(value);
  return { ...value, all: value.all.map(normalizeClause) };
}

function normalizePatch(patch: unknown): unknown {
  if (!record(patch)) return patch;
  return {
    ...patch,
    ...(Array.isArray(patch.api_updates) ? {
      api_updates: patch.api_updates.map((entry) => record(entry)
        ? {
            ...entry,
            ...(entry.reads === null ? { reads: [] } : {}),
            ...(entry.writes === null ? { writes: [] } : {}),
          }
        : entry),
    } : {}),
    ...(Array.isArray(patch.predicates) ? {
      predicates: normalizePredicates(patch.predicates),
    } : {}),
    ...(Array.isArray(patch.edges) ? {
      edges: patch.edges.map((entry) => {
        if (!record(entry)) return entry;
        let normalizedEdge = {
          ...entry,
          ...(entry.guard !== undefined ? { guard: normalizePredicateExpression(entry.guard) } : {}),
          ...(entry.effect !== undefined ? { effect: normalizePredicateExpression(entry.effect) } : {}),
        };
        if (record(normalizedEdge.guard) && Array.isArray(normalizedEdge.guard.all) && normalizedEdge.guard.all.length === 0) {
          const { guard: _emptyGuard, ...withoutEmptyGuard } = normalizedEdge;
          normalizedEdge = withoutEmptyGuard;
        }
        if (record(normalizedEdge.effect) && Array.isArray(normalizedEdge.effect.all) && normalizedEdge.effect.all.length === 0) {
          const { effect: _emptyEffect, ...withoutEmptyEffect } = normalizedEdge;
          normalizedEdge = withoutEmptyEffect;
        }
        return normalizedEdge;
      }),
    } : {}),
  };
}

function uniqueEvidence(references: EvidenceReference[]): EvidenceReference[] {
  return [...new Map(references.map((entry) => [`${entry.evidence_grant_id}:${entry.source_id}:${entry.start_line}:${entry.end_line}:${entry.content_hash}`, entry])).values()];
}

export function validateFactEnrichmentPatchReferences(
  draft: FactBundle,
  patch: FactEnrichmentPatch,
): ValidationIssue[] {
  const references = factReferences(draft);
  const screens = new Set(references.map((screen) => screen.ref));
  const elements = new Set(references.flatMap((screen) => screen.elements.map((element) => element.ref)));
  const apis = new Set(references.flatMap((screen) => screen.apis.map((api) => api.ref)));
  const predicates = new Map(patch.predicates.map((predicate) => [predicate.key, new Set(predicate.values)]));
  const issues: ValidationIssue[] = [];
  const issue = (path: string, message: string): void => {
    issues.push({ code: "FACT_PATCH_REFERENCE_INVALID", severity: "error", path, message });
  };

  patch.screen_updates.forEach((update, index) => {
    if (!screens.has(update.screen_ref)) issue(`screen_updates.${index}.screen_ref`, `Screen update ${index} references unknown screen ${update.screen_ref}.`);
  });
  patch.element_updates.forEach((update, index) => {
    if (!elements.has(update.element_ref)) issue(`element_updates.${index}.element_ref`, `Element update ${index} references unknown element ${update.element_ref}.`);
  });
  patch.api_updates.forEach((update, index) => {
    if (!apis.has(update.api_ref)) issue(`api_updates.${index}.api_ref`, `API update ${index} references unknown API ${update.api_ref}.`);
  });
  patch.predicates.forEach((predicate, predicateIndex) => {
    predicate.evidence_element_refs.forEach((elementRef, evidenceIndex) => {
      if (!elements.has(elementRef)) issue(`predicates.${predicateIndex}.evidence_element_refs.${evidenceIndex}`, `Predicate ${predicate.key} references unknown evidence element ${elementRef}.`);
    });
  });
  const predicateKeysById = new Map<string, string>();
  patch.predicates.forEach((predicate, predicateIndex) => {
    const id = predicateId(predicate.key);
    const previousKey = predicateKeysById.get(id);
    if (previousKey) {
      issues.push({
        code: "FACT_PATCH_PREDICATE_ID_COLLISION",
        severity: "error",
        path: `predicates.${predicateIndex}.key`,
        message: `Predicate key ${predicate.key} collides with ${previousKey} after canonical ID compilation.`,
      });
    } else {
      predicateKeysById.set(id, predicate.key);
    }
  });
  orderedFactEnrichmentEdges(patch).forEach((edge, edgeIndex) => {
    if (!screens.has(edge.from_screen_ref)) issue(`edges.${edgeIndex}.from_screen_ref`, `Edge ${edgeIndex} references unknown source screen ${edge.from_screen_ref}.`);
    if (!elements.has(edge.on_element_ref)) issue(`edges.${edgeIndex}.on_element_ref`, `Edge ${edgeIndex} references unknown trigger element ${edge.on_element_ref}.`);
    if (!screens.has(edge.to_screen_ref)) issue(`edges.${edgeIndex}.to_screen_ref`, `Edge ${edgeIndex} references unknown target screen ${edge.to_screen_ref}.`);
    for (const field of ["guard", "effect"] as const) {
      const expression = edge[field];
      if (!expression) continue;
      for (const clause of "all" in expression ? expression.all : [expression]) {
        const values = predicates.get(clause.predicate_key);
        if (!values) {
          issue(`edges.${edgeIndex}.${field}`, `Edge ${edgeIndex} ${field} references unknown predicate key ${clause.predicate_key}.`);
        } else if (!values.has(clause.value)) {
          issue(`edges.${edgeIndex}.${field}`, `Edge ${edgeIndex} ${field} references unregistered value ${clause.predicate_key}=${clause.value}.`);
        }
      }
    }
  });
  return issues;
}

export function applyFactEnrichmentPatch(draft: FactBundle, patch: FactEnrichmentPatch): FactBundle {
  const normalizedPatch = normalizePatch(patch);
  assertPatch(normalizedPatch);
  patch = normalizedPatch;
  const compiled = structuredClone(draft);
  const references = factReferences(compiled);
  const screens = new Map(references.map((screen) => [screen.ref, screen.value]));
  const elements = new Map(references.flatMap((screen) => screen.elements.map((element) => [element.ref, element.value] as const)));
  const apis = new Map(references.flatMap((screen) => screen.apis.map((api) => [api.ref, api.value] as const)));
  const referenceError = (kind: string, value: string): never => { throw new Error(`FACT_PATCH_REFERENCE_INVALID:${kind}:${value}`); };
  const resolveReference = <T>(values: Map<string, T>, kind: string, ref: string): T => values.get(ref) ?? referenceError(kind, ref);

  for (const update of patch.screen_updates) {
    const screen = resolveReference(screens, "screen_ref", update.screen_ref);
    if (update.title !== undefined) {
      if (!update.title.trim()) throw new Error("FACT_PATCH_SCHEMA_INVALID");
      screen.title = update.title;
    }
  }
  for (const update of patch.element_updates) {
    const element = resolveReference(elements, "element_ref", update.element_ref);
    if (update.label !== undefined) {
      if (!update.label.trim()) throw new Error("FACT_PATCH_SCHEMA_INVALID");
      element.label = update.label;
    }
    if (update.action_kind !== undefined) {
      if (!update.action_kind.trim()) throw new Error("FACT_PATCH_SCHEMA_INVALID");
      element.interaction.action_kind = update.action_kind;
    }
  }
  for (const update of patch.api_updates) {
    const api = resolveReference(apis, "api_ref", update.api_ref);
    api.reads = [...update.reads];
    api.writes = [...update.writes];
  }

  const predicatesByKey = new Map<string, FactBundle["predicates"][number]>();
  for (const proposal of patch.predicates) {
    const citedElements = proposal.evidence_element_refs.map((ref) => elements.get(ref));
    if (!citedElements.length) referenceError("evidence_element_refs", "empty");
    const invalidElementRef = proposal.evidence_element_refs.find((ref) => !elements.has(ref));
    if (invalidElementRef) referenceError("element_ref", invalidElementRef);
    const id = predicateId(proposal.key);
    if (predicatesByKey.has(proposal.key) || [...predicatesByKey.values()].some((predicate) => predicate.pred_id === id)) throw new Error("FACT_PATCH_SCHEMA_INVALID");
    predicatesByKey.set(proposal.key, { schema_version: 2, project_id: compiled.project_id, analysis_run_id: compiled.analysis_run_id, source_snapshot_id: compiled.source_snapshot_id, pred_id: id, values: [...proposal.values], source: proposal.source, evidence: uniqueEvidence(citedElements.flatMap((element) => element!.evidence)) });
  }
  compiled.predicates = [...predicatesByKey.values()].sort((left, right) => left.pred_id.localeCompare(right.pred_id));

  const edgeProposals = orderedFactEnrichmentEdges(patch);
  const predicateClauses = edgeProposals.flatMap((proposal) => [proposal.guard, proposal.effect].flatMap((expression) => {
    if (!expression) return [];
    return "all" in expression ? expression.all : [expression];
  }));
  const missingPredicateKeys = [...new Set(predicateClauses
    .filter((clause) => !predicatesByKey.has(clause.predicate_key))
    .map((clause) => clause.predicate_key))];
  if (missingPredicateKeys.length) referenceError("predicate_key", missingPredicateKeys.join(","));
  const invalidPredicateValues = [...new Set(predicateClauses
    .filter((clause) => !predicatesByKey.get(clause.predicate_key)!.values.includes(clause.value))
    .map((clause) => `${clause.predicate_key}=${clause.value}`))];
  if (invalidPredicateValues.length) referenceError("predicate_value", invalidPredicateValues.join(","));
  compiled.edges = edgeProposals.map((proposal, index) => {
    const from = resolveReference(screens, "screen_ref", proposal.from_screen_ref);
    const to = resolveReference(screens, "screen_ref", proposal.to_screen_ref);
    const element = resolveReference(elements, "element_ref", proposal.on_element_ref);
    const compilePredicateExpression = (expression: NonNullable<typeof proposal.guard>): string => {
      const clauses = "all" in expression ? expression.all : [expression];
      if (!clauses.length) throw new Error("FACT_PATCH_SCHEMA_INVALID");
      return clauses.map((clause) => {
        const predicate = resolveReference(predicatesByKey, "predicate_key", clause.predicate_key);
        if (!predicate.values.includes(clause.value)) referenceError("predicate_value", clause.value);
        return `${predicate.pred_id}=${clause.value}`;
      }).join(" && ");
    };
    const guard = proposal.guard ? compilePredicateExpression(proposal.guard) : undefined;
    const effect = proposal.effect ? compilePredicateExpression(proposal.effect) : undefined;
    return { schema_version: 2, project_id: compiled.project_id, analysis_run_id: compiled.analysis_run_id, source_snapshot_id: compiled.source_snapshot_id, edge_id: edgeId(index + 1), ...(proposal.source_branch_ref ? { source_branch_ref: proposal.source_branch_ref } : {}), kind: proposal.kind, from: from.screen_id, on: element.id, ...(guard ? { guard } : {}), ...(effect ? { effect } : {}), to: to.screen_id, feedback: [], evidence: structuredClone(element.evidence), status: "draft" };
  });
  const journeyElementIds = new Set(compiled.edges.map((edge) => edge.on));
  for (const screen of compiled.screens) {
    for (const element of screen.elements) {
      if (!journeyElementIds.has(element.id)) element.interaction.action_kind = "unresolved";
    }
  }
  return compiled;
}
