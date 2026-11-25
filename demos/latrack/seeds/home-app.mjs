// Seed for the "home-app" module demo, against Latrack QA (never production).
//
// The video edits La Brisa's real home on camera: it adds a "Demo …" text block
// with a weekend schedule, previews Saturday morning, publishes, and restores the
// previous version into the draft. That writes on La Brisa, so this seed keeps a
// SNAPSHOT of La Brisa's home (draft, published and the list of published
// versions) and puts it back:
//
//   · on every seed, if a snapshot from the previous run is still there (the run
//     died before its cleanup), it is restored first, then a fresh one is taken;
//   · `--cleanup`, run right after the recording, restores it and deletes it,
//     together with the audit lines the video wrote for La Brisa's home.
//
// The snapshot lives in seeds/.state/ (gitignored). Only La Brisa's HomeLayout and
// HomeLayoutVersion rows and its home.publish audit lines are touched.
//
//   node seeds/home-app.mjs            seed
//   node seeds/home-app.mjs --cleanup  restore La Brisa's home and remove the snapshot

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ADMIN_STATE, CLEANUP, DEMO_COMPANY_SLUG, STATE_DIR, WORLD_JS, adminSession, qaRun, setVar } from "./lib/qa.mjs";

const SNAP = join(STATE_DIR, "home-app-snapshot.json");

const RESTORE_JS = `
if (P.snap) {
  const s = P.snap;
  if (s.brandId !== brisa.id) throw new Error("snapshot is of another brand");
  await db.query('begin');
  await db.query('delete from "HomeLayout" where "brandId" = $1', [brisa.id]);
  for (const l of s.layouts)
    await db.query('insert into "HomeLayout" (id, "brandId", state, blocks, "publishedAt", "updatedAt", "updatedById") values ($1, $2, $3::"LayoutState", $4::jsonb, $5, $6, $7)',
      [l.id, brisa.id, l.state, JSON.stringify(l.blocks), l.publishedAt, l.updatedAt, l.updatedById]);
  await db.query('delete from "HomeLayoutVersion" where "brandId" = $1', [brisa.id]);
  for (const v of s.versions)
    await db.query('insert into "HomeLayoutVersion" (id, "brandId", blocks, "publishedAt", "publishedById", summary) values ($1, $2, $3::jsonb, $4, $5, $6)',
      [v.id, brisa.id, JSON.stringify(v.blocks), v.publishedAt, v.publishedById, v.summary]);
  restoredAudit = (await db.query('delete from "AuditLog" where "companyId" = $1 and "entityId" = $2 and action = $3 and "createdAt" >= $4', [co.id, brisa.id, "home.publish", s.takenAt])).rowCount;
  await db.query('commit');
  restored = true;
}
`;

const SNAPSHOT_JS = `
const layouts = (await db.query('select id, state, blocks, "publishedAt", "updatedAt", "updatedById" from "HomeLayout" where "brandId" = $1', [brisa.id])).rows;
const versions = (await db.query('select id, blocks, "publishedAt", "publishedById", summary from "HomeLayoutVersion" where "brandId" = $1', [brisa.id])).rows;
const takenAt = (await db.query('select now() as t')).rows[0].t;
snapshot = { brandId: brisa.id, takenAt, layouts, versions };
`;

const prev = existsSync(SNAP) ? JSON.parse(readFileSync(SNAP, "utf8")) : null;
const r = qaRun(
  `${WORLD_JS}
let restored = false, restoredAudit = 0, snapshot = null;
${RESTORE_JS}
if (!P.cleanup) { ${SNAPSHOT_JS} }
out({ brisa: brisa.id, restored, restoredAudit, snapshot });`,
  { company: DEMO_COMPANY_SLUG, snap: prev, cleanup: CLEANUP },
);

if (CLEANUP) {
  rmSync(SNAP, { force: true });
} else {
  mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(SNAP, JSON.stringify(r.snapshot), { mode: 0o600 });
  await adminSession(ADMIN_STATE);
  setVar("BRISA_HOME_PATH", `/brands/${r.brisa}/home`);
}
console.log(
  `${CLEANUP ? "cleaned" : "seeded"}: ${r.restored ? `La Brisa's home restored from the previous snapshot (${r.restoredAudit} audit line(s) removed)` : "no snapshot to restore"}` +
    (CLEANUP ? "." : `; snapshot taken (${r.snapshot.layouts.length} layouts, ${r.snapshot.versions.length} versions).`),
);
