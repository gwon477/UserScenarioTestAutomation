import {
  ArrowUpRight,
  BookOpenText,
  CheckCircle2,
  Clock3,
  Workflow,
} from "lucide-react";

export type GenerationRecord = {
  id: string;
  createdAt: string;
  duration: string;
  factCount: number;
  wikiPages: number;
  scenarios: number;
};

type Props = {
  records: GenerationRecord[];
  onOpen: (record: GenerationRecord) => void;
};

export function GenerationHistory({ records, onOpen }: Props) {
  return (
    <section className="history-section" aria-labelledby="history-title">
      <header className="section-header">
        <div>
          <span className="eyebrow">GENERATION HISTORY</span>
          <h2 id="history-title">생성 이력</h2>
        </div>
        <span className="history-count">{records.length}건</span>
      </header>

      {records.length === 0 ? (
        <div className="history-empty">
          <BookOpenText size={22} aria-hidden="true" />
          <div>
            <strong>아직 생성 이력이 없습니다.</strong>
            <span>첫 분석을 시작하면 결과가 이곳에 기록됩니다.</span>
          </div>
        </div>
      ) : (
        <div className="history-list">
          {records.map((record, index) => (
            <button
              className="history-card"
              type="button"
              key={record.id}
              onClick={() => onOpen(record)}
            >
              <span className="history-sequence">RUN {String(records.length - index).padStart(2, "0")}</span>
              <span className="history-main">
                <strong>시나리오 정보 셋</strong>
                <span>{record.createdAt}</span>
              </span>
              <span className="history-metric">
                <BookOpenText size={16} aria-hidden="true" /> Wiki {record.wikiPages}
              </span>
              <span className="history-metric">
                <Workflow size={16} aria-hidden="true" /> Scenario {record.scenarios}
              </span>
              <span className="history-metric">
                <Clock3 size={16} aria-hidden="true" /> {record.duration}
              </span>
              <span className="history-status">
                <CheckCircle2 size={16} aria-hidden="true" /> 완료
              </span>
              <ArrowUpRight className="history-open" size={19} aria-hidden="true" />
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
