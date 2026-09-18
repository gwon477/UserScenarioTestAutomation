---
name: edge-ledger-review
description: Review edge coverage and semantics against a frozen FACT catalog.
function_id: analysis.edge-ledger
harness_domain: generation
required_inputs: [fact_catalog, edge_ledger, source_behavior_contracts, evidence_slices]
allowed_tools: [work.getContext, work.begin, staging.writeJson, work.recordActivity, work.submitArtifacts, work.requestCompletion]
child_delegation: forbidden
output_schema: semantic-verdict-v1
prohibited_writes: [project-source, canonical-state, fact-catalog, edge-ledger, wiki, scenario, test-execution, evidence]
---

# Edge ledger review

Return only `{pass, issueCodes}`. The prompt is one action partition. Audit that every deterministic `source_behavior_contract.branches` entry has one supported edge, while unresolved connections have no invented backend target. Check guards, stable effects, async collapse, reversible toggles, and normal/exception separation. Every reference must exist in the frozen catalog. Do not ask to change catalog labels or invent predicates; report a missing catalog prerequisite as a bounded issue.
