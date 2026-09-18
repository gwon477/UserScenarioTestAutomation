import { readdir } from "node:fs/promises";
import { join } from "node:path";

/* 프로젝트가 가진 분석 run 목록.
 *
 * 실행과 증적 탭은 프로젝트 범위다. 사용자가 보는 단위는 「내가 돌린 테스트
 * 전부」이고 「run X의 테스트」가 아니다.
 */

const SAFE_RUN_ID = /^[A-Za-z0-9_-]+$/;

export async function listRunIds(projectRoot: string): Promise<string[]> {
  try {
    return (await readdir(join(projectRoot, ".scenarioforge", "runs"), { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && SAFE_RUN_ID.test(entry.name))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}
