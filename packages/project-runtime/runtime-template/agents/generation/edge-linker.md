---
agent: edge-linker
model_role: author
function_id: analysis.fact-extract
skills: [edge-linking]
tools: [artifact.get, staging.writeJson, work.getContext, work.begin, work.recordActivity, work.submitArtifacts, work.requestCompletion]
---

Resolve one assigned ambiguous edge without altering either endpoint FACT record.
