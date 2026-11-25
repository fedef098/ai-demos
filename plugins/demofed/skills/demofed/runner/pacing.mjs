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
  // Cambio de identidad: se tapa la pantalla lo justo para que no se vea el
  // reload ni el borrado de cookies. No lleva texto — quién entra ahora lo dice
  // la locución, que es la que puede explicarlo sin sacar al producto de cámara.
  identitySwap: 500,
  fade: 400,
  // Scroll animado. Un salto instantáneo deja al ojo sin saber de dónde a dónde
  // se fue ni qué había en el medio; el techo evita que una sección lejana se
  // arrastre. La velocidad está calibrada para poder leer los títulos al pasar.
  scrollSpeed: 1500,      // px por segundo
  scrollMin: 350,
  scrollMax: 2000,
  scrollSettle: 400,      // frena antes del cue
  clickPulse: 250,        // anillo de feedback del click
  awaitTimeout: 6000,     // waitFor de una consecuencia declarada
  actionTimeout: 5000,    // fail fast: una demo rota no quema 30 s por click
  // Pausa entre las dos esperas de apertura. En una app que hidrata, el shell
  // servido ya trae el elemento y el cliente lo desmonta un instante después:
  // esperarlo una sola vez devuelve el control sobre una pantalla que está por
  // vaciarse. Corre antes de la claqueta, así que no cuesta un frame de video.
  openingSettle: 1200,
  // Lo que se sostiene DESPUÉS de cada beat, además de la regla del max. En el
  // ritmo normal es cero; `pace: slow` lo sube para que el que no conoce el
  // producto llegue a mirar el resultado antes de la acción siguiente.
  sayTail: 0,             // aire después de la locución de un beat con `say`
  actionTail: 0,          // aire después de un beat mudo (tipeo, click, select)
  // Cuando un type/select/click/upload apunta a algo fuera de la franja cómoda
  // de la pantalla, se lo trae al centro con scroll animado y se espera esto
  // antes de mover el cursor: el ojo tiene que ver dónde quedó el campo.
  intoViewSettle: 300,
  cps: 16,                // lectura (ver CPS)
};

/**
 * Perfiles de ritmo por demo (`pace:` en el guion). `normal` es la tabla de
 * arriba; `slow` es para un público que no conoce el producto: cursor y tipeo
 * más lentos, más aire después de cada acción y de cada frase, y lectura a 13
 * cps en vez de 16. Se aplican con `setPace()` ANTES de calcular nada: lint
 * (estimación), record y preflight usan el mismo perfil.
 */
export const PACES = {
  normal: {},
  // A mitad de camino entre normal y slow: el que mira sigue cada paso sin que
  // se haga eterno.
  medium: {
    cursorSteps: 23,
    dwellBeforeClick: 350,
    afterClick: 800,
    typeDelay: 65,
    typeFullThreshold: 70,
    betweenScenes: 1000,
    scrollSpeed: 1300,
    scrollSettle: 550,
    sayTail: 450,
    actionTail: 300,
    intoViewSettle: 450,
    cps: 14.5,
  },
  slow: {
    cursorSteps: 28,
    dwellBeforeClick: 450,
    afterClick: 1000,
    typeDelay: 85,
    typeFullThreshold: 80,
    betweenScenes: 1300,
    scrollSpeed: 1100,
    scrollSettle: 700,
    sayTail: 900,
    actionTail: 600,
    intoViewSettle: 600,
    cps: 13,
  },
};

const DEFAULT_TIMING = { ...TIMING };

/** Aplica un perfil de ritmo sobre TIMING (in place: todos los módulos lo leen
 *  de ahí). Sin nombre o con uno desconocido vuelve al normal. */
export function setPace(name) {
  const profile = PACES[name ?? "normal"];
  if (!profile) throw new Error(`pace desconocido: '${name}'. Opciones: ${Object.keys(PACES).join(", ")}`);
  Object.assign(TIMING, DEFAULT_TIMING, profile);
  return TIMING;
}

/**
 * Cuánto se sostiene un subtítulo, en ms.
 * clamp(0.6s + chars/16, 1.6s, 6s). El piso evita el parpadeo en textos cortos;
 * el techo obliga a partir los largos en vez de dejar un cartel eterno.
 */
export function captionHold(text) {
  const chars = (text ?? "").trim().length;
  if (chars === 0) return 0;
  return clamp(600 + (chars / (TIMING.cps ?? CPS)) * 1000, 1600, 6000);
}

/**
 * Duración de un beat: el máximo entre leer el subtítulo, ejecutar la acción y
 * —si hay TTS— la locución. Nunca se acelera ni se estira el audio: el video se
 * adapta a él.
 */
export function beatDuration({ caption, actionMs = 0, voiceMs = 0, read = true }) {
  // `read: false` = el subtítulo no va quemado en el video (`captions: false`):
  // no hay texto que leer, así que manda la locución, no la lectura.
  const base = Math.max(read ? captionHold(caption) : 0, actionMs, voiceMs);
  return base + ((caption ?? "").trim() ? TIMING.sayTail : 0);
}

/** Costo estimado de una acción, para presupuestar la demo sin grabarla. */
export function actionCost(beat) {
  const t = TIMING;
  if (beat.go) return 1200;
  if (beat.click) return t.cursorSteps * 20 + t.dwellBeforeClick + t.afterClick;
  if (beat.type) return t.cursorSteps * 20 + typeCost(beat.type.text ?? "") + t.afterClick;
  if (beat.select || beat.upload) return t.cursorSteps * 20 + t.dwellBeforeClick + t.afterClick;
  if (beat.hover) return t.cursorSteps * 20 + 400;
  if (beat.press) return 450 + t.afterClick;
  if (beat.wait) return parseDuration(beat.wait);
  return 0;
}

/**
 * El scroll NO entra en `actionCost`: se suma aparte porque ocurre **antes** del
 * subtítulo, no dentro de él. Si la sección está más abajo, la locución tiene que
 * caer sobre ella ya en cuadro — narrarla mientras viaja es hablar de algo que
 * todavía no se ve.
 */
export function scrollCost(beat) {
  return beat.scroll ? TIMING.scrollMax / 2 + TIMING.scrollSettle : 0;
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
  // El perfil del guion manda en la estimación, sin dejarlo puesto: quien llama
  // (lint) puede estar corriendo con otro.
  const prev = { ...TIMING };
  setPace(demo.pace);
  try {
    return estimateWithCurrentPace(demo);
  } finally {
    Object.assign(TIMING, prev);
  }
}

function estimateWithCurrentPace(demo) {
  let total = TIMING.clapFlash + TIMING.fade + TIMING.outroHold;
  if (demo.titleCard !== false) total += TIMING.coverHold;
  for (const scene of demo.scenes ?? []) {
    total += TIMING.betweenScenes;
    if (scene.hold) total += parseDuration(scene.hold);
    for (const beat of scene.beats ?? []) {
      // Sin la voz medida (el lint no sintetiza), la lectura es el mejor estimador
      // de cuánto dura la locución aunque el subtítulo no vaya quemado.
      const d = beatDuration({ caption: beat.say, actionMs: actionCost(beat) });
      total += scrollCost(beat) + (beat.say ? d : Math.max(d, TIMING.actionTail));
      if (beat.as) total += TIMING.identitySwap;
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
