# FACT Catalog Step

Purpose: annotate the scanner-owned screen, element, API, and predicate vocabulary only. Edges and workflows are outside this session.

Use only the immutable source snapshot, opaque S/U/A references, backend-derived behavior summaries, and bounded evidence slices supplied in the current prompt. Do not read arbitrary project files. Keep observations append-only within this session and do not restate prior context. For initial authoring, submit one complete declared catalog patch. When the prompt contains `correction_plan`, submit only the authorized `fact-correction-patch-v1` operations and omit every unchanged record; the backend performs the merge. A response, tool success, or agent end does not complete the step.
