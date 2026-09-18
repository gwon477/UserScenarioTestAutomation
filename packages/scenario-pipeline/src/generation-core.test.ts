import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { EvidenceReference, FactBundle, WikiBundle } from "@scenarioforge/contracts";
import {
  applyFactEnrichmentPatch,
  applyFactCorrectionPatch,
  applyFactCatalogPatch,
  applyEdgeProposalPatch,
  applyEdgeProposalPatchWithCorrection,
  applyScenarioNarrationPatch,
  applyScenarioNarrationCorrectionPatch,
  applyBusinessClassificationCorrectionPatch,
  applyWikiSemanticPatch,
  applyWikiGoalCorrectionPatch,
  assembleFactBundle,
  ClosureService,
  createDeterministicFactDraft,
  createFactCorrectionPlan,
  createFactTransitionCorrectionDraft,
  mergeFactTransitionCorrection,
  createEdgeLedger,
  edgeProposalPatchFromLedger,
  createFactCatalog,
  EvidenceGrantService,
  SourceScanner,
  calculateCoverage,
  compileReachableWorkflowSkeleton,
  compileGuardedPathInventory,
  compileJourneyScenarioBindings,
  compileJourneyCompleteScenarios,
  compileBusinessCatalog,
  defaultBusinessClassificationPatch,
  compileScenarioSkeleton,
  compileScenarioSet,
  createBusinessClassificationCorrectionScope,
  createScenarioNarrationCorrectionScope,
  createWikiGoalCorrectionScope,
  validateFactBundle,
  validateFactEnrichmentPatchReferences,
  validateScenarioSet,
  validateSourceSnapshot,
  validateWikiBundle,
  validateWikiReadiness,
} from "./index.js";

const identity = { project_id: "PRJ-shop", analysis_run_id: "RUN-1", source_snapshot_id: "SNAP-1" };
const evidence: EvidenceReference = { source_id: "SRC-page", source_snapshot_id: "SNAP-1", path: "src/Page.tsx", start_line: 1, end_line: 2, content_hash: "sha256:abc", evidence_grant_id: "EVG-work-1-a" };

function factBundle(): FactBundle {
  return {
    schema_version: 2, ...identity,
    screens: [
      { schema_version: 3, ...identity, screen_id: "SCR-checkout", route: "/checkout", title: "Checkout", entry_guards: [], status: "verified",
        elements: [{ id: "EL-checkout-button-submit", type: "button", label: "Submit order", interaction: { action_kind: "click", surface_kind: "web", target_candidates: [{ by: "test-id", value: "submit-order" }] }, evidence: [evidence] }],
        apis: [], feedback: [{ id: "FB-checkout-success", kind: "toast", text: "Order complete", assertion: { kind: "visible-text", expected_shape: "Order complete" }, evidence: [evidence] }], displays: [] },
      { schema_version: 3, ...identity, screen_id: "SCR-complete", route: "/complete", title: "Complete", entry_guards: [], status: "verified", elements: [], apis: [], feedback: [], displays: [] },
    ],
    edges: [{ schema_version: 2, ...identity, edge_id: "E-0001", kind: "normal", from: "SCR-checkout", on: "EL-checkout-button-submit", guard: "PRED-cart.ready=true", to: "SCR-complete", feedback: ["FB-checkout-success"], evidence: [evidence], status: "verified" }],
    predicates: [{ schema_version: 2, ...identity, pred_id: "PRED-cart.ready", values: ["true", "false"], source: "code", evidence: [evidence] }],
  };
}

function wikiBundle(): WikiBundle {
  return { schema_version: 2, ...identity, workflows: [{ schema_version: 2, ...identity, workflow: "WF-ORDER-PLACE", goal: "Place an order", entry_screens: ["SCR-checkout"], success_terminal: "at(SCR-complete)", failure_terminals: [], variation_axes: [], combination: { strategy: "base-choice", axis_defaults: {} }, depends_on: [], cites: ["SCR-checkout", "E-0001", "PRED-cart.ready"], status: "verified" }] };
}

