/* 저장소의 TS 모듈은 두 가지 표기를 쓴다.
 *   packages/*  : 형제를 `./x.js` 로 import (컴파일 후 형태 가정)
 *   apps/desktop: 형제를 `./x` 로 import (bundler resolution)
 * Node 는 둘 다 `.ts` 로 되돌려 주지 않으므로 해석 실패 시에만 보정한다.
 */
export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (error) {
    if (!specifier.startsWith(".")) throw error;
    const candidates = specifier.endsWith(".js")
      ? [`${specifier.slice(0, -3)}.ts`]
      : [`${specifier}.ts`, `${specifier}/index.ts`];
    for (const candidate of candidates) {
      try {
        return await next(candidate, context);
      } catch {
        // 다음 후보를 시도한다.
      }
    }
    throw error;
  }
}
