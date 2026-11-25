// Seed for reporte-sponsor (Demo Media / La Brisa, QA only).
//
// The report needs a campaign with weeks of delivery. Instead of touching the real
// demo sponsor, the seed makes a paused COPY of "Mueblería Don Pepe · Pre-roll
// diciembre" named "Demo Mueblería Don Pepe · Pre-roll diciembre" (id
// demo-video-report), with copies of its creatives, daily stats and unique-device
// rows, and the report language reset to Spanish. Every run drops and recreates it.
//
// The read-only link is created ON CAMERA, and its token only exists in that page.
// A watcher waits for the new link row and re-keys it to a token it knows (same
// row, new hash), so the logged-out scene can open that very link: REPORT_URL.
// The token is written only to DEMO_VARS (600) and never printed. The video blurs
// the link field. `--cleanup` removes the copy (and its links).

import { createHash, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { base, ensureAdminSession, isCleanup, isWatch, remote, runWatch, setVar, startWatcher, stopWatcher , pruneDemoAudit } from "./_qa.mjs";

const SOURCE = "demo-sp-pepe-preroll";
const COPY = "demo-video-report";

if (isWatch) {
  const [since, hash] = process.argv.slice(3);
  runWatch(`
    while (Date.now() < deadline) {
      const r = await q('select id from "SponsorReportLink" where "sponsorId" = $1 and "createdAt" > $2 and "tokenHash" <> $3 order by "createdAt" desc limit 1', [P.copy, P.since, P.hash]);
      if (r.length) { await q('update "SponsorReportLink" set "tokenHash" = $1 where id = $2', [P.hash, r[0].id]); console.log("DEMO_VAR REPORT_READY=1"); break; }
      await sleep(400);
    }
  `, { copy: COPY, since, hash }, 20);
} else {
  stopWatcher("reporte");
  const [res] = remote(`
    await q('begin');
    await q('delete from "SponsorDeviceDay" where "sponsorId" = $1', [P.copy]);
    await q('delete from "Sponsor" where id = $1', [P.copy]);
    if (!P.cleanup) {
      const cols = (await q("select column_name from information_schema.columns where table_name = 'Sponsor'")).map((r) => '"' + r.column_name + '"');
      const over = { id: '$2', name: '$3', "isActive": 'false', "reportLocale": "'es'", "createdAt": 'now()', "updatedAt": 'now()' };
      const sel = cols.map((c) => over[c.slice(1, -1)] ?? c).join(', ');
      await q('insert into "Sponsor" (' + cols.join(', ') + ') select ' + sel + ' from "Sponsor" where id = $1', [P.source, P.copy, P.name]);
      for (const t of ['SponsorCreative', 'SponsorDailyStat', 'SponsorDeviceDay']) {
        const tc = (await q("select column_name from information_schema.columns where table_name = $1", [t])).map((r) => r.column_name);
        const s = tc.map((c) => c === 'sponsorId' ? '$2' : c === 'id' ? "'demo_' || md5(random()::text)" : '"' + c + '"').join(', ');
        await q('insert into "' + t + '" (' + tc.map((c) => '"' + c + '"').join(', ') + ') select ' + s + ' from "' + t + '" where "sponsorId" = $1', [P.source, P.copy]);
      }
    }
    await q('commit');
    out({ ok: true });
  `, { source: SOURCE, copy: COPY, name: "Demo Mueblería Don Pepe · Pre-roll diciembre", cleanup: isCleanup });
  if (!isCleanup) {
    const token = randomBytes(24).toString("base64url");
    const hash = createHash("sha256").update(token).digest("hex");
    setVar("REPORT_URL", `${base.origin}/r/${token}`);
    setVar("REPORT_PATH", `/sponsors/${COPY}?tab=report`);
    await ensureAdminSession();
    startWatcher("reporte", fileURLToPath(import.meta.url), [new Date().toISOString(), hash]);
  }
  pruneDemoAudit();
  console.log(`reporte-sponsor: ${isCleanup ? "removed" : "recreated"} the Demo copy of the Don Pepe pre-roll campaign${res?.ok ? "" : " (?)"}.`);
}
