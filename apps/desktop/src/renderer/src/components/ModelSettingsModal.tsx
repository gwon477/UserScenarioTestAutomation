import { useEffect, useId, useState } from "react";
import type { ModelSettings } from "../desktop";
import { Icon } from "./Icon";

/* LLM 연결 설정. 목업 S3(온보딩 2단계)·S13(전역 설정)과 같은 폼이다.
 *
 * 저장된 키는 되읽지 않는다. 유지 상태와 마스킹된 표시만 보여준다. */

type Props = {
  initialSettings: ModelSettings | null;
  hasSessionApiKey: boolean;
  hasSessionReviewerApiKey: boolean;
  secureStorageAvailable: boolean;
  onClose: () => void;
  onSave: (settings: ModelSettings, apiKey: string, reviewerApiKey: string) => Promise<void>;
  onClearCredentials: () => Promise<void>;
};

const endpointByProvider: Record<ModelSettings["provider"], string> = {
  "openai-compatible": "https://api.openai.com/v1",
  "azure-openai": "",
  anthropic: "https://api.anthropic.com",
  custom: "",
};

const providerOptions: Array<{
  value: ModelSettings["provider"];
  label: string;
}> = [
  { value: "openai-compatible", label: "OpenAI 호환" },
  { value: "azure-openai", label: "Azure OpenAI" },
  { value: "anthropic", label: "Anthropic" },
  { value: "custom", label: "사용자 지정" },
];

