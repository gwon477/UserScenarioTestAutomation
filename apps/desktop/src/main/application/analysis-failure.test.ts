import { describe, expect, it } from "vitest";
import { classifyAnalysisFailure, toAnalysisFailure } from "./analysis-failure";

describe("analysis failure classification", () => {
  it("keeps a code the pipeline already threw", () => {
    expect(classifyAnalysisFailure(new Error("MODEL_CREDENTIAL_REQUIRED"))).toBe("MODEL_CREDENTIAL_REQUIRED");
    expect(classifyAnalysisFailure(new Error("ANALYSIS_ALREADY_RUNNING"))).toBe("ANALYSIS_ALREADY_RUNNING");
  });

  /* 코드 뒤에 단계 이름이 붙어 오는 자리가 있다. 코드만 남겨야 화면이 읽는다.
   * 종전에는 `:source-scan` 이 붙어 renderer 분류기가 통째로 놓쳤다. */
  it("drops the detail suffix so the code stays readable", () => {
    expect(classifyAnalysisFailure(new Error("SOURCE_EVIDENCE_POLICY_UNAVAILABLE:source-scan")))
      .toBe("SOURCE_EVIDENCE_POLICY_UNAVAILABLE");
  });

  /* 실측: 로컬 엔드포인트가 닿지 않을 때 Pi SDK 는 "Connection error." 를 던졌고,
   * 화면에는 「분류되지 않음」이 떴다. */
  it("names a provider failure instead of leaving it unclassified", () => {
    expect(classifyAnalysisFailure(new Error("Connection error."))).toBe("MODEL_ENDPOINT_UNREACHABLE");
    expect(classifyAnalysisFailure(new Error("fetch failed"))).toBe("MODEL_ENDPOINT_UNREACHABLE");
    expect(classifyAnalysisFailure(new Error("connect ECONNREFUSED 127.0.0.1:9"))).toBe("MODEL_ENDPOINT_UNREACHABLE");
  });

  // provider 오류와 artifact/schema 오류를 한 코드로 합치지 않는다.
  it("separates the provider failures a user can act on differently", () => {
    expect(classifyAnalysisFailure(new Error("request failed with status 401"))).toBe("MODEL_CREDENTIAL_REJECTED");
    expect(classifyAnalysisFailure(new Error("429 Too Many Requests"))).toBe("MODEL_RATE_LIMITED");
    expect(classifyAnalysisFailure(new Error("socket hang up: timed out"))).toBe("MODEL_REQUEST_TIMEOUT");
  });

  it("falls back to one stage code when the shape is unknown", () => {
    expect(classifyAnalysisFailure(new Error("무엇인가 잘못됐습니다"))).toBe("ANALYSIS_STAGE_FAILED");
    expect(classifyAnalysisFailure(undefined)).toBe("ANALYSIS_STAGE_FAILED");
    expect(classifyAnalysisFailure(new Error(""))).toBe("ANALYSIS_STAGE_FAILED");
  });

  /* 이것이 이 경계의 존재 이유다. provider 응답 본문, stack trace, 내부 경로,
   * 자격증명이 renderer 로 건너가면 안 된다. */
  it("never carries the original text across the boundary", () => {
    const leaky = new Error(
      'Connection error.\n    at promptWithFailurePropagation (file:///Users/a11769/Desktop/master-project/apps/desktop/out/main/index.js:159472:49)',
    );
    const thrown = toAnalysisFailure(leaky);

    expect(thrown.message).toBe("MODEL_ENDPOINT_UNREACHABLE");
    expect(thrown.message).not.toContain("at ");
    expect(thrown.message).not.toContain("/Users/");
    expect(thrown.message).not.toContain("index.js");
    // cause 를 붙이면 원문이 다시 따라간다.
    expect((thrown as Error & { cause?: unknown }).cause).toBeUndefined();
  });

  it("does not leak a credential that appeared in the message", () => {
    const thrown = toAnalysisFailure(new Error("401 unauthorized: Authorization: Bearer sk-live-abcdef"));

    expect(thrown.message).toBe("MODEL_CREDENTIAL_REJECTED");
    expect(thrown.message).not.toContain("sk-live");
  });
});
