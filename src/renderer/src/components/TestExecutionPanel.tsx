import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Play, ShieldAlert, X } from "lucide-react";
import type { ScenarioCase } from "../scenario-result";

type Props = {
  selectedScenarios: ScenarioCase[];
  previewFilled?: boolean;
  onClear: () => void;
  onRun: (targetUrl: string, personalData: Record<string, unknown>) => Promise<void>;
};

type ExecutionErrors = {
  url?: string;
  json?: string;
  submit?: string;
};

const exampleJson = `{
  "user": {
    "email": "tester@example.com",
    "password": "<TEST_SECRET_FROM_MEMORY>",
    "name": "테스트 사용자"
  },
  "payment": {
    "cardToken": "<TEST_TOKEN_FROM_MEMORY>"
  }
}`;

function isHttpUrl(value: string) {
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

export function TestExecutionPanel({
  selectedScenarios,
  previewFilled = false,
  onClear,
  onRun,
}: Props) {
  const [targetUrl, setTargetUrl] = useState(
    previewFilled ? "https://staging.example.com" : "",
  );
  const [personalData, setPersonalData] = useState(previewFilled ? exampleJson : "");
  const [showExample, setShowExample] = useState(false);
  const [errors, setErrors] = useState<ExecutionErrors>({});
  const [running, setRunning] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const selectedIds = useMemo(
    () => selectedScenarios.map((scenario) => scenario.id),
    [selectedScenarios],
  );

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors: ExecutionErrors = {};
    if (!isHttpUrl(targetUrl)) {
      nextErrors.url = "테스트할 http 또는 https URL을 입력하세요.";
    }

    let parsedData: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(personalData);
      if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw new Error();
      parsedData = parsed as Record<string, unknown>;
    } catch {
      nextErrors.json = "객체 형태의 올바른 JSON을 입력하세요.";
    }

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    setErrors({});
    setSubmitted(false);
    setRunning(true);
    try {
      await onRun(targetUrl, parsedData);
      setSubmitted(true);
    } catch {
      setErrors({ submit: "테스트 수행을 요청하지 못했습니다. 연결 상태를 확인하세요." });
    } finally {
      setRunning(false);
    }
  }

  return (
    <aside className="test-execution-panel" aria-labelledby="test-panel-title">
      <header className="test-panel-header">
        <div>
          <span className="eyebrow">TEST EXECUTION</span>
          <h2 id="test-panel-title">테스트 수행 설정</h2>
          <p>{selectedScenarios.length}개 시나리오 선택</p>
        </div>
        <button className="icon-button" type="button" onClick={onClear} aria-label="테스트 설정 닫기">
          <X size={19} aria-hidden="true" />
        </button>
      </header>

      <div className="selected-case-list" aria-label="선택한 시나리오">
        {selectedIds.map((id) => (
          <code key={id}>{id}</code>
        ))}
      </div>

      <form className="test-config-form" onSubmit={handleSubmit} noValidate>
        <label className="form-field">
          <span className="field-label">테스트 URL</span>
          <input
            type="url"
            value={targetUrl}
            onChange={(event) => setTargetUrl(event.target.value)}
            placeholder="https://staging.example.com"
            aria-invalid={Boolean(errors.url)}
          />
          {errors.url && <span className="field-error">{errors.url}</span>}
        </label>

        <label className="form-field json-field">
          <span className="field-label">필요 개인정보 JSON</span>
          <textarea
            value={personalData}
            onChange={(event) => setPersonalData(event.target.value)}
            placeholder={'{\n  "user": { }\n}'}
            rows={10}
            spellCheck={false}
            aria-invalid={Boolean(errors.json)}
          />
          {errors.json && <span className="field-error">{errors.json}</span>}
        </label>

        <button
          className="example-toggle"
          type="button"
          onClick={() => setShowExample((current) => !current)}
          aria-expanded={showExample}
        >
          JSON 구성 예시는 <strong>확인하세요</strong>
          {showExample ? <ChevronUp size={15} aria-hidden="true" /> : <ChevronDown size={15} aria-hidden="true" />}
        </button>

        {showExample && (
          <div className="json-example">
            <code>{exampleJson}</code>
            <button type="button" onClick={() => setPersonalData(exampleJson)}>
              입력에 적용
            </button>
          </div>
        )}

        <div className="privacy-warning">
          <ShieldAlert size={17} aria-hidden="true" />
          <span>실제 개인정보가 아닌 테스트 전용 값만 입력하세요.</span>
        </div>

        {submitted && (
          <p className="execution-ready" role="status">
            선택한 시나리오의 테스트 수행을 요청했습니다.
          </p>
        )}

        {errors.submit && (
          <p className="form-error" role="alert">
            {errors.submit}
          </p>
        )}

        <div className="test-panel-actions">
          <button className="ghost-action" type="button" onClick={onClear}>
            선택 해제
          </button>
          <button className="test-run-action" type="submit" disabled={running}>
            <Play size={17} aria-hidden="true" />
            {running ? "테스트 준비 중" : `${selectedScenarios.length}개 테스트 수행`}
          </button>
        </div>
      </form>
    </aside>
  );
}
