// Seed for puesta-en-marcha (QA only): the whole path of a new radio, on camera.
//
// The story creates, through the real UI: a demo request on /producto#demo for the FICTITIOUS
// "Radio Sol de Tucson" (contact federicofiorottowork+latrack-onboarding@gmail.com, a real
// alias of the owner, so the confirmation and the invitation emails land in a real inbox); the
// company from that request in /admin ("Crear empresa"); the owner's account from the
// invitation; the brand's logo and colours; the first station with its stream.
//
// What would be tedious on camera is seeded by a watcher while the video runs:
//   · the invitation link: /admin shows it once and only its sha256 is stored, so the watcher
//     re-keys the new invitation with a token of its own and hands the engine INVITE_URL
//     (the emailed link stops working; the address is ours and the company is fictitious);
//   · once the station exists: three shows covering the day, every day, and a published home.
//
// Every run starts clean and `--cleanup` removes everything: the company (cascade), the rows
// that point at it without a foreign key (assets, per-station rollups, link stats), the owner's
// user and the demo requests of that email. Nothing else in QA is touched.

import { createHash, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  base, ensureSuperadminSession, isCleanup, isWatch, remote, runWatch, startWatcher, stopWatcher,
} from "./_qa.mjs";

export const EMAIL = "federicofiorottowork+latrack-onboarding@gmail.com";
const NAME = "Radio Sol de Tucson";
const SLUG = "radio-sol-de-tucson";

if (isWatch) {
  const since = process.argv[3];
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  runWatch(`
    let invited = false, scheduled = false;
    while (Date.now() < deadline && !(invited && scheduled)) {
      if (!invited) {
        const inv = await q('select i.id from "Invitation" i join "Company" c on c.id = i."companyId" where i.email = $1 and c.slug like $2 and i."createdAt" > $3 and i."acceptedAt" is null order by i."createdAt" desc limit 1', [P.email, P.slug + '%', P.since]);
        if (inv.length) {
          await q('update "Invitation" set "tokenHash" = $2 where id = $1', [inv[0].id, P.tokenHash]);
          console.log('DEMO_VAR INVITE_URL=' + P.origin + '/invite/' + P.token);
          invited = true;
        }
      }
      if (!scheduled) {
        const st = await q('select s.id, s."companyId", s."brandId", b.name from "Station" s join "Company" c on c.id = s."companyId" join "Brand" b on b.id = s."brandId" where c.slug like $1 order by s."createdAt" limit 1', [P.slug + '%']);
        if (st.length) {
          const { id: stationId, companyId, brandId, name } = st[0];
          const shows = [
            ['Despierta Tucson', 'Marta Ocampo, El Güero Félix', 300, 720],
            ['La Tarde Sonorense', 'Rocío Leyva', 720, 1200],
            ['Noches del Desierto', 'DJ Ramón', 1200, 1440],
          ];
          for (const [i, [show, hosts, from, to]] of shows.entries()) {
            const showId = 'demo_pm_show_' + i + '_' + stationId.slice(-6);
            await q('insert into "Show" (id, "companyId", "brandId", name, hosts, "updatedAt") values ($1, $2, $3, $4, $5, now()) on conflict (id) do nothing', [showId, companyId, brandId, show, hosts]);
            for (let d = 0; d < 7; d++) {
              await q('insert into "ScheduleSlot" (id, "stationId", "showId", weekday, "startMin", "endMin") values ($1, $2, $3, $4, $5, $6) on conflict (id) do nothing', [showId + '_d' + d, stationId, showId, d, from, to]);
            }
          }
          const blocks = [
            { id: 'hero', type: 'hero', style: 'show', hidden: false },
            { id: 'schedule', type: 'schedule', mode: 'today', title: 'Hoy en ' + name, hidden: false },
            { id: 'studio', type: 'studio', title: 'Escríbele a la cabina', hidden: false, allowRequests: true },
            { id: 'recent', type: 'recentlyPlayed', limit: 8, title: 'Lo que sonó', hidden: false },
            { id: 'shows', type: 'shows', title: 'Nuestros programas', hidden: false },
          ];
          for (const state of ['DRAFT', 'PUBLISHED']) {
            await q('insert into "HomeLayout" (id, "brandId", state, blocks, "publishedAt", "updatedAt") values ($1, $2, $3::"LayoutState", $4::jsonb, $5, now()) on conflict ("brandId", state) do nothing', ['demo_pm_home_' + state.toLowerCase() + '_' + brandId.slice(-6), brandId, state, JSON.stringify(blocks), state === 'PUBLISHED' ? new Date() : null]);
          }
          console.log('DEMO_VAR SCHEDULED=1');
          scheduled = true;
        }
      }
      await sleep(700);
    }
  `, { email: EMAIL, slug: SLUG, since, origin: base.origin, token, tokenHash }, 25);
} else {
  stopWatcher("puesta-en-marcha");
  const [r] = remote(`
    const cos = (await q('select id from "Company" where slug like $1 and name = $2', [P.slug + '%', P.name])).map((c) => c.id);
    let stations = 0, brands = [];
    if (cos.length) {
      const st = (await q('select id from "Station" where "companyId" = any($1)', [cos])).map((s) => s.id);
      stations = st.length;
      brands = (await q('select id from "Brand" where "companyId" = any($1)', [cos])).map((b) => b.id);
      for (const t of ['StationQuarterHour', 'StationDailyStat', 'StationRollupCoverage', 'SponsorDeviceDay'])
        if (st.length) await q('delete from "' + t + '" where "stationId" = any($1)', [st]);
      if (brands.length) await q('delete from "PromoLinkStat" where "brandId" = any($1)', [brands]);
      await q('delete from "Asset" where "companyId" = any($1)', [cos]);
      await q('delete from "AuditLog" where "companyId" = any($1)', [cos]);
      await q('delete from "Company" where id = any($1)', [cos]);
    }
    const users = await q('delete from "User" where email = $1 returning id', [P.email]);
    const reqs = await q('delete from "DemoRequest" where email = $1 returning id', [P.email]);
    out({ companies: cos.length, stations, users: users.length, requests: reqs.length });
  `, { slug: SLUG, name: NAME, email: EMAIL });
  console.log(`puesta-en-marcha: removed ${r.companies} "${NAME}" compan${r.companies === 1 ? "y" : "ies"}, ${r.users} owner user, ${r.requests} demo request(s).`);
  if (!isCleanup) {
    await ensureSuperadminSession();
    const pid = startWatcher("puesta-en-marcha", fileURLToPath(import.meta.url), [new Date().toISOString()]);
    console.log(`puesta-en-marcha: watcher ${pid} waits for the invitation (INVITE_URL) and the station (schedule + home).`);
  }
}
