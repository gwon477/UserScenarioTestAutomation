---
name: scenario-narration-review
description: Review scenario narration against immutable skeletons.
function_id: analysis.scenario-narration
harness_domain: generation
required_inputs: [scenario_skeleton, wiki_bundle, scenario_set]
allowed_tools: [work.getContext, work.begin, staging.writeJson, work.recordActivity, work.submitArtifacts, work.requestCompletion]
child_delegation: forbidden
output_schema: semantic-verdict-v1
prohibited_writes: [project-source, canonical-state, fact, wiki, business-catalog, scenario-skeleton, scenario, coverage, test-execution, evidence]
---

# Scenario narration review

Return only `{pass, issueCodes}` and use only `SCENARIO_NARRATION_*` issue codes. Every issue must contain the exact affected `SCN-*` reference so the backend can create a correction scope. Review fidelity, explicit prerequisites, action clarity, and expected observable outcomes. All structural fields and coverage are backend-owned and outside review.
