// RUNNER_VERSION 1
//
// Genera demos/<slug>/index.html (la demo) y demos/index.html (la galería) a
// partir de los run.json. Cero build: HTML + CSS + JS vanilla, porque en la VPS
// compartida no se puede correr un bundler.
//
//   node .runner/page.mjs demos/            # regenera todo lo que encuentre
//   node .runner/page.mjs demos/ --remote --out .demo-site   # versión para S3
//
// La galería incluye la sección "Cobertura", que sale del catálogo
// (catalog.mjs) y contesta la pregunta que se hace antes de una reunión: qué
// está demoable y qué no.
//
// `--remote` apunta el <video> a la URL publicada en vez del mp4 de al lado, y
// deja afuera las demos sin publicar (no hay nada que reproducir). `--out`
// escribe el árbol en otro directorio en lugar de pisar el de git: el HTML
// local tiene que seguir prefiriendo el archivo local, que es lo que te deja
// mirar la demo recién grabada sin red.

import { readFileSync, writeFileSync, readdirSync, existsSync, statSync, mkdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { execFileSync } from "node:child_process";
import { formatVttTime } from "./pacing.mjs";
import { saveCatalog, groupByArea } from "./catalog.mjs";

const TEMPLATE = new URL("./page.template.html", import.meta.url).pathname;

function main() {
  const argv = process.argv.slice(2);
  const remote = argv.includes("--remote");
  const outAt = argv.indexOf("--out");
  const outRoot = outAt >= 0 ? argv[outAt + 1] : null;
  if (outAt >= 0 && !outRoot) die("--out necesita un directorio destino.");
  const demosDir = argv.find((a, i) => !a.startsWith("--") && i !== outAt + 1) ?? "demos";
  if (!existsSync(demosDir)) die(`No existe ${demosDir}`);

  let runs = readdirSync(demosDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("."))
    .map((d) => join(demosDir, d.name, "run.json"))
    .filter(existsSync)
    .map((p) => ({ path: p, dir: dirname(p), run: JSON.parse(readFileSync(p, "utf8")) }));

  if (!runs.length) die(`No encontré ningún run.json bajo ${demosDir}. Grabá una demo primero.`);

  if (remote) {
    const unpublished = runs.filter((r) => !r.run.video?.url);
    for (const r of unpublished)
      console.warn(`  ⚠ ${basename(r.dir)} no está publicada todavía: queda fuera del sitio.`);
    runs = runs.filter((r) => r.run.video?.url);
    if (!runs.length) die("Ninguna demo está publicada: no hay sitio remoto que armar.");
  }

  // El catálogo se recalcula acá para que `demo.sh --page` deje catalog.json al
  // día sin un paso extra que alguien se pueda olvidar de correr.
  const catalog = saveCatalog(demosDir);
  const bySlug = new Map(catalog.demos.map((d) => [d.slug, d]));
  const galleryDir = outRoot ?? demosDir;

  for (const r of runs) {
    const dest = outRoot ? join(outRoot, basename(r.dir)) : r.dir;
    mkdirSync(dest, { recursive: true });
    writeFileSync(join(dest, "index.html"), renderDemo(r.run, r.dir, bySlug.get(basename(r.dir)), remote));
    console.log(`· ${join(dest, "index.html")}`);
  }
  mkdirSync(galleryDir, { recursive: true });
  writeFileSync(join(galleryDir, "index.html"), renderGallery(runs, demosDir, catalog));
  console.log(`· ${join(galleryDir, "index.html")}  (${runs.length} demo(s))`);
  console.log(`· ${join(demosDir, "catalog.json")}  (${catalog.summary.porcentajeCubierto}% de cobertura)`);
}

function renderDemo(run, dir, entry, remote = false) {
  const cues = parseVtt(join(dir, "demo.vtt"));
  // El video local gana si existe: así la ves mientras la grabás, sin red.
  const src = !remote && existsSync(join(dir, "demo.mp4")) ? "demo.mp4" : run.video.url;
  // Que el guion haya cambiado después de grabar es una señal mucho más fuerte
  // que contar commits del proyecto entero; el conteo queda de respaldo.
  const stale = entry?.staleReason ?? staleness(run);

  const chapters = run.scenes
    .map(
      (s) => `<button class="chapter">
        <span class="t">${formatVttTime(s.startMs)}</span>
        <span class="title">${esc(s.title)}</span>
        ${s.watch ? `<span class="watch">${esc(s.watch)}</span>` : ""}
      </button>`,
    )
    .join("\n");

  const transcript = cues
    .map((c) => `<button class="cue"><span class="t">${formatVttTime(c.start)}</span> ${esc(c.text)}</button>`)
    .join("\n");

  const coverage = run.scenes
    .map((s) => `<tr><td>${esc(s.proves ?? "")}</td><td>${esc(s.title)}</td></tr>`)
    .join("\n");

  const fixtures = run.usedFixtures?.length
    ? `<p class="note"><strong>Datos de demostración.</strong> Esta demo sirve
       ${run.usedFixtures.length} endpoint${run.usedFixtures.length > 1 ? "s" : ""} de lectura
       desde un fixture fijo para que los datos sean estables en cámara
       (<code>${run.usedFixtures.map(esc).join("</code>, <code>")}</code>).
       Todas las escrituras que ves son reales.</p>`
    : "";

  const content = `
    <p><a href="../index.html">← Todas las demos</a></p>
    <h1>${esc(run.title)}</h1>
    <p class="promise">${esc(run.promise ?? "")}</p>
    <div class="player">
      <div>
        <video controls preload="metadata" poster="poster.jpg">
          <source src="${esc(src)}" type="video/mp4">
          <track kind="subtitles" srclang="es" label="Español" src="demo.vtt" default>
          <track kind="chapters" srclang="es" src="demo.chapters.vtt">
        </video>
        <p class="meta">
          ${run.product} · ${fmtDur(run.durationMs)} ·
          grabada el ${fmtDate(run.recordedAt)}${run.commit ? ` contra <code>${esc(run.commit)}</code>` : ""}
          ${stale ? `<br><span class="stale">⚠ ${esc(stale)}</span>` : ""}
        </p>
        ${fixtures}
      </div>
      <div>
        <div class="chapters"><h3>Escenas</h3>${chapters}</div>
        <div class="transcript">${transcript}</div>
      </div>
    </div>
    <h2>Qué demuestra</h2>
    <table><thead><tr><th>Capacidad</th><th>Escena</th></tr></thead><tbody>${coverage}</tbody></table>
    <script>
      window.__DEMO_MARKS__ = ${JSON.stringify({ chapters: run.scenes, cues })};
      // Deep-link del catálogo: <slug>/index.html#t=87.4 abre el video ahí.
      (() => {
        const v = document.querySelector("video");
        if (!v) return;
        const seek = () => {
          const t = parseFloat(new URLSearchParams(location.hash.slice(1)).get("t") ?? "");
          if (Number.isFinite(t)) v.currentTime = t;
        };
        v.addEventListener("loadedmetadata", seek, { once: true });
        addEventListener("hashchange", seek);
      })();
    </script>`;

  return fill(run.title, content);
}

function renderGallery(runs, demosDir, catalog) {
  const cards = runs
    .map(({ run, dir }) => {
      const rel = basename(dir);
      return `<a class="card" href="${rel}/index.html">
        <img src="${rel}/poster.jpg" alt="">
        <div class="body">
          <strong>${esc(run.title)}</strong>
          <span class="meta">${run.product} · ${fmtDur(run.durationMs)} · ${fmtDate(run.recordedAt)}</span>
        </div>
      </a>`;
    })
    .join("\n");
  return fill("Demos", `<h1>Demos</h1><div class="grid">${cards}</div>${renderCoverage(catalog)}`);
}

/** La sección "Cobertura": qué capacidad del producto está demoable y cuál no.
 *  El bloque de huecos va ARRIBA de la tabla y destacado a propósito — es lo
 *  único de esta página que dispara trabajo. */
function renderCoverage(catalog) {
  const s = catalog.summary;
  if (!s.total)
    return `<h2>Cobertura</h2>
      <p class="note">Ninguna escena declara <code>covers:</code> todavía. Agregá
      <code>demos/capabilities.yml</code> (hay un ejemplo en la skill) y en cada escena
      la lista de capacidades que cubre; esta sección pasa a mostrar qué está demoable y qué no.</p>`;

  const rows = catalog.capabilities
    .map((cap) => {
      const where = cap.occurrences.length
        ? cap.occurrences
            .map((o) =>
              o.link
                ? `<a href="${esc(o.link)}">${esc(o.demoTitle)} · ${esc(o.sceneTitle ?? o.scene)}</a>
                   <span class="at">${fmtSec(o.startMs)}</span>`
                : `<span class="muted">${esc(o.demoTitle)} · ${esc(o.sceneTitle ?? o.scene)} (sin grabar)</span>`,
            )
            .join("<br>")
        : `<span class="muted">—</span>`;
      return `<tr>
        <td><strong>${esc(cap.title)}</strong><br><span class="muted">${esc(cap.area)}</span></td>
        <td>${where}</td>
        <td>${statusPill(cap)}</td>
      </tr>`;
    })
    .join("\n");

  const gaps = catalog.capabilities.filter((c) => c.status !== "cubierta");
  const gapsBlock = !catalog.hasCapabilities
    ? `<p class="note">Sin <code>demos/capabilities.yml</code> sólo puedo listar lo que las demos
       cubren: no hay inventario contra el cual saber qué falta. Copiá
       <code>capabilities.example.yml</code> de la skill para ver los huecos.</p>`
    : gaps.length
      ? `<section class="gaps">
          <h3>No está demoable todavía · ${gaps.length}</h3>
          ${groupByArea(gaps)
            .map(
              ({ area, capabilities }) => `<div class="area">
                <h4>${esc(area)}</h4>
                ${capabilities
                  .map(
                    (c) => `<div class="gap">
                      <span class="prio prio-${esc(c.priority)}">${esc(c.priority)}</span>
                      <span class="what">${esc(c.title)}</span>
                      <span class="how">${c.status === "guionada" ? "guionada, falta grabar" : "sin guion"}</span>
                    </div>`,
                  )
                  .join("\n")}
              </div>`,
            )
            .join("\n")}
        </section>`
      : `<p class="note">✓ Todas las capacidades del inventario tienen una demo grabada.</p>`;

  const staleDemos = catalog.demos.filter((d) => d.stale);
  const staleBlock = staleDemos.length
    ? `<p class="note"><span class="stale">⚠ ${staleDemos.length} demo(s) desactualizada(s):</span>
       ${staleDemos.map((d) => `<br><code>${esc(d.slug)}</code> — ${esc(d.staleReason)}`).join("")}</p>`
    : "";

  return `
    ${COVERAGE_CSS}
    <h2>Cobertura</h2>
    <div class="cov-bar"><span style="width:${s.porcentajeCubierto}%"></span></div>
    <p class="cov-nums">
      <span><b>${s.porcentajeCubierto}%</b> de las capacidades tienen una demo grabada</span>
      <span><b>${s.cubiertas}</b> cubiertas</span>
      <span><b>${s.guionadas}</b> guionadas sin grabar</span>
      <span><b>${s.sinCubrir}</b> sin cubrir</span>
      <span><b>${s.total}</b> ${catalog.hasCapabilities ? "en el inventario" : "declaradas en los guiones"}</span>
    </p>
    ${gapsBlock}
    ${staleBlock}
    <table>
      <thead><tr><th>Capacidad</th><th>Dónde se ve</th><th>Estado</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function statusPill(cap) {
  if (cap.status === "cubierta")
    return cap.stale
      ? `<span class="pill warn">grabada · vieja</span>`
      : `<span class="pill ok">grabada</span>`;
  if (cap.status === "guionada") return `<span class="pill warn">guionada</span>`;
  return `<span class="pill gap">sin cubrir</span>`;
}

// Va inline y no en page.template.html porque sólo lo usa la galería, y el
// template lo comparten todas las páginas.
const COVERAGE_CSS = `<style>
.cov-bar { max-width: 560px; height: 10px; border-radius: 999px; overflow: hidden;
  background: var(--bg-surface-hover); border: 1px solid var(--border-default); }
.cov-bar span { display: block; height: 100%; background: var(--accent); }
.cov-nums { display: flex; flex-wrap: wrap; gap: 4px 20px; margin: 10px 0 0;
  font-size: .8125rem; color: var(--text-secondary); }
.cov-nums b { color: var(--text-strong); font-variant-numeric: tabular-nums; }
.muted { color: var(--text-secondary); }
.at { font-size: .75rem; color: var(--text-secondary); font-variant-numeric: tabular-nums; }
.pill { display: inline-block; font-size: .75rem; line-height: 1rem; padding: 3px 10px;
  border-radius: 999px; white-space: nowrap; border: 1px solid var(--border-default); }
.pill.ok { color: #15803d; border-color: #86efac; }
.pill.warn { color: #b45309; border-color: #fcd34d; }
.pill.gap { color: #c2410c; border-color: #fca5a5; }
.gaps { margin: 24px 0; padding: 4px 20px 16px; border-radius: var(--radius-md);
  border: 1px solid #fca5a5; box-shadow: inset 4px 0 0 #c2410c; background: var(--bg-surface); }
.gaps h3 { font-size: .75rem; text-transform: uppercase; letter-spacing: .04em;
  color: #c2410c; margin: 16px 0 4px; }
.gaps h4 { font-size: .8125rem; color: var(--text-secondary); font-weight: 600;
  margin: 16px 0 6px; }
.gap { display: flex; align-items: baseline; gap: 10px; padding: 5px 0;
  border-bottom: 1px solid var(--border-default); font-size: .875rem; }
.gaps .area:last-child .gap:last-child { border-bottom: 0; }
.gap .what { flex: 1; }
.gap .how { font-size: .75rem; color: var(--text-secondary); }
.prio { font-size: .6875rem; text-transform: uppercase; letter-spacing: .04em;
  font-weight: 600; width: 52px; flex: none; }
.prio-alta { color: #c2410c; }
.prio-media { color: #b45309; }
.prio-baja { color: var(--text-secondary); }
</style>`;

function fill(title, content) {
  return readFileSync(TEMPLATE, "utf8")
    .replace("__TITLE__", esc(title))
    .replace("__CONTENT__", content);
}

/** Cuántos commits tocaron el proyecto desde que se grabó. Es la mitigación
 *  barata a que nada regenere la demo automáticamente: convierte "está vieja"
 *  en algo visible en vez de en una sorpresa frente al cliente. */
function staleness(run) {
  if (!run.commit) return null;
  try {
    const n = Number(
      execFileSync("git", ["rev-list", "--count", `${run.commit}..HEAD`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(),
    );
    if (n > 200) return `${n} commits desde que se grabó — casi seguro que la UI cambió.`;
    if (n > 50) return `${n} commits desde que se grabó — conviene regrabarla.`;
    return null;
  } catch {
    return null;
  }
}

function parseVtt(path) {
  if (!existsSync(path)) return [];
  const out = [];
  for (const block of readFileSync(path, "utf8").split(/\n\s*\n/)) {
    const m = block.match(/([\d:.]+)\s+-->\s+([\d:.]+)\n([\s\S]+)/);
    if (m) out.push({ start: toMs(m[1]), end: toMs(m[2]), text: m[3].trim() });
  }
  return out;
}

const toMs = (s) => {
  const [h, m, rest] = s.split(":");
  return (Number(h) * 3600 + Number(m) * 60 + Number(rest)) * 1000;
};

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const fmtDur = (ms) => `${Math.floor(ms / 60000)}:${String(Math.round((ms % 60000) / 1000)).padStart(2, "0")}`;
const fmtSec = (ms) => (ms == null ? "" : fmtDur(ms));
const fmtDate = (iso) => new Date(iso).toLocaleDateString("es-AR", { year: "numeric", month: "long", day: "numeric" });

function die(msg) {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
}

main();
