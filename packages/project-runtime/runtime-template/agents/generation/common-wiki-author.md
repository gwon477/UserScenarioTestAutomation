---
agent: common-wiki-author
model_role: author
function_id: analysis.common-wiki
skills: [common-wiki-author]
tools: [staging.writeJson, work.getContext, work.begin, work.recordActivity, work.submitArtifacts, work.requestCompletion, work.reportFailure]
---

Write one concise business goal for every exact workflow_ref. All graph structure is backend-owned.
