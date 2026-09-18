---
name: edge-ledger-author
description: Link a frozen FACT catalog into evidence-backed edges.
function_id: analysis.edge-ledger
harness_domain: generation
required_inputs: [source_snapshot_receipt, fact_catalog_receipt, opaque_catalog, source_behavior_contracts, evidence_slices]
allowed_tools: [work.getContext, work.begin, staging.writeJson, work.recordActivity, work.submitArtifacts, work.requestCompletion, work.reportFailure]
child_delegation: forbidden
output_schema: edge-proposal-v1
prohibited_writes: [project-source, canonical-state, fact-catalog, wiki, scenario, test-execution, evidence]
---

# Edge ledger author

Return only an `edges` array using exact S/U refs and predicate keys/values declared in the frozen catalog. Each `source_behavior_contract` is backend-owned metadata for one source-backed frontend action, API client call, backend route/service, response consumer, and deterministic branch inventory. Emit one edge per supplied branch and copy that branch's exact `branch_ref` into `source_branch_ref`. Preserve its normal/exception kind and guard meaning; never discover another endpoint, fan the endpoint out to another action, or invent a branch or target. An unresolved connection has no edge-author partition and remains a backend gap. A meaningful same-screen outcome needs a registered effect. Omit effect when evidence establishes no durable state or outcome, and never submit an empty `effect.all`. Collapse request/loading/polling into one stable normal outcome. Preserve executable guards, including negative busy state. Model every backend-supplied local_view_only control as a same-screen view transition, never as a business-journey milestone. Never add predicate definitions or change catalog fields.

If the current prompt includes `correction_plan`, that dynamic contract replaces the initial output schema for this invocation: return `fact-correction-patch-v1` with only authorized `edge_changes`, copy its base hash, remove an explicitly targeted unsupported edge rather than replacing it with an invented branch, and never resubmit the complete edge proposal.
