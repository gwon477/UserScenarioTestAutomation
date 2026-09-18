import type { CSSProperties } from "react";
import { useMemo, useState } from "react";
import type { EvidenceLibraryEntry, EvidenceLibraryView } from "../../../shared/evidence-library";
import { Icon } from "./Icon";
import type { IconName } from "./IconSprite";

/* 증적 목록과 필터.
 *
 * 실행이 반복되면 목록만으로는 못 찾는다. 사용자가 「어느 실행에 그 실패가
 * 있었지」를 기억하게 만들지 않는다. 선택지가 적은 축은 전부 보이는 라디오로
 * 두고, 개수가 변하는 축만 목록으로 접는다.
 *
 * 목록은 «실행 -> 시나리오 케이스 -> 단계»로 묶는다. 증적은 한 번의 실행에
 * 속하고, 평평한 목록은 그 소속을 지운다. 필터는 묶음 위에서 그대로 걸린다.
 *
 * causeTag 집계가 생성 트랙에 올릴 계약 요청의 신호다.
 *
 * 계약은 docs/screens/06-evidence.md 를 따른다.
 */

type Props = {
  library: EvidenceLibraryView;
  /* 목록은 프로젝트 범위라 항목마다 소속 run 이 다르다. run 을 함께 넘겨야
   * 정본 증적을 어느 트리에서 읽을지 정할 수 있다. */
  onOpenStepEvidence: (runId: string, executionId: string, scenarioId: string, order: number) => void;
};

type VerdictFilter = "all" | EvidenceLibraryEntry["verdict"];
type ReviewFilter = "all" | "reviewed" | "unreviewed";

const verdicts: Record<EvidenceLibraryEntry["verdict"], { label: string; tone: string; icon: IconName }> = {
  PASSED: { label: "성공", tone: "ok", icon: "i-check" },
  FAILED: { label: "실패", tone: "bad", icon: "i-alert" },
  INCONCLUSIVE: { label: "확인 필요", tone: "warn", icon: "i-help" },
};

const verdictOptions: readonly { value: VerdictFilter; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "PASSED", label: "성공" },
  { value: "FAILED", label: "실패" },
  { value: "INCONCLUSIVE", label: "확인 필요" },
];

const reviewOptions: readonly { value: ReviewFilter; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "unreviewed", label: "미검토" },
  { value: "reviewed", label: "검토됨" },
];

/* 사유 코드가 가장 긴 축이다. `ACTION_OUTCOME_UNKNOWN` 이 잘리면 어떤 사유인지
 * 읽을 수 없고, 사유는 이 목록에서 가장 행동 가능한 정보다. */
const COLS: CSSProperties = {
  "--cols": "28px minmax(0,1fr) 196px 68px 68px 148px",
} as CSSProperties;

const formatBytes = (bytes: number): string =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

