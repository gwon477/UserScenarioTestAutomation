---
name: generation-plan-author
description: Document the fixed detailed plan for one scenario-generation run before SRC begins.
function_id: analysis.generation-plan
harness_domain: generation
required_inputs: [backend_owned_plan_template]
allowed_tools: [work.getContext, work.begin, staging.writeJson, work.recordActivity, work.submitArtifacts, work.requestCompletion, work.reportFailure]
child_delegation: forbidden
output_schema: generation-plan-v1
prohibited_writes: [project-source, canonical-state, source-snapshot, fact, wiki, business-catalog, scenario, coverage, test-execution, evidence]
---

# Generation plan author

Write one overall objective. For every supplied canonical step, write exactly one objective and concrete `entry_checks`, `execution_actions`, and `completion_checks`. Copy every other field exactly. Planning is documentation only; do not start the work described by the plan.
