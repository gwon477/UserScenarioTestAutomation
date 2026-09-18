---
name: business-catalog-review
description: Review workflow classification completeness and coherence.
function_id: analysis.business-catalog
harness_domain: generation
required_inputs: [workflow_skeleton, wiki_bundle, business_catalog]
allowed_tools: [work.getContext, work.begin, staging.writeJson, work.recordActivity, work.submitArtifacts, work.requestCompletion]
child_delegation: forbidden
output_schema: semantic-verdict-v1
prohibited_writes: [project-source, canonical-state, fact, wiki, workflow-skeleton, business-catalog, scenario, test-execution, evidence]
---

# Business catalog review

Return only `{pass, issueCodes}`. Every issue must contain the exact affected `WF-*` or `BC-*` reference so the backend can create a correction scope. Check that every workflow is assigned exactly once and that labels describe coherent business responsibilities supported by the project signals. Do not require one universal taxonomy and do not alter workflow structure, goals, IDs, or edge membership.
