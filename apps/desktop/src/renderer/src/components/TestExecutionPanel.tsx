import { useMemo, useRef, useState } from "react";
import type { TestExecutionAcceptance } from "../../../shared/desktop-api";
import type {
  ScenarioBlockerReason,
  TestExecutionRequirements,
} from "../../../shared/test-requirements";
import type { ScenarioCase } from "../scenario-result";
import { Icon } from "./Icon";

/* 폼은 손으로 설계하지 않는다. main 이 정본 artifact 에서 도출한 요구사항이
 * 필드 목록을 결정한다. 계약은 docs/screens/04-scenario-results.md 를 따른다. */

type RequestPhase = "idle" | "validating" | "environment" | "planning" | "queued";

type Props = {
  selectedScenarios: ScenarioCase[];
  requirements: TestExecutionRequirements | null;
  requirementsError?: string;
  /* 활성 실행이 있으면 새 실행을 만들지 않고 그 뒤에 batch 를 붙인다.
   * target profile 은 기존 실행 값을 그대로 쓴다. */
  activeExecution?: { executionId: string; targetUrl: string };
  onClear: () => void;
  onRun: (input: {
    targetUrl: string;
    dataBindings: Record<string, string>;
    maskElementRefs: string[];
    destructiveAllowed: boolean;
  }) => Promise<TestExecutionAcceptance>;
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

const phaseLabels: Record<Exclude<RequestPhase, "idle">, string> = {
  validating: "요청 검증 중",
  environment: "환경 확인 중",
  planning: "실행 계획 준비 중",
  queued: "대기열 등록",
};

const stageLabels: Record<Extract<TestExecutionAcceptance, { outcome: "rejected" }>["stage"], string> = {
  request: "요청 검증",
  environment: "환경 확인",
  planning: "실행 계획",
};

/* 거절 사유 문구. 코드는 main 이 주고 문구는 renderer 가 소유한다. */
const rejectionLabels: Record<string, string> = {
  PROJECT_OR_RUN_INVALID: "프로젝트 또는 생성 이력이 올바르지 않습니다",
  SCENARIO_SELECTION_EMPTY: "선택한 시나리오가 없습니다",
  SCENARIO_SELECTION_NOT_IN_RUN: "선택한 시나리오가 이 생성 이력에 없습니다",
  TARGET_ENTRY_INVALID: "대상 진입 URL이 올바르지 않습니다",
  NO_RUNNABLE_SCENARIO: "실행 가능한 케이스가 없습니다",
  DATA_BINDING_MISSING: "테스트 데이터가 비어 있습니다",
  MASK_TARGET_OMITTED: "가려야 할 대상이 빠졌습니다",
  MASK_TARGET_NOT_DECLARED: "선언되지 않은 마스킹 대상입니다",
  DESTRUCTIVE_NOT_ALLOWED: "되돌릴 수 없는 동작 허용이 필요합니다",
  EXECUTION_RUNNER_NOT_IMPLEMENTED: "수행 실행기가 아직 연결되지 않았습니다",
  DESKTOP_BRIDGE_UNAVAILABLE: "데스크톱 앱에서만 실행할 수 있습니다",
  SCENARIO_ARTIFACT_HASH_MISMATCH: "시나리오 산출물이 등록된 해시와 다릅니다",
  FACT_ARTIFACT_HASH_MISMATCH: "FACT 산출물이 등록된 해시와 다릅니다",
  SCENARIO_ARTIFACT_NOT_CANONICAL: "시나리오 산출물이 정본으로 등록되지 않았습니다",
  FACT_ARTIFACT_NOT_CANONICAL: "FACT 산출물이 정본으로 등록되지 않았습니다",
  REQUEST_FAILED: "요청을 전달하지 못했습니다",
};

const targetKinds = [
  { id: "web", label: "웹", available: true, reason: "" },
  { id: "windows", label: "Windows 앱", available: false, reason: "수행 어댑터 미구현" },
  { id: "android", label: "Android", available: false, reason: "수행 어댑터 미구현" },
  { id: "ios", label: "iOS", available: false, reason: "수행 어댑터 미구현" },
  { id: "remote", label: "원격 화면", available: false, reason: "수행 어댑터 미구현" },
] as const;

function isHttpUrl(value: string) {
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

/** FACT element type 에서 입력 컨트롤을 고른다. 없는 타입은 단일행 텍스트다. */
function controlFor(controlKind: string, secret: boolean): "password" | "file" | "text" {
  if (secret) return "password";
  if (controlKind === "file-upload") return "file";
  return "text";
}

export function TestExecutionPanel({
  selectedScenarios,
  requirements,
  requirementsError,
  activeExecution,
  onClear,
  onRun,
}: Props) {
  const [targetUrl, setTargetUrl] = useState(activeExecution?.targetUrl ?? "");
  const [values, setValues] = useState<Record<string, string>>({});
  const [destructiveAllowed, setDestructiveAllowed] = useState(false);
  // 기존 실행에 붙이는 경우 환경은 이미 확인된 상태다.
  const [environmentChecked, setEnvironmentChecked] = useState(activeExecution !== undefined);
  const [budgetOpen, setBudgetOpen] = useState(false);
  const [urlError, setUrlError] = useState<string | undefined>(undefined);
  const [rejection, setRejection] = useState<Extract<TestExecutionAcceptance, { outcome: "rejected" }> | undefined>(undefined);
  const [phase, setPhase] = useState<RequestPhase>("idle");
  const targetUrlRef = useRef<HTMLInputElement>(null);

  const dataBindings = requirements?.dataBindings ?? [];
  const maskDefaults = requirements?.maskDefaults ?? [];
  const blockedScenarios = useMemo(
    () => (requirements?.scenarios ?? []).filter((entry) => entry.blockers.length > 0),
    [requirements],
  );
  const unfilled = dataBindings.filter((field) => !(values[field.bindingKey] ?? "").trim());
  const runnableCount = useMemo(() => {
    if (!requirements) return 0;
    return requirements.scenarios.filter(
      (entry) =>
        entry.blockers.length === 0 &&
        entry.missingBindings.every((key) => (values[key] ?? "").trim().length > 0),
    ).length;
  }, [requirements, values]);

  const blocking =
    requirementsError !== undefined
      ? "정본 산출물에서 요구사항을 읽지 못했습니다."
      : requirements === null
        ? "요구사항을 불러오는 중입니다."
        : runnableCount === 0
          ? "실행 가능한 케이스가 없습니다."
          : !isHttpUrl(targetUrl)
            ? "대상 진입 URL을 입력하세요."
            : !environmentChecked
              ? "환경 확인을 먼저 실행하세요."
              : unfilled.length > 0
                ? `테스트 데이터 ${unfilled.length}개가 비어 있습니다.`
                : undefined;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isHttpUrl(targetUrl)) {
      setUrlError("테스트할 http 또는 https URL을 입력하세요.");
      window.requestAnimationFrame(() => targetUrlRef.current?.focus());
      return;
    }
    if (blocking) return;

    setUrlError(undefined);
    setRejection(undefined);
    setPhase("validating");
    try {
      const acceptance = await onRun({
        targetUrl,
        dataBindings: Object.fromEntries(dataBindings.map((field) => [field.bindingKey, values[field.bindingKey] ?? ""])),
        maskElementRefs: maskDefaults.map((mask) => mask.elementRef),
        destructiveAllowed,
      });
      if (acceptance.outcome === "queued") {
        setPhase("queued");
        return;
      }
      setPhase("idle");
      setRejection(acceptance);
    } catch {
      setPhase("idle");
      setRejection({ outcome: "rejected", stage: "request", code: "REQUEST_FAILED" });
    }
  }

  return (
    <aside className="panel drawer" aria-labelledby="test-panel-title">
      <div className="panel-h">
        <div>
          <span className="eyebrow" style={{ margin: 0 }}>
            TEST EXECUTION
          </span>
          <h2 className="h3" style={{ marginTop: 3 }} id="test-panel-title">
            테스트 수행 설정
          </h2>
        </div>
        <span className="end">
          <button className="btn icon sm" type="button" onClick={onClear} aria-label="테스트 설정 닫기">
            <Icon name="i-x" size="sm" />
          </button>
        </span>
      </div>

      <form className="panel-s" style={{ padding: 16 }} onSubmit={handleSubmit} noValidate aria-busy={phase !== "idle"} id="test-config-form">
        <p className="sub" style={{ fontSize: 12, marginBottom: 10 }}>
          {selectedScenarios.length}건 선택
          {requirements ? ` · 실행 가능 ${runnableCount}건` : ""}
          {activeExecution ? " · 활성 실행에 추가" : ""}
        </p>

        {requirementsError !== undefined && (
          <p className="cta-why" style={{ marginBottom: 12 }} role="alert">
            <Icon name="i-alert" size="sm" />
            정본 산출물에서 실행 요구사항을 읽지 못했습니다. 생성 이력과 저장 상태를 확인하세요.
          </p>
        )}

        {blockedScenarios.length > 0 && (
          <div className="diag" style={{ marginBottom: 16 }} role="status">
            <p>
              <Icon name="i-alert" size="sm" />
              자동화할 수 없는 케이스 {blockedScenarios.length}개
            </p>
            {blockedScenarios.map((entry) =>
              entry.blockers.map((blocker) => (
                <div className="asrt" key={`${entry.scenarioId}-${blocker.stepId}-${blocker.reason}`}>
                  <code>{entry.scenarioId}</code>
                  <span className="chip bad">{blockerLabels[blocker.reason]}</span>
                  <span className="path">{blocker.stepId}</span>
                </div>
              )),
            )}
          </div>
        )}

        <fieldset className="fs">
          <legend>대상 유형</legend>
          <div className="opts">
            {targetKinds.map((kind) => (
              <label className={`opt${kind.id === "web" ? " on" : kind.available ? "" : " off"}`} key={kind.id}>
                <input
                  type="radio"
                  name="target-kind"
                  value={kind.id}
                  defaultChecked={kind.id === "web"}
                  disabled={!kind.available}
                />
                <span>{kind.label}</span>
                {!kind.available && <small>{kind.reason}</small>}
              </label>
            ))}
          </div>
        </fieldset>

        <label className="field">
          <span className="lb">대상 진입 URL</span>
          <input
            className="inp mono"
            ref={targetUrlRef}
            type="url"
            readOnly={activeExecution !== undefined}
            value={targetUrl}
            onChange={(event) => {
              setTargetUrl(event.target.value);
              setUrlError(undefined);
              setEnvironmentChecked(false);
            }}
            placeholder="https://staging.example.com"
            aria-invalid={Boolean(urlError)}
            aria-describedby={urlError ? "test-url-error" : undefined}
          />
          {urlError && (
            <span className="err" id="test-url-error" role="alert">
              <Icon name="i-alert" />
              {urlError}
            </span>
          )}
        </label>

        {/* 환경 확인은 URL 형식만 본다. 대상 접속 자체는 실행 시점에 검증한다. */}
        <div className={`card flat envcheck${environmentChecked ? " ok" : ""}`}>
          <Icon name={environmentChecked ? "i-check" : "i-help"} size="sm" />
          <span role="status">
            {environmentChecked
              ? "URL 형식 확인 완료 · 웹 비전 경로 사용 · 대상 접속은 실행 시 검증"
              : "대상 진입 정보를 입력한 뒤 확인하세요."}
          </span>
          <button
            className="btn sm"
            type="button"
            disabled={!isHttpUrl(targetUrl)}
            onClick={() => setEnvironmentChecked(true)}
          >
            {environmentChecked ? "다시 확인" : "환경 확인"}
          </button>
        </div>

        {dataBindings.length > 0 && (
          <fieldset className="fs">
            <legend>
              <Icon name="i-key" size="sm" />
              테스트 데이터
            </legend>
            <p className="note">
              정본 FACT 근거에서 도출한 항목입니다. 실제 개인정보가 아닌 테스트 전용 값만 입력하세요.
            </p>
            {dataBindings.map((field, index) => {
              const control = controlFor(field.controlKind, field.secret);
              const inputId = `binding-${field.bindingKey}`;
              const empty = !(values[field.bindingKey] ?? "").trim();
              return (
                <label
                  className="field"
                  style={{ marginBottom: index === dataBindings.length - 1 ? 0 : 10 }}
                  key={field.bindingKey}
                  htmlFor={inputId}
                >
                  <span className="lb">
                    {field.secret && <Icon name="i-lock" size="sm" />}
                    {field.label}
                  </span>
                  <input
                    className="inp"
                    id={inputId}
                    type={control === "password" ? "password" : control === "file" ? "file" : "text"}
                    autoComplete="off"
                    value={control === "file" ? undefined : values[field.bindingKey] ?? ""}
                    onChange={(event) =>
                      setValues((current) => ({ ...current, [field.bindingKey]: event.target.value }))
                    }
                  />
                  <span className="hint">
                    {field.usedBy.map((use) => use.stepId).join(", ")}
                    {field.secret ? " · 참조만 저장됩니다" : ""}
                  </span>
                  {empty && field.usedBy.length > 0 && (
                    <span className="err">
                      <Icon name="i-alert" />
                      이 값이 없으면 {[...new Set(field.usedBy.map((use) => use.scenarioId))].join(", ")}을 실행할 수 없습니다.
                    </span>
                  )}
                </label>
              );
            })}
          </fieldset>
        )}

        {maskDefaults.length > 0 && (
          <fieldset className="fs">
            <legend>
              <Icon name="sf-mask" size="sm" />
              마스킹 대상 · 필수
            </legend>
            <p className="note">
              아래 항목은 화면 캡처에서 가려진 뒤 전송됩니다. 가리지 못하면 실행이 중단됩니다.
            </p>
            {maskDefaults.map((mask) => (
              <label className="cbx" style={{ minHeight: 32 }} key={mask.elementRef}>
                {/* 마스킹은 끌 수 없다. 켜져 있음을 보여주기만 한다. */}
                <input type="checkbox" checked disabled readOnly aria-label={`${mask.label} 마스킹 (해제 불가)`} />
                <span>
                  {mask.label} <code>{mask.screenId}</code>
                </span>
              </label>
            ))}
          </fieldset>
        )}

        {requirements?.hasDestructiveStep && (
          <label className="cbx danger" style={{ marginBottom: 14 }}>
            <input
              type="checkbox"
              checked={destructiveAllowed}
              onChange={(event) => setDestructiveAllowed(event.target.checked)}
            />
            <span>
              되돌릴 수 없는 동작을 허용합니다
              <small>선택한 케이스에 되돌릴 수 없는 단계가 포함되어 있습니다.</small>
            </span>
          </label>
        )}

        {requirements && (
          <>
            <button
              className="btn ghost sm"
              style={{ marginBottom: 8 }}
              type="button"
              onClick={() => setBudgetOpen((current) => !current)}
              aria-expanded={budgetOpen}
            >
              실행 예산 보기
              <Icon name={budgetOpen ? "i-up" : "i-down"} size="sm" />
            </button>
            {budgetOpen && (
              <dl className="kv">
                <div>
                  <dt>모델 호출 상한</dt>
                  <dd>단계당 {requirements.budgetDefaults.maxModelCalls}회</dd>
                </div>
                <div>
                  <dt>관측 상한</dt>
                  <dd>단계당 {requirements.budgetDefaults.maxScreenshots}회</dd>
                </div>
                <div>
                  <dt>단계 제한 시간</dt>
                  <dd>{Math.round(requirements.budgetDefaults.timeoutMs / 1000)}초</dd>
                </div>
              </dl>
            )}
          </>
        )}

        {phase !== "idle" && (
          <p className="notice" style={{ marginTop: 12 }} role="status">
            <Icon name="i-loader" size="sm" />
            <span>{phaseLabels[phase]}</span>
          </p>
        )}

        {rejection && (
          <p className="cta-why" style={{ marginTop: 12 }} role="alert">
            <Icon name="i-alert" size="sm" />
            {stageLabels[rejection.stage]}에서 거절됨 · {rejectionLabels[rejection.code] ?? rejection.code}
            {rejection.detail ? ` (${rejection.detail})` : ""}
          </p>
        )}
      </form>

      <div className="panel-f" style={{ flexDirection: "column", alignItems: "stretch", gap: 8, padding: "12px 16px" }}>
        <button
          className="btn pri"
          type="submit"
          form="test-config-form"
          disabled={Boolean(blocking) || phase !== "idle"}
        >
          <Icon name="i-play" />
          {phase === "idle"
            ? activeExecution
              ? `대기열에 ${runnableCount}개 추가`
              : `${runnableCount}개 테스트 수행`
            : phaseLabels[phase]}
        </button>
        {blocking && (
          <span className="cta-why">
            <Icon name="i-alert" size="sm" />
            {blocking}
          </span>
        )}
      </div>
    </aside>
  );
}
