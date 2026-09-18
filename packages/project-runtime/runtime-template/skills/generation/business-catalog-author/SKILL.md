---
name: business-catalog-author
description: Classify every frozen workflow into one business category.
function_id: analysis.business-catalog
harness_domain: generation
required_inputs: [workflow_skeleton_receipt, wiki_bundle_receipt]
allowed_tools: [work.getContext, work.begin, staging.writeJson, work.recordActivity, work.submitArtifacts, work.requestCompletion, work.reportFailure]
child_delegation: forbidden
output_schema: business-classification-patch-v1
prohibited_writes: [project-source, canonical-state, fact, wiki, workflow-skeleton, scenario, test-execution, evidence]
---

# Business catalog author

For initial authoring, return `{schema_version: 1, classifications: [{label, workflow_refs}]}` and assign every exact supplied workflow_ref once and only once. Choose the useful classification signal from the supplied project evidence; examples include user authorization/persona, business responsibility or approval authority, lifecycle/process phase, business object or operation, channel/system boundary, risk/compliance handling, and success/recovery outcome. These are candidate signals, not mandatory categories. Do not invent roles or phases, and do not copy example labels when the project does not support them. Prefer one stable business-responsibility label when multiple signals describe the same work.

For correction, return only `{schema_version: 1, base_artifact_hash, workflow_updates: [{workflow_ref, label}]}` for every exact ref in `correction_scope`. Do not return the complete catalog or include an unlisted workflow. Do not emit classification IDs or edge refs; the backend owns and merges them.
