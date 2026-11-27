// Seed for emails (Demo Media / La Brisa, QA only).
//
// The emails on camera are NOT sent: they are Latrack's real templates rendered by
// seeds/render-emails.ts into fixtures/correo/*.html and served by the engine at
// https://correo.latrack-demo.invalid/<id>. Nothing in this video sends an email.
//
// For the console moment of the alerts, Houston's alerts are turned on with Ana and Diego as
// recipients (both @demo.latrack.app, which sendEmail skips as undeliverable, so even a real
// incident during the recording could not email anyone). `--cleanup` puts Houston back as it
// was found: alerts off, no recipients. The team form is typed on camera but never submitted.

import { ADMIN_EMAIL, BRAND_ID, ensureAdminSession, isCleanup, remote, warm } from "./_qa.mjs";

const HOU = "cmwti8qye00024jo49jk43oi7";

const [r] = remote(`
  const co = (await q('select "companyId" from "Brand" where id = $1', [P.b]))[0].companyId;
  const users = (await q('select u.id from "User" u join "Membership" m on m."userId" = u.id where m."companyId" = $1 and u.name = any($2)', [co, ['Ana Morales', 'Diego Ruiz']])).map((u) => u.id);
  const on = !P.cleanup;
  await q('insert into "StationAlertConfig" ("stationId", "companyId", enabled, "recipientUserIds", "quietStartMin", "quietEndMin", "silenceEnabled", "downAfterMin", "silenceAfterMin", phase, "incidentId", "updatedAt") values ($1, $2, $3, $4, null, null, true, $5, 3, \\'OK\\', null, now()) on conflict ("stationId") do update set enabled = $3, "recipientUserIds" = $4, "quietStartMin" = null, "quietEndMin" = null, "silenceEnabled" = true, "downAfterMin" = $5, "silenceAfterMin" = 3',
    [P.hou, co, on, on ? users : [], on ? 5 : 3]);
  out({ recipients: on ? users.length : 0 });
`, { b: BRAND_ID, hou: HOU, cleanup: isCleanup });

if (!isCleanup) {
  await ensureAdminSession();
  await warm([`/stations/${HOU}`, "/team"]);
}
console.log(`emails: Houston alerts ${isCleanup ? "off, no recipients (as found)" : `on, ${r.recipients} recipients (${ADMIN_EMAIL.split("@")[1]}, never delivered)`}; nothing is emailed.`);
