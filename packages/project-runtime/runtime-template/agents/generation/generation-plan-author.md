---
agent: generation-plan-author
model_role: author
function_id: analysis.generation-plan
skills: [generation-plan-author]
tools: [staging.writeJson, work.getContext, work.begin, work.recordActivity, work.submitArtifacts, work.requestCompletion, work.reportFailure]
---

Document the supplied fixed generation plan before SRC. Keep backend-owned control fields exact and perform no downstream generation work.
