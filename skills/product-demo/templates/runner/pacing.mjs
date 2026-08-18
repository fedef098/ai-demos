// RUNNER_VERSION 1
//
// Reglas de ritmo. Funciones puras, sin Playwright: se testean con `node --test`
// y son el único lugar donde vive "cuánto dura cada cosa".
//
// La regla de la que sale todo lo demás:
//
//   Un beat dura  max(tiempo de lectura del subtítulo, tiempo de la acción)
//
// El subtítulo nunca desaparece antes de que se pueda leer, y nunca queda
// colgado después de que la UI ya siguió. Un video a velocidad de test no se
// entiende; uno con sleeps fijos generosos es interminable. Esto es el medio.

/** Velocidad de lectura cómoda en español, en caracteres por segundo.
 *  Netflix usa 17 como máximo; 16 deja aire sin aburrir. */
export const CPS = 16;

/** Un subtítulo más largo que esto no se lee: hay que partirlo en dos cues.
 *  90 = 2 líneas x 45, el estándar de subtitulado. */
export const MAX_CAPTION_CHARS = 90;

export const TIMING = {
  cursorSteps: 18,        // ~360 ms de viaje: el ojo puede seguir al puntero
  dwellBeforeClick: 250,  // el ojo llega ANTES que el click
  afterClick: 600,        // mínimo; encima se espera la consecuencia declarada
  typeDelay: 45,          // ~22 cps: rápido, pero se lee como alguien escribiendo
  typeFullThreshold: 60,  // arriba de esto, fill() del 80% y se tipea el final
  typeTailRatio: 0.2,
  betweenScenes: 700,     // subtítulo vacío: el ojo se resetea
  coverHold: 3000,        // placa de portada
  outroHold: 2000,        // placa de cierre
  // Flash blanco de calibración. 200 ms ≈ 5 frames a 25 fps: suficientes para
  // que build.mjs lo encuentre aunque el encoder tire alguno. Con 120 ms no
  // sobrevivía a la compresión y la claqueta no se detectaba.
  clapFlash: 200,
  curtain: 700,           // cortina al cambiar de identidad
  fade: 400,
  clickPulse: 250,        // anillo de feedback del click
  awaitTimeout: 6000,     // waitFor de una consecuencia declarada
  actionTimeout: 5000,    // fail fast: una demo rota no quema 30 s por click
};

/**
 * Cuánto se sostiene un subtítulo, en ms.
 * clamp(0.6s + chars/16, 1.6s, 6s). El piso evita el parpadeo en textos cortos;
 * el techo obliga a partir los largos en vez de dejar un cartel eterno.
 */
export function captionHold(text) {
  const chars = (text ?? "").trim().length;
  if (chars === 0) return 0;
  return clamp(600 + (chars / CPS) * 1000, 1600, 6000);
}

/**
 * Duración de un beat: el máximo entre leer el subtítulo, ejecutar la acción y
 * —si hay TTS— la locución. Nunca se acelera ni se estira el audio: el video se
 * adapta a él.
 */
export function beatDuration({ caption, actionMs = 0, voiceMs = 0 }) {
  return Math.max(captionHold(caption), actionMs, voiceMs);
}

/** Costo estimado de una acción, para presupuestar la demo sin grabarla. */
export function actionCost(beat) {
  const t = TIMING;
  if (beat.go) return 1200;
  if (beat.click) return t.cursorSteps * 20 + t.dwellBeforeClick + t.afterClick;
  if (beat.type) return typeCost(beat.type.text ?? "") + t.afterClick;
  if (beat.scroll) return 900;
  if (beat.hover) return t.cursorSteps * 20 + 400;
  if (beat.wait) return parseDuration(beat.wait);
  return 0;
}

/** Tipear entero es lento; de 60 chars para arriba se llena el 80% de una y se
 *  tipea el 20% final, que es lo único que el ojo necesita ver escribirse. */
export function typeCost(text) {
  const n = text.length;
  if (n <= TIMING.typeFullThreshold) return n * TIMING.typeDelay;
  return Math.ceil(n * TIMING.typeTailRatio) * TIMING.typeDelay + 250;
}

/** Cómo se parte un texto largo para tipear: [instantáneo, tipeado]. */
export function splitForTyping(text) {
  if (text.length <= TIMING.typeFullThreshold) return { instant: "", typed: text };
  const cut = Math.floor(text.length * (1 - TIMING.typeTailRatio));
  return { instant: text.slice(0, cut), typed: text.slice(cut) };
}

/** Estimación de la duración total, en ms. La usa el lint para avisar que la
 *  demo se fue de largo antes de gastar una grabación. */
export function estimateDuration(demo) {
  let total = TIMING.clapFlash + TIMING.coverHold + TIMING.fade + TIMING.outroHold;
  for (const scene of demo.scenes ?? []) {
    total += TIMING.betweenScenes;
    if (scene.hold) total += parseDuration(scene.hold);
    for (const beat of scene.beats ?? []) {
      total += beatDuration({ caption: beat.say, actionMs: actionCost(beat) });
      if (beat.as) total += TIMING.curtain;
    }
  }
  return total;
}

/** "3s" | "700ms" | 700 → ms */
export function parseDuration(v) {
  if (typeof v === "number") return v;
  const m = String(v).trim().match(/^(\d+(?:\.\d+)?)\s*(ms|s)?$/);
  if (!m) throw new Error(`Duración inválida: ${v}`);
  return m[2] === "s" || !m[2] ? Number(m[1]) * 1000 : Number(m[1]);
}

export function formatVttTime(ms) {
  const t = Math.max(0, ms);
  const h = String(Math.floor(t / 3600000)).padStart(2, "0");
  const m = String(Math.floor(t / 60000) % 60).padStart(2, "0");
  const s = String(Math.floor(t / 1000) % 60).padStart(2, "0");
  const f = String(Math.floor(t % 1000)).padStart(3, "0");
  return `${h}:${m}:${s}.${f}`;
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}
