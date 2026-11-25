// Shared helpers for the Latrack module demos (marca, senales-streams,
// programacion, home-app, apps-tiendas). QA only, never production.
//
//   qaRun(body, params)  runs `body` (async JS with `db` = a connected pg Client
//                        and `P` = params) inside the QA web service, and returns
//                        whatever it prints as `RESULT <json>`.
//   adminSession(file)   makes sure `file` holds a storageState of the demo
//                        admin (admin@demo.latrack.app), logging in through the
//                        real login form only when the cached one expired.
//
// Never prints the password, the session cookie or the database URL.

import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { homedir } from "node:os";

const PROJECT = process.env.LATRACK_RAILWAY_PROJECT ?? "391fb236-7c5c-4d85-b8b5-aa026ee9e66b"; // Latrack
const ENVIRONMENT = "staging"; // QA. Hard-coded on purpose.
const SERVICE = "web";
const PG = "/app/node_modules/.pnpm/pg@8.23.1/node_modules/pg";

export const base = new URL(process.env.DEMO_BASE_URL ?? "https://qa-latrack.adavance.com");
if (base.hostname !== "qa-latrack.adavance.com") {
  throw new Error(`These seeds only run against QA (qa-latrack.adavance.com), not ${base.hostname}.`);
}

export const DEMO_COMPANY_SLUG = process.env.LATRACK_DEMO_COMPANY ?? "demo-media";

export function qaRun(body, params = {}) {
  const js = `
const { Client } = require(${JSON.stringify(PG)});
const P = ${JSON.stringify(params)};
const db = new Client({ connectionString: process.env.DATABASE_URL });
const out = (v) => console.log("RESULT " + JSON.stringify(v));
(async () => {
  await db.connect();
  try { ${body} } finally { await db.end(); }
})().catch((e) => { console.log("ERROR " + String(e && e.message || e).replace(/postgres(ql)?:\\/\\/\\S+/g, "<db>")); process.exit(1); });
`;
  const b64 = Buffer.from(js).toString("base64");
  const file = `/tmp/demo-${randomBytes(6).toString("hex")}.cjs`;
  const args = ["ssh", "-p", PROJECT, "-e", ENVIRONMENT, "-s", SERVICE, "--",
    "sh", "-c", `cd /app && echo ${b64} | base64 -d > ${file} && node ${file}; rm -f ${file}`];
  const raw = execFileSync("railway", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 8 << 20 });
  const lines = raw.split("\n").map((l) => l.replace(/\r/g, "").trim());
  const err = lines.find((l) => l.startsWith("ERROR "));
  if (err) throw new Error(`QA script failed: ${err.slice(6)}`);
  const res = lines.find((l) => l.startsWith("RESULT "));
  return res ? JSON.parse(res.slice(7)) : null;
}

/** The demo admin's password, read into memory from the local logins file. */
function adminCreds() {
  const j = JSON.parse(readFileSync(`${homedir()}/.config/latrack/logins.json`, "utf8"));
  const email = j.staging.demo.emails.find((e) => e.startsWith("admin@")) ?? j.staging.demo.emails[0];
  return { email, password: j.staging.demo.password };
}

/**
 * A storageState of the demo admin, cached for 50 minutes (the login form is
 * rate limited to 8 attempts per 15 min per email, and five demos × check +
 * record would hit it). The file is 600 and gitignored (demos/*\/.auth/).
 */
export async function adminSession(file) {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  if (existsSync(file) && Date.now() - statSync(file).mtimeMs < 50 * 60_000) {
    // Still valid on the server? A cheap probe: the console redirects to /login without a session.
    const state = JSON.parse(readFileSync(file, "utf8"));
    const c = state.cookies?.find((k) => k.name === "lt_session");
    if (c) {
      const r = await fetch(`${base.origin}/brands`, { headers: { cookie: `lt_session=${c.value}` }, redirect: "manual" });
      if (r.status === 200) return;
    }
  }
  const { chromium } = await import("playwright");
  const { email, password } = adminCreds();
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ locale: "es-US" });
    const page = await ctx.newPage();
    await page.goto(`${base.origin}/login`);
    await page.fill("#email", email);
    await page.fill("#password", password);
    await Promise.all([
      page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20_000 }),
      page.locator('form button[type="submit"]').first().click(),
    ]);
    const state = await ctx.storageState();
    writeFileSync(file, JSON.stringify(state), { mode: 0o600 });
    chmodSync(file, 0o600);
  } finally {
    await browser.close();
  }
}

// ── shared bits of the module seeds ─────────────────────────────────────────

import { appendFileSync as _append } from "node:fs";
import { fileURLToPath } from "node:url";
import { join as _join } from "node:path";

