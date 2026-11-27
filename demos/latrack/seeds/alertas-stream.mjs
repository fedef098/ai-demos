// Seed for alertas-stream (Demo Media / La Brisa, QA only).
//
// On camera Ana turns on Houston's alerts. For the "several stations down" banner the seed
// opens two FICTITIOUS incidents, Phoenix (no signal, 12 min) and Miami (silence, 7 min),
// with alerts on for those two stations and NO recipients, so no email can ever be queued
// for them; plus one closed Houston incident two days ago for the history. Houston starts
// with alerts off. Its recipients (demo.latrack.app) are not deliverable, and sendEmail skips
// undeliverable domains; `--cleanup` turns every alert off again and deletes the demo incidents.
// Incident ids start with demo_inc_. The stations' original alert configs are restored.

import { BRAND_ID, ensureAdminSession, isCleanup, remote, warm } from "./_qa.mjs";

const HOU = "cmwti8qye00024jo49jk43oi7", PHX = "cmwti8qz100054jo41wzysch9", MIA = "cmwti8qzl00084jo4ubha7xb1";

const [res] = remote(`
  const co = (await q('select "companyId" from "Brand" where id = $1', [P.b]))[0].companyId;
  await q("delete from \\"StationIncident\\" where id like 'demo_inc_%'");
  const reset = 'insert into "StationAlertConfig" ("stationId", "companyId", enabled, "recipientUserIds", "quietStartMin", "quietEndMin", "silenceEnabled", "downAfterMin", "silenceAfterMin", phase, "incidentId", "updatedAt") values ($1, $2, $3, $4, null, null, true, 3, 3, \\'OK\\', null, now()) on conflict ("stationId") do update set enabled = $3, "recipientUserIds" = $4, "quietStartMin" = null, "quietEndMin" = null, "silenceEnabled" = true, "downAfterMin" = 3, "silenceAfterMin" = 3, phase = \\'OK\\', "incidentId" = null';
  for (const s of [P.hou, P.phx, P.mia]) await q(reset, [s, co, false, []]);
  if (!P.cleanup) {
    for (const s of [P.phx, P.mia]) await q(reset, [s, co, true, []]);
    const ins = 'insert into "StationIncident" (id, "stationId", "companyId", kind, "startedAt", "confirmedAt", "endedAt") values ($1, $2, $3, $4, $5, $6, $7)';
    const ago = (m) => new Date(Date.now() - m * 60000);
    await q(ins, ["demo_inc_phx", P.phx, co, "DOWN", ago(12), ago(9), null]);
    await q(ins, ["demo_inc_mia", P.mia, co, "SILENCE", ago(7), ago(4), null]);
    await q(ins, ["demo_inc_hou", P.hou, co, "DOWN", ago(2 * 1440 + 95), ago(2 * 1440 + 92), ago(2 * 1440 + 86)]);
  }
  out({ ok: true });
`, { b: BRAND_ID, hou: HOU, phx: PHX, mia: MIA, cleanup: isCleanup });
if (!isCleanup) { await ensureAdminSession(); await warm(["/stations", `/stations/${HOU}`]); }
console.log(`alertas-stream: ${isCleanup ? "alerts off on the three stations, demo incidents removed" : "Phoenix and Miami down (fictitious, no recipients), Houston alerts off"}${res?.ok ? "" : " (?)"}.`);
