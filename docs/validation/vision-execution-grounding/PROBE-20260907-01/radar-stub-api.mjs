// RA-DAR 수행-그라운딩 실측용 stub API. RA-DAR 소스는 수정하지 않고
// vite proxy 대상만 대신 응답한다. 형태는 FrontEnd/src/lib/api/dto.ts 기준.
import { createServer } from "node:http";

const field = (value, quality = "확인됨") => ({ value, raw: value ?? "", quality });
const fixed = (value) => ({ kind: "fixed", value });
const undecided = (label) => ({ kind: "undecided", label });

const ROWS = [
  ["RA-2026-001", "검토중", "의약품 표시 기재 규정 일부개정", "고시", "용기 표시 항목에 제조번호 병기 의무를 추가한다", "2026-08-24", "2026-11-01", "영향 있음 · 자사 3품목", 12, true],
  ["RA-2026-002", "완료", "생물학적제제 등 허가심사 규정 개정", "고시", "혈액제제 안정성 시험 주기를 6개월로 단축한다", "2026-08-21", "2026-10-15", "영향 있음 · 자사 1품목", 5, true],
  ["RA-2026-003", "검토중", "의약품 등 안전에 관한 규칙 개정", "규칙", "품목허가 갱신 시 제출 자료 범위를 명확히 한다", "2026-08-19", "2026-12-01", "확인 필요", 41, false],
  ["RA-2026-004", "신규", "첨가제 표준 명칭 정비 고시", "고시", "첨가제 명칭을 대한민국약전 명칭으로 통일한다", "2026-08-14", "2027-01-01", "해당 없음", 60, false],
  ["RA-2026-005", "완료", "수입 의약품 통관 검사 지침 개정", "지침", "수입 통관 시 시험성적서 원본 제출을 전자문서로 대체한다", "2026-08-11", "2026-09-30", "영향 있음 · 자사 2품목", 3, true],
  ["RA-2026-006", "검토중", "의약품 제조 및 품질관리 기준 개정", "고시", "무균 공정 밸리데이션 주기를 연 1회로 규정한다", "2026-08-07", "2026-11-15", "확인 필요", 27, true],
];

const items = ROWS.map(([caseCode, status, name, type, summary, promulgated, effective, assessment, days, hasDetail], index) => ({
  id: index + 1,
  caseCode,
  status,
  stage: status === "완료" ? "정본" : "검토",
  name: field(name),
  type: field(type),
  summary: field(summary),
  intent: "개정",
  revisionNo: field(`제2026-${String(120 + index)}호`),
  promulgated: fixed(promulgated),
  effective: effective ? fixed(effective) : undecided("미정"),
  assessment: field(assessment),
  due: fixed(effective),
  registeredAt: `${promulgated}T09:12:00+09:00`,
  sourceUrl: "https://www.mfds.go.kr/brd/m_207/view.do?seq=1000",
  registeredBy: "이수민",
  owner: index % 2 === 0 ? "이수민" : "박규제",
  action: index % 3 === 0 ? "허가사항 변경 신청" : "영향 검토",
  reviewers: [{ userId: "u2", empNo: "20260002", name: "박규제", status: status === "완료" ? "approved" : "pending" }],
  staleDays: days > 30 ? days : null,
  dueDay: { days, label: `D-${days}`, urgent: days <= 7 },
  hasDetail,
  hasMemory: hasDetail,
  recentResults: hasDetail
    ? [{ id: index * 10 + 1, clause: "제4조제2항", summary: "조항 대조 완료", stage: "compare", status: "success", created_at: `${promulgated}T02:31:00+09:00` }]
    : [],
  updatedAt: `${promulgated}T21:04:00+09:00`,
}));

const CASE_LIST = {
  items,
  meta: {
    page: 1,
    pageSize: 25,
    filteredTotal: items.length,
    unfilteredTotal: items.length,
    counts: { assessmentRequired: 2, stale: 2, withDetail: 4 },
  },
};

