import { describe, expect, it } from "vitest";
import { classifyAnalysisError } from "./analysis-error";

describe("analysis error classification", () => {
  it("keeps the classified code main threw", () => {
    expect(classifyAnalysisError(new Error("MODEL_CREDENTIAL_REQUIRED"))).toBe(
      "MODEL_CREDENTIAL_REQUIRED",
    );
    // Electron 은 IPC 를 건너온 오류 앞에 자기 문맥을 붙인다.
    expect(
      classifyAnalysisError(new Error("Error invoking remote method 'x': Error: ANALYSIS_ALREADY_RUNNING")),
    ).toBe("ANALYSIS_ALREADY_RUNNING");
  });

  it("shows nothing when the message is not a classified code", () => {
    // provider 응답 본문·stack trace·프롬프트 원문이 화면으로 새지 않아야 한다.
    for (const raw of [
      "request failed with status 429: {\"error\":{\"message\":\"quota\"}}",
      "at Object.<anonymous> (/Users/me/app.js:12:7)",
      "Authorization: Bearer sk-live-abcdef",
      "",
    ]) {
      expect(classifyAnalysisError(new Error(raw))).toBeUndefined();
    }
  });

  it("ignores a value that is not an error", () => {
    expect(classifyAnalysisError(undefined)).toBeUndefined();
    expect(classifyAnalysisError({ message: "MODEL_SETTINGS_REQUIRED" })).toBeUndefined();
  });
});

/* 두 경계가 갈라지면 화면은 다시 「분류되지 않음」을 띄운다. main 이 낼 수 있는
 * 코드는 전부 renderer 분류기를 통과해야 한다. */
describe("main and renderer classifiers agree", () => {
  it("classifies every code the main boundary can emit", async () => {
    const { classifyAnalysisFailure } = await import(
      "../../main/application/analysis-failure"
    );

    const raw = [
      new Error("Connection error."),
      new Error("request failed with status 401"),
      new Error("429 Too Many Requests"),
      new Error("socket hang up: timed out"),
      new Error("SOURCE_EVIDENCE_POLICY_UNAVAILABLE:source-scan"),
      new Error("무엇인가 잘못됐습니다"),
    ];

    for (const error of raw) {
      const code = classifyAnalysisFailure(error);
      // main 이 던지면 Electron 이 IPC 문맥을 앞에 붙인다.
      const crossed = new Error(`Error invoking remote method 'analysis:start': Error: ${code}`);
      expect(classifyAnalysisError(crossed)).toBe(code);
    }
  });
});