describe("deterministic generation core", () => {
  it("excludes dependency environments, fixtures, runtime data, and golden files from source inventory", async () => {
    const root = await mkdtemp(join(tmpdir(), "scenarioforge-scan-exclusions-"));
    await mkdir(join(root, "src"), { recursive: true });
    await mkdir(join(root, ".venv", "lib"), { recursive: true });
    await mkdir(join(root, "tests", "fixtures"), { recursive: true });
    await mkdir(join(root, "Backend", "data", "runtime"), { recursive: true });
    await mkdir(join(root, "generated"), { recursive: true });
    await mkdir(join(root, "src", "__fixtures__"), { recursive: true });
    await writeFile(join(root, "src", "app.ts"), "export const app = true;\n", "utf8");
    await writeFile(join(root, ".venv", "lib", "dependency.py"), "dependency = True\n", "utf8");
    await writeFile(join(root, "tests", "fixtures", "mock.ts"), "export const mock = true;\n", "utf8");
    await writeFile(join(root, "Backend", "data", "runtime", "case.json"), "{}\n", "utf8");
    await writeFile(join(root, "generated", "scenario.ts"), "export const generated = true;\n", "utf8");
    await writeFile(join(root, "src", "__fixtures__", "response.json"), "{}\n", "utf8");
    await writeFile(join(root, "SCENARIOFORGE_GOLDEN_DATASET.md.json"), "{}\n", "utf8");

    const snapshot = await new SourceScanner().scan({ projectRoot: root, projectId: "PRJ-shop", analysisRunId: "RUN-1", sourceSnapshotId: "SNAP-1", now: "2026-08-26T00:00:00.000Z" });

    expect(snapshot.files.map((file) => file.path)).toEqual(["src/app.ts"]);
  });

  it("scans source into stable IDs, hashes and inventories", async () => {
    const root = await mkdtemp(join(tmpdir(), "scenarioforge-scan-"));
    await mkdir(join(root, "src"));
    await writeFile(join(root, "src", "api.ts"), "export const load = () => fetch('/api/cart');\n", "utf8");
    await writeFile(join(root, "src", "Page.tsx"), "import { load } from './api';\nexport const Page=()=> <><Route path=\"/checkout\"/><button data-testid=\"submit-order\" onClick={() => fetch('/api/cart')}>Submit order</button></>;\n", "utf8");
    const snapshot = await new SourceScanner().scan({ projectRoot: root, projectId: "PRJ-shop", analysisRunId: "RUN-1", sourceSnapshotId: "SNAP-1", now: "2026-08-26T00:00:00.000Z" });
    expect(validateSourceSnapshot(snapshot).valid).toBe(true);
    expect(snapshot.routes[0]).toMatchObject({ screen_id: "SCR-checkout", route: "/checkout" });
    expect(snapshot.apis[0]).toMatchObject({ api_id: "API-GET-api-cart", method: "GET" });
    expect(snapshot.interactions[0].target_candidates[0]).toEqual({ by: "test-id", value: "submit-order" });
    const page = snapshot.files.find((file) => file.path === "src/Page.tsx")!;
    expect(new ClosureService().build(snapshot, [page.source_id]).files.map((file) => file.path)).toEqual(["src/Page.tsx", "src/api.ts"]);
    expect(new ClosureService().build(snapshot, [page.source_id], 1)).toMatchObject({ files: [], truncated: true, estimated_chars: 0 });
    const grant = await new EvidenceGrantService(root).create(snapshot, "work-1", [{ source_id: page.source_id, start_line: 1, end_line: 1 }]);
    expect(grant.evidence[0]).toMatchObject({ source_snapshot_id: "SNAP-1", evidence_grant_id: grant.evidence_grant_id });

    const behavior = snapshot.source_behaviors?.[0];
    expect(behavior).toBeDefined();
    const forged = structuredClone(snapshot);
    forged.source_behaviors![0] = { ...behavior!, source_id: "SRC-forged", path: "src/Forged.tsx" };
    expect(validateSourceSnapshot(forged)).toMatchObject({
      valid: false,
      issues: expect.arrayContaining([expect.objectContaining({ code: "SOURCE_BEHAVIOR_PROVENANCE_INVALID", path: "source_behaviors.0" })]),
    });
    const duplicateBranch = structuredClone(snapshot);
    duplicateBranch.source_behaviors![0] = {
      ...behavior!,
      feasibility: "verified",
      unresolved: [],
      branches: [
        { branch_ref: "normal:1", outcome: "normal", guard_keys: [], feasibility: "verified", source_refs: behavior!.source_refs! },
        { branch_ref: "normal:1", outcome: "normal", guard_keys: [], feasibility: "verified", source_refs: behavior!.source_refs! },
      ],
    };
    expect(validateSourceSnapshot(duplicateBranch)).toMatchObject({
      valid: false,
      issues: expect.arrayContaining([expect.objectContaining({ code: "SOURCE_BEHAVIOR_SCHEMA_INVALID", path: "source_behaviors.0.branches.1.branch_ref" })]),
    });
  });

  it("resolves dynamic JSX label links and prefers an interactive child's own label", async () => {
    const root = await mkdtemp(join(tmpdir(), "scenarioforge-jsx-labels-"));
    await mkdir(join(root, "src"));
    await writeFile(join(root, "src", "Form.tsx"), [
      "export function Form() {",
      "  const id = useId();",
      "  return <><label htmlFor={id}>사번</label><input id={id} />",
      "    <label><span>출처 URL</span><a href='/source'>원문 새 창</a></label></>;",
      "}",
    ].join("\n"), "utf8");

    const snapshot = await new SourceScanner().scan({ projectRoot: root, projectId: "PRJ-shop", analysisRunId: "RUN-1", sourceSnapshotId: "SNAP-1", now: "2026-08-26T00:00:00.000Z" });

    expect(snapshot.interactions.map(({ kind, label }) => ({ kind, label }))).toEqual([
      { kind: "input", label: "사번" },
      { kind: "a", label: "원문 새 창" },
    ]);
  });

  it("prioritizes every requested closure entry before imported dependencies", async () => {
    const root = await mkdtemp(join(tmpdir(), "scenarioforge-closure-entry-priority-"));
    await mkdir(join(root, "src"));
    await writeFile(join(root, "src", "a.ts"), "import './b';\nexport const a = true;\n", "utf8");
    await writeFile(join(root, "src", "b.ts"), "export const b = true;\n", "utf8");
    await writeFile(join(root, "src", "z.ts"), "export const z = true;\n", "utf8");
    const snapshot = await new SourceScanner().scan({
      projectRoot: root,
      projectId: "PRJ-shop",
      analysisRunId: "RUN-1",
      sourceSnapshotId: "SNAP-1",
      now: "2026-08-26T00:00:00.000Z",
    });
    const a = snapshot.files.find((file) => file.path === "src/a.ts")!;
    const z = snapshot.files.find((file) => file.path === "src/z.ts")!;
    const closure = new ClosureService().build(snapshot, [a.source_id, z.source_id], a.size_bytes + z.size_bytes);

    expect(closure.files.map((file) => file.path)).toEqual(["src/a.ts", "src/z.ts"]);
    expect(closure.truncated).toBe(true);
  });

  it("parses JSX arrow-function attributes without leaking handler source into the accessible label", async () => {
    const root = await mkdtemp(join(tmpdir(), "scenarioforge-jsx-arrow-label-"));
    await mkdir(join(root, "src"));
    await writeFile(
      join(root, "src", "Pagination.jsx"),
      'export const Pagination=({page,totalPages,onPage}) => <button disabled={page >= totalPages} onClick={() => onPage(page + 1)} type="button">다음</button>;\n',
      "utf8",
    );

    const snapshot = await new SourceScanner().scan({
      projectRoot: root,
      projectId: "PRJ-shop",
      analysisRunId: "RUN-1",
      sourceSnapshotId: "SNAP-1",
      now: "2026-08-27T00:00:00.000Z",
    });

    expect(snapshot.interactions).toHaveLength(1);
    expect(snapshot.interactions[0]).toMatchObject({
      kind: "button",
      label: "다음",
      target_candidates: [{ by: "role-name", role: "button", name: "다음" }],
    });
    expect(JSON.stringify(snapshot.interactions[0])).not.toContain("onPage(page + 1)");
  });

  it("records state changed through a setter prop in a local-view handler chain", async () => {
    const root = await mkdtemp(join(tmpdir(), "scenarioforge-setter-prop-state-"));
    await mkdir(join(root, "src"));
    await writeFile(join(root, "src", "Page.tsx"), [
      "import { useState } from 'react';",
      "function Pagination({ page, onPage }) {",
      "  return <button type='button' onClick={() => onPage(page + 1)}>Next</button>;",
      "}",
      "export function Page({ setDbCache }) {",
      "  const [page, setCurrentPage] = useState(1);",
      "  const handlePage = (nextPage) => {",
      "    setCurrentPage(nextPage);",
      "    setDbCache?.((previous) => ({ ...previous, page: nextPage }));",
      "  };",
      "  return <Pagination page={page} onPage={handlePage} />;",
      "}",
    ].join("\n"), "utf8");

    const snapshot = await new SourceScanner().scan({ projectRoot: root, projectId: "PRJ-shop", analysisRunId: "RUN-1", sourceSnapshotId: "SNAP-1", now: "2026-08-27T00:00:00.000Z" });
    const behavior = snapshot.source_behaviors?.find((entry) => entry.called_symbols.includes("setDbCache"));

    expect(behavior).toMatchObject({
      local_state_keys: ["dbCache", "page"],
      local_view_only: true,
      journey_required: false,
    });
  });

  it("does not classify a view-named callback with an opaque side effect as local state", async () => {
    const root = await mkdtemp(join(tmpdir(), "scenarioforge-opaque-refresh-"));
    await mkdir(join(root, "src"));
    await writeFile(join(root, "src", "Page.tsx"), [
      "function Shell({ onRefresh }) {",
      "  return <button type='button' onClick={onRefresh}>Refresh</button>;",
      "}",
      "export function Page() {",
      "  return <Shell onRefresh={() => window.location.reload()} />;",
      "}",
    ].join("\n"), "utf8");

    const snapshot = await new SourceScanner().scan({ projectRoot: root, projectId: "PRJ-shop", analysisRunId: "RUN-1", sourceSnapshotId: "SNAP-1", now: "2026-08-27T00:00:00.000Z" });
    const behavior = snapshot.source_behaviors?.find((entry) => entry.called_symbols.includes("window.location.reload"));

    expect(behavior).toMatchObject({
      local_state_keys: [],
      local_view_only: false,
      journey_required: false,
    });
  });

  it("preserves checkbox role and label while leaving action semantics unresolved", async () => {
    const root = await mkdtemp(join(tmpdir(), "scenarioforge-jsx-checkbox-"));
    await mkdir(join(root, "src"));
    await writeFile(
      join(root, "src", "Settings.jsx"),
      'export const Settings=()=> <label><span>매트릭스 출력 옵션</span><input type="checkbox" defaultChecked={true} /></label>;\n',
      "utf8",
    );

    const snapshot = await new SourceScanner().scan({
      projectRoot: root,
      projectId: "PRJ-shop",
      analysisRunId: "RUN-1",
      sourceSnapshotId: "SNAP-1",
      now: "2026-08-27T00:00:00.000Z",
    });
    const source = snapshot.files[0];
    const grant = await new EvidenceGrantService(root).create(snapshot, "work-checkbox", [{ source_id: source.source_id, start_line: 1, end_line: 1 }]);
    const draft = createDeterministicFactDraft(snapshot, grant);

    expect(snapshot.interactions).toHaveLength(1);
    expect(snapshot.interactions[0]).toMatchObject({
      kind: "checkbox",
      label: "매트릭스 출력 옵션",
      target_candidates: [{ by: "role-name", role: "checkbox", name: "매트릭스 출력 옵션" }],
    });
    expect(draft.screens[0].elements[0]).toMatchObject({
      type: "checkbox",
      interaction: { action_kind: "unresolved" },
    });
  });

  it("uses an htmlFor label as the accessible name instead of the placeholder", async () => {
    const root = await mkdtemp(join(tmpdir(), "scenarioforge-jsx-linked-label-"));
    await mkdir(join(root, "src"));
    await writeFile(
      join(root, "src", "Login.jsx"),
      'export const Login=()=> <><label htmlFor="user-id">아이디</label><input id="user-id" placeholder="아이디를 입력하세요" /></>;\n',
      "utf8",
    );

    const snapshot = await new SourceScanner().scan({
      projectRoot: root,
      projectId: "PRJ-shop",
      analysisRunId: "RUN-1",
      sourceSnapshotId: "SNAP-1",
      now: "2026-08-27T00:00:00.000Z",
    });

    expect(snapshot.interactions).toHaveLength(1);
    expect(snapshot.interactions[0]).toMatchObject({
      kind: "input",
      label: "아이디",
      target_candidates: [{ by: "role-name", role: "textbox", name: "아이디" }],
    });
  });

  it("uses a file-input selector instead of a textbox role for upload controls", async () => {
    const root = await mkdtemp(join(tmpdir(), "scenarioforge-jsx-file-input-"));
    await mkdir(join(root, "src"));
    await writeFile(
      join(root, "src", "Upload.jsx"),
      'export const Upload=()=> <label>문서 업로드<input type="file" accept=".md,.txt" /></label>;\n',
      "utf8",
    );

    const snapshot = await new SourceScanner().scan({
      projectRoot: root,
      projectId: "PRJ-shop",
      analysisRunId: "RUN-1",
      sourceSnapshotId: "SNAP-1",
      now: "2026-08-27T00:00:00.000Z",
    });
    const grant = await new EvidenceGrantService(root).create(snapshot, "work-file", [{ source_id: snapshot.files[0].source_id, start_line: 1, end_line: 1 }]);
    const draft = createDeterministicFactDraft(snapshot, grant);

    expect(snapshot.interactions[0]).toMatchObject({
      kind: "file",
      label: "문서 업로드",
      target_candidates: [{ by: "css", value: 'input[type="file"]' }],
    });
    expect(snapshot.interactions[0].target_candidates).not.toContainEqual(expect.objectContaining({ role: "textbox" }));
    expect(draft.screens[0].elements[0]).toMatchObject({ type: "file", interaction: { action_kind: "unresolved" } });
  });

  it("scopes state-driven interactions to their enclosing Page components", async () => {
    const root = await mkdtemp(join(tmpdir(), "scenarioforge-jsx-component-screens-"));
    await mkdir(join(root, "src"));
    await writeFile(
      join(root, "src", "Workflow.jsx"),
      [
        'function UploadPage({ setPage }) { fetch("/api/upload"); return <button onClick={() => setPage("db")}>다음</button>; }',
        'function DbPage({ setPage }) { fetch("/api/db"); return <button onClick={() => setPage("upload")}>이전</button>; }',
        'function setPage() { return "helper"; }',
        'const normalizeScenarioMatrixPage = () => "helper";',
      ].join("\n"),
      "utf8",
    );

    const snapshot = await new SourceScanner().scan({
      projectRoot: root,
      projectId: "PRJ-shop",
      analysisRunId: "RUN-1",
      sourceSnapshotId: "SNAP-1",
      now: "2026-08-27T00:00:00.000Z",
    });

    expect(snapshot.routes).toEqual([
      expect.objectContaining({ screen_id: "SCR-component-uploadpage", route: "component:UploadPage" }),
      expect.objectContaining({ screen_id: "SCR-component-dbpage", route: "component:DbPage" }),
    ]);
    expect(snapshot.interactions).toEqual([
      expect.objectContaining({ label: "다음", screen_id: "SCR-component-uploadpage" }),
      expect.objectContaining({ label: "이전", screen_id: "SCR-component-dbpage" }),
    ]);
    expect(snapshot.apis).toEqual([
      expect.objectContaining({ path: "/api/upload", screen_id: "SCR-component-uploadpage" }),
      expect.objectContaining({ path: "/api/db", screen_id: "SCR-component-dbpage" }),
    ]);
  });

  it("assigns a helper component used by one Page to that owning screen", async () => {
    const root = await mkdtemp(join(tmpdir(), "scenarioforge-jsx-page-owned-helper-"));
    await mkdir(join(root, "src"));
    await writeFile(
      join(root, "src", "Main.jsx"),
      [
        'function Shell() { return <button>새 작업</button>; }',
        'function MainPage() { return <Shell />; }',
      ].join("\n"),
      "utf8",
    );

    const snapshot = await new SourceScanner().scan({
      projectRoot: root,
      projectId: "PRJ-shop",
      analysisRunId: "RUN-1",
      sourceSnapshotId: "SNAP-1",
      now: "2026-08-27T00:00:00.000Z",
    });

    expect(snapshot.interactions).toEqual([
      expect.objectContaining({ label: "새 작업", screen_id: "SCR-component-mainpage" }),
    ]);
  });

  it("does not assign a helper shared by multiple Pages to an arbitrary screen", async () => {
    const root = await mkdtemp(join(tmpdir(), "scenarioforge-jsx-shared-helper-"));
    await mkdir(join(root, "src"));
    await writeFile(
      join(root, "src", "Pages.jsx"),
      [
        'function Pager() { return <button>다음</button>; }',
        'function FirstPage() { return <Pager />; }',
        'function SecondPage() { return <Pager />; }',
      ].join("\n"),
      "utf8",
    );

    const snapshot = await new SourceScanner().scan({
      projectRoot: root,
      projectId: "PRJ-shop",
      analysisRunId: "RUN-1",
      sourceSnapshotId: "SNAP-1",
      now: "2026-08-27T00:00:00.000Z",
    });

    expect(snapshot.interactions).toEqual([
      expect.objectContaining({ label: "다음", screen_id: undefined }),
    ]);
  });

  it("assigns distinct deterministic IDs to repeated labels in the same source file", async () => {
    const root = await mkdtemp(join(tmpdir(), "scenarioforge-jsx-repeated-label-"));
    await mkdir(join(root, "src"));
    await writeFile(
      join(root, "src", "Dialog.jsx"),
      'export const Dialog=()=> <><button type="button">닫기</button><button type="button">닫기</button></>;\n',
      "utf8",
    );

    const snapshot = await new SourceScanner().scan({
      projectRoot: root,
      projectId: "PRJ-shop",
      analysisRunId: "RUN-1",
      sourceSnapshotId: "SNAP-1",
      now: "2026-08-27T00:00:00.000Z",
    });

    expect(snapshot.interactions.map((interaction) => interaction.label)).toEqual(["닫기", "닫기"]);
    expect(new Set(snapshot.interactions.map((interaction) => interaction.element_id))).toHaveProperty("size", 2);
  });

  it("reads the HTTP method from fetch options", async () => {
    const root = await mkdtemp(join(tmpdir(), "scenarioforge-fetch-method-"));
    await mkdir(join(root, "src"));
    await writeFile(join(root, "src", "login.ts"), 'export const login = () => fetch("/api/auth/login", { method: "POST" });\n', "utf8");

    const snapshot = await new SourceScanner().scan({
      projectRoot: root,
      projectId: "PRJ-shop",
      analysisRunId: "RUN-1",
      sourceSnapshotId: "SNAP-1",
      now: "2026-08-26T00:00:00.000Z",
    });

    expect(snapshot.apis).toEqual([expect.objectContaining({
      api_id: "API-POST-api-auth-login",
      method: "POST",
      path: "/api/auth/login",
    })]);
  });

  it("does not classify a local method-named helper call as an HTTP API", async () => {
    const root = await mkdtemp(join(tmpdir(), "scenarioforge-local-put-helper-"));
    await mkdir(join(root, "src"));
    await writeFile(join(root, "src", "query.ts"), [
      "const put = (key: string, value: string) => new URLSearchParams().set(key, value);",
      "export const query = (page: string) => put('page', page);",
      "export const load = () => axios.get('orders');",
    ].join("\n"), "utf8");

    const snapshot = await new SourceScanner().scan({
      projectRoot: root,
      projectId: "PRJ-shop",
      analysisRunId: "RUN-1",
      sourceSnapshotId: "SNAP-1",
      now: "2026-08-26T00:00:00.000Z",
    });

    expect(snapshot.apis).toEqual([expect.objectContaining({ method: "GET", path: "orders" })]);
  });

  it("excludes coding-agent worktrees from the project source snapshot", async () => {
    const root = await mkdtemp(join(tmpdir(), "scenarioforge-scan-worktree-"));
    await mkdir(join(root, "src"), { recursive: true });
    await mkdir(join(root, ".claude", "worktrees", "stale", "src"), { recursive: true });
    await writeFile(join(root, "src", "Page.tsx"), "export const Page=()=> <button>Current action</button>;\n", "utf8");
    await writeFile(join(root, ".claude", "worktrees", "stale", "src", "Page.tsx"), "export const Page=()=> <button>Stale action</button>;\n", "utf8");

    const snapshot = await new SourceScanner().scan({
      projectRoot: root,
      projectId: "PRJ-shop",
      analysisRunId: "RUN-1",
      sourceSnapshotId: "SNAP-1",
      now: "2026-08-26T00:00:00.000Z",
    });

    expect(snapshot.files.map((file) => file.path)).toEqual(["src/Page.tsx"]);
    expect(snapshot.interactions.map((interaction) => interaction.label)).toEqual(["Current action"]);
  });

  it("allows credential field references while still rejecting hard-coded credential literals", async () => {
    const root = await mkdtemp(join(tmpdir(), "scenarioforge-evidence-secret-"));
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "src", "safe.ts"), "const payload = { password: credentials.password };\n", "utf8");
    await writeFile(join(root, "src", "unsafe.ts"), "const config = { apiKey: \"not-a-real-secret-value\" };\n", "utf8");
    const snapshot = await new SourceScanner().scan({
      projectRoot: root,
      projectId: "PRJ-shop",
      analysisRunId: "RUN-1",
      sourceSnapshotId: "SNAP-1",
      now: "2026-08-26T00:00:00.000Z",
    });
    const safe = snapshot.files.find((file) => file.path === "src/safe.ts")!;
    const unsafe = snapshot.files.find((file) => file.path === "src/unsafe.ts")!;
    const service = new EvidenceGrantService(root);

    await expect(service.create(snapshot, "work-safe", [{ source_id: safe.source_id, start_line: 1, end_line: 1 }])).resolves.toMatchObject({ work_id: "work-safe" });
    await expect(service.create(snapshot, "work-unsafe", [{ source_id: unsafe.source_id, start_line: 1, end_line: 1 }])).rejects.toThrow("EVIDENCE_SECRET_DETECTED");
  });

  it("builds a complete FACT skeleton from scanner-owned IDs and granted evidence", () => {
    const grantedEvidence: EvidenceReference = { source_id: "SRC-login", source_snapshot_id: "SNAP-1", path: "src/Login.tsx", start_line: 1, end_line: 20, content_hash: "sha256:granted", evidence_grant_id: "EVG-work-1-granted" };
    const snapshot = {
      schema_version: 1 as const, ...identity, created_at: "2026-08-27T00:00:00.000Z", root_hash: "sha256:root", ui_stacks: ["react"], unsupported_ui_stacks: [],
      files: [{ source_id: "SRC-login", path: "src/Login.tsx", language: "tsx", content_hash: "sha256:file", size_bytes: 100, imports: [] }],
      routes: [],
      apis: [{ api_id: "API-POST-api-login", method: "POST", path: "/api/login", source_id: "SRC-login", line: 5 }],
      interactions: [{ element_id: "EL-login-submit", kind: "button", label: "Sign in", source_id: "SRC-login", line: 10, target_candidates: [{ by: "test-id", value: "login-submit" }] }],
      i18n: {},
    };
    const grant = { schema_version: 1 as const, evidence_grant_id: "EVG-work-1-granted", project_id: identity.project_id, work_id: "work-1", source_snapshot_id: identity.source_snapshot_id, evidence: [grantedEvidence], created_at: "2026-08-27T00:00:00.000Z" };

    const draft = createDeterministicFactDraft(snapshot, grant);

    expect(draft.screens).toHaveLength(1);
    expect(draft.screens[0]).toMatchObject({ screen_id: "SCR-src-login", elements: [{ id: "EL-login-submit", evidence: [grantedEvidence] }], apis: [{ id: "API-POST-api-login", evidence: [grantedEvidence] }], entry_guards: [], feedback: [], displays: [] });
    expect(validateFactBundle(draft).valid).toBe(true);
  });

  it("applies semantic FACT patches without allowing the model to replace IDs or evidence", () => {
    const grantedEvidence: EvidenceReference = { source_id: "SRC-login", source_snapshot_id: "SNAP-1", path: "src/Login.tsx", start_line: 1, end_line: 20, content_hash: "sha256:granted", evidence_grant_id: "EVG-work-1-granted" };
    const draft: FactBundle = {
      schema_version: 2, ...identity,
      screens: [{ schema_version: 3, ...identity, screen_id: "SCR-src-login", title: "Login", entry_guards: [], elements: [{ id: "EL-login-submit", type: "button", label: "Sign in", interaction: { action_kind: "click", surface_kind: "web", target_candidates: [{ by: "test-id", value: "login-submit" }, { by: "role-name", role: "button", name: "Sign in" }] }, evidence: [grantedEvidence] }], apis: [{ id: "API-POST-api-login", reads: [], writes: ["POST /api/login"], evidence: [grantedEvidence] }], feedback: [], displays: [], status: "draft" }],
      edges: [], predicates: [],
    };
    const patch = {
      schema_version: 2 as const,
      screen_updates: [{ screen_ref: "S1", title: "사용자 로그인" }],
      element_updates: [{ element_ref: "U1", label: "로그인", action_kind: "submit-login" }],
      api_updates: [{ api_ref: "A1", reads: ["credentials"], writes: ["session"] }],
      predicates: [{ key: "auth.success", values: ["true", "false"], source: "code" as const, evidence_element_refs: ["U1"] }],
      edges: [{ kind: "normal" as const, from_screen_ref: "S1", on_element_ref: "U1", to_screen_ref: "S1", guard: { predicate_key: "auth.success", value: "true" }, effect: { predicate_key: "auth.success", value: "true" } }],
    } as unknown as Parameters<typeof applyFactEnrichmentPatch>[1];

    const compiled = applyFactEnrichmentPatch(draft, patch);

    expect(compiled.screens[0]).toMatchObject({
      screen_id: "SCR-src-login",
      title: "사용자 로그인",
      elements: [{
        id: "EL-login-submit",
        label: "로그인",
        interaction: { target_candidates: [{ by: "test-id", value: "login-submit" }, { by: "role-name", role: "button", name: "Sign in" }] },
        evidence: [grantedEvidence],
      }],
      apis: [{ id: "API-POST-api-login", reads: ["credentials"], writes: ["session"], evidence: [grantedEvidence] }],
    });
    expect(compiled.screens[0].elements[0].interaction.target_candidates).toContainEqual({ by: "role-name", role: "button", name: "Sign in" });
    expect(compiled.predicates).toEqual([{ schema_version: 2, ...identity, pred_id: "PRED-auth-success", values: ["true", "false"], source: "code", evidence: [grantedEvidence] }]);
    expect(compiled.edges).toEqual([{ schema_version: 2, ...identity, edge_id: "E-0001", kind: "normal", from: "SCR-src-login", on: "EL-login-submit", guard: "PRED-auth-success=true", effect: "PRED-auth-success=true", to: "SCR-src-login", feedback: [], evidence: [grantedEvidence], status: "draft" }]);
    expect(validateFactBundle(compiled).valid).toBe(true);
    expect(() => applyFactEnrichmentPatch(draft, { ...patch, screen_updates: [{ screen_ref: "S1-24848ab2", title: "bad" }] } as unknown as Parameters<typeof applyFactEnrichmentPatch>[1])).toThrow("FACT_PATCH_REFERENCE_INVALID:screen_ref:S1-24848ab2");
  });

  it("compiles catalog semantics and edge proposals in separate backend-owned steps", () => {
    const catalogEvidence = { ...evidence, evidence_grant_id: "EVG-catalog" };
    const edgeEvidence = { ...evidence, evidence_grant_id: "EVG-edge" };
    const draft = factBundle();
    draft.edges = [];
    draft.predicates = [];
    draft.screens[0].elements[0].evidence = [catalogEvidence];
    const catalog = applyFactCatalogPatch(draft, {
      schema_version: 2,
      screen_updates: [],
      element_updates: [{ element_ref: "U1", action_kind: "submit-order" }],
      api_updates: [],
      predicates: [{ key: "cart-ready", values: ["true", "false"], source: "code", evidence_element_refs: ["U1"] }],
      edges: [],
    });
    const edgeDraft = structuredClone(draft);
    edgeDraft.screens[0].elements[0].evidence = [edgeEvidence];
    const ledger = applyEdgeProposalPatch(catalog, edgeDraft, {
      schema_version: 1,
      edges: [{ source_branch_ref: "normal:1", kind: "normal", from_screen_ref: "S1", on_element_ref: "U1", to_screen_ref: "S2", guard: { predicate_key: "cart-ready", value: "true" } }],
    });
    const assembled = assembleFactBundle(catalog, ledger);

    expect(catalog.screens[0].elements[0].interaction.action_kind).toBe("submit-order");
    expect(catalog.predicates.map((predicate) => predicate.pred_id)).toEqual(["PRED-cart-ready"]);
    expect(ledger.edges[0].evidence).toEqual([edgeEvidence]);
    expect(assembled.edges[0]).toMatchObject({ source_branch_ref: "normal:1", on: "EL-checkout-button-submit", guard: "PRED-cart-ready=true" });
    expect(edgeProposalPatchFromLedger(catalog, ledger)).toMatchObject({ schema_version: 1, edges: [{ source_branch_ref: "normal:1", from_screen_ref: "S1", on_element_ref: "U1", to_screen_ref: "S2", guard: { predicate_key: "cart-ready", value: "true" } }] });
  });

  it("canonicalizes a source null predicate value as the literal string null", () => {
    const draft = factBundle();
    draft.edges = [];
    draft.predicates = [];

    const catalog = applyFactCatalogPatch(draft, {
      schema_version: 2,
      screen_updates: [],
      element_updates: [],
      api_updates: [],
      predicates: [{
        key: "upload.stage",
        values: ["CREATED", "FAILED", null],
        source: "code",
        evidence_element_refs: ["U1"],
      }],
      edges: [],
    } as unknown as Parameters<typeof applyFactCatalogPatch>[1]);

    expect(catalog.predicates).toEqual([
      expect.objectContaining({ pred_id: "PRED-upload-stage", values: ["CREATED", "FAILED", "null"] }),
    ]);
  });

  it("fills the backend-fixed empty edge list when a catalog patch omits it", () => {
    const draft = factBundle();
    draft.edges = [];
    draft.predicates = [];
    const withoutEdges = {
      schema_version: 2,
      screen_updates: [],
      element_updates: [],
      api_updates: [],
      predicates: [],
    };

    expect(applyFactCatalogPatch(
      draft,
      withoutEdges as unknown as Parameters<typeof applyFactCatalogPatch>[1],
    ).screens).toHaveLength(draft.screens.length);
    expect(() => applyFactCatalogPatch(draft, {
      ...withoutEdges,
      edges: [{ kind: "normal", from_screen_ref: "S1", on_element_ref: "U1", to_screen_ref: "S2" }],
    } as Parameters<typeof applyFactCatalogPatch>[1])).toThrow("FACT_CATALOG_EDGE_FORBIDDEN");
  });

  it("merges split predicate declarations with the same key and source", () => {
    const draft = factBundle();
    draft.edges = [];
    draft.predicates = [];

    const catalog = applyFactCatalogPatch(draft, {
      schema_version: 2,
      screen_updates: [],
      element_updates: [],
      api_updates: [],
      predicates: [
        { key: "page", values: ["upload"], source: "code", evidence_element_refs: ["U1"] },
        { key: "page", values: ["settings", "upload"], source: "code", evidence_element_refs: ["U1"] },
      ],
      edges: [],
    });

    expect(catalog.predicates).toEqual([
      expect.objectContaining({ pred_id: "PRED-page", values: ["upload", "settings"] }),
    ]);
    expect(() => applyFactCatalogPatch(draft, {
      schema_version: 2,
      screen_updates: [],
      element_updates: [],
      api_updates: [],
      predicates: [
        { key: "page", values: ["upload"], source: "code", evidence_element_refs: ["U1"] },
        { key: "page", values: ["settings"], source: "db", evidence_element_refs: ["U1"] },
      ],
      edges: [],
    })).toThrow("FACT_PATCH_SCHEMA_INVALID");
  });

  it("reports every predicate key whose referenced value is undeclared", () => {
    const draft = factBundle();
    const patch = {
      schema_version: 2 as const,
      screen_updates: [],
      element_updates: [],
      api_updates: [],
      predicates: [
        { key: "csv_export_failed", values: ["true"], source: "code" as const, evidence_element_refs: ["U1"] },
        { key: "excel_export_failed", values: ["true"], source: "code" as const, evidence_element_refs: ["U1"] },
      ],
      edges: [
        { kind: "normal" as const, from_screen_ref: "S1", on_element_ref: "U1", to_screen_ref: "S1", effect: { predicate_key: "csv_export_failed", value: "false" } },
        { kind: "normal" as const, from_screen_ref: "S1", on_element_ref: "U1", to_screen_ref: "S1", effect: { predicate_key: "excel_export_failed", value: "false" } },
      ],
    };

    expect(() => applyFactEnrichmentPatch(draft, patch)).toThrow(
      "FACT_PATCH_REFERENCE_INVALID:predicate_value:csv_export_failed=false,excel_export_failed=false",
    );
  });

  it("normalizes null API read/write lists to canonical empty arrays", () => {
    const draft = factBundle();
    draft.screens[0].apis = [{ id: "API-POST-api-order", reads: [], writes: ["POST /api/order"], evidence: [evidence] }];
    const patch = {
      schema_version: 2,
      screen_updates: [],
      element_updates: [],
      api_updates: [{ api_ref: "A1", reads: null, writes: null }],
      predicates: [],
      edges: [],
    } as unknown as Parameters<typeof applyFactEnrichmentPatch>[1];

    const compiled = applyFactEnrichmentPatch(draft, patch);

    expect(compiled.screens[0].apis[0]).toMatchObject({ reads: [], writes: [] });
  });

  it("keeps elements without journey edges unresolved even when a semantic patch claims an action", () => {
    const draft = factBundle();
    draft.screens[0].elements[0].interaction.action_kind = "unresolved";
    const patch = {
      schema_version: 2,
      screen_updates: [],
      element_updates: [{ element_ref: "U1", action_kind: "save_settings" }],
      api_updates: [],
      predicates: [],
      edges: [],
    } as unknown as Parameters<typeof applyFactEnrichmentPatch>[1];

    const compiled = applyFactEnrichmentPatch(draft, patch);

    expect(compiled.screens[0].elements[0].interaction.action_kind).toBe("unresolved");
  });

  it("compiles every conjunctive edge guard into FACT and scenario preconditions", () => {
    const draft = factBundle();
    const patch = {
      schema_version: 2,
      screen_updates: [],
      element_updates: [],
      api_updates: [],
      predicates: [
        { key: "cart_ready", values: ["true"], source: "code", evidence_element_refs: ["U1"] },
        { key: "request_idle", values: ["true"], source: "code", evidence_element_refs: ["U1"] },
      ],
      edges: [{
        kind: "normal",
        from_screen_ref: "S1",
        on_element_ref: "U1",
        to_screen_ref: "S2",
        guard: { all: [
          { predicate_key: "cart_ready", value: "true" },
          { predicate_key: "request_idle", value: "true" },
        ] },
      }],
    } as unknown as Parameters<typeof applyFactEnrichmentPatch>[1];
    const facts = applyFactEnrichmentPatch(draft, patch);
    const wiki = wikiBundle();
    wiki.workflows[0].cites = ["SCR-checkout", "E-0001", "PRED-cart-ready", "PRED-request-idle"];

    expect(facts.edges[0].guard).toBe("PRED-cart-ready=true && PRED-request-idle=true");
    expect(compileScenarioSet(facts, wiki).scenarios[0].preconditions).toEqual([
      { text: "PRED-cart-ready=true", predicate_refs: ["PRED-cart-ready"], data_binding_keys: [] },
      { text: "PRED-request-idle=true", predicate_refs: ["PRED-request-idle"], data_binding_keys: [] },
    ]);
  });

  it("normalizes an empty conjunctive guard to an unconditional FACT edge", () => {
    const draft = factBundle();
    const patch = {
      schema_version: 2,
      screen_updates: [],
      element_updates: [],
      api_updates: [],
      predicates: [],
      edges: [{
        kind: "normal",
        from_screen_ref: "S1",
        on_element_ref: "U1",
        to_screen_ref: "S2",
        guard: { all: [] },
      }],
    } as unknown as Parameters<typeof applyFactEnrichmentPatch>[1];

    const facts = applyFactEnrichmentPatch(draft, patch);

    expect(facts.edges[0].guard).toBeUndefined();
  });

  it("normalizes an empty conjunctive effect before semantic edge validation", () => {
    const draft = factBundle();
    const patch = {
      schema_version: 2,
      screen_updates: [],
      element_updates: [],
      api_updates: [],
      predicates: [],
      edges: [{
        kind: "normal",
        from_screen_ref: "S1",
        on_element_ref: "U1",
        to_screen_ref: "S2",
        effect: { all: [] },
      }],
    } as unknown as Parameters<typeof applyFactEnrichmentPatch>[1];

    const facts = applyFactEnrichmentPatch(draft, patch);

    expect(facts.edges[0].effect).toBeUndefined();
  });

  it("preserves FACT→WIKI→SCENARIO ID relations and coverage", () => {
    const facts = factBundle();
    const wiki = wikiBundle();
    expect(validateFactBundle(facts).valid).toBe(true);
    expect(validateWikiBundle(wiki, facts).valid).toBe(true);
    const scenarios = compileScenarioSet(facts, wiki);
    expect(validateScenarioSet(scenarios, facts, wiki).valid).toBe(true);
    expect(scenarios.scenarios[0]).toMatchObject({ scenario_id: "SCN-ORDER-PLACE-001", path: ["E-0001"], steps: [{ action_ref: { edge: "E-0001", element: "EL-checkout-button-submit" } }] });
    expect(calculateCoverage(facts, scenarios)).toMatchObject({ coverage_percent: 100, uncovered_edge_ids: [] });
  });

  it("builds acyclic entry dependencies instead of prefixing a workflow with a backward transition", () => {
    const facts = factBundle();
    facts.screens[1].elements.push({
      id: "EL-complete-button-back",
      type: "button",
      label: "Back to checkout",
      interaction: { action_kind: "navigate", surface_kind: "web", target_candidates: [{ by: "test-id", value: "back-to-checkout" }] },
      evidence: [evidence],
    });
    facts.edges.push({
      schema_version: 2,
      ...identity,
      edge_id: "E-0002",
      kind: "normal",
      from: "SCR-complete",
      on: "EL-complete-button-back",
      to: "SCR-checkout",
      feedback: [],
      evidence: [evidence],
      status: "verified",
    });

    const wiki = compileReachableWorkflowSkeleton(facts);
    const forward = wiki.workflows.find((workflow) => workflow.cites.includes("E-0001"))!;
    const backward = wiki.workflows.find((workflow) => workflow.cites.includes("E-0002"))!;
    const scenarios = compileScenarioSet(facts, wiki);

    expect(forward.depends_on).toEqual([]);
    expect(backward.depends_on).toEqual([forward.workflow]);
    expect(scenarios.scenarios.find((scenario) => scenario.workflow === forward.workflow)?.path).toEqual(["E-0001"]);
    expect(scenarios.scenarios.find((scenario) => scenario.workflow === backward.workflow)?.path).toEqual(["E-0001", "E-0002"]);
  });

  it("applies only scenario narration while preserving the deterministic scenario skeleton", () => {
    const facts = factBundle();
    const wiki = wikiBundle();
    const draft = compileScenarioSet(facts, wiki);
    const scenario = draft.scenarios[0];

    const narrated = applyScenarioNarrationPatch(draft, {
      schema_version: 1,
      scenario_updates: [{
        scenario_ref: scenario.scenario_id,
        preconditions: scenario.preconditions.map((_, index) => ({ index, text: "The cart is ready for checkout." })),
        steps: scenario.steps.map((step) => ({ n: step.n, action: "Submit the prepared order.", expected: "The order completion screen is shown." })),
      }],
    });

    expect(narrated.scenarios[0].preconditions[0].text).toBe("The cart is ready for checkout.");
    expect(narrated.scenarios[0].steps[0]).toMatchObject({ action: "Submit the prepared order.", expected: "The order completion screen is shown." });
    expect(validateScenarioSet(narrated, facts, wiki, draft).valid).toBe(true);
    expect(narrated.scenarios[0].path).toEqual(draft.scenarios[0].path);
    expect(narrated.scenarios[0].steps[0].action_ref).toEqual(draft.scenarios[0].steps[0].action_ref);
  });

  it("rejects incomplete or unknown scenario narration patch references", () => {
    const draft = compileScenarioSet(factBundle(), wikiBundle());
    const scenario = draft.scenarios[0];
    const update = {
      scenario_ref: scenario.scenario_id,
      preconditions: scenario.preconditions.map((precondition, index) => ({ index, text: precondition.text })),
      steps: scenario.steps.map((step) => ({ n: step.n, action: step.action, expected: step.expected })),
    };

    expect(() => applyScenarioNarrationPatch(draft, { schema_version: 1, scenario_updates: [{ ...update, scenario_ref: "SCN-unknown" }] }))
      .toThrow("SCENARIO_NARRATION_PATCH_REFERENCE_INVALID:SCN-unknown");
    expect(() => applyScenarioNarrationPatch(draft, { schema_version: 1, scenario_updates: [{ ...update, steps: [] }] }))
      .toThrow(`SCENARIO_NARRATION_PATCH_INCOMPLETE:${scenario.scenario_id}`);
  });

  it("merges only reviewer-targeted scenario narration and preserves every other case byte-for-byte", () => {
    const draft = compileScenarioSet(factBundle(), wikiBundle());
    const scenarios = structuredClone(draft);
    scenarios.scenarios.push({ ...structuredClone(scenarios.scenarios[0]), scenario_id: "SCN-ORDER-PLACE-002" });
    const untouched = JSON.stringify(scenarios.scenarios[1]);
    const target = scenarios.scenarios[0];
    const untouchedTargetAction = target.steps[0].action;
    const untouchedTargetPreconditions = JSON.stringify(target.preconditions);
    const scope = createScenarioNarrationCorrectionScope(scenarios, [`SCENARIO_NARRATION_EXPECTED_WEAK:${target.scenario_id}:step=1`]);

    const corrected = applyScenarioNarrationCorrectionPatch(scenarios, scope, {
      schema_version: 1,
      base_artifact_hash: scope.base_artifact_hash,
      scenario_updates: [{
        scenario_ref: target.scenario_id,
        steps: [{ n: 1, expected: "The completed order is visible." }],
      }],
    });

    expect(corrected.scenarios[0].steps[0].expected).toBe("The completed order is visible.");
    expect(corrected.scenarios[0].steps[0].action).toBe(untouchedTargetAction);
    expect(JSON.stringify(corrected.scenarios[0].preconditions)).toBe(untouchedTargetPreconditions);
    expect(JSON.stringify(corrected.scenarios[1])).toBe(untouched);
    expect(() => applyScenarioNarrationCorrectionPatch(scenarios, scope, {
      schema_version: 1,
      base_artifact_hash: scope.base_artifact_hash,
      scenario_updates: [{
        scenario_ref: scenarios.scenarios[1].scenario_id,
        steps: [{ n: 1, expected: scenarios.scenarios[1].steps[0].expected }],
      }],
    })).toThrow("SCENARIO_CORRECTION_PATCH_SCOPE_INVALID");
  });

  it("requires a normal success path for every verified workflow before scenario generation", () => {
    const facts = factBundle();
    const wiki = wikiBundle();
    wiki.workflows.push({
      ...structuredClone(wiki.workflows[0]),
      workflow: "WF-ORDER-AUDIT",
      goal: "Audit an order",
      cites: [],
    });

    const readiness = validateWikiReadiness(wiki, facts);

    expect(readiness.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "WIKI_SUCCESS_PATH_MISSING", path: "workflows.1" }),
    ]));
  });

  it("matches correction references as exact tokens and rejects malformed collections", () => {
    const draft = compileScenarioSet(factBundle(), wikiBundle());
    const short = draft.scenarios[0];
    const collision = { ...structuredClone(short), scenario_id: `${short.scenario_id}-EXTRA` };
    const scenarios = { ...structuredClone(draft), scenarios: [short, collision] };
    const scope = createScenarioNarrationCorrectionScope(scenarios, [`SCENARIO_NARRATION_EXPECTED_WEAK:${collision.scenario_id}:step=1`]);

    expect(scope.scenario_refs).toEqual([collision.scenario_id]);
    expect(() => createScenarioNarrationCorrectionScope(scenarios, [`SCENARIO_NARRATION_EXPECTED_WEAK:${short.scenario_id}:${collision.scenario_id}:step=1`]))
      .toThrow("SCENARIO_CORRECTION_SCOPE_UNMAPPABLE_AMBIGUOUS");
    expect(() => applyScenarioNarrationCorrectionPatch(scenarios, scope, {
      schema_version: 1,
      base_artifact_hash: scope.base_artifact_hash,
    } as never)).toThrow("SCENARIO_CORRECTION_PATCH_INVALID");

    const wiki = wikiBundle();
    const wikiScope = createWikiGoalCorrectionScope(wiki, [`WIKI_GOAL_TOO_GENERIC:${wiki.workflows[0].workflow}`]);
    expect(() => applyWikiGoalCorrectionPatch(wiki, wikiScope, {
      schema_version: 1,
      base_artifact_hash: wikiScope.base_artifact_hash,
    } as never)).toThrow("WIKI_CORRECTION_PATCH_INVALID");
  });

  it("uses edge effects to satisfy later guards instead of turning required user actions into preconditions", () => {
    const facts = factBundle();
    facts.screens[0].elements.unshift({
      id: "EL-checkout-input-account",
      type: "input",
      label: "Account",
      interaction: { action_kind: "fill", surface_kind: "web", target_candidates: [{ by: "role-name", role: "textbox", name: "Account" }] },
      evidence: [evidence],
    });
    facts.edges = [
      {
        schema_version: 2,
        ...identity,
        edge_id: "E-0001",
        kind: "normal",
        from: "SCR-checkout",
        on: "EL-checkout-input-account",
        effect: "PRED-account.present=true",
        to: "SCR-checkout",
        feedback: [],
        evidence: [evidence],
        status: "verified",
      },
      {
        ...facts.edges[0],
        edge_id: "E-0002",
        on: "EL-checkout-button-submit",
        guard: "PRED-account.present=true",
        effect: "PRED-order.submitted=true",
        to: "SCR-complete",
      },
    ];
    facts.predicates = [
      { schema_version: 2, ...identity, pred_id: "PRED-account.present", values: ["true", "false"], source: "code", evidence: [evidence] },
      { schema_version: 2, ...identity, pred_id: "PRED-order.submitted", values: ["true", "false"], source: "code", evidence: [evidence] },
    ];
    const wiki = wikiBundle();
    wiki.workflows[0].cites = ["SCR-checkout", "SCR-complete", "E-0001", "E-0002", "PRED-account.present", "PRED-order.submitted"];

    const scenarios = compileScenarioSet(facts, wiki);

    expect(scenarios.scenarios.map((scenario) => scenario.path)).toEqual([["E-0001", "E-0002"]]);
    expect(scenarios.scenarios[0].preconditions).toEqual([]);
  });

  it("rejects edge effects that do not use registered predicate assignments", () => {
    const facts = factBundle();
    facts.edges[0].effect = "session created";

    expect(validateFactBundle(facts).issues.map((entry) => entry.code)).toContain("EDGE_EFFECT_PREDICATE_INVALID");
  });

  it("rejects an edge trigger element owned by a different source screen", () => {
    const facts = factBundle();
    facts.edges[0].from = "SCR-complete";

    expect(validateFactBundle(facts).issues).toContainEqual(expect.objectContaining({
      code: "EDGE_ELEMENT_SCREEN_MISMATCH",
      path: "edges.0.on",
    }));
  });

  it("accepts and round-trips a registered empty-string predicate assignment", () => {
    const facts = factBundle();
    facts.predicates.push({ schema_version: 2, ...identity, pred_id: "PRED-search-query", values: ["", "typed"], source: "code", evidence: [evidence] });
    facts.edges[0].effect = "PRED-search-query=";

    expect(validateFactBundle(facts).issues.map((entry) => entry.code)).not.toContain("EDGE_EFFECT_PREDICATE_INVALID");
    expect(edgeProposalPatchFromLedger(createFactCatalog(facts), createEdgeLedger(facts)).edges[0].effect).toEqual({ predicate_key: "search-query", value: "" });
  });

  it("normalizes an exact key alias in conjunctive edge predicate clauses", () => {
    const facts = factBundle();
    facts.predicates[0].pred_id = "PRED-cart-ready";
    const catalog = createFactCatalog(facts);
    const draft: FactBundle = { ...structuredClone(facts), predicates: [], edges: [] };
    const patch = {
      schema_version: 1,
      edges: [{
        kind: "normal",
        from_screen_ref: "S1",
        on_element_ref: "U1",
        to_screen_ref: "S2",
        effect: { all: [{ key: "cart-ready", value: "true" }] },
      }],
    } as unknown as Parameters<typeof applyEdgeProposalPatch>[2];

    const ledger = applyEdgeProposalPatch(catalog, draft, patch);

    expect(ledger.edges[0]?.effect).toBe("PRED-cart-ready=true");
  });

  it("permits exactly one bounded edge predicate-reference correction", async () => {
    const facts = factBundle();
    facts.predicates[0].pred_id = "PRED-cart-ready";
    facts.edges[0].guard = "PRED-cart-ready=true";
    const catalog = createFactCatalog(facts);
    const draft: FactBundle = { ...structuredClone(facts), predicates: [], edges: [] };
    const invalid = {
      schema_version: 1 as const,
      edges: [{ kind: "normal" as const, from_screen_ref: "S1", on_element_ref: "U1", to_screen_ref: "S2", effect: { predicate_key: "cart-ready", value: "missing" } }],
    };
    const corrected = {
      schema_version: 1 as const,
      edges: [{ kind: "normal" as const, from_screen_ref: "S1", on_element_ref: "U1", to_screen_ref: "S2", effect: { predicate_key: "cart-ready", value: "true" } }],
    };
    let corrections = 0;

    const ledger = await applyEdgeProposalPatchWithCorrection(catalog, draft, invalid, async (message, rejected) => {
      corrections += 1;
      expect(message).toBe("FACT_PATCH_REFERENCE_INVALID:predicate_value:cart-ready=missing");
      expect(rejected).toBe(invalid);
      return corrected;
    });

    expect(corrections).toBe(1);
    expect(ledger.edges[0].effect).toBe("PRED-cart-ready=true");
    await expect(applyEdgeProposalPatchWithCorrection(catalog, draft, invalid, async () => invalid)).rejects.toThrow("FACT_PATCH_REFERENCE_INVALID:predicate_value:cart-ready=missing");
  });

  it("reports an unsupported disjunctive edge guard at its exact correction path", async () => {
    const facts = factBundle();
    facts.predicates[0].pred_id = "PRED-cart-ready";
    facts.edges[0].guard = "PRED-cart-ready=true";
    const catalog = createFactCatalog(facts);
    const draft: FactBundle = { ...structuredClone(facts), predicates: [], edges: [] };
    const clauses = [
      { predicate_key: "cart-ready", value: "true" },
      { predicate_key: "cart-ready", value: "false" },
    ];
    const invalid = {
      schema_version: 1 as const,
      edges: [{ kind: "normal" as const, from_screen_ref: "S1", on_element_ref: "U1", to_screen_ref: "S2", guard: { any: clauses } }],
    } as unknown as Parameters<typeof applyEdgeProposalPatchWithCorrection>[2];
    let corrections = 0;

    const ledger = await applyEdgeProposalPatchWithCorrection(catalog, draft, invalid, async (message, rejected) => {
      corrections += 1;
      expect(message).toBe("FACT_PATCH_SCHEMA_INVALID:edges.0.guard:ANY_UNSUPPORTED");
      expect(rejected).toBe(invalid);
      return {
        schema_version: 1,
        edges: clauses.map((guard) => ({ kind: "normal", from_screen_ref: "S1", on_element_ref: "U1", to_screen_ref: "S2", guard })),
      };
    });

    expect(corrections).toBe(1);
    expect(ledger.edges).toHaveLength(2);
  });

  it("rejects split request-start and completion clicks for one async user trigger", () => {
    const facts = factBundle();
    facts.screens[0].elements[0].interaction.action_kind = "download_csv";
    facts.edges = [
      { ...facts.edges[0], edge_id: "E-0001", to: "SCR-checkout", guard: "PRED-request-idle=true", effect: "PRED-request-idle=false" },
      { ...facts.edges[0], edge_id: "E-0002", guard: "PRED-request-idle=false", effect: "PRED-request-idle=true", to: "SCR-complete" },
    ];
    facts.predicates = [{ schema_version: 2, ...identity, pred_id: "PRED-request-idle", values: ["true", "false"], source: "code", evidence: [evidence] }];

    expect(validateFactBundle(facts).issues.map((entry) => entry.code)).toContain("FACT_ASYNC_TRIGGER_SPLIT");
  });

  it("rejects a single async normal edge whose effect records only request-start state", () => {
    const facts = factBundle();
    facts.screens[0].elements[0].interaction.action_kind = "generate_scenarios";
    facts.edges[0].effect = "PRED-generation-requesting=true";
    facts.predicates.push(
      { schema_version: 2, ...identity, pred_id: "PRED-generation-requesting", values: ["true", "false"], source: "code", evidence: [evidence] },
      { schema_version: 2, ...identity, pred_id: "PRED-generation-complete", values: ["true", "false"], source: "code", evidence: [evidence] },
    );

    expect(validateFactBundle(facts).issues.map((entry) => entry.code)).toContain("FACT_ASYNC_TRIGGER_REQUEST_START_ONLY");
  });

  it("accepts an async edge whose effect records an observable request acknowledgement", () => {
    const facts = factBundle();
    facts.screens[0].elements[0].interaction.action_kind = "generate_scenarios";
    facts.edges[0].effect = "PRED-generation-requested=true";
    facts.predicates.push(
      { schema_version: 2, ...identity, pred_id: "PRED-generation-requested", values: ["true", "false"], source: "code", evidence: [evidence] },
    );

    expect(validateFactBundle(facts).issues.map((entry) => entry.code)).not.toContain("FACT_ASYNC_TRIGGER_REQUEST_START_ONLY");
  });

  it("accepts an async download edge whose lifecycle predicate is cleared on completion", () => {
    const facts = factBundle();
    facts.screens[0].elements[0].interaction.action_kind = "download_csv";
    facts.edges[0].effect = "PRED-scenario-downloading=";
    facts.predicates.push(
      { schema_version: 2, ...identity, pred_id: "PRED-scenario-downloading", values: ["csv", "excel", ""], source: "code", evidence: [evidence] },
    );

    expect(validateFactBundle(facts).issues.map((entry) => entry.code)).not.toContain("FACT_ASYNC_TRIGGER_REQUEST_START_ONLY");
  });

  it("rejects a same-screen journey edge without an observable outcome", () => {
    const facts = factBundle();
    facts.edges[0] = { ...facts.edges[0], to: facts.edges[0].from, feedback: [] };

    expect(validateFactBundle(facts).issues).toContainEqual(expect.objectContaining({
      code: "FACT_SELF_LOOP_OUTCOME_MISSING",
      path: "edges.0",
    }));
  });

  it("accepts an async normal edge whose request predicate records a stable completion", () => {
    const facts = factBundle();
    facts.screens[0].elements[0].interaction.action_kind = "generate_scenarios";
    facts.edges[0].effect = "PRED-generation-request=completed";
    facts.predicates.push(
      { schema_version: 2, ...identity, pred_id: "PRED-generation-request", values: ["idle", "completed", "failed"], source: "code", evidence: [evidence] },
    );

    expect(validateFactBundle(facts).issues.map((entry) => entry.code)).not.toContain("FACT_ASYNC_TRIGGER_REQUEST_START_ONLY");
  });

  it("allows two prior-value branches for a reversible toggle", () => {
    const facts = factBundle();
    facts.screens[0].elements[0].interaction.action_kind = "toggle_selection";
    facts.edges = [
      { ...facts.edges[0], edge_id: "E-0001", to: "SCR-checkout", guard: "PRED-selected=false", effect: "PRED-selected=true" },
      { ...facts.edges[0], edge_id: "E-0002", to: "SCR-checkout", guard: "PRED-selected=true", effect: "PRED-selected=false" },
    ];
    facts.predicates = [{ schema_version: 2, ...identity, pred_id: "PRED-selected", values: ["true", "false"], source: "code", evidence: [evidence] }];

    expect(validateFactBundle(facts).issues.map((entry) => entry.code)).not.toContain("FACT_ASYNC_TRIGGER_SPLIT");
  });

  it("merges only backend-targeted FACT correction fields and preserves the rest of the rejected patch", () => {
    const draft = factBundle();
    const rejected = {
      schema_version: 2 as const,
      screen_updates: [],
      element_updates: [],
      api_updates: [],
      predicates: [{ key: "cart.ready", values: ["true", "false"], source: "code" as const, evidence_element_refs: ["U1"] }],
      edges: [{ kind: "normal" as const, from_screen_ref: "S2", on_element_ref: "U1", to_screen_ref: "S2" }],
    };
    const issues = [
      { code: "EDGE_ELEMENT_SCREEN_MISMATCH", severity: "error" as const, path: "edges.0.on", message: "Edge trigger element must belong to the source screen." },
      { code: "FACT_SOURCE_ACTION_UNRESOLVED", severity: "error" as const, path: "$.screens.elements[id=EL-checkout-button-submit].interaction.action_kind", message: "The action is unresolved." },
      { code: "FACT_SOURCE_ACTION_MISSING", severity: "error" as const, path: "$.edges[on=EL-checkout-button-submit]", message: "The source-backed action has no FACT edge." },
    ];
    const unresolvedOnly = createFactCorrectionPlan(draft, rejected, [{
      code: "FACT_SOURCE_ACTION_UNRESOLVED",
      severity: "error" as const,
      path: "$.screens.elements[id=EL-checkout-button-submit].interaction.action_kind",
      message: "EL-checkout-button-submit is a backend-classified journey action but its semantic action_kind remains unresolved.",
    }]);

    expect(unresolvedOnly.add_edge_element_refs).toEqual(["U1"]);

    const forbiddenOnly = createFactCorrectionPlan(draft, rejected, [{
      code: "FACT_UNRESOLVED_CONNECTION_EDGE_FORBIDDEN",
      severity: "error" as const,
      path: "$.edges[on=EL-checkout-button-submit]",
      message: "EL-checkout-button-submit has unresolved source feasibility, so it must not carry a FACT edge.",
    }]);

    expect(forbiddenOnly.replace_edge_indexes).toEqual([0]);
    expect(forbiddenOnly.remove_edge_indexes).toEqual([0]);

    const branchRefOnly = createFactCorrectionPlan(draft, rejected, [{
      code: "FACT_SOURCE_BRANCH_REF_MISSING",
      severity: "error" as const,
      path: "$.edges[edge_id=E-0001].source_branch_ref",
      message: "E-0001 for EL-checkout-button-submit must identify its backend-owned source branch.",
    }]);

    expect(branchRefOnly.edge_update_fields).toEqual({ 0: ["kind", "source_branch_ref"] });

    const branchDuplicate = createFactCorrectionPlan(draft, rejected, [{
      code: "FACT_SOURCE_BRANCH_DUPLICATE",
      severity: "error" as const,
      path: "$.edges[edge_id=E-0001].source_branch_ref",
      message: "E-0001 duplicates backend branch normal:1 for EL-checkout-button-submit at src/Page.tsx:12.",
    }]);

    expect(branchDuplicate.remove_edge_indexes).toEqual([0]);

    const navigationMismatch = createFactCorrectionPlan(draft, rejected, [{
      code: "FACT_LITERAL_NAVIGATION_TARGET_MISMATCH",
      severity: "error" as const,
      path: "$.edges[on=EL-checkout-button-submit]",
      message: "EL-checkout-button-submit navigates to /complete, but FACT targets SCR-checkout.",
    }]);

    expect(navigationMismatch.edge_update_fields).toEqual({ 0: ["to_screen_ref"] });

    const selfLoopOnly = createFactCorrectionPlan(draft, rejected, [{
      code: "FACT_JOURNEY_ACTION_SELF_LOOP_ONLY",
      severity: "error" as const,
      path: "$.edges[on=EL-checkout-button-submit]",
      message: "EL-checkout-button-submit is a journey action, but every normal edge returns to SCR-checkout.",
    }]);

    expect(selfLoopOnly.edge_update_fields).toEqual({ 0: ["to_screen_ref"] });

    const plan = createFactCorrectionPlan(draft, rejected, issues);

    expect(plan).toMatchObject({
      element_update_fields: { U1: ["action_kind"] },
      replace_edge_indexes: [0],
      add_edge_element_refs: ["U1"],
      predicate_element_refs: ["U1"],
      replace_edge_identities: [{ edge_index: 0, on_element_ref: "U1" }],
    });
    const corrected = applyFactCorrectionPatch(rejected, plan, {
      schema_version: 1,
      base_patch_hash: plan.base_patch_hash,
      element_update_upserts: [{ element_ref: "U1", action_kind: "submit_order" }],
      predicate_upserts: [],
      edge_changes: [{ operation: "replace", edge_index: 0, edge: { kind: "normal", from_screen_ref: "S1", on_element_ref: "U1", to_screen_ref: "S2" } }],
    });

    expect(corrected.predicates).toEqual(rejected.predicates);
    expect(corrected.element_updates).toEqual([{ element_ref: "U1", action_kind: "submit_order" }]);
    expect(corrected.edges).toEqual([{ kind: "normal", from_screen_ref: "S1", on_element_ref: "U1", to_screen_ref: "S2" }]);
    expect(() => applyFactCorrectionPatch(rejected, plan, {
      schema_version: 1,
      base_patch_hash: plan.base_patch_hash,
      element_update_upserts: [{ element_ref: "U1", label: "Out-of-scope label" }],
      predicate_upserts: [],
      edge_changes: [{ operation: "replace", edge_index: 0, edge: { kind: "normal", from_screen_ref: "S1", on_element_ref: "U1", to_screen_ref: "S2" } }],
    })).toThrow("FACT_CORRECTION_ELEMENT_FIELD_OUT_OF_SCOPE:U1:label");
  });

  it("preserves existing FACT predicate evidence when a correction adds another required source-state element", () => {
    const draft = factBundle();
    draft.screens[1]!.elements.push({
      ...structuredClone(draft.screens[0]!.elements[0]!),
      id: "EL-complete-download-message",
      label: "Download message",
    });
    const rejected = {
      schema_version: 2 as const,
      screen_updates: [],
      element_updates: [],
      api_updates: [],
      predicates: [{
        key: "downloadMessage",
        values: [""],
        source: "code" as const,
        evidence_element_refs: ["U1"],
      }],
      edges: [],
    };
    const plan = createFactCorrectionPlan(draft, rejected, [{
      code: "FACT_SOURCE_STATE_PREDICATE_MISSING",
      severity: "error" as const,
      path: "$.predicates[element=EL-complete-download-message]",
      message: "U2 changes source-backed view state without evidence-linked predicates; states=downloadMessage.",
    }]);

    const corrected = applyFactCorrectionPatch(rejected, plan, {
      schema_version: 1,
      base_patch_hash: plan.base_patch_hash,
      element_update_upserts: [],
      predicate_upserts: [{
        key: "downloadMessage",
        values: ["completed"],
        source: "code",
        evidence_element_refs: ["U2"],
      }],
      edge_changes: [],
    });

    expect(corrected.predicates).toEqual([{
      key: "downloadMessage",
      values: ["", "completed"],
      source: "code",
      evidence_element_refs: ["U1", "U2"],
    }]);
    expect(() => applyFactCorrectionPatch(rejected, plan, {
      schema_version: 1,
      base_patch_hash: plan.base_patch_hash,
      element_update_upserts: [],
      predicate_upserts: [{
        key: "downloadMessage",
        values: ["completed"],
        source: "assumed",
        evidence_element_refs: ["U2"],
      }],
      edge_changes: [],
    })).toThrow("FACT_CORRECTION_PREDICATE_SOURCE_CHANGED:downloadMessage");
  });

  it("preserves an untargeted edge byte-for-byte when an edge correction patch changes another edge", () => {
    const draft = factBundle();
    const rejected = {
      schema_version: 2 as const,
      screen_updates: [],
      element_updates: [],
      api_updates: [],
      predicates: [{ key: "cart.ready", values: ["true", "false"], source: "code" as const, evidence_element_refs: ["U1"] }],
      edges: [
        { kind: "normal" as const, from_screen_ref: "S1", on_element_ref: "U1", to_screen_ref: "S2", guard: { predicate_key: "cart.ready", value: "true" } },
        { kind: "exception" as const, from_screen_ref: "S1", on_element_ref: "U1", to_screen_ref: "S1", effect: { predicate_key: "missing", value: "true" } },
      ],
    };
    const plan = createFactCorrectionPlan(draft, rejected, [{
      code: "FACT_PATCH_REFERENCE_INVALID",
      severity: "error" as const,
      path: "edges.0.effect",
      message: "Edge 0 effect references an unknown predicate.",
    }]);
    const untouched = structuredClone(rejected.edges[0]);

    const corrected = applyFactCorrectionPatch(rejected, plan, {
      schema_version: 1,
      base_patch_hash: plan.base_patch_hash,
      element_update_upserts: [],
      predicate_upserts: [],
      edge_changes: [{
        operation: "replace",
        edge_index: 0,
        edge: { kind: "exception", from_screen_ref: "S1", on_element_ref: "U1", to_screen_ref: "S1", effect: { predicate_key: "cart.ready", value: "false" } },
      }],
    });

    expect(corrected.edges.find((edge) => edge.kind === "normal")).toStrictEqual(untouched);
    expect(corrected.edges.find((edge) => edge.kind === "exception")?.effect).toEqual({ predicate_key: "cart.ready", value: "false" });
  });

  it("maps a missing deterministic branch to an edge-only correction target", () => {
    const draft = factBundle();
    const rejected = {
      schema_version: 2 as const,
      screen_updates: [],
      element_updates: [],
      api_updates: [],
      predicates: [],
      edges: [{ kind: "normal" as const, from_screen_ref: "S1", on_element_ref: "U1", to_screen_ref: "S2" }],
    };

    const plan = createFactCorrectionPlan(draft, rejected, [{
      code: "FACT_SOURCE_BRANCH_MISSING",
      severity: "error" as const,
      path: "$",
      message: "U1 is missing backend-enumerated branch exception:2.",
    }]);

    expect(plan.add_edge_element_refs).toEqual(["U1"]);
    expect(plan.element_update_fields).toEqual({});
  });

  it("maps an unsupported local-view effect to the referenced edge effect only", () => {
    const draft = factBundle();
    const rejected = {
      schema_version: 2 as const,
      screen_updates: [],
      element_updates: [],
      api_updates: [],
      predicates: [
        { key: "frontend-page", values: ["1", "2"], source: "code" as const, evidence_element_refs: ["U1"] },
        { key: "frontend-dbcache", values: ["1", "2"], source: "code" as const, evidence_element_refs: ["U1"] },
      ],
      edges: [{
        kind: "normal" as const,
        from_screen_ref: "S1",
        on_element_ref: "U1",
        to_screen_ref: "S1",
        effect: { all: [
          { predicate_key: "frontend-page", value: "2" },
          { predicate_key: "frontend-dbcache", value: "2" },
        ] },
      }],
    };

    const plan = createFactCorrectionPlan(draft, rejected, [{
      code: "FACT_LOCAL_VIEW_EFFECT_UNSUPPORTED",
      severity: "error" as const,
      path: "$",
      message: "U1 only changes page, but FACT claims PRED-frontend-page=2 && PRED-frontend-dbcache=2.",
    }]);

    expect(plan.replace_edge_indexes).toEqual([0]);
    expect(plan.edge_update_fields).toEqual({ 0: ["effect"] });
    expect(plan.element_update_fields).toEqual({});

    const corrected = applyFactCorrectionPatch(rejected, plan, {
      schema_version: 1,
      base_patch_hash: plan.base_patch_hash,
      element_update_upserts: [],
      predicate_upserts: [],
      edge_changes: [{
        operation: "replace",
        edge_index: 0,
        edge: {
          kind: "normal",
          from_screen_ref: "S1",
          on_element_ref: "U1",
          to_screen_ref: "S1",
        },
      }],
    });
    expect(corrected.edges[0]).not.toHaveProperty("effect");
  });

  it("keeps FACT predicate-semantic corrections out of element annotation fields", () => {
    const draft = factBundle();
    const rejected = {
      schema_version: 2 as const,
      screen_updates: [],
      element_updates: [],
      api_updates: [],
      predicates: [{ key: "cart.ready", values: ["true"], source: "code" as const, evidence_element_refs: ["U1"] }],
      edges: [],
    };

    const predicatePlan = createFactCorrectionPlan(draft, rejected, [{
      code: "FACT_CATALOG_PREDICATE_SEMANTICS",
      severity: "error" as const,
      path: "$",
      message: "U1 predicate semantics are incomplete.",
    }]);

    expect(predicatePlan.predicate_element_refs).toEqual(["U1"]);
    expect(predicatePlan.element_update_fields).toEqual({});

    const elementPlan = createFactCorrectionPlan(draft, rejected, [{
      code: "FACT_CATALOG_ELEMENT_SEMANTICS",
      severity: "error" as const,
      path: "$",
      message: "U1 element semantics are incomplete.",
    }]);

    expect(elementPlan.element_update_fields).toEqual({ U1: ["action_kind", "label"] });
  });

  it("removes only a backend-targeted unsupported edge branch", () => {
    const draft = factBundle();
    const normal = { kind: "normal" as const, from_screen_ref: "S1", on_element_ref: "U1", to_screen_ref: "S2" };
    const unsupported = { kind: "exception" as const, from_screen_ref: "S1", on_element_ref: "U1", to_screen_ref: "S1" };
    const rejected = { schema_version: 2 as const, screen_updates: [], element_updates: [], api_updates: [], predicates: [], edges: [normal, unsupported] };
    const plan = createFactCorrectionPlan(draft, rejected, [{
      code: "FACT_SOURCE_BRANCH_UNSUPPORTED",
      severity: "error" as const,
      path: "edges.0",
      message: "E-0001 is not present in the backend branch inventory.",
    }]);

    const corrected = applyFactCorrectionPatch(rejected, plan, {
      schema_version: 1,
      base_patch_hash: plan.base_patch_hash,
      element_update_upserts: [],
      predicate_upserts: [],
      edge_changes: [{ operation: "remove", edge_index: 0 }],
    });

    expect(corrected.edges).toEqual([normal]);
  });

  it("limits source-state predicate correction to edges triggered by the affected element", () => {
    const draft = factBundle();
    const rejected = {
      schema_version: 2 as const,
      screen_updates: [],
      element_updates: [],
      api_updates: [],
      predicates: [],
      edges: [
        { kind: "normal" as const, from_screen_ref: "S1", on_element_ref: "U1", to_screen_ref: "S2" },
        { kind: "normal" as const, from_screen_ref: "S2", on_element_ref: "U2", to_screen_ref: "S2" },
      ],
    };

    const plan = createFactCorrectionPlan(draft, rejected, [{
      code: "FACT_SOURCE_STATE_PREDICATE_MISSING",
      severity: "error" as const,
      path: "$.predicates[element=EL-checkout-button-submit]",
      message: "The source-backed view state has no evidence-linked predicate.",
    }]);

    expect(plan).toMatchObject({
      predicate_element_refs: ["U1"],
      replace_edge_indexes: [0],
      add_edge_element_refs: [],
    });
  });

  it("identifies the exact edge field that references an unknown FACT predicate", () => {
    const draft = factBundle();
    const rejected = {
      schema_version: 2 as const,
      screen_updates: [],
      element_updates: [],
      api_updates: [],
      predicates: [{ key: "cart.ready", values: ["true"], source: "code" as const, evidence_element_refs: ["U1"] }],
      edges: [{
        kind: "normal" as const,
        from_screen_ref: "S1",
        on_element_ref: "U1",
        to_screen_ref: "S2",
        effect: { predicate_key: "cart.completed", value: "true" },
      }],
    };

    const issues = validateFactEnrichmentPatchReferences(draft, rejected);
    expect(issues).toEqual([{
      code: "FACT_PATCH_REFERENCE_INVALID",
      severity: "error",
      path: "edges.0.effect",
      message: "Edge 0 effect references unknown predicate key cart.completed.",
    }]);
    const plan = createFactCorrectionPlan(draft, rejected, issues);
    expect(plan.edge_update_fields).toEqual({ 0: ["effect"] });
    expect(() => applyFactCorrectionPatch(rejected, plan, {
      schema_version: 1,
      base_patch_hash: plan.base_patch_hash,
      element_update_upserts: [],
      predicate_upserts: [],
      edge_changes: [{
        operation: "replace",
        edge_index: 0,
        edge: {
          ...rejected.edges[0],
          guard: { predicate_key: "cart.ready", value: "true" },
          effect: { predicate_key: "cart.ready", value: "true" },
        },
      }],
    })).toThrow("FACT_CORRECTION_EDGE_FIELD_OUT_OF_SCOPE:0:guard");

    const guardPlan = createFactCorrectionPlan(draft, rejected, [{
      code: "FACT_PATCH_REFERENCE_INVALID",
      severity: "error" as const,
      path: "edges.0.guard",
      message: "The guard is invalid.",
    }]);
    const guardOnly = applyFactCorrectionPatch(rejected, guardPlan, {
      schema_version: 1,
      base_patch_hash: guardPlan.base_patch_hash,
      element_update_upserts: [],
      predicate_upserts: [],
      edge_changes: [{
        operation: "replace",
        edge_index: 0,
        edge: {
          kind: "normal",
          from_screen_ref: "S1",
          on_element_ref: "U1",
          to_screen_ref: "S2",
          guard: { predicate_key: "cart.ready", value: "true" },
        },
      }],
    });
    expect(guardOnly.edges[0]).toEqual({
      ...rejected.edges[0],
      guard: { predicate_key: "cart.ready", value: "true" },
    });
  });

  it("normalizes an exact key alias in a FACT correction edge predicate clause", () => {
    const draft = factBundle();
    const rejected = {
      schema_version: 2 as const,
      screen_updates: [],
      element_updates: [],
      api_updates: [],
      predicates: [{ key: "cart.ready", values: ["true"], source: "code" as const, evidence_element_refs: ["U1"] }],
      edges: [{
        kind: "normal" as const,
        from_screen_ref: "S1",
        on_element_ref: "U1",
        to_screen_ref: "S2",
        effect: { predicate_key: "missing", value: "true" },
      }],
    };
    const plan = createFactCorrectionPlan(draft, rejected, [{
      code: "FACT_PATCH_REFERENCE_INVALID",
      severity: "error" as const,
      path: "edges.0.effect",
      message: "The effect is invalid.",
    }]);
    const correction = {
      schema_version: 1,
      base_patch_hash: plan.base_patch_hash,
      element_update_upserts: [],
      predicate_upserts: [],
      edge_changes: [{
        operation: "replace",
        edge_index: 0,
        edge: {
          ...rejected.edges[0],
          effect: { all: [{ key: "cart.ready", value: "true" }] },
        },
      }],
    } as unknown as Parameters<typeof applyFactCorrectionPatch>[2];

    const corrected = applyFactCorrectionPatch(rejected, plan, correction);

    expect(corrected.edges[0]?.effect).toEqual({ all: [{ predicate_key: "cart.ready", value: "true" }] });
  });

  it("authorizes removal and edge repair for colliding FACT predicate IDs", () => {
    const draft = factBundle();
    const rejected = {
      schema_version: 2 as const,
      screen_updates: [],
      element_updates: [],
      api_updates: [],
      predicates: [
        { key: "cart.ready", values: ["true"], source: "code" as const, evidence_element_refs: ["U1"] },
        { key: "cart-ready", values: ["true"], source: "code" as const, evidence_element_refs: ["U1"] },
      ],
      edges: [{
        kind: "normal" as const,
        from_screen_ref: "S1",
        on_element_ref: "U1",
        to_screen_ref: "S2",
        effect: { predicate_key: "cart-ready", value: "true" },
      }],
    };
    const issues = validateFactEnrichmentPatchReferences(draft, rejected);

    expect(issues).toEqual([{
      code: "FACT_PATCH_PREDICATE_ID_COLLISION",
      severity: "error",
      path: "predicates.1.key",
      message: "Predicate key cart-ready collides with cart.ready after canonical ID compilation.",
    }]);
    const plan = createFactCorrectionPlan(draft, rejected, issues);
    expect(plan).toMatchObject({
      predicate_element_refs: ["U1"],
      remove_predicate_keys: ["cart-ready"],
      replace_edge_indexes: [0],
      edge_update_fields: { 0: ["effect"] },
    });
    const corrected = applyFactCorrectionPatch(rejected, plan, {
      schema_version: 1,
      base_patch_hash: plan.base_patch_hash,
      element_update_upserts: [],
      predicate_upserts: [],
      predicate_removals: ["cart-ready"],
      edge_changes: [{
        operation: "replace",
        edge_index: 0,
        edge: {
          kind: "normal",
          from_screen_ref: "S1",
          on_element_ref: "U1",
          to_screen_ref: "S2",
          effect: { predicate_key: "cart.ready", value: "true" },
        },
      }],
    });
    expect(corrected.predicates.map(({ key }) => key)).toEqual(["cart.ready"]);
    expect(corrected.edges[0].effect).toEqual({ predicate_key: "cart.ready", value: "true" });
  });

  it("appends only targeted missing FACT transitions without renumbering validated edges", () => {
    const base = factBundle();
    base.screens[0].elements.push({
      id: "EL-checkout-input-filter",
      type: "input",
      label: "Filter",
      interaction: { action_kind: "unresolved", surface_kind: "web", target_candidates: [] },
      evidence: [evidence],
    });
    const candidate = structuredClone(base);
    candidate.screens[0].elements[1].interaction.action_kind = "filter_results";
    candidate.predicates.push({ schema_version: 2, ...identity, pred_id: "PRED-filter", values: ["applied", "cleared"], source: "code", evidence: [evidence] });
    candidate.edges = [
      { schema_version: 2, ...identity, edge_id: "E-0001", kind: "normal", from: "SCR-checkout", on: "EL-checkout-input-filter", effect: "PRED-filter=applied", to: "SCR-checkout", feedback: [], evidence: [evidence], status: "draft" },
      { ...base.edges[0], edge_id: "E-0002" },
    ];

    const merged = mergeFactTransitionCorrection(base, candidate, ["EL-checkout-input-filter"]);

    expect(merged.edges[0]).toEqual(base.edges[0]);
    expect(merged.edges[1]).toMatchObject({ edge_id: "E-0002", on: "EL-checkout-input-filter", from: "SCR-checkout", to: "SCR-checkout" });
    expect(merged.screens[0].elements[0]).toEqual(base.screens[0].elements[0]);
    expect(merged.screens[0].elements[1].interaction.action_kind).toBe("filter_results");
    expect(merged.predicates).toContainEqual(expect.objectContaining({ pred_id: "PRED-filter", values: ["applied", "cleared"] }));
  });

  it("reconstructs a correction draft without carrying prior transition semantics", () => {
    const base = factBundle();
    const draft = createFactTransitionCorrectionDraft(base);

    expect(draft.edges).toEqual([]);
    expect(draft.predicates).toEqual([]);
    expect(draft.screens[0].elements[0].interaction.action_kind).toBe("unresolved");
    expect(base.edges).toHaveLength(1);
    expect(base.screens[0].elements[0].interaction.action_kind).toBe("click");
  });

  it("promotes workflow variation requirements into deterministic scenario preconditions", () => {
    const facts = factBundle();
    facts.edges[0].guard = undefined;
    facts.predicates = [{
      schema_version: 2,
      ...identity,
      pred_id: "PRED-selected-flow",
      values: ["selected", "missing"],
      source: "code",
      evidence: [evidence],
    }];
    const wiki = wikiBundle();
    wiki.workflows[0].variation_axes = ["PRED-selected-flow"];
    wiki.workflows[0].combination.axis_defaults = { "PRED-selected-flow": "selected" };
    wiki.workflows[0].cites = ["SCR-checkout", "E-0001", "PRED-selected-flow"];

    const scenarios = compileScenarioSet(facts, wiki);

    expect(scenarios.scenarios[0].preconditions).toEqual([{
      text: "PRED-selected-flow=selected",
      predicate_refs: ["PRED-selected-flow"],
      data_binding_keys: [],
    }]);
  });

  it("rejects WIKI terminals that are unreachable in the FACT graph", () => {
    const facts = factBundle();
    facts.edges = [];
    const wiki = wikiBundle();

    expect(validateWikiBundle(wiki, facts).issues.map((entry) => entry.code)).toContain("WORKFLOW_TERMINAL_UNREACHABLE");
  });

  it("keeps a workflow walk inside the FACT edges explicitly cited by that workflow", () => {
    const facts = factBundle();
    facts.screens.push({
      schema_version: 3,
      ...identity,
      screen_id: "SCR-abandoned",
      route: "/abandoned",
      title: "Abandoned",
      entry_guards: [],
      elements: [],
      apis: [],
      feedback: [],
      displays: [],
      status: "verified",
    });
    facts.edges.push({
      schema_version: 2,
      ...identity,
      edge_id: "E-0002",
      kind: "exception",
      from: "SCR-checkout",
      on: "EL-checkout-button-submit",
      to: "SCR-abandoned",
      feedback: [],
      evidence: [evidence],
      status: "verified",
    });
    const wiki = wikiBundle();

    const scenarios = compileScenarioSet(facts, wiki);

    expect(scenarios.scenarios.map((scenario) => scenario.path)).toEqual([["E-0001"]]);
  });

  it("rejects WIKI sets that leave verified FACT transitions outside every workflow", () => {
    const facts = factBundle();
    facts.edges.push({
      schema_version: 2,
      ...identity,
      edge_id: "E-0002",
      kind: "normal",
      from: "SCR-complete",
      on: "EL-checkout-button-submit",
      to: "SCR-checkout",
      feedback: [],
      evidence: [evidence],
      status: "verified",
    });
    const wiki = wikiBundle();

    expect(validateWikiBundle(wiki, facts).issues.map((entry) => entry.code)).toContain("WIKI_EDGE_COVERAGE_INCOMPLETE");
  });

  it("compiles identity-bound reachable workflow skeletons from verified FACT actions", () => {
    const facts = factBundle();
    facts.edges.push({
      ...facts.edges[0],
      edge_id: "E-0002",
      kind: "exception",
      effect: "PRED-order.failed=true",
      to: "SCR-checkout",
      feedback: [],
    });
    facts.predicates.push({
      schema_version: 2,
      ...identity,
      pred_id: "PRED-order.failed",
      values: ["true", "false"],
      source: "code",
      evidence: [evidence],
    });

    const wiki = compileReachableWorkflowSkeleton(facts);

    expect(wiki).toEqual(compileReachableWorkflowSkeleton(facts));
    expect(wiki).toMatchObject({ schema_version: 2, ...identity });
    expect(wiki.workflows).toHaveLength(1);
    expect(wiki.workflows[0]).toMatchObject({
      schema_version: 2,
      ...identity,
      workflow: expect.stringMatching(/^WF-/),
      entry_screens: ["SCR-checkout"],
      success_terminal: "at(SCR-complete)",
      failure_terminals: ["PRED-order.failed=true"],
      cites: ["SCR-checkout", "SCR-complete", "EL-checkout-button-submit", "PRED-cart.ready", "PRED-order.failed", "E-0001", "E-0002"],
    });
    expect(validateWikiBundle(wiki, facts)).toMatchObject({ valid: true, issues: [] });
  });

  it("compiles a backend-owned guarded path inventory with feasibility kept outside source-supported coverage", () => {
    const facts = factBundle();
    facts.edges.push({
      ...facts.edges[0],
      edge_id: "E-0002",
      kind: "exception",
      effect: "PRED-order.failed=true",
      to: "SCR-checkout",
      feedback: [],
    });
    facts.predicates.push({
      schema_version: 2,
      ...identity,
      pred_id: "PRED-order.failed",
      values: ["true", "false"],
      source: "code",
      evidence: [evidence],
    });

    const inventory = compileGuardedPathInventory(facts, [
      { source_action_ref: "EL-checkout-button-submit", branch_ref: "normal:1", scope: "journey", outcome: "normal", feasibility: "source-supported" },
      { source_action_ref: "EL-checkout-button-submit", branch_ref: "exception:1", scope: "journey", outcome: "exception", feasibility: "runtime-unverified" },
      { source_action_ref: "EL-missing", branch_ref: "normal:1", scope: "journey", outcome: "normal", feasibility: "source-supported" },
    ]);

    expect(inventory).toEqual(compileGuardedPathInventory(facts, [
      { source_action_ref: "EL-checkout-button-submit", branch_ref: "normal:1", scope: "journey", outcome: "normal", feasibility: "source-supported" },
      { source_action_ref: "EL-checkout-button-submit", branch_ref: "exception:1", scope: "journey", outcome: "exception", feasibility: "runtime-unverified" },
      { source_action_ref: "EL-missing", branch_ref: "normal:1", scope: "journey", outcome: "normal", feasibility: "source-supported" },
    ]));
    expect(inventory.edges).toEqual([
      expect.objectContaining({
        edge_ref: "E-0001",
        branch_ref: "normal:1",
        guard: "PRED-cart.ready=true",
        feasibility: "source-supported",
      }),
      expect.objectContaining({
        edge_ref: "E-0002",
        branch_ref: "exception:1",
        effect: "PRED-order.failed=true",
        feasibility: "runtime-unverified",
      }),
    ]);
    expect(inventory.paths).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "normal", edge_refs: ["E-0001"], feasibility: "source-supported" }),
      expect.objectContaining({ kind: "exception", edge_refs: expect.arrayContaining(["E-0002"]), feasibility: "runtime-unverified" }),
    ]));
    expect(inventory.coverage).toMatchObject({
      total_obligations: 3,
      linked_obligations: 2,
      by_scope: {
        journey: { total: 3, linked: 2, unresolved: 1 },
        view: { total: 0, linked: 0, unresolved: 0 },
      },
      source_supported: { total: 2, linked: 1 },
      runtime_unverified: { total: 1, linked: 1 },
    });
    expect(inventory.unresolved_obligations).toEqual([
      expect.objectContaining({ source_action_ref: "EL-missing", branch_ref: "normal:1" }),
    ]);
  });

  it("numbers normal goal-reaching scenarios before preserved exception alternatives", () => {
    const facts = factBundle();
    const normal = { ...facts.edges[0]!, edge_id: "E-0002" };
    const exception = {
      ...facts.edges[0]!,
      edge_id: "E-0001",
      kind: "exception" as const,
      effect: "PRED-order.failed=true",
    };
    facts.edges = [exception, normal];
    facts.predicates.push({ schema_version: 2, ...identity, pred_id: "PRED-order.failed", values: ["true", "false"], source: "code", evidence: [evidence] });
    const wiki = wikiBundle();
    wiki.workflows[0]!.cites.push("E-0002", "PRED-order.failed");

    const scenarios = compileScenarioSet(facts, wiki).scenarios;

    expect(scenarios.map((scenario) => scenario.kind)).toEqual(["normal", "exception"]);
    expect(scenarios.map((scenario) => scenario.path)).toEqual([["E-0002"], ["E-0001"]]);
  });

  it("applies only human-readable goals to a backend-owned workflow skeleton", () => {
    const skeleton = compileReachableWorkflowSkeleton(factBundle());
    const patched = applyWikiSemanticPatch(skeleton, {
      schema_version: 1,
      workflow_updates: [{ workflow_ref: skeleton.workflows[0].workflow, goal: "주문 제출 및 완료 확인" }],
    });

    expect(patched.workflows[0]).toEqual({
      ...skeleton.workflows[0],
      goal: "주문 제출 및 완료 확인",
    });
    expect(() => applyWikiSemanticPatch(skeleton, {
      schema_version: 1,
      workflow_updates: [{ workflow_ref: "WF-model-invented", goal: "잘못된 업무" }],
    })).toThrow("WIKI_SEMANTIC_PATCH_REFERENCE_INVALID:WF-model-invented");
    expect(() => applyWikiSemanticPatch(skeleton, { schema_version: 1, workflow_updates: [] })).toThrow("WIKI_SEMANTIC_PATCH_INCOMPLETE");
  });

  it("merges only reviewer-targeted WIKI goals and rejects a stale base", () => {
    const wiki = wikiBundle();
    wiki.workflows.push({ ...structuredClone(wiki.workflows[0]), workflow: "WF-ORDER-REFUND", goal: "Refund order" });
    const untouched = JSON.stringify(wiki.workflows[1]);
    const scope = createWikiGoalCorrectionScope(wiki, ["WIKI_GOAL_TOO_GENERIC:WF-ORDER-PLACE"]);
    const corrected = applyWikiGoalCorrectionPatch(wiki, scope, {
      schema_version: 1,
      base_artifact_hash: scope.base_artifact_hash,
      workflow_updates: [{ workflow_ref: "WF-ORDER-PLACE", goal: "Submit and confirm an order" }],
    });

    expect(corrected.workflows[0].goal).toBe("Submit and confirm an order");
    expect(JSON.stringify(corrected.workflows[1])).toBe(untouched);
    expect(() => applyWikiGoalCorrectionPatch(wiki, scope, {
      schema_version: 1,
      base_artifact_hash: "sha256:stale",
      workflow_updates: [{ workflow_ref: "WF-ORDER-PLACE", goal: "Submit and confirm an order" }],
    })).toThrow("WIKI_CORRECTION_PATCH_BASE_MISMATCH");
  });

  it("prefixes business scenarios with their backend-derived reachable workflow dependencies", () => {
    const facts = factBundle();
    facts.screens[1].elements.push({
      id: "EL-complete-button-download",
      type: "button",
      label: "Download receipt",
      interaction: { action_kind: "download", surface_kind: "web", target_candidates: [{ by: "test-id", value: "download-receipt" }] },
      evidence: [evidence],
    });
    facts.screens.push({
      schema_version: 3,
      ...identity,
      screen_id: "SCR-receipt",
      route: "/receipt",
      title: "Receipt",
      entry_guards: [],
      elements: [],
      apis: [],
      feedback: [],
      displays: [],
      status: "verified",
    });
    facts.edges.push({
      schema_version: 2,
      ...identity,
      edge_id: "E-0002",
      kind: "normal",
      from: "SCR-complete",
      on: "EL-complete-button-download",
      to: "SCR-receipt",
      feedback: [],
      evidence: [evidence],
      status: "verified",
    });
    const wiki = compileReachableWorkflowSkeleton(facts);
    const downloadWorkflow = wiki.workflows.find((workflow) => workflow.cites.includes("E-0002"))!;

    expect(downloadWorkflow.depends_on).toHaveLength(1);
    const scenarios = compileScenarioSet(facts, wiki);
    const downloadScenario = scenarios.scenarios.find((scenario) => scenario.workflow === downloadWorkflow.workflow)!;

    expect(downloadScenario.path).toEqual(["E-0001", "E-0002"]);
    expect(downloadScenario.steps.map((step) => step.action_ref.edge)).toEqual(["E-0001", "E-0002"]);
    expect(calculateCoverage(facts, scenarios)).toMatchObject({ coverage_percent: 100, uncovered_edge_ids: [] });
  });

  it("derives protected download prerequisites from a source-backed login API even when the action kind is generic", () => {
    const facts = factBundle();
    facts.screens = [
      {
        schema_version: 3,
        ...identity,
        screen_id: "SCR-login",
        route: "/login",
        title: "Login",
        entry_guards: [],
        elements: [{
          id: "EL-login-submit",
          type: "button",
          label: "Login",
          interaction: { action_kind: "submit", surface_kind: "web", target_candidates: [{ by: "test-id", value: "login-submit" }] },
          evidence: [evidence],
        }],
        apis: [{ id: "API-POST-api-auth-login", reads: [], writes: ["POST /api/auth/login"], evidence: [evidence] }],
        feedback: [],
        displays: [],
        status: "verified",
      },
      {
        schema_version: 3,
        ...identity,
        screen_id: "SCR-home",
        route: "/home",
        title: "Home",
        entry_guards: [],
        elements: [
          { id: "EL-home-open-results", type: "button", label: "Results", interaction: { action_kind: "navigate", surface_kind: "web", target_candidates: [{ by: "test-id", value: "open-results" }] }, evidence: [evidence] },
          { id: "EL-home-logout", type: "button", label: "Logout", interaction: { action_kind: "logout", surface_kind: "web", target_candidates: [{ by: "test-id", value: "logout" }] }, evidence: [evidence] },
        ],
        apis: [],
        feedback: [],
        displays: [],
        status: "verified",
      },
      {
        schema_version: 3,
        ...identity,
        screen_id: "SCR-results",
        route: "/results",
        title: "Results",
        entry_guards: [],
        elements: [{ id: "EL-results-download", type: "button", label: "Download CSV", interaction: { action_kind: "download", surface_kind: "web", target_candidates: [{ by: "test-id", value: "download-csv" }] }, evidence: [evidence] }],
        apis: [],
        feedback: [{ id: "FB-download-complete", kind: "status", text: "Download complete", assertion: { kind: "visible-text", expected_shape: "Download complete" }, evidence: [evidence] }],
        displays: [],
        status: "verified",
      },
    ];
    facts.edges = [
      { schema_version: 2, ...identity, edge_id: "E-LOGIN", kind: "normal", from: "SCR-login", on: "EL-login-submit", to: "SCR-home", feedback: [], evidence: [evidence], status: "verified" },
      { schema_version: 2, ...identity, edge_id: "E-OPEN", kind: "normal", from: "SCR-home", on: "EL-home-open-results", to: "SCR-results", feedback: [], evidence: [evidence], status: "verified" },
      { schema_version: 2, ...identity, edge_id: "E-LOGOUT", kind: "normal", from: "SCR-home", on: "EL-home-logout", to: "SCR-login", feedback: [], evidence: [evidence], status: "verified" },
      { schema_version: 2, ...identity, edge_id: "E-DOWNLOAD", kind: "normal", from: "SCR-results", on: "EL-results-download", to: "SCR-results", feedback: ["FB-download-complete"], evidence: [evidence], status: "verified" },
    ];
    facts.predicates = [];

    const wiki = compileReachableWorkflowSkeleton(facts);
    const downloadWorkflow = wiki.workflows.find((workflow) => workflow.cites.includes("E-DOWNLOAD"))!;
    const downloadScenario = compileScenarioSet(facts, wiki).scenarios.find((scenario) => scenario.workflow === downloadWorkflow.workflow)!;

    expect(downloadScenario.path).toEqual(["E-LOGIN", "E-OPEN", "E-DOWNLOAD"]);
  });

  it("rejects a scenario set that does not cover every verified FACT transition", () => {
    const facts = factBundle();
    const wiki = wikiBundle();
    const scenarios = compileScenarioSet(facts, wiki);
    scenarios.scenarios = [];

    expect(validateScenarioSet(scenarios, facts, wiki).issues.map((entry) => entry.code)).toContain("SCENARIO_EDGE_COVERAGE_INCOMPLETE");
  });

  it("forbids canonical coordinate targets", () => {
    const facts = factBundle();
    facts.screens[0].elements[0].interaction.target_candidates = [{ by: "coordinate", value: "10,20" }];
    expect(validateFactBundle(facts).issues.map((entry) => entry.code)).toContain("CANONICAL_COORDINATE_FORBIDDEN");
  });

  it("rejects author changes to deterministic scenario references", () => {
    const facts = factBundle();
    const wiki = wikiBundle();
    const draft = compileScenarioSet(facts, wiki);
    const changed = structuredClone(draft);
    changed.scenarios[0].steps[0].assertion_refs = ["SCR-checkout"];
    expect(validateScenarioSet(changed, facts, wiki, draft).issues.map((entry) => entry.code)).toContain("SCENARIO_DETERMINISTIC_FIELDS_CHANGED");
  });

  it("allows human-readable precondition narration while preserving predicate references", () => {
    const facts = factBundle();
    const wiki = wikiBundle();
    const draft = compileScenarioSet(facts, wiki);
    const narrated = structuredClone(draft);
    narrated.scenarios[0].preconditions[0].text = "The cart is ready for checkout.";

    expect(validateScenarioSet(narrated, facts, wiki, draft).valid).toBe(true);

    narrated.scenarios[0].preconditions[0].predicate_refs = [];
    expect(validateScenarioSet(narrated, facts, wiki, draft).issues.map((entry) => entry.code)).toContain("SCENARIO_DETERMINISTIC_FIELDS_CHANGED");
  });

  it("persists FACT catalog and edge ledger as independently inspectable inputs", () => {
    const facts = factBundle();
    const catalog = createFactCatalog(facts);
    const ledger = createEdgeLedger(facts);

    expect(catalog).not.toHaveProperty("edges");
    expect(ledger).not.toHaveProperty("screens");
    expect(ledger.audit).toEqual([
      expect.objectContaining({ edge_id: "E-0001", journey_action_ref: "SCR-checkout:EL-checkout-button-submit", normal_outcome: true, evidence_status: "present" }),
    ]);
    expect(assembleFactBundle(catalog, ledger)).toEqual(facts);
  });

  it("fails FACT assembly when an edge cites a catalog object that does not exist", () => {
    const facts = factBundle();
    const catalog = createFactCatalog(facts);
    const ledger = createEdgeLedger(facts);
    ledger.edges[0].on = "EL-model-invented";

    expect(() => assembleFactBundle(catalog, ledger)).toThrow("EDGE_LEDGER_CATALOG_REFERENCE_INVALID:E-0001");
  });

  it("classifies every verified workflow before compiling scenario skeletons", () => {
    const facts = factBundle();
    const wiki = wikiBundle();
    const business = compileBusinessCatalog(wiki, {
      schema_version: 1,
      classifications: [{ label: "주문 처리", workflow_refs: ["WF-ORDER-PLACE"] }],
    });
    const skeleton = compileScenarioSkeleton(facts, wiki, business);

    expect(business.classifications[0]).toMatchObject({ classification_id: expect.stringMatching(/^BC-/), label: "주문 처리", edge_refs: ["E-0001"] });
    expect(skeleton.classification_by_scenario[skeleton.scenarios[0].scenario_id]).toBe(business.classifications[0].classification_id);
  });

  it("preserves a classification identity when an incremental catalog only adds workflows", () => {
    const initialWiki = wikiBundle();
    const initial = compileBusinessCatalog(initialWiki, {
      schema_version: 1,
      classifications: [{ label: "주문 처리", workflow_refs: ["WF-ORDER-PLACE"] }],
    });
    const extendedWiki = structuredClone(initialWiki);
    extendedWiki.workflows.push({
      ...structuredClone(initialWiki.workflows[0]),
      workflow: "WF-ORDER-REFUND",
      goal: "주문 환불",
      cites: ["SCR-checkout", "EL-checkout-button-submit", "E-0002"],
    });

    const extended = compileBusinessCatalog(extendedWiki, {
      schema_version: 1,
      classifications: [{ label: "주문 처리", workflow_refs: ["WF-ORDER-PLACE", "WF-ORDER-REFUND"] }],
    }, initial);

    expect(extended.classifications[0].classification_id).toBe(initial.classifications[0].classification_id);
    expect(extended.classifications[0].workflow_refs).toEqual(["WF-ORDER-PLACE", "WF-ORDER-REFUND"]);
  });

  it("moves only reviewer-targeted workflows between business classifications", () => {
    const wiki = wikiBundle();
    wiki.workflows.push({ ...structuredClone(wiki.workflows[0]), workflow: "WF-ORDER-REFUND", goal: "Refund order" });
    const business = compileBusinessCatalog(wiki, {
      schema_version: 1,
      classifications: [
        { label: "주문 처리", workflow_refs: ["WF-ORDER-PLACE"] },
        { label: "환불 처리", workflow_refs: ["WF-ORDER-REFUND"] },
      ],
    });
    const placeBefore = business.classifications.find((entry) => entry.workflow_refs.includes("WF-ORDER-PLACE"))!;
    const scope = createBusinessClassificationCorrectionScope(business, ["BUSINESS_CATALOG_LABEL_INCOHERENT:WF-ORDER-REFUND"]);
    const corrected = applyBusinessClassificationCorrectionPatch(wiki, business, scope, {
      schema_version: 1,
      base_artifact_hash: scope.base_artifact_hash,
      workflow_updates: [{ workflow_ref: "WF-ORDER-REFUND", label: "주문 처리" }],
    });

    expect(corrected.classifications).toHaveLength(1);
    expect(corrected.classifications[0]).toMatchObject({
      classification_id: placeBefore.classification_id,
      label: "주문 처리",
      workflow_refs: ["WF-ORDER-PLACE", "WF-ORDER-REFUND"],
    });
  });

  it("binds backend scenario skeletons to journey milestones without changing scenario identities or paths", () => {
    const facts = factBundle();
    const wiki = wikiBundle();
    const business = compileBusinessCatalog(wiki, {
      schema_version: 1,
      classifications: [{ label: "주문 처리", workflow_refs: ["WF-ORDER-PLACE"] }],
    });
    const skeleton = compileScenarioSkeleton(facts, wiki, business);
    const inventory = compileGuardedPathInventory(facts, [{
      source_action_ref: "EL-checkout-button-submit",
      branch_ref: "normal:1",
      scope: "journey",
      outcome: "normal",
      feasibility: "source-supported",
    }]);
    const bindings = compileJourneyScenarioBindings(skeleton, {
      schema_version: 1,
      project_id: identity.project_id,
      analysis_run_id: identity.analysis_run_id,
      source_snapshot_id: identity.source_snapshot_id,
      journeys: [{
        journey_ref: "J001",
        kind: "recovery",
        title: "Recover order placement",
        feasibility: "source-supported",
        milestones: [{
          target_ref: "JM001",
          position: 1,
          phase: "recovery",
          required_outcome: "normal",
          workflow_refs: ["WF-ORDER-PLACE"],
          edge_refs: ["E-0001"],
          feasibility: "source-supported",
        }],
      }],
    }, inventory);

    expect(bindings.scenarios).toEqual([expect.objectContaining({
      scenario_ref: skeleton.scenarios[0].scenario_id,
      workflow_ref: "WF-ORDER-PLACE",
      path: skeleton.scenarios[0].path,
      feasibility: "source-supported",
      roles: ["normal", "recovery"],
      journey_milestones: [{ journey_ref: "J001", milestone_position: 1, phase: "recovery" }],
    })]);
    expect(bindings.coverage).toEqual({ total_scenarios: 1, journey_bound_scenarios: 1, unbound_scenario_refs: [] });
  });

  it("fails business classification when a workflow is left unassigned", () => {
    expect(() => compileBusinessCatalog(wikiBundle(), { schema_version: 1, classifications: [{ label: "빈 분류", workflow_refs: ["WF-model-invented"] }] })).toThrow("BUSINESS_CLASSIFICATION_WORKFLOW_INVALID:WF-model-invented");
  });
});

