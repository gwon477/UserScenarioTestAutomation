/* 프로젝트 목록 화면이 쓰는 투영.
 *
 * 전부 main 이 디스크에서 읽어 만든다. renderer 는 이 값을 조립하거나 추정하지
 * 않는다. 계약은 목업 `docs/mockups/redesign-v2.html` 의 S1 을 따른다. */

export type ProjectSummary = {
  path: string;
  name: string;
  /** 등록된 경로를 지금 열 수 있는지. false 면 「경로 없음」으로 보여준다. */
  reachable: boolean;
  addedAt: string;
  lastOpenedAt?: string;
  runs: number;
  latestRunId?: string;
  executions: number;
  failedExecutions: number;
  frames: number;
  bytes: number;
};

export type AnalysisDataMeasure = {
  runs: number;
  executions: number;
  frames: number;
  bytes: number;
};
