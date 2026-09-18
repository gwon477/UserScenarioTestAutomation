/* 분석 실패를 화면에 표시할 형태로 좁힌다.
 *
 * main 은 분류된 코드(`MODEL_CREDENTIAL_REQUIRED` 등)를 그대로 던진다. 그 모양이
 * 아니면 아무것도 표시하지 않는다. provider 응답 본문, stack trace, 프롬프트
 * 원문이 화면과 로그로 흘러나가지 않게 하는 경계다.
 */

const CODE = /(?:^|[^A-Z0-9_])([A-Z][A-Z0-9_]{3,})\s*$/;

export function classifyAnalysisError(error: unknown): string | undefined {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return CODE.exec(message)?.[1];
}
