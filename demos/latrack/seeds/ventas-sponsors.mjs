// Seed for ventas-sponsors (Demo Media / La Brisa, QA only). Read-only video: the package
// "Pack Mañanas", the proposal for Taquería El Güero, its sponsored push (scheduled) and the
// report of the campaign that bought the package are demo data that already exists. The seed
// only checks they're there; the push composer is filled on camera but never sent.

import { COMPANY_ID, ensureAdminSession, warm, isCleanup, remote } from "./_qa.mjs";

const [res] = remote(`
  const pk = await q('select id from "SponsorPackage" where "companyId" = $1 and name = $2', [P.co, "Pack Mañanas"]);
  const pr = await q('select id from "Proposal" where "companyId" = $1 and "advertiserName" = $2', [P.co, "Taquería El Güero"]);
  const sp = await q('select id from "Sponsor" where id = $1 and package is not null', ["demo-sp-guero-banner"]);
  const push = await q('select id from "PushCampaign" where "sponsorId" = $1', ["demo-sp-guero-banner"]);
  out({ pk: pk.length, pr: pr.map((r) => r.id), sp: sp.length, push: push.length });
`, { co: COMPANY_ID });
if (!res.pk || !res.pr.length || !res.sp || !res.push) throw new Error(`ventas-sponsors: demo data missing ${JSON.stringify(res)}`);
if (!isCleanup) { await ensureAdminSession(); await warm(["/sponsors/packages", "/sponsors/proposals/cmwyxrleq000a01o45ahxfame", "/push?sponsor=demo-sp-guero-banner", "/sponsors/demo-sp-guero-banner?tab=report"]); }
console.log(`ventas-sponsors: Pack Mañanas, the El Güero proposal (${res.pr[0]}), its sponsored push and report are in place.`);
