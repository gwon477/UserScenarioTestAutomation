---
name: wiki-compose
description: Compose bounded business workflows from verified FACT graph records without source access.
function_id: analysis.wiki-compose
harness_domain: generation
required_inputs: [fact_ids, source_snapshot_id]
allowed_tools: [work.getContext, work.begin, artifact.get, staging.writeJson, work.recordActivity, work.submitArtifacts, work.requestCompletion, work.reportFailure]
child_delegation: module-batch
output_schema: wiki-bundle-v2
prohibited_writes: [project-source, canonical-state, index, fact, scenario, test-execution, evidence]
---

# WIKI workflow composition

Use only the bounded verified FACT graph. Define the user goal, entry screens, registered predicate terminals, variation axes, combination policy, dependencies, and citations. The workflow set must collectively cover every verified FACT edge through reachable paths; deterministic walking is bounded to the edge IDs cited by each workflow. Split distinct goals, exception outcomes, reverse navigation, and exports when needed. A screen terminal is supported only when a reachable FACT edge path connects an entry screen to it, using only that workflow's cited edges. Predicate terminals and variation defaults must copy registered predicate IDs and values exactly. Omit workflows whose completion or outcome is not represented in FACT; `unresolved` status does not authorize unsupported claims. Default to base-choice; use pairwise only for material interactions or an explicit requirement. Source access is not available to this role.
