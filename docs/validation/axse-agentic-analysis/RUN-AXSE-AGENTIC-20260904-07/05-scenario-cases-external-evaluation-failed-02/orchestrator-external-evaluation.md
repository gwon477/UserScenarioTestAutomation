# 05 scenario-cases external evaluation

- Evaluation timing: after candidate generation and local source review
- Generator access to evaluator data: none
- Decision: fail the AXSE scenario-breadth checkpoint; retain as correction input
- Product stage acceptance: not attempted

## Comparison

| Evaluation dimension | Candidate result |
| --- | --- |
| Required complete journeys | Pass: the normal and recovery cases preserve both required end-to-end journey shapes |
| Primary business coverage | Pass: all six user-visible business capabilities occur in the suite |
| Required case kinds | Pass: normal, boundary, exception, and recovery are each present |
| Source accuracy | Pass: the four cases use source-backed actions and visible outcomes and preserve unsupported details as unresolved |
| Scenario-case breadth | Fail: 4 candidate cases correspond to 4 of 44 independently useful golden case families (9.1%) |
| Transition breadth | Fail: 25 of 90 golden transitions are explicitly represented (27.8%); coarse steps do not count as coverage of unmentioned guards, outcomes, or alternate states |
| Executability | Fail: actions such as selecting an existing task “or” creating a new task combine mutually exclusive variants instead of choosing one concrete setup and outcome |

## Explicit transition comparison

The normal E2E case explicitly represents login success, project listing/selection, task bootstrap, file selection and accepted parsing, parse polling/completion, Parsed DB inspection/search, BUSINESS entry and flow selection/mapping validation, generation request/progress/completion, matrix display, CSV/Excel download, and logout. This maps conservatively to 22 distinct golden transitions.

The boundary case adds the non-UTF-8 rejection. The exception case adds the visible generation failure state. The recovery case adds file clear/reselection before rejoining the already-counted normal flow. These add three distinct transitions, for 25 total. Reusing a transition in multiple cases does not increase unique coverage.

## Material source-backed gaps

The missing breadth is not a request to reproduce evaluator wording or counts. Independent source inspection confirms distinct observable branches that deserve separate, executable cases:

- empty credentials, login HTTP failure, login network failure, and token-claim fallback;
- empty/error/retry project listing and project-selection logout;
- existing task selection, new task creation, task API failure, stage guards, home, refresh, and main logout;
- upload selection/reselection/cancel, accepted parse polling, immediate UTF-8 rejection, background parse failure, polling failure, and post-generation upload lock;
- Parsed DB tabs, search hit/miss, pagination, empty data, list error, partial overview/diagnostics data, previous, and BUSINESS navigation;
- context/category views, selection modes, diagnostics filters/errors, flow-text result/empty/close, preset new/resume/conflict/failure/close, no-selection guard, active generation, request failure, and mapping CSV success/failure;
- generation automatic/manual refresh, passed/partial/failed histories, result filter/search/detail/empty/pagination, initial/refresh loader rejection behavior, CSV/Excel success/failure, and return navigation.

## Correction boundary

The current candidate remains useful as the complete-journey spine. Correction should preserve its validated normal and recovery flows, then add separate source-distinct cases around them. The generating agent must receive only a source-backed gap document and granted original source; it must not receive this evaluator document, evaluator IDs, expected counts, wording, or the transition mapping above.

This evaluation rejects scenario breadth only. It does not revoke the prior local source-accuracy review and does not claim backend registration or product-stage acceptance.
