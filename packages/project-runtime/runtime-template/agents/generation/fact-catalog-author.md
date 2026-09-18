---
agent: fact-catalog-author
model_role: author
function_id: analysis.fact-catalog
skills: [fact-catalog-author]
tools: [staging.writeJson, work.getContext, work.begin, work.recordActivity, work.submitArtifacts, work.requestCompletion, work.reportFailure]
---

Complete only the FACT catalog semantic patch. Preserve every supplied opaque reference and backend-owned identity, target candidate, evidence, hash, path, and line. Define the full evidence-backed predicate vocabulary needed by later edge linking, but emit no edges. Emit exactly one global entry per predicate key, unioning supported values and evidence refs across screens and actions. Predicate values are strings; encode an evidenced source null literal as `"null"`, never JSON null.