describe("shell-contained journey completion", () => {
  const shellFacts = (contained: boolean): FactBundle => ({
    schema_version: 2, ...identity,
    screens: [
      { schema_version: 3, ...identity, screen_id: "SCR-shell", route: "component:Shell", title: "Shell", entry_guards: [], status: "verified",
        elements: [
          { id: "EL-shell-button-open", type: "button", label: "Open work", interaction: { action_kind: "open work stage", surface_kind: "web", target_candidates: [{ by: "test-id", value: "open-work" }] }, evidence: [evidence] },
          { id: "EL-shell-button-logout", type: "button", label: "Log out", interaction: { action_kind: "log out", surface_kind: "web", target_candidates: [{ by: "test-id", value: "logout" }] }, evidence: [evidence] },
        ],
        apis: [], feedback: [], displays: [] },
      { schema_version: 3, ...identity, screen_id: "SCR-work", route: "component:WorkPage", title: "Work", entry_guards: [], status: "verified",
        ...(contained ? { shell_screen_id: "SCR-shell" } : {}),
        elements: [{ id: "EL-work-button-export", type: "button", label: "Export CSV", interaction: { action_kind: "download csv", surface_kind: "web", target_candidates: [{ by: "test-id", value: "export" }] }, evidence: [evidence] }],
        apis: [], feedback: [], displays: [] },
      { schema_version: 3, ...identity, screen_id: "SCR-exit", route: "component:LoginFormPage", title: "Exit", entry_guards: [], status: "verified", elements: [], apis: [], feedback: [], displays: [] },
    ],
    edges: [
      { schema_version: 2, ...identity, edge_id: "E-0001", kind: "normal", from: "SCR-shell", on: "EL-shell-button-open", to: "SCR-work", feedback: [], evidence: [evidence], status: "verified" },
      { schema_version: 2, ...identity, edge_id: "E-0002", kind: "normal", from: "SCR-work", on: "EL-work-button-export", effect: "PRED-export.done=true", to: "SCR-work", feedback: [], evidence: [evidence], status: "verified" },
      { schema_version: 2, ...identity, edge_id: "E-0003", kind: "normal", from: "SCR-shell", on: "EL-shell-button-logout", effect: "PRED-session.active=false", to: "SCR-exit", feedback: [], evidence: [evidence], status: "verified" },
    ],
    predicates: [
      { schema_version: 2, ...identity, pred_id: "PRED-export.done", values: ["true", "false"], source: "code", evidence: [evidence] },
      { schema_version: 2, ...identity, pred_id: "PRED-session.active", values: ["true", "false"], source: "code", evidence: [evidence] },
    ],
  });

  const journeyLinks = {
    schema_version: 1 as const, ...identity,
    journeys: [{
      journey_ref: "J001", kind: "normal" as const, title: "Work to export and exit", feasibility: "source-supported" as const,
      milestones: [
        { target_ref: "JM001", position: 1, phase: "entry", required_outcome: "normal" as const, workflow_refs: ["WF-shell"], edge_refs: ["E-0001"], feasibility: "source-supported" as const },
        { target_ref: "JM002", position: 2, phase: "business-result", required_outcome: "normal" as const, workflow_refs: ["WF-work"], edge_refs: ["E-0002"], feasibility: "source-supported" as const },
        { target_ref: "JM003", position: 3, phase: "exit", required_outcome: "normal" as const, workflow_refs: ["WF-shell-logout"], edge_refs: ["E-0003"], feasibility: "source-supported" as const },
      ],
    }],
  };

  it("prefers the title attribute when a control's own text is a non-semantic glyph", async () => {
    const root = await mkdtemp(join(tmpdir(), "scenarioforge-glyph-"));
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "src", "Bar.jsx"),
      "export default function BarPage(){return <div>"
      + "<button title=\"홈으로\" onClick={()=>fetch('/api/home')}>=</button>"
      + "<button title=\"로그아웃\" onClick={()=>fetch('/api/logout')}>⏏ 로그아웃</button>"
      + "</div>;}\n", "utf8");

    const snapshot = await new SourceScanner().scan({ projectRoot: root, projectId: "PRJ-shop", analysisRunId: "RUN-1", sourceSnapshotId: "SNAP-1", now: "2026-08-26T00:00:00.000Z" });

    expect(snapshot.interactions.map((interaction) => interaction.label)).toEqual(["홈으로", "⏏ 로그아웃"]);
  });

  it("derives shell containment from JSX nesting so shell chrome stays reachable from contained screens", async () => {
    const root = await mkdtemp(join(tmpdir(), "scenarioforge-shell-"));
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "src", "Main.jsx"),
      "function Shell({children}){return <div><button onClick={()=>fetch('/api/logout')}>Log out</button>{children}</div>;}\n"
      + "function WorkPage(){return <button onClick={()=>fetch('/api/export')}>Export CSV</button>;}\n"
      + "export default function MainPage(){return <Shell><WorkPage/></Shell>;}\n", "utf8");

    const snapshot = await new SourceScanner().scan({ projectRoot: root, projectId: "PRJ-shop", analysisRunId: "RUN-1", sourceSnapshotId: "SNAP-1", now: "2026-08-26T00:00:00.000Z" });

    expect(snapshot.shells).toEqual([expect.objectContaining({
      shell_screen_id: "SCR-component-mainpage",
      contained_screen_ids: ["SCR-component-workpage"],
    })]);
  });

  it("never walks a regression edge, so the journey path terminates without back-and-forth", () => {
    const facts = shellFacts(true);
    facts.screens[1].elements.push({
      id: "EL-work-button-back", type: "button", label: "이전",
      interaction: { action_kind: "navigate back", surface_kind: "web", target_candidates: [{ by: "test-id", value: "back" }] },
      evidence: [evidence],
    });
    facts.edges.push({
      schema_version: 2, ...identity, edge_id: "E-0004", kind: "normal",
      from: "SCR-work", on: "EL-work-button-back", to: "SCR-shell", feedback: [], evidence: [evidence], status: "verified",
    });
    const withRegression = {
      ...journeyLinks,
      journeys: [{
        ...journeyLinks.journeys[0],
        milestones: [
          journeyLinks.journeys[0].milestones[0],
          { target_ref: "JM001b", position: 2, phase: "work", required_outcome: "normal" as const, workflow_refs: ["WF-back"], edge_refs: ["E-0004", "E-0001"], feasibility: "source-supported" as const },
          { ...journeyLinks.journeys[0].milestones[1], position: 3 },
          { ...journeyLinks.journeys[0].milestones[2], position: 4 },
        ],
      }],
    };

    const [journey] = compileJourneyCompleteScenarios(facts, withRegression);

    expect(journey.path).toEqual(["E-0001", "E-0002", "E-0003"]);
  });

  it("skips a milestone transition the journey has already completed", () => {
    const replayed = {
      ...journeyLinks,
      journeys: [{
        ...journeyLinks.journeys[0],
        milestones: [
          journeyLinks.journeys[0].milestones[0],
          { ...journeyLinks.journeys[0].milestones[1], edge_refs: ["E-0002", "E-0001"] },
          journeyLinks.journeys[0].milestones[2],
        ],
      }],
    };

    const [journey] = compileJourneyCompleteScenarios(shellFacts(true), replayed);

    expect(journey.path).toEqual(["E-0001", "E-0002", "E-0003"]);
  });

  it("does not bind a scenario to a milestone the journey walk drops", () => {
    const facts = shellFacts(true);
    facts.screens.push({
      schema_version: 3, ...identity, screen_id: "SCR-settings", route: "component:SettingsPage", title: "Settings",
      shell_screen_id: "SCR-shell", entry_guards: [], status: "verified", elements: [], apis: [], feedback: [], displays: [],
    });
    facts.screens[0].elements.push({
      id: "EL-shell-button-settings", type: "button", label: "Settings",
      interaction: { action_kind: "open settings", surface_kind: "web", target_candidates: [{ by: "test-id", value: "settings" }] },
      evidence: [evidence],
    });
    facts.edges.push({
      schema_version: 2, ...identity, edge_id: "E-0005", kind: "normal",
      from: "SCR-shell", on: "EL-shell-button-settings", to: "SCR-settings", feedback: [], evidence: [evidence], status: "verified",
    });
    const wiki = compileReachableWorkflowSkeleton(facts);
    const workflowCiting = (edgeRef: string) => wiki.workflows.find((workflow) => workflow.cites.includes(edgeRef))!.workflow;
    const linksWithDetour = {
      ...journeyLinks,
      journeys: [{
        ...journeyLinks.journeys[0],
        milestones: [
          { target_ref: "JM001", position: 1, phase: "entry", required_outcome: "normal" as const, workflow_refs: [workflowCiting("E-0001")], edge_refs: ["E-0001"], feasibility: "source-supported" as const },
          { target_ref: "JM002", position: 2, phase: "work", required_outcome: "normal" as const, workflow_refs: [workflowCiting("E-0005")], edge_refs: ["E-0005"], feasibility: "source-supported" as const },
          { target_ref: "JM003", position: 3, phase: "business-result", required_outcome: "normal" as const, workflow_refs: [workflowCiting("E-0002")], edge_refs: ["E-0002"], feasibility: "source-supported" as const },
          { target_ref: "JM004", position: 4, phase: "exit", required_outcome: "normal" as const, workflow_refs: [workflowCiting("E-0003")], edge_refs: ["E-0003"], feasibility: "source-supported" as const },
        ],
      }],
    };
    const catalog = compileBusinessCatalog(wiki, defaultBusinessClassificationPatch(wiki));
    const skeleton = compileScenarioSkeleton(facts, wiki, catalog);
    const inventory = compileGuardedPathInventory(facts, []);

    const bindings = compileJourneyScenarioBindings(skeleton, linksWithDetour, inventory, facts);
    const settingsBinding = bindings.scenarios.find((binding) => binding.workflow_ref === workflowCiting("E-0005"))!;
    const entryBinding = bindings.scenarios.find((binding) => binding.workflow_ref === workflowCiting("E-0001"))!;

    expect(settingsBinding.journey_milestones).toEqual([]);
    expect(entryBinding.journey_milestones).toEqual([{ journey_ref: "J001", milestone_position: 1, phase: "entry" }]);
  });

  it("skips a dead-end detour milestone so the journey never has to walk back", () => {
    const facts = shellFacts(true);
    facts.screens.push({
      schema_version: 3, ...identity, screen_id: "SCR-settings", route: "component:SettingsPage", title: "Settings",
      shell_screen_id: "SCR-shell", entry_guards: [], status: "verified", elements: [], apis: [], feedback: [], displays: [],
    });
    facts.screens[0].elements.push({
      id: "EL-shell-button-settings", type: "button", label: "Settings",
      interaction: { action_kind: "open settings", surface_kind: "web", target_candidates: [{ by: "test-id", value: "settings" }] },
      evidence: [evidence],
    });
    facts.edges.push({
      schema_version: 2, ...identity, edge_id: "E-0005", kind: "normal",
      from: "SCR-shell", on: "EL-shell-button-settings", to: "SCR-settings", feedback: [], evidence: [evidence], status: "verified",
    });
    const withDetour = {
      ...journeyLinks,
      journeys: [{
        ...journeyLinks.journeys[0],
        milestones: [
          journeyLinks.journeys[0].milestones[0],
          { target_ref: "JM001c", position: 2, phase: "work", required_outcome: "normal" as const, workflow_refs: ["WF-settings"], edge_refs: ["E-0005"], feasibility: "source-supported" as const },
          { ...journeyLinks.journeys[0].milestones[1], position: 3 },
          { ...journeyLinks.journeys[0].milestones[2], position: 4 },
        ],
      }],
    };

    const [journey] = compileJourneyCompleteScenarios(facts, withDetour);

    expect(journey.path).toEqual(["E-0001", "E-0002", "E-0003"]);
  });

  it("uses each edge at most once so a repeated milestone reference cannot duplicate a step", () => {
    const repeated = {
      ...journeyLinks,
      journeys: [{
        ...journeyLinks.journeys[0],
        milestones: [
          journeyLinks.journeys[0].milestones[0],
          { ...journeyLinks.journeys[0].milestones[1], edge_refs: ["E-0002", "E-0002"] },
          journeyLinks.journeys[0].milestones[2],
        ],
      }],
    };

    const [journey] = compileJourneyCompleteScenarios(shellFacts(true), repeated);

    expect(journey.path).toEqual(["E-0001", "E-0002", "E-0003"]);
  });

  it("bridges a contained screen back to shell chrome so the journey reaches its evidenced exit", () => {
    const [journey] = compileJourneyCompleteScenarios(shellFacts(true), journeyLinks);

    expect(journey.scenario_id).toBe("SCN-JOURNEY-J001-001");
    expect(journey.path).toEqual(["E-0001", "E-0002", "E-0003"]);
    expect(journey.steps.at(-1)?.action_ref).toEqual({ edge: "E-0003", element: "EL-shell-button-logout" });
  });

  it("drops a journey whose exit is unreachable when the shell relation is absent", () => {
    expect(compileJourneyCompleteScenarios(shellFacts(false), journeyLinks)).toEqual([]);
  });
});
