import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const source = () => readFile(new URL("./TestCenter.tsx", import.meta.url), "utf8");

describe("test center verdict reasons", () => {
  it("maps every step reason code to a user-facing label", async () => {
    const code = await source();

    for (const reason of [
      "TARGET_NOT_FOUND",
      "BUDGET_EXHAUSTED",
      "ACTION_OUTCOME_UNKNOWN",
      "GATE_REJECTED",
      "FRAME_MASKING_FAILED",
      "SCREEN_TEXT_INSTRUCTION_DETECTED",
      "MISSING_DATA_BINDING",
    ]) {
      expect(code).toContain(`${reason}:`);
    }
  });

  it("maps every gate rejection code to a user-facing label", async () => {
    const code = await source();

    for (const reason of [
      "OBSERVED_LABEL_MISMATCH",
      "TARGET_NOT_DISAMBIGUATED",
      "LOCUS_OUT_OF_BOUNDS",
      "CONFIDENCE_BELOW_THRESHOLD",
      "DESTRUCTIVE_ACTION_NOT_PERMITTED",
      "CANDIDATE_VERIFICATION_FAILED",
      "ACTION_NOT_ALLOWED",
      "STEP_MISMATCH",
    ]) {
      expect(code).toContain(`${reason}:`);
    }
  });

  it("appends the gate code to a rejection reason", async () => {
    const code = await source();

    expect(code).toContain('reason.code === "GATE_REJECTED" && reason.gateCode');
  });

  it("renders assertion outcomes and the execution path per step", async () => {
    const code = await source();

    expect(code).toContain("diagnostics.assertions?.map");
    expect(code).toContain("diagnostics.path &&");
    expect(code).toContain("diagnostics.observations !== undefined");
  });

  it("gives 확인 필요 its own glyph so it is not read as 대기", async () => {
    const code = await source();

    expect(code).toContain('inconclusive: { tone: "warn", icon: "i-help" }');
    expect(code).toContain('queued: { tone: "idle", icon: "i-circle" }');
  });

  it("renders diagnostics only when the execution actually carries them", async () => {
    const code = await source();

    expect(code).toContain("{step.diagnostics && <StepDiagnosticsView");
  });
});

describe("test center execution commands", () => {
  it("offers a start action only for a queued execution", async () => {
    const code = await source();

    expect(code).toContain('execution.status === "queued" && onStart');
    expect(code).toContain("대기열 실행");
  });

  it("shows the last reported step from backend events only", async () => {
    const code = await source();

    expect(code).toContain("lastStep &&");
    expect(code).toContain("statusLabels[lastStep.verdict.toLowerCase() as TestStepStatus]");
  });

  it("names the command rejection reasons", async () => {
    const code = await source();

    for (const reason of ["VISION_MODEL_BINDING_UNAVAILABLE", "NO_QUEUED_BATCH", "TARGET_ENTRY_SCHEME_FORBIDDEN"]) {
      expect(code).toContain(reason);
    }
  });

  it("opens recorded evidence for a step that already ran", async () => {
    const code = await source();

    expect(code).toContain('Boolean(onOpenStepEvidence) && step.status !== "queued"');
  });
});

describe("test center run-time data", () => {
  it("asks for the required bindings again because values are never stored", async () => {
    const code = await source();

    expect(code).toContain("execution.requiredBindings ?? []");
    expect(code).toContain("값은 저장되지 않습니다");
  });

  it("masks a secret binding field", async () => {
    const code = await source();

    expect(code).toContain('type={binding.secret ? "password" : "text"}');
  });

  it("blocks the run until every required value is present", async () => {
    const code = await source();

    expect(code).toContain("disabled={starting || missingBindings.length > 0}");
    expect(code).toContain("데이터 {missingBindings.length}개가 비어 있습니다");
  });

  it("clears the values from view state as soon as the run is requested", async () => {
    const code = await source();

    expect(code).toContain("setRunValues({});");
  });
});

describe("test center enqueue and retry", () => {
  it("retries only the cases that did not pass", async () => {
    const code = await source();

    expect(code).toContain('["failed", "inconclusive", "queued", "cancelled", "skipped"].includes(testCase.status)');
    expect(code).toContain("실패·미판정 {retryableScenarioIds.length}개 재시도");
  });

  it("keeps the full retry as a separate secondary action", async () => {
    const code = await source();

    expect(code).toContain("동일 조건 재시도");
  });

  it("names the enqueue and retry rejection reasons", async () => {
    const code = await source();

    for (const reason of ["SCENARIO_ALREADY_IN_EXECUTION", "EXECUTION_ALREADY_SETTLED", "TARGET_PROFILE_MISMATCH"]) {
      expect(code).toContain(reason);
    }
  });

  it("offers a quick review on a step that already ran", async () => {
    const code = await source();

    expect(code).toContain('onQuickReview && step.status !== "queued"');
    expect(code).toContain("REVIEW_DECISION_OPTIONS.map");
  });
});
