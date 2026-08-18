// RUNNER_VERSION 1
//
// Tests de las reglas de ritmo. Corren con `node --test` (sin dependencias) o
// con `vitest run` si el proyecto ya lo tiene — la API de `node:test` y la de
// Vitest coinciden en lo que se usa acá.
//
//     node --test demos/.runner/
//
// Se testean `pacing.mjs` y `subtitles.mjs` y no el grabador entero a propósito:
// son las funciones PURAS del motor, las que deciden cuánto dura cada cosa y
// cómo se parte cada cartel. Es donde entran los bugs sutiles (un subtítulo que
// se corta antes de poder leerse) y lo único que se puede verificar sin abrir un
// browser, así que entra en el pre-push.

import test from "node:test";
import assert from "node:assert/strict";
import {
  captionHold,
  beatDuration,
  parseDuration,
  formatVttTime,
  splitForTyping,
  typeCost,
  estimateDuration,
  MAX_CAPTION_CHARS,
  TIMING,
} from "./pacing.mjs";
import {
  splitIntoPhrases,
  phraseTimings,
  PHRASE_MAX_CHARS,
  PHRASE_MIN_MS,
} from "./subtitles.mjs";

test("captionHold respeta piso, techo y proporcionalidad", () => {
  assert.equal(captionHold(""), 0, "sin texto no hay cue");
  assert.equal(captionHold("Hola"), 1600, "piso: un subtítulo corto no parpadea");
  assert.equal(captionHold("x".repeat(200)), 6000, "techo: obliga a partirlo en dos beats");
  assert.ok(captionHold("x".repeat(80)) > captionHold("x".repeat(40)), "más texto, más tiempo");
});

test("un subtítulo en el máximo permitido se puede leer completo", () => {
  // Si el límite del lint y el techo del hold se desincronizaran, habría
  // subtítulos válidos que no llegan a leerse. Este test los ata.
  const hold = captionHold("x".repeat(MAX_CAPTION_CHARS));
  assert.ok(hold > 1600 && hold <= 6000, `fuera de rango: ${hold}`);
});

test("beatDuration toma el máximo entre lectura, acción y locución", () => {
  assert.equal(beatDuration({ caption: "Hola", actionMs: 5000 }), 5000, "manda la acción");
  assert.equal(beatDuration({ caption: "Hola", actionMs: 100 }), 1600, "manda la lectura");
  assert.equal(
    beatDuration({ caption: "Hola", actionMs: 100, voiceMs: 9000 }),
    9000,
    "manda la locución: el audio nunca se acelera ni se estira",
  );
});

test("el tipeo largo es híbrido y ahorra tiempo real", () => {
  assert.deepEqual(splitForTyping("hola"), { instant: "", typed: "hola" });

  const largo = "x".repeat(100);
  const { instant, typed } = splitForTyping(largo);
  assert.equal(instant.length + typed.length, 100, "no se pierde ni se duplica texto");
  assert.ok(typed.length < instant.length, "sólo se tipea la cola");
  assert.ok(typeCost(largo) < 100 * TIMING.typeDelay, "el híbrido es más rápido que tipear todo");
});

test("parseDuration acepta s, ms y número; rechaza basura", () => {
  assert.equal(parseDuration("3s"), 3000);
  assert.equal(parseDuration("700ms"), 700);
  assert.equal(parseDuration(250), 250);
  assert.throws(() => parseDuration("mañana"), /Duración inválida/);
});

test("formatVttTime produce timestamps WebVTT válidos", () => {
  assert.equal(formatVttTime(0), "00:00:00.000");
  assert.equal(formatVttTime(1500), "00:00:01.500");
  assert.equal(formatVttTime(3_723_456), "01:02:03.456");
  assert.equal(formatVttTime(-5), "00:00:00.000", "un tiempo negativo se clampea, no rompe el .vtt");
});

test("estimateDuration crece con las escenas y da valores plausibles", () => {
  const escena = (id) => ({ id, beats: [{ click: "x", say: "Una frase de subtítulo normal." }] });
  const una = estimateDuration({ scenes: [escena("a")] });
  const dos = estimateDuration({ scenes: [escena("a"), escena("b")] });

  assert.ok(dos > una);
  assert.ok(una > 5_000 && una < 30_000, `duración implausible para una escena: ${una}`);
});

