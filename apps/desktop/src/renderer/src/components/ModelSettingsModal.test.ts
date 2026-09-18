import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Azure OpenAI model settings", () => {
  it("exposes Azure provider and API version fields for author and reviewer roles", async () => {
    const source = await readFile(new URL("./ModelSettingsModal.tsx", import.meta.url), "utf8");

    expect(source).toContain('{ value: "azure-openai", label: "Azure OpenAI" }');
    expect(source).toContain("API Version");
    expect(source).toContain("Reviewer API Version");
    expect(source).toContain("apiVersion: apiVersion.trim()");
    expect(source).toContain("apiVersion: reviewerApiVersion.trim()");
  });

  it("exposes OS-protected cache status and secure deletion without rendering a cached secret", async () => {
    const modalSource = await readFile(new URL("./ModelSettingsModal.tsx", import.meta.url), "utf8");
    const appSource = await readFile(new URL("../App.tsx", import.meta.url), "utf8");

    expect(modalSource).toContain("운영체제 보호 저장소");
    expect(modalSource).toContain("저장된 키 삭제");
    expect(modalSource).toContain("onClearCredentials");
    expect(appSource).toContain("getModelCredentialStatus");
    expect(appSource).toContain("clearModelCredentials");
    expect(appSource).toContain("status.hasAuthorCredential");
  });
});
