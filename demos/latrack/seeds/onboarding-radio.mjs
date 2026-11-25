// Seed for onboarding-radio (v2), against Latrack QA (never production).
//
// The QA database is only reachable from inside Railway, so every write runs as a
// small pg script inside the `web` service of the `staging` environment.
//
// Each run leaves exactly the world the script starts from, so two runs record the
// same video:
//   · everything the previous run created is removed: the company "Radio Sol"
//     (slug radio-sol-demo) and its cascade (brands, stations, shows, slots, home,
//     apps, devices, listening sessions, studio messages, push campaigns...), plus
//     the rows that point at it WITHOUT a foreign key (uploaded Asset rows, the
//     per-station rollups) and Ramiro's user (so the invitation is accepted as a
//     new account);
//   · the company is created again, TRIALING, 30-day trial, no brand, no station,
//     no show, no app;
//   · an admin invitation for Ramiro with a fresh random token. Only its sha256
//     goes to the database; nothing is emailed (the invite is a plain row — the
//     video shows the email rendered from Latrack's own template, as a fixture).
//
// It hands the script its values through DEMO_VARS (600, see the engine's demo.sh):
//   INVITE_URL        https://qa…/invite/<token>   known now (the email's button)
//   APP_PATH          /apps/new                    the store listing is created on camera
//   PUSH_AT           <tomorrow>T06:00             the push is scheduled on camera
//   HOME_EDITOR_PATH  /brands/<id>/home            by the watcher, once the brand exists
//   APP_KEY           App.publicKey                by the watcher, once the app exists
//
// The last two only exist after their scene, so a WATCHER this seed leaves running
// in the background (`--watch`) polls the database and writes them as soon as they
// appear. It creates nothing: the show and the second station are created on camera.
// It exits when done, when the company disappears (the next seed deleted it) or
// after 25 minutes.
//
// Never prints the invite token, the database URL or the owner's password.

import { spawn, execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const PROJECT = process.env.LATRACK_RAILWAY_PROJECT ?? "391fb236-7c5c-4d85-b8b5-aa026ee9e66b"; // Latrack
const ENVIRONMENT = "staging"; // QA. Hard-coded on purpose: this seed never touches production.
const SERVICE = "web";
const PG = "/app/node_modules/.pnpm/pg@8.23.1/node_modules/pg";

const SLUG = "radio-sol-demo";
const OWNER_EMAIL = "federicofiorottowork+demo-ramiro+test@gmail.com";
const STREAM = process.env.DEMO_STREAM_URL ?? "https://ice1.somafm.com/u80s-128-mp3";

const base = new URL(process.env.DEMO_BASE_URL ?? "https://qa-latrack.adavance.com");
if (base.hostname !== "qa-latrack.adavance.com") {
  throw new Error(`This seed only runs against QA (qa-latrack.adavance.com), not ${base.hostname}.`);
}

const VARS = process.env.DEMO_VARS ?? join(here, ".state", "vars.env");
mkdirSync(dirname(VARS), { recursive: true, mode: 0o700 });
const PIDFILE = join(dirname(VARS), "latrack-watch.pid");
const setVar = (k, v) => appendFileSync(VARS, `${k}=${v}\n`, { mode: 0o600 });
const id = (p) => `demo_${p}_${randomBytes(8).toString("hex")}`;

/** argv for `railway ssh` running a CommonJS script inside the web container. */
function remoteArgs(js) {
  const b64 = Buffer.from(js).toString("base64");
  const file = `/tmp/demo-${randomBytes(6).toString("hex")}.cjs`;
  return ["ssh", "-p", PROJECT, "-e", ENVIRONMENT, "-s", SERVICE, "--",
    "sh", "-c", `cd /app && echo ${b64} | base64 -d > ${file} && node ${file}; rm -f ${file}`];
}

/** Common prelude of every remote script: a pg client on the service's own DATABASE_URL. */
const prelude = (params) => `
const { Client } = require(${JSON.stringify(PG)});
const P = ${JSON.stringify(params)};
const db = new Client({ connectionString: process.env.DATABASE_URL });
`;

// ── watcher mode ─────────────────────────────────────────────────────────────
if (process.argv[2] === "--watch") {
  const companyId = process.argv[3];
  const js = prelude({ companyId }) + `
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  await db.connect();
  const deadline = Date.now() + 25 * 60_000;
  let brandId = null, appKey = null;
  while (Date.now() < deadline) {
    const co = await db.query('select 1 from "Company" where id = $1', [P.companyId]);
    if (!co.rowCount) { console.log("DEMO_DONE gone"); break; }
    if (!brandId) {
      const b = await db.query('select id from "Brand" where "companyId" = $1 order by "createdAt" limit 1', [P.companyId]);
      if (b.rowCount) {
        brandId = b.rows[0].id;
        console.log("DEMO_VAR HOME_EDITOR_PATH=/brands/" + brandId + "/home");
      }
    }
    if (!appKey) {
      const a = await db.query('select "publicKey" from "App" where "companyId" = $1 order by "createdAt" limit 1', [P.companyId]);
      if (a.rowCount) {
        appKey = a.rows[0].publicKey;
        console.log("DEMO_VAR APP_KEY=" + appKey);
      }
    }
    if (brandId && appKey) { console.log("DEMO_DONE ok"); break; }
    await sleep(400);
  }
  await db.end();
})().catch((e) => { console.log("DEMO_ERROR " + e.message); process.exit(1); });
`;
  const child = spawn("railway", remoteArgs(js), { stdio: ["ignore", "pipe", "ignore"] });
  const stop = () => { child.kill("SIGTERM"); process.exit(0); };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  setTimeout(stop, 26 * 60_000).unref();
  let buf = "";
  child.stdout.on("data", (d) => {
    buf += d.toString();
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).replace(/\r/g, "").trim();
      buf = buf.slice(nl + 1);
      const v = /^DEMO_VAR ([A-Z0-9_]+)=(.*)$/.exec(line);
      if (v) { try { setVar(v[1], v[2]); } catch { /* the run is gone */ } }
      if (/^DEMO_(DONE|ERROR)/.test(line)) appendFileSync(join(dirname(VARS), "latrack-watch.log"), `${line}\n`);
    }
  });
  child.on("exit", () => process.exit(0));
} else {
  await seed();
}

