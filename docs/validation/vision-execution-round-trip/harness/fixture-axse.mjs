/* AXSE 로그인 여정 픽스처. 실제 화면 구조에서 옮겨 적은 것이며
 * 생성 파이프라인 산출물이 아니다. */
const identity = { project_id: "P-AXSE-LIVE", analysis_run_id: "RUN-LIVE-AXSE", source_snapshot_id: "SS-LIVE-AXSE" };
const element = (id, label, type, actionKind, css) => ({
  id, type, label,
  interaction: { action_kind: actionKind, surface_kind: "web", target_candidates: [{ by: "css", value: css }] },
  evidence: [],
});
const screen = (screenId, route, title, elements) => ({ ...identity, schema_version: 3, screen_id: screenId, route, title, entry_guards: [], status: "verified", apis: [], feedback: [], displays: [], elements });
const edge = (edgeId, from, on, to) => ({ ...identity, schema_version: 2, edge_id: edgeId, kind: "normal", from, on, to, feedback: [], evidence: [], status: "verified" });

export const fixture = {
  name: "axse-agents",
  base: "http://localhost:45180",
  viewport: { width: 1440, height: 900 },
  maskSelectors: ["#lf-password"],
  values: { "EL-USERID": "kimtester", "EL-PASSWORD": "stub-password" },
  screens: [
    screen("SCR-LOGIN", "/", "로그인", [
      element("EL-USERID", "아이디", "textbox", "fill", "#lf-userId"),
      element("EL-PASSWORD", "패스워드", "password-textbox", "fill", "#lf-password"),
      element("EL-SUBMIT", "로그인", "button", "submit-login", ".login-form-submit"),
    ]),
    screen("SCR-PROJECT", "/", "프로젝트 선택", []),
  ],
  edges: [
    edge("E-FILL-ID", "SCR-LOGIN", "EL-USERID", "SCR-LOGIN"),
    edge("E-FILL-PW", "SCR-LOGIN", "EL-PASSWORD", "SCR-LOGIN"),
    edge("E-SUBMIT", "SCR-LOGIN", "EL-SUBMIT", "SCR-PROJECT"),
  ],
  scenario: {
    ...identity, schema_version: 2, scenario_id: "SCN-AXSE-0001", workflow: "WF-axse-login", kind: "normal", variation: {}, status: "verified",
    preconditions: [{ text: "평가용 계정이 준비되어 있다", predicate_refs: [], data_binding_keys: ["EL-USERID", "EL-PASSWORD"] }],
    path: ["SCR-LOGIN", "SCR-PROJECT"],
    steps: [
      { n: 1, action: "아이디를 입력한다", action_ref: { edge: "E-FILL-ID", element: "EL-USERID" }, expected: "로그인 화면에 아이디가 입력된다", assertion_refs: ["SCR-LOGIN"] },
      { n: 2, action: "패스워드를 입력한다", action_ref: { edge: "E-FILL-PW", element: "EL-PASSWORD" }, expected: "로그인 화면에 패스워드가 입력된다", assertion_refs: ["SCR-LOGIN"] },
      { n: 3, action: "'로그인' 버튼을 누른다", action_ref: { edge: "E-SUBMIT", element: "EL-SUBMIT" }, expected: "프로젝트 선택 화면이 표시된다", assertion_refs: ["SCR-PROJECT"] },
    ],
  },
  /** 환경 준비. 시나리오 step 이 아니다. */
  async setup(window, settle) {
    await window.loadURL("http://localhost:45180");
    await settle(1200);
  },
  /** 마지막 step 의 도착 화면을 나타나지 않는 화면으로 바꾼다. */
  negative(fixtureRef) {
    fixtureRef.screens.push(screen("SCR-NEVER", "/never", "결제 승인 완료", []));
    fixtureRef.edges[2] = edge("E-SUBMIT", "SCR-LOGIN", "EL-SUBMIT", "SCR-NEVER");
    fixtureRef.scenario.steps[2] = { ...fixtureRef.scenario.steps[2], assertion_refs: ["SCR-NEVER"] };
  },
};
