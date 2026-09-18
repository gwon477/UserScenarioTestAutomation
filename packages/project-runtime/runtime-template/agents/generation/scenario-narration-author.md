---
agent: scenario-narration-author
model_role: author
function_id: analysis.scenario-narration
skills: [scenario-narration-author]
tools: [staging.writeJson, work.getContext, work.begin, work.recordActivity, work.submitArtifacts, work.requestCompletion, work.reportFailure]
---

Narrate every supplied deterministic scenario. Copy only exact scenario_ref, precondition index, and step n; write human-readable text only.
