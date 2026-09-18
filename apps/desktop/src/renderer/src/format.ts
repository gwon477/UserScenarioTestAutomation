/* 목록에서 쓰는 표시 형식.
 *
 * 목업은 「2026. 9. 7. 15:42」 처럼 24시간제이고 초를 쓰지 않는다. 목록에서 초는
 * 결정에 쓰이지 않으면서 컬럼 폭만 먹는다. 화면마다 다른 형식을 쓰면 같은
 * 시각이 다르게 보인다.
 */

const DATE_TIME = new Intl.DateTimeFormat("ko-KR", {
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function formatDateTime(value?: string, fallback = "시각 미기록"): string {
  if (!value) return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : DATE_TIME.format(parsed);
}

/** 목록 헤더의 합계용. 값 크기에 단위를 맞춘다. */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}
