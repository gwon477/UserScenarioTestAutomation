// hand-written: the browser build needs window.showDirectoryPicker stubbed before '프로젝트 추가' (see demo/prelude.js)
await registerSampleProject();
// ---record---
await subtitleSpan("분석에 쓸 모델과 API 키를 한 번만 저장합니다", HOLD[0], async () => {
  await typeText("role=dialog >> input[type=password]", ACCOUNTS.llm.apiKey, { secret: true });
  await click("role=button[name=\"설정 저장\"]");
  await waitFor("role=heading[name=\"이 설정으로 첫 단계를 실행합니다\"]", {});
}, {"emphasis": "한 번만"});
await padTo(DWELL);
// leave no state for the next scene in this session
await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
