/* 프레임 좌표계 변환.
 *
 * 모델은 원본 스크린샷 좌표계가 아니라 자기 전처리 이미지 좌표계로 답한다.
 * PROBE-20260907-01 실측: AXSE 39개 대상의 오차가 전부 선형이었고
 * predicted_y = 0.8532 * truth_y (평균 절대 잔차 0.5px)였다.
 * 0.8533 은 768 / 900 이다. 이 변환을 생략하면 좌표가 정확한 모델도
 * hit rate 0.07~0.21 로 보인다.
 *
 * 근거: docs/validation/vision-execution-grounding/PROBE-20260907-01/README.md
 */

import type { Point } from "../types.js";

export const MODEL_FRAME_SHORT_SIDE = 768;

export type FrameSize = { width: number; height: number };

export type FrameCoordinateSpace = {
  captureSize: FrameSize;
  modelSize: FrameSize;
  shortSide: number;
  scale: number;
};

function assertSize(size: FrameSize): void {
  if (!Number.isFinite(size.width) || !Number.isFinite(size.height) || size.width <= 0 || size.height <= 0) {
    throw new Error("FRAME_SIZE_INVALID");
  }
}

export function createFrameCoordinateSpace(captureSize: FrameSize, shortSide = MODEL_FRAME_SHORT_SIDE): FrameCoordinateSpace {
  assertSize(captureSize);
  if (!Number.isFinite(shortSide) || shortSide <= 0) throw new Error("FRAME_SHORT_SIDE_INVALID");
  // ponytail: 축소만 구현한다. 캡처의 짧은 변이 목표보다 작은 경우는 실측되지
  // 않았다. 저해상도 대상을 지원할 때 확대 규칙을 실측하고 나서 추가한다.
  const scale = Math.min(1, shortSide / Math.min(captureSize.width, captureSize.height));
  return {
    captureSize: { ...captureSize },
    modelSize: { width: Math.round(captureSize.width * scale), height: Math.round(captureSize.height * scale) },
    shortSide,
    scale,
  };
}

/** 모델이 답한 좌표를 실제 입력을 합성할 캡처 좌표계로 환산한다. */
export function toCaptureSpace(space: FrameCoordinateSpace, point: Point): Point {
  return {
    x: Math.round(point.x * (space.captureSize.width / space.modelSize.width)),
    y: Math.round(point.y * (space.captureSize.height / space.modelSize.height)),
  };
}

/** 캡처 좌표계의 값을 모델에 보낸 이미지 좌표계로 환산한다. 검증과 비교용이다. */
export function toModelSpace(space: FrameCoordinateSpace, point: Point): Point {
  return {
    x: Math.round(point.x * (space.modelSize.width / space.captureSize.width)),
    y: Math.round(point.y * (space.modelSize.height / space.captureSize.height)),
  };
}
