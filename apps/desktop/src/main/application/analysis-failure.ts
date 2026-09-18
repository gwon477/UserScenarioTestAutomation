/* 분석 실패를 renderer 로 넘기기 전에 분류된 코드 하나로 좁힌다.
 *
 * 여기가 경계다. orchestrator 와 Pi SDK 는 provider 응답 본문("Connection
 * error."), stack trace, 내부 번들 경로가 섞인 오류를 던진다. 그것을 그대로
 * throw 하면 IPC 를 건너 renderer 까지 간다. 화면이 코드만 표시한다는 사실은
 * 그 다음 방어선일 뿐, 원문은 이미 프로세스 경계를 넘은 뒤다.
 *
 * 그래서 이 함수는 원문을 절대 돌려주지 않는다. 아는 모양이면 그 코드를,
 * 모르면 `ANALYSIS_STAGE_FAILED` 를 준다. 사용자가 재시도 가능 여부를
 * 구분할 수 있도록 provider 오류와 artifact/schema 오류를 한 코드로 합치지
 * 않는다.
 */

/** 이미 코드 모양인 메시지. 뒤에 `:detail` 이 붙어 있어도 코드만 남긴다. */
const CODE_SHAPED = /^([A-Z][A-Z0-9_]{3,})(?::|$)/;

/* provider 오류는 SDK 마다 문구가 다르다. 분류에만 쓰고 원문은 버린다. */
const PATTERNS: ReadonlyArray<{ code: string; test: RegExp }> = [
  { code: "MODEL_CREDENTIAL_REJECTED", test: /\b(401|403)\b|unauthorized|invalid api key|authentication/i },
  { code: "MODEL_RATE_LIMITED", test: /\b429\b|rate.?limit|quota/i },
  { code: "MODEL_REQUEST_TIMEOUT", test: /timeout|timed out|ETIMEDOUT|ESOCKETTIMEDOUT/i },
  { code: "MODEL_ENDPOINT_UNREACHABLE", test: /connection error|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ECONNRESET|fetch failed|network/i },
  { code: "MODEL_RESPONSE_INVALID", test: /\b(5\d\d)\b|invalid json|unexpected token/i },
];

export const ANALYSIS_FAILURE_FALLBACK = "ANALYSIS_STAGE_FAILED";

/** 원문을 담지 않는 분류 코드. 돌려주는 값은 언제나 코드 하나다. */
export function classifyAnalysisFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const trimmed = message.trim();
  if (!trimmed) return ANALYSIS_FAILURE_FALLBACK;

  const coded = CODE_SHAPED.exec(trimmed);
  if (coded) return coded[1]!;

  for (const { code, test } of PATTERNS) {
    if (test.test(trimmed)) return code;
  }
  return ANALYSIS_FAILURE_FALLBACK;
}

/* renderer 로 던질 오류. 분류된 코드만 메시지로 갖는다.
 * cause 를 붙이지 않는다 - 붙이면 원문이 다시 따라간다. */
export function toAnalysisFailure(error: unknown): Error {
  return new Error(classifyAnalysisFailure(error));
}
