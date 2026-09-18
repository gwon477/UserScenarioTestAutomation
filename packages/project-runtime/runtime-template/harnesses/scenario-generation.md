# Scenario Generation Harness

Harness domain: `generation`

This harness routes `analysis.source-map`, `analysis.fact-extract`, `analysis.wiki-compose`, and `analysis.scenario-compose`. It never loads execution-planning skills, agents, tools, state, or evidence.

## Required work lifecycle

1. Call `work.getContext` for this work ID.
2. Start with `work.begin` using the returned one-time context token and revision.
3. Use bounded ID query tools before making repository or artifact claims.
4. Read source only through scanner output, closure, and evidence grants assigned to this work.
5. Write only to `.scenarioforge/staging/{workId}/`.
6. Submit structured artifacts with `work.submitArtifacts`, then call `work.requestCompletion`.
7. If completion is rejected, address only the reported unmet gates or report a structured failure.

FACT semantic review permits at most six backend-controlled repair attempts before settlement. The repair author receives the same deterministic draft/evidence scope, the rejected semantic patch, and at most 20 bounded reviewer issue codes, then submits one complete replacement patch. Reviewer decision history is content-hash versioned and bounded to 16KB in total; only decisions for a byte-identical current FACT are supplied as untrusted consistency context, so a repaired FACT version cannot create a false decision conflict. Identity, ownership, arbitrary reference, and evidence failures are never auto-repaired. An initial patch or semantic replacement may receive one final correction only when it fails exclusively with `FACT_PATCH_SCHEMA_INVALID` or guard/effect predicate registration. Every replacement is compiled and independently reviewed again; a seventh semantic rejection is terminal.

Before SRC, the author writes one `generation-plan` using the backend-owned ten-step template. Every step entry has one objective plus the fixed entry-check, execution-action, completion-check, correction-mode, and context-strategy fields. The backend validates the complete plan and requires its persisted receipt before any generation step can begin.

WIKI and SCENARIO structure is backend-owned and deterministically validated before semantic review. A repair issue must name the exact affected workflow, classification/workflow, or scenario reference. The backend derives a correction scope and base hash, re-grants only source ranges connected to that scope, and accepts only the targeted correction patch. It merges that patch into the prior candidate, proves every record outside the scope is byte-identical, then revalidates the complete artifact. An issue without a backend-resolvable reference fails closed instead of triggering full regeneration.

A natural-language completion response, Pi `agent_end`, tool success, or reviewer pass does not complete a stage. Only the backend completion gate followed by a durable journal revision does.

Author, reviewer, and repair use separate Pi session lanes scoped to one generation step and role. Calls in the same lane may compact and rebind, but no lane crosses a step boundary; every lane is disposed when the step completes or fails. The context manifest records the step, role, `step-role-lane-compaction` strategy, and `disposed-at-step-end` disposition. A later step receives only its declared artifact receipts and bounded context pack.

The deterministic order after planning is `SRC → FACT → WIKI → SCENARIO`. Agents cannot reorder stages or modify canonical state, final artifacts, the SQLite index, `WORK_STATE.md`, or any test execution entity.
