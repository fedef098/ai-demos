// Seed for equipo-idioma (Demo Media, QA only).
//
// · The pending invitation shown on camera is created HERE as a database row, so no
//   email is ever sent: editor of La Brisa for federicofiorottowork+demo-editor+test@
//   gmail.com (a +test mailbox of the team), random token whose sha256 is the only
//   thing stored and which is never written anywhere. Earlier ones for that address
//   are deleted first.
// · The admin's console language is reset to automatic (the video switches it to
//   English and back); `--cleanup` does that and removes the invitation.
// · Sessions for the admin and the editor (the editor shows the admin-only page).

import { createHash, randomBytes } from "node:crypto";
import { ADMIN_EMAIL, BRAND_ID, COMPANY_ID, EDITOR_EMAIL, ensureAdminSession, ensureSession, isCleanup, pruneDemoAudit, remote } from "./_qa.mjs";

const INVITE = "federicofiorottowork+demo-editor+test@gmail.com";
const tokenHash = createHash("sha256").update(randomBytes(32).toString("base64url")).digest("hex");

const [res] = remote(`
  await q('begin');
  const del = await q('delete from "Invitation" where "companyId" = $1 and email = $2 returning id', [P.companyId, P.email]);
  if (!P.cleanup)
    await q('insert into "Invitation" (id, "companyId", email, role, "brandId", "tokenHash", "expiresAt", "createdAt") values ($1, $2, $3, $4::"MembershipRole", $5, $6, now() + interval \\'7 days\\', now() - interval \\'3 minutes\\')',
      ['demo_inv_' + Date.now().toString(36), P.companyId, P.email, 'BRAND_EDITOR', P.brandId, P.tokenHash]);
  await q('update "User" set locale = null where email = $1', [P.admin]);
  await q('commit');
  out({ deleted: del.length });
`, { companyId: COMPANY_ID, brandId: BRAND_ID, email: INVITE, tokenHash, admin: ADMIN_EMAIL, cleanup: isCleanup });

if (!isCleanup) {
  await ensureAdminSession();
  await ensureSession(EDITOR_EMAIL, "editor");
}
pruneDemoAudit();
console.log(`equipo-idioma: removed ${res.deleted} earlier invitation(s)${isCleanup ? "" : ", invitation pending (no email sent)"}; admin language reset to automatic.`);
