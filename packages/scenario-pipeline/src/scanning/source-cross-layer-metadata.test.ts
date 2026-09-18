import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { SourceScanner } from "./source-scanner.js";
import { sourceBehaviorTransitionObligations } from "./source-interaction-behavior.js";

async function scanFixture(files: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), "scenarioforge-cross-layer-"));
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content, "utf8");
  }
  return new SourceScanner().scan({
    projectRoot: root,
    projectId: "PRJ-orders",
    analysisRunId: "RUN-orders",
    sourceSnapshotId: "SNAP-orders",
    now: "2026-09-09T00:00:00.000Z",
  });
}

const connectedFixture = {
  "src/OrdersPage.tsx": `
import { ordersApi } from "./api";
export function OrdersPage() {
  const [tab, setTab] = useState("form");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const approve = async () => {
    setLoading(true);
    try {
      const result = await ordersApi.approve("42");
      setTab("result");
      setSelected(result.id);
    } catch {
      setError("failed");
    } finally {
      setLoading(false);
    }
  };
  return <button disabled={loading} onClick={approve}>Approve order</button>;
}`.trim(),
  "src/UnrelatedPage.tsx": `
export function UnrelatedPage() {
  const [open, setOpen] = useState(false);
  return <button onClick={() => setOpen(!open)}>Open help</button>;
}`.trim(),
  "src/api.ts": `
export const ordersApi = {
  approve(orderId: string) {
    return fetch(\`/api/orders/\${orderId}/approve\`, { method: "POST" });
  },
};
`.trim(),
  "backend/routes/orders.py": `
from fastapi import APIRouter, Depends, HTTPException
router = APIRouter()

@router.post("/api/orders/{order_id}/approve", status_code=202)
async def approve_order(order_id, body, service, actor=Depends(require_manager), db=Depends(get_db)):
    if body.stage != "review":
        raise HTTPException(status_code=409, detail="wrong_stage")
    if body.decision == "rejected":
        raise HTTPException(status_code=422, detail="rejected")
    return await service.approve(order_id, body, actor)
`.trim(),
};