// ── seed mode ────────────────────────────────────────────────────────────────
async function seed() {
  // A watcher left by a previous seed of this same run (demo.sh seeds twice:
  // before the targets walk and before recording) is stopped first.
  if (existsSync(PIDFILE)) {
    const pid = Number(readFileSync(PIDFILE, "utf8"));
    try {
      if (readFileSync(`/proc/${pid}/cmdline`, "utf8").includes("--watch")) process.kill(pid, "SIGTERM");
    } catch { /* already gone */ }
  }

  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const companyId = id("co");

  const js = prelude({ slug: SLUG, email: OWNER_EMAIL, companyId, invitationId: id("inv"), tokenHash }) + `
(async () => {
  await db.connect();
  await db.query('begin');
  // Rows that hang off the old company or its stations WITHOUT a foreign key: the
  // cascade below would leave them behind.
  const olds = (await db.query('select id from "Company" where slug = $1', [P.slug])).rows.map((r) => r.id);
  if (olds.length) {
    const st = (await db.query('select id from "Station" where "companyId" = any($1)', [olds])).rows.map((r) => r.id);
    for (const t of ["StationQuarterHour", "StationDailyStat", "StationRollupCoverage", "SponsorDeviceDay"])
      if (st.length) await db.query('delete from "' + t + '" where "stationId" = any($1)', [st]);
    await db.query('delete from "Asset" where "companyId" = any($1)', [olds]);
  }
  const old = await db.query('delete from "Company" where slug = $1 returning id', [P.slug]);
  const users = await db.query('delete from "User" where email = $1 returning id', [P.email]);
  await db.query(
    'insert into "Company" (id, name, slug, country, "subscriptionStatus", "trialEndsAt", "updatedAt") values ($1, $2, $3, $4, $5::"SubscriptionStatus", now() + interval \\'30 days\\', now())',
    [P.companyId, "Radio Sol", P.slug, "US", "TRIALING"],
  );
  await db.query(
    'insert into "Invitation" (id, "companyId", email, role, "tokenHash", "expiresAt") values ($1, $2, $3, $4::"MembershipRole", $5, now() + interval \\'7 days\\')',
    [P.invitationId, P.companyId, P.email, "COMPANY_ADMIN", P.tokenHash],
  );
  await db.query('commit');
  console.log("SEED_RESULT " + JSON.stringify({ deletedCompanies: old.rowCount, deletedUsers: users.rowCount }));
  await db.end();
})().catch((e) => { console.log("SEED_ERROR " + e.message); process.exit(1); });
`;
  const out = execFileSync("railway", remoteArgs(js), { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 1 << 20 });
  const line = out.split("\n").map((l) => l.replace(/\r/g, "").trim()).find((l) => /^SEED_(RESULT|ERROR) /.test(l));
  if (!line || line.startsWith("SEED_ERROR")) throw new Error(`Seed failed: ${line ?? "no result line"}`);
  const result = JSON.parse(line.slice("SEED_RESULT ".length));

  setVar("INVITE_URL", `${base.origin}/invite/${token}`);
  setVar("APP_PATH", "/apps/new");
  setVar("PUSH_AT", `${tomorrowIn("America/Chicago")}T06:00`);

  const watcher = spawn(process.execPath, [fileURLToPath(import.meta.url), "--watch", companyId], {
    detached: true,
    stdio: "ignore",
    env: { ...process.env, DEMO_VARS: VARS },
  });
  writeFileSync(PIDFILE, String(watcher.pid), { mode: 0o600 });
  watcher.unref();

  console.log(
    `seeded: company "Radio Sol" (${SLUG}) recreated (removed ${result.deletedCompanies} old, ${result.deletedUsers} user), ` +
      `invitation pending for Ramiro; watcher ${watcher.pid} waiting for the brand and the app.`,
  );
}

/** Tomorrow's date (YYYY-MM-DD) in a time zone: the push is scheduled for 06:00 there. */
function tomorrowIn(timeZone) {
  const d = new Date(Date.now() + 24 * 3600_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
