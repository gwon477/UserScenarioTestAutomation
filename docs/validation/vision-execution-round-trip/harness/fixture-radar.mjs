/* RA-DAR 랜딩 -> 로그인 -> 대시보드 -> 원장 여정 픽스처.
 * 실제 화면 구조에서 옮겨 적은 것이며 생성 파이프라인 산출물이 아니다.
 *
 * 로그인 카드는 랜딩 deck 의 마지막 장면에 있지만, 첫 화면의 「바로 시작하기」가
 * 그 장면으로 이동시킨다(ProblemScenes.tsx 의 onJump(SCENES.length - 1)).
 * 따라서 스크롤은 환경 준비가 아니라 사용자 동작이고 시나리오 step 이다. */
const identity = { project_id: "P-RADAR-LIVE", analysis_run_id: "RUN-LIVE-RADAR", source_snapshot_id: "SS-LIVE-RADAR" };
const element = (id, label, type, actionKind, css) => ({
  id, type, label,
  interaction: { action_kind: actionKind, surface_kind: "web", target_candidates: [{ by: "css", value: css }] },
  evidence: [],
});
const screen = (screenId, route, title, elements) => ({ ...identity, schema_version: 3, screen_id: screenId, route, title, entry_guards: [], status: "verified", apis: [], feedback: [], displays: [], elements });
const edge = (edgeId, from, on, to) => ({ ...identity, schema_version: 2, edge_id: edgeId, kind: "normal", from, on, to, feedback: [], evidence: [], status: "verified" });

export const fixture = {
  name: "ra-dar",
  base: "http://localhost:45190",
  viewport: { width: 1440, height: 900 },
  // 사번과 비밀번호 모두 password 타입으로 렌더링된다. 둘 다 가린다.
  maskSelectors: ['input[type="password"]'],
  values: {},
  screens: [
    screen("SCR-LANDING", "/login", "57행을 다 읽어야 1행을 찾습니다.", [
      element("EL-START", "바로 시작하기", "button", "click", ".cta-row .lbtn:not(.lghost)"),
      element("EL-PREVIEW", "미리 방문하기", "button", "click", ".cta-row .lbtn.lghost"),
    ]),
    screen("SCR-LOGIN", "/login", "담당자 로그인", [
      element("EL-SUBMIT", "사번으로 인증하고 시작", "button", "submit-login", 'button[type="submit"].btn.pri'),
      element("EL-GUEST", "사번 없이 확인하기", "button", "click", "button.btn.w-full:not(.pri)"),
    ]),
    screen("SCR-DASHBOARD", "/dashboard", "새로 생성된 대조 조항", [
      element("EL-NAV-LEDGER", "누적 관리", "link", "navigate", 'a.app-nav-item[href^="/ledger"]'),
      element("EL-NAV-HOME", "RADAR", "link", "navigate", "a.app-topbar-logo"),
      element("EL-OPEN-LEDGER", "누적 관리 열기", "link", "navigate", 'a[href^="/ledger"]:not(.app-nav-item)'),
    ]),
    screen("SCR-LEDGER", "/ledger", "전체 규정 개정 이력", []),
  ],
  edges: [
    edge("E-START", "SCR-LANDING", "EL-START", "SCR-LOGIN"),
    edge("E-LOGIN", "SCR-LOGIN", "EL-SUBMIT", "SCR-DASHBOARD"),
    edge("E-NAV-LEDGER", "SCR-DASHBOARD", "EL-NAV-LEDGER", "SCR-LEDGER"),
  ],
  scenario: {
    ...identity, schema_version: 2, scenario_id: "SCN-RADAR-0001", workflow: "WF-radar-entry", kind: "normal", variation: {}, status: "verified",
    preconditions: [{ text: "평가용 사번이 로그인 카드에 미리 입력되어 있다", predicate_refs: [], data_binding_keys: [] }],
    path: ["SCR-LANDING", "SCR-LOGIN", "SCR-DASHBOARD", "SCR-LEDGER"],
    steps: [
      { n: 1, action: "'바로 시작하기'를 누른다", action_ref: { edge: "E-START", element: "EL-START" }, expected: "담당자 로그인 카드가 표시된다", assertion_refs: ["SCR-LOGIN"] },
      { n: 2, action: "'사번으로 인증하고 시작'을 누른다", action_ref: { edge: "E-LOGIN", element: "EL-SUBMIT" }, expected: "야간 작업 대시보드가 표시된다", assertion_refs: ["SCR-DASHBOARD"] },
      { n: 3, action: "상단 '누적 관리'로 이동한다", action_ref: { edge: "E-NAV-LEDGER", element: "EL-NAV-LEDGER" }, expected: "누적관리 원장이 표시된다", assertion_refs: ["SCR-LEDGER"] },
    ],
  },
  /* 환경 준비는 진입 URL 로드까지다. 로그인 장면으로의 이동은 step 1 이 한다. */
  async setup(window, settle) {
    await window.loadURL("http://localhost:45190/login");
    await settle(1500);
  },
  negative(fixtureRef) {
    fixtureRef.screens.push(screen("SCR-NEVER", "/never", "품목 허가 취소 완료", []));
    fixtureRef.edges[2] = edge("E-NAV-LEDGER", "SCR-DASHBOARD", "EL-NAV-LEDGER", "SCR-NEVER");
    fixtureRef.scenario.steps[2] = { ...fixtureRef.scenario.steps[2], assertion_refs: ["SCR-NEVER"] };
  },
};
