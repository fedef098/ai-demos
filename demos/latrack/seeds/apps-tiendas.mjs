// Seed for the "apps-tiendas" module demo, against Latrack QA (never production).
//
// The video completes the store listing of "Demo Brisa Norte", a second app for
// La Brisa that this seed creates half done: name, subtitle, description,
// support email and privacy policy are filled in; the icon and the bundle ids are
// missing, so the checklist starts with two items open. The ad rules start at
// Latrack's defaults (adRules null, one pre-roll per hour) and are changed on
// camera on this demo app only, so La Brisa's own app and its ad rules are never
// touched. The build button is shown, never clicked.
//
// Each run deletes the previous "Demo Brisa Norte" (with its uploaded icon and
// audit lines) and creates it again.
//
//   node seeds/apps-tiendas.mjs            seed
//   node seeds/apps-tiendas.mjs --cleanup  only remove what the video created

import { randomBytes } from "node:crypto";
import { ADMIN_STATE, CLEANUP, adminSession, resetDemo, setVar } from "./lib/qa.mjs";

const id = (p) => `demo_${p}_${randomBytes(8).toString("hex")}`;
const APP = "Demo Brisa Norte";

const extra = `
let result = null;
if (!P.cleanup) {
  await db.query('begin');
  await db.query(
    'insert into "App" (id, "companyId", name, mode, "publicKey", "storeSubtitle", "storeDescription", "supportEmail", "privacyUrl", "prerollCapMinutes", "updatedAt") values ($1, $2, $3, $4::"AppMode", $5, $6, $7, $8, $9, 60, now())',
    [P.appId, co.id, P.app, "SINGLE_BRAND", P.publicKey, "La regional del norte, en vivo",
     "La Brisa Norte en vivo las 24 horas: regional mexicana, los programas de siempre y lo que sonó. Pide tu canción y escríbele a la cabina desde la app.",
     "oyentes@brisanorte.example", "https://brisanorte.example/privacidad"],
  );
  await db.query('insert into "AppBrand" ("appId", "brandId", position) values ($1, $2, 0)', [P.appId, brisa.id]);
  await db.query('commit');
  result = { app: P.appId };
}
`;
const r = resetDemo({ apps: [APP] }, extra, { cleanup: CLEANUP, app: APP, appId: id("app"), publicKey: id("pk") });
if (!CLEANUP) {
  await adminSession(ADMIN_STATE);
  setVar("DEMO_APP_PATH", `/apps/${r.result.app}`);
}
console.log(`${CLEANUP ? "cleaned" : "seeded"}: removed ${r.del.apps} demo app(s), ${r.del.assets} asset(s), ${r.del.audit} audit line(s)${CLEANUP ? "." : `; "${APP}" created half done.`}`);
