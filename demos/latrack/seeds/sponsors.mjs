// Seed for sponsors (Demo Media / La Brisa, QA only).
//
// The campaign "Demo Taquería El Güero" is created ON CAMERA. The seed only removes
// the ones earlier runs left (every sponsor of Demo Media named "Demo Taquería…", with its
// creatives and stats). The real demo sponsors (Mueblería Don Pepe, the existing
// Taquería El Güero banner) are never touched. `--cleanup` does the same removal.

import { COMPANY_ID, ensureAdminSession, isCleanup, remote , pruneDemoAudit } from "./_qa.mjs";

const [res] = remote(`
  const ids = (await q('select id from "Sponsor" where "companyId" = $1 and name like $2', [P.companyId, 'Demo Taquería%'])).map((r) => r.id);
  if (ids.length) {
    await q('update "Contest" set "sponsorId" = null where "sponsorId" = any($1)', [ids]);
    await q('delete from "SponsorDeviceDay" where "sponsorId" = any($1)', [ids]);
    await q('delete from "Sponsor" where id = any($1)', [ids]);
  }
  out({ deleted: ids.length });
`, { companyId: COMPANY_ID });

if (!isCleanup) await ensureAdminSession();
pruneDemoAudit();
console.log(`sponsors: removed ${res.deleted} earlier Demo sponsor(s).`);
