import { useState } from "react";
import { MessageSquareText, Send, X } from "lucide-react";
import { askScenarioQuestion, type SelectedDirectory } from "../desktop";
import type { ScenarioResult } from "../scenario-result";

type ChatMessage = {
  id: string;
  role: "assistant" | "user";
  content: string;
};

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

  function addReference(id: string) {
    if (!/^SCN-[A-Z]{3}-\d{3}$/.test(id)) return;
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
      setMessages((current) => [
        ...current,
        { id: crypto.randomUUID(), role: "assistant", content: response },
      ]);
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
    <aside className="scenario-chat" aria-labelledby="scenario-chat-title">
      <header className="chat-header">
        <div>
          <span className="eyebrow">SCENARIO CHAT</span>
          <h2 id="scenario-chat-title">시나리오 질의</h2>
        </div>
        <MessageSquareText size={20} aria-hidden="true" />
      </header>

      <div className="chat-messages" aria-live="polite" aria-busy={sending}>
        {messages.map((message) => (
          <div key={message.id} className={`chat-message is-${message.role}`}>
            <span>{message.role === "assistant" ? "FORGE" : "YOU"}</span>
            <p>{message.content}</p>
          </div>
        ))}
        {sending && (
          <div className="chat-message is-assistant is-thinking">
            <span>FORGE</span>
            <p>시나리오 원천과 세부 스텝을 확인하고 있습니다.</p>
          </div>
        )}
      </div>

      <div
        className={`chat-composer${dragOver ? " is-drag-over" : ""}`}
        onDragOver={(event) => {
          event.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
      >
        <span className="drop-hint">
          {dragOver ? "여기에 놓아 시나리오를 참조합니다." : "시나리오 케이스를 끌어다 놓으세요."}
        </span>

        {references.length > 0 && (
          <div className="chat-references" aria-label="참조할 시나리오">
            {references.map((id) => (
              <code key={id}>
                {`\`${id}\``}
                <button
                  type="button"
                  onClick={() =>
                    setReferences((current) => current.filter((item) => item !== id))
                  }
                  aria-label={`${id} 참조 제거`}
                >
                  <X size={13} aria-hidden="true" />
                </button>
              </code>
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
          rows={3}
        />
        <button
          className="chat-send"
          type="button"
          onClick={() => void handleSend()}
          disabled={sending || (!draft.trim() && references.length === 0)}
          title={!draft.trim() && references.length === 0 ? "질문이나 시나리오 참조를 입력하세요." : undefined}
          aria-label="질문 보내기"
        >
          <Send size={17} aria-hidden="true" />
        </button>
      </div>
    </aside>
  );
}
