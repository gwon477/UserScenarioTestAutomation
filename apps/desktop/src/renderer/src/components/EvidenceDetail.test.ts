import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const detail = () => readFile(new URL("./EvidenceDetail.tsx", import.meta.url), "utf8");
const app = () => readFile(new URL("../App.tsx", import.meta.url), "utf8");

describe("evidence detail independence", () => {
  it("takes only the execution id, not the whole execution projection", async () => {
    const code = await detail();

    /* 증적은 소속 실행을 이미 알고 있다. 실행 투영에 묶으면 정본 run 검증이
     * 실패한 프로젝트에서 증적이 있는데도 상세가 열리지 않는다. 실제로
     * 라이브 실행 증적이 조용히 개요로 떨어진 적이 있다. */
    expect(code).toContain("executionId: string;");
    expect(code).not.toContain("execution: TestExecution;");
  });

  it("renders the detail without requiring the execution projection", async () => {
    const code = await app();

    expect(code).toContain('viewMode === "evidence-detail" && selectedEvidence ? (');
    expect(code).toContain("executionId={selectedEvidence.executionId}");
  });

  it("names where back goes and hides retry when there is no execution context", async () => {
    const detailCode = await detail();
    const appCode = await app();

    expect(detailCode).toContain("onRetry?: () => void;");
    expect(detailCode).toContain("{onRetry && (");
    expect(appCode).toContain('backLabel={evidenceExecution ? "테스트 수행으로 돌아가기" : "증적 목록으로 돌아가기"}');
  });
});
