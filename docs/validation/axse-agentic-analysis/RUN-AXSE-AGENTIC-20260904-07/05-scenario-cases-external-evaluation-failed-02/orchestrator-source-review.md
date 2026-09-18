# 05 scenario-cases orchestrator source review

- Decision: pass for local semantic source review
- Product stage acceptance: not attempted
- Candidate artifact hash: `sha256:950b2b2e0d274ebe7c2fe6477ec657ccb2c30dfccd33083f3e10b29847512693`
- Agent artifact hash: `sha256:3abfda0d7ed8419fc3f663c20d6505cb3f233b5838a6c3b67dc4964e7f7cc0cd`
- Extends journey artifact hash: `sha256:44d01f41d836d66fd583df39e3e441f0c2f161620014f470a913533794ed62f5`
- Source snapshot: `SS-19f2efec-21de-4298-bfdd-30b76f39b940`
- Source root hash: `sha256:c19d65de32e7f75ccde82a97b70c1fe32f4f4f5eba5753e05e85c5e435a5f4e0`

## Case-suite review

1. The normal case follows J001 from login and project/task selection through document parsing, Parsed DB inspection, business-flow mapping, generation progress, scenario-matrix CSV and Excel download, and logout.
2. The boundary case stops at the evidenced synchronous UTF-8 decoding rejection and does not claim that parsing was accepted or completed.
3. The exception case stops at an evidenced scenario-generation failure state. It claims only the visible failed count and agent-run history, not an unsupported retry or result-preservation rule.
4. The recovery case follows J002 from the same entry, observes the UTF-8 rejection, uses the visible clear/reselect control, retries with a valid UTF-8 MD/TXT file, rejoins the normal parsed-data and generation flow, reaches the traceability result, and logs out.
5. The four cases cover normal, boundary, exception, and recovery kinds. Their classification references span all 12 evidenced perspectives carried by the two journeys: user role, authorization scope, business responsibility, workflow stage, lifecycle state, business capability, data domain, input source, output deliverable, channel surface, integration boundary, and risk/recovery.
6. All four cases have backend-hydrated evidence bindings. The evidence catalog contains 17 current source references, and no case binding is empty.

## Source checks

- Login submission and visible failures are implemented in `frontend/src/features/login/login-form.page.jsx:10` through `frontend/src/features/login/login-form.page.jsx:55`; project retrieval and selection are implemented in `frontend/src/features/login/login.page.jsx:16` through `frontend/src/features/login/login.page.jsx:58`.
- TS task selection/creation, stage access, and logout are implemented in `frontend/src/features/main/pages/main.page.jsx:91`, `frontend/src/features/main/pages/main.page.jsx:1461`, and `frontend/src/features/main/pages/main.page.jsx:1485`.
- The upload input accepts MD/TXT, renders parse progress and errors, and exposes reset/reselection in `frontend/src/features/upload/pages/upload.page.jsx:61` through `frontend/src/features/upload/pages/upload.page.jsx:122` and `frontend/src/features/upload/pages/upload.page.jsx:173` through `frontend/src/features/upload/pages/upload.page.jsx:251`.
- The parse endpoint decodes the complete upload as UTF-8 before acceptance and returns HTTP 400 on `UnicodeDecodeError` in `backend/app/api/v1/tasks.py:57` through `backend/app/api/v1/tasks.py:81`.
- Parsed-data search and screen diagnostics are implemented in `frontend/src/features/parsed-db/pages/parsed-db.page.jsx:175` through `frontend/src/features/parsed-db/pages/parsed-db.page.jsx:230`.
- Business-flow selection and generation request are implemented in `frontend/src/features/main/pages/main.page.jsx:430` through `frontend/src/features/main/pages/main.page.jsx:468`.
- Generation progress exposes total, completed, running, and failed counts plus agent-run history in `frontend/src/features/main/pages/main.page.jsx:990` through `frontend/src/features/main/pages/main.page.jsx:1065`; the corresponding progress and run endpoints are implemented in `backend/app/api/v1/workflows.py:121` through `backend/app/api/v1/workflows.py:213`.
- Scenario matrix lookup and CSV/Excel export actions are implemented in `frontend/src/features/main/pages/main.page.jsx:1170` through `frontend/src/features/main/pages/main.page.jsx:1235`; the corresponding backend endpoints are in `backend/app/api/v1/workflows.py:126` through `backend/app/api/v1/workflows.py:150`.

## Generation audit

- The model read all five bounded prior artifacts and made four source-closure calls.
- Its first artifact write was rejected with `SCENARIO_CASE_GAP_SOURCE_NOT_READ`; it then reread the three required gap source references and wrote one accepted artifact.
- No fatal error occurred. The first failed generation attempt is preserved separately under `05-scenario-cases-failed-01`; it is not part of the accepted candidate.
- Golden classifications, journeys, cases, counts, wording, and evaluator notes were not supplied to the generating agent or included in any evidence grant.

## Carried uncertainty

- Detailed role/permission rules and project-specific authorization boundaries remain unresolved because the source proves authentication and project context but not differentiated access policy.
- The exact trigger for background parse failures remains unresolved; this suite uses only the source-backed synchronous non-UTF-8 rejection for its upload failure and recovery cases.
- Retry behavior and preservation of existing results after scenario-generation failure or partial completion remain unresolved. The exception case therefore terminates at the visible failure state and does not invent a recovery action.

The artifact is a locally validated, unregistered probe. This review does not claim backend registration or product-stage acceptance.
