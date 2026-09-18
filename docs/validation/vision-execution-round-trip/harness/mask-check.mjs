import { app, BrowserWindow, nativeImage, session } from "electron";
import { writeFile } from "node:fs/promises";
const settle = (ms) => new Promise((r) => setTimeout(r, ms));
app.whenReady().then(async () => {
  await session.defaultSession.clearStorageData();
  const window = new BrowserWindow({ width: 1440, height: 900, show: false, webPreferences: { contextIsolation: true } });
  window.setContentSize(1440, 900);
  await window.loadURL("http://localhost:45180");
  await settle(1500);
  await window.webContents.executeJavaScript(`(() => {
    const set = (id, value) => {
      const input = document.getElementById(id);
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    };
    set("lf-userId", "kimtester");
    set("lf-password", "super-secret-value");
    return true;
  })()`);
  await settle(300);
  const applied = await window.webContents.executeJavaScript(`(() => {
    const selectors = ["#lf-password"];
    let covered = 0;
    for (const selector of selectors) {
      const target = document.querySelector(selector);
      if (!target) continue;
      const rect = target.getBoundingClientRect();
      const cover = document.createElement("div");
      cover.setAttribute("data-sf-mask", selector);
      Object.assign(cover.style, { position: "fixed", left: rect.left + "px", top: rect.top + "px", width: rect.width + "px", height: rect.height + "px", background: "#111", zIndex: "2147483647", pointerEvents: "none" });
      document.body.appendChild(cover);
      covered += 1;
    }
    return covered === selectors.filter((s) => document.querySelector(s)).length;
  })()`);
  await settle(200);
  const image = await window.webContents.capturePage();
  const resized = image.resize({ width: 1229, height: 768 });
  await writeFile(process.env.MASK_OUT, resized.toPNG());
  console.log("maskApplied:", applied, "-> written");
  app.exit(0);
});
