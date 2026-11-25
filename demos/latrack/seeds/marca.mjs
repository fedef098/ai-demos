// Seed for the "marca" module demo, against Latrack QA (never production).
//
// The video creates the brand "Demo Brisa Norte" on camera inside Demo Media,
// with its logo, colours, theme, socials and reel kit. This seed removes the one
// a previous run left (and its uploaded logo and audit lines) and refreshes the
// demo admin's session. Nothing else in Demo Media is touched.
//
//   node seeds/marca.mjs            seed (what bin/demo runs)
//   node seeds/marca.mjs --cleanup  only remove what the video created

import { ADMIN_STATE, CLEANUP, adminSession, resetDemo } from "./lib/qa.mjs";

const r = resetDemo({ brands: ["Demo Brisa Norte"] });
if (!CLEANUP) await adminSession(ADMIN_STATE);
console.log(`${CLEANUP ? "cleaned" : "seeded"}: removed ${r.del.brands} demo brand(s), ${r.del.assets} asset(s), ${r.del.audit} audit line(s).`);
