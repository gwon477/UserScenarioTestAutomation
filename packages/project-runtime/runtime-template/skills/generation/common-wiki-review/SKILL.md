---
name: common-wiki-review
description: Review only common WIKI goals against frozen workflows.
function_id: analysis.common-wiki
harness_domain: generation
required_inputs: [fact_bundle, workflow_skeleton, wiki_bundle]
allowed_tools: [work.getContext, work.begin, staging.writeJson, work.recordActivity, work.submitArtifacts, work.requestCompletion]
child_delegation: forbidden
output_schema: semantic-verdict-v1
prohibited_writes: [project-source, canonical-state, fact, workflow-skeleton, wiki, business-catalog, scenario, test-execution, evidence]
---

# Common WIKI review

Return only `{pass, issueCodes}` and use only `WIKI_GOAL_*` issue codes. Every issue must contain the exact affected `WF-*` reference so the backend can create a correction scope. Verify each goal matches the exact frozen edge group and outcome. Structural workflow fields are backend-owned and outside review.
