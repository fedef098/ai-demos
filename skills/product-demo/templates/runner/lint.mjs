// RUNNER_VERSION 1
//
// Valida un guion SIN abrir un browser: estructura, reglas narrativas y targets
// huérfanos. Corre en menos de un segundo, así que es lo único que conviene
// meter en CI. Grabar nunca bloquea un PR; lintear sí.
//
//   node .runner/lint.mjs demos/<slug>.demo.yml
//
// demo.schema.json existe para el autocompletado del editor; las reglas de
// verdad están acá, porque la mitad son narrativas y un JSON Schema no las
// puede expresar.

import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { createRequire } from "node:module";
import { estimateDuration, MAX_CAPTION_CHARS } from "./pacing.mjs";

const require = createRequire(import.meta.url);

const VERBS = ["go", "click", "hover", "type", "select", "upload", "scroll", "highlight"];

// Un say que empieza así está describiendo la UI en vez de contar la historia.
const NARRATING_THE_UI = [
  /^\s*(ahora\s+)?(hacemos|hago|hace)\s+click/i,
  /^\s*click\s+en\b/i,
  /^\s*(ahora\s+)?vamos\s+a\b/i,
  /^\s*(seleccionamos|presionamos|apretamos|tocamos|clickeamos)\b/i,
  /^\s*(we\s+)?click\b/i,
];

const ARCHETYPE_EXPECTS = {
  crud: { needs: /borr|elimin|revoc|permis|valida/i, why: "una escena que pruebe borrado, revocación o validación" },
  "login-onboarding": { needs: /invit|contrase|password|recuper/i, why: "una escena sobre la invitación o la recuperación de contraseña" },
  "search-filter": { needs: /filtr|busca|búsqueda|result/i, why: "una escena de filtrado o de búsqueda sin resultados" },
  "admin-panel": { needs: /auditor|config|permis|quién/i, why: "una escena de auditoría o de configuración" },
  checkout: { needs: /pag|cobr|rechaz|tarjeta/i, why: "una escena sobre el pago rechazado y su recuperación" },
};

export function loadYaml(path) {
  let YAML;
  try {
    // Resuelto desde el proyecto, no desde el plugin: el runner está vendorizado
    // en demos/.runner/ y usa las dependencias del repo que lo hospeda.
    YAML = require("yaml");
  } catch {
    fail(
      "No pude importar el paquete 'yaml'.\n" +
        "  Instalalo en el proyecto:  npm i -D yaml   (o pnpm add -D yaml)",
    );
  }
  try {
    return YAML.parse(readFileSync(path, "utf8"));
  } catch (err) {
    // La trampa de YAML que más vas a pisar escribiendo guiones: un valor SIN
    // COMILLAS que contiene ": " se interpreta como un mapping anidado.
    //     say: El cierre: el beat más fuerte     ← rompe
    //     say: "El cierre: el beat más fuerte"   ← anda
    // El error crudo de la librería no lo dice, así que lo traducimos.
    const line = err?.linePos?.[0]?.line;
    const hint =
      err?.code === "BLOCK_AS_IMPLICIT_KEY"
        ? `\n\n  Casi seguro es un texto sin comillas que contiene ": " (dos puntos y espacio).\n` +
          `  YAML lo lee como una clave anidada. Poné el valor entre comillas dobles.`
        : "";
    fail(`No pude parsear ${path}${line ? ` (línea ${line})` : ""}:\n  ${err.message}${hint}`);
  }
}

/** Carga guion + selectors.yml (+ capabilities.yml si existe) ya cruzados. */
export function loadDemo(demoPath) {
  const dir = dirname(resolve(demoPath));
  const demo = loadYaml(demoPath);
  const selectorsPath = join(dir, "selectors.yml");
  const selectors = existsSync(selectorsPath) ? loadYaml(selectorsPath).targets ?? {} : {};
  // El inventario es opcional: sin él no se puede validar 'covers', pero todo lo
  // demás sigue linteando igual.
  const capabilitiesPath = join(dir, "capabilities.yml");
  const capabilities = existsSync(capabilitiesPath) ? loadYaml(capabilitiesPath)?.capabilities ?? [] : null;
  return { demo, selectors, selectorsPath, capabilities, capabilitiesPath };
}

