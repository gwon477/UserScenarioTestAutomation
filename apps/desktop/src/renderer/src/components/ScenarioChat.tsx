import { useEffect, useRef, useState } from "react";
import { askScenarioQuestion, type SelectedDirectory } from "../desktop";
import type { ScenarioResult } from "../scenario-result";
import { Icon } from "./Icon";

type ChatMessage = {
  id: string;
  role: "assistant" | "user";
  content: string;
  /** 아직 다 드러나지 않은 답변. 흐르는 동안 커서를 붙인다. */
  streaming?: boolean;
};

/* 답변을 한 번에 붙이지 않고 조금씩 드러낸다. 조회 결과는 여러 줄이라
 * 통째로 나타나면 어디부터 읽어야 할지 알기 어렵다.
 *
 * 내용은 이미 다 받은 것이고 표시 속도만 나눈다. 모델 토큰 스트림이 아니다 -
 * 질의 답변은 main 이 정본 run 을 읽어 한 번에 만든다. 실제 스트림이 붙으면
 * 이 자리를 채널에서 오는 조각으로 바꾼다. */
const STREAM_TICK_MS = 28;
const STREAM_CHARS = 3;

type Props = {
  project: SelectedDirectory;
  result: ScenarioResult;
};

export function ScenarioChat({ project, result }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      content:
        "시나리오 결과에 대해 질문하세요. 오른쪽 케이스를 입력 영역으로 끌어오면 해당 ID를 기준으로 답변합니다.",
    },
  ]);
  const [references, setReferences] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [sending, setSending] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const streamTimer = useRef<number | null>(null);

  /* 새 글이 붙으면 아래로 따라간다. 답변이 길면 흐르는 동안 화면 밖으로
   * 밀려나 사용자가 직접 스크롤해야 한다. */
  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [messages, sending]);

  useEffect(() => () => {
    if (streamTimer.current !== null) window.clearInterval(streamTimer.current);
  }, []);

  /** 받은 답변을 조금씩 드러낸다. 다 드러나면 커서를 뗀다. */
  function streamAnswer(id: string, full: string) {
    if (streamTimer.current !== null) window.clearInterval(streamTimer.current);
    let shown = 0;
    streamTimer.current = window.setInterval(() => {
      shown = Math.min(full.length, shown + STREAM_CHARS);
      const done = shown >= full.length;
      setMessages((current) =>
        current.map((message) =>
          message.id === id
            ? { ...message, content: full.slice(0, shown), ...(done ? {} : { streaming: true }) }
            : message,
        ),
      );
      if (done && streamTimer.current !== null) {
        window.clearInterval(streamTimer.current);
        streamTimer.current = null;
      }
    }, STREAM_TICK_MS);
  }

  function addReference(id: string) {
    /* 업무 코드 길이는 업무 분류마다 다르다. 세 글자로 고정하면 SCN-LEDGER-001
     * 같은 정본 ID 를 끌어다 놓아도 참조가 붙지 않는다. */
    if (!/^SCN-[A-Z0-9]+-\d{3}$/.test(id)) return;
    setReferences((current) => (current.includes(id) ? current : [...current, id]));
  }

  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragOver(false);
    const id =
      event.dataTransfer.getData("application/x-scenarioforge-id") ||
      event.dataTransfer.getData("text/plain").replaceAll("`", "");
    addReference(id);
  }

  async function handleSend() {
    const question = draft.trim();
    if (!question && references.length === 0) return;

    const serializedReferences = references.map((id) => `\`${id}\``).join(" ");
    const userContent = [serializedReferences, question].filter(Boolean).join(" ");
    setMessages((current) => [
      ...current,
      { id: crypto.randomUUID(), role: "user", content: userContent },
    ]);
    setDraft("");
    setSending(true);

    try {
      const response = await askScenarioQuestion({
        project,
        runId: result.runId,
        scenarioIds: references,
        question,
      });
      const id = crypto.randomUUID();
      setMessages((current) => [
        ...current,
        { id, role: "assistant", content: "", streaming: true },
      ]);
      streamAnswer(id, response);
      setReferences([]);
    } catch {
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: "질의 요청을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.",
        },
      ]);
    } finally {
      setSending(false);
    }
  }

  return (
    <aside className="panel" aria-labelledby="scenario-chat-title">
      <div className="panel-h">
        <Icon name="i-msg" size="sm" />
        <h2 className="h3" id="scenario-chat-title">
          시나리오 질의
        </h2>
      </div>

      <div className="chat-s" aria-live="polite" aria-busy={sending} ref={logRef}>
        {messages.map((message) => (
          <div key={message.id} className={`msg${message.role === "user" ? " me" : ""}`}>
            <b>{message.role === "assistant" ? "FORGE" : "YOU"}</b>
            {/* 조회 결과는 여러 줄이다. 줄바꿈을 지워 한 덩어리로 만들지 않는다. */}
            <p className={`msg-body${message.streaming ? " streaming" : ""}`}>{message.content}</p>
          </div>
        ))}
        {sending && (
          <div className="msg">
            <b>FORGE</b>
            <p>시나리오 원천과 세부 스텝을 확인하고 있습니다.</p>
          </div>
        )}
      </div>

      <div
        className="comp"
        onDragOver={(event) => {
          event.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
      >
        <p className={`drop${dragOver ? " over" : ""}`}>
          <Icon name="i-grip" size="sm" />
          {dragOver ? "여기에 놓아 시나리오를 참조합니다." : "시나리오 케이스를 끌어다 놓으세요."}
        </p>

        {references.length > 0 && (
          <div className="refs" aria-label="참조할 시나리오">
            {references.map((id) => (
              <span className="tag" key={id}>
                <span>{id}</span>
                <button
                  className="btn link"
                  type="button"
                  onClick={() => setReferences((current) => current.filter((item) => item !== id))}
                  aria-label={`${id} 참조 제거`}
                >
                  <Icon name="i-x" size="sm" />
                </button>
              </span>
            ))}
          </div>
        )}

        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void handleSend();
            }
          }}
          placeholder="예: 실패할 수 있는 분기는 무엇인가요?"
          aria-label="시나리오 질문"
          rows={2}
        />
        <div className="snd">
          <button
            className="btn sm"
            type="button"
            onClick={() => void handleSend()}
            disabled={sending || (!draft.trim() && references.length === 0)}
            title={!draft.trim() && references.length === 0 ? "질문이나 시나리오 참조를 입력하세요." : undefined}
          >
            <Icon name="i-send" size="sm" />
            보내기
          </button>
        </div>
      </div>
    </aside>
  );
}
