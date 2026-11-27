// Seed for cabina-voz-foto (Demo Media / La Brisa, QA only).
//
// On camera a FICTITIOUS listener, "Vero Salinas", sends a voice note (assets/cabina-nota-voz.wav,
// a synthetic voice fed to the browser's fake microphone) and a photo (assets/cabina-foto-carro.jpg)
// from the app. Every run and `--cleanup` delete Vero's messages only; Marisol's stay. The voice
// note and photo switches of La Brisa are left on.

import { BRAND_ID, ensureAdminSession, isCleanup, remote, warm } from "./_qa.mjs";

const [res] = remote(`
  const st = (await q('select id from "Station" where "brandId" = $1', [P.b])).map((r) => r.id);
  const del = await q('delete from "StudioMessage" where "stationId" = any($1) and name = $2 returning id', [st, P.name]);
  await q('update "Brand" set "cabinaVoiceNotes" = true, "cabinaPhotos" = true where id = $1', [P.b]);
  await q('delete from "Contest" where "brandId" = $1 and title like $2', [P.b, 'Demo %']);
  out({ del: del.length });
`, { b: BRAND_ID, name: "Vero Salinas" });
if (!isCleanup) { await ensureAdminSession(); await warm(["/inbox", "/brands/cmwti8qxj00014jo472ejga6p"]); }
console.log(`cabina-voz-foto: removed ${res.del} message(s) from Vero Salinas.`);
