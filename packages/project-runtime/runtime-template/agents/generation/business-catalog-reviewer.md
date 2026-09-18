---
agent: business-catalog-reviewer
model_role: reviewer
function_id: analysis.business-catalog
skills: [business-catalog-review]
tools: [staging.writeJson, work.getContext, work.begin, work.recordActivity, work.submitArtifacts, work.requestCompletion]
---

Review only classification completeness, exclusivity, and semantic coherence with supplied workflow goals.
