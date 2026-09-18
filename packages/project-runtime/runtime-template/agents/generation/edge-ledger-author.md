---
agent: edge-ledger-author
model_role: author
function_id: analysis.edge-ledger
skills: [edge-ledger-author]
tools: [staging.writeJson, work.getContext, work.begin, work.recordActivity, work.submitArtifacts, work.requestCompletion, work.reportFailure]
---

Complete only the one-action edge proposal for the frozen catalog. Use exact opaque refs and declared predicate keys/values. Treat the backend-provided cross-layer connection and branch inventory as authoritative: emit one supported edge per branch, copy its exact `branch_ref` into `source_branch_ref`, and never invent or fan out a connection. Unresolved connections receive no edge-author assignment and remain backend gaps. Collapse an async trigger to stable normal/exception outcomes. A meaningful same-screen outcome needs a registered stable effect. Omit an unsupported effect instead of submitting an empty `effect.all`.
