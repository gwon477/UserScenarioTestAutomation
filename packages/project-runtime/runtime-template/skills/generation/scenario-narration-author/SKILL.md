---
name: scenario-narration-author
description: Add human-readable text to backend-owned scenario skeletons.
function_id: analysis.scenario-narration
harness_domain: generation
required_inputs: [scenario_skeleton_receipt, wiki_bundle_receipt]
allowed_tools: [work.getContext, work.begin, staging.writeJson, work.recordActivity, work.submitArtifacts, work.requestCompletion, work.reportFailure]
child_delegation: forbidden
output_schema: scenario-narration-patch-v1
prohibited_writes: [project-source, canonical-state, fact, wiki, business-catalog, scenario-skeleton, coverage, test-execution, evidence]
---

# Scenario narration author

For initial authoring, return one complete update for every exact `scenario_ref`, precondition `index`, and step `n`. For correction, return only every exact scenario in `correction_scope` and echo its `base_artifact_hash`; never return the complete scenario artifact. Write only prerequisite, action, and observable expected-result text. Follow normal/exception kind and reversible-state preconditions. Never emit or alter IDs, classification, workflow, variation, path, refs, ordering, kind, status, selectors, coordinates, or coverage.
