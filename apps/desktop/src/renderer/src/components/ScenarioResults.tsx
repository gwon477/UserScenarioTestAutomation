import { useEffect, useMemo, useState } from "react";
import {
  enqueueScenarioTests,
  getTestExecutionRequirements,
  startScenarioTests,
  type SelectedDirectory,
} from "../desktop";
import type { TestExecutionAcceptance } from "../../../shared/desktop-api";
import type {
  ScenarioReadinessView,
  TestExecutionRequirements,
} from "../../../shared/test-requirements";
import type { ScenarioResult } from "../scenario-result";
import { ScenarioChat } from "./ScenarioChat";
import { ScenarioSheet } from "./ScenarioSheet";
import { TestExecutionPanel } from "./TestExecutionPanel";
import { Icon } from "./Icon";

type Props = {
  project: SelectedDirectory;
  result: ScenarioResult;
  initialSelectedIds?: string[];
  focusedScenarioId?: string;
  onBack: () => void;
  onExecutionQueued: (executionId: string) => void | Promise<void>;
  /* 활성 실행. 있으면 새 실행을 만들지 않고 그 뒤에 붙인다. */
  activeExecution?: { executionId: string; targetUrl: string };
};

export function ScenarioResults({
  project,
  result,
  initialSelectedIds = [],
  focusedScenarioId,
  onBack,
  onExecutionQueued,
  activeExecution,
}: Props) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(initialSelectedIds),
  );
  /* 설정 드로어. 선택만으로 열지 않는다. 케이스를 고르는 동안 시트가 좁아지면
   * 무엇을 고르는지 보기 어려워진다. */
  const [panelOpen, setPanelOpen] = useState(false);
  const allScenarios = useMemo(
    () => result.groups.flatMap((group) => group.scenarios),
    [result.groups],
  );
  const selectedScenarios = allScenarios.filter((scenario) => selectedIds.has(scenario.id));

  const [readiness, setReadiness] = useState<Record<string, ScenarioReadinessView>>({});
  const [requirements, setRequirements] = useState<TestExecutionRequirements | null>(null);
  const [requirementsError, setRequirementsError] = useState<string | undefined>(undefined);
  const selectedKey = selectedScenarios.map((scenario) => scenario.id).join(",");

  /* 시트의 실행 준비 상태. 전체 케이스에 대해 한 번만 도출한다.
   * renderer 가 상태를 추정하지 않는다. */
  useEffect(() => {
    const ids = allScenarios.map((scenario) => scenario.id);
    if (ids.length === 0) return;
    let alive = true;
    void getTestExecutionRequirements({ project, runId: result.runId, scenarioIds: ids })
      .then((next) => {
        if (!alive || !next) return;
        setReadiness(Object.fromEntries(next.scenarios.map((entry) => [entry.scenarioId, entry])));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [project, result.runId, allScenarios]);

  /* 선택한 케이스의 요구사항은 main 이 정본 artifact 에서 도출한다. 값을 입력하는
   * 동안 다시 묻지 않고, 어느 케이스가 실행 가능한지는 패널이 입력 상태로 계산한다. */
  useEffect(() => {
    if (selectedKey === "") {
      setRequirements(null);
      setRequirementsError(undefined);
      return;
    }
    let alive = true;
    setRequirements(null);
    setRequirementsError(undefined);
    void getTestExecutionRequirements({
      project,
      runId: result.runId,
      scenarioIds: selectedKey.split(","),
    })
      .then((next) => {
        if (!alive) return;
        if (next) setRequirements(next);
        else setRequirementsError("REQUIREMENTS_UNAVAILABLE");
      })
      .catch(() => {
        if (alive) setRequirementsError("REQUIREMENTS_UNAVAILABLE");
      });
    return () => {
      alive = false;
    };
  }, [project, result.runId, selectedKey]);

  /* 대기열 등록 결과가 오기 전에는 테스트 센터로 이동하지 않는다.
   * 거절되면 선택과 입력을 유지하고 사유를 그 자리에 남긴다. */
  async function handleRun(input: {
    targetUrl: string;
    dataBindings: Record<string, string>;
    maskElementRefs: string[];
    destructiveAllowed: boolean;
  }): Promise<TestExecutionAcceptance> {
    const command = {
      project,
      runId: result.runId,
      // 멱등 키. 같은 요청을 다시 보내도 새 실행을 만들지 않는다.
      operationId: crypto.randomUUID(),
      scenarioIds: selectedScenarios.map((scenario) => scenario.id),
      targetUrl: input.targetUrl,
      dataBindings: input.dataBindings,
      maskElementRefs: input.maskElementRefs,
      destructiveAllowed: input.destructiveAllowed,
    };
    const acceptance = activeExecution
      ? await enqueueScenarioTests({ ...command, executionId: activeExecution.executionId })
      : await startScenarioTests(command);
    if (acceptance.outcome === "queued") {
      // 실행 상태는 backend 투영으로만 만든다. renderer 가 조립하지 않는다.
      await onExecutionQueued(acceptance.executionId);
    }
    return acceptance;
  }

  return (
    <>
      <div className="between" style={{ flex: "none" }}>
        <div style={{ minWidth: 0 }}>
          <button className="btn link" type="button" onClick={onBack}>
            <Icon name="i-arrow-l" size="sm" />
            생성 이력
          </button>
          <h1 className="h1" style={{ fontSize: 20, marginTop: 4 }}>
            사용자 시나리오 {allScenarios.length}건
          </h1>
          <p className="path" style={{ marginTop: 4 }} title={result.storagePath}>
            {result.runId} · {result.storagePath}
          </p>
        </div>
        <div className="stats">
          <div className="stat">
            <p className="num sm">{result.groups.length}</p>
            <span className="path">업무 분류</span>
          </div>
          <div className="stat">
            <p className="num sm">{allScenarios.length}</p>
            <span className="path">시나리오</span>
          </div>
          <div className="stat">
            <p className="num sm" style={{ color: selectedScenarios.length > 0 ? "var(--accent-ink)" : undefined }}>
              {selectedScenarios.length}
            </p>
            <span className="path">선택</span>
          </div>
        </div>
      </div>

      {/* 설정을 열면 질의 패널 대신 드로어가 들어온다. 목업 S8 의 판단을 따른다.
        * 하단 패널로 두면 낮은 창 높이에서 시트를 가린다. */}
      <div
        className="split-3"
        style={{ gridTemplateColumns: panelOpen ? "minmax(0,1fr) 400px" : "290px minmax(0,1fr)" }}
      >
        {!panelOpen && <ScenarioChat project={project} result={result} />}

        <section className="panel" aria-labelledby="scenario-sheet-title">
          <div className="panel-h">
            <h2 className="h3" id="scenario-sheet-title">
              시나리오 시트
            </h2>
            <span className="tag" title="scenarioId(업무코드, 순번)">
              SCN-&#123;업무코드&#125;-&#123;3자리&#125;
            </span>
            <span className="end">
              <span className="path">{result.generatedAt} 생성</span>
              {selectedScenarios.length > 0 && (
                <>
                  <span className="chip mono">{selectedScenarios.length}건 선택</span>
                  <button className="btn sm" type="button" onClick={() => setSelectedIds(new Set())}>
                    선택 해제
                  </button>
                </>
              )}
            </span>
          </div>

          <ScenarioSheet
            result={result}
            selectedIds={selectedIds}
            focusedScenarioId={focusedScenarioId}
            onSelectionChange={setSelectedIds}
            readiness={readiness}
          />

          {selectedScenarios.length > 0 && (
            <div className="panel-f">
              <span className="selected-ids">
                {selectedScenarios.slice(0, 3).map((scenario) => (
                  <span className="chip mono" key={scenario.id}>
                    {scenario.id}
                  </span>
                ))}
                {selectedScenarios.length > 3 && (
                  <span className="chip mono">+{selectedScenarios.length - 3}</span>
                )}
              </span>
              <span className="end">
                <button className="btn pri sm" type="button" onClick={() => setPanelOpen(true)} disabled={panelOpen}>
                  <Icon name="i-play" size="sm" />
                  선택한 {selectedScenarios.length}건 테스트 설정
                </button>
              </span>
            </div>
          )}
        </section>

        {panelOpen && selectedScenarios.length > 0 && (
          <TestExecutionPanel
            selectedScenarios={selectedScenarios}
            requirements={requirements}
            {...(requirementsError ? { requirementsError } : {})}
            {...(activeExecution ? { activeExecution } : {})}
            onClear={() => setPanelOpen(false)}
            onRun={handleRun}
          />
        )}
      </div>
    </>
  );
}
