/* Records one module demo from the LIVE site with the interactive cursor,
   synced to build/<id>/timing.json. Writes build/<id>/raw.webm + offset.json.
   Project-agnostic: target + login + viewport come from config.mjs. */
import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { CURSOR_INIT, makeDriver } from "./lib-driver.mjs";
import { byId } from "./modules.mjs";
import { cfg } from "./config.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const { width, height, deviceScaleFactor } = cfg.video;
const id = process.argv[2];
const mod = byId(id);
if (!mod) { console.error("unknown module", id); process.exit(1); }
const dir = path.join(HERE, "build", id);
const timing = JSON.parse(fs.readFileSync(path.join(dir, "timing.json"), "utf8"));
const slot = Object.fromEntries(timing.steps.map((s) => [s.id, s.slot]));

const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({
  viewport: { width, height },
  deviceScaleFactor,
  recordVideo: { dir, size: { width, height } },
});
await ctx.addInitScript(CURSOR_INIT);
const page = await ctx.newPage();
const d = makeDriver(page, cfg);

// warm the login page + measure load offset (audio delay)
const t0 = Date.now();
await page.goto(cfg.baseUrl + cfg.login.path, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForSelector(cfg.login.userSel, { timeout: 30000 });
await page.waitForTimeout(500);
const loadTime = (Date.now() - t0) / 1000;
fs.writeFileSync(path.join(dir, "offset.json"), JSON.stringify({ loadTime: +loadTime.toFixed(2) }));

const clock = Date.now();
let acc = timing.lead || 0.6;
async function finish(id2) {
  acc += slot[id2] || 4;
  await page.waitForTimeout(Math.max(0, clock + acc * 1000 - Date.now()));
}
await page.waitForTimeout((timing.lead || 0.6) * 1000);

try {
  await mod.run(d, finish);
} catch (e) {
  console.error("run error:", e.message);
}

await page.waitForTimeout(500);
await ctx.close();
await b.close();

const vids = fs.readdirSync(dir).filter((f) => f.endsWith(".webm"));
vids.sort((a, c) => fs.statSync(path.join(dir, c)).mtimeMs - fs.statSync(path.join(dir, a)).mtimeMs);
if (vids[0]) fs.renameSync(path.join(dir, vids[0]), path.join(dir, "raw.webm"));
console.log(`[${id}] recorded build/${id}/raw.webm loadTime=${loadTime}`);
