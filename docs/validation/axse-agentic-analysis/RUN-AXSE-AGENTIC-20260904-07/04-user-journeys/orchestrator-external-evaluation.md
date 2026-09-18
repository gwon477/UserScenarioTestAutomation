# 04 user-journeys external evaluation

- Evaluation timing: after candidate generation and source review
- Generator access to evaluator data: none
- Decision: pass for the AXSE complete-journey checkpoint
- Product stage acceptance: not attempted

## Comparison

| Required capability | Candidate result |
| --- | --- |
| Normal end-to-end journey | Present: login → project/TS task → upload/parse → Parsed DB → business mapping/generation → results → CSV/Excel → logout |
| Recovery end-to-end journey | Present: same entry → upload/API or parsing failure → file removal/reselection and retry → normal-flow rejoin → results/Excel → logout |
| Primary business coverage | All six source-derived business-capability classifications occur in both journeys |
| State continuity | Every adjacent milestone pair has one explicit state handoff |
| Local workflow fragment | Preset preview is excluded from top-level journeys |
| Exit | Both journeys end in main-shell logout and session reset |

The candidate corresponds to both required AXSE journey shapes without copying evaluator IDs, wording, scenario cases, transition IDs, or counts into the generated artifact.

## Non-terminal correction input

The recovery journey's prerequisites mention a prepared MD/TXT document but do not explicitly distinguish the failure-triggering input from the valid replacement input. Before executable cases are accepted, the next bounded stage should reread the upload UI and parse validation sources and make that setup explicit in the recovery case preconditions. This does not break the current journey skeleton because the failure, replacement action, successful rejoin, business result, and exit are all present.

The next generator must not receive this evaluator document. An independent source-contract recheck confirmed a concrete UTF-8 decoding failure and valid replacement boundary in the upload UI and parse endpoint. That source-backed question is restated without evaluator IDs, wording, or counts in `orchestrator-next-stage-gaps.json`, together with only the source references it may revisit.

No scenario-case breadth or transition-coverage score was evaluated in this checkpoint.
