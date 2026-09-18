// @scene d9ed133a5b08
// hand-written: the browser build needs window.showDirectoryPicker stubbed before '프로젝트 추가' (see demo/prelude.js)
await page.goto('about:blank');
await page.goto(BASE + '/?preview=demo#/projects', { waitUntil: 'networkidle' });
await stubDirectoryPicker();
// ---record---
await subtitleSpan("프로젝트를 추가하면 바로 작업대로 들어갑니다", HOLD[0], async () => {
  await click("role=button[name=\"프로젝트 추가\"]");
  await waitFor("role=dialog", {});
}, {"emphasis": "작업대"});
await padTo(DWELL);
// leave no state for the next scene in this session
await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
