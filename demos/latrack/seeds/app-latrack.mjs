// Seed for app-latrack (Demo Media / La Brisa + the onboarding demo's Radio Sol, QA only).
//
// Read-only video of the single Latrack listener app. Two things would spoil it:
//   · a "Demo …" poll left by the concursos video (it pops up when La Brisa opens): removed;
//   · QA has two radios named "Radio Sol" (the onboarding demo's, radio-sol-6j0cno, and an
//     older QA fixture, company radio-sol-qa). Searching "Radio Sol" would list the same card
//     twice, so the QA fixture is taken out of the Latrack search while recording and put back
//     by `--cleanup` (its link keeps working either way). Nothing else is created or changed.

import { BRAND_ID, ensureAdminSession, warm, isCleanup, remote } from "./_qa.mjs";

const DUPLICATE = "cmwup4265000401pi6jyo3gus"; // Radio Sol (company radio-sol-qa)

const [res] = remote(`
  const del = P.cleanup ? [] : await q('delete from "Contest" where "brandId" = $1 and title like $2 returning id', [P.brandId, 'Demo %']);
  const r = await q('update "Brand" set "listedInLatrack" = $2 where id = $1 returning id', [P.dup, P.cleanup]);
  out({ deleted: del.length, dup: r.length });
`, { brandId: BRAND_ID, dup: DUPLICATE, cleanup: isCleanup });
if (!isCleanup) { await ensureAdminSession(); await warm(["/apps"]); }
console.log(`app-latrack: ${isCleanup ? "duplicate Radio Sol back in search" : `removed ${res.deleted} leftover Demo poll(s); duplicate Radio Sol out of search`}${res.dup ? "" : " (duplicate not found)"}.`);
