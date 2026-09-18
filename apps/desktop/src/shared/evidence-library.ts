/* 증적 라이브러리 목록. 정본 실행 트리를 걸어 만든 것이다.
 * 계약은 docs/screens/06-evidence.md 를 따른다. */

import type { ReviewCauseTag, ReviewDecision } from "./evidence";

export type EvidenceLibraryEntry = {
  runId: string;
  executionId: string;
  scenarioId: string;
  stepId: string;
  order: number;
  verdict: "PASSED" | "FAILED" | "INCONCLUSIVE";
  reasonCode?: string;
  frameCount: number;
  bytes: number;
  reviewCount: number;
  causeTags: ReviewCauseTag[];
  decisions: ReviewDecision[];
  createdAt: string;
};

export type EvidenceLibraryView = {
  /** 한 run 으로 좁힌 목록일 때만 있다. 프로젝트 전체 목록에는 없다. */
  runId?: string;
  entries: EvidenceLibraryEntry[];
  totals: {
    steps: number;
    frames: number;
    bytes: number;
    verdicts: Record<"PASSED" | "FAILED" | "INCONCLUSIVE", number>;
    reasonCodes: Record<string, number>;
    /* causeTag 별 집계. 「라벨 화면 미표시」가 반복되면 개별 케이스를 손보는
     * 대신 생성 트랙에 계약 요청을 올려야 한다는 신호다. */
    causeTags: Record<string, number>;
    reviewed: number;
  };
};
