// ScenarioForge demo helpers (browser preview mode). Injected after the skill prelude.
// The browser build opens a native directory picker on "프로젝트 추가"; undefining it
// makes the app register "scenarioforge-sample" so the flow can be recorded.
async function stubDirectoryPicker() {
  await page.evaluate(() => {
    Object.defineProperty(window, 'showDirectoryPicker', { value: undefined, configurable: true });
  });
}
// Off-camera setup: register the sample project (and optionally save the model key).
async function registerSampleProject({ saveKey = false } = {}) {
  await page.goto('about:blank');
  await page.goto(BASE + '/?preview=demo#/projects', { waitUntil: 'networkidle' });
  // Scenes share a browser session: forget what an earlier scene stored, then reload.
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '프로젝트 추가' }).waitFor({ timeout: 15000 });
  await stubDirectoryPicker();
  await page.getByRole('button', { name: '프로젝트 추가' }).click();
  await page.getByRole('dialog').waitFor();
  if (saveKey) {
    await page.getByRole('dialog').locator('input[type=password]').first().fill(ACCOUNTS.llm.apiKey);
    await page.getByRole('button', { name: '설정 저장' }).click();
    await page.getByRole('heading', { name: '이 설정으로 첫 단계를 실행합니다' }).waitFor();
  }
}
