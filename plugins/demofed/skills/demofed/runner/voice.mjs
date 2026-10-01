// RUNNER_VERSION 2
//
// Síntesis de voz. Es la pasada 1 del modelo de tres pasadas: sintetizar TODO
// antes de grabar, para que la duración real de cada locución entre como piso en
// el motor de ritmo. Sin esto el audio se genera después del video y hay que
// estirarlo o acelerarlo — y una voz acelerada suena a estafa.
//
// Dos proveedores:
//   kokoro (default) — modelo local. Suena a persona. Necesita el venv de
//                      setup-voice.sh y ~1 GB de pesos la primera vez.
//   espeak           — smoke test del pipeline. Suena a robot; sirve para
//                      verificar que la mezcla funciona sin bajar 1 GB.
//
// ── Por qué hay caché ────────────────────────────────────────────────────────
// Grabar una demo son 3-6 intentos: cambia un selector, se rompe un await, se
// regraba. La narración NO cambia entre esos intentos, pero sintetizarla son
// ~40 s cada vez. La caché es por hash del contenido (proveedor + voz + texto),
// así que cambiar una sola frase re-sintetiza esa sola frase.

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { createHash } from "node:crypto";

export const DEFAULTS = {
  provider: process.env.DEMO_TTS_PROVIDER ?? "kokoro",
  voice: process.env.DEMO_TTS_VOICE ?? "ef_dora",
  lang: process.env.DEMO_TTS_LANG ?? "e",
};

const KOKORO_PY = new URL("./kokoro_synth.py", import.meta.url).pathname;

/** El venv que deja setup-voice.sh. Se puede mover con DEMO_VOICE_VENV. */
function venvPython() {
  const venv = process.env.DEMO_VOICE_VENV ?? join(process.env.HOME ?? "", ".cache", "demo-voice-venv");
  return join(venv, "bin", "python");
}

/**
 * Sintetiza un lote. `items` es [{ key, text }]; devuelve un Map key → { wav, ms, hash }.
 * Los que ya están en caché no se re-sintetizan.
 */
export function synthAll(items, { provider, voice, lang, cacheDir } = {}) {
  const cfg = { ...DEFAULTS, provider: provider ?? DEFAULTS.provider, voice: voice ?? DEFAULTS.voice, lang: lang ?? DEFAULTS.lang };
  mkdirSync(cacheDir, { recursive: true });

  const planned = items
    .filter((i) => (i.text ?? "").trim())
    .map((i) => {
      const hash = fingerprint(cfg, i.text);
      return { ...i, hash, wav: join(cacheDir, `${hash}.wav`) };
    });

  const missing = planned.filter((p) => !existsSync(p.wav));
  if (missing.length) {
    console.log(`· sintetizando ${missing.length} de ${planned.length} cues con ${cfg.provider} (${cfg.voice})…`);
    synthBatch(missing, cfg);
  } else if (planned.length) {
    console.log(`· ${planned.length} cues ya estaban en caché`);
  }

  const out = new Map();
  for (const p of planned) {
    if (!existsSync(p.wav)) throw new Error(`El proveedor '${cfg.provider}' no dejó audio para: "${p.text.slice(0, 40)}…"`);
    out.set(p.key, { wav: p.wav, ms: durationMs(p.wav), hash: p.hash, text: p.text });
  }
  return out;
}

function synthBatch(items, cfg) {
  if (cfg.provider === "espeak") {
    for (const it of items) {
      // -s 150 ≈ 150 palabras/min: rápido pero todavía inteligible.
      run("espeak-ng", ["-v", process.env.DEMO_TTS_VOICE ?? "es-419", "-s", "150", "-w", it.wav, it.text]);
    }
    return;
  }

  if (cfg.provider === "kokoro") {
    const python = venvPython();
    if (!existsSync(python)) {
      throw new Error(
        `No encontré el venv de voz en ${python}.\n` +
          `    Crealo una sola vez:  engine/runner/setup-voice.sh\n` +
          `    O probá el pipeline sin bajar pesos:  DEMO_TTS_PROVIDER=espeak`,
      );
    }
    const job = JSON.stringify({
      voice: cfg.voice,
      lang: cfg.lang,
      items: items.map((i) => ({ text: i.text, out: i.wav })),
    });
    execFileSync(python, [KOKORO_PY], { input: job, stdio: ["pipe", "inherit", "inherit"], maxBuffer: 64 * 1024 * 1024 });
    return;
  }

  throw new Error(
    `Proveedor de TTS '${cfg.provider}' desconocido. Usá 'kokoro' (voz real) o 'espeak' (smoke test).\n` +
      `    Para enchufar uno cloud, implementalo acá en synthBatch(): debe dejar un WAV por item en item.wav.`,
  );
}

/** La caché es por contenido: si cambia el texto, la voz o el proveedor, cambia
 *  el archivo. Nunca hay que acordarse de invalidarla a mano.
 *
 *  El separador va como `\0` escapado y no como byte literal: un NUL crudo hace
 *  que git clasifique este .mjs como binario y el archivo deja de ser revisable
 *  en un PR. El string que entra al hash es idéntico, así que la caché existente
 *  sigue siendo válida. */
function fingerprint(cfg, text) {
  return createHash("sha1")
    .update(`${cfg.provider}\0${cfg.voice}\0${cfg.lang}\0${text.trim()}`)
    .digest("hex")
    .slice(0, 16);
}

export function durationMs(wav) {
  const out = run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", wav]).trim();
  return Math.round(Number(out) * 1000);
}

function run(cmd, args) {
  return execFileSync(cmd, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

/** Lee el voices.json que dejó narrate.mjs. Devuelve null si la demo no tiene
 *  narración: todo el pipeline sigue funcionando mudo. */
export function loadVoices(path) {
  if (!existsSync(path)) return null;
  const raw = JSON.parse(readFileSync(path, "utf8"));
  return { ...raw, clips: new Map(Object.entries(raw.clips ?? {})) };
}
