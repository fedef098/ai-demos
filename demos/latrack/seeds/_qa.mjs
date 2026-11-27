// Shared helpers for the Latrack module demos (Demo Media / La Brisa on QA).
//
// · Every write runs as a small pg script inside the `web` service of the
//   `staging` environment (the QA database is only reachable from Railway), the
//   same proven method as onboarding-radio.mjs. Never production.
// · The console session of the demo admin is minted ONCE by logging in through
//   the real /login form (headless) and cached as a storageState under
//   seeds/.state/ (600, gitignored). Later runs reuse it while it is still valid,
//   so the 8-logins-per-15-min limit is never hit. The password is read from
//   ~/.config/latrack/logins.json (staging.demo.password) into memory only.
//
// Nothing here prints a password, a session token or a database URL.

import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const PROJECT = process.env.LATRACK_RAILWAY_PROJECT ?? "391fb236-7c5c-4d85-b8b5-aa026ee9e66b"; // Latrack
const ENVIRONMENT = "staging"; // QA. Hard-coded on purpose.
const PG = "/app/node_modules/.pnpm/pg@8.23.1/node_modules/pg";

export const COMPANY_ID = "cmwti8qwx00004jo4zmvoana1"; // Demo Media
export const BRAND_ID = "cmwti8qxj00014jo472ejga6p"; // La Brisa
export const APP_ID = "cmwti8r04000b4jo43a1z6kh6"; // La Brisa app (publicKey demo-labrisa)
export const STATIONS = {
  houston: "cmwti8qye00024jo49jk43oi7", // La Brisa 101.1
  phoenix: "cmwti8qz100054jo41wzysch9", // La Brisa 97.3
  miami: "cmwti8qzl00084jo4ubha7xb1", // La Brisa 1450
};
export const ADMIN_EMAIL = "admin@demo.latrack.app";

export const base = new URL(process.env.DEMO_BASE_URL ?? "https://qa-latrack.adavance.com");
// QA, through Cloudflare or straight at its Railway origin (same service, same database).
if (!["qa-latrack.adavance.com", "web-staging-52227612.up.railway.app"].includes(base.hostname)) {
  throw new Error(`These seeds only run against QA (qa-latrack.adavance.com), not ${base.hostname}.`);
}

const STATE = join(here, ".state");
mkdirSync(STATE, { recursive: true, mode: 0o700 });

const VARS = process.env.DEMO_VARS ?? join(STATE, "vars.env");
export const setVar = (k, v) => appendFileSync(VARS, `${k}=${v}\n`, { mode: 0o600 });
export const varsFile = VARS;

/** Runs `body` (CommonJS, with `db`, `q(sql, params)` and `out(obj)` in scope) inside the QA web
 *  container and returns the objects passed to out(), in order. */
export function remote(body, params = {}) {
  const js = `
const { Client } = require(${JSON.stringify(PG)});
const P = ${JSON.stringify(params)};
const db = new Client({ connectionString: process.env.DATABASE_URL });
const q = async (s, p) => (await db.query(s, p)).rows;
const out = (x) => console.log("DEMO_OUT " + JSON.stringify(x));
(async () => { await db.connect(); try { ${body}
} finally { await db.end(); } })().catch((e) => { console.log("DEMO_ERR " + JSON.stringify(e.message)); process.exit(1); });
`;
  const b64 = Buffer.from(js).toString("base64");
  const file = `/tmp/demo-${randomBytes(6).toString("hex")}.cjs`;
  let raw;
  try {
    raw = execFileSync("railway", ["ssh", "-p", PROJECT, "-e", ENVIRONMENT, "-s", "web", "--", "sh", "-c",
      `cd /app && echo ${b64} | base64 -d > ${file} && node ${file}; rm -f ${file}`],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 1 << 24 });
  } catch (e) {
    raw = e.stdout ?? "";
  }
  const lines = raw.split("\n").map((l) => l.replace(/\r/g, "").trim());
  const err = lines.find((l) => l.startsWith("DEMO_ERR "));
  if (err) throw new Error(`QA script failed: ${JSON.parse(err.slice(9))}`);
  return lines.filter((l) => l.startsWith("DEMO_OUT ")).map((l) => JSON.parse(l.slice(9)));
}

/** Path (relative to the demos/latrack workspace) of the admin's cached storageState. */
export const ADMIN_STATE = "./seeds/.state/admin-session.json";
export const EDITOR_EMAIL = "editor@demo.latrack.app";

async function sessionWorks(file) {
  if (!existsSync(file)) return false;
  try {
    const st = JSON.parse(readFileSync(file, "utf8"));
    const c = (st.cookies ?? []).find((x) => x.name === "lt_session");
    if (!c || (c.expires > 0 && c.expires * 1000 < Date.now() + 2 * 86_400_000)) return false;
    const res = await fetch(`${base.origin}/inbox`, { headers: { cookie: `lt_session=${c.value}` }, redirect: "manual" });
    return res.status === 200;
  } catch {
    return false;
  }
}

/** Makes sure a demo user has a valid console session cached; logs in through the form if not.
 *  Returns the storageState path relative to the workspace. */
