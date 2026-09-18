# 05 scenario-cases external evaluation

- Evaluation timing: after candidate generation, correction merge, and local validation
- Generator access to golden data: none
- Reviewed artifact hash: `sha256:fadfd4f9f412beb86b10ef0e71f12704d730104212064ec35a413673729f4d8d`
- Decision: fail the AXSE scenario-breadth checkpoint; retain as correction evidence
- Product stage acceptance: not attempted

## Comparison

| Evaluation dimension | Candidate result |
| --- | --- |
| Required complete journeys | Pass: the normal and recovery E2E spines remain present |
| Required case kinds | Pass: normal, boundary, exception, and recovery each have two cases |
| Patch isolation | Pass: 35 original targets were reduced to one failed target; the final model patch changed only `CT035.preconditions` |
| Non-target preservation | Pass: the suite remains eight cases in the same order; non-transition semantic changes are limited to the two planned recovery precondition fields and the 04 revision hash |
| Scenario-case breadth | Fail: the candidate still has the same eight case bodies as the prior failed candidate, against 44 golden case families; dedicated-case coverage therefore cannot exceed 8/44 (18.2%), and the previous missing branch families were not generated |
| Transition linkage | 33 of 69 lower-bound source obligations are linked; 36 are explicitly unresolved and none is silently missing |
| Executable transition coverage | Not measurable: all 33 linked refs are attached to the first normal case, with 6, 2, 11, 1, 12, and 1 refs on its six coarse steps. These links do not enumerate distinct guards, choices, or reachable paths and cannot be compared as 33 covered golden transitions |
| Product acceptance | Not attempted: this remains a locally validated unregistered probe |

## Decision

The correction-patch, partial-retention, failed-target-only reread, evidence-lineage, revision, and hash contracts worked. `gpt-5.6-luna` completed the final bounded patch without a provider rate limit.

The semantic checkpoint still fails. The lower-bound interaction inventory supplies a denominator and feasibility labels, but it does not contain canonical `from`/`to` view states, guards, effects, or mutually exclusive choice groups. Mapping many refs onto a coarse milestone step overstates coverage without adding executable branch cases.

The repository already contains the required canonical mechanism in the FACT edge ledger and `graph-tools`: guarded edges, state effects, deterministic path walking, and scenario skeleton compilation. The next integration should use that existing graph as the transition/guard model between classification and journey narration. The staged 05 model should narrate backend-enumerated paths and submit only bounded narration corrections; it should not decide coverage by attaching transition refs to existing coarse steps.
