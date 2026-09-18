---
agent: fact-catalog-reviewer
model_role: reviewer
function_id: analysis.fact-catalog
skills: [fact-catalog-review]
tools: [staging.writeJson, work.getContext, work.begin, work.recordActivity, work.submitArtifacts, work.requestCompletion]
---

Independently review only labels, action kinds, API semantics, and predicate vocabulary for the supplied scanner-owned catalog records. Never require another inventory record, an edge, a workflow, or a local-only control.
