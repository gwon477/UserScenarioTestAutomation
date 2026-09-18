/* RA-DAR 대시보드 앵커가 실제로 화면에 계속 있는지 DOM 으로 확인하고
 * 같은 프레임을 저장한다. observer 불안정과 화면 변화를 구분한다. */
import { app, BrowserWindow, session } from "electron";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
const settle = (ms) => new Promise((r) => setTimeout(r, ms));
const ANCHOR = "새로 생성된 대조 조항";
app.whenReady().then(async () => {
  const out = process.env.STABILITY_OUT;
  await mkdir(out, { recursive: true });
  await session.defaultSession.clearStorageData();
  const w = new BrowserWindow({ width: 1440, height: 900, show: false, webPreferences: { contextIsolation: true } });
  w.setContentSize(1440, 900);
  await w.loadURL("http://localhost:45190/login");
  await settle(1500);
  for (let i = 0; i < 20; i += 1) {
    const ok = await w.webContents.executeJavaScript(`(() => {
      const scene = document.querySelector("#s10");
      if (scene) scene.scrollIntoView({ block: "start" });
      const t = document.querySelector('button[type="submit"].btn.pri');
      if (!t) return false;
      const r = t.getBoundingClientRect();
      return r.top >= 0 && r.bottom <= window.innerHeight;
    })()`);
    if (ok) break;
    await settle(400);
  }
  await w.webContents.executeJavaScript(`document.querySelector('button[type="submit"].btn.pri').click(), true`);
  const rows = [];
  for (let round = 1; round <= 6; round += 1) {
    await settle(1200);
    const probe = await w.webContents.executeJavaScript(`(() => {
      const anchor = ${JSON.stringify(ANCHOR)};
      const body = document.body.innerText || "";
      const node = [...document.querySelectorAll("*")].find((n) => n.children.length === 0 && (n.textContent||"").includes(anchor));
      const rect = node ? node.getBoundingClientRect() : null;
      return {
        inText: body.includes(anchor),
        rect: rect ? { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) } : null,
        inViewport: rect ? rect.top >= 0 && rect.bottom <= window.innerHeight : false,
        scrollY: Math.round(window.scrollY),
        heading: (document.querySelector("h1,h2")?.textContent || "").trim().slice(0, 40),
      };
    })()`);
    const image = await w.webContents.capturePage();
    await writeFile(join(out, `dashboard-round-${round}.png`), image.resize({ width: 1229, height: 768 }).toPNG());
    console.log(`round ${round}: inText=${probe.inText} inViewport=${probe.inViewport} rect=${JSON.stringify(probe.rect)} scrollY=${probe.scrollY} heading="${probe.heading}"`);
    rows.push({ round, ...probe });
  }
  await writeFile(join(out, "anchor-stability.json"), JSON.stringify({ anchor: ANCHOR, rounds: rows }, null, 2));
  app.exit(0);
});
