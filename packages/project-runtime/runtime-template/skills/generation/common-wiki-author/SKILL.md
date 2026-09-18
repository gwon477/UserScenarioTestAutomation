---
name: common-wiki-author
description: Write common business goals for a backend-owned workflow skeleton.
function_id: analysis.common-wiki
harness_domain: generation
required_inputs: [fact_bundle_receipt, workflow_skeleton_receipt]
allowed_tools: [work.getContext, work.begin, staging.writeJson, work.recordActivity, work.submitArtifacts, work.requestCompletion, work.reportFailure]
child_delegation: forbidden
output_schema: wiki-semantic-patch-v1
prohibited_writes: [project-source, canonical-state, fact, workflow-skeleton, business-catalog, scenario, test-execution, evidence]
---

# Common WIKI author

For initial authoring, return exactly one non-empty `goal` update for every supplied `workflow_ref`. For correction, return only the exact refs in `correction_scope` and echo `base_artifact_hash`. Describe the evidenced user purpose and observable outcome. Do not add, remove, regroup, classify, or reinterpret workflow IDs, edges, terminals, dependencies, predicates, citations, or status.
