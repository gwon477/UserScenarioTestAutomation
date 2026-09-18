# 05 scenario-cases external evaluation

- Evaluation timing: after candidate generation and local source review
- Generator access to evaluator data: none
- Decision: fail the AXSE scenario-breadth checkpoint; retain as correction evidence
- Product stage acceptance: not attempted

## Comparison

| Evaluation dimension | Candidate result |
| --- | --- |
| Required complete journeys | Pass: the unchanged normal and recovery E2E spines remain present |
| Required case kinds | Pass: normal, boundary, exception, and recovery each have two cases |
| Source accuracy | Pass: the four additions use observable source-backed actions and outcomes |
| Patch isolation | Pass: successful targets were retained and only CT002 and CT003 were retried |
| Scenario-case breadth | Fail: the suite has 8 cases, while most of the 44 independently useful evaluator case families still have no dedicated executable case |
| Transition breadth | Fail: newly explicit project-empty, existing-task, upload-error, and diagnostics-error branches do not cover the many omitted guards, empty states, retries, navigation actions, result interactions, and output failures |
| Product acceptance | Not attempted: the artifact is a locally validated unregistered probe |

## Decision

This run proves that `gpt-5.6-luna` can complete the patch-only correction flow without a provider rate limit and that the backend can retain valid partial corrections, narrow the retry target set, refresh the base hash, and validate the merged artifact.

It does not prove that stage 05 is semantically complete. The next correction input must be derived only from the remaining source-backed gaps in `orchestrator-source-review.md`. Golden identifiers, wording, expected counts, and transition mappings must remain excluded from the generating agent.
