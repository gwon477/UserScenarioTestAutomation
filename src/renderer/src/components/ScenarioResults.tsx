import { useMemo, useState } from "react";
import { ArrowLeft, Database, FileStack } from "lucide-react";
import {
  startScenarioTests,
  type SelectedDirectory,
} from "../desktop";
import type { ScenarioResult } from "../scenario-result";
import { ScenarioChat } from "./ScenarioChat";
import { ScenarioSheet } from "./ScenarioSheet";
import { TestExecutionPanel } from "./TestExecutionPanel";

type Props = {
  project: SelectedDirectory;
  result: ScenarioResult;
  initialSelectedIds?: string[];
  focusedScenarioId?: string;
  onBack: () => void;
  onExecutionStarted: (targetUrl: string, scenarioIds: string[]) => void;
};

export function ScenarioResults({
  project,
  result,
  initialSelectedIds = [],
  focusedScenarioId,
  onBack,
  onExecutionStarted,
}: Props) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(initialSelectedIds),
  );
  const allScenarios = useMemo(
    () => result.groups.flatMap((group) => group.scenarios),
    [result.groups],
  );
  const selectedScenarios = allScenarios.filter((scenario) => selectedIds.has(scenario.id));

  async function handleRun(targetUrl: string, personalData: Record<string, unknown>) {
    await startScenarioTests({
      project,
      runId: result.runId,
      scenarioIds: selectedScenarios.map((scenario) => scenario.id),
      targetUrl,
      personalData,
    });
    onExecutionStarted(
      targetUrl,
      selectedScenarios.map((scenario) => scenario.id),
    );
  }

  return (
    <main className="result-workspace" id="main-content">
      <header className="result-heading">
        <div>
          <a
            className="result-back"
            href="#project-workspace"
            onClick={(event) => {
              event.preventDefault();
              onBack();
            }}
          >
            <ArrowLeft size={16} aria-hidden="true" /> 프로젝트 작업대
          </a>
          <span className="eyebrow">SCENARIO INFORMATION SET</span>
          <h1>분석 결과</h1>
        </div>
        <dl className="result-meta">
          <div>
            <dt>생성 이력</dt>
            <dd>{result.runId}</dd>
          </div>
          <div>
            <dt>업무 분류</dt>
            <dd>{result.groups.length}개</dd>
          </div>
          <div>
            <dt>시나리오</dt>
            <dd>{allScenarios.length}개</dd>
          </div>
        </dl>
        <div className="local-data-source">
          <Database size={16} aria-hidden="true" />
          <span>LOCAL DATA</span>
          <code>{result.storagePath}</code>
        </div>
      </header>

      <div className="result-layout">
        <ScenarioChat project={project} result={result} />
        <div className="scenario-area">
          <div className="scenario-area-summary">
            <FileStack size={17} aria-hidden="true" />
            <span>{project.name}</span>
            <span aria-hidden="true">/</span>
            <span>{result.generatedAt} 생성</span>
          </div>
          <ScenarioSheet
            result={result}
            selectedIds={selectedIds}
            focusedScenarioId={focusedScenarioId}
            onSelectionChange={setSelectedIds}
          />
        </div>
      </div>

      {selectedScenarios.length > 0 && (
        <TestExecutionPanel
          selectedScenarios={selectedScenarios}
          previewFilled={initialSelectedIds.length > 0}
          onClear={() => setSelectedIds(new Set())}
          onRun={handleRun}
        />
      )}
    </main>
  );
}