describe("source cross-layer behavior metadata", () => {
  it("connects a frontend action through its API and backend handler to the consumed result view state", async () => {
    const snapshot = await scanFixture(connectedFixture);
    const approveElement = snapshot.interactions.find((entry) => entry.label === "Approve order")!;
    const behavior = snapshot.source_behaviors?.find((entry) => entry.element_id === approveElement.element_id);

    expect(behavior).toMatchObject({
      screen_id: approveElement.screen_id,
      feasibility: "verified",
      view_state: {
        states: expect.arrayContaining([
          { key: "tab", facet: "tab" },
          { key: "loading", facet: "loading" },
          { key: "error", facet: "error" },
        ]),
      },
      api_connections: [{
        api_symbol: "ordersApi.approve",
        method: "POST",
        path: "/api/orders/{}/approve",
        backend: {
          handler_symbol: "approve_order",
          route_path: "/api/orders/{order_id}/approve",
          service_symbols: ["service.approve"],
          auth_guards: ["require_manager"],
          success_statuses: [202],
          failure_statuses: [409, 422],
        },
      }],
      response_consumer: {
        state_keys: expect.arrayContaining(["tab", "loading", "error"]),
        next_view_states: expect.arrayContaining(["tab:result"]),
      },
    });
    expect(behavior?.source_refs?.every((ref) => ref.source_snapshot_id === snapshot.source_snapshot_id && ref.content_hash.startsWith("sha256:"))).toBe(true);
    expect(behavior?.source_refs?.map((ref) => ref.path)).toEqual(expect.arrayContaining([
      "src/OrdersPage.tsx",
      "src/api.ts",
      "backend/routes/orders.py",
    ]));
  });

  it("does not fan a shared backend endpoint out to an unrelated frontend action", async () => {
    const snapshot = await scanFixture(connectedFixture);
    const unrelatedElement = snapshot.interactions.find((entry) => entry.label === "Open help")!;
    const unrelated = snapshot.source_behaviors?.find((entry) => entry.element_id === unrelatedElement.element_id);

    expect(unrelated?.api_connections).toEqual([]);
    expect(unrelated?.source_refs?.map((ref) => ref.path)).not.toContain("backend/routes/orders.py");
  });

  it("binds a form submit handler only to its native submit control", async () => {
    const snapshot = await scanFixture({
      "src/ManualPage.tsx": `
import { manualApi } from "./api";
export function ManualPage() {
  const submit = async (event) => {
    event.preventDefault();
    await manualApi.create();
  };
  return <form onSubmit={submit}>
    <a href="/source">Open source</a>
    <button type="submit">Create case</button>
  </form>;
}`.trim(),
      "src/api.ts": `
export const manualApi = { create: () => fetch("/cases", { method: "POST" }) };
`.trim(),
      "backend/routes/manual.py": `
from fastapi import APIRouter
router = APIRouter()

@router.post("/cases", status_code=201)
async def create_case(service):
    return await service.create()
`.trim(),
    });
    const openSource = snapshot.interactions.find((entry) => entry.label === "Open source")!;
    const createCase = snapshot.interactions.find((entry) => entry.label === "Create case")!;

    expect(snapshot.source_behaviors?.find((entry) => entry.element_id === openSource.element_id)).toBeUndefined();
    expect(snapshot.source_behaviors?.find((entry) => entry.element_id === createCase.element_id)?.api_connections).toEqual([
      expect.objectContaining({ api_symbol: "manualApi.create", method: "POST", path: "/cases" }),
    ]);
  });

  it("does not treat an arbitrary longer backend path as a matching suffix", async () => {
    const snapshot = await scanFixture({
      "src/StatusPage.tsx": `
import { statusApi } from "./api";
export function StatusPage() {
  const check = async () => statusApi.check();
  return <button onClick={check}>Check status</button>;
}`.trim(),
      "src/api.ts": `
export const statusApi = { check: () => fetch("/status") };
`.trim(),
      "backend/routes/status.py": `
from fastapi import APIRouter
router = APIRouter()

@router.get("/orders/status")
async def order_status(service):
    return await service.status()
`.trim(),
    });
    const behavior = snapshot.source_behaviors?.find((entry) => entry.called_symbols.includes("statusApi.check"));

    expect(behavior?.api_connections?.[0]?.backend).toBeUndefined();
    expect(behavior).toMatchObject({
      feasibility: "unresolved",
      branches: [],
      unresolved: ["BACKEND_ENDPOINT_UNRESOLVED:GET:/status"],
    });
  });

  it("combines an evidenced FastAPI router prefix before exact path matching", async () => {
    const snapshot = await scanFixture({
      "src/OrdersPage.tsx": `
import { ordersApi } from "./api";
export function OrdersPage() {
  const load = async () => ordersApi.load("42");
  return <button onClick={load}>Load order</button>;
}`.trim(),
      "src/api.ts": `
export const ordersApi = { load: (id: string) => fetch(\`/api/orders/\${id}\`) };
`.trim(),
      "backend/routes/orders.py": `
from fastapi import APIRouter
router = APIRouter(
    prefix="/api",
)

@router.get("/orders/{order_id}")
async def load_order(order_id, service):
    return await service.load(order_id)
`.trim(),
    });
    const connection = snapshot.source_behaviors
      ?.find((entry) => entry.called_symbols.includes("ordersApi.load"))
      ?.api_connections?.[0];

    expect(connection).toMatchObject({
      path: "/api/orders/{}",
      feasibility: "inferred",
      backend: { route_path: "/api/orders/{order_id}", handler_symbol: "load_order" },
    });
  });

  it("separates an evidenced URL base interpolation from route segments", async () => {
    const snapshot = await scanFixture({
      "src/ChatPage.tsx": `
import { streamChat } from "./api";
export function ChatPage() {
  const send = async () => streamChat("hello");
  return <button onClick={send}>Send chat</button>;
}`.trim(),
      "src/api.ts": `
const API_BASE = "http://localhost:8000";
export const streamChat = (message: string) => fetch(\`${"${API_BASE}"}/chat\`, { method: "POST", body: message });
`.trim(),
      "backend/routes/chat.py": `
from fastapi import APIRouter
router = APIRouter()

@router.post("/chat")
async def chat(service):
    return await service.chat()
`.trim(),
    });
    const connection = snapshot.source_behaviors
      ?.find((entry) => entry.called_symbols.includes("streamChat"))
      ?.api_connections?.[0];

    expect(connection).toMatchObject({
      path: "/chat",
      feasibility: "inferred",
      backend: { route_path: "/chat", handler_symbol: "chat" },
    });
  });

  it("keeps every evidenced HTTP operation in one API client action", async () => {
    const snapshot = await scanFixture({
      "src/WorkflowPage.tsx": `
import { workflowApi } from "./api";
export function WorkflowPage() {
  const [result, setResult] = useState(null);
  const execute = async () => setResult(await workflowApi.execute("42"));
  return <button onClick={execute}>Execute workflow</button>;
}`.trim(),
      "src/api.ts": `
export const workflowApi = {
  async execute(workflowId: string) {
    await fetch(\`/api/workflows/\${workflowId}/prepare\`, { method: "POST" });
    return fetch(\`/api/workflows/\${workflowId}/commit\`, { method: "POST" });
  },
};
`.trim(),
      "backend/routes/workflows.py": `
from fastapi import APIRouter
router = APIRouter()

@router.post("/api/workflows/{workflow_id}/prepare")
async def prepare_workflow(workflow_id, service):
    return await service.prepare(workflow_id)

@router.post("/api/workflows/{workflow_id}/commit")
async def commit_workflow(workflow_id, service):
    return await service.commit(workflow_id)
`.trim(),
    });
    const behavior = snapshot.source_behaviors?.find((entry) => entry.called_symbols.includes("workflowApi.execute"));

    expect(behavior?.api_connections?.map((connection) => connection.backend?.handler_symbol)).toEqual([
      "commit_workflow",
      "prepare_workflow",
    ]);
    expect(behavior?.branches?.filter((branch) => branch.outcome === "normal")).toHaveLength(2);
  });

  it("enumerates normal, authorization, business-stage, and decision failure branches separately", async () => {
    const snapshot = await scanFixture(connectedFixture);
    const behavior = snapshot.source_behaviors?.find((entry) => entry.api_connections?.some((connection) => connection.api_symbol === "ordersApi.approve"))!;

    expect(behavior.branches?.[0]).toMatchObject({ branch_ref: "normal:1", outcome: "normal", response_status: 202, feasibility: "verified" });
    expect(behavior.branches).toEqual(expect.arrayContaining([
      expect.objectContaining({ outcome: "exception", guard_keys: ["authorization:require_manager"] }),
      expect.objectContaining({ outcome: "exception", response_status: 409, guard_keys: [expect.stringContaining("stage:")] }),
      expect.objectContaining({ outcome: "exception", response_status: 422, guard_keys: [expect.stringContaining("decision:")] }),
    ]));

    const obligations = sourceBehaviorTransitionObligations([behavior]);
    expect(obligations[0]).toMatchObject({ branch_ref: "normal:1", outcome: "normal", feasibility: "source-supported" });
    expect(obligations.filter((entry) => entry.outcome === "exception")).toHaveLength(3);
  });

  it("keeps unsupported API connections unresolved instead of inventing a backend target", async () => {
    const snapshot = await scanFixture({
      "src/UnsupportedPage.tsx": `
export function UnsupportedPage() {
  const run = async () => externalApi.run(selectedId);
  return <button onClick={run}>Run external</button>;
}`.trim(),
    });
    const behavior = snapshot.source_behaviors?.find((entry) => entry.called_symbols.includes("externalApi.run"));

    expect(behavior).toMatchObject({
      feasibility: "unresolved",
      api_connections: [],
      branches: [],
      unresolved: ["API_CLIENT_OPERATION_UNRESOLVED:externalApi.run"],
    });
    expect(sourceBehaviorTransitionObligations([behavior!])).toEqual([]);
    expect(behavior?.source_refs?.every((ref) => ref.path === "src/UnsupportedPage.tsx")).toBe(true);
  });
});

