import { useEffect, useRef, useState } from "react";
import { ChevronDown, FileCode2, GripVertical } from "lucide-react";
import type { ScenarioCase, ScenarioResult } from "../scenario-result";

type Props = {
  result: ScenarioResult;
  selectedIds: Set<string>;
  onSelectionChange: (next: Set<string>) => void;
};

function SelectAllCheckbox({
  checked,
  indeterminate,
  onChange,
}: {
  checked: boolean;
  indeterminate: boolean;
  onChange: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      onChange={onChange}
      aria-label="전체 시나리오 선택"
    />
  );
}

export function ScenarioSheet({ result, selectedIds, onSelectionChange }: Props) {
  const allScenarios = result.groups.flatMap((group) => group.scenarios);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(
    () => new Set(allScenarios[0] ? [allScenarios[0].id] : []),
  );

  function toggleSelected(id: string) {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectionChange(next);
  }

  function toggleAll() {
    onSelectionChange(
      selectedIds.size === allScenarios.length
        ? new Set()
        : new Set(allScenarios.map((scenario) => scenario.id)),
    );
  }

  function toggleExpanded(id: string) {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleDragStart(event: React.DragEvent, scenario: ScenarioCase) {
    const dragPreview = document.createElement("code");
    dragPreview.className = "scenario-drag-preview";
    dragPreview.textContent = scenario.id;
    document.body.appendChild(dragPreview);

    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("application/x-scenarioforge-id", scenario.id);
    event.dataTransfer.setData("text/plain", scenario.id);
    event.dataTransfer.setDragImage(dragPreview, 12, 12);

    window.setTimeout(() => dragPreview.remove(), 0);
  }

  return (
    <section className="scenario-sheet" aria-labelledby="scenario-sheet-title">
      <header className="sheet-header">
        <div>
          <span className="eyebrow">SCENARIO SHEET</span>
          <h2 id="scenario-sheet-title">사용자 시나리오</h2>
        </div>
        <div className="id-rule">
          <span>ID 규칙</span>
          <code>SCN-&#123;업무코드&#125;-&#123;3자리 순번&#125;</code>
        </div>
      </header>

      <div className="sheet-columns">
        <span>
          <SelectAllCheckbox
            checked={selectedIds.size === allScenarios.length}
            indeterminate={selectedIds.size > 0 && selectedIds.size < allScenarios.length}
            onChange={toggleAll}
          />
        </span>
        <span>시나리오 ID</span>
        <span>사용자 시나리오</span>
        <span>원천</span>
        <span>세부</span>
        <span aria-hidden="true" />
      </div>

      <div className="scenario-groups">
        {result.groups.map((group) => (
          <section className="scenario-group" key={group.code} aria-labelledby={`group-${group.code}`}>
            <header className="group-header">
              <span>{group.code}</span>
              <h3 id={`group-${group.code}`}>{group.name}</h3>
              <small>{group.scenarios.length} cases</small>
            </header>

            {group.scenarios.map((scenario) => {
              const expanded = expandedIds.has(scenario.id);
              const selected = selectedIds.has(scenario.id);
              return (
                <article
                  className={`scenario-case${selected ? " is-selected" : ""}`}
                  key={scenario.id}
                  draggable
                  onDragStart={(event) => handleDragStart(event, scenario)}
                >
                  <div className="case-main">
                    <span className="case-select">
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => toggleSelected(scenario.id)}
                        aria-label={`${scenario.id} 테스트 선택`}
                      />
                    </span>
                    <code className="case-id">{scenario.id}</code>
                    <div className="case-title">
                      <strong>{scenario.title}</strong>
                      <span>{scenario.summary}</span>
                    </div>
                    <span className="case-source" title={scenario.source}>
                      <FileCode2 size={14} aria-hidden="true" />
                      {scenario.source.split("/").at(-1)}
                    </span>
                    <button
                      className="steps-toggle"
                      type="button"
                      onClick={() => toggleExpanded(scenario.id)}
                      aria-expanded={expanded}
                      aria-controls={`steps-${scenario.id}`}
                    >
                      {scenario.steps.length} steps
                      <ChevronDown size={16} aria-hidden="true" />
                    </button>
                    <span className="drag-handle" title="채팅으로 끌어 질문하기">
                      <GripVertical size={17} aria-hidden="true" />
                    </span>
                  </div>

                  {expanded && (
                    <div className="case-details" id={`steps-${scenario.id}`}>
                      <div className="precondition">
                        <span>사전 조건</span>
                        <p>{scenario.precondition}</p>
                      </div>
                      <ol className="scenario-steps">
                        {scenario.steps.map((step) => (
                          <li key={step.order}>
                            <span>{String(step.order).padStart(2, "0")}</span>
                            <p>{step.action}</p>
                            <p>{step.expected}</p>
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}
                </article>
              );
            })}
          </section>
        ))}
      </div>
    </section>
  );
}
