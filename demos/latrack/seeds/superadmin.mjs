// Seed for superadmin (QA only): the Latrack team's own panel, /admin and /admin/builds.
//
// The seed leaves ONE demo request waiting at the top of "Pedidos de demo": the FICTITIOUS
// "Radio Sol de Laredo" (contact Héctor Villarreal, federicofiorottowork+latrack-onboarding@gmail.com,
// a real alias of the owner, the same one puesta-en-marcha uses). It is inserted as a row, so
// nothing is emailed by the seed. On camera the team creates the company from it, which sends
// the REAL first-admin invitation to that alias (Resend); the invitation is never accepted.
// "Entrar" opens Demo Media (existing QA data) and the build queue is La Brisa's own app (read
// only, its two 1.0.0 builds are demo data that stays).
//
// Every run starts clean and `--cleanup` removes everything this demo created: the company
// (cascade: brand, home draft, invitation), its audit lines and assets, and the demo request.
// The superadmin's session keeps pointing at Demo Media after "Entrar" (harmless).

import { COMPANY_ID, base, ensureSuperadminSession, isCleanup, remote } from "./_qa.mjs";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const EMAIL = "federicofiorottowork+latrack-onboarding@gmail.com";
const NAME = "Radio Sol de Laredo";
const SLUG = "radio-sol-de-laredo";
const REQ_ID = "demo_sa_req_laredo";

const [r] = remote(`
  const cos = (await q('select id from "Company" where slug like $1 and name = $2', [P.slug + '%', P.name])).map((c) => c.id);
  if (cos.length) {
    await q('delete from "Asset" where "companyId" = any($1)', [cos]);
    await q('delete from "AuditLog" where "companyId" = any($1)', [cos]);
    await q('delete from "Company" where id = any($1)', [cos]);
  }
  const reqs = await q('delete from "DemoRequest" where email = $1 and station = $2 returning id', [P.email, P.name]);
  if (!P.cleanup) {
    await q('insert into "DemoRequest" (id, name, station, email, cities, "createdAt") values ($1, $2, $3, $4, $5, now() - interval \\'14 minutes\\')',
      [P.req, 'Héctor Villarreal', P.name, P.email, 'Laredo 98.1 FM, Nuevo Laredo 101.5 FM']);
  }
  const demo = (await q('select count(*)::int n from "Company" where id = $1', [P.demo]))[0].n;
  const builds = (await q('select count(*)::int n from "AppBuild" b join "App" a on a.id = b."appId" where a."ownStore" and b.status in (\\'QUEUED\\', \\'BUILDING\\')'))[0].n;
  out({ companies: cos.length, requests: reqs.length, demo, builds });
`, { slug: SLUG, name: NAME, email: EMAIL, req: REQ_ID, demo: COMPANY_ID, cleanup: isCleanup });

console.log(`superadmin: removed ${r.companies} "${NAME}" compan${r.companies === 1 ? "y" : "ies"} and ${r.requests} demo request(s).`);
if (!isCleanup) {
  if (!r.demo) throw new Error("Demo Media is missing in QA.");
  if (!r.builds) console.warn("superadmin: WARNING, the build queue is empty (La Brisa's builds are gone?).");
  await ensureSuperadminSession();
  // Warm /admin and /admin/builds so the first `go` isn't a cold load.
  const here = dirname(fileURLToPath(import.meta.url));
  const c = JSON.parse(readFileSync(join(here, ".state", "superadmin-session.json"), "utf8")).cookies?.find((x) => x.name === "lt_session");
  for (const p of ["/admin", "/admin/builds", "/"]) await fetch(`${base.origin}${p}`, { headers: c ? { cookie: `lt_session=${c.value}` } : {} }).then((x) => x.arrayBuffer()).catch(() => {});
  console.log(`superadmin: "${NAME}" demo request waiting; ${r.builds} build(s) in the queue.`);
}
