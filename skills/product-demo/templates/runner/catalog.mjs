// RUNNER_VERSION 1
//
// El inventario: qué capacidad del producto está demoable y cuál no.
//
//   node .runner/catalog.mjs demos/
//
// La tabla de cobertura de cada demo contesta "qué muestra este video". Ésta
// contesta la pregunta que importa antes de una reunión: "¿qué NO tenemos para
// mostrar?". Para eso cruza tres cosas:
//
//   demos/capabilities.yml   lo que el producto sabe hacer   (opcional)
//   demos/*.demo.yml         lo que está guionado            (covers: [id, ...])
//   demos/<slug>/run.json    lo que está efectivamente grabado
//
// De ahí salen los tres estados: cubierta (hay video, con link al segundo
// exacto), guionada (el guion existe, falta grabar) y sin cubrir (nadie la
// menciona). Sin capabilities.yml el catálogo igual se genera, pero sólo puede
// listar lo cubierto: no tiene contra qué medir los huecos.
//
// Escribe demos/catalog.json y lo imprime resumido. page.mjs lo importa para
// renderizar la sección "Cobertura" de la galería.

import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, resolve, basename } from "node:path";
import { execFileSync } from "node:child_process";
import { loadYaml } from "./lint.mjs";

export const CATALOG_FILE = "catalog.json";

const PRIORITY_ORDER = { alta: 0, media: 1, baja: 2 };
const STATUS = { COVERED: "cubierta", SCRIPTED: "guionada", MISSING: "sin-cubrir" };

/**
 * Arma el catálogo completo sin escribir nada.
 * @param {string} demosDir directorio con los .demo.yml (normalmente "demos")
 * @returns {object} ver la forma en el README / en catalog.json
 */
export function buildCatalog(demosDir) {
  const dir = resolve(demosDir);
  if (!existsSync(dir)) throw new Error(`No existe ${demosDir}`);

  const capabilitiesPath = join(dir, "capabilities.yml");
  const hasCapabilities = existsSync(capabilitiesPath);
  const inventory = hasCapabilities ? loadYaml(capabilitiesPath) : null;

  const selectorsPath = join(dir, "selectors.yml");
  const selectorsChangedAt = existsSync(selectorsPath) ? lastCommitISO(selectorsPath) : null;

  const demos = readdirSync(dir)
    .filter((f) => f.endsWith(".demo.yml"))
    .sort()
    .map((f) => readDemo(join(dir, f), dir, selectorsPath, selectorsChangedAt))
    .filter(Boolean);

  // ── Ocurrencias: cada vez que una escena declara covers: [id] ──────────────
  /** @type {Map<string, object[]>} */
  const occurrences = new Map();
  const unknownCovers = [];
  const knownIds = new Set((inventory?.capabilities ?? []).map((c) => c.id));

  for (const demo of demos) {
    for (const scene of demo.scenes) {
      for (const id of scene.covers) {
        const hit = {
          demo: demo.slug,
          demoTitle: demo.title,
          scene: scene.id,
          sceneTitle: scene.title,
          proves: scene.proves,
          recorded: scene.recorded,
          stale: demo.stale,
          startMs: scene.startMs,
          link: scene.link,
        };
        if (hasCapabilities && !knownIds.has(id)) {
          unknownCovers.push({ id, demo: demo.slug, scene: scene.id });
          continue;
        }
        if (!occurrences.has(id)) occurrences.set(id, []);
        occurrences.get(id).push(hit);
      }
    }
  }

  // Sin capabilities.yml el inventario son los ids que los guiones inventaron:
  // alcanza para listar lo cubierto, no para saber qué falta.
  const declared =
    inventory?.capabilities ??
    [...occurrences.keys()].map((id) => ({ id, title: id, area: "Sin clasificar", priority: "media" }));

  const capabilities = declared.map((cap) => {
    const hits = occurrences.get(cap.id) ?? [];
    // Una capacidad está cubierta si ALGUNA escena que la declara está grabada.
    // Las grabadas primero, así el link que muestra la página es el que anda.
    hits.sort((a, b) => Number(b.recorded) - Number(a.recorded));
    const status = hits.some((h) => h.recorded)
      ? STATUS.COVERED
      : hits.length
        ? STATUS.SCRIPTED
        : STATUS.MISSING;
    return {
      id: cap.id,
      title: cap.title ?? cap.id,
      area: cap.area ?? "Sin clasificar",
      priority: cap.priority ?? "media",
      status,
      stale: status === STATUS.COVERED && hits.every((h) => !h.recorded || h.stale),
      occurrences: hits,
    };
  });

  const count = (s) => capabilities.filter((c) => c.status === s).length;
  const cubiertas = count(STATUS.COVERED);
  const total = capabilities.length;

  return {
    generatedAt: new Date().toISOString(),
    product: inventory?.product ?? demos[0]?.product ?? null,
    hasCapabilities,
    summary: {
      total,
      cubiertas,
      guionadas: count(STATUS.SCRIPTED),
      sinCubrir: count(STATUS.MISSING),
      stale: demos.filter((d) => d.stale).length,
      porcentajeCubierto: total ? Math.round((cubiertas / total) * 100) : 0,
      demos: demos.length,
      grabadas: demos.filter((d) => d.recorded).length,
    },
    capabilities,
    demos,
    unknownCovers,
  };
}

