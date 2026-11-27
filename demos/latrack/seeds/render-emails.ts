// Renders Latrack's REAL email templates (apps/web/src/lib/email.ts in the Latrack repo) into
// a small static "inbox" for the `emails` demo: fixtures/correo/<id>.html, one page per email,
// each with the list of every email on the left and that one open on the right. The engine
// serves them as fixtures at https://correo.latrack-demo.invalid/<id>; nothing is sent.
//
// The data is fictitious (La Brisa is the QA demo brand; Pedro Salas and Radio Sol de Laredo
// are made up). The invitation and reset links are fake placeholders, not tokens, and the page
// blurs them anyway. Everything below the reading-pane header is the template's own HTML.
//
// Run it again only when the templates change (needs the Latrack checkout next to this repo):
//   PUBLIC_BASE_URL=https://qa-latrack.adavance.com \
//     ../latrack/apps/web/node_modules/.bin/tsx demos/latrack/seeds/render-emails.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  alertDownEmail, alertRecoveryEmail, demoReceiptEmail, demoRequestEmail, escapeHtml, inviteEmail, resetEmail,
  type RenderedEmail,
} from "../../../../latrack/apps/web/src/lib/email";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "..", "fixtures", "correo");
mkdirSync(out, { recursive: true });

const base = (process.env.PUBLIC_BASE_URL ?? "https://qa-latrack.adavance.com").replace(/\/$/, "");
const HOU = { id: "cmwti8qye00024jo49jk43oi7", name: "La Brisa 101.1", city: "Houston", timezone: "America/Chicago" };
const PHX = { id: "cmwti8qz100054jo41wzysch9", name: "La Brisa 97.3", city: "Phoenix", timezone: "America/Phoenix" };
const STREAM = "https://stream.labrisa-demo.adavance.com/houston";
const at = (hhmmUtc: string) => new Date(`2026-11-27T${hhmmUtc}:00Z`);

type Mail = { id: string; to: string; toNote: string; time: string; subject: string; email: RenderedEmail };
const mails: Mail[] = [];
const add = (id: string, to: string, toNote: string, time: string, e: RenderedEmail & { subject?: string }, subject?: string) =>
  mails.push({ id, to, toNote, time, subject: subject ?? e.subject ?? "", email: e });

// 16:42 UTC = 10:42 in Houston.
add("alerta-caida", "Ana Morales", "gerente de La Brisa", "10:45",
  alertDownEmail({ station: HOU, kind: "DOWN", startedAt: at("16:42"), streamUrl: STREAM, detail: "HTTP 503", locale: "es" }));
add("alerta-silencio-en", "Pedro Salas", "operador, usa la consola en inglés", "10:31",
  alertDownEmail({ station: PHX, kind: "SILENCE", startedAt: at("17:27"), streamUrl: "https://stream.labrisa-demo.adavance.com/phoenix", detail: "peak -71.3 dBFS", locale: "en" }));
add("alerta-vuelve", "Ana Morales", "gerente de La Brisa", "11:03",
  alertRecoveryEmail({ station: HOU, kind: "DOWN", startedAt: at("16:42"), endedAt: at("17:01"), streamUrl: STREAM, locale: "es" }));
add("invitacion", "Pedro Salas", "operador nuevo", "09:12",
  inviteEmail({ company: "Demo Media", link: `${base}/invite/enlace-de-ejemplo`, inviter: "Ana Morales", role: "BRAND_EDITOR", days: 7, locale: "es" }));
add("contrasena", "Ana Morales", "gerente de La Brisa", "08:50",
  resetEmail(`${base}/reset/enlace-de-ejemplo`, 60, "es"));
add("demo-acuse", "Héctor Villarreal", "pidió la demo, Radio Sol de Laredo", "08:31",
  demoReceiptEmail({ name: "Héctor Villarreal", station: "Radio Sol de Laredo", locale: "es" }), "Recibimos tu pedido de demo de Latrack");
add("demo-ventas", "Ventas de Latrack", "contacto de ventas", "08:31",
  demoRequestEmail({
    station: "Radio Sol de Laredo",
    email: "hector@radiosol-laredo.example",
    rows: [
      ["Nombre", "Héctor Villarreal"], ["Radio", "Radio Sol de Laredo"], ["Email", "hector@radiosol-laredo.example"],
      ["Teléfono / WhatsApp", null], ["Ciudades y frecuencias", "Laredo 98.1 FM"], ["Stream", null], ["Plan", null], ["Idioma", "Español"],
    ],
  }), "Pedido de demo: Radio Sol de Laredo");

