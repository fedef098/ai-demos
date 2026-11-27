// Seed for concursos-consentimiento (Demo Media / La Brisa, QA only).
//
// The giveaway "Gana boletos para el Baile del Año" had no entries. The seed adds four
// FICTITIOUS participants (555 phones, example.com emails, consent given), ids demo_ce_*, so
// the list isn't empty; on camera "Daniela Ríos" enters from the app. Every run deletes
// Daniela's entry and the demo ones first; `--cleanup` deletes them too but keeps one
// (demo_ce_1) as demo data. Nothing is emailed: entering a contest sends nothing.

import { ensureAdminSession, isCleanup, remote, warm } from "./_qa.mjs";

const CONTEST = "cmwtmjvfz01bf5vqi9rblowyt";
const PEOPLE = [
  ["demo_ce_1", "Rosa Medina", "+1 713 555 0141", "rosa.medina@example.com", 3 * 1440],
  ["demo_ce_2", "Javier Lozano", "+1 832 555 0177", "javier.lozano@example.com", 2 * 1440 + 300],
  ["demo_ce_3", "Karla Benítez", "+1 281 555 0123", "karla.b@example.com", 1440 + 90],
  ["demo_ce_4", "Ernesto Garza", "+1 713 555 0190", "ernesto.garza@example.com", 400],
];

const [res] = remote(`
  await q('delete from "ContestEntry" where "contestId" = $1 and (name = $2 or id like $3)', [P.c, "Daniela Ríos", "demo_ce_%"]);
  const keep = P.cleanup ? P.people.slice(0, 1) : P.people;
  for (const [id, name, phone, email, ago] of keep) {
    const at = new Date(Date.now() - ago * 60000);
    await q('insert into "ContestEntry" (id, "contestId", "installId", name, phone, email, "consentAt", "createdAt") values ($1, $2, $3, $4, $5, $6, $7, $7)', [id, P.c, "demo-install-" + id, name, phone, email, at]);
  }
  out({ n: keep.length });
`, { c: CONTEST, people: PEOPLE, cleanup: isCleanup });
if (!isCleanup) { await ensureAdminSession(); await warm([`/contests/${CONTEST}`]); }
console.log(`concursos-consentimiento: ${res.n} demo participant(s) in place.`);
