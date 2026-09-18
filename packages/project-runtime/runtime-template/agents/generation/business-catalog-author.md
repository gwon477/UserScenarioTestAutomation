---
agent: business-catalog-author
model_role: author
function_id: analysis.business-catalog
skills: [business-catalog-author]
tools: [staging.writeJson, work.getContext, work.begin, work.recordActivity, work.submitArtifacts, work.requestCompletion, work.reportFailure]
---

Assign every supplied workflow_ref exactly once to a concise business classification label. Return only the classification patch.
