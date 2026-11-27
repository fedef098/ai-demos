// Seed for me-lo-perdi (Demo Media / La Brisa, QA only). Read-only video: the published
// segment "Entrevista: 15 años de la Taquería El Güero" (El Despertador) is demo data. The
// seed only checks it is published; nothing is created or changed.

import { BRAND_ID, ensureAdminSession, isCleanup, remote, warm } from "./_qa.mjs";

const [res] = remote(`
  const s = await q('select id, status from "Segment" where "brandId" = $1 and title = $2', [P.b, "Entrevista: 15 años de la Taquería El Güero"]);
  out({ s });
`, { b: BRAND_ID });
if (!res.s.length) throw new Error("me-lo-perdi: the El Güero segment is missing");
if (!isCleanup) { await ensureAdminSession(); await warm(["/segments"]); }
console.log(`me-lo-perdi: segment ${res.s[0].status ?? "?"}; nothing to seed.`);
