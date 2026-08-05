/* Reusable Playwright "driver" with a visible interactive cursor for demos.
   Project-agnostic: login selectors come from config.mjs (cfg.login).
   Used by record-module.mjs to script per-module walkthroughs. */

export const CURSOR_INIT = () => {
  if (window.__cur) return;
  window.__cur = true;
  const make = () => {
    if (document.getElementById("demo-cursor")) return;
    const root = document.body || document.documentElement;
    if (!root) return;
    const st = document.createElement("style");
    st.textContent =
      "#demo-cursor{position:fixed;z-index:2147483647;left:50%;top:50%;width:24px;height:24px;margin:-3px 0 0 -4px;pointer-events:none;transition:left .03s linear,top .03s linear}" +
      "#demo-cursor svg{filter:drop-shadow(0 2px 4px rgba(0,0,0,.55))}" +
      "#demo-ripple{position:fixed;z-index:2147483646;width:36px;height:36px;margin:-18px 0 0 -18px;border-radius:50%;border:3px solid #caa24a;pointer-events:none;opacity:0}" +
      "#demo-ripple.go{animation:dr .45s ease-out}@keyframes dr{from{transform:scale(.25);opacity:.9}to{transform:scale(1.4);opacity:0}}";
    document.head && document.head.appendChild(st);
    const c = document.createElement("div");
    c.id = "demo-cursor";
    c.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="#fff" stroke="#15120e" stroke-width="1.5"><path d="M5 2.5l5.5 17 2.7-7.1 7.1-2.7L5 2.5z"/></svg>';
    const r = document.createElement("div");
    r.id = "demo-ripple";
    root.appendChild(c);
    root.appendChild(r);
  };
  make();
  window.addEventListener("mousemove", (e) => {
    make();
    const c = document.getElementById("demo-cursor");
    if (c) { c.style.left = e.clientX + "px"; c.style.top = e.clientY + "px"; }
  }, true);
  window.__demoClick = (x, y) => {
    const r = document.getElementById("demo-ripple");
    if (r) { r.style.left = x + "px"; r.style.top = y + "px"; r.classList.remove("go"); void r.offsetWidth; r.classList.add("go"); }
  };
};

/** makeDriver(page, cfg) — cfg is the object from config.mjs (baseUrl, pass, login). */
export function makeDriver(page, cfg) {
  const BASE = cfg.baseUrl;
  const PASS = cfg.pass;
  const L = cfg.login;
  let cur = { x: 800, y: 450 };
  const sleep = (ms) => page.waitForTimeout(Math.max(0, ms));

  async function moveTo(x, y, steps = 24) {
    for (let i = 1; i <= steps; i++) {
      await page.mouse.move(cur.x + (x - cur.x) * (i / steps), cur.y + (y - cur.y) * (i / steps));
      await sleep(7);
    }
    cur = { x, y };
  }
  // Collapse a possibly-multi-match locator to a single element so scroll/box
  // calls never throw on strict mode (that throw used to drop us into an
  // invisible force-click where the cursor never moved to the button).
  const one = (loc) => (loc && typeof loc.first === "function" ? loc.first() : loc);
  // Center the target in the viewport so the viewer always sees the cursor act on
  // it (container-aware; also works inside scrollable modals).
  async function reveal(loc) {
    const el = one(loc);
    await el.evaluate((n) => n.scrollIntoView({ block: "center", inline: "center", behavior: "instant" })).catch(() => {});
    await sleep(280);
    return el;
  }
  async function clickLoc(loc) {
    const el = await reveal(loc);
    const box = await el.boundingBox({ timeout: 4000 }).catch(() => null);
    if (!box) { await el.click({ force: true, timeout: 5000 }).catch(() => {}); return; }
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    await moveTo(x, y);
    await page.evaluate(([px, py]) => window.__demoClick && window.__demoClick(px, py), [x, y]);
    await sleep(110);
    await page.mouse.click(x, y);
  }
  // Move the visible cursor to an element and show the click ripple, then run a
  // guaranteed DOM click (used to expand accordion section headers reliably).
  async function pressVisible(loc) {
    const el = await reveal(loc);
    const box = await el.boundingBox({ timeout: 3000 }).catch(() => null);
    if (box) {
      const x = box.x + box.width / 2, y = box.y + box.height / 2;
      await moveTo(x, y);
      await page.evaluate(([px, py]) => window.__demoClick && window.__demoClick(px, py), [x, y]);
      await sleep(110);
    }
    await el.evaluate((n) => n.click()).catch(() => {});
  }
  async function typeInto(loc, text) {
    await clickLoc(loc);
    await page.keyboard.type(text, { delay: 45 });
  }
  async function hover(sel) {
    const loc = page.locator(sel).first();
    try { await loc.scrollIntoViewIfNeeded({ timeout: 2000 }); } catch {}
    const box = await loc.boundingBox({ timeout: 4000 }).catch(() => null);
    if (box) await moveTo(box.x + box.width / 2, box.y + box.height / 2);
  }
  async function nav(p) { await page.goto(BASE + p, { waitUntil: "domcontentloaded" }).catch(() => {}); await sleep(1100); }
  async function login(user) {
    await page.goto(BASE + L.path, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForSelector(L.userSel, { timeout: 30000 });
    await sleep(600);
    await typeInto(page.locator(L.userSel), user);
    await typeInto(page.locator(L.passSel), PASS);
    await clickLoc(page.locator(`button:has-text("${L.submitText}")`));
    await page.waitForURL(L.postLoginUrl, { timeout: 20000 }).catch(() => {});
    await sleep(800);
  }
  async function logout() { await page.context().clearCookies(); }

  // Pick a Radix <Select> by its visible placeholder/label region then choose option text.
  async function pickSelect(triggerText, optionText) {
    const trig = page.locator(`button:has-text("${triggerText}"), [role="combobox"]:has-text("${triggerText}")`).first();
    await clickLoc(trig);
    await sleep(400);
    await clickLoc(page.locator(`[role="option"]:has-text("${optionText}")`).first());
    await sleep(300);
  }

  return { page, sleep, moveTo, clickLoc, typeInto, hover, nav, login, logout, pickSelect, reveal, pressVisible, getCur: () => cur };
}
