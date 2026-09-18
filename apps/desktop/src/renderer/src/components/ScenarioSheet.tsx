import type { CSSProperties } from "react";
import { useEffect, useRef, useState } from "react";
import type {
  ScenarioBlockerReason,
  ScenarioReadinessView,
} from "../../../shared/test-requirements";
import type { ScenarioCase, ScenarioResult } from "../scenario-result";
import { Icon } from "./Icon";

/* 시나리오 시트. 목업 S7 의 `.sheet-*` 축을 따른다. 헤더·행·세부가 같은
 * 컬럼 축을 공유해야 세로 정렬이 맞는다.
 *
 * 실행 준비 상태는 main 이 컴파일 결과에서 도출한다. renderer 가 추정하지
 * 않는다. 계약은 docs/screens/04-scenario-results.md 를 따른다. */

type Props = {
  result: ScenarioResult;
  selectedIds: Set<string>;
  focusedScenarioId?: string;
  onSelectionChange: (next: Set<string>) => void;
  readiness?: Readonly<Record<string, ScenarioReadinessView>>;
};

const blockerLabels: Record<ScenarioBlockerReason, string> = {
  EDGE_NOT_FOUND: "근거 참조 불일치",
  ELEMENT_NOT_FOUND: "근거 참조 불일치",
  ACTION_KIND_UNRESOLVED: "동작 미확정",
  ACTION_KIND_UNSUPPORTED: "미지원 동작",
  NO_VISUAL_TARGET_EVIDENCE: "화면 대상 근거 없음",
  AMBIGUOUS_VISUAL_TARGET: "대상 구별 불가",
  MISSING_ASSERTION_REFERENCE: "판정 기준 없음",
};

const readiness: Record<ScenarioReadinessView["state"], { label: string; tone: string }> = {
  ready: { label: "실행 가능", tone: "ok" },
  "data-required": { label: "데이터 연결 필요", tone: "warn" },
  blocked: { label: "자동화 불가", tone: "bad" },
};

/* 끌기 손잡이를 맨 왼쪽에 둔다. 질의 패널이 시트 왼쪽에 있어 오른쪽 끝에서
 * 끌면 시트 전체를 가로질러야 한다.
 *
 * 원천 컬럼이 목업보다 하나 많다. 세부 패널의 왼쪽 정렬선은 ID 컬럼 시작선
 * (20 + 20 + 16 + 24 + 16 = 96px, `--sc-ind`)에 맞춘다. */
const SHEET_COLS: CSSProperties = {
  "--sc": "20px 24px 230px minmax(0,1fr) 116px 72px",
} as CSSProperties;

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

export function ScenarioSheet({
  result,
  selectedIds,
  focusedScenarioId,
  onSelectionChange,
  readiness: readinessByScenario,
}: Props) {
  const allScenarios = result.groups.flatMap((group) => group.scenarios);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(
    () => new Set(allScenarios[0] ? [allScenarios[0].id] : []),
  );

  useEffect(() => {
    if (!focusedScenarioId) return;
    setExpandedIds(new Set([focusedScenarioId]));
    window.setTimeout(() => {
      const target = document.getElementById(`scenario-${focusedScenarioId}`);
      target?.scrollIntoView({ block: "center", behavior: "smooth" });
      target?.focus({ preventScroll: true });
    }, 80);
  }, [focusedScenarioId]);

  function toggleSelected(id: string) {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectionChange(next);
  }

  /* 준비 상태를 알 때는 실행 가능한 것만 전체 선택한다.
   * 자동화 불가 케이스를 선택하면 제출 뒤에야 거절을 알게 된다. */
  const selectableIds = allScenarios
    .filter((scenario) => (readinessByScenario?.[scenario.id]?.state ?? "ready") !== "blocked")
    .map((scenario) => scenario.id);

  function toggleAll() {
    onSelectionChange(
      selectableIds.every((id) => selectedIds.has(id)) ? new Set() : new Set(selectableIds),
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
    <div className="panel-s" style={SHEET_COLS}>
      <div className="sheet-hd">
        <span aria-hidden="true" />
        <span>
          <SelectAllCheckbox
            checked={selectableIds.length > 0 && selectableIds.every((id) => selectedIds.has(id))}
            indeterminate={selectedIds.size > 0 && selectedIds.size < selectableIds.length}
            onChange={toggleAll}
          />
        </span>
        <span>시나리오 ID</span>
        <span>사용자 시나리오 · 실행 준비</span>
        <span>원천</span>
        <span>세부</span>
      </div>

      {result.groups.map((group) => (
        <div key={group.code}>
          <div className="sheet-gp">
            <b>{group.code}</b>
            <h3>{group.name}</h3>
            <small>{group.scenarios.length} cases</small>
          </div>

          {group.scenarios.map((scenario) => {
            const expanded = expandedIds.has(scenario.id);
            const selected = selectedIds.has(scenario.id);
            const state = readinessByScenario?.[scenario.id];
            const blocked = state?.state === "blocked";
            const tone = state ? readiness[state.state] : undefined;
            return (
              <div key={scenario.id}>
                <div
                  id={`scenario-${scenario.id}`}
                  tabIndex={-1}
                  className={`sheet-rw${selected ? " on" : ""}`}
                  draggable
                  onDragStart={(event) => handleDragStart(event, scenario)}
                >
                  <span className="sheet-grip" title="질의 패널로 끌어 질문하기">
                    <Icon name="i-grip" size="sm" />
                  </span>
                  <input
                    type="checkbox"
                    checked={selected}
                    disabled={blocked}
                    onChange={() => toggleSelected(scenario.id)}
                    aria-label={`${scenario.id} 테스트 선택`}
                  />
                  <code>{scenario.id}</code>
                  <div className="sheet-ti">
                    <strong>{scenario.title}</strong>
                    <span>{scenario.summary}</span>
                    {state && tone && (
                      <span className={`chip ${tone.tone}`}>
                        {tone.label}
                        {state.blockers.length > 0 &&
                          ` · ${[...new Set(state.blockers.map((blocker) => blockerLabels[blocker.reason]))].join(", ")}`}
                        {state.state === "data-required" && ` · ${state.missingBindings.length}개 값 필요`}
                      </span>
                    )}
                  </div>
                  <span className="metric" title={scenario.source}>
                    <Icon name="i-file-code" size="sm" />
                    {scenario.source.split("/").at(-1)}
                  </span>
                  <button
                    className="btn link"
                    type="button"
                    onClick={() => toggleExpanded(scenario.id)}
                    aria-expanded={expanded}
                    aria-controls={`steps-${scenario.id}`}
                  >
                    {scenario.steps.length} steps
                    <Icon name={expanded ? "i-up" : "i-down"} size="sm" />
                  </button>
                </div>

                {expanded && (
                  <div className="sheet-dt" id={`steps-${scenario.id}`}>
                    <p className="pre">
                      <b>사전 조건</b> · {scenario.precondition}
                    </p>
                    <ol>
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
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
