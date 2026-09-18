// @scene 528d89c1da02
// hand-written: the browser build needs window.showDirectoryPicker stubbed before '프로젝트 추가' (see demo/prelude.js)
await registerSampleProject({ saveKey: true });
// ---record---
await subtitleSpan("분석은 소스, 사실, 업무 분류, 시나리오 네 단계로 진행됩니다", HOLD[0], async () => {
  await highlight("ol.pipe", {});
}, {"emphasis": "네 단계"});
await subtitleSpan("각 단계는 검증하고 저장한 뒤 다음 단계로 넘어갑니다", HOLD[1], null, {"emphasis": "검증하고 저장"});
await padTo(DWELL);
// leave no state for the next scene in this session
await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
