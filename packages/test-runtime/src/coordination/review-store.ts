/* 사람 검토 기록.
 *
 * 결정론적 verdict 를 덮어쓰지 않는다. verdict 는 backend 소유이고 검토는
 * 덧붙이는 레이어다. 그래서 증적과 같은 디렉터리의 별도 파일에 append 만 한다.
 *
 * 계약은 docs/screens/06-evidence.md 를 따른다.
 */

import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { assertWithinExecutionTree, executionRoot } from "./execution-paths.js";
import { stepDirectoryName } from "./execution-writer.js";

export type ReviewDecision = "동의" | "오탐" | "미탐" | "재실행 필요";

/* 원인 태그. 실측에서 확인된 실패 유형에서 가져왔다.
 * 이 태그별 집계가 생성 트랙에 올릴 계약 요청의 신호가 된다. */
export type ReviewCauseTag =
  | "앵커 부적절"
  | "라벨 화면 미표시"
  | "라벨 렌더링 불일치"
  | "대상 크기 과소"
  | "환경 문제"
  | "대상 앱 결함"
  | "기타";

export type HumanReview = {
  reviewId: string;
  executionId: string;
  scenarioId: string;
  stepId: string;
  captureId?: string;
  decision: ReviewDecision;
  causeTag?: ReviewCauseTag;
  note: string;
  author: string;
  at: string;
};

export type ReviewLedger = {
  schemaVersion: 1;
  reviews: HumanReview[];
};

const DECISIONS: readonly ReviewDecision[] = ["동의", "오탐", "미탐", "재실행 필요"];
const CAUSE_TAGS: readonly ReviewCauseTag[] = [
  "앵커 부적절",
  "라벨 화면 미표시",
  "라벨 렌더링 불일치",
  "대상 크기 과소",
  "환경 문제",
  "대상 앱 결함",
  "기타",
];

const MAX_NOTE_LENGTH = 2000;

async function atomicWrite(path: string, content: string): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, content);
  const handle = await open(temporary, "r");
  await handle.sync();
  await handle.close();
  await rename(temporary, path);
}

export class ReviewStore {
  private readonly projectRoot: string;
  private readonly runId: string;
  private readonly executionId: string;

  constructor(projectRoot: string, runId: string, executionId: string) {
    this.projectRoot = projectRoot;
    this.runId = runId;
    this.executionId = executionId;
  }

  private stepDirectory(scenarioId: string, stepId: string): string {
    const path = join(
      executionRoot(this.projectRoot, this.runId, this.executionId),
      "cases",
      scenarioId.replace(/[^A-Za-z0-9_-]/g, "_"),
      stepDirectoryName(stepId),
    );
    return assertWithinExecutionTree(this.projectRoot, this.runId, path);
  }

  async list(scenarioId: string, stepId: string): Promise<HumanReview[]> {
    try {
      const ledger = JSON.parse(await readFile(join(this.stepDirectory(scenarioId, stepId), "reviews.json"), "utf8")) as ReviewLedger;
      if (ledger.schemaVersion !== 1 || !Array.isArray(ledger.reviews)) throw new Error("REVIEW_LEDGER_INVALID");
      return ledger.reviews;
    } catch (error) {
      if (error instanceof Error && error.message === "REVIEW_LEDGER_INVALID") throw error;
      return [];
    }
  }

  /** 기록을 덧붙인다. 기존 기록을 지우거나 고치지 않는다. */
  async append(input: Omit<HumanReview, "reviewId" | "executionId">): Promise<HumanReview> {
    if (!DECISIONS.includes(input.decision)) throw new Error("REVIEW_DECISION_INVALID");
    if (input.causeTag !== undefined && !CAUSE_TAGS.includes(input.causeTag)) throw new Error("REVIEW_CAUSE_TAG_INVALID");
    if (!input.author.trim()) throw new Error("REVIEW_AUTHOR_REQUIRED");
    if (input.note.length > MAX_NOTE_LENGTH) throw new Error("REVIEW_NOTE_TOO_LONG");

    const directory = this.stepDirectory(input.scenarioId, input.stepId);
    await mkdir(directory, { recursive: true });
    const existing = await this.list(input.scenarioId, input.stepId);
    const review: HumanReview = {
      reviewId: randomUUID(),
      executionId: this.executionId,
      ...input,
      author: input.author.trim(),
    };
    const ledger: ReviewLedger = { schemaVersion: 1, reviews: [...existing, review] };
    await atomicWrite(join(directory, "reviews.json"), `${JSON.stringify(ledger, null, 2)}\n`);
    return review;
  }
}

export const REVIEW_DECISIONS = DECISIONS;
export const REVIEW_CAUSE_TAGS = CAUSE_TAGS;
