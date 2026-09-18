/* 목업 docs/mockups/redesign-v2.html 의 아이콘 스프라이트.
 *
 * renderer 의 유일한 아이콘 원천이다. 앱 전용 글리프(`sf-src`, `sf-gate`,
 * `sf-mask` 등)를 포함하므로 외부 아이콘 라이브러리를 함께 쓰지 않는다.
 * 심볼을 임의로 바꾸지 않는다.
 *
 * 한 번만 렌더하고 각 아이콘은 `<Icon name="i-camera" />` 로 참조한다.
 */

export type IconName =
  | "i-forge"
  | "i-folder"
  | "i-plus"
  | "i-right"
  | "i-down"
  | "i-up"
  | "i-arrow-r"
  | "i-arrow-l"
  | "i-more"
  | "i-check"
  | "i-alert"
  | "i-circle"
  | "i-help"
  | "i-loader"
  | "i-square"
  | "i-camera"
  | "i-eye"
  | "i-eye-off"
  | "i-key"
  | "i-lock"
  | "i-sliders"
  | "i-trash"
  | "i-play"
  | "i-retry"
  | "i-route"
  | "i-flask"
  | "i-images"
  | "i-board"
  | "i-db"
  | "i-file-code"
  | "i-copy"
  | "i-clock"
  | "i-x"
  | "i-search"
  | "i-shield"
  | "i-grip"
  | "i-spark"
  | "i-ext"
  | "i-unlink"
  | "i-server"
  | "i-book"
  | "i-msg"
  | "i-send"
  | "i-monitor"
  | "i-filter"
  | "i-minus"
  | "i-refresh"
  | "sf-src"
  | "sf-fact"
  | "sf-wiki"
  | "sf-scenario"
  | "sf-canonical"
  | "sf-assert"
  | "sf-gate"
  | "sf-queue"
  | "sf-evidence"
  | "sf-mask";

