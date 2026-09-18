import { describe, expect, it } from "vitest";
import { __testing } from "./scenario-answer";

/* 질의 의도는 낱말로만 좁힌다. 두 의도의 낱말이 섞이면 더 구체적인 쪽이다.
 * 종전에는 「수행 결과가 어떻게 되나요」가 스텝 목록을 돌려줬다. */
describe("scenario question intent", () => {
  it.each([
    ["", "summary"],
    ["스텝이 어떻게 되나요?", "steps"],
    ["실패할 수 있는 분기는 무엇인가요?", "exception"],
    ["실행 가능한가요?", "readiness"],
    ["수행 결과가 어떻게 되나요?", "evidence"],
    ["증적은 남았나요?", "evidence"],
  ])("reads %j as %s", (question, expected) => {
    expect(__testing.intentOf(question)).toBe(expected);
  });
});
