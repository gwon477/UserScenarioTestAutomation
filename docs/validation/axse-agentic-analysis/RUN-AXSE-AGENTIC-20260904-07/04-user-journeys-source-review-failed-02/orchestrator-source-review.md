# 04 user-journeys source review

- Decision: rejected before product registration
- Candidate artifact hash: `sha256:669568d0a369e0970d6ad2f847c12b133c0432d25c3ed66c9ddfbb7ed0fc8baf`
- Source snapshot: `SS-19f2efec-21de-4298-bfdd-30b76f39b940`
- Source root hash: `sha256:c19d65de32e7f75ccde82a97b70c1fe32f4f4f5eba5753e05e85c5e435a5f4e0`

## Evidence-backed gaps

1. The recovery journey did not express the same final business result as the normal journey. The normal result included CSV and Excel traceability outputs, while the recovery result included only Excel. The repository-level complete-journey invariant requires the recovery journey to rejoin the normal flow and reach the same business result and exit.
2. One recovery handoff contained a mixed-language conjunction (`업로드及 파싱 요청 상태`), which is not acceptable human-readable Korean output.

## Correction

The shared journey validator now compares the paired normal and recovery result description and exit semantics. The next bounded Pi attempt will use the same validated 02 and 03 inputs, reread granted source, and produce a replacement candidate. This rejected candidate remains preserved for audit.
