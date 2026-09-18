// @scene 586fe6c15f59
// hand-written: the browser build needs window.showDirectoryPicker stubbed before '프로젝트 추가' (see demo/prelude.js)
await registerSampleProject({ saveKey: true });
// ---record---
await subtitleSpan("SRC 단계 실행을 누르면 소스 구조 수집부터 시작합니다", HOLD[0], async () => {
  await hoverOn("role=button[name=\"SRC 단계 실행\"]");
  await highlight("role=button[name=\"SRC 단계 실행\"]", {});
}, {"emphasis": "SRC 단계 실행"});
await padTo(DWELL);
// leave no state for the next scene in this session
await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