/** Arma el catálogo y lo deja escrito en <demosDir>/catalog.json. */
export function saveCatalog(demosDir) {
  const catalog = buildCatalog(demosDir);
  writeFileSync(join(resolve(demosDir), CATALOG_FILE), `${JSON.stringify(catalog, null, 2)}\n`);
  return catalog;
}

/** Orden de lectura de los huecos: primero lo caro de no poder mostrar. */
export function byPriority(a, b) {
  const pa = PRIORITY_ORDER[a.priority] ?? 99;
  const pb = PRIORITY_ORDER[b.priority] ?? 99;
  return pa - pb || String(a.title).localeCompare(String(b.title), "es");
}

/** Agrupa capacidades por `area`, cada grupo ordenado por prioridad. */
export function groupByArea(capabilities) {
  const groups = new Map();
  for (const cap of capabilities) {
    if (!groups.has(cap.area)) groups.set(cap.area, []);
    groups.get(cap.area).push(cap);
  }
  return [...groups.entries()]
    .map(([area, caps]) => ({ area, capabilities: [...caps].sort(byPriority) }))
    .sort((a, b) => a.area.localeCompare(b.area, "es"));
}

// ── Lectura de una demo ──────────────────────────────────────────────────────

function readDemo(specPath, dir, selectorsPath, selectorsChangedAt) {
  const demo = loadYaml(specPath);
  if (!demo || typeof demo !== "object") return null;

  const fileSlug = basename(specPath, ".demo.yml");
  // record.mjs escribe la salida en demos/<demo.id>; el nombre del archivo es
  // sólo una convención. Si el id no tiene carpeta, caemos al nombre del archivo.
  const slug = demo.id && existsSync(join(dir, demo.id)) ? demo.id : (demo.id ?? fileSlug);
  const runPath = join(dir, slug, "run.json");
  const run = existsSync(runPath) ? safeJson(runPath) : null;

  const recordedScenes = new Map((run?.scenes ?? []).map((s) => [s.id, s]));
  const { stale, staleReason } = staleness({ run, runPath, specPath, selectorsPath, selectorsChangedAt });

  const scenes = (demo.scenes ?? []).map((scene) => {
    const recordedScene = recordedScenes.get(scene.id);
    return {
      id: scene.id ?? null,
      title: scene.title ?? null,
      proves: scene.proves ?? null,
      covers: normalizeCovers(scene.covers),
      objection: Boolean(scene.objection),
      recorded: Boolean(recordedScene),
      startMs: recordedScene?.startMs ?? null,
      link: recordedScene ? `${slug}/index.html#t=${seconds(recordedScene.startMs)}` : null,
    };
  });

  return {
    slug,
    id: demo.id ?? fileSlug,
    title: demo.title ?? fileSlug,
    promise: demo.promise ?? null,
    product: demo.product ?? null,
    spec: basename(specPath),
    recorded: Boolean(run),
    recordedAt: run?.recordedAt ?? null,
    commit: run?.commit ?? null,
    durationMs: run?.durationMs ?? null,
    stale,
    staleReason,
    scenes,
  };
}

// Un id repetido dentro de la misma escena lo avisa el lint; acá se colapsa para
// no listar la misma escena dos veces bajo la misma capacidad.
const normalizeCovers = (covers) => [
  ...new Set((Array.isArray(covers) ? covers : covers ? [covers] : []).map(String).filter(Boolean)),
];

const seconds = (ms) => Math.max(0, Math.round((ms ?? 0) / 100) / 10);

/**
 * ¿El guion cambió DESPUÉS de la grabación? Es la pregunta correcta: contar
 * commits del proyecto entero (lo que hacía page.mjs) marca como vieja una demo
 * de un módulo que nadie tocó, y deja pasar la que se rompió con un solo commit.
 *
 * Las fechas salen de git (`git log -1 --format=%cI -- <archivo>`), que es lo
 * único comparable entre máquinas; el mtime sólo se usa como red de contención
 * cuando el archivo no está trackeado — en un clone limpio todos los mtime son
 * la hora del checkout y marcarían todo como desactualizado.
 */
