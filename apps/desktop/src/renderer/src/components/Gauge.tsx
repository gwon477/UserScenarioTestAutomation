/* 반원 tick 게이지. 목업 S5 의 `.gauge` 를 그대로 옮긴다.
 *
 * 값은 backend 진행 이벤트만 반영한다. renderer 가 진행률을 추정하지 않는다.
 */

const TOTAL = 40;
const CX = 100;
const CY = 104;
const R1 = 62;
const R2 = 86;

type Props = {
  /** 0-100. 이 값만큼 눈금을 강조한다. */
  value: number;
  label: string;
  tone?: "prog" | "ok" | "bad";
};

export function Gauge({ value, label, tone = "prog" }: Props) {
  const clamped = Math.max(0, Math.min(100, value));
  const active = Math.round((clamped / 100) * TOTAL);

  return (
    <div className={`gauge is-${tone}`} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(clamped)}>
      <svg viewBox="0 0 200 116" aria-hidden="true">
        {Array.from({ length: TOTAL }, (_unused, index) => {
          const angle = Math.PI - (index + 0.5) * (Math.PI / TOTAL);
          return (
            <line
              key={index}
              className={index < active ? "tick on" : "tick"}
              x1={(CX + Math.cos(angle) * R1).toFixed(1)}
              y1={(CY - Math.sin(angle) * R1).toFixed(1)}
              x2={(CX + Math.cos(angle) * R2).toFixed(1)}
              y2={(CY - Math.sin(angle) * R2).toFixed(1)}
            />
          );
        })}
      </svg>
      <div className="val">
        <p className="num">
          {Math.round(clamped)}
          <u>%</u>
        </p>
      </div>
    </div>
  );
}
