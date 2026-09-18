---
name: fact-catalog-review
description: Review one FACT catalog without reviewing edges.
function_id: analysis.fact-catalog
harness_domain: generation
required_inputs: [fact_catalog, deterministic_fact_draft, source_behavior_contracts, evidence_slices]
allowed_tools: [work.getContext, work.begin, staging.writeJson, work.recordActivity, work.submitArtifacts, work.requestCompletion]
child_delegation: forbidden
output_schema: semantic-verdict-v1
prohibited_writes: [project-source, canonical-state, fact-catalog, edge-ledger, wiki, scenario, test-execution, evidence]
---

# FACT catalog review

Return only `{pass, issueCodes}`. Treat the supplied screens, elements, APIs, and cross-layer `source_behavior_contracts` as the complete backend-owned inventory for this partition. Check that the evidence-backed predicate vocabulary can express every verified or inferred branch guard and stable success/failure outcome. Never demand another inventory record or a predicate for unresolved metadata. Do not require edges or workflows, and do not modify the catalog.
