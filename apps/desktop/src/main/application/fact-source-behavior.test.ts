import { describe, expect, it } from "vitest";
import type { FactBundle, SourceSnapshot } from "@scenarioforge/contracts";
import { analyzeSourceInteractionBehaviors, auditFactSourceBehaviorTransitions, createSourceTransitionObligationInventory, sourceBehaviorTransitionObligations, validateFactCatalogSourceBehaviors, validateFactSourceBehaviors, type SourceInteractionBehavior } from "./fact-source-behavior.js";

const sourcePath = "frontend/src/main.page.jsx";
const sourceId = "SRC-main";
const source = `
function Shell({ setPage, onSelectTask, onCreateTask }) {
  const [taskMenuOpen, setTaskMenuOpen] = useState(false);
  return <>
    <button onClick={() => setPage("upload")}>Product</button>
    <button onClick={() => setTaskMenuOpen((open) => !open)}>Task menu</button>
    <button onClick={() => onSelectTask("T-1")}>Task item</button>
    <button onClick={() => onCreateTask()}>Create task</button>
  </>;
}

export function MainPage() {
  const setPage = async (page) => dispatch(pageSelected(page));
  const loadTask = async (taskId) => {
    try {
      await taskApi.bootstrap(taskId);
    } catch (error) {
      dispatch(requestFailed(error.message));
    }
  };
  const createTask = async () => {
    const timer = setInterval(() => {}, 1000);
    try {
      await taskApi.create();
    } catch (error) {
      dispatch(requestFailed(error.message));
    } finally {
      clearInterval(timer);
    }
  };
  return <Shell setPage={setPage} onSelectTask={loadTask} onCreateTask={createTask} />;
}
`.trim();

const lineOf = (text: string): number => source.slice(0, source.indexOf(text)).split("\n").length;
const interaction = (element_id: string, label: string, text: string) => ({
  element_id,
  screen_id: "SCR-component-mainpage",
  kind: "button",
  label,
  source_id: sourceId,
  line: lineOf(text),
  target_candidates: [{ by: "role-name", role: "button", name: label }],
});

const snapshot = {
  schema_version: 1,
  project_id: "PRJ-test",
  analysis_run_id: "RUN-test",
  source_snapshot_id: "SNAP-test",
  created_at: "2026-09-01T00:00:00.000Z",
  root_hash: "hash",
  ui_stacks: ["react"],
  unsupported_ui_stacks: [],
  files: [{ source_id: sourceId, path: sourcePath, language: "javascript", content_hash: "hash", size_bytes: source.length, imports: [] }],
  routes: [
    { screen_id: "SCR-component-mainpage", route: "component:MainPage", source_id: sourceId, line: lineOf("export function MainPage") },
    { screen_id: "SCR-component-uploadpage", route: "component:UploadPage", source_id: sourceId, line: 1 },
    { screen_id: "SCR-component-scenariopage", route: "component:ScenarioPage", source_id: sourceId, line: 1 },
  ],
  apis: [],
  interactions: [
    interaction("EL-product", "Product", "<button onClick={() => setPage"),
    interaction("EL-menu", "Task menu", "<button onClick={() => setTaskMenuOpen"),
    interaction("EL-select", "Task item", "<button onClick={() => onSelectTask"),
    interaction("EL-create", "Create task", "<button onClick={() => onCreateTask"),
  ],
  i18n: {},
} satisfies SourceSnapshot;