export const SEEDS_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
export const WORKSPACE = dirname(SEEDS_DIR);
export const STATE_DIR = _join(SEEDS_DIR, ".state");
/** The admin's cached session, read by the scripts' cast (`auth.via: storageState`). */
export const ADMIN_STATE = _join(WORKSPACE, ".auth", "modulos-admin.json");

/** Hands a value to the script (`${NAME}`), through the run's DEMO_VARS file. */
export function setVar(name, value) {
  const file = process.env.DEMO_VARS ?? _join(STATE_DIR, "vars.env");
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  _append(file, `${name}=${value}\n`, { mode: 0o600 });
}

/** Ids of the Demo Media world the module demos lean on. */
export const WORLD_JS = `
const co = (await db.query('select id from "Company" where slug = $1', [P.company])).rows[0];
if (!co) throw new Error("company " + P.company + " not found");
const brisa = (await db.query('select id from "Brand" where "companyId" = $1 and slug = $2', [co.id, "la-brisa"])).rows[0];
if (!brisa) throw new Error("brand la-brisa not found");
const houston = (await db.query('select s.id, (select url from "StreamSource" x where x."stationId" = s.id order by priority limit 1) as stream from "Station" s where s."brandId" = $1 and s.city = $2 order by s.position limit 1', [brisa.id, "Houston"])).rows[0];
const brisaApp = (await db.query('select a.id from "App" a join "AppBrand" ab on ab."appId" = a.id where ab."brandId" = $1 and a.name = $2 limit 1', [brisa.id, "La Brisa"])).rows[0];
`;

/**
 * Removes the "Demo …" items a module demo creates, by exact name and only inside
 * Demo Media, with the rows that point at them without a foreign key (uploaded
 * Asset rows, per-station rollups) and their audit-log lines. Returns the counts.
 */
export const DELETE_DEMO_JS = `
const del = { brands: 0, stations: 0, shows: 0, apps: 0, assets: 0, audit: 0 };
const ids = [];
const urls = [];
const brands = (await db.query('select id, "logoUrl" from "Brand" where "companyId" = $1 and name = any($2)', [co.id, P.del.brands ?? []])).rows;
const stations = (await db.query('select id from "Station" where "companyId" = $1 and (name = any($2) or "brandId" = any($3))', [co.id, P.del.stations ?? [], brands.map((b) => b.id)])).rows;
const shows = (await db.query('select id from "Show" where "companyId" = $1 and name = any($2)', [co.id, P.del.shows ?? []])).rows;
const apps = (await db.query('select id, "iconUrl", "splashUrl" from "App" where "companyId" = $1 and name = any($2)', [co.id, P.del.apps ?? []])).rows;
for (const r of [...brands, ...stations, ...shows, ...apps]) ids.push(r.id);
for (const r of brands) if (r.logoUrl) urls.push(r.logoUrl);
for (const r of apps) { if (r.iconUrl) urls.push(r.iconUrl); if (r.splashUrl) urls.push(r.splashUrl); }
const st = stations.map((s) => s.id);
if (st.length) for (const t of ["StationQuarterHour", "StationDailyStat", "StationRollupCoverage", "SponsorDeviceDay"])
  await db.query('delete from "' + t + '" where "stationId" = any($1)', [st]);
if (urls.length) del.assets = (await db.query('delete from "Asset" where "companyId" = $1 and exists (select 1 from unnest($2::text[]) u where u like \\'%\\' || "Asset".key)', [co.id, urls])).rowCount;
del.apps = (await db.query('delete from "App" where id = any($1)', [apps.map((a) => a.id)])).rowCount;
del.shows = (await db.query('delete from "Show" where id = any($1)', [shows.map((s) => s.id)])).rowCount;
del.stations = (await db.query('delete from "Station" where id = any($1)', [st])).rowCount;
del.brands = (await db.query('delete from "Brand" where id = any($1)', [brands.map((b) => b.id)])).rowCount;
if (ids.length) del.audit = (await db.query('delete from "AuditLog" where "companyId" = $1 and "entityId" = any($2)', [co.id, ids])).rowCount;
`;

/** Runs `extra` with the Demo Media world loaded and the named Demo items deleted first. */
export function resetDemo(del, extra = "", params = {}) {
  return qaRun(`${WORLD_JS}\n${DELETE_DEMO_JS}\n${extra}\nout({ del, world: { company: co.id, brisa: brisa.id, houston: houston?.id, brisaApp: brisaApp?.id }, ...(typeof result === "undefined" ? {} : { result }) });`, {
    company: DEMO_COMPANY_SLUG,
    del,
    ...params,
  });
}

/** `node seeds/<slug>.mjs` seeds; `node seeds/<slug>.mjs --cleanup` only removes. */
export const CLEANUP = process.argv.includes("--cleanup");
