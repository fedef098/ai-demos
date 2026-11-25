// Seed for the "senales-streams" module demo, against Latrack QA (never production).
//
// The video looks at La Brisa 101.1 Houston (read only: stream status and the
// songs read from the stream) and creates the station "Demo La Brisa 1310
// Dallas" on camera, under La Brisa. This seed removes the one a previous run
// left (with its rollups and audit lines) and refreshes the admin's session.
//
//   node seeds/senales-streams.mjs            seed
//   node seeds/senales-streams.mjs --cleanup  only remove what the video created

import { ADMIN_STATE, CLEANUP, adminSession, resetDemo, setVar } from "./lib/qa.mjs";

const r = resetDemo({ stations: ["Demo La Brisa 1310 Dallas"] });
if (!CLEANUP) {
  await adminSession(ADMIN_STATE);
  setVar("HOUSTON_PATH", `/stations/${r.world.houston}`);
}
console.log(`${CLEANUP ? "cleaned" : "seeded"}: removed ${r.del.stations} demo station(s), ${r.del.audit} audit line(s).`);