function facts(): FactBundle {
  const identity = { project_id: "PRJ-test", analysis_run_id: "RUN-test", source_snapshot_id: "SNAP-test" };
  const evidence = [{ source_id: sourceId, source_snapshot_id: "SNAP-test", path: sourcePath, start_line: 1, end_line: source.split("\n").length, content_hash: "hash", evidence_grant_id: "EVG-test" }];
  const element = (id: string, label: string) => ({ id, type: "button", label, interaction: { action_kind: "navigate", surface_kind: "web" as const, target_candidates: [] }, evidence });
  const screen = (screen_id: string, route: string, elements: ReturnType<typeof element>[] = []) => ({ schema_version: 3 as const, ...identity, screen_id, route, title: route, entry_guards: [], elements, apis: [], feedback: [], displays: [], status: "draft" as const });
  const edge = (edge_id: string, on: string, to: string, effect?: string) => ({ schema_version: 2 as const, ...identity, edge_id, source_branch_ref: "normal:1", kind: "normal" as const, from: "SCR-component-mainpage", on, ...(effect ? { effect } : {}), to, feedback: [], evidence, status: "draft" as const });
  return {
    schema_version: 2,
    ...identity,
    screens: [
      screen("SCR-component-mainpage", "component:MainPage", [element("EL-product", "Product"), element("EL-menu", "Task menu"), element("EL-select", "Task item"), element("EL-create", "Create task")]),
      screen("SCR-component-uploadpage", "component:UploadPage"),
      screen("SCR-component-scenariopage", "component:ScenarioPage"),
    ],
    predicates: [
      { schema_version: 2, ...identity, pred_id: "PRED-task-selected", values: ["true", "false"], source: "code", evidence },
    ],
    edges: [
      edge("E-1", "EL-product", "SCR-component-scenariopage"),
      edge("E-2", "EL-menu", "SCR-component-mainpage", "PRED-task-selected=true"),
      edge("E-3", "EL-select", "SCR-component-mainpage", "PRED-task-selected=true"),
      edge("E-4", "EL-create", "SCR-component-mainpage", "PRED-task-selected=true"),
    ],
  };
}

