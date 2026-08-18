// RUNNER_VERSION 1
//
// Abre la app, autentica y resuelve TODOS los targets del guion — sin grabar.
// Tarda 15-20 s y es el loop de iteración: mientras escribís el guion, esto te
// dice qué selector no existe antes de gastar una grabación.
//
//   node .runner/preflight.mjs demos/<slug>.demo.yml
//
// Es la respuesta directa al comentario que dejó el runner de Mira:
//   "a broken demo shouldn't burn 30s per click (that produced 4-minute videos
//    of a frozen page)"
// Con esto, una demo rota falla en 15 segundos y no produce nada.

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";
import { loadDemo, lint } from "./lint.mjs";
// runAction se importa del grabador A PROPÓSITO: las dos etapas tienen que
// ejecutar exactamente las mismas acciones. Si divergieran, `--check` podría dar
// verde y la grabación fallar igual, que es justo lo que esta etapa evita.
import { runAction, authenticate } from "./record.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");

const VIEWPORTS = {
  desktop: { width: 1280, height: 720 },
  mobile: { width: 390, height: 844 },
  tablet: { width: 820, height: 1180 },
};

const TARGET_TIMEOUT = 4000;

async function main() {
  const demoPath = process.argv[2];
  if (!demoPath) die("Uso: node .runner/preflight.mjs demos/<slug>.demo.yml");

  const { demo, selectors, capabilities } = loadDemo(demoPath);
  const { errors, warnings } = lint(demo, selectors, capabilities);
  for (const w of warnings) console.warn(`  ⚠ ${w}`);
  if (errors.length) die(`Lint:\n${errors.map((e) => `  ✖ ${e}`).join("\n")}`);

  const baseURL = process.env.DEMO_BASE_URL;
  if (!baseURL) die("Falta DEMO_BASE_URL.");

  const browser = await chromium.launch({
    headless: true,
    channel: process.env.DEMO_BROWSER === "chromium" ? undefined : "chrome",
  });
  const context = await browser.newContext({
    baseURL,
    viewport: typeof demo.viewport === "object" ? demo.viewport : VIEWPORTS[demo.viewport ?? "desktop"],
    locale: demo.locale ?? "es-AR",
    timezoneId: demo.timezone ?? "America/Argentina/Buenos_Aires",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(TARGET_TIMEOUT);

  const problems = [];
  const resolved = new Set();
  let current = null;

  // ⚠ Hay que RECORRER EL FLUJO de verdad, no chequear los selectores contra la
  // primera pantalla: la mitad de los targets sólo existen después de un click.
  // Por eso se ejecutan las acciones (rápido, sin pausas ni overlay ni video).
  try {
    await authenticate(page, demo.cast[0], baseURL, demoPath);
    current = demo.cast[0].as;

    for (const scene of demo.scenes) {
      for (const [i, beat] of scene.beats.entries()) {
        const at = `${scene.id}, beat ${i + 1}`;

        if (beat.as && beat.as !== current) {
          const person = demo.cast.find((c) => c.as === beat.as);
          await context.clearCookies();
          await authenticate(page, person, baseURL, demoPath);
          await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
          current = beat.as;
        }

        try {
          await runAction(page, beat, selectors, demoPath, null, null);
          for (const t of targetsOf(beat)) resolved.add(t);
        } catch (e) {
          problems.push({ at, why: firstLine(e.message) });
          // Seguir: si un target falta, conviene reportar TODOS los que faltan
          // en una sola corrida y no de a uno por vez.
        }
      }
    }
  } finally {
    await context.close();
    await browser.close();
  }

  if (problems.length) {
    console.error(`\n✖ ${problems.length} paso(s) no se pudieron ejecutar:\n`);
    for (const p of problems) console.error(`  · [${p.at}] ${p.why}`);
    console.error(`\n${resolved.size} target(s) resolvieron bien. Arreglá selectors.yml o el guion antes de grabar.\n`);
    process.exit(1);
  }
  console.log(`\n✓ ${resolved.size} targets resueltos recorriendo el flujo entero. Listo para grabar.\n`);
}

function targetsOf(beat) {
  const out = [];
  for (const k of ["click", "hover", "scroll", "highlight", "awaits"]) if (beat[k]) out.push(beat[k]);
  for (const k of ["type", "select", "upload"]) if (beat[k]?.target) out.push(beat[k].target);
  return out;
}

const firstLine = (s) => String(s ?? "").split("\n")[0].trim();

function die(msg) {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
}

main().catch((e) => die(e.stack ?? e.message));