export async function ensureSession(email = ADMIN_EMAIL, name = "admin") {
  const file = join(STATE, `${name}-session.json`);
  const rel = `./seeds/.state/${name}-session.json`;
  if (await sessionWorks(file)) return rel;
  const logins = JSON.parse(readFileSync(join(homedir(), ".config/latrack/logins.json"), "utf8"));
  const password = logins?.staging?.demo?.password;
  if (!password) throw new Error("No staging.demo.password in ~/.config/latrack/logins.json");
  const require = createRequire(join(here, "../../../package.json"));
  const { chromium } = require("@playwright/test");
  const browser = await chromium.launch(process.env.DEMO_BROWSER === "chromium" ? {} : { channel: "chrome" });
  try {
    const ctx = await browser.newContext({ locale: "es-US" });
    const page = await ctx.newPage();
    await page.goto(`${base.origin}/login`, { waitUntil: "domcontentloaded" });
    await page.fill("#email", email);
    await page.fill("#password", password);
    await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20_000 }), page.click('button[type="submit"]')]);
    writeFileSync(file, JSON.stringify(await ctx.storageState()), { mode: 0o600 });
    chmodSync(file, 0o600);
  } finally {
    await browser.close();
  }
  if (!(await sessionWorks(file))) throw new Error(`Logged in as ${name}, but the minted session does not open the console.`);
  return rel;
}

export const ensureAdminSession = () => ensureSession(ADMIN_EMAIL, "admin");

/** "YYYY-MM-DD" of a day offset from today in a time zone. */
export function dayIn(timeZone, offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export const isCleanup = process.argv.includes("--cleanup");

// ── watchers ─────────────────────────────────────────────────────────────────
// Some values only exist after a scene creates them on camera (the id of a poll,
// of a campaign). A watcher is a detached copy of the seed (`<seed> --watch …`)
// that runs a polling script inside the QA container and appends every
// `DEMO_VAR K=V` line it prints to DEMO_VARS, where the engine reads it live.

import { spawn } from "node:child_process";

const pidFile = (name) => join(dirname(VARS), `latrack-${name}-watch.pid`);

/** Stops the watcher a previous seed of this same run left behind. */
export function stopWatcher(name) {
  const f = pidFile(name);
  if (!existsSync(f)) return;
  const pid = Number(readFileSync(f, "utf8"));
  try {
    if (readFileSync(`/proc/${pid}/cmdline`, "utf8").includes("--watch")) process.kill(pid, "SIGTERM");
  } catch { /* already gone */ }
}

/** Spawns `node <seedFile> --watch ...args`, detached; it ends on its own. */
export function startWatcher(name, seedFile, args = []) {
  stopWatcher(name);
  const child = spawn(process.execPath, [seedFile, "--watch", ...args], {
    detached: true, stdio: "ignore", env: { ...process.env, DEMO_VARS: VARS },
  });
  writeFileSync(pidFile(name), String(child.pid), { mode: 0o600 });
  child.unref();
  return child.pid;
}

/** Watcher body: runs `body` remotely (it should print `DEMO_VAR K=V` lines) and stores the vars. */
export function runWatch(body, params = {}, minutes = 25) {
  const js = `
const { Client } = require(${JSON.stringify(PG)});
const P = ${JSON.stringify(params)};
const db = new Client({ connectionString: process.env.DATABASE_URL });
const q = async (s, p) => (await db.query(s, p)).rows;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const deadline = Date.now() + ${minutes} * 60_000;
(async () => { await db.connect(); try { ${body}
} finally { await db.end(); } })().catch((e) => { console.log("DEMO_ERROR " + e.message); process.exit(1); });
`;
  const b64 = Buffer.from(js).toString("base64");
  const file = `/tmp/demo-${randomBytes(6).toString("hex")}.cjs`;
  const child = spawn("railway", ["ssh", "-p", PROJECT, "-e", ENVIRONMENT, "-s", "web", "--", "sh", "-c",
    `cd /app && echo ${b64} | base64 -d > ${file} && node ${file}; rm -f ${file}`], { stdio: ["ignore", "pipe", "ignore"] });
  const stop = () => { child.kill("SIGTERM"); process.exit(0); };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  setTimeout(stop, (minutes + 1) * 60_000).unref();
  let buf = "";
  child.stdout.on("data", (d) => {
    buf += d.toString();
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).replace(/\r/g, "").trim();
      buf = buf.slice(nl + 1);
      const v = /^DEMO_VAR ([A-Z0-9_]+)=(.*)$/.exec(line);
      if (v) { try { setVar(v[1], v[2]); } catch { /* the run is gone */ } }
    }
  });
  child.on("exit", () => process.exit(0));
}

export const isWatch = process.argv[2] === "--watch";

/**
 * Removes the Activity (AuditLog) rows that earlier takes left about "Demo …" things
 * the seeds have since deleted (a poll, a push, a sponsor, a reel of a previous run),
 * so retakes do not pile up in Activity. Only Demo Media rows whose summary names a
 * "Demo" item AND whose entity no longer exists; nothing else in the log is touched.
 */
export function pruneDemoAudit() {
  const [r] = remote(`
    const tables = { PushCampaign: 'PushCampaign', Contest: 'Contest', Sponsor: 'Sponsor', ReelProject: 'ReelProject', Short: 'Short', Invitation: 'Invitation' };
    let n = 0;
    for (const [entity, table] of Object.entries(tables)) {
      const del = await q('delete from "AuditLog" a where a."companyId" = $1 and a.entity = $2 and a.summary like $3 and not exists (select 1 from "' + table + '" t where t.id = a."entityId") returning a.id', [P.companyId, entity, '%Demo%']);
      n += del.length;
    }
    out({ pruned: n });
  `, { companyId: COMPANY_ID });
  return r.pruned;
}

/** GETs console pages with the admin's session so the first `go` on camera isn't a cold 3–4 s load. */
export async function warm(paths) {
  const file = join(STATE, "admin-session.json");
  const c = JSON.parse(readFileSync(file, "utf8")).cookies?.find((x) => x.name === "lt_session");
  for (const p of paths) await fetch(`${base.origin}${p}`, { headers: c ? { cookie: `lt_session=${c.value}` } : {} }).then((r) => r.arrayBuffer()).catch(() => {});
}
