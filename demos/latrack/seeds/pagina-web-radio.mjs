// Seed for pagina-web-radio (Demo Media / La Brisa, QA only).
//
// On camera Ana hides a section of La Brisa's public page and moves another one up in "Tu
// página web", and saves. The first run snapshots La Brisa's page config (Brand.webPage) to
// seeds/.state/webpage-la-brisa.json; every run and `--cleanup` put that snapshot back.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { BRAND_ID, ensureAdminSession, isCleanup, remote, warm } from "./_qa.mjs";

const SNAP = join(fileURLToPath(new URL(".", import.meta.url)), ".state", "webpage-la-brisa.json");
if (!existsSync(SNAP)) {
  const [r] = remote(`out({ wp: (await q('select "webPage" from "Brand" where id = $1', [P.b]))[0].webPage });`, { b: BRAND_ID });
  writeFileSync(SNAP, JSON.stringify(r.wp), { mode: 0o600 });
}
const wp = JSON.parse(readFileSync(SNAP, "utf8"));
remote(`await q('update "Brand" set "webPage" = $2::jsonb where id = $1', [P.b, P.wp === null ? null : JSON.stringify(P.wp)]); out({ ok: true });`, { b: BRAND_ID, wp });
if (!isCleanup) { await ensureAdminSession(); await warm(["/get/cmwti8qxj00014jo472ejga6p", "/web/cmwti8qxj00014jo472ejga6p"]); }
console.log(`pagina-web-radio: La Brisa's web page config ${isCleanup ? "restored" : "reset to the snapshot"}.`);
