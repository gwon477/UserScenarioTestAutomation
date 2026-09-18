---
name: verify-generation-pipeline
description: ScenarioForge 변경이 완료됐다고 주장하기 전, 커밋이나 PR 전에 사용한다. focused test, 전체 test, typecheck, build, live stage 순으로 검증하고 artifact 제출이 실제로 backend에 반영됐는지 확인한다. "고쳤다", "통과한다", "완료"라고 말하기 전에 반드시 실행한다.
---

# 생성 파이프라인 검증

실행한 명령의 **실제 출력**만 근거로 삼는다. 출력을 보지 않고 통과를 주장하지 않는다.

## 0. 환경

```
node --version
```

`package.json`의 `engines`(`>=22.19.0`)를 만족하지 않으면 그 사실을 먼저 보고한다. 아래 결과는 신뢰할 수 없다.

## 1. 순서대로 실행

앞 단계가 실패하면 멈추고 보고한다. 뒤 단계를 건너뛴 채 "나머지는 통과할 것"이라고 쓰지 않는다.

```
git diff --name-only
npm run test --workspace @scenarioforge/<변경된 package>
npm test
npm run typecheck
npm run build
git diff --check
```

## 2. Artifact 제출 검증

파이프라인 산출물을 다뤘다면 staging 파일 존재만으로 성공을 판단하지 않는다. 네 가지를 각각 확인한다.

1. backend artifact 등록
2. work scope 일치
3. path가 `ProjectPathPolicy` 규칙을 따름 (staging과 canonical 구분)
4. `contentHash` 일치

`artifact.verify`를 통과하지 못한 artifact를 canonical로 취급하지 않는다.

## 3. Live stage

Electron 실행(`npm run dev`)은 사용자 승인이 필요하다. 승인 없이 실행하지 않는다.

live 확인이 필요하면 대상 stage, 사용할 fixture, 확인할 run ID를 명시한다. UI fixture(`test-execution-fixture.ts`) 데이터를 live 결과로 보고하지 않는다.

## 4. 보고

```
node --version : <값> (engines 만족 여부)
focused test   : PASS / FAIL
npm test       : PASS / FAIL
typecheck      : PASS / FAIL
build          : PASS / FAIL
git diff --check : PASS / FAIL
artifact 검증  : 등록 / scope / path / hash
live stage     : 확인함 / 승인 필요 (미실행)
```

## 금지

- 실행하지 않은 명령을 통과로 보고하지 않는다.
- 실패한 테스트를 skip, 수정, 삭제해 통과시키지 않는다.
- 기존 실패라고 넘기려면 변경 전에도 실패했음을 보여주는 출력을 근거로 제시한다.
- 부분 통과를 완료로 보고하지 않는다.

한 단계라도 실패했다면 "완료"라고 쓰지 않는다.