describe("FACT source behavior boundary", () => {
  it("links JSX prop callbacks to their concrete handlers and summarizes stable source behavior", () => {
    const behaviors = analyzeSourceInteractionBehaviors(snapshot, new Map([[sourcePath, source]]));
    expect(behaviors.find((entry) => entry.element_id === "EL-product")).toMatchObject({ literal_navigation_targets: ["upload"] });
    expect(behaviors.find((entry) => entry.element_id === "EL-menu")).toMatchObject({ local_state_keys: ["taskMenuOpen"], local_view_only: true });
    expect(behaviors.find((entry) => entry.element_id === "EL-select")).toMatchObject({ explicit_failure: true, local_view_only: false });
    expect(behaviors.find((entry) => entry.element_id === "EL-create")).toMatchObject({ explicit_failure: true, local_view_only: false });
    expect(behaviors.find((entry) => entry.element_id === "EL-create")?.local_state_keys).not.toContain("interval");
  });

  it("derives a stable download outcome from a resolved API handler", () => {
    const downloadSource = `
export function DownloadPage() {
  const downloadCsv = async () => {
    await taskApi.downloadMappingValidationCsv("TASK-1");
  };
  return <button onClick={downloadCsv}>Download CSV</button>;
}
`.trim();
    const downloadSnapshot = {
      ...snapshot,
      files: [{ ...snapshot.files[0]!, path: "Download.tsx", size_bytes: downloadSource.length }],
      routes: [{ screen_id: "SCR-download", route: "component:DownloadPage", source_id: sourceId, line: 1 }],
      interactions: [{
        element_id: "EL-download",
        screen_id: "SCR-download",
        kind: "button",
        label: "Download CSV",
        source_id: sourceId,
        line: downloadSource.slice(0, downloadSource.indexOf("<button")).split("\n").length,
        target_candidates: [{ by: "role-name" as const, role: "button", name: "Download CSV" }],
      }],
    } satisfies SourceSnapshot;

    expect(analyzeSourceInteractionBehaviors(downloadSnapshot, new Map([["Download.tsx", downloadSource]]))[0])
      .toMatchObject({ called_symbols: expect.arrayContaining(["taskApi.downloadMappingValidationCsv"]), stable_outcomes: ["downloaded"] });
  });

  it("resolves a handlerless control through the nearest bubbling DOM handler", () => {
    const bubblingSource = `
export function Tree() {
  const [open, setOpen] = useState(false);
  return <div onClick={() => setOpen(!open)}>
    <button type="button">Toggle</button>
  </div>;
}
`.trim();
    const bubblingSnapshot = {
      ...snapshot,
      files: [{ ...snapshot.files[0]!, path: "Tree.tsx", size_bytes: bubblingSource.length }],
      routes: [{ screen_id: "SCR-tree", route: "component:Tree", source_id: sourceId, line: 1 }],
      interactions: [{
        element_id: "EL-toggle",
        screen_id: "SCR-tree",
        kind: "button",
        label: "Toggle",
        source_id: sourceId,
        line: bubblingSource.slice(0, bubblingSource.indexOf("<button")).split("\n").length,
        target_candidates: [{ by: "role-name" as const, role: "button", name: "Toggle" }],
      }],
    } satisfies SourceSnapshot;

    expect(analyzeSourceInteractionBehaviors(bubblingSnapshot, new Map([["Tree.tsx", bubblingSource]]))[0])
      .toMatchObject({ local_state_keys: ["open"], local_view_only: true, journey_required: false });
  });

  it("omits handlerless native controls that have no downstream-consumed effect", () => {
    const nativeSource = `
export function Settings() {
  return <>
    <input type="checkbox" defaultChecked />
    <button type="button">No op</button>
  </>;
}
`.trim();
    const line = (text: string) => nativeSource.slice(0, nativeSource.indexOf(text)).split("\n").length;
    const nativeSnapshot = {
      ...snapshot,
      files: [{ ...snapshot.files[0]!, path: "Settings.tsx", size_bytes: nativeSource.length }],
      routes: [{ screen_id: "SCR-settings", route: "component:Settings", source_id: sourceId, line: 1 }],
      interactions: [
        { element_id: "EL-native", screen_id: "SCR-settings", kind: "checkbox", label: "checkbox", source_id: sourceId, line: line("<input"), target_candidates: [] },
        { element_id: "EL-noop", screen_id: "SCR-settings", kind: "button", label: "No op", source_id: sourceId, line: line("<button"), target_candidates: [] },
      ],
    } satisfies SourceSnapshot;

    expect(analyzeSourceInteractionBehaviors(nativeSnapshot, new Map([["Settings.tsx", nativeSource]]))).toEqual([]);
  });

  it("does not treat a form submit handler as the change handler of every nested input", () => {
    const formSource = `
export function Login() {
  const submit = async () => authApi.login();
  return <form onSubmit={submit}>
    <input name="username" />
  </form>;
}
`.trim();
    const formSnapshot = {
      ...snapshot,
      files: [{ ...snapshot.files[0]!, path: "Login.tsx", size_bytes: formSource.length }],
      routes: [{ screen_id: "SCR-login", route: "component:Login", source_id: sourceId, line: 1 }],
      interactions: [{
        element_id: "EL-username",
        screen_id: "SCR-login",
        kind: "input",
        label: "username",
        source_id: sourceId,
        line: formSource.slice(0, formSource.indexOf("<input")).split("\n").length,
        target_candidates: [],
      }],
    } satisfies SourceSnapshot;

    expect(analyzeSourceInteractionBehaviors(formSnapshot, new Map([["Login.tsx", formSource]]))).toEqual([]);
  });

  it("rejects source-inconsistent navigation, local-view effects, and missing exception branches", () => {
    const behaviors = analyzeSourceInteractionBehaviors(snapshot, new Map([[sourcePath, source]]));
    expect(validateFactSourceBehaviors(facts(), behaviors).map((issue) => issue.code)).toEqual([
      "FACT_SOURCE_STATE_PREDICATE_MISSING",
      "FACT_LITERAL_NAVIGATION_TARGET_MISMATCH",
      "FACT_LOCAL_VIEW_EFFECT_UNSUPPORTED",
      "FACT_UNRESOLVED_CONNECTION_EDGE_FORBIDDEN",
      "FACT_UNRESOLVED_CONNECTION_EDGE_FORBIDDEN",
    ]);
  });

  it("does not require an edge for a non-local handler whose cross-layer connection is unresolved", () => {
    const behaviors = analyzeSourceInteractionBehaviors(snapshot, new Map([[sourcePath, source]]));
    const artifact = facts();
    artifact.edges = artifact.edges.filter((edge) => edge.on !== "EL-select");

    expect(validateFactSourceBehaviors(artifact, behaviors)).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "$.edges[on=EL-select]" }),
    ]));
  });

  it("reports an executable local-view handler missing from the transition denominator", () => {
    const behaviors = analyzeSourceInteractionBehaviors(snapshot, new Map([[sourcePath, source]]));
    const artifact = facts();
    artifact.edges = artifact.edges.filter((edge) => edge.on !== "EL-menu");

    expect(auditFactSourceBehaviorTransitions(artifact, behaviors).missing_obligations).toEqual(expect.arrayContaining([
      expect.objectContaining({ source_action_ref: "EL-menu", branch_ref: "normal:1", scope: "view", outcome: "normal" }),
    ]));
  });

  it("requires a backend branch identity on edges from a new structured source scan", () => {
    const behavior = analyzeSourceInteractionBehaviors(snapshot, new Map([[sourcePath, source]]))
      .find((entry) => entry.element_id === "EL-menu")!;
    const artifact = facts();
    const edge = artifact.edges.find((candidate) => candidate.on === behavior.element_id)!;
    delete edge.source_branch_ref;

    expect(validateFactSourceBehaviors(artifact, [behavior])).toContainEqual(expect.objectContaining({
      code: "FACT_SOURCE_BRANCH_REF_MISSING",
      path: `$.edges[edge_id=${edge.edge_id}].source_branch_ref`,
    }));
  });

  it("keeps local view obligations while excluding unresolved cross-layer journeys", () => {
    const behavior = analyzeSourceInteractionBehaviors(snapshot, new Map([[sourcePath, source]]))
      .find((entry) => entry.element_id === "EL-menu")!;
    const selectBehavior = analyzeSourceInteractionBehaviors(snapshot, new Map([[sourcePath, source]]))
      .find((entry) => entry.element_id === "EL-select")!;

    expect(sourceBehaviorTransitionObligations([behavior, selectBehavior])).toEqual([
      expect.objectContaining({ source_action_ref: "EL-menu", branch_ref: "normal:1", scope: "view", outcome: "normal", feasibility: "source-supported" }),
    ]);
  });

  it("rejects an edge ledger that omits backend-enumerated branches", () => {
    const artifact = facts();
    artifact.edges = [
      artifact.edges.find((edge) => edge.on === "EL-select")!,
      { ...artifact.edges.find((edge) => edge.on === "EL-select")!, edge_id: "E-select-error", source_branch_ref: "exception:1", kind: "exception" },
    ];
    const behavior: SourceInteractionBehavior = {
      element_id: "EL-select",
      source_id: sourceId,
      path: sourcePath,
      line: lineOf("<button onClick={() => onSelectTask"),
      handler_lines: [lineOf("const loadTask")],
      called_symbols: ["taskApi.bootstrap"],
      local_state_keys: [],
      downstream_consumed_state_keys: [],
      literal_navigation_targets: [],
      explicit_failure: true,
      local_view_only: false,
      journey_required: true,
      feasibility: "verified",
      branches: [
        { branch_ref: "normal:1", outcome: "normal", guard_keys: [], feasibility: "verified", source_refs: [] },
        { branch_ref: "exception:1", outcome: "exception", guard_keys: ["authorization:manager"], feasibility: "inferred", source_refs: [] },
        { branch_ref: "exception:2", outcome: "exception", guard_keys: ["stage:review"], feasibility: "verified", source_refs: [] },
      ],
    };

    expect(validateFactSourceBehaviors(artifact, [behavior])).toContainEqual(expect.objectContaining({
      code: "FACT_SOURCE_BRANCH_MISSING",
      path: "$.edges[on=EL-select]",
      message: expect.stringContaining("exception:2"),
    }));
  });

  it("does not let duplicate branch identities satisfy a different backend branch", () => {
    const artifact = facts();
    const selected = artifact.edges.find((edge) => edge.on === "EL-select")!;
    artifact.edges = [
      { ...selected, edge_id: "E-normal", kind: "normal" },
      { ...selected, edge_id: "E-auth", kind: "exception" },
      { ...selected, edge_id: "E-auth-copy", kind: "exception" },
    ];
    const taggedEdges = artifact.edges as Array<(typeof artifact.edges)[number] & { source_branch_ref?: string }>;
    taggedEdges[0]!.source_branch_ref = "normal:1";
    taggedEdges[1]!.source_branch_ref = "exception:1";
    taggedEdges[2]!.source_branch_ref = "exception:1";
    const behavior: SourceInteractionBehavior = {
      element_id: "EL-select",
      source_id: sourceId,
      path: sourcePath,
      line: lineOf("<button onClick={() => onSelectTask"),
      handler_lines: [lineOf("const loadTask")],
      called_symbols: ["taskApi.bootstrap"],
      local_state_keys: [],
      downstream_consumed_state_keys: [],
      literal_navigation_targets: [],
      explicit_failure: true,
      local_view_only: false,
      journey_required: true,
      feasibility: "verified",
      branches: [
        { branch_ref: "normal:1", outcome: "normal", guard_keys: [], feasibility: "verified", source_refs: [] },
        { branch_ref: "exception:1", outcome: "exception", guard_keys: ["authorization:manager"], feasibility: "inferred", source_refs: [] },
        { branch_ref: "exception:2", outcome: "exception", guard_keys: ["stage:review"], feasibility: "verified", source_refs: [] },
      ],
    };

    const issues = validateFactSourceBehaviors(artifact, [behavior]);
    expect(issues).toContainEqual(expect.objectContaining({
      code: "FACT_SOURCE_BRANCH_MISSING",
      message: expect.stringContaining("exception:2"),
    }));
    expect(issues).toContainEqual(expect.objectContaining({
      code: "FACT_SOURCE_BRANCH_DUPLICATE",
      message: expect.stringContaining("exception:1"),
    }));
  });

  it("rejects an edge branch that is absent from the backend inventory", () => {
    const artifact = facts();
    const selected = artifact.edges.find((edge) => edge.on === "EL-select")!;
    artifact.edges = [selected, { ...selected, edge_id: "E-invented", source_branch_ref: "normal:2" }];
    const behavior: SourceInteractionBehavior = {
      element_id: "EL-select",
      source_id: sourceId,
      path: sourcePath,
      line: lineOf("<button onClick={() => onSelectTask"),
      handler_lines: [lineOf("const loadTask")],
      called_symbols: ["taskApi.bootstrap"],
      local_state_keys: [],
      downstream_consumed_state_keys: [],
      literal_navigation_targets: [],
      explicit_failure: false,
      local_view_only: false,
      journey_required: true,
      feasibility: "verified",
      branches: [{ branch_ref: "normal:1", outcome: "normal", guard_keys: [], feasibility: "verified", source_refs: [] }],
    };

    expect(validateFactSourceBehaviors(artifact, [behavior])).toContainEqual(expect.objectContaining({
      code: "FACT_SOURCE_BRANCH_UNSUPPORTED",
      message: expect.stringContaining("E-invented"),
    }));
  });

  it("assigns backend-owned opaque transition refs and carries unresolved scanner records", () => {
    const behaviors = analyzeSourceInteractionBehaviors(snapshot, new Map([[sourcePath, source]]));
    const extendedSnapshot = {
      ...snapshot,
      interactions: [...snapshot.interactions, interaction("EL-unresolved", "No op", "<button onClick={() => onCreateTask")],
    } satisfies SourceSnapshot;
    extendedSnapshot.interactions.at(-1)!.line = 999;
    const inventory = createSourceTransitionObligationInventory(extendedSnapshot, behaviors);

    expect(inventory.obligations[0]).toMatchObject({ transition_ref: "T001", source_action_ref: "EL-product", source_ref: sourceId });
    expect(inventory.obligations.map((entry) => entry.transition_ref)).toEqual(
      inventory.obligations.map((_, index) => `T${String(index + 1).padStart(3, "0")}`),
    );
    expect(inventory.unresolved_interactions).toEqual([
      expect.objectContaining({ source_action_ref: "EL-select", source_ref: sourceId }),
      expect.objectContaining({ source_action_ref: "EL-create", source_ref: sourceId }),
      expect.objectContaining({ source_action_ref: "EL-unresolved", source_ref: sourceId, line: 999 }),
    ]);
  });

  it("rejects a journey handler whose local outcome state has no evidence-linked predicate", () => {
    const behavior = analyzeSourceInteractionBehaviors(snapshot, new Map([[sourcePath, source]]))
      .find((entry) => entry.element_id === "EL-create")!;
    const artifact = facts();
    artifact.edges.push({ ...artifact.edges.at(-1)!, edge_id: "E-5", kind: "exception", effect: "PRED-task-selected=false" });

    expect(validateFactSourceBehaviors(artifact, [{ ...behavior, local_state_keys: ["requesting", "errorMessage"], downstream_consumed_state_keys: ["requesting", "errorMessage"] }])).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "FACT_SOURCE_STATE_PREDICATE_MISSING",
        path: "$.predicates[element=EL-create]",
        message: expect.stringContaining("requesting|errorMessage"),
      }),
    ]));
  });

  it("does not promote transient local UI state into a canonical predicate obligation", () => {
    const behavior = analyzeSourceInteractionBehaviors(snapshot, new Map([[sourcePath, source]]))
      .find((entry) => entry.element_id === "EL-create")!;
    const artifact = facts();

    expect(validateFactCatalogSourceBehaviors(artifact, [{ ...behavior, local_state_keys: ["requesting", "message"], downstream_consumed_state_keys: [] }])
      .map((issue) => issue.code)).not.toContain("FACT_SOURCE_STATE_PREDICATE_MISSING");
  });

  it("matches source-state and predicate tokens independent of word order", () => {
    const behavior = analyzeSourceInteractionBehaviors(snapshot, new Map([[sourcePath, source]]))
      .find((entry) => entry.element_id === "EL-create")!;
    const artifact = facts();
    artifact.predicates.push({
      ...artifact.predicates[0]!,
      pred_id: "PRED-projects-loading",
      values: ["true", "false"],
    });

    expect(validateFactCatalogSourceBehaviors(artifact, [{ ...behavior, local_state_keys: ["loadingProjects"], downstream_consumed_state_keys: ["loadingProjects"] }])
      .map((issue) => issue.code)).not.toContain("FACT_SOURCE_STATE_PREDICATE_MISSING");
  });

  it("rejects an unresolved action kind for a source-required journey element", () => {
    const behavior = analyzeSourceInteractionBehaviors(snapshot, new Map([[sourcePath, source]]))
      .find((entry) => entry.element_id === "EL-product")!;
    const artifact = facts();
    artifact.screens[0]!.elements.find((element) => element.id === "EL-product")!.interaction.action_kind = "unresolved";

    expect(validateFactCatalogSourceBehaviors(artifact, [behavior])).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "FACT_SOURCE_ACTION_UNRESOLVED",
        path: "$.screens.elements[id=EL-product].interaction.action_kind",
      }),
    ]));
  });

  it("matches camel-collapsed and decomposed object-state predicate names", () => {
    const behavior = analyzeSourceInteractionBehaviors(snapshot, new Map([[sourcePath, source]]))
      .find((entry) => entry.element_id === "EL-create")!;
    const artifact = facts();
    artifact.predicates.push({
      ...artifact.predicates[0]!,
      pred_id: "PRED-business-mappingcsv-exporting",
      values: ["true", "false"],
    }, {
      ...artifact.predicates[0]!,
      pred_id: "PRED-upload-stage",
      values: ["CREATED", "PARSED"],
    });

    expect(validateFactCatalogSourceBehaviors(artifact, [{ ...behavior, local_state_keys: ["exportingCsv", "uploadState"], downstream_consumed_state_keys: ["exportingCsv", "uploadState"] }])
      .map((issue) => issue.code)).not.toContain("FACT_SOURCE_STATE_PREDICATE_MISSING");
  });

  it("requires an evidence-linked stable outcome predicate for a download action", () => {
    const behavior = analyzeSourceInteractionBehaviors(snapshot, new Map([[sourcePath, source]]))
      .find((entry) => entry.element_id === "EL-create")!;
    const artifact = facts();
    const download = artifact.screens[0]!.elements.find((element) => element.id === "EL-create")!;
    download.interaction.action_kind = "download";
    artifact.predicates.push({
      ...artifact.predicates[0]!,
      pred_id: "PRED-download-status",
      values: ["idle", "downloading", "failure"],
    });
    artifact.predicates.push({
      ...artifact.predicates[0]!,
      pred_id: "PRED-generation-status",
      values: ["complete"],
    });

    expect(validateFactCatalogSourceBehaviors(artifact, [{ ...behavior, local_state_keys: [] }])).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "FACT_SOURCE_STABLE_OUTCOME_PREDICATE_MISSING",
        path: "$.predicates[element=EL-create]",
      }),
    ]));

    artifact.predicates.find((predicate) => predicate.pred_id === "PRED-download-status")!.values.push("downloaded");
    expect(validateFactCatalogSourceBehaviors(artifact, [{ ...behavior, local_state_keys: [] }])
      .map((issue) => issue.code)).not.toContain("FACT_SOURCE_STABLE_OUTCOME_PREDICATE_MISSING");
  });

  it("rejects any edge retained for an unresolved journey action", () => {
    const behavior = analyzeSourceInteractionBehaviors(snapshot, new Map([[sourcePath, source]]))
      .find((entry) => entry.element_id === "EL-create")!;
    const artifact = facts();
    artifact.edges = artifact.edges.filter((edge) => edge.on !== "EL-create");
    artifact.edges.push({ ...artifact.edges[0]!, edge_id: "E-only-failure", on: "EL-create", kind: "exception" });

    expect(validateFactSourceBehaviors(artifact, [behavior])).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "FACT_UNRESOLVED_CONNECTION_EDGE_FORBIDDEN", path: "$.edges[on=EL-create]" }),
    ]));
  });
});
