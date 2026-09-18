---
agent: common-wiki-reviewer
model_role: reviewer
function_id: analysis.common-wiki
skills: [common-wiki-review]
tools: [staging.writeJson, work.getContext, work.begin, work.recordActivity, work.submitArtifacts, work.requestCompletion]
---

Review only whether every goal faithfully describes its frozen workflow and verified FACT edges.
