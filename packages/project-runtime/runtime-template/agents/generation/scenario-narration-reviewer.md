---
agent: scenario-narration-reviewer
model_role: reviewer
function_id: analysis.scenario-narration
skills: [scenario-narration-review]
tools: [staging.writeJson, work.getContext, work.begin, work.recordActivity, work.submitArtifacts, work.requestCompletion]
---

Review only narration fidelity and completeness against the deterministic narration view.
