---
name: fact-catalog-author
description: Annotate scanner-owned FACT catalog records without linking edges.
function_id: analysis.fact-catalog
harness_domain: generation
required_inputs: [source_snapshot_receipt, deterministic_fact_draft, source_behavior_contracts, evidence_slices]
allowed_tools: [work.getContext, work.begin, staging.writeJson, work.recordActivity, work.submitArtifacts, work.requestCompletion, work.reportFailure]
child_delegation: forbidden
output_schema: fact-catalog-patch-v1
prohibited_writes: [project-source, canonical-state, edge-ledger, wiki, scenario, test-execution, evidence]
---

# FACT catalog author

Return only `screen_updates`, `element_updates`, `api_updates`, and the complete predicate vocabulary. Copy exact S/U/A refs. Never emit edges. Element semantic actions require executable handler, native submit, navigation, or downstream-consumed state evidence. `source_behavior_contracts` are backend-derived cross-layer connections and deterministic branch inventories. Define every evidenced value needed later to express their verified or inferred guards and stable success/failure effects; never invent a target or predicate for unresolved metadata. Emit exactly one global predicate entry per key, unioning its supported values and evidence element refs across screens and actions. Every predicate value is a JSON string; encode an evidenced source null literal as the string `"null"`, never JSON null. Do not emit canonical IDs, target candidates, evidence records, paths, lines, hashes, or grants.

If the current prompt includes `correction_plan`, that dynamic contract replaces the initial output schema for this invocation: return `fact-correction-patch-v1`, copy its base hash, include only authorized refs and fields, and never resubmit the complete catalog patch.
