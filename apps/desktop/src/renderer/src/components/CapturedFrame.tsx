import { Icon } from "./Icon";

/* 실제로 저장된 프레임 한 장을 보여준다.
 *
 * 비전 경로의 판정 근거는 원본 화면이 아니라 모델에 전송된 프레임이다.
 * 모델이 지목한 좌표를 그 프레임 위에 겹쳐야 사람이 판정을 검토할 수 있다.
 * 오버레이는 `model-input` 프레임에만 겹친다.
 *
 * 계약은 docs/screens/06-evidence.md 를 따른다.
 */

type Props = {
  /** main 이 넘긴 data URL. 없으면 자리만 표시한다. */
  dataUrl?: string;
  frame: { kind: string; round: number; size: { width: number; height: number } };
  /** 전송 프레임 좌표계의 제안 지점. 이 프레임에만 겹친다. */
  proposalPoint?: { x: number; y: number };
  maskedRegions?: ReadonlyArray<{ elementRef: string; label: string }>;
};

export const FRAME_LABELS: Record<string, string> = {
  "before-action": "조작 전",
  "model-input": "모델 전송본",
  "after-action": "조작 후 관측",
};

export function CapturedFrame({ dataUrl, frame, proposalPoint, maskedRegions = [] }: Props) {
  const label = `${FRAME_LABELS[frame.kind] ?? frame.kind} ${frame.round}회차`;
  const showOverlay = proposalPoint !== undefined && frame.kind === "model-input";

  return (
    <figure className="shot frame-shot">
      <div className="bar2">
        <i />
        <i />
        <i />
        <span>
          <Icon name="i-camera" size="sm" />
          {label} · {frame.size.width} × {frame.size.height}
        </span>
      </div>
      <div className="frame-stage">
        {dataUrl ? (
          <img src={dataUrl} alt={`${label} 화면 캡처`} width={frame.size.width} height={frame.size.height} />
        ) : (
          <p className="frame-missing" role="img" aria-label={`${label} 캡처를 불러오지 못했습니다`}>
            캡처를 불러오지 못했습니다
          </p>
        )}
        {showOverlay && (
          <span
            className="frame-marker"
            style={{
              left: `${(proposalPoint.x / frame.size.width) * 100}%`,
              top: `${(proposalPoint.y / frame.size.height) * 100}%`,
            }}
            aria-hidden="true"
          />
        )}
      </div>
      <figcaption>
        {showOverlay && (
          <span className="chip mono">
            <Icon name="i-grip" />
            제안 좌표 {proposalPoint.x}, {proposalPoint.y}
          </span>
        )}
        {maskedRegions.length > 0 && (
          <span className="chip mono">
            <Icon name="i-eye-off" />
            마스킹됨 {maskedRegions.map((region) => region.label).join(", ")}
          </span>
        )}
      </figcaption>
    </figure>
  );
}
