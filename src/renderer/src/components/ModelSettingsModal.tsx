import { useEffect, useId, useState } from "react";
import {
  Eye,
  EyeOff,
  KeyRound,
  LockKeyhole,
  Server,
  X,
} from "lucide-react";
import type { ModelSettings } from "../desktop";

type Props = {
  initialSettings: ModelSettings | null;
  hasSessionApiKey: boolean;
  onClose: () => void;
  onSave: (settings: ModelSettings, apiKey: string) => Promise<void>;
};

const endpointByProvider: Record<ModelSettings["provider"], string> = {
  "openai-compatible": "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com",
  custom: "",
};

const providerOptions: Array<{
  value: ModelSettings["provider"];
  label: string;
}> = [
  { value: "openai-compatible", label: "OpenAI 호환" },
  { value: "anthropic", label: "Anthropic" },
  { value: "custom", label: "사용자 지정" },
];

type Errors = Partial<Record<"endpoint" | "model" | "apiKey" | "submit", string>>;

function isHttpUrl(value: string) {
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

export function ModelSettingsModal({
  initialSettings,
  hasSessionApiKey,
  onClose,
  onSave,
}: Props) {
  const titleId = useId();
  const [provider, setProvider] = useState<ModelSettings["provider"]>(
    initialSettings?.provider ?? "openai-compatible",
  );
  const [endpoint, setEndpoint] = useState(
    initialSettings?.endpoint ?? endpointByProvider["openai-compatible"],
  );
  const [model, setModel] = useState(initialSettings?.model ?? "");
  const [apiKey, setApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [onClose]);

  function handleProviderChange(nextProvider: ModelSettings["provider"]) {
    setProvider(nextProvider);
    setEndpoint(endpointByProvider[nextProvider]);
    setErrors((current) => ({ ...current, endpoint: undefined }));
  }

  function validate(): Errors {
    const nextErrors: Errors = {};
    if (!isHttpUrl(endpoint)) {
      nextErrors.endpoint = "http 또는 https 엔드포인트를 입력하세요.";
    }
    if (!model.trim()) {
      nextErrors.model = "엔드포인트에서 사용할 모델 ID를 입력하세요.";
    }
    if (!apiKey.trim() && !hasSessionApiKey) {
      nextErrors.apiKey = "모델 호출에 사용할 API 키를 입력하세요.";
    }
    return nextErrors;
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = validate();
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    setSaving(true);
    try {
      await onSave(
        { provider, endpoint: endpoint.trim(), model: model.trim() },
        apiKey,
      );
    } catch {
      setErrors({ submit: "설정을 저장하지 못했습니다. 연결 정보를 확인하세요." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-layer" role="presentation">
      <section
        className="settings-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="modal-header">
          <div>
            <span className="eyebrow">MODEL CONNECTION</span>
            <h2 id={titleId}>LLM 연결 설정</h2>
            <p>소스 분석과 시나리오 도출에 사용할 모델을 연결합니다.</p>
          </div>
          <button
            className="icon-button"
            type="button"
            onClick={onClose}
            aria-label="설정 닫기"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </header>

        <form className="settings-form" onSubmit={handleSubmit} noValidate>
          <fieldset className="provider-fieldset">
            <legend>모델 공급자</legend>
            <div className="provider-options">
              {providerOptions.map((option) => (
                <label key={option.value}>
                  <input
                    type="radio"
                    name="provider"
                    value={option.value}
                    checked={provider === option.value}
                    onChange={() => handleProviderChange(option.value)}
                  />
                  <span>{option.label}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <label className="form-field">
            <span className="field-label">
              <Server size={15} aria-hidden="true" /> 엔드포인트
            </span>
            <input
              type="url"
              value={endpoint}
              onChange={(event) => setEndpoint(event.target.value)}
              aria-invalid={Boolean(errors.endpoint)}
              aria-describedby={errors.endpoint ? "endpoint-error" : undefined}
              spellCheck={false}
            />
            {errors.endpoint && (
              <span className="field-error" id="endpoint-error">
                {errors.endpoint}
              </span>
            )}
          </label>

          <label className="form-field">
            <span className="field-label">모델 ID</span>
            <input
              type="text"
              value={model}
              onChange={(event) => setModel(event.target.value)}
              placeholder="예: gpt-5"
              aria-invalid={Boolean(errors.model)}
              aria-describedby={errors.model ? "model-error" : undefined}
              autoComplete="off"
            />
            {errors.model && (
              <span className="field-error" id="model-error">
                {errors.model}
              </span>
            )}
          </label>

          <label className="form-field">
            <span className="field-label">
              <KeyRound size={15} aria-hidden="true" /> API 키
            </span>
            <span className="secret-input">
              <input
                type={showApiKey ? "text" : "password"}
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder={hasSessionApiKey ? "현재 세션 키 유지" : "API 키 입력"}
                aria-invalid={Boolean(errors.apiKey)}
                aria-describedby={errors.apiKey ? "api-key-error" : "key-storage-note"}
                autoComplete="off"
              />
              <button
                type="button"
                onClick={() => setShowApiKey((current) => !current)}
                aria-label={showApiKey ? "API 키 숨기기" : "API 키 표시"}
              >
                {showApiKey ? (
                  <EyeOff size={18} aria-hidden="true" />
                ) : (
                  <Eye size={18} aria-hidden="true" />
                )}
              </button>
            </span>
            {errors.apiKey && (
              <span className="field-error" id="api-key-error">
                {errors.apiKey}
              </span>
            )}
          </label>

          <div className="security-note" id="key-storage-note">
            <LockKeyhole size={17} aria-hidden="true" />
            <span>
              현재 목업에서는 API 키를 앱 세션 메모리에만 유지하며 프로젝트
              파일과 브라우저 저장소에는 기록하지 않습니다.
            </span>
          </div>

          {errors.submit && (
            <p className="form-error" role="alert">
              {errors.submit}
            </p>
          )}

          <footer className="modal-actions">
            <button className="ghost-action" type="button" onClick={onClose}>
              취소
            </button>
            <button className="modal-primary" type="submit" disabled={saving}>
              {saving ? "설정 저장 중" : "설정 저장"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
