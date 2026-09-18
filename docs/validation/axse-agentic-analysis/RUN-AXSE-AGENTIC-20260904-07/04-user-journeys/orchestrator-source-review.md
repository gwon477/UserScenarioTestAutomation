# 04 user-journeys orchestrator source review

- Decision: pass for local semantic source review
- Product stage acceptance: not attempted
- Candidate artifact hash: `sha256:44d01f41d836d66fd583df39e3e441f0c2f161620014f470a913533794ed62f5`
- Agent artifact hash: `sha256:fa443a101555217aee2eb651742c3aae3e49ea5f9d1b1aa472e015effaa22603`
- Source snapshot: `SS-19f2efec-21de-4298-bfdd-30b76f39b940`
- Source root hash: `sha256:c19d65de32e7f75ccde82a97b70c1fe32f4f4f5eba5753e05e85c5e435a5f4e0`

## Complete-journey review

1. The normal journey starts at the earliest supported login entry, selects a project and TS task, traverses upload and parsing, Parsed DB inspection, business-flow mapping, scenario generation, traceability results, CSV and Excel download, and logout.
2. The recovery journey starts with the same persona and entry, observes an upload/API or parsing failure, removes or reselects the file, restarts upload and parsing, rejoins at the parsed-data and mapping flow, reaches the same core scenario/traceability business result, and uses the same logout exit.
3. The preset-preview thread remains an excluded workflow-sized fragment because closing its modal leaves the user in the mapping workflow and does not form a solution-level journey.
4. All six primary source areas occur in both journeys. All 13 milestones have at least one current evidence binding; no journey or milestone evidence binding is empty.

## Source checks

- Application entry ordering is implemented in `frontend/src/App.jsx:7`, with login before project selection and the main shell.
- Login submission and visible failures are implemented in `frontend/src/features/login/login-form.page.jsx:20`; project retrieval and selection are implemented in `frontend/src/features/login/login.page.jsx:21` and `frontend/src/features/login/login.page.jsx:51`.
- TS task selection/creation and stage access are implemented in `frontend/src/features/main/pages/main.page.jsx:91`, `frontend/src/features/main/pages/main.page.jsx:1461`, and `frontend/src/features/main/pages/main.page.jsx:1498`.
- Upload polling, failure display, file reset, and reupload are implemented in `frontend/src/features/upload/pages/upload.page.jsx:61`, `frontend/src/features/upload/pages/upload.page.jsx:88`, and `frontend/src/features/upload/pages/upload.page.jsx:109`.
- Parsed-data search and diagnostics are implemented in `frontend/src/features/parsed-db/pages/parsed-db.page.jsx:175` and `frontend/src/features/parsed-db/pages/parsed-db.page.jsx:202`.
- Business-flow selection and generation request are implemented in `frontend/src/features/main/pages/main.page.jsx:430` and `frontend/src/features/main/pages/main.page.jsx:454`.
- Generation progress, final matrix filters/search, and CSV/Excel actions are implemented in `frontend/src/features/main/pages/main.page.jsx:1000` and `frontend/src/features/main/pages/main.page.jsx:1189`; corresponding backend endpoints are in `backend/app/api/v1/workflows.py:112` through `backend/app/api/v1/workflows.py:149`.
- Main-shell logout resets the session through `frontend/src/features/main/pages/main.page.jsx:104` and `frontend/src/features/main/pages/main.page.jsx:1485`.

## Carried uncertainty

- Actual authorization roles and project access policy remain unresolved because the visible flow proves authentication and project context, not detailed permission rules.
- Exact retry behavior and result preservation after scenario-generation failure or partial completion remain unresolved. The accepted recovery journey therefore covers only the source-backed upload/parsing recovery path.

## Post-review contract revalidation

The unchanged candidate artifact `sha256:44d01f41d836d66fd583df39e3e441f0c2f161620014f470a913533794ed62f5` also passes the tightened local contract that rejects duplicate evidence-binding values, unknown milestone source areas, and a recovery journey whose persona, entry area, business-result description, or exit differs from its matching normal journey.

The upload UI limits selection to MD/TXT and displays UTF-8 metadata (`frontend/src/features/upload/pages/upload.page.jsx:181` through `frontend/src/features/upload/pages/upload.page.jsx:191`). The parse endpoint rejects content that cannot be decoded as UTF-8 (`backend/app/api/v1/tasks.py:64` through `backend/app/api/v1/tasks.py:68`), while the UI exposes the error and file reset/reselection path. The next case stage therefore has a source-backed question: distinguish a decoding-failure input from a valid UTF-8 replacement in recovery preconditions. Other background parsing failure triggers remain unresolved unless additional granted source establishes them.

The artifact is a locally validated, unregistered probe. This review does not claim backend registration or product-stage acceptance.
