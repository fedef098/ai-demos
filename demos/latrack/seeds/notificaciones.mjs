// Seed for notificaciones (Demo Media / La Brisa, QA only).
//
// · Removes the push campaigns earlier runs left (La Brisa app, title "Demo …").
// · La Brisa has no phone with notifications on in QA, so the composer would say
//   "Llega a 0 dispositivos". The seed registers 48 listener devices in Houston
//   with notifications on (installId "demo-video-push-*", tokens that are not real
//   Expo tokens: nothing can ever be delivered to them). `--cleanup` removes them
//   and the Demo campaigns right after recording, so nobody else's push counts them.
// · PUSH_AT = tomorrow 17:00 Houston time; the push is scheduled on camera and then
//   canceled on camera — nothing is ever sent.

import { APP_ID, STATIONS, dayIn, ensureAdminSession, isCleanup, remote, setVar , pruneDemoAudit } from "./_qa.mjs";

const DEVICES = 48;

const [res] = remote(`
  await q('begin');
  const camp = await q('delete from "PushCampaign" where "appId" = $1 and title like $2 returning id', [P.appId, 'Demo%']);
  const dev = await q('delete from "Device" where "appId" = $1 and "installId" like $2 returning id', [P.appId, 'demo-video-push-%']);
  if (!P.cleanup) {
    for (let i = 0; i < P.devices; i++)
      await q('insert into "Device" (id, "appId", "installId", platform, "pushToken", locale, "brandId", "stationId", "pushOptIn", "lastSeenAt") values ($1, $2, $3, $4, $5, $6, $7, $8, true, now() - make_interval(hours => $9))',
        ['demo_dev_' + i + '_' + Date.now().toString(36), P.appId, 'demo-video-push-' + i, i % 3 ? 'ios' : 'android',
         'demo-not-a-token-' + i, 'es', P.brandId, P.houston, i % 30]);
  }
  await q('commit');
  out({ campaigns: camp.length, devices: dev.length });
`, { appId: APP_ID, brandId: "cmwti8qxj00014jo472ejga6p", houston: STATIONS.houston, devices: DEVICES, cleanup: isCleanup });

if (!isCleanup) {
  setVar("PUSH_AT", `${dayIn("America/Chicago", 1)}T17:00`);
  await ensureAdminSession();
}
pruneDemoAudit();
console.log(`notificaciones: removed ${res.campaigns} Demo campaign(s) and ${res.devices} demo device(s)${isCleanup ? "" : `; registered ${DEVICES} demo devices in Houston`}.`);