export function lint(demo, selectors, capabilities = null) {
  const errors = [];
  const warnings = [];
  const e = (m) => errors.push(m);
  const w = (m) => warnings.push(m);

  // ── Estructura mínima ──────────────────────────────────────────────────────
  for (const k of ["id", "product", "title", "promise", "cast", "scenes"]) {
    if (!demo?.[k]) e(`Falta el campo obligatorio '${k}'.`);
  }
  if (errors.length) return { errors, warnings };

  if (!Array.isArray(demo.scenes) || demo.scenes.length === 0) e("'scenes' no puede estar vacío.");
  if (demo.scenes.length > 7)
    e(`${demo.scenes.length} escenas. El máximo es 7 — dos escenas que prueban lo mismo se fusionan.`);

  const cast = new Set((demo.cast ?? []).map((c) => c.as));
  if (!cast.size) e("'cast' no puede estar vacío: la demo necesita al menos una persona con nombre.");
  for (const c of demo.cast ?? []) {
    if (!c.context) w(`El personaje '${c.as}' no tiene 'context'. Sin rol ni situación se lee como "usuario A".`);
    if (c.auth?.password && !/^\$\{[A-Z0-9_]+\}$/.test(c.auth.password))
      e(`La password de '${c.as}' está hardcodeada. Usá \${VAR_DE_ENTORNO}.`);
    if (c.auth?.email && !/^\$\{[A-Z0-9_]+\}$/.test(c.auth.email))
      w(`El email de '${c.as}' está hardcodeado. Preferí \${VAR_DE_ENTORNO} para no filtrar cuentas reales.`);
  }

  // ── Reglas narrativas ──────────────────────────────────────────────────────
  if (!demo.scenes.some((s) => s.objection))
    e(
      "Ninguna escena tiene 'objection: true'. Toda demo necesita al menos una que muestre " +
        "el producto haciendo lo difícil (el error manejado, el permiso denegado); si no, es un folleto.",
    );

  const expect = ARCHETYPE_EXPECTS[demo.archetype];
  if (expect) {
    const blob = demo.scenes.map((s) => `${s.title} ${s.proves}`).join(" ");
    if (!expect.needs.test(blob))
      w(`El arquetipo '${demo.archetype}' espera ${expect.why} — no la encontré.`);
  }

  const ids = new Set();
  let usedTargets = new Set();
  // 'covers' se valida contra el inventario sólo si el inventario existe.
  const knownCapabilities = capabilities ? capabilities.map((c) => c?.id).filter(Boolean) : null;

  for (const [i, scene] of demo.scenes.entries()) {
    const at = `escena ${i + 1} (${scene.id ?? "sin id"})`;
    if (!scene.id) e(`${at}: falta 'id'.`);
    if (ids.has(scene.id)) e(`${at}: el id '${scene.id}' está repetido.`);
    ids.add(scene.id);
    if (!scene.title) e(`${at}: falta 'title'.`);
    else if (scene.title.length > 70) e(`${at}: el título tiene ${scene.title.length} caracteres (máximo 70).`);

    // ── Cobertura: 'proves' es la frase para el humano, 'covers' el enganche
    //    con demos/capabilities.yml. Una escena sin ninguno de los dos no entra
    //    en el catálogo: no se puede decir qué demuestra.
    const covers = Array.isArray(scene.covers) ? scene.covers : scene.covers ? [scene.covers] : [];
    if (scene.covers !== undefined && !Array.isArray(scene.covers))
      w(`${at}: 'covers' tiene que ser una lista de ids ('covers: [reclamo-alta]').`);
    if (!scene.proves && !covers.length)
      e(`${at}: falta 'proves' (y tampoco declara 'covers'). Una escena que no prueba una capacidad no va.`);
    else if (!scene.proves)
      w(`${at}: sin 'proves'. La tabla de cobertura de la demo queda con la celda vacía.`);
    else if (knownCapabilities && !covers.length)
      w(`${at}: sin 'covers'. No engancha con capabilities.yml, así que el catálogo no la va a contar como cubierta.`);

    if (new Set(covers).size !== covers.length) w(`${at}: hay ids repetidos en 'covers'.`);
    for (const id of covers) {
      if (!knownCapabilities) continue;
      if (knownCapabilities.includes(id)) continue;
      e(
        `${at}: 'covers' referencia '${id}', que no está en capabilities.yml. ` +
          `Ids válidos: ${suggestIds(id, knownCapabilities)}`,
      );
    }

    if (!scene.watch) w(`${at}: sin 'watch'. Es la nota de dirección que va al HTML.`);
    if (!Array.isArray(scene.beats) || !scene.beats.length) e(`${at}: sin 'beats'.`);

    for (const [j, beat] of (scene.beats ?? []).entries()) {
      const bat = `${at}, beat ${j + 1}`;

      if (beat.as && !cast.has(beat.as)) e(`${bat}: '${beat.as}' no está en 'cast'.`);

      if (beat.say) {
        if (beat.say.length > MAX_CAPTION_CHARS)
          e(`${bat}: el subtítulo tiene ${beat.say.length} caracteres (máximo ${MAX_CAPTION_CHARS}). Partilo en dos beats.`);
        if (NARRATING_THE_UI.some((re) => re.test(beat.say)))
          e(
            `${bat}: el subtítulo describe el click ("${truncate(beat.say)}"). ` +
              `Enunciá la consecuencia: qué queda distinto en el mundo después de esa acción.`,
          );
        if (/lorem ipsum/i.test(beat.say)) e(`${bat}: lorem ipsum en el subtítulo.`);
      }

      const verbs = VERBS.filter((v) => beat[v] !== undefined);
      if (verbs.length > 1) e(`${bat}: ${verbs.length} acciones en un mismo beat (${verbs.join(", ")}). Una por beat.`);
      if (!verbs.length && !beat.say && !beat.wait && !beat.shot)
        e(`${bat}: no hace nada ni dice nada.`);

      for (const key of ["click", "hover", "scroll", "highlight", "awaits"]) {
        if (beat[key]) usedTargets.add(beat[key]);
      }
      for (const key of ["type", "select", "upload"]) {
        if (beat[key]?.target) usedTargets.add(beat[key].target);
      }

      // La consecuencia declarada es lo que reemplaza a networkidle.
      if ((beat.click || beat.go) && !beat.awaits && j === (scene.beats.length - 1))
        w(`${bat}: última acción de la escena sin 'awaits'. Sin una consecuencia declarada el motor no sabe cuándo terminó.`);
    }
  }

  // ── Targets ────────────────────────────────────────────────────────────────
  for (const t of usedTargets) {
    if (!selectors[t]) e(`El target '${t}' no está definido en selectors.yml.`);
  }
  for (const t of Object.keys(selectors)) {
    if (!usedTargets.has(t)) w(`El target '${t}' está definido pero ningún guion de este directorio lo usa.`);
  }
  for (const [name, sel] of Object.entries(selectors)) {
    if (/nth-child|\/\/|\bxpath=/.test(sel))
      e(`El target '${name}' usa nth-child o XPath ("${sel}"). Se rompe al primer cambio de markup: usá data-testid o role+name.`);
  }

  // ── Fixtures ───────────────────────────────────────────────────────────────
  for (const f of demo.fixtures ?? []) {
    if (f.method && !["GET", "HEAD"].includes(f.method))
      e(`El fixture de '${f.route}' mockea ${f.method}. Mockear escrituras está prohibido: la demo tiene que mostrar el producto funcionando de verdad.`);
  }

  // ── Duración ───────────────────────────────────────────────────────────────
  const ms = estimateDuration(demo);
  if (ms > 240_000) e(`Duración estimada ${fmt(ms)}. Arriba de 4 minutos no se mira.`);
  else if (ms > 180_000) w(`Duración estimada ${fmt(ms)}. El objetivo son 90-180 s.`);
  else if (ms < 45_000) w(`Duración estimada ${fmt(ms)}. Menos de 45 s probablemente no alcanza a contar nada.`);

  return { errors, warnings, estimatedMs: ms };
}

