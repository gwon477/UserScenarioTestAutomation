# 05 scenario-cases orchestrator source review

- Decision: pass for source accuracy; fail for source-distinct case breadth
- Product stage acceptance: not attempted
- Candidate artifact hash: `sha256:ee73a80e90ae86a7235a1717716545d4af1d0c09dec640f4460c5583dbdeadcb`
- Agent artifact hash: `sha256:9503bf7948a6857fbd0076441fedad935540cdb92d30527a715e6bbca673fc75`
- Artifact revision: 2
- Source snapshot: `SS-19f2efec-21de-4298-bfdd-30b76f39b940`

## Correction behavior

1. The initial correction plan contained CT001 through CT004.
2. The first patch retained the valid CT001 and CT004 additions and rejected only case indexes 5 and 6 for missing input-source and lifecycle-state perspectives.
3. The retry plan contained only CT002 and CT003, each with `case_limit: 1` and its specific validation reason.
4. The final patch added only CT002 and CT003 against the updated base hash.
5. The merged artifact contains the four unchanged prior cases and four additions, and passed full local schema, reference, evidence, grant, and hash validation as revision 2.

## Source-supported additions

- Existing TS task selection is supported by the task menu, task bootstrap, and selected task stage rendering in `frontend/src/features/main/pages/main.page.jsx`.
- Upload API rejection, visible error state, file clearing/reselection, and another parse attempt are supported by `frontend/src/features/upload/pages/upload.page.jsx` and `backend/app/api/v1/tasks.py`.
- An empty project response and its visible message are supported by `frontend/src/features/login/login.page.jsx`.
- Business-flow screen-diagnostics request failure and its visible error card are supported by `frontend/src/features/main/pages/main.page.jsx` and `backend/app/api/v1/workflows.py`.

## Remaining semantic gaps

The candidate expanded from four to eight cases, but it still does not split most source-distinct branches into independently executable cases. Missing groups include:

- required login input, token fallback, login HTTP failure, and login network failure;
- project HTTP/network failure, refresh, and project-selection logout;
- no-task creation, task list/create/bootstrap failure, stage guards, shell refresh/home, and shell logout;
- file selection/cancel, background parse failure, poll failure, reupload cancel, and post-generation upload lock;
- Parsed DB tab, search hit/miss, pagination, empty data, list error, partial overview/diagnostics, and previous/business navigation;
- business context/category views, selection modes, diagnostic filters, empty data, flow-text result/empty/close, and pagination;
- preset new/resume/conflict/failure/close, no-selection guard, existing active generation, request failure, and mapping CSV success/failure;
- generation automatic/manual refresh, completion handoff, result filter/search/detail/empty/pagination, loader failure, CSV/Excel failure, and return navigation.

The broad source gap was converted into only four correction targets, so local completion became possible after one addition per kind even though the source-distinct breadth requirement remained open. A subsequent correction must identify these missing source branches as smaller backend-owned targets rather than repeat the same broad four-target request.

The artifact remains an unregistered probe. This review does not claim product-stage acceptance.