export function IconSprite() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
      <defs>
      <symbol id="i-forge" viewBox="0 0 24 24"><g stroke-width="3" stroke-linecap="round"><path d="M17 6H9a3 3 0 0 0 0 6h6a3 3 0 0 1 0 6H7"/><circle cx="17" cy="6" r="2.4" fill="currentColor" stroke="none"/></g></symbol>
      <symbol id="i-folder" viewBox="0 0 24 24"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></symbol>
      <symbol id="i-plus" viewBox="0 0 24 24"><path d="M5 12h14M12 5v14"/></symbol>
      <symbol id="i-right" viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></symbol>
      <symbol id="i-down" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></symbol>
      <symbol id="i-up" viewBox="0 0 24 24"><path d="m18 15-6-6-6 6"/></symbol>
      <symbol id="i-arrow-r" viewBox="0 0 24 24"><path d="M5 12h14m-7-7 7 7-7 7"/></symbol>
      <symbol id="i-arrow-l" viewBox="0 0 24 24"><path d="M19 12H5m7 7-7-7 7-7"/></symbol>
      <symbol id="i-more" viewBox="0 0 24 24"><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/><circle cx="5" cy="12" r="1.4"/></symbol>
      <symbol id="i-check" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></symbol>
      <symbol id="i-alert" viewBox="0 0 24 24"><path d="m21.7 18-8-14a2 2 0 0 0-3.4 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></symbol>
      <symbol id="i-circle" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/></symbol>
      <symbol id="i-help" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"/><path d="M12 17h.01"/></symbol>
      <symbol id="i-loader" viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-6.2-8.6"/></symbol>
      <symbol id="i-square" viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="2"/></symbol>
      <symbol id="i-camera" viewBox="0 0 24 24"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3Z"/><circle cx="12" cy="13" r="3"/></symbol>
      <symbol id="i-eye" viewBox="0 0 24 24"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></symbol>
      <symbol id="i-eye-off" viewBox="0 0 24 24"><path d="M10.7 5.1A7 7 0 0 1 12 5c6.5 0 10 7 10 7a18 18 0 0 1-2.2 3.1"/><path d="M6.6 6.6A18 18 0 0 0 2 12s3.5 7 10 7a9.6 9.6 0 0 0 4.4-1"/><path d="m2 2 20 20"/></symbol>
      <symbol id="i-key" viewBox="0 0 24 24"><circle cx="16" cy="8" r="4"/><path d="m13.2 10.8-9 9V22h2.5v-2.5H9V17h2.4l1.8-1.8"/></symbol>
      <symbol id="i-lock" viewBox="0 0 24 24"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></symbol>
      <symbol id="i-sliders" viewBox="0 0 24 24"><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1.5 14h5M9.5 8h5M17.5 16h5"/></symbol>
      <symbol id="i-trash" viewBox="0 0 24 24"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6"/></symbol>
      <symbol id="i-play" viewBox="0 0 24 24"><path d="M6 3.5 20 12 6 20.5V3.5Z"/></symbol>
      <symbol id="i-retry" viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 9-9 9.8 9.8 0 0 0-6.7 2.7L3 8"/><path d="M3 3v5h5"/></symbol>
      <symbol id="i-route" viewBox="0 0 24 24"><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M6 15V3M18 9a9 9 0 0 1-9 9"/></symbol>
      <symbol id="i-flask" viewBox="0 0 24 24"><path d="M10 2v7.5L4.2 18.6A1.5 1.5 0 0 0 5.5 21h13a1.5 1.5 0 0 0 1.3-2.4L14 9.5V2"/><path d="M8.5 2h7M6.7 15h10.6"/></symbol>
      <symbol id="i-images" viewBox="0 0 24 24"><rect x="7" y="3" width="14" height="13" rx="2"/><path d="M3 7v12a2 2 0 0 0 2 2h12"/><circle cx="11.5" cy="7.5" r="1.5"/><path d="m21 13-3.5-3.5L11 16"/></symbol>
      <symbol id="i-board" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></symbol>
      <symbol id="i-db" viewBox="0 0 24 24"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.7 4 3 9 3s9-1.3 9-3V5"/><path d="M3 12c0 1.7 4 3 9 3s9-1.3 9-3"/></symbol>
      <symbol id="i-file-code" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><path d="m10 12-2 2 2 2M14 12l2 2-2 2"/></symbol>
      <symbol id="i-copy" viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></symbol>
      <symbol id="i-clock" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></symbol>
      <symbol id="i-x" viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></symbol>
      <symbol id="i-search" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-4.3-4.3"/></symbol>
      <symbol id="i-shield" viewBox="0 0 24 24"><path d="M20 12c0 5-3.5 7.6-7.7 9a1 1 0 0 1-.6 0C7.5 19.6 4 17 4 12V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.2-2.7a1.2 1.2 0 0 1 1.5 0C14.5 3.8 17 5 19 5a1 1 0 0 1 1 1Z"/><path d="m9 12 2 2 4-4"/></symbol>
      <symbol id="i-grip" viewBox="0 0 24 24"><circle cx="9" cy="6" r="1.3"/><circle cx="9" cy="12" r="1.3"/><circle cx="9" cy="18" r="1.3"/><circle cx="15" cy="6" r="1.3"/><circle cx="15" cy="12" r="1.3"/><circle cx="15" cy="18" r="1.3"/></symbol>
      <symbol id="i-spark" viewBox="0 0 24 24"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/></symbol>
      <symbol id="i-ext" viewBox="0 0 24 24"><path d="M15 3h6v6M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></symbol>
      <symbol id="i-unlink" viewBox="0 0 24 24"><path d="M15 7h2a5 5 0 0 1 1 9.9M9 17H7A5 5 0 0 1 6 7.1"/><path d="m2 2 20 20"/></symbol>
      <symbol id="i-server" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="14" width="18" height="6" rx="2"/><path d="M7 7.5h.01M7 17h.01"/></symbol>
      <symbol id="i-book" viewBox="0 0 24 24"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z"/></symbol>
      <symbol id="i-msg" viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z"/></symbol>
      <symbol id="i-send" viewBox="0 0 24 24"><path d="M21 3 3 10.5l7 3 3 7Z"/><path d="m10 13.5 4.5-4.5"/></symbol>
      <symbol id="i-monitor" viewBox="0 0 24 24"><rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></symbol>
      <symbol id="i-filter" viewBox="0 0 24 24"><path d="M3 5h18l-7 8v6l-4-2v-4Z"/></symbol>
      <symbol id="i-minus" viewBox="0 0 24 24"><path d="M6 12h12"/></symbol>
      <symbol id="i-refresh" viewBox="0 0 24 24"><path d="M21 12a9 9 0 0 1-15.5 6.2L3 16"/><path d="M3 12A9 9 0 0 1 18.5 5.8L21 8"/><path d="M21 4v4h-4M3 20v-4h4"/></symbol>
      <symbol id="sf-src" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h6.7l2 2.2h4.3A1.5 1.5 0 0 1 20 7.7"/><path d="M3.6 10h16.8a1 1 0 0 1 1 1.1l-.9 7.4a1.5 1.5 0 0 1-1.5 1.3H5a1.5 1.5 0 0 1-1.5-1.3l-.9-7.4a1 1 0 0 1 1-1.1Z"/><path d="m10 13.5-1.6 1.6L10 16.7M14 13.5l1.6 1.6L14 16.7"/></g></symbol>
      <symbol id="sf-fact" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="6" rx="1.6"/><rect x="3" y="14" width="18" height="6" rx="1.6"/><path d="M6.5 7h.01M6.5 17h.01"/><path d="M10 7h7M10 17h4"/></g></symbol>
      <symbol id="sf-wiki" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 18.5A2.5 2.5 0 0 1 6.5 16H20"/><path d="M6.5 3H20v18H6.5A2.5 2.5 0 0 1 4 18.5v-13A2.5 2.5 0 0 1 6.5 3Z"/><path d="M9 7.5h7M9 11h4.5"/></g></symbol>
      <symbol id="sf-scenario" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="2.2"/><circle cx="18" cy="12" r="2.2"/><circle cx="6" cy="18" r="2.2"/><path d="M8.2 6h4.3a3 3 0 0 1 3 3v.8M15.8 13.4v.6a3 3 0 0 1-3 3H8.2"/></g></symbol>
      <symbol id="sf-canonical" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H6.5A1.5 1.5 0 0 0 5 4.5v15A1.5 1.5 0 0 0 6.5 21H12"/><path d="M14 3l5 5v3"/><path d="M14 3v5h5"/><circle cx="17.5" cy="17.5" r="3.5"/><path d="m16 17.5 1.1 1.1 2-2.2"/></g></symbol>
      <symbol id="sf-assert" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3.2"/><path d="M12 3.5V6M12 18v2.5M3.5 12H6M18 12h2.5"/></g></symbol>
      <symbol id="sf-gate" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4v16M20 4v16"/><path d="M8 12h8"/><path d="m13 9 3 3-3 3"/><path d="M4 8h1.5M4 16h1.5M18.5 8H20M18.5 16H20"/></g></symbol>
      <symbol id="sf-queue" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="4" width="17" height="4.5" rx="1.4"/><rect x="3.5" y="10.5" width="17" height="4.5" rx="1.4"/><rect x="3.5" y="17" width="17" height="4.5" rx="1.4"/><path d="M7 6.2h.01M7 12.7h.01M7 19.2h.01"/></g></symbol>
      <symbol id="sf-evidence" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="12.5" rx="1.8"/><path d="M8 21h8M12 17.5V21"/><path d="M7 13.5l3-3 2.2 2.2 2.3-2.6 2.5 3.4"/><circle cx="9" cy="8.8" r="1.1"/></g></symbol>
      <symbol id="sf-mask" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="1.8"/><path d="M6.5 15.5 15.5 6.5M10 18.5 18.5 10M6.5 11 12.5 5M13.5 18.5 18.5 13.5"/></g></symbol>
      </defs>
    </svg>
  );
}