// Order in the list: newest first, as an inbox.
const order = ["alerta-vuelve", "alerta-caida", "alerta-silencio-en", "invitacion", "contrasena", "demo-acuse", "demo-ventas"];
const listed = order.map((id) => mails.find((m) => m.id === id)!);

const preheader = (html: string) => (/<div style="display:none[^>]*>([^<&]*)/.exec(html)?.[1] ?? "").trim();

const CHROME = `
  *{box-sizing:border-box}
  html,body{margin:0;padding:0}
  body{font-family:Inter,system-ui,-apple-system,'Segoe UI',sans-serif;background:#eef0f4!important;color:#1f2430}
  .top{position:sticky;top:0;z-index:2;height:56px;display:flex;align-items:center;gap:18px;padding:0 20px;background:#fff;border-bottom:1px solid #e3e6ec}
  .top .app{font-weight:700;font-size:17px;color:#1f2430;display:flex;align-items:center;gap:8px}
  .top .app i{display:inline-block;width:26px;height:20px;border-radius:4px;background:#3a2be0;position:relative}
  .top .app i:after{content:"";position:absolute;left:4px;right:4px;top:4px;height:8px;border-left:9px solid transparent;border-right:9px solid transparent;border-top:7px solid #fff;box-sizing:border-box}
  .top .search{flex:0 1 420px;height:36px;border-radius:18px;background:#f1f3f6;color:#7a8091;font-size:14px;display:flex;align-items:center;padding:0 16px}
  .top .tag{margin-left:auto;font-size:12px;color:#5a6072;background:#f1f3f6;border-radius:12px;padding:5px 11px}
  .wrap{display:grid;grid-template-columns:330px 1fr;min-height:calc(100vh - 56px)}
  .list{background:#fff;border-right:1px solid #e3e6ec;position:sticky;top:56px;align-self:start;height:calc(100vh - 56px);overflow:hidden}
  .list h2{margin:0;padding:14px 18px 10px;font-size:13px;font-weight:600;color:#5a6072;text-transform:uppercase;letter-spacing:.04em}
  .list a{display:block;padding:11px 18px 12px;border-bottom:1px solid #f0f1f4;text-decoration:none;color:inherit;border-left:3px solid transparent}
  .list a.on{background:#eeedfd;border-left-color:#3a2be0}
  .list .r1{display:flex;justify-content:space-between;font-size:13px;color:#1f2430;font-weight:600}
  .list .r1 span:last-child{font-weight:400;color:#7a8091;font-size:12px}
  .list .r2{font-size:13px;color:#1f2430;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .list .r3{font-size:12px;color:#7a8091;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .pane{min-width:0}
  .head{background:#fff;border-bottom:1px solid #e3e6ec;padding:18px 32px 16px}
  .head h1{margin:0 0 8px;font-size:21px;font-weight:600;color:#111827}
  .head p{margin:0;font-size:14px;color:#4b5563}
  .head p strong{color:#111827}
`;

for (const m of mails) {
  const html = m.email.html;
  const styles = (html.match(/<link[^>]+fonts[^>]+>/)?.[0] ?? "") + (html.match(/<style>[\s\S]*?<\/style>/)?.[0] ?? "");
  const body = /<body[^>]*>([\s\S]*)<\/body>/.exec(html)?.[1] ?? "";
  const items = listed
    .map((x) => `<a href="/${x.id}" data-mail="${x.id}"${x.id === m.id ? ' class="on"' : ""}>
      <div class="r1"><span>Latrack</span><span>${x.time}</span></div>
      <div class="r2">${escapeHtml(x.subject)}</div>
      <div class="r3">Para ${escapeHtml(x.to)} · ${escapeHtml(preheader(x.email.html))}</div></a>`)
    .join("\n");
  const page = `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(m.subject)}</title>
${styles}
<style>${CHROME}</style></head>
<body>
<div class="top"><span class="app"><i></i>Correo</span><span class="search">Buscar en el correo</span><span class="tag">Plantillas reales de Latrack · datos de ejemplo</span></div>
<div class="wrap">
  <nav class="list" aria-label="Correos"><h2>Recibidos</h2>
${items}
  </nav>
  <section class="pane" data-open="${m.id}">
    <div class="head"><h1>${escapeHtml(m.subject)}</h1>
      <p><strong>Latrack</strong> &lt;latrack@adavance.com&gt; &nbsp;·&nbsp; para <strong>${escapeHtml(m.to)}</strong> (${escapeHtml(m.toNote)}) &nbsp;·&nbsp; ${m.time}</p></div>
    <div class="mail">${body}</div>
  </section>
</div>
</body></html>`;
  writeFileSync(join(out, `${m.id}.html`), page);
  console.log(`wrote fixtures/correo/${m.id}.html: "${m.subject}"`);
}
