// Seed for reels (Demo Media / La Brisa, QA only).
//
// The reel "Demo: así suena El Despertador" is made ON CAMERA from the "Momento al
// aire" template and published to Shorts. The seed removes what earlier runs left:
// La Brisa's reel projects whose title starts with "Demo", the Shorts they published
// and any Short titled "Demo…", plus their Activity rows. Nothing else is touched.
// `--cleanup` does the same after recording (so the Short leaves the app's feed).

import { BRAND_ID, COMPANY_ID, ensureAdminSession, isCleanup, pruneDemoAudit, remote } from "./_qa.mjs";

const [res] = remote(`
  await q('begin');
  const reels = await q("select id, \\"shortId\\" from \\"ReelProject\\" where \\"brandId\\" = $1 and doc->>'title' like 'Demo%'", [P.brandId]);
  const ids = reels.map((r) => r.id);
  const shortIds = reels.map((r) => r.shortId).filter(Boolean);
  if (ids.length) {
    await q('delete from "ReelProject" where id = any($1)', [ids]);
    await q('delete from "AuditLog" where "companyId" = $1 and "entityId" = any($2)', [P.companyId, ids]);
  }
  const shorts = await q("delete from \\"Short\\" where \\"brandId\\" = $1 and (id = any($2) or title like 'Demo%') returning id", [P.brandId, shortIds]);
  await q('commit');
  out({ reels: ids.length, shorts: shorts.length });
`, { brandId: BRAND_ID, companyId: COMPANY_ID });

if (!isCleanup) await ensureAdminSession();
pruneDemoAudit();
console.log(`reels: removed ${res.reels} Demo reel(s) and ${res.shorts} Demo short(s).`);
