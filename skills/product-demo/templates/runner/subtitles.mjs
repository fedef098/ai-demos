// RUNNER_VERSION 2
//
// Cómo se parte un subtítulo en frases. Funciones puras, sin Playwright ni
// ffmpeg: se testean con `node --test` junto a pacing.mjs.
//
// ── Por qué se parte ─────────────────────────────────────────────────────────
// El lint permite hasta 90 caracteres por `say`, que es el estándar de
// subtitulado (2 líneas x 45). Pero un cartel de dos líneas ocupa un tercio del
// alto útil y tapa justo la parte de la UI que la escena quiere mostrar. Peor:
// aparece entero de golpe, así que el ojo lo lee en 1 s y después se queda 4 s
// mirando texto que ya leyó, en vez de mirar la aplicación.
//
// La solución no es escribir subtítulos más cortos (eso empobrece la narración):
// es mostrar el MISMO texto en frases de una línea que van pasando. El texto
// completo sigue siendo la unidad de locución — se sintetiza de una para que la
// prosodia sea natural — y sólo la presentación se parte.
//
// ── Por qué el reparto es proporcional a los caracteres ──────────────────────
// La duración total de un cue la fija el audio (o el ritmo de lectura si no hay
// locución). Repartirla en partes iguales desincroniza: una frase de 12 chars y
// otra de 44 no tardan lo mismo en decirse. Proporcional a la longitud es una
// aproximación de una línea que empata con la locución real dentro del ruido.

/** Ancho de una línea de subtítulo. Coincide con el `max-width: 46ch` de la
 *  .caption del overlay: partir por encima de eso volvería a producir dos líneas. */
export const PHRASE_MAX_CHARS = 46;

/** Debajo de esto una frase parpadea. Si el reparto proporcional deja una
 *  esquirla más corta, se fusiona con la anterior en vez de mostrarla sola. */
export const PHRASE_MIN_MS = 700;

/** Puntuación después de la cual cortar suena natural. */
const BREAK_AFTER = /[.,;:!?…—)]$/;

/**
 * Parte un texto en frases de una línea.
 *
 * Es greedy por palabras y prefiere cortar donde ya hay puntuación: "Lucía entra
 * al portal, saca una foto y describe el bache." parte en "Lucía entra al
 * portal," + "saca una foto y describe el bache." y no a mitad de una cláusula.
 * Ninguna frase supera `maxChars`, con una sola excepción: una palabra más larga
 * que el ancho (una URL, un identificador) no se rompe — ocupa su propia frase y
 * desborda, que es menos malo que cortarla al medio.
 */
export function splitIntoPhrases(text, maxChars = PHRASE_MAX_CHARS) {
  const clean = (text ?? "").trim().replace(/\s+/g, " ");
  if (!clean) return [];
  if (clean.length <= maxChars) return [clean];

  const words = clean.split(" ");
  const out = [];
  let cur = "";

  for (const w of words) {
    const candidate = cur ? `${cur} ${w}` : w;

    if (candidate.length > maxChars && cur) {
      out.push(cur);
      cur = w;
      continue;
    }
    cur = candidate;

    // Corte natural: ya hay puntuación y la línea tiene cuerpo suficiente como
    // para no dejar un renglón huérfano de tres palabras.
    if (BREAK_AFTER.test(cur) && cur.length >= maxChars * 0.55) {
      out.push(cur);
      cur = "";
    }
  }
  if (cur) out.push(cur);

  // Una cola muy corta ("y listo.") queda mejor pegada a la frase anterior que
  // como cartel propio — pero sólo si el resultado sigue entrando en la línea.
  // Fusionar por encima del ancho devolvería el cartel de dos líneas que toda
  // esta función existe para evitar.
  if (out.length > 1) {
    const last = out[out.length - 1];
    if (last.length < maxChars * 0.25 && out[out.length - 2].length + last.length + 1 <= maxChars) {
      out.splice(out.length - 2, 2, `${out[out.length - 2]} ${last}`);
    }
  }
  return out;
}

/**
 * Reparte `totalMs` entre las frases de `text`, proporcional a su longitud.
 * Devuelve [{ text, ms }] cuya suma es exactamente totalMs (el redondeo se
 * absorbe en la última, para que no se acumule deriva a lo largo del video).
 */
export function phraseTimings(text, totalMs, maxChars = PHRASE_MAX_CHARS) {
  const phrases = splitIntoPhrases(text, maxChars);
  if (!phrases.length) return [];
  if (phrases.length === 1) return [{ text: phrases[0], ms: Math.round(totalMs) }];

  const chars = phrases.map((p) => p.length);
  const totalChars = chars.reduce((a, b) => a + b, 0);

  let spent = 0;
  const timed = phrases.map((p, i) => {
    if (i === phrases.length - 1) return { text: p, ms: Math.round(totalMs) - spent };
    const ms = Math.round((totalMs * chars[i]) / totalChars);
    spent += ms;
    return { text: p, ms };
  });

  return mergeShortPhrases(timed, Math.round(totalMs));
}

/** Fusiona hacia adelante las frases que quedaron por debajo del piso de
 *  parpadeo. Preserva la suma total. */
function mergeShortPhrases(timed, totalMs) {
  if (timed.length <= 1) return timed;
  const out = [];
  for (const p of timed) {
    const prev = out[out.length - 1];
    if (prev && prev.ms < PHRASE_MIN_MS) {
      prev.text = `${prev.text} ${p.text}`;
      prev.ms += p.ms;
    } else {
      out.push({ ...p });
    }
  }
  // La última también puede haber quedado corta: se la come la anterior.
  if (out.length > 1 && out[out.length - 1].ms < PHRASE_MIN_MS) {
    const last = out.pop();
    out[out.length - 1].text += ` ${last.text}`;
    out[out.length - 1].ms += last.ms;
  }
  // Garantía dura: el reparto no puede cambiar la duración del cue.
  const sum = out.reduce((a, p) => a + p.ms, 0);
  if (sum !== totalMs && out.length) out[out.length - 1].ms += totalMs - sum;
  return out;
}
