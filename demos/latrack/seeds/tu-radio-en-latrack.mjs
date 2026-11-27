// Seed for tu-radio-en-latrack (Demo Media / La Brisa, QA only).
//
// The video flips two things on camera, both on La Brisa: the "Aparece en el buscador" switch
// (off and back on) and the Shorts feature (off, saved, then seen on the phone). The seed starts
// from the known state — listed, every listener feature on, Spanish by default — and
// `--cleanup` puts it back, so La Brisa never stays without Shorts. Also drops "Demo …" polls
// (they would pop up on the phone).

import { APP_ID, BRAND_ID, ensureAdminSession, warm, isCleanup, remote } from "./_qa.mjs";

const [res] = remote(`
  await q('delete from "Contest" where "brandId" = $1 and title like $2', [P.brandId, 'Demo %']);
  await q('update "Brand" set "listedInLatrack" = true where id = $1', [P.brandId]);
  const r = await q('update "App" set "featureShorts" = true, "featureSchedule" = true, "featureWhatsapp" = true, "featureContests" = true, "featureSleepTimer" = true, "featureAlarm" = true, "featureCarPlay" = true, "defaultLocale" = $2 where id = $1 returning id', [P.appId, "es"]);
  out({ app: r.length });
`, { brandId: BRAND_ID, appId: APP_ID });
if (!isCleanup) { await ensureAdminSession(); await warm(["/apps", "/listen/cmwti8qxj00014jo472ejga6p"]); }
console.log(`tu-radio-en-latrack: La Brisa listed, every listener feature on${res.app ? "" : " (app not found!)"}.`);