test("una frase corta no se parte y ninguna frase excede el ancho de la línea", () => {
  assert.deepEqual(splitIntoPhrases("El reclamo queda asignado."), ["El reclamo queda asignado."]);
  assert.deepEqual(splitIntoPhrases("   espacios   de   más   "), ["espacios de más"]);
  assert.deepEqual(splitIntoPhrases(""), []);

  const largo = "Lucía entra al portal desde el celular, saca una foto del bache y describe el problema en dos líneas.";
  const partes = splitIntoPhrases(largo);
  assert.ok(partes.length > 1, "un subtítulo de dos líneas tiene que partirse");
  for (const p of partes) assert.ok(p.length <= PHRASE_MAX_CHARS, `no entra en una línea: "${p}"`);
  assert.equal(partes.join(" "), largo.replace(/\s+/g, " "), "no se pierde ni se duplica texto");
});

test("un subtítulo en el máximo del lint siempre entra en líneas de una sola altura", () => {
  // Ata el techo del lint (90 chars) con el ancho del overlay (46ch). Si alguien
  // sube MAX_CAPTION_CHARS sin tocar el overlay, los carteles vuelven a tapar la
  // UI y se entera acá.
  const palabras = "reclamo ";
  const texto = palabras.repeat(20).slice(0, MAX_CAPTION_CHARS).trim();
  for (const p of splitIntoPhrases(texto)) assert.ok(p.length <= PHRASE_MAX_CHARS);
});

test("una palabra más larga que la línea ocupa su propia frase en vez de romperse", () => {
  const url = "https://portal.municipio.gob.ar/reclamos/expediente/2026-000123456";
  const partes = splitIntoPhrases(`Mirá ${url} para el detalle.`);
  assert.ok(partes.includes(url), `la URL se rompió: ${JSON.stringify(partes)}`);
});

test("phraseTimings reparte el cue completo sin perder ni un milisegundo", () => {
  // Ésta es la invariante que sostiene toda la línea de tiempo: si la suma de las
  // frases no fuera exactamente la duración del cue, la deriva se acumularía cue
  // a cue y para el final del video los subtítulos irían corriéndose de la voz.
  const casos = [
    ["Una frase sola.", 2000],
    ["Lucía entra al portal desde el celular, saca una foto del bache y lo describe.", 7333],
    ["Corto, pero con varias, comas, seguidas, que fuerzan cortes, naturales, acá.", 4001],
  ];
  for (const [texto, total] of casos) {
    const t = phraseTimings(texto, total);
    assert.equal(t.reduce((a, p) => a + p.ms, 0), total, `no suma para "${texto}"`);
    assert.equal(t.map((p) => p.text).join(" "), texto.replace(/\s+/g, " "));
  }
});

test("ninguna frase parpadea: todas llegan al piso legible", () => {
  const t = phraseTimings("Listo. El reclamo entró al sistema y ya tiene número de seguimiento.", 6000);
  assert.ok(t.length > 1, "el caso interesante es cuando hay varias");
  for (const p of t) assert.ok(p.ms >= PHRASE_MIN_MS, `${p.ms}ms para "${p.text}"`);
});

test("un cue muy corto colapsa en un solo cartel antes que mostrar destellos", () => {
  // 800ms no alcanzan para dos frases legibles: mejor un cartel de dos líneas
  // que dos que el ojo no llega a leer.
  const t = phraseTimings("Lucía entra al portal desde el celular y saca una foto del bache.", 800);
  assert.equal(t.length, 1);
  assert.equal(t[0].ms, 800);
});

test("una demo con la forma de un arquetipo no dispara ninguna advertencia del lint", () => {
  // 5 escenas × 3 beats es la forma que tienen los arquetipos que shipeamos.
  // El lint advierte abajo de 45 s ("no alcanza a contar nada") y arriba de
  // 180 s, y falla arriba de 240 s. Este test ata los tiempos del motor a esas
  // bandas: si alguien toca TIMING y un arquetipo empieza a quedar corto o
  // largo, se entera acá y no grabando.
  const escena = (id) => ({
    id,
    beats: [
      { go: "/x", say: "Entra al portal y encuentra lo que buscaba." },
      { click: "y", say: "El registro queda creado con su número de seguimiento." },
      { click: "z", say: "Y del otro lado ya aparece en la bandeja correcta." },
    ],
  });
  const ms = estimateDuration({ scenes: ["a", "b", "c", "d", "e"].map(escena) });
  assert.ok(ms > 45_000, `${Math.round(ms / 1000)}s: el lint lo marcaría como demasiado corto`);
  assert.ok(ms < 180_000, `${Math.round(ms / 1000)}s: el lint lo marcaría como demasiado largo`);
});
