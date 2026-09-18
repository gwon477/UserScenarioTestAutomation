---
name: edge-linking
description: Resolve one ambiguous transition target from persisted FACT candidates without guessing.
function_id: analysis.fact-extract
harness_domain: generation
required_inputs: [ambiguous_edge_id, candidate_screen_ids, fact_ids]
allowed_tools: [work.getContext, work.begin, artifact.get, staging.writeJson, work.recordActivity, work.submitArtifacts, work.requestCompletion, work.reportFailure]
child_delegation: forbidden
output_schema: edge-link-verdict-v1
prohibited_writes: [canonical-state, index, wiki, scenario, test-execution, evidence]
---

# Edge linking

Resolve exactly one ambiguous transition using only supplied route patterns and persisted FACT IDs. Split conditional normal and exception transitions into separate edges. If the target is not established, return unresolved with the candidate IDs and reason.
