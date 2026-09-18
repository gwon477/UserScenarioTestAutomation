// AXSE 수행-그라운딩 실측용 stub API. test_project_source는 수정하지 않고
// vite proxy 대상 포트만 대신 응답한다.
import { createServer } from "node:http";

const TASK = {
  task_id: "TS-2026-0142",
  task_title: "보험금 청구 접수 통합테스트",
  current_stage: "SCENARIO",
  ui_stage: "SCENARIO",
};

const BOOTSTRAP = {
  project: { project_id: "PRJ-0007", project_name: "차세대 보험 코어" },
  user: { user_id: "kimtester", user_name: "김테스터" },
  task: TASK,
  document: { document_id: "DOC-0031", file_name: "요구사항_v3.md", parsed: true, status: "PARSED" },
};

const FLOWS = {
  items: [
    { category_id: "L2-001", flow_id: "L2-001", flow_name: "청구 접수", category_path: "보험금 > 청구 접수", description: "청구 접수 화면 흐름", screens: [{ screen_id: "SCR-001", screen_name: "청구 접수" }] },
    { category_id: "L2-002", flow_id: "L2-002", flow_name: "서류 검증", category_path: "보험금 > 서류 검증", description: "첨부 서류 검증 흐름", screens: [{ screen_id: "SCR-002", screen_name: "서류 검증" }] },
  ],
  total_count: 2,
  page: 1,
  page_size: 200,
};

const CATEGORIES = [
  { category_id: "L1-001", title: "보험금 청구", screen_count: 6, branches: [
    { category_id: "L2-001", title: "청구 접수", screen_count: 3, screen_ids: ["SCR-001"] },
    { category_id: "L2-002", title: "서류 검증", screen_count: 3, screen_ids: ["SCR-002"] },
  ] },
];

const MATRIX = {
  page: 1,
  page_size: 50,
  total_count: 3,
  rows: [
    { flow_id: "L2-001", flow_name: "청구 접수", scenario_id: "SCN-0001", scenario_name: "정상 청구 접수", scenario_type: "NORMAL", test_case_id: "TC-0001", test_case_name: "필수 항목 입력 후 접수", priority: "HIGH", screens: "청구 접수", actions: "청구 접수 버튼 클릭", test_data: "증권번호 100-2026-0001", expected_result: "접수번호가 발급된다" },
    { flow_id: "L2-001", flow_name: "청구 접수", scenario_id: "SCN-0002", scenario_name: "필수 항목 누락", scenario_type: "EXCEPTION", test_case_id: "TC-0002", test_case_name: "증권번호 미입력 접수", priority: "MEDIUM", screens: "청구 접수", actions: "증권번호 비우고 접수", test_data: "증권번호 없음", expected_result: "필수 입력 오류가 표시된다" },
    { flow_id: "L2-002", flow_name: "서류 검증", scenario_id: "SCN-0003", scenario_name: "서류 용량 경계", scenario_type: "BOUNDARY", test_case_id: "TC-0003", test_case_name: "10MB 파일 업로드", priority: "LOW", screens: "서류 검증", actions: "10MB 파일 첨부", test_data: "10MB PDF", expected_result: "업로드가 허용된다" },
  ],
};

const OVERVIEW = {
  task_id: TASK.task_id,
  business_count: 4,
  screen_count: 6,
  field_count: 48,
  event_count: 21,
  business_flow_count: 2,
};

const unhandled = [];

function match(pathname) {
  if (pathname === "/api/auth/login") return { accessToken: "stub.eyJwcmVmZXJyZWRfdXNlcm5hbWUiOiJraW10ZXN0ZXIiLCJuYW1lIjoi6rmA7YWM7Iqk7YSwIn0.stub", refreshToken: "stub-refresh" };
  if (pathname === "/api/projects") return [BOOTSTRAP.project];
  if (pathname === "/api/tasks") return [TASK];
  if (/^\/api\/tasks\/[^/]+\/bootstrap$/.test(pathname)) return BOOTSTRAP;
  if (/^\/api\/tasks\/[^/]+\/business-flow-categories$/.test(pathname)) return CATEGORIES;
  if (/^\/api\/tasks\/[^/]+\/business-flows$/.test(pathname)) return FLOWS;
  if (/^\/api\/tasks\/[^/]+\/business-flows\/mapping-validation$/.test(pathname)) return { items: [], total_count: 0 };
  if (/^\/api\/tasks\/[^/]+\/business-flows\/[^/]+\/diagnostics\/screens$/.test(pathname)) return { screens: [
    { screen_id: "SCR-001", screen_name: "청구 접수", status: "정상", issues: [] },
    { screen_id: "SCR-002", screen_name: "서류 검증", status: "정상", issues: [] },
  ], summary: { normal: 2, missing_flow_detail: 0, not_covered: 0 } };
  if (/^\/api\/tasks\/[^/]+\/business-flows\/[^/]+\/screens$/.test(pathname)) return { screens: [{ screen_id: "SCR-001", screen_name: "청구 접수" }] };
  if (/^\/api\/tasks\/[^/]+\/business-flows\/[^/]+\/flow-text$/.test(pathname)) return { flow_text: "1. 청구 접수 화면 진입\n2. 필수 항목 입력\n3. 접수 버튼 클릭" };
  if (/^\/api\/tasks\/[^/]+\/scenario-generation\/progress$/.test(pathname)) return { active: false, percent: 100, stage: "DONE", message: "생성 완료" };
  if (/^\/api\/tasks\/[^/]+\/scenario-matrix$/.test(pathname)) return MATRIX;
  if (/^\/api\/tasks\/[^/]+\/overview$/.test(pathname)) return OVERVIEW;
  if (/^\/api\/tasks\/[^/]+\/screens$/.test(pathname)) return { items: [], total_count: 0 };
  if (/^\/api\/tasks\/[^/]+\/fields$/.test(pathname)) return { items: [], total_count: 0 };
  if (/^\/api\/tasks\/[^/]+\/events$/.test(pathname)) return { items: [], total_count: 0 };
  if (/^\/api\/tasks\/[^/]+$/.test(pathname)) return TASK;
  return undefined;
}

createServer((request, response) => {
  const { pathname } = new URL(request.url, "http://127.0.0.1");
  const data = match(pathname);
  response.setHeader("content-type", "application/json; charset=utf-8");
  if (data === undefined) {
    unhandled.push(`${request.method} ${pathname}`);
    console.log("UNHANDLED", request.method, pathname);
    response.statusCode = 404;
    response.end(JSON.stringify({ detail: `stub has no route for ${pathname}` }));
    return;
  }
  response.statusCode = 200;
  response.end(JSON.stringify({ data }));
}).listen(45181, "127.0.0.1", () => console.log("stub api on 45181"));
