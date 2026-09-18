import type { CSSProperties } from "react";
import type { RunSummary } from "../desktop";
import { formatDateTime } from "../format";
import { Icon } from "./Icon";

/* 「생성 이력」 탭. 목업 S6 의 `.rows.tbl` 레이아웃을 따른다.
 *
 * 목록의 원천은 `.scenarioforge/runs` 다. renderer 저장소를 쓰지 않으므로 다른
 * 기기나 새 프로필에서도 디스크에 있는 run 이 그대로 보인다.
 *
 * 표시하는 값은 산출물에서 센 것만이다. 소요 시간은 디스크에 남지 않으므로
 * 표시하지 않는다. 없는 동작(다시 생성·삭제·이어서 실행)도 자리를 만들지 않는다.
 */

type Props = {
  runs: RunSummary[];
  onOpen: (run: RunSummary) => void;
};

const COLS: CSSProperties = {
  "--cols": "28px minmax(0,1fr) 96px 88px 108px 96px",
} as CSSProperties;

/* 산출물이 없는 칸은 「대기」로 둔다. 0 으로 채우면 아무것도 안 나온 것과
 * 아직 안 만든 것을 구별할 수 없다. */
function Metric({ icon, value, unit }: { icon: "i-db" | "i-book" | "i-route"; value?: number; unit: string }) {
  if (value === undefined) {
    return (
      <span className="metric mut">
        <Icon name={icon} size="sm" />
        대기
      </span>
    );
  }
  return (
    <span className="metric">
      <Icon name={icon} size="sm" />
      <b>{value}</b> {unit}
    </span>
  );
}

export function GenerationHistory({ runs, onOpen }: Props) {
  return (
    <>
      <div className="between hd">
        <div>
          <span className="eyebrow">GENERATION HISTORY</span>
          <h1 className="h1">생성 이력</h1>
          <p className="sub" style={{ marginTop: 6 }}>
            분석 실행마다 하나의 run 이 만들어집니다. 이전 run 은 삭제할 때까지 보존됩니다.
          </p>
        </div>
        <div className="end">
          <span className="pill">
            <Icon name="i-db" size="sm" />
            <code>.scenarioforge/runs</code>
          </span>
        </div>
      </div>

      {runs.length === 0 ? (
        <div className="card flat">
          <div className="empty">
            <span className="ic">
              <Icon name="sf-scenario" />
            </span>
            <h3>아직 생성 이력이 없습니다</h3>
            <p>개요에서 첫 분석을 시작하면 결과가 이곳에 기록됩니다.</p>
          </div>
        </div>
      ) : (
        <div className="card" style={{ overflow: "hidden" }}>
          <div className="rows tbl" style={COLS}>
            {runs.map((run) => (
              <button
                className="row"
                type="button"
                key={run.runId}
                disabled={!run.complete}
                onClick={() => onOpen(run)}
              >
                <span className={`mark ${run.complete ? "ok" : "warn"}`}>
                  <Icon name={run.complete ? "i-check" : "i-help"} size="sm" />
                </span>
                <span className="row-main">
                  <strong>
                    <span className="t">{formatDateTime(run.createdAt, "생성 시각 미기록")}</span>
                    <span className={`chip ${run.complete ? "ok" : "warn"}`}>
                      <Icon name={run.complete ? "i-check" : "i-help"} />
                      {run.complete ? "완료" : "불완전"}
                    </span>
                  </strong>
                  <span>
                    <code title={run.runId}>{run.runId}</code>
                    {run.complete ? "" : " · 시나리오 산출물이 등록되지 않아 열 수 없습니다"}
                  </span>
                </span>
                <Metric icon="i-db" {...(run.facts !== undefined ? { value: run.facts } : {})} unit="fact" />
                <Metric icon="i-book" {...(run.wikiPages !== undefined ? { value: run.wikiPages } : {})} unit="wiki" />
                <Metric
                  icon="i-route"
                  {...(run.scenarios !== undefined ? { value: run.scenarios } : {})}
                  unit="시나리오"
                />
                <span className="end">
                  {run.complete && (
                    <span className="btn sm">
                      열기
                      <Icon name="i-right" size="sm" />
                    </span>
                  )}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
