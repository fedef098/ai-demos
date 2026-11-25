// Seed for the "programacion" module demo, against Latrack QA (never production).
//
// The video creates the show "Demo Sábado Ranchero" on camera, puts it in La
// Brisa 101.1 Houston's grid on weekends at 07:00-10:00 (a gap in that grid), and
// copies Houston's grid to "Demo La Brisa 1310 Los Ángeles", a station this seed
// creates empty (Pacific time, so the copy shows the time-zone note).
//
// Each run removes the show (its slots go with it) and the demo station, plus
// their audit lines and the Houston schedule lines the video wrote, and creates
// the empty demo station again. Houston's own grid is never changed: the only
// slots added to it belong to the demo show.
//
//   node seeds/programacion.mjs            seed
//   node seeds/programacion.mjs --cleanup  only remove what the video created

import { randomBytes } from "node:crypto";
import { ADMIN_STATE, CLEANUP, adminSession, resetDemo } from "./lib/qa.mjs";

const id = (p) => `demo_${p}_${randomBytes(8).toString("hex")}`;
const STATION = "Demo La Brisa 1310 Los Ángeles";

const extra = `
// Lines the video wrote on Houston's grid (adding the demo show's slots).
if (houston) del.audit += (await db.query('delete from "AuditLog" where "companyId" = $1 and "entityId" = $2 and action like $3 and summary like $4', [co.id, houston.id, "schedule.%", "%Demo Sábado Ranchero%"])).rowCount;
let result = null;
if (!P.cleanup) {
  await db.query('begin');
  const pos = (await db.query('select coalesce(max(position), 0) + 1 as p from "Station" where "brandId" = $1', [brisa.id])).rows[0].p;
  await db.query('insert into "Station" (id, "companyId", "brandId", name, city, region, country, timezone, position, "updatedAt") values ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())',
    [P.stationId, co.id, brisa.id, P.station, "Los Ángeles", "CA", "US", "America/Los_Angeles", pos]);
  await db.query('insert into "Frequency" (id, "stationId", band, value) values ($1, $2, $3::"Band", $4)', [P.freqId, P.stationId, "AM", "1310"]);
  await db.query('insert into "StreamSource" (id, "stationId", kind, url, priority, "updatedAt") values ($1, $2, $3::"StreamKind", $4, 0, now())', [P.streamId, P.stationId, "ICECAST", houston.stream]);
  await db.query('commit');
  result = { station: P.stationId };
}
`;
const r = resetDemo({ shows: ["Demo Sábado Ranchero"], stations: [STATION] }, extra, {
  cleanup: CLEANUP,
  station: STATION,
  stationId: id("st"),
  freqId: id("fq"),
  streamId: id("ss"),
});
if (!CLEANUP) await adminSession(ADMIN_STATE);
console.log(
  `${CLEANUP ? "cleaned" : "seeded"}: removed ${r.del.shows} demo show(s), ${r.del.stations} demo station(s), ${r.del.audit} audit line(s)` +
    (CLEANUP ? "." : `; "${STATION}" created empty.`),
);