const truncate = (s) => (s.length > 48 ? `${s.slice(0, 45)}…` : s);

/** Los ids parecidos primero: un 'covers' roto casi siempre es un typo o un id
 *  renombrado, y leer el listado entero para encontrarlo es peor que inútil. */
function suggestIds(wrong, known, max = 6) {
  if (!known.length) return "(capabilities.yml no tiene ninguno)";
  const ranked = [...known].sort((a, b) => distance(wrong, a) - distance(wrong, b));
  const close = ranked.filter((id) => distance(wrong, id) <= Math.max(3, Math.round(id.length / 2)));
  const shown = (close.length ? close : ranked).slice(0, max);
  return shown.join(", ") + (known.length > shown.length ? `, … (${known.length} en total)` : "");
}

/** Levenshtein, sin dependencias: los inventarios son de decenas de ids. */
function distance(a, b) {
  let prev = [...Array(b.length + 1).keys()];
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++)
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = row;
  }
  return prev[b.length];
}
const fmt = (ms) => `${Math.round(ms / 1000)}s`;

function fail(msg) {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
}

// ── CLI ──────────────────────────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  const path = process.argv[2];
  if (!path) fail("Uso: node .runner/lint.mjs demos/<slug>.demo.yml");
  if (!existsSync(path)) fail(`No existe: ${path}`);

  const { demo, selectors, capabilities } = loadDemo(path);
  const { errors, warnings, estimatedMs } = lint(demo, selectors, capabilities);

  for (const m of warnings) console.warn(`  ⚠ ${m}`);
  for (const m of errors) console.error(`  ✖ ${m}`);

  if (errors.length) {
    console.error(`\n${errors.length} error(es). El guion no está listo para grabar.\n`);
    process.exit(1);
  }
  console.log(
    `\n✓ ${demo.id}: ${demo.scenes.length} escenas, ~${fmt(estimatedMs)} estimados` +
      (warnings.length ? `, ${warnings.length} advertencia(s)` : "") +
      `\n`,
  );
}