function staleness({ run, runPath, specPath, selectorsPath, selectorsChangedAt }) {
  if (!run) return { stale: false, staleReason: null };

  // La grabación: la más nueva entre lo que dice run.json y su commit. Así una
  // demo recién grabada y todavía sin commitear no sale falsamente vieja, y una
  // grabada y commiteada junto con su guion tampoco.
  const recordedAt = newest([utc(run.recordedAt), lastCommitISO(runPath)]) ?? mtimeISO(runPath);
  if (!recordedAt) return { stale: false, staleReason: null };

  const specChangedAt = lastCommitISO(specPath) ?? mtimeISO(specPath);
  const changes = [
    { file: basename(specPath), at: specChangedAt, what: "el guion" },
    { file: basename(selectorsPath), at: selectorsChangedAt, what: "los selectores" },
  ].filter((c) => c.at && c.at > recordedAt);

  if (!changes.length) return { stale: false, staleReason: null };
  changes.sort((a, b) => (a.at < b.at ? 1 : -1));
  const [first] = changes;
  // Ambas fechas se muestran en la hora local, si no una viene en UTC (run.json)
  // y la otra con el offset de git y la comparación se lee mal. Y si el cambio
  // fue el mismo día que la grabación, la fecha sola no dice nada: va la hora.
  const sameDay = local(first.at).slice(0, 10) === local(recordedAt).slice(0, 10);
  const when = (iso) => (sameDay ? local(iso) : local(iso).slice(0, 10));
  return {
    stale: true,
    staleReason:
      `${first.what} cambió después de la grabación ` +
      `(${first.file}, ${when(first.at)} vs. grabada el ${when(recordedAt)})`,
  };
}

function lastCommitISO(path) {
  try {
    const out = execFileSync("git", ["log", "-1", "--format=%cI", "--", path], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return out ? utc(out) : null;
  } catch {
    return null;
  }
}

// Todas las fechas se normalizan a UTC apenas entran: git las devuelve con el
// offset de quien commiteó y run.json en Z, y comparar esos strings como texto
// da resultados falsos según el huso.
const utc = (iso) => {
  const d = new Date(iso ?? "");
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

const mtimeISO = (path) => {
  try {
    return statSync(path).mtime.toISOString();
  } catch {
    return null;
  }
};

const newest = (dates) => dates.filter(Boolean).sort().pop() ?? null;

/** ISO → "YYYY-MM-DD HH:MM" en la hora de la máquina. */
const local = (iso) => {
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16).replace("T", " ");
};

function safeJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    console.warn(`  ⚠ ${path} no es JSON válido; lo ignoro.`);
    return null;
  }
}

// ── Salida por consola ───────────────────────────────────────────────────────

export function printCatalog(catalog) {
  const { summary: s } = catalog;
  const bar = (pct) => "█".repeat(Math.round(pct / 5)).padEnd(20, "░");

  console.log(`\nCatálogo de demos${catalog.product ? ` — ${catalog.product}` : ""}`);
  console.log(`  ${s.demos} demo(s), ${s.grabadas} grabada(s)\n`);

  if (!catalog.hasCapabilities) {
    console.log(
      `  Sin demos/capabilities.yml: puedo listar lo que las demos cubren, no lo que falta.\n` +
        `  Copiá capabilities.example.yml de la skill a demos/capabilities.yml para ver los huecos.\n`,
    );
  }

  console.log(`  Cobertura  ${bar(s.porcentajeCubierto)}  ${s.porcentajeCubierto}%`);
  console.log(
    `  ${s.cubiertas} cubierta(s) · ${s.guionadas} guionada(s) sin grabar · ${s.sinCubrir} sin cubrir` +
      `  (de ${s.total} ${catalog.hasCapabilities ? "en el inventario" : "declaradas en los guiones"})\n`,
  );

  const gaps = catalog.capabilities.filter((c) => c.status !== STATUS.COVERED);
  if (gaps.length) {
    console.log(`  ${catalog.hasCapabilities ? "No demoable todavía" : "Falta grabar"} (${gaps.length}):`);
    for (const { area, capabilities } of groupByArea(gaps)) {
      console.log(`\n    ${area}`);
      for (const c of capabilities) {
        const tag = c.status === STATUS.SCRIPTED ? "guionada, falta grabar" : "sin guion";
        console.log(`      [${c.priority}] ${c.title}  — ${tag}  (${c.id})`);
      }
    }
    console.log("");
  } else if (s.total) {
    console.log(`  ✓ Todas las capacidades del inventario tienen una demo grabada.\n`);
  }

  const stale = catalog.demos.filter((d) => d.stale);
  if (stale.length) {
    console.log(`  ⚠ ${stale.length} demo(s) desactualizada(s):`);
    for (const d of stale) console.log(`      · ${d.slug}: ${d.staleReason}`);
    console.log("");
  }

  if (catalog.unknownCovers.length) {
    console.log(`  ⚠ ${catalog.unknownCovers.length} 'covers:' apuntan a ids que no están en capabilities.yml:`);
    for (const u of catalog.unknownCovers) console.log(`      · ${u.id}  (${u.demo}, escena ${u.scene})`);
    console.log("");
  }
}

// ── CLI ──────────────────────────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  const demosDir = process.argv[2] ?? "demos";
  let catalog;
  try {
    catalog = saveCatalog(demosDir);
  } catch (err) {
    console.error(`\n✖ ${err.message}\n`);
    process.exit(1);
  }
  printCatalog(catalog);
  console.log(`· ${join(demosDir, CATALOG_FILE)}\n`);
}
