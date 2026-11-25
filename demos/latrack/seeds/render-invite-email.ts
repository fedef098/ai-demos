// Renders Latrack's REAL invitation email (inviteEmail() from the web app's
// lib/email.ts) into assets/invite-email.html, for scene 1 of onboarding-radio.
//
// The link is left as the literal placeholder ${INVITE_URL}: the recording serves
// this file as a fixture with `vars: true`, so the engine fills in the link the
// seed created for that run. No token is ever written to the repo.
//
// Run it again only when the template changes (needs the Latrack checkout):
//   PUBLIC_BASE_URL=https://qa-latrack.adavance.com \
//     ../latrack/apps/web/node_modules/.bin/tsx demos/latrack/seeds/render-invite-email.ts
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { escapeHtml, inviteEmail } from "../../../../latrack/apps/web/src/lib/email";

const here = dirname(fileURLToPath(import.meta.url));
const email = inviteEmail({
  company: "Radio Sol",
  link: "${INVITE_URL}",
  inviter: "Equipo Latrack",
  role: "COMPANY_ADMIN",
  days: 7,
  locale: "es",
});

// A thin inbox header above the email (subject, sender, recipient), so the frame
// reads as "the email that arrived" and not as a web page. Everything below it is
// the template's own HTML, untouched.
const header = `
<div style="font-family:Inter,system-ui,-apple-system,sans-serif;background:#fff;border-bottom:1px solid #e5e7eb;padding:18px 32px 16px;">
  <div style="font-size:21px;font-weight:600;color:#111827;margin-bottom:8px;">${escapeHtml(email.subject)}</div>
  <div style="font-size:14px;color:#4b5563;"><strong style="color:#111827;">Latrack</strong> &lt;latrack@adavance.com&gt; &nbsp;·&nbsp; para Ramiro Gutiérrez</div>
</div>`;
const html = email.html.replace(/<body([^>]*)>/, (m) => `${m}${header}`);

writeFileSync(join(here, "..", "assets", "invite-email.html"), html);
console.log(`wrote assets/invite-email.html (${html.length} bytes): "${email.subject}"`);
