import { useState } from "react";
import {
  REVIEW_CAUSE_TAG_OPTIONS,
  REVIEW_DECISION_OPTIONS,
  type HumanReviewView,
  type ReviewCauseTag,
  type ReviewDecision,
} from "../../../shared/evidence";
import { Icon } from "./Icon";

/* 사람 검토 스레드. 목업의 질의 패널(`.msg` / `.comp`) 어휘를 쓴다.
 *
 * 자동 판정을 덮어쓰지 않는다. 판정 배지 옆에 덧붙는 기록이고, 원인 태그가
 * 생성 트랙에 올릴 계약 요청의 신호가 된다.
 *
 * modal 로 만들지 않는다. 기록하는 동안 증적을 계속 봐야 한다.
 *
 * 계약은 docs/screens/06-evidence.md 를 따른다.
 */

type Props = {
  reviews: readonly HumanReviewView[];
  author: string;
  onAuthorChange: (author: string) => void;
  onSubmit: (input: { decision: ReviewDecision; causeTag?: ReviewCauseTag; note: string }) => Promise<void>;
};

function reviewTime(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

export function StepReviewThread({ reviews, author, onAuthorChange, onSubmit }: Props) {
  const [decision, setDecision] = useState<ReviewDecision>("동의");
  const [causeTag, setCauseTag] = useState<ReviewCauseTag | "">("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const canSubmit = author.trim().length > 0 && !saving;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    setError(undefined);
    setSaved(false);
    try {
      await onSubmit({ decision, ...(causeTag ? { causeTag } : {}), note: note.trim() });
      setNote("");
      setCauseTag("");
      setSaved(true);
    } catch {
      setError("검토 기록을 저장하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="review" aria-labelledby="step-review-title">
      <h3 className="h3" id="step-review-title">
        <Icon name="i-msg" size="sm" />
        사람 검토
        <span className="chip mono">{reviews.length}</span>
      </h3>
      <p className="note">자동 판정은 그대로 남습니다. 검토는 덧붙는 기록입니다.</p>

      {reviews.length > 0 && (
        <ol className="review-log">
          {reviews.map((review) => (
            <li key={review.reviewId}>
              <b>
                {review.decision}
                {review.causeTag && <span className="chip warn">{review.causeTag}</span>}
                <small>
                  {review.author} · {reviewTime(review.at)}
                </small>
              </b>
              {review.note && <p>{review.note}</p>}
            </li>
          ))}
        </ol>
      )}

      <form onSubmit={handleSubmit}>
        <label className="field" htmlFor="review-author">
          <span className="lb">검토자</span>
          <input
            className="inp"
            id="review-author"
            type="text"
            value={author}
            onChange={(event) => onAuthorChange(event.target.value)}
            autoComplete="off"
          />
        </label>

        <fieldset className="fs">
          <legend>판단</legend>
          <div className="opts">
            {REVIEW_DECISION_OPTIONS.map((option) => (
              <label className={`opt${decision === option ? " on" : ""}`} key={option}>
                <input
                  type="radio"
                  name="review-decision"
                  value={option}
                  checked={decision === option}
                  onChange={() => setDecision(option)}
                />
                <span>{option}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <label className="field" htmlFor="review-cause">
          <span className="lb">원인</span>
          <select
            className="inp"
            id="review-cause"
            value={causeTag}
            onChange={(event) => setCauseTag(event.target.value as ReviewCauseTag | "")}
          >
            <option value="">선택하지 않음</option>
            {REVIEW_CAUSE_TAG_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>

        <label className="field" htmlFor="review-note">
          <span className="lb">메모</span>
          <textarea
            id="review-note"
            rows={3}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={2000}
          />
        </label>

        <div className="cta-row">
          <button className="btn pri sm" type="submit" disabled={!canSubmit}>
            <Icon name="i-send" size="sm" />
            검토 기록 저장
          </button>
          {author.trim().length === 0 && (
            <span className="cta-why">
              <Icon name="i-alert" size="sm" />
              검토자를 입력하세요.
            </span>
          )}
        </div>

        {saved && (
          <p className="notice" style={{ marginTop: 10 }} role="status">
            <Icon name="i-check" size="sm" />
            <span>검토를 기록했습니다.</span>
          </p>
        )}
        {error && (
          <p className="cta-why" style={{ marginTop: 10 }} role="alert">
            <Icon name="i-alert" size="sm" />
            {error}
          </p>
        )}
      </form>
    </section>
  );
}