describe("evidenced business results keep a behavior resolvable", () => {
  it("does not erase a downloaded-result action when only its API client call is unresolved", async () => {
    const root = await mkdtemp(join(tmpdir(), "scenarioforge-result-"));
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "src", "Result.jsx"),
      "export default function ResultPage(){\n"
      + "  const [downloaded, setDownloaded] = useState(false);\n"
      + "  const exportCsv = async () => { await taskApi.downloadScenarioMatrixCsv(); setDownloaded(true); };\n"
      + "  return <div><button onClick={exportCsv}>CSV 받기</button>{downloaded ? <span>완료</span> : null}</div>;\n"
      + "}\n", "utf8");

    const snapshot = await new SourceScanner().scan({ projectRoot: root, projectId: "PRJ-1", analysisRunId: "RUN-1", sourceSnapshotId: "SNAP-1", now: "2026-08-26T00:00:00.000Z" });
    const behavior = snapshot.source_behaviors?.find((entry) => (entry.stable_outcomes ?? []).length > 0);

    expect(behavior).toBeDefined();
    expect(behavior!.feasibility).not.toBe("unresolved");
  });
});

describe("evidenced failure keeps a behavior resolvable", () => {
  it("does not erase an action whose failure the source surfaces, when only its API client call is unresolved", async () => {
    const root = await mkdtemp(join(tmpdir(), "scenarioforge-failure-"));
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "src", "Upload.jsx"),
      "export default function UploadPage(){\n"
      + "  const [error, setError] = useState('');\n"
      + "  const startParse = async () => {\n"
      + "    try { await uploadApi.parseDocument(file); }\n"
      + "    catch (e) { setError('파싱 중 오류가 발생했습니다.'); }\n"
      + "  };\n"
      + "  return <div><button onClick={startParse}>업로드 및 파싱 시작</button>{error ? <span>{error}</span> : null}</div>;\n"
      + "}\n", "utf8");

    const snapshot = await new SourceScanner().scan({ projectRoot: root, projectId: "PRJ-1", analysisRunId: "RUN-1", sourceSnapshotId: "SNAP-1", now: "2026-08-26T00:00:00.000Z" });
    const behavior = snapshot.source_behaviors?.find((entry) => entry.explicit_failure);

    expect(behavior).toBeDefined();
    expect(behavior!.feasibility).not.toBe("unresolved");
  });
});

describe("evidenced navigation keeps a behavior resolvable", () => {
  it("does not erase a literal screen navigation when only its backend endpoint is unresolved", async () => {
    const root = await mkdtemp(join(tmpdir(), "scenarioforge-nav-"));
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "src", "Main.jsx"),
      "export default function MainPage(){\n"
      + "  const [page, setPage] = useState('home');\n"
      + "  const openUpload = () => { taskApi.updateStage('upload'); setPage('upload'); };\n"
      + "  return <div><button onClick={openUpload}>업로드</button>{page === 'upload' ? <UploadPage/> : null}</div>;\n"
      + "}\n", "utf8");

    const snapshot = await new SourceScanner().scan({ projectRoot: root, projectId: "PRJ-1", analysisRunId: "RUN-1", sourceSnapshotId: "SNAP-1", now: "2026-08-26T00:00:00.000Z" });
    const behavior = snapshot.source_behaviors?.find((entry) => entry.literal_navigation_targets.includes("upload"));

    expect(behavior).toBeDefined();
    expect(behavior!.feasibility).not.toBe("unresolved");
    expect((behavior!.branches ?? []).map((branch) => branch.branch_ref)).toContain("normal:1");
  });
});
