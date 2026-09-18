# scenario-pipeline

SRC/FACT/WIKI/SCENARIO의 결정 권한을 가진 backend다. 이 패키지가 canonical 값을 소유하며, LLM 출력은 여기서 검증된 뒤에만 반영된다.

## Scanner 규칙

- `scanning/source-scanner.ts`가 소스 inventory와 근거 범위를 결정한다. LLM 응답으로 inventory를 보정하지 않는다.
- `scanning/closure-service.ts`의 closure 결과를 우회해 임의 파일을 근거로 추가하지 않는다.
- fixture가 스캔되지 않으면 fixture를 고치지 않고 scanner 경계를 고친다.

## Canonical ID 생성 책임

- 모든 ID는 `scanning/deterministic-id.ts`에서만 생성한다: `sourceId`, `screenId`, `apiId`, `elementId`, `edgeId`, `scenarioId`.
- ID 형식(`SRC-`, `SCR-`, `API-`, `EL-`, `E-`, `SCN-`)과 hash suffix 규칙을 임의로 바꾸지 않는다. 형식 변경은 기존 artifact 참조를 깨뜨리므로 마이그레이션 근거 없이 수정하지 않는다.
- LLM이 문자열로 만든 ID를 신뢰하지 않는다. patch에 담긴 ID는 항상 기존 canonical ID와의 참조 일치만 확인한다.

## Evidence 범위와 byte budget

- `security/evidence-grant-service.ts`가 `EvidenceGrant`를 발급한다. grant 없이 소스를 읽는 경로를 만들지 않는다.
- evidence slice는 함수/블록 경계에서 잘려야 한다. byte budget 때문에 API 호출과 그 후속 효과가 분리되면 reviewer가 `API_WRITE_EFFECT_NOT_VERIFIED`로 거부한다.
- secret pattern에 걸린 슬라이스는 그대로 통과시키지 않는다. 마스킹 결과를 로그로 다시 출력하지 않는다.

## FACT patch가 변경할 수 있는 필드

- 허용: 사람이 읽는 semantic 설명 필드(reads/writes 서술, 업무 의미, label 텍스트).
- 금지: `id`, `evidence`, `target_candidates`, source path, hash, lifecycle 상태.
- `facts/fact-draft-compiler.ts`가 patch를 적용하며, 금지 필드 변경 시도는 통과시키지 않고 실패로 처리한다.

## Reviewer fail-closed 조건

- `validators/stage-completion-gate.ts`와 `validators/generation-artifact-validators.ts`가 gate다. verdict 없이 stage를 완료하지 않는다.
- reviewer 판정 불가, 근거 부족, 참조 불일치는 모두 실패다. 경고로 완화해 통과시키지 않는다.
- `workflows/work-scope-guard.ts` 범위를 벗어난 artifact 제출은 거부한다.
- `artifacts/artifact-writer.ts`의 staging 기록만으로 성공을 판단하지 않는다. `indexing/artifact-index.ts` 등록과 hash까지 확인한다.

## 집중 테스트

```
npm run test --workspace @scenarioforge/scenario-pipeline
npm run typecheck --workspace @scenarioforge/scenario-pipeline
```
