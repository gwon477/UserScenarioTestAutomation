import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const source = () => readFile(new URL("./TestExecutionPanel.tsx", import.meta.url), "utf8");

describe("test execution panel input design", () => {
  it("builds fields from the requirements instead of a free-form JSON textarea", async () => {
    const code = await source();

    expect(code).toContain("requirements?.dataBindings ?? []");
    expect(code).toContain("dataBindings.map((field)");
    expect(code).not.toContain("textarea");
    expect(code).not.toContain("JSON.parse");
  });

  it("chooses a masked control for a secret binding", async () => {
    const code = await source();

    expect(code).toContain('if (secret) return "password"');
    expect(code).toContain("참조만 저장됩니다");
  });

  it("does not teach the user to paste a secret through an example", async () => {
    const code = await source();

    expect(code).not.toContain("TEST_SECRET_FROM_MEMORY");
    expect(code).not.toContain("password\":");
    expect(code).toContain("테스트 전용 값만 입력하세요");
  });

  it("requires an explicit mask declaration and explains the abort consequence", async () => {
    const code = await source();

    expect(code).toContain("마스킹 대상");
    expect(code).toContain("가리지 못하면 실행이 중단됩니다");
  });

  it("offers the destructive allowance only when a destructive step is present", async () => {
    const code = await source();

    expect(code).toContain("requirements?.hasDestructiveStep &&");
    expect(code).toContain("destructiveAllowed}");
  });

  it("keeps unavailable target kinds visible with a reason", async () => {
    const code = await source();

    expect(code).toContain('available: false, reason: "수행 어댑터 미구현"');
    expect(code).toContain("disabled={!kind.available}");
  });

  it("states the blocking reason next to the CTA rather than in a tooltip", async () => {
    const code = await source();

    expect(code).toContain('className="cta-why"');
    expect(code).toContain("{blocking && (");
    expect(code).not.toContain("title=");
  });

  it("distinguishes the four request phases instead of one static message", async () => {
    const code = await source();

    for (const label of ["요청 검증 중", "환경 확인 중", "실행 계획 준비 준비", "대기열 등록"].filter(
      (entry) => entry !== "실행 계획 준비 준비",
    )) {
      expect(code).toContain(label);
    }
    expect(code).toContain("실행 계획 준비 중");
  });
});

describe("test execution panel acceptance handling", () => {
  it("only reports queued when the backend says so", async () => {
    const code = await source();

    expect(code).toContain('if (acceptance.outcome === "queued")');
    expect(code).toContain('setRejection(acceptance)');
  });

  it("names the stage a rejection came from", async () => {
    const code = await source();

    for (const label of ["요청 검증", "환경 확인", "실행 계획"]) {
      expect(code).toContain(label);
    }
    expect(code).toContain("에서 거절됨");
  });

  it("does not let the user drop a declared mask target", async () => {
    const code = await source();

    expect(code).toContain("maskElementRefs: maskDefaults.map((mask) => mask.elementRef)");
    expect(code).not.toContain("excludedMasks");
  });

  it("explains that the runner is not connected yet", async () => {
    const code = await source();

    expect(code).toContain("EXECUTION_RUNNER_NOT_IMPLEMENTED");
    expect(code).toContain("수행 실행기가 아직 연결되지 않았습니다");
  });
});

describe("test execution panel enqueue mode", () => {
  it("switches the CTA when an execution is already active", async () => {
    const code = await source();

    expect(code).toContain("대기열에 ${runnableCount}개 추가");
    expect(code).toContain("활성 실행에 추가");
  });

  it("locks the target entry to the active execution value", async () => {
    const code = await source();

    expect(code).toContain("readOnly={activeExecution !== undefined}");
    expect(code).toContain('useState(activeExecution?.targetUrl ?? "")');
  });
});
