// Seed for promociona-tu-radio (Demo Media / La Brisa, QA only).
//
// The campaigns "Feria de Primavera" (event) and "Al aire — Mañanas" (on air) are demo data
// that stays. They were created with almost no traffic, so the seed gives them three weeks of
// believable history — taps by day and opens of the app from their link — and dates them
// before it (createdAt). It only SETS those day rows (idempotent; no store taps or installs,
// because the Latrack app isn't in the stores yet and the console says so).
//
// On camera Ana creates "Instagram — Diciembre": every run deletes it first, and `--cleanup`
// deletes it with its stats.

import { BRAND_ID, ensureAdminSession, warm, isCleanup, remote } from "./_qa.mjs";

const NEW = "Instagram — Diciembre";

// day offset (from today, UTC) → [web taps, app opens]
const HISTORY = {
  "feria-de-primavera": { "-6": [21, 4], "-5": [34, 7], "-4": [12, 3], "-1": [5, 1] },
  "al-aire-mananas": { "-20": [6, 2], "-19": [8, 3], "-18": [5, 2], "-17": [9, 4], "-16": [7, 3], "-13": [8, 2], "-12": [11, 4], "-11": [6, 3], "-10": [9, 3], "-9": [7, 2], "-6": [10, 4], "-5": [8, 3], "-4": [6, 2], "-3": [9, 4], "-2": [12, 5] },
};

const [res] = remote(`
  const gone = await q('delete from "PromoCampaign" where "brandId" = $1 and name = $2 returning code', [P.brandId, P.name]);
  for (const g of gone) {
    await q('delete from "PromoLinkStat" where "brandId" = $1 and code = $2', [P.brandId, g.code]);
    await q('delete from "PromoAppStat" where "brandId" = $1 and code = $2', [P.brandId, g.code]);
  }
  let rows = 0;
  if (!P.cleanup) {
    for (const [code, days] of Object.entries(P.history)) {
      await q('update "PromoCampaign" set "createdAt" = least("createdAt", now() - interval \\'24 days\\') where "brandId" = $1 and code = $2', [P.brandId, code]);
      for (const [off, [web, opens]] of Object.entries(days)) {
        const day = new Date(Date.now() + Number(off) * 86400000).toISOString().slice(0, 10);
        await q('insert into "PromoLinkStat" ("brandId", code, day, target, count) values ($1, $2, $3, $4, $5) on conflict ("brandId", code, day, target) do update set count = excluded.count', [P.brandId, code, day, "WEB_PLAYER", web]);
        await q('insert into "PromoAppStat" ("brandId", code, day, event, count) values ($1, $2, $3, $4, $5) on conflict ("brandId", code, day, event) do update set count = excluded.count', [P.brandId, code, day, "OPEN", opens]);
        rows++;
      }
    }
  }
  out({ gone: gone.length, rows });
`, { brandId: BRAND_ID, name: NEW, history: HISTORY, cleanup: isCleanup });
if (!isCleanup) { await ensureAdminSession(); await warm(["/brands/cmwti8qxj00014jo472ejga6p?tab=promo"]); }
console.log(`promociona-tu-radio: removed ${res.gone} "${NEW}"${isCleanup ? "" : `; ${res.rows} days of campaign history set`}.`);