type Errors = Partial<Record<"endpoint" | "model" | "apiVersion" | "apiKey" | "consent" | "reviewerEndpoint" | "reviewerModel" | "reviewerApiVersion" | "reviewerApiKey" | "reviewerConsent" | "submit", string>>;

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
  hasSessionReviewerApiKey,
  secureStorageAvailable,
  onClose,
  onSave,
  onClearCredentials,
}: Props) {
  const titleId = useId();
  const [provider, setProvider] = useState<ModelSettings["provider"]>(
    initialSettings?.provider ?? "openai-compatible",
  );
  const [endpoint, setEndpoint] = useState(
    initialSettings?.endpoint ?? endpointByProvider["openai-compatible"],
  );
  const [model, setModel] = useState(initialSettings?.model ?? "");
  const [apiVersion, setApiVersion] = useState(initialSettings?.apiVersion ?? "2024-12-01-preview");
  const [apiKey, setApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [dataPolicyAccepted, setDataPolicyAccepted] = useState(initialSettings?.dataPolicyAccepted ?? false);
  const [reviewerEnabled, setReviewerEnabled] = useState(Boolean(initialSettings?.reviewer));
  const [reviewerProvider, setReviewerProvider] = useState<ModelSettings["provider"]>(initialSettings?.reviewer?.provider ?? "openai-compatible");
  const [reviewerEndpoint, setReviewerEndpoint] = useState(initialSettings?.reviewer?.endpoint ?? endpointByProvider["openai-compatible"]);
  const [reviewerModel, setReviewerModel] = useState(initialSettings?.reviewer?.model ?? "");
  const [reviewerApiVersion, setReviewerApiVersion] = useState(initialSettings?.reviewer?.apiVersion ?? "2024-12-01-preview");
  const [reviewerApiKey, setReviewerApiKey] = useState("");
  const [showReviewerApiKey, setShowReviewerApiKey] = useState(false);
  const [reviewerDataPolicyAccepted, setReviewerDataPolicyAccepted] = useState(initialSettings?.reviewer?.dataPolicyAccepted ?? false);
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);

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
    setErrors((current) => ({ ...current, endpoint: undefined, apiVersion: undefined }));
  }

  function handleReviewerProviderChange(nextProvider: ModelSettings["provider"]) {
    setReviewerProvider(nextProvider);
    setReviewerEndpoint(endpointByProvider[nextProvider]);
    setErrors((current) => ({ ...current, reviewerEndpoint: undefined, reviewerApiVersion: undefined }));
  }

  function validate(): Errors {
    const nextErrors: Errors = {};
    if (!isHttpUrl(endpoint)) {
      nextErrors.endpoint = "http 또는 https 엔드포인트를 입력하세요.";
    }
    if (!model.trim()) {
      nextErrors.model = provider === "azure-openai" ? "Azure deployment 이름을 입력하세요." : "엔드포인트에서 사용할 모델 ID를 입력하세요.";
    }
    if (provider === "azure-openai" && !apiVersion.trim()) nextErrors.apiVersion = "Azure OpenAI API Version을 입력하세요.";
    if (!apiKey.trim() && !hasSessionApiKey) {
      nextErrors.apiKey = "모델 호출에 사용할 API 키를 입력하세요.";
    }
    if (!dataPolicyAccepted) nextErrors.consent = "선택한 모델 엔드포인트로 근거 슬라이스가 전송되는 것에 동의해야 합니다.";
    if (reviewerEnabled) {
      if (!isHttpUrl(reviewerEndpoint)) nextErrors.reviewerEndpoint = "reviewer의 http 또는 https 엔드포인트를 입력하세요.";
      if (!reviewerModel.trim()) nextErrors.reviewerModel = reviewerProvider === "azure-openai" ? "reviewer Azure deployment 이름을 입력하세요." : "reviewer 모델 ID를 입력하세요.";
      if (reviewerProvider === "azure-openai" && !reviewerApiVersion.trim()) nextErrors.reviewerApiVersion = "Reviewer Azure OpenAI API Version을 입력하세요.";
      if (!reviewerApiKey.trim() && !hasSessionReviewerApiKey) nextErrors.reviewerApiKey = "reviewer API 키를 입력하세요.";
      if (!reviewerDataPolicyAccepted) nextErrors.reviewerConsent = "reviewer endpoint로 검토 근거가 전송되는 것에 동의해야 합니다.";
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
        {
          provider, endpoint: endpoint.trim(), model: model.trim(), ...(provider === "azure-openai" ? { apiVersion: apiVersion.trim() } : {}), dataPolicyAccepted,
          ...(reviewerEnabled ? { reviewer: { provider: reviewerProvider, endpoint: reviewerEndpoint.trim(), model: reviewerModel.trim(), ...(reviewerProvider === "azure-openai" ? { apiVersion: reviewerApiVersion.trim() } : {}), dataPolicyAccepted: reviewerDataPolicyAccepted } } : {}),
        },
        apiKey,
        reviewerApiKey,
      );
    } catch {
      setErrors({ submit: "설정을 저장하지 못했습니다. 연결 정보를 확인하세요." });
    } finally {
      setSaving(false);
    }
  }

  async function handleClearCredentials() {
    setClearing(true);
    try {
      await onClearCredentials();
      setApiKey("");
      setReviewerApiKey("");
      setErrors({});
    } catch {
      setErrors({ submit: "저장된 API 키를 삭제하지 못했습니다." });
    } finally {
      setClearing(false);
    }
  }

  return (
    <div className="scrim" role="presentation">
      <section className="dialog lg" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="dialog-h">
          <div>
            <span className="eyebrow" style={{ margin: 0 }}>
              MODEL CONNECTION
            </span>
            <h2 style={{ marginTop: 3 }} id={titleId}>
              LLM 연결 설정
            </h2>
          </div>
          <span className="end">
            <button className="btn icon sm" type="button" onClick={onClose} aria-label="설정 닫기">
              <Icon name="i-x" size="sm" />
            </button>
          </span>
        </div>

        <form className="dialog-s" onSubmit={handleSubmit} noValidate id="model-settings-form">
          <p className="sub" style={{ fontSize: 12.5, marginBottom: 16 }}>
            소스 분석과 시나리오 도출에 쓰는 author 모델입니다. 의미 판정을 분리하려면 독립
            reviewer 를 함께 연결합니다. 모든 프로젝트가 이 연결을 공유합니다.
          </p>

          <fieldset className="fs">
            <legend>모델 공급자</legend>
            <div className="opts">
              {providerOptions.map((option) => (
                <label className={`opt${provider === option.value ? " on" : ""}`} key={option.value}>
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

          <label className="field">
            <span className="lb">
              <Icon name="i-server" size="sm" />
              엔드포인트
            </span>
            <input
              className="inp mono"
              type="url"
              value={endpoint}
              onChange={(event) => setEndpoint(event.target.value)}
              aria-invalid={Boolean(errors.endpoint)}
              aria-describedby={errors.endpoint ? "endpoint-error" : undefined}
              spellCheck={false}
            />
            {errors.endpoint && (
              <span className="err" id="endpoint-error">
                <Icon name="i-alert" />
                {errors.endpoint}
              </span>
            )}
          </label>

          {provider === "azure-openai" && (
            <label className="field">
              <span className="lb">API Version</span>
              <input
                className="inp mono"
                type="text"
                value={apiVersion}
                onChange={(event) => setApiVersion(event.target.value)}
                placeholder="예: 2024-12-01-preview"
                aria-invalid={Boolean(errors.apiVersion)}
                autoComplete="off"
              />
              {errors.apiVersion && (
                <span className="err">
                  <Icon name="i-alert" />
                  {errors.apiVersion}
                </span>
              )}
            </label>
          )}

          <label className="field">
            <span className="lb">{provider === "azure-openai" ? "Deployment 이름" : "모델 ID"}</span>
            <input
              className="inp mono"
              type="text"
              value={model}
              onChange={(event) => setModel(event.target.value)}
              placeholder={provider === "azure-openai" ? "예: gpt-4.1" : "예: gpt-5"}
              aria-invalid={Boolean(errors.model)}
              aria-describedby={errors.model ? "model-error" : undefined}
              autoComplete="off"
            />
            <span className="hint">
              Azure 를 선택하면 이 항목이 Deployment 이름과 API Version 으로 바뀝니다.
            </span>
            {errors.model && (
              <span className="err" id="model-error">
                <Icon name="i-alert" />
                {errors.model}
              </span>
            )}
          </label>

          <label className="field">
            <span className="lb">
              <Icon name="i-key" size="sm" />
              API 키
            </span>
            <span className="inp-wrap">
              <input
                className="inp"
                style={{ paddingRight: 38 }}
                type={showApiKey ? "text" : "password"}
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder={hasSessionApiKey ? "저장된 API 키 유지" : "API 키 입력"}
                aria-invalid={Boolean(errors.apiKey)}
                aria-describedby={errors.apiKey ? "api-key-error" : "key-storage-note"}
                autoComplete="off"
              />
              <button
                className="btn icon"
                type="button"
                onClick={() => setShowApiKey((current) => !current)}
                aria-label={showApiKey ? "API 키 숨기기" : "API 키 표시"}
              >
                <Icon name={showApiKey ? "i-eye-off" : "i-eye"} />
              </button>
            </span>
            {errors.apiKey && (
              <span className="err" id="api-key-error">
                <Icon name="i-alert" />
                {errors.apiKey}
              </span>
            )}
          </label>

          <div className={`notice${secureStorageAvailable ? "" : " warn"}`} id="key-storage-note">
            <Icon name="i-lock" size="sm" />
            <div>
              {secureStorageAvailable
                ? "API 키는 운영체제 보호 저장소에 암호화합니다. 프로젝트 파일과 브라우저 저장소에는 기록하지 않습니다."
                : "운영체제 보호 저장소를 사용할 수 없어 API 키를 현재 앱 세션 메모리에만 유지합니다."}
              {(hasSessionApiKey || hasSessionReviewerApiKey) && (
                <div className="cta-row" style={{ marginTop: 8 }}>
                  <button
                    className="btn ghost sm"
                    type="button"
                    onClick={() => void handleClearCredentials()}
                    disabled={clearing}
                  >
                    <Icon name="i-trash" size="sm" />
                    {clearing ? "저장된 키 삭제 중" : "저장된 키 삭제"}
                  </button>
                </div>
              )}
            </div>
          </div>

          <label className="cbx" style={{ marginTop: 12 }}>
            <input
              type="checkbox"
              checked={dataPolicyAccepted}
              onChange={(event) => setDataPolicyAccepted(event.target.checked)}
            />
            <span>
              선택한 원격 엔드포인트로 작업에 필요한 소스 근거 슬라이스가 전송될 수 있음을
              확인했습니다.
              {errors.consent && (
                <span className="err">
                  <Icon name="i-alert" />
                  {errors.consent}
                </span>
              )}
            </span>
          </label>

          <label
            className="cbx"
            style={{ borderTop: "1px solid var(--line)", marginTop: 6, paddingTop: 14 }}
          >
            <input
              type="checkbox"
              checked={reviewerEnabled}
              onChange={(event) => setReviewerEnabled(event.target.checked)}
            />
            <span>
              <strong id="reviewer-role-title">독립 reviewer 사용</strong>
              <small>
                별도 모델이 FACT·WIKI·SCENARIO 의 의미 판정만 수행합니다. 켜면 reviewer 전용
                엔드포인트·키·동의 항목이 추가됩니다.
              </small>
            </span>
          </label>

          {reviewerEnabled && (
            <section className="fs" aria-labelledby="reviewer-role-title" style={{ marginTop: 12 }}>
              <fieldset style={{ marginBottom: 14 }}>
                <legend className="lb">Reviewer 공급자</legend>
                <div className="opts">
                  {providerOptions.map((option) => (
                    <label
                      className={`opt${reviewerProvider === option.value ? " on" : ""}`}
                      key={`reviewer-${option.value}`}
                    >
                      <input
                        type="radio"
                        name="reviewer-provider"
                        value={option.value}
                        checked={reviewerProvider === option.value}
                        onChange={() => handleReviewerProviderChange(option.value)}
                      />
                      <span>{option.label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <label className="field">
                <span className="lb">
                  <Icon name="i-server" size="sm" />
                  Reviewer 엔드포인트
                </span>
                <input
                  className="inp mono"
                  type="url"
                  value={reviewerEndpoint}
                  onChange={(event) => setReviewerEndpoint(event.target.value)}
                  aria-invalid={Boolean(errors.reviewerEndpoint)}
                  spellCheck={false}
                />
                {errors.reviewerEndpoint && (
                  <span className="err">
                    <Icon name="i-alert" />
                    {errors.reviewerEndpoint}
                  </span>
                )}
              </label>

              {reviewerProvider === "azure-openai" && (
                <label className="field">
                  <span className="lb">Reviewer API Version</span>
                  <input
                    className="inp mono"
                    type="text"
                    value={reviewerApiVersion}
                    onChange={(event) => setReviewerApiVersion(event.target.value)}
                    placeholder="예: 2024-12-01-preview"
                    aria-invalid={Boolean(errors.reviewerApiVersion)}
                    autoComplete="off"
                  />
                  {errors.reviewerApiVersion && (
                    <span className="err">
                      <Icon name="i-alert" />
                      {errors.reviewerApiVersion}
                    </span>
                  )}
                </label>
              )}

              <label className="field">
                <span className="lb">
                  {reviewerProvider === "azure-openai" ? "Reviewer deployment 이름" : "Reviewer 모델 ID"}
                </span>
                <input
                  className="inp mono"
                  type="text"
                  value={reviewerModel}
                  onChange={(event) => setReviewerModel(event.target.value)}
                  aria-invalid={Boolean(errors.reviewerModel)}
                  autoComplete="off"
                />
                {errors.reviewerModel && (
                  <span className="err">
                    <Icon name="i-alert" />
                    {errors.reviewerModel}
                  </span>
                )}
              </label>

              <label className="field">
                <span className="lb">
                  <Icon name="i-key" size="sm" />
                  Reviewer API 키
                </span>
                <span className="inp-wrap">
                  <input
                    className="inp"
                    style={{ paddingRight: 38 }}
                    type={showReviewerApiKey ? "text" : "password"}
                    value={reviewerApiKey}
                    onChange={(event) => setReviewerApiKey(event.target.value)}
                    placeholder={
                      hasSessionReviewerApiKey ? "저장된 reviewer API 키 유지" : "Reviewer API 키 입력"
                    }
                    aria-invalid={Boolean(errors.reviewerApiKey)}
                    autoComplete="off"
                  />
                  <button
                    className="btn icon"
                    type="button"
                    onClick={() => setShowReviewerApiKey((current) => !current)}
                    aria-label={showReviewerApiKey ? "Reviewer API 키 숨기기" : "Reviewer API 키 표시"}
                  >
                    <Icon name={showReviewerApiKey ? "i-eye-off" : "i-eye"} />
                  </button>
                </span>
                {errors.reviewerApiKey && (
                  <span className="err">
                    <Icon name="i-alert" />
                    {errors.reviewerApiKey}
                  </span>
                )}
              </label>

              <label className="cbx" style={{ marginBottom: 0 }}>
                <input
                  type="checkbox"
                  checked={reviewerDataPolicyAccepted}
                  onChange={(event) => setReviewerDataPolicyAccepted(event.target.checked)}
                />
                <span>
                  reviewer endpoint 로 검토 대상과 근거 슬라이스가 전송될 수 있음을 확인했습니다.
                  {errors.reviewerConsent && (
                    <span className="err">
                      <Icon name="i-alert" />
                      {errors.reviewerConsent}
                    </span>
                  )}
                </span>
              </label>
            </section>
          )}

          {errors.submit && (
            <p className="cta-why" style={{ marginTop: 12 }} role="alert">
              <Icon name="i-alert" size="sm" />
              {errors.submit}
            </p>
          )}
        </form>

        <div className="acts">
          <button className="btn" type="button" onClick={onClose}>
            취소
          </button>
          <button className="btn pri" type="submit" form="model-settings-form" disabled={saving}>
            {saving ? "설정 저장 중" : "설정 저장"}
          </button>
        </div>
      </section>
    </div>
  );
}
