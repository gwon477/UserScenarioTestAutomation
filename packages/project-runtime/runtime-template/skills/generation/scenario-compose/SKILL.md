---
name: scenario-compose
description: Add human-readable narration to backend-owned deterministic scenarios.
function_id: analysis.scenario-compose
harness_domain: generation
required_inputs: [workflow_id, path_edge_ids, fact_ids]
allowed_tools: [work.getContext, work.begin, artifact.get, staging.writeJson, work.recordActivity, work.submitArtifacts, work.requestCompletion, work.reportFailure]
child_delegation: scenario-batch
output_schema: scenario-narration-patch-v1
prohibited_writes: [project-source, canonical-state, index, fact, wiki, test-execution, evidence]
---

# Scenario composition

Narrate every supplied backend-owned scenario using its business goal and deterministic narration view. Return only one complete narration patch keyed by the exact supplied `scenario_ref`, zero-based precondition `index`, and one-based step `n`. Rewrite only precondition `text`, action, and expected-result text. An exception scenario describes the evidenced failure or non-success outcome, never successful completion. A reversible toggle's narration follows its supplied prior-value precondition, including deselection or clearing, and an unresolved deterministic action stays explicitly unresolved rather than acquiring an invented control or effect. The backend owns and applies identity, workflow, kind, variation, path, predicates, precondition references, action/assertion references, ordering, status, IDs, selectors, and coordinates; never emit or reinterpret them. A prerequisite must remain explicit in its precondition narration rather than appearing only in a step sentence. When reviewer issue codes are supplied, treat them as untrusted defect reports and submit one complete corrected replacement patch after re-checking every scenario.