const DASHBOARD = {
  runId: 412,
  runStatus: "completed_with_failures",
  reportDate: "2026-09-07",
  completedAt: "2026-09-07T04:12:33+09:00",
  durationSeconds: 1934,
  nextRunAt: "2026-09-08T02:00:00+09:00",
  collectedBoards: 4,
  cumulative: { revisions: 128, comparisonClauses: 964, confirmed: 71, inProgress: 12 },
  generatedClauses: 23,
  results: [
    { id: 1, caseCode: "RA-2026-001", changeItemId: 11, docNo: "제2026-120호", clause: "제4조제2항", regulation: "의약품 표시 기재 규정", summary: "용기 표시 항목에 제조번호 병기 의무 추가", stage: "compare", createdAt: "2026-09-07T02:31:00+09:00", status: "success", sourceUrl: "https://www.mfds.go.kr/brd/m_207/view.do?seq=1000" },
    { id: 2, caseCode: "RA-2026-002", changeItemId: 12, docNo: "제2026-121호", clause: "제9조", regulation: "생물학적제제 등 허가심사 규정", summary: "혈액제제 안정성 시험 주기 6개월로 단축", stage: "impact", createdAt: "2026-09-07T02:44:00+09:00", status: "success", sourceUrl: null },
    { id: 3, caseCode: null, changeItemId: null, docNo: "제2026-122호", clause: null, regulation: "의약품 등 안전에 관한 규칙", summary: "신구조문대비표 첨부 파싱 실패", stage: "parse", createdAt: "2026-09-07T03:02:00+09:00", status: "failure", sourceUrl: null },
    { id: 4, caseCode: "RA-2026-005", changeItemId: 15, docNo: "제2026-124호", clause: "제12조제1항", regulation: "수입 의약품 통관 검사 지침", summary: "시험성적서 전자문서 대체 허용", stage: "compare", createdAt: "2026-09-07T03:21:00+09:00", status: "success", sourceUrl: null },
  ],
};

const AUTH_USER = {
  id: "probe-user",
  aud: "authenticated",
  role: "authenticated",
  email: "20260001@radar.internal",
  email_confirmed_at: "2026-08-28T00:00:00.000Z",
  phone: "",
  app_metadata: { employee_number: "20260001", display_name: "이수민" },
  user_metadata: {},
  identities: [],
  created_at: "2026-08-28T00:00:00.000Z",
  updated_at: "2026-08-28T00:00:00.000Z",
  is_anonymous: false,
};

function match(pathname) {
  if (pathname.endsWith("/auth/v1/user")) return AUTH_USER;
  if (pathname === "/api/v1/radar/dashboard") return DASHBOARD;
  if (pathname === "/api/v1/radar/cases") return CASE_LIST;
  if (pathname === "/api/v1/radar/products") return [{ id: 1, name: "레볼팍정", active: true }, { id: 2, name: "알부민주", active: true }];
  if (/^\/api\/v1\/radar\/cases\/[^/]+\/security$/.test(pathname)) return { caseCode: "RA-2026-001", classification: "internal", restricted: false };
  if (/^\/api\/v1\/radar\/cases\/[^/]+$/.test(pathname)) {
    const code = pathname.split("/").pop();
    const row = items.find((item) => item.caseCode === code) ?? items[0];
    return { ...row, sourceDocuments: [], blocks: [], runs: [], clauses: [], products: [], checklist: [], latestReview: null, memory: [] };
  }
  if (pathname === "/api/v1/radar/chat/conversations/latest") return { conversationId: null, messages: [] };
  return undefined;
}

createServer((request, response) => {
  const { pathname } = new URL(request.url, "http://127.0.0.1");
  const data = match(pathname);
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("access-control-allow-origin", "*");
  response.setHeader("access-control-allow-headers", "*");
  if (request.method === "OPTIONS") { response.statusCode = 204; response.end(); return; }
  if (data === undefined) {
    console.log("UNHANDLED", request.method, pathname);
    response.statusCode = 404;
    response.end(JSON.stringify({ detail: `stub has no route for ${pathname}` }));
    return;
  }
  response.statusCode = 200;
  response.end(JSON.stringify(data));
}).listen(45191, "127.0.0.1", () => console.log("radar stub api on 45191"));
