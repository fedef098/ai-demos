// Seed for app-oyente (Demo Media / La Brisa, QA only). Read-only video: the
// listener app and the public web player show La Brisa's existing demo data. The
// only thing that matters is that no "Demo …" poll from another video is still
// active (it would pop up when the app opens), so leftovers of the concursos video
// are removed. Nothing else is created or changed.

import { BRAND_ID, remote } from "./_qa.mjs";

const [res] = remote(`
  const del = await q('delete from "Contest" where "brandId" = $1 and title like $2 returning id', [P.brandId, 'Demo %']);
  out({ deleted: del.length });
`, { brandId: BRAND_ID });
console.log(`app-oyente: nothing to seed (read-only); removed ${res.deleted} leftover Demo poll(s).`);
