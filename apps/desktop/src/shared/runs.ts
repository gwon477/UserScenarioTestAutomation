/* 생성 이력 목록의 투영.
 *
 * 원천은 `.scenarioforge/runs` 다. renderer 저장소가 아니다. 다른 기기나 새
 * 프로필에서도 디스크에 있는 run 이 그대로 보여야 한다.
 */

export type RunSummary = {
  runId: string;
  /** manifest 를 읽을 수 있을 때만 있다. 없으면 불완전한 run 이다. */
  createdAt?: string;
  /** 시나리오 산출물이 등록됐는지. 등록 전 run 은 열 수 없다. */
  complete: boolean;
  /** 산출물에서 센 값. 해당 산출물이 없으면 없다. */
  facts?: number;
  wikiPages?: number;
  scenarios?: number;
};
