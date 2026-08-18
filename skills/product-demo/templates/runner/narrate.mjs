// RUNNER_VERSION 2
//
// Pasada 1 de la narración: sintetiza TODOS los cues ANTES de grabar y deja
// voices.json con la duración real de cada uno.
//
//   node .runner/narrate.mjs demos/<slug>.demo.yml
//
// ── Por qué antes y no después ───────────────────────────────────────────────
// El audio dicta el tiempo, no al revés. Si se sintetiza después de grabar, la
// locución no entra en el hueco que quedó y hay que estirarla o acelerarla.
// Sintetizando antes, record.mjs le pasa esa duración a beatDuration() como un
// piso más de max(lectura, acción, locución): el beat dura lo que dure la voz y
// el video se adapta a ella. Esta es la única razón por la que después no hace
// falta ningún bucle de re-grabar hasta que sincronice.
//
// El texto locutado es `voice` si el beat lo define, y `say` si no: sirve para
// que el subtítulo diga "el reclamo queda asignado a Obras Públicas" y la voz
// lea el número de expediente completo, que en pantalla sobraría.

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { loadDemo } from "./lint.mjs";
import { synthAll, DEFAULTS } from "./voice.mjs";

/** Clave estable de un cue. Tiene que coincidir exactamente con la que arma
 *  record.mjs, o la locución se pegaría al beat equivocado. */
export const cueKey = (sceneId, beatIndex) => `${sceneId}:${beatIndex}`;

/** Dónde vive el audio. Fuera de <slug>/ a propósito: son artefactos de build
 *  pesados y regenerables, y <slug>/ es lo que se commitea. */
export const voiceCacheDir = (demosDir) => join(demosDir, ".voice-cache");
export const voicesPath = (demosDir, id) => join(voiceCacheDir(demosDir), `${id}.voices.json`);

/** Qué se narra, en el orden del guion. */
export function collectCues(demo) {
  const out = [];
  for (const scene of demo.scenes ?? []) {
    (scene.beats ?? []).forEach((beat, i) => {
      const text = (beat.voice ?? beat.say ?? "").trim();
      if (text) out.push({ key: cueKey(scene.id, i), text, sceneId: scene.id, beatIndex: i });
    });
  }
  return out;
}

export function narrate(demoPath) {
  const { demo } = loadDemo(demoPath);
  const demosDir = dirname(resolve(demoPath));

  // `narration: false` apaga la voz para una demo puntual sin tocar el entorno.
  if (demo.narration === false) {
    console.log("· narración desactivada en el guion (narration: false)");
    return null;
  }

  const cfg = {
    provider: demo.narration?.provider ?? DEFAULTS.provider,
    voice: demo.narration?.voice ?? DEFAULTS.voice,
    lang: demo.narration?.lang ?? DEFAULTS.lang,
  };

  const cues = collectCues(demo);
  if (!cues.length) {
    console.log("· el guion no tiene texto para locutar");
    return null;
  }

  const cacheDir = voiceCacheDir(demosDir);
  const clips = synthAll(cues, { ...cfg, cacheDir });

  const total = [...clips.values()].reduce((a, c) => a + c.ms, 0);
  const out = {
    demo: demo.id,
    ...cfg,
    generatedAt: new Date().toISOString(),
    totalMs: total,
    clips: Object.fromEntries(clips),
  };

  mkdirSync(cacheDir, { recursive: true });
  const path = voicesPath(demosDir, demo.id);
  writeFileSync(path, `${JSON.stringify(out, null, 2)}\n`);

  console.log(`✓ ${clips.size} cues locutados · ${(total / 1000).toFixed(1)}s de voz · ${path}`);
  console.log("  Escuchá el video entero antes de publicarlo: un TTS que pronuncia mal un nombre propio arruina la demo.");
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const demoPath = process.argv[2];
  if (!demoPath) {
    console.error("\n✖ Uso: node .runner/narrate.mjs demos/<slug>.demo.yml\n");
    process.exit(1);
  }
  try {
    narrate(demoPath);
  } catch (e) {
    console.error(`\n✖ ${e.message}\n`);
    process.exit(1);
  }
}