export function EvidenceLibraryTable({ library, onOpenStepEvidence }: Props) {
  const [verdict, setVerdict] = useState<VerdictFilter>("all");
  const [review, setReview] = useState<ReviewFilter>("all");
  const [reasonCode, setReasonCode] = useState("all");
  const [causeTag, setCauseTag] = useState("all");
  const [scenarioQuery, setScenarioQuery] = useState("");

  const reasonCodes = Object.keys(library.totals.reasonCodes).sort();
  const causeTags = Object.keys(library.totals.causeTags).sort();

  const rows = useMemo(
    () =>
      library.entries.filter((entry) => {
        if (verdict !== "all" && entry.verdict !== verdict) return false;
        if (review === "reviewed" && entry.reviewCount === 0) return false;
        if (review === "unreviewed" && entry.reviewCount > 0) return false;
        if (reasonCode !== "all" && entry.reasonCode !== reasonCode) return false;
        if (causeTag !== "all" && !entry.causeTags.includes(causeTag as never)) return false;
        if (
          scenarioQuery.trim() &&
          !entry.scenarioId.toLowerCase().includes(scenarioQuery.trim().toLowerCase())
        ) {
          return false;
        }
        return true;
      }),
    [library.entries, verdict, review, reasonCode, causeTag, scenarioQuery],
  );

  /* 실행 -> 케이스 묶음. 목록 순서(최신 실행 우선)를 그대로 따른다. */
  const groups = useMemo(() => {
    const byExecution = new Map<
      string,
      { executionId: string; runId: string; steps: number; bytes: number; cases: Array<{ scenarioId: string; entries: EvidenceLibraryEntry[] }> }
    >();
    for (const entry of rows) {
      let group = byExecution.get(entry.executionId);
      if (!group) {
        group = { executionId: entry.executionId, runId: entry.runId, steps: 0, bytes: 0, cases: [] };
        byExecution.set(entry.executionId, group);
      }
      group.steps += 1;
      group.bytes += entry.bytes;
      let caseGroup = group.cases.find((candidate) => candidate.scenarioId === entry.scenarioId);
      if (!caseGroup) {
        caseGroup = { scenarioId: entry.scenarioId, entries: [] };
        group.cases.push(caseGroup);
      }
      caseGroup.entries.push(entry);
    }
    for (const group of byExecution.values()) {
      for (const caseGroup of group.cases) caseGroup.entries.sort((left, right) => left.order - right.order);
    }
    return [...byExecution.values()];
  }, [rows]);

  return (
    <section aria-labelledby="library-table-title">
      {causeTags.length > 0 && (
        <div className="notice" style={{ marginBottom: 14 }}>
          <Icon name="i-msg" size="sm" />
          <div>
            <b>검토 원인</b>
            <div className="opts" style={{ margin: "8px 0" }}>
              {causeTags.map((tag) => (
                <button
                  className={`chip${tag === causeTag ? " bad" : " mono"}`}
                  style={{ height: 22 }}
                  type="button"
                  key={tag}
                  aria-pressed={tag === causeTag}
                  onClick={() => setCauseTag(tag === causeTag ? "all" : tag)}
                >
                  {tag}
                  <b>{library.totals.causeTags[tag]}</b>
                </button>
              ))}
            </div>
            같은 원인이 반복되면 개별 케이스가 아니라 생성 산출물을 고쳐야 합니다.
          </div>
        </div>
      )}

      <div className="card" style={{ overflow: "hidden" }}>
        <div className="card-h">
          <h2 className="h3" id="library-table-title">
            저장된 증적
          </h2>
          <span className="end">
            <span className="chip mono">
              {rows.length} / {library.totals.steps}
            </span>
            {/* 검토 진행도는 필터와 같은 맥락에 둔다. 무엇이 아직 안 봤는지가
              * 다음에 무엇을 할지를 정한다. */}
            <span className={`chip ${library.totals.reviewed === library.totals.steps ? "ok" : "idle"}`}>
              <Icon name="i-msg" />
              검토 {library.totals.reviewed}/{library.totals.steps}
            </span>
          </span>
        </div>

        <div className="card-b filters">
          <fieldset>
            <legend className="lb">판정</legend>
            <div className="opts">
              {verdictOptions.map((option) => (
                <label className={`opt${verdict === option.value ? " on" : ""}`} key={option.value}>
                  <input
                    type="radio"
                    name="library-verdict"
                    checked={verdict === option.value}
                    onChange={() => setVerdict(option.value)}
                  />
                  <span>{option.label}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className="lb">검토 상태</legend>
            <div className="opts">
              {reviewOptions.map((option) => (
                <label className={`opt${review === option.value ? " on" : ""}`} key={option.value}>
                  <input
                    type="radio"
                    name="library-review"
                    checked={review === option.value}
                    onChange={() => setReview(option.value)}
                  />
                  <span>{option.label}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <label className="field" style={{ marginBottom: 0 }} htmlFor="library-reason">
            <span className="lb">사유 코드</span>
            <select
              className="inp"
              id="library-reason"
              value={reasonCode}
              onChange={(event) => setReasonCode(event.target.value)}
            >
              <option value="all">전체</option>
              {reasonCodes.map((code) => (
                <option key={code} value={code}>
                  {code} ({library.totals.reasonCodes[code]})
                </option>
              ))}
            </select>
          </label>
          <label className="field" style={{ marginBottom: 0 }} htmlFor="library-scenario">
            <span className="lb">케이스 ID</span>
            <input
              className="inp"
              id="library-scenario"
              type="search"
              value={scenarioQuery}
              onChange={(event) => setScenarioQuery(event.target.value)}
              placeholder="SCN-"
            />
          </label>
        </div>

        {rows.length === 0 ? (
          <div className="empty" role="status">
            <span className="ic">
              <Icon name="i-filter" />
            </span>
            <h3>조건에 맞는 증적이 없습니다</h3>
            <p>판정·검토 상태·사유 코드를 넓혀 보세요.</p>
          </div>
        ) : (
          <div className="rows tbl" style={COLS}>
            {groups.map((group) => (
              <div key={group.executionId}>
                {/* 증적이 어느 실행에 속하는지 묶음 머리말이 말한다. */}
                <div className="ev-gp">
                  <b>{group.executionId}</b>
                  <code className="path">{group.runId}</code>
                  <small>
                    케이스 {group.cases.length} · 단계 {group.steps} · {formatBytes(group.bytes)}
                  </small>
                </div>
                {group.cases.map((caseGroup) => (
                  <div key={caseGroup.scenarioId}>
                    <div className="ev-case">
                      <code>{caseGroup.scenarioId}</code>
                      <small>
                        {caseGroup.entries.length} 단계 ·{" "}
                        {formatBytes(caseGroup.entries.reduce((total, entry) => total + entry.bytes, 0))}
                      </small>
                    </div>
                    {caseGroup.entries.map((entry) => {
              const tone = verdicts[entry.verdict];
              return (
                <button
                  className="row"
                  type="button"
                  key={`${entry.executionId}-${entry.stepId}`}
                  onClick={() => onOpenStepEvidence(entry.runId, entry.executionId, entry.scenarioId, entry.order)}
                >
                  <span className={`mark ${tone.tone}`}>
                    <Icon name={tone.icon} size="sm" />
                  </span>
                  <span className="row-main">
                    <strong>
                      <span className="t">{entry.stepId}</span>
                      <span className={`chip ${tone.tone}`}>
                        <Icon name={tone.icon} />
                        {tone.label}
                      </span>
                    </strong>
                    <span>{`단계 ${String(entry.order).padStart(2, "0")}`}</span>
                  </span>
                  <span className="metric">
                    {entry.reasonCode ? <code>{entry.reasonCode}</code> : <span className="mut">사유 없음</span>}
                  </span>
                  <span className="metric">
                    <Icon name="i-images" size="sm" />
                    <b>{entry.frameCount}</b>장
                  </span>
                  <span className="metric">{formatBytes(entry.bytes)}</span>
                  <span className="metric r">
                    {entry.reviewCount > 0 ? (
                      <>
                        <Icon name="i-msg" size="sm" />
                        검토 {entry.reviewCount}
                        {(entry.causeTags[0] ?? entry.decisions[0]) && ` · ${entry.causeTags[0] ?? entry.decisions[0]}`}
                      </>
                    ) : (
                      <span className="mut">미검토</span>
                    )}
                  </span>
                </button>
              );
                    })}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
