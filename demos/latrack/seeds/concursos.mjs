// Seed for concursos (Demo Media / La Brisa, QA only).
//
// The poll "Demo ¿Qué canción ponemos a las 7?" is created ON CAMERA. The seed
// only removes the ones earlier runs left (every contest of La Brisa whose title
// starts with "Demo ", with their entries) and leaves a watcher waiting for the new
// one. When it appears, the watcher:
//   · writes CONTEST_PATH=/contests/<id> to DEMO_VARS (the console goes back to it);
//   · adds the votes other listeners cast during the morning show (41 entries with
//     installId "demo-vote-*"), so the results the listener's vote joins are not a
//     lonely 100 %. Declared in the script's `watch:` note.
// `--cleanup` removes the Demo polls, for after recording (an active poll would pop
// up in the listener app of every other demo).

import { fileURLToPath } from "node:url";
import { BRAND_ID, ensureAdminSession, isCleanup, isWatch, remote, runWatch, startWatcher, stopWatcher , pruneDemoAudit } from "./_qa.mjs";

const PREFIX = "Demo ";
// Votes per option, in the order the poll is typed on camera.
const VOTES = [14, 19, 8];

if (isWatch) {
  runWatch(`
    let id = null;
    while (Date.now() < deadline && !id) {
      const r = await q('select id, options from "Contest" where "brandId" = $1 and title like $2 and "createdAt" > $3 order by "createdAt" desc limit 1',
        [P.brandId, P.prefix + '%', P.since]);
      if (r.length && r[0].options.length >= P.votes.length) id = r[0].id; else await sleep(400);
    }
    if (id) {
      let n = 0;
      for (const [opt, count] of P.votes.entries())
        for (let i = 0; i < count; i++, n++)
          await q('insert into "ContestEntry" (id, "contestId", "installId", option, "createdAt") values ($1, $2, $3, $4, now() - make_interval(mins => $5)) on conflict do nothing',
            ['demo_vote_' + n + '_' + Date.now().toString(36), id, 'demo-vote-' + n, opt, 2 + (n * 7) % 50]);
      console.log("DEMO_VAR CONTEST_PATH=/contests/" + id);
    }
  `, { brandId: BRAND_ID, prefix: PREFIX, since: process.argv[3], votes: VOTES }, 20);
} else {
  stopWatcher("concursos");
  const [res] = remote(`
    const del = await q('delete from "Contest" where "brandId" = $1 and title like $2 returning id', [P.brandId, P.prefix + '%']);
    out({ deleted: del.length });
  `, { brandId: BRAND_ID, prefix: PREFIX });
  if (!isCleanup) {
    await ensureAdminSession();
    startWatcher("concursos", fileURLToPath(import.meta.url), [new Date().toISOString()]);
  }
  pruneDemoAudit();
  console.log(`concursos: removed ${res.deleted} earlier Demo poll(s)${isCleanup ? "" : "; watcher waiting for the new one"}.`);
}
