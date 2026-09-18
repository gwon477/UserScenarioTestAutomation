import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const source = () => readFile(new URL("./ScenarioChat.tsx", import.meta.url), "utf8");

describe("scenario chat answer", () => {
  /* 조회 결과는 여러 줄이라 통째로 나타나면 어디부터 읽어야 할지 알기 어렵다.
   * 표시 속도만 나눈다 - 모델 토큰 스트림이 아니라는 것을 주석이 말해야 한다. */
  it("reveals the answer progressively instead of pasting it at once", async () => {
    const code = await source();

    expect(code).toContain("streamAnswer(id, response)");
    expect(code).toContain("full.slice(0, shown)");
    expect(code).toContain("모델 토큰 스트림이 아니다");
  });

  // 답변이 길면 흐르는 동안 화면 밖으로 밀려난다. 아래로 따라가야 한다.
  it("follows the log to the bottom while the answer grows", async () => {
    const code = await source();

    expect(code).toContain("logRef");
    expect(code).toContain("log.scrollTop = log.scrollHeight");
    expect(code).toContain("}, [messages, sending]);");
  });

  it("stops the reveal when the panel goes away", async () => {
    const code = await source();

    // 타이머를 남기면 사라진 컴포넌트에 setState 가 걸린다.
    expect(code).toContain("window.clearInterval(streamTimer.current)");
    expect(code).toMatch(/useEffect\(\(\) => \(\) => \{/);
  });

  it("shows a cursor only while the answer is still arriving", async () => {
    const code = await source();

    expect(code).toContain('message.streaming ? " streaming" : ""');
    const css = await readFile(new URL("../styles/system.css", import.meta.url), "utf8");
    expect(css).toContain(".msg p.msg-body.streaming::after");
    // 움직임을 줄이라는 설정을 존중한다.
    expect(css).toContain("prefers-reduced-motion");
  });

  /* 업무 코드 길이는 업무 분류마다 다르다. 세 글자로 고정하면 SCN-LEDGER-001
   * 같은 정본 ID 를 끌어다 놔도 참조가 붙지 않는다. */
  it("accepts a scenario id whose business code is longer than three letters", async () => {
    const code = await source();

    expect(code).toContain("/^SCN-[A-Z0-9]+-\\d{3}$/");
  });
});
