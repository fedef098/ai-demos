// Seed for tus-apps (Demo Media / La Brisa, QA only). Read only.
//
// The video walks "Tus apps": La Brisa in Latrack, then La Brisa's own store app (created on QA
// on 2026-11-27, demo data that stays) with its client checklist and the two queued 1.0.0
// builds, then the superadmin build queue and the listener phone on the own app's web preview
// (`?app=<publicKey>` on 127.0.0.1:8788). Nothing is written: the seed only checks that the
// own app and its queued builds are there, mints the admin and superadmin sessions and warms
// the pages the video opens.

import { BRAND_ID, ensureAdminSession, ensureSuperadminSession, isCleanup, remote, warm } from "./_qa.mjs";

export const OWN_APP_ID = "cmwz6uubq000201r0mnuy2ipo";

if (isCleanup) {
  console.log("tus-apps: nothing to clean up (read only).");
  process.exit(0);
}

const [st] = remote(`
  const app = await q('select id, "publicKey" from "App" where id = $1 and "ownStore" = true', [P.appId]);
  const builds = await q('select platform, status from "AppBuild" where "appId" = $1 and status = $2', [P.appId, 'QUEUED']);
  const brand = await q('select "ownAppId" from "Brand" where id = $1', [P.brandId]);
  out({ app: app.length, queued: builds.map((b) => b.platform).sort().join(","), linked: brand[0]?.ownAppId === P.appId });
`, { appId: OWN_APP_ID, brandId: BRAND_ID });
if (!st.app || st.queued !== "android,ios" || !st.linked) {
  throw new Error(`tus-apps: La Brisa's own app is not as expected (app ${st.app}, queued ${st.queued}, linked ${st.linked}).`);
}
await ensureAdminSession();
await ensureSuperadminSession();
await warm([`/apps/${BRAND_ID}`, "/apps/own", `/apps/own/${OWN_APP_ID}`]);
console.log("tus-apps: La Brisa's own app with iOS and Android 1.0.0 queued; sessions ready.");
