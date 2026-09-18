import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { executionRoot } from "@scenarioforge/test-runtime";
import { loadEvidenceFrame, loadStepEvidence } from "./evidence-view";

const RUN_ID = "RUN-evidence-01";
const EXECUTION_ID = "EXEC-evidence-01";
let projectRoot: string;

const record = {
  schemaVersion: 1,
  stepId: "SCN-1#1",
  actionRef: "E-1",
  verdict: "PASSED",
  target: { elementRef: "EL-1", visibleLabel: "로그인", controlKind: "button", labelUniqueOnSurface: true },
  frameSpace: { captureSize: { width: 1440, height: 900 }, modelSize: { width: 1229, height: 768 }, scale: 0.8533 },
  maskedRegions: [{ elementRef: "#pw", label: "#pw" }],
  proposal: { modelPoint: { x: 615, y: 482 }, capturePoint: { x: 721, y: 565 }, observedLabel: "로그인", confidence: 0.99 },
  attempts: [{ attempt: 1, outcome: "accepted" }],
  assertions: [{ ref: "SCR-2", verdict: "PASSED", detail: "대시보드" }],
  observations: 2,
  frames: [{ id: "model-input-1", kind: "model-input", round: 1, relativePath: "cases/SCN-1/SCN-1-step-1/frames/model-input-1.png", size: { width: 1229, height: 768 } }],
};

// 1x1 투명 PNG
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==",
  "base64",
);

beforeEach(async () => {
  projectRoot = await mkdtemp(join(tmpdir(), "scenarioforge-evidence-"));
  const stepDirectory = join(executionRoot(projectRoot, RUN_ID, EXECUTION_ID), "cases", "SCN-1", "SCN-1-step-1");
  await mkdir(join(stepDirectory, "frames"), { recursive: true });
  await writeFile(join(stepDirectory, "evidence.json"), `${JSON.stringify(record, null, 2)}\n`);
  await writeFile(join(stepDirectory, "frames", "model-input-1.png"), PNG);
});

afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
});

const base = { projectRoot: "", runId: RUN_ID, executionId: EXECUTION_ID };

describe("evidence view", () => {
  it("reads the recorded step evidence with both coordinate spaces", async () => {
    const loaded = await loadStepEvidence({ ...base, projectRoot, scenarioId: "SCN-1", stepId: "SCN-1#1" });

    expect(loaded).toMatchObject({
      stepId: "SCN-1#1",
      frameSpace: { modelSize: { width: 1229, height: 768 } },
      proposal: { modelPoint: { x: 615, y: 482 } },
      maskedRegions: [{ elementRef: "#pw" }],
    });
  });

  it("returns the model input frame as a data url", async () => {
    const dataUrl = await loadEvidenceFrame({
      ...base,
      projectRoot,
      relativePath: "cases/SCN-1/SCN-1-step-1/frames/model-input-1.png",
    });

    expect(dataUrl.startsWith("data:image/png;base64,")).toBe(true);
  });

  it("refuses a frame path outside the execution tree", async () => {
    await expect(
      loadEvidenceFrame({ ...base, projectRoot, relativePath: "../../../../../etc/passwd" }),
    ).rejects.toThrow("EXECUTION_PATH_ESCAPE");
  });

  it("refuses a non png frame", async () => {
    const stepDirectory = join(executionRoot(projectRoot, RUN_ID, EXECUTION_ID), "cases", "SCN-1", "SCN-1-step-1");
    await writeFile(join(stepDirectory, "notes.txt"), "text");

    await expect(
      loadEvidenceFrame({ ...base, projectRoot, relativePath: "cases/SCN-1/SCN-1-step-1/notes.txt" }),
    ).rejects.toThrow("EVIDENCE_FRAME_TYPE_UNSUPPORTED");
  });

  it("rejects an unsupported evidence schema instead of guessing", async () => {
    const stepDirectory = join(executionRoot(projectRoot, RUN_ID, EXECUTION_ID), "cases", "SCN-1", "SCN-1-step-1");
    await writeFile(join(stepDirectory, "evidence.json"), `${JSON.stringify({ ...record, schemaVersion: 99 })}\n`);

    await expect(
      loadStepEvidence({ ...base, projectRoot, scenarioId: "SCN-1", stepId: "SCN-1#1" }),
    ).rejects.toThrow("EVIDENCE_SCHEMA_UNSUPPORTED");
  });
});
