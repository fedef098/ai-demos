// RUNNER_VERSION 1
//
// El driver: toma el guion y produce demo.webm + timeline.json.
//
//   node <runner>/record.mjs demos/<producto>/<slug>.demo.yml
//
// Decisiones que están acá y no son negociables (el porqué, en cada sitio):
//   - UN solo BrowserContext y UNA sola página: recordVideo produce un archivo
//     POR PÁGINA, así que un popup o un segundo contexto parten la línea de tiempo.
//   - El reloj de los cues vive en Node (process.hrtime.bigint), nunca en la
//     página: si congelamos Date.now() para determinismo, el reloj del browser miente.
//   - Nada de networkidle. Cada beat declara su consecuencia con `awaits`.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve, join, basename } from "node:path";
import { requireDep, missingDepMessage } from "./deps.mjs";
import { loadDemo, lint } from "./lint.mjs";
import { TIMING, beatDuration, captionHold, actionCost, splitForTyping, parseDuration, setPace } from "./pacing.mjs";
import { phraseTimings } from "./subtitles.mjs";
import { loadVoices } from "./voice.mjs";
import { cueKey, voicesPath } from "./narrate.mjs";

const playwright = requireDep("@playwright/test");
if (!playwright) die(missingDepMessage("@playwright/test"));
const { chromium } = playwright;

const VIEWPORTS = {
  desktop: { viewport: { width: 1280, height: 720 } },
  mobile: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
  tablet: { viewport: { width: 820, height: 1180 }, isMobile: true, hasTouch: true },
};

const OVERLAY = new URL("./overlay.js", import.meta.url).pathname;

/**
 * Dispositivos para una persona del cast con `device:`. Esa persona no comparte
 * la página de escritorio: tiene su propio contexto (viewport, dsf, touch, UA
 * de teléfono) y su propia grabación, que build.mjs pega dentro del marco de
 * teléfono que el overlay dibuja en el video principal. Ver `stageScreen()`.
 */
export const DEVICES = {
  iphone: {
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  },
};

/**
 * `fakeMicrophone: ./assets/voz.wav`: el micrófono del navegador "graba" ese audio y
 * el permiso queda concedido sin diálogo. Para mostrar una nota de voz grabada en la
 * app sin una persona hablando frente a un micrófono.
 */
export function fakeMediaArgs(demo, demoPath) {
  if (!demo.fakeMicrophone) return [];
  return [
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
    `--use-file-for-fake-audio-capture=${resolve(dirname(demoPath), demo.fakeMicrophone)}`,
  ];
}

export function deviceOf(person) {
  if (!person?.device) return null;
  const d = DEVICES[person.device];
  if (!d) throw new Error(`device '${person.device}' desconocido en cast '${person.as}'. Opciones: ${Object.keys(DEVICES).join(", ")}`);
  return d;
}

/** Dónde va la pantalla del teléfono dentro del cuadro de escritorio: alto casi
 *  completo (24 px de aire arriba y abajo), proporción del dispositivo, a un
 *  tercio del ancho para dejar la columna derecha al subtítulo. Números pares:
 *  el overlay de ffmpeg en yuv420p los prefiere. */
export function stageScreen(device, frame) {
  const even = (n) => Math.round(n / 2) * 2;
  const h = even(frame.height - 48);
  const w = even((h * device.viewport.width) / device.viewport.height);
  return { x: even(frame.width * 0.31 - w / 2), y: 24, w, h };
}

/** Init scripts de un contexto: máscara, opciones del overlay y el overlay. */
async function installOverlay(context, demo) {
  await context.addInitScript(
    (m) => { window.__demoMask = m.mask; window.__demoOpts = m.opts; },
    { mask: { hide: demo.hide ?? DEFAULT_HIDE, redact: demo.redact ?? [] }, opts: { chapter: demo.chapter ?? null } },
  );
  await context.addInitScript({ path: OVERLAY });
}

/**
 * `fixtures:` — respuestas fijas para pedidos de LECTURA. Además del JSON de
 * siempre, un fixture puede servir una página (`contentType: text/html`): así se
 * muestra, por ejemplo, el mail de invitación renderizado con la plantilla real
 * del producto. Con `vars: true` el cuerpo pasa por la misma sustitución
 * \${VAR} que el guion, leída al momento del pedido (un link recién creado por el
 * seed nunca queda escrito en el repo).
 */
export async function installFixtures(page, demo, demoPath) {
  for (const f of demo.fixtures ?? []) {
    const raw = readFileSync(resolve(dirname(demoPath), f.body), "utf8");
    await page.route(f.route, async (route) => {
      if (route.request().method() !== (f.method ?? "GET")) return route.continue();
      const body = f.vars ? await expandVars(raw) : raw;
      return route.fulfill({ status: f.status ?? 200, contentType: f.contentType ?? "application/json", body });
    });
  }
}

// ── reloj monotónico, en ms desde el arranque del proceso ────────────────────
const now = () => Number(process.hrtime.bigint() / 1000n) / 1000;

async function main() {
  const demoPath = process.argv[2];
  if (!demoPath) die("Uso: node <runner>/record.mjs demos/<producto>/<slug>.demo.yml");

  const { demo, selectors, capabilities } = loadDemo(demoPath);
  const { errors } = lint(demo, selectors, capabilities);
  if (errors.length) die(`El guion no pasa el lint:\n${errors.map((e) => `  ✖ ${e}`).join("\n")}`);
  setPace(demo.pace);

  const baseURL = process.env.DEMO_BASE_URL;
  if (!baseURL) die("Falta DEMO_BASE_URL (la app tiene que estar ya desplegada — el grabador nunca levanta un dev server).");

  const outDir = join(dirname(resolve(demoPath)), demo.id);
  // demo.sh fija DEMO_TMPDIR y lo borra con un trap; corriendo suelto, se elige acá.
  const tmpDir = process.env.DEMO_TMPDIR ?? join(process.env.TMPDIR ?? "/tmp", `demo-${demo.id}-${process.pid}`);
  mkdirSync(outDir, { recursive: true });
  mkdirSync(tmpDir, { recursive: true });

  const vp = typeof demo.viewport === "object"
    ? { viewport: demo.viewport }
    : VIEWPORTS[demo.viewport ?? "desktop"];

  const browser = await chromium.launch({
    headless: true,
    // Chrome del sistema: evita bajar ~170 MB de Chromium. DEMO_BROWSER=chromium
    // es el escape hatch si la versión del sistema da problemas.
    channel: process.env.DEMO_BROWSER === "chromium" ? undefined : "chrome",
    args: fakeMediaArgs(demo, demoPath),
  });

  const context = await browser.newContext({
    ...vp,
    baseURL,
    userAgent: demoUserAgent(browser, demo),
    locale: demo.locale ?? "es-AR",
    timezoneId: demo.timezone ?? "America/Argentina/Buenos_Aires",
    colorScheme: "light",
    deviceScaleFactor: 1, // dsf 2 no sube la resolución del video y cuadruplica el render
    recordVideo: { dir: tmpDir, size: vp.viewport },
  });

  // La máscara antes que el overlay: el overlay la lee al arrancar y así queda
  // puesta en CADA documento, no sólo en el primero. Y el overlay ANTES de
  // cualquier navegación: pinta el cover negro a document-start, así el video no
  // arranca mostrando el redirect a /login.
  await installOverlay(context, demo);

  const page = await context.newPage();
  page.setDefaultTimeout(TIMING.actionTimeout);
  // Una app desplegada puede tardar más que un click en cargar en frío: la
  // navegación tiene su propio margen, sin aflojar el fail-fast de las acciones.
  page.setDefaultNavigationTimeout(TIMING.navigationTimeout);

  // recordVideo escribe un archivo POR PÁGINA. Un popup parte la línea de tiempo
  // en dos webm y no hay forma de recomponerla: mejor fallar claro.
  page.on("popup", async (p) => {
    await p.close().catch(() => {});
    die("La demo abrió un popup. recordVideo produce un archivo por página, así que la línea de tiempo se parte. Reescribí ese paso para que navegue en la misma pestaña.");
  });

  // Congela Date.now() para que "hace 2 horas" salga siempre igual, pero deja
  // correr timers y animaciones. clock.install() los congelaría y la app
  // parecería muerta (se mueren polling, debounces y transiciones).
  if (demo.freezeTime) await page.clock.setFixedTime(new Date(demo.freezeTime));

  await installFixtures(page, demo, demoPath);

  const cues = [];      // { t, kind, text, sceneId, voice? }
  const chapters = [];  // { t, id, title, proves, watch }
  const shots = [];
  let current = null;   // persona activa

  // Las locuciones ya sintetizadas por narrate.mjs. null = demo muda: todo el
  // resto del pipeline funciona igual, sólo que sin piso de voz.
  const voices = loadVoices(voicesPath(dirname(resolve(demoPath)), demo.id));
  if (voices) console.log(`· narración: ${voices.clips.size} cues (${voices.provider}/${voices.voice})`);

  // `t` se puede forzar: las frases de un mismo cue se marcan todas juntas al
  // empezar el beat, con los offsets que va a respetar el overlay.
  const mark = (kind, text, sceneId, extra = {}) =>
    cues.push({ t: now() - t0, kind, text, sceneId, ...extra });

  // ── Apertura: el cover ya está negro. Autenticamos y cargamos DETRÁS de él. ──
  const first = demo.cast[0];
  if (deviceOf(first)) die("La primera persona del cast no puede tener `device:`: el video principal es el de escritorio.");
  await authenticate(page, first, baseURL, demoPath);
  current = first.as;
  // Quién tiene la sesión del contexto de escritorio. Una persona con `device:`
  // vive en otro contexto, así que volver de ella NO borra cookies: el dueño
  // sigue logueado donde lo dejamos.
  let mainAs = first.as;
  let active = page;          // la página que recibe las acciones
  const phone = { ctx: null, page: null, flashAt: null, segStart: null, segments: [], screen: null, device: null };
  // Esta navegación ES la del primer beat, adelantada detrás del cover. Se guarda
  // el beat para no repetirla en cámara: volver a `goto` la misma URL recarga la
  // app entera y el video abre sobre el skeleton, que es justo lo que el cover
  // estaba tapando.
  const openingBeat = demo.scenes[0].beats.find((b) => b.go) ?? null;
  await page.goto(openingBeat?.go ? await expandVars(openingBeat.go) : "/", { waitUntil: "domcontentloaded" });
  // Precalentar el teléfono: su contexto se abre ya y carga el ORIGEN de la primera
  // URL que va a abrir (sólo "/", sin el path: no sigue links ni cambia estado), así
  // la app web queda en caché y la primera entrada no es una pantalla negra.
  // Cada origen distinto que el teléfono va a abrir se precalienta (un `go` a otro
  // origen a mitad de escena era una pantalla blanca de 4 s).
  {
    let asNow = null;
    const phoneGos = [];
    for (const b of demo.scenes.flatMap((sc) => sc.beats)) {
      if (b.as) asNow = b.as;
      const person = demo.cast.find((c) => c.as === asNow);
      if (b.go && deviceOf(person)) phoneGos.push({ person, url: new URL(await expandVars(b.go), baseURL) });
    }
    if (phoneGos.length) {
      const { person } = phoneGos[0];
      await openPhone(page, phone, { demo, person, device: deviceOf(person), tmpDir, demoPath, baseURL });
      for (const origin of new Set(phoneGos.map((g) => g.url.origin))) {
        await phone.page.goto(`${origin}/`, { waitUntil: "load" }).catch(() => {});
        await phone.page.waitForTimeout(1500);
      }
    }
  }
  await applyMask(page, demo);
  // Sin esperar las fuentes, los primeros segundos del video son FOUT.
  // El await va DENTRO del evaluate: FontFaceSet no es serializable.
  await page.evaluate(async () => { await document.fonts?.ready; }).catch(() => {});

  // Y la app montada, no sólo el HTML: `domcontentloaded` vuelve con el skeleton
  // en pantalla. El primer beat ya declara cuál es la señal de que cargó, así que
  // se espera ESA y no un timeout inventado. Va antes de la claqueta a propósito:
  // después de ella todo cuenta como video, y esperar acá no gasta ni un frame.
  // Se espera DOS veces con una pausa en el medio, y no es paranoia: en una app
  // que hidrata, el shell servido ya trae el elemento, así que la primera espera
  // vuelve enseguida y el cliente lo desmonta un segundo después — el video abría
  // sobre varios segundos de pantalla vacía. Estable dos veces sí significa
  // cargada. Todo esto pasa antes de la claqueta, así que no cuesta un solo frame.
  const openingAwaits = demo.scenes[0].beats.find((b) => b.awaits)?.awaits;
  const openingSel = openingAwaits ? selectors[openingAwaits] : null;
  if (openingSel) {
    // `load` y no `networkidle`: espera las subrequests de la página, no el
    // silencio de red, que en una app con websockets no llega nunca.
    await page.waitForLoadState("load").catch(() => {});
    for (let i = 0; i < 2; i++) {
      await page.locator(openingSel).first()
        .waitFor({ state: "visible", timeout: TIMING.awaitTimeout })
        .catch(() => {});   // el beat lo vuelve a esperar y ahí sí falla con su mensaje
      if (i === 0) await page.waitForTimeout(TIMING.openingSettle);
    }
  }

  // La claqueta: un flash blanco de 120 ms que además se lee como una transición
  // deliberada. build.mjs lo busca en el video para anclar la línea de tiempo.
  await page.evaluate(() => window.__demo.cover("flash"));
  await page.waitForTimeout(2); // deja pintar el frame blanco
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const t0 = now();
  await page.waitForTimeout(TIMING.clapFlash);

  // Portada. `titleCard: false` la saltea y el video abre directamente sobre la
  // aplicación: el título y la promesa siguen viviendo en la página, el catálogo
  // y el run.json, que es donde se leen con tiempo. Lo que NO es opcional es la
  // placa negra en sí —el flash blanco tiene que fundir contra algo, no cortar
  // seco a la app— ni el flash de arriba, que build.mjs busca por luminancia
  // para anclar la línea de tiempo. Que abajo haya una app cargada y no un
  // skeleton lo garantiza el `awaits` de recién, no los 3 s de esta placa.
  const titleCard = demo.titleCard !== false;
  await page.evaluate(
    ({ title, promise }) => window.__demo.cover("black", { title, promise }),
    titleCard ? { title: demo.title, promise: demo.promise ?? "" } : { title: "", promise: "" },
  );
  if (titleCard) await page.waitForTimeout(TIMING.coverHold);
  await page.evaluate((fade) => window.__demo.cover("hidden", { fade }), TIMING.fade);
  await page.waitForTimeout(TIMING.fade);

  // El instante en que la app queda a la vista, sin nada encima. build.mjs corta
  // el mp4 acá: es el primer cuadro que alguien ve. Se anota en vez de deducirse
  // del video porque acá se sabe con certeza —lo acaba de producir este código—
  // mientras que buscarlo por luminancia obliga a adivinar dónde termina un
  // fundido, y adivinar de menos abre en un cuadro blanco o gris.
  const openAt = now() - t0;
  // De acá en adelante un documento nuevo de OTRO origen (sin el estado del
  // telón en su sessionStorage) tiene que arrancar sin telón. Ver overlay.js.
  await context.addInitScript(() => { window.__demoCoverStart = "hidden"; });

  // ── Escenas ────────────────────────────────────────────────────────────────
  for (const scene of demo.scenes) {
    chapters.push({ t: now() - t0, id: scene.id, title: scene.title, proves: scene.proves, watch: scene.watch });
    await page.evaluate((t) => window.__demo.chapter(t), scene.title);

    for (const [beatIndex, beat] of scene.beats.entries()) {
      // El beat de apertura y el que cambia de persona ya navegaron detrás del
      // telón: acá corren sin su `go` para no volver a cargar la misma pantalla.
      let action = beat === openingBeat ? { ...beat, go: null } : beat;

      if (beat.as && beat.as !== current) {
        const person = demo.cast.find((c) => c.as === beat.as);
        const device = deviceOf(person);
        const awaitsSel = beat.awaits ? selectors[beat.awaits] : null;
        if (device) {
          active = await enterDevice(page, phone, { demo, person, device, vp, tmpDir, demoPath, baseURL, goTo: beat.go, awaitsSel, t0 });
        } else {
          if (active !== page) {
            await page.evaluate((fade) => window.__demo.cover("black", { fade }), TIMING.fade);
            await page.waitForTimeout(TIMING.identitySwap);
            phone.segments.push({ start: phone.segStart, end: now() - t0, flashAt: phone.flashAt });
            phone.segStart = null;
            await page.evaluate(() => window.__demo.stage(false));
            active = page;
          }
          await switchIdentity(page, demo, beat.as, baseURL, demoPath, {
            goTo: beat.go,
            awaitsCss: awaitsSel,
            keepSession: beat.as === mainAs,
          });
          mainAs = beat.as;
          // El documento nuevo puede ser de OTRO origen (la página pública de la radio y
          // después la consola): la píldora del capítulo vive en el sessionStorage del
          // origen anterior y no viajaba, así que el resto de la escena salía sin ella.
          await page.evaluate((t) => window.__demo?.chapter(t), scene.title).catch(() => {});
        }
        current = beat.as;
        if (beat.go) action = { ...beat, go: null };
      }

      const clip = voices?.clips.get(cueKey(scene.id, beatIndex)) ?? null;

      // El scroll va ANTES del subtítulo, no adentro de la acción. Corriendo
      // después, el remate de la demo —"sólo ahora el mensaje de Tom es parte de
      // la página"— se decía con el encabezado todavía llenando la pantalla y la
      // tarjeta viajando. La locución tiene que caer sobre la sección ya en cuadro.
      //
      // Vale igual para `highlight`, que también scrollea: el recuadro tiene que
      // caer sobre una sección ya quieta. Ahí el scroll no se consume — repetirlo
      // no cuesta nada porque `scrollTo` corta solo si ya está en cuadro.
      //
      // Se adelanta sólo si es TODA la acción del beat: mezclado con un `go` o un
      // `click`, adelantarlo scrollearía la pantalla que el beat todavía no abrió.
      // El lint ya rechaza esos beats ("una acción por beat"), pero el motor no
      // depende de eso para no romperse.
      const preScroll = isOnlyScroll(action) ? (action.scroll ?? action.highlight) : null;
      if (preScroll) {
        await runAction(active, { scroll: preScroll }, selectors, demoPath, outDir, shots);
        if (action.scroll) action = { ...action, scroll: null };
      }

      // El beat dura lo que tarde MÁS: leer el subtítulo, ejecutar la acción o
      // decir la locución. Se calcula ANTES de actuar porque de esa duración
      // sale el reparto de las frases del subtítulo.
      const burn = demo.captions !== false;
      const target = beatDuration({ caption: beat.say, actionMs: actionCost(action), voiceMs: clip?.ms ?? 0, read: burn || !clip });

      if (beat.say) {
        // El subtítulo pasa en frases de una línea en vez de aparecer como un
        // bloque de dos: el bloque tapa justo la parte de la UI que la escena
        // quiere mostrar, y se termina de leer en un segundo aunque se quede
        // cuatro en pantalla.
        const phrases = phraseTimings(beat.say, target);
        const base = now() - t0;
        let off = 0;
        for (const [i, p] of phrases.entries()) {
          // Sólo la primera frase lleva el audio: la locución es una sola y
          // arranca con el cue, aunque el texto se muestre partido.
          mark("cue", p.text, scene.id, {
            t: base + off,
            voice: i === 0 && clip ? { wav: clip.wav, ms: clip.ms } : undefined,
          });
          off += p.ms;
        }
        // `captions: false`: el texto no se pinta en el video. Los cues se
        // marcan igual — de ahí salen el .vtt, el transcript y la voz.
        if (burn) await page.evaluate((ph) => window.__demo.sayQueue(ph), phrases);
      }

      const started = now();
      await runAction(active, action, selectors, demoPath, outDir, shots);
      // Mismo motivo que en el cambio de persona: un `go` a otro origen pierde la píldora.
      if (action.go && active === page) await page.evaluate((t) => window.__demo?.chapter(t), scene.title).catch(() => {});

      // Lo que falte para la duración del beat, y como mínimo el aire del ritmo
      // (`actionTail`) en un beat mudo: sin él, un tipeo encadenaba con el
      // siguiente sin que se llegara a leer lo que quedó escrito.
      const spent = now() - started;
      const rest = Math.max(target - spent, beat.say ? 0 : TIMING.actionTail);
      if (rest > 0) await page.waitForTimeout(rest);

      if (beat.say) mark("cue-end", "", scene.id);
    }

    if (scene.hold) await page.waitForTimeout(parseDuration(scene.hold));
    await page.evaluate(() => { window.__demo.say(""); window.__demo.chapter(""); });
    await page.waitForTimeout(TIMING.betweenScenes);
  }

  // ── Cierre simétrico: absorbe el truncado de los últimos frames del recorder.
  // Lo que se pierde es una placa estática, no contenido. Por eso el cierre no es
  // opcional aunque el título sí lo sea: sin `titleCard` la placa igual va, muda,
  // porque su trabajo es tragarse los frames que el recorder corta, no rotular.
  await page.evaluate(
    ({ title, fade }) => window.__demo.cover("black", { title, fade }),
    { title: titleCard ? demo.title : "", fade: TIMING.fade },
  );
  await page.waitForTimeout(TIMING.outroHold);
  const tEnd = now() - t0;

  await page.evaluate(() => window.__demo.done());
  if (phone.segStart != null) phone.segments.push({ start: phone.segStart, end: tEnd, flashAt: phone.flashAt });
  let phoneTrack = null;
  if (phone.ctx) {
    const pv = phone.page.video();
    await phone.ctx.close();
    phoneTrack = { webm: await pv.path(), segments: phone.segments, screen: phone.screen };
  }
  const video = page.video();
  await context.close();          // recién acá se materializa el .webm
  await browser.close();

  const webm = await video.path();
  writeFileSync(
    join(tmpDir, "timeline.json"),
    JSON.stringify({ demo: demo.id, webm, tEnd, openAt, cues, chapters, shots, outDir, demoPath, phone: phoneTrack }, null, 2),
  );
  console.log(`✓ grabado: ${webm}\n  timeline: ${join(tmpDir, "timeline.json")}`);
  process.stdout.write(`${join(tmpDir, "timeline.json")}\n`);
}

// ── acciones ─────────────────────────────────────────────────────────────────

/** Acciones que tienen que ocurrir ANTES de un scroll: cambian qué hay para
 *  scrollear. Si el beat trae alguna, el scroll no se puede adelantar. */
const ACTIONS_BEFORE_SCROLL = ["go", "click", "type", "select", "hover", "press", "wait"];

export const isOnlyScroll = (beat) => !ACTIONS_BEFORE_SCROLL.some((k) => beat[k]);

export async function runAction(page, beat, selectors, demoPath, outDir, shots) {
  const sel = (name) => {
    const s = selectors[name];
    if (!s) throw new Error(`Target '${name}' no está en selectors.yml`);
    return s;
  };

  if (beat.go) {
    await page.goto(await expandVars(beat.go), { waitUntil: "domcontentloaded" });
    // Nada de networkidle: en apps con websockets o long-polling no dispara nunca
    // y te comés 15 s de video congelado por navegación.
  }

  // Todo verbo que toca un elemento (click, type, select, upload, hover) lo trae
  // primero a la franja cómoda de la pantalla —centrado, con scroll animado— y
  // espera un instante ANTES de mover el cursor (ver `moveTo`). Antes sólo lo
  // hacían click y type, y sólo si el elemento estaba entero fuera de cuadro:
  // un campo pegado al borde inferior, debajo de una barra sticky o del
  // subtítulo, se tipeaba sin que se viera, y un `select` saltaba de golpe.
  const pulse = (box) =>
    box &&
    // El `?.` y el catch: preflight.mjs reusa esta función SIN overlay montado.
    page.evaluate(([x, y]) => window.__demo?.click(x, y), [box.x + box.width / 2, box.y + box.height / 2]).catch(() => {});

  if (beat.click) {
    const loc = page.locator(sel(beat.click)).first();
    await moveTo(page, loc);
    await page.waitForTimeout(TIMING.dwellBeforeClick);
    await pulse(await loc.boundingBox());
    await loc.click();
  }

  if (beat.hover) {
    const loc = page.locator(sel(beat.hover)).first();
    await moveTo(page, loc);
    await loc.hover();
  }

  if (beat.press) {
    // A keyboard shortcut has no cursor to follow, so the key is drawn on screen
    // (a keycap, bottom centre) for as long as the press takes to register.
    await page.evaluate((key) => {
      const k = document.createElement("div");
      k.setAttribute("data-demo-key", "");
      k.textContent = key.length === 1 ? key.toUpperCase() : key;
      k.style.cssText = "all:initial;position:fixed;left:50%;bottom:72px;transform:translateX(-50%);z-index:2147483646;" +
        "min-width:44px;padding:10px 16px;border-radius:12px;background:#111827;color:#fff;font:600 22px/1 system-ui,sans-serif;" +
        "text-align:center;box-shadow:0 6px 0 #374151,0 10px 24px rgba(0,0,0,.35);pointer-events:none;transition:opacity .25s;";
      document.body.appendChild(k);
      setTimeout(() => { k.style.opacity = "0"; }, 900);
      setTimeout(() => k.remove(), 1200);
    }, beat.press).catch(() => {});
    await page.waitForTimeout(TIMING.dwellBeforeClick);
    await page.keyboard.press(beat.press);
  }

  if (beat.type) {
    const loc = page.locator(sel(beat.type.target)).first();
    await moveTo(page, loc);
    await loc.click();
    const text = await expandVars(beat.type.text);
    // Fecha y hora no se tipean: el teclado entra por segmentos que dependen
    // del locale (es-US pide AM/PM), así que "07:00" tipeado quedaba inválido.
    // fill() con el valor ISO es lo que haría el selector nativo.
    const kind = await loc.evaluate((el) => el.type ?? "").catch(() => "");
    if (["date", "time", "datetime-local", "month", "week"].includes(kind)) {
      await loc.fill(text);
    } else {
      // Tipear 200 caracteres enteros son 9 segundos de video muerto. El ojo sólo
      // necesita ver escribirse el final.
      const { instant, typed } = splitForTyping(text);
      // fill() SIEMPRE, aunque sea con "": `type` reemplaza el valor del campo, no
      // lo extiende. Sin esto, tipear "97.5" sobre "250.3" dejaba "250.397.5", y un
      // campo con un valor inicial (un color, una hora) no cambiaba nunca.
      await loc.fill(instant);
      // El timeout de la acción (5 s) es para encontrar el elemento, no para
      // tipear: a ritmo lento 70 caracteres ya son 6 s.
      await loc.pressSequentially(typed, { delay: TIMING.typeDelay, timeout: TIMING.actionTimeout + typed.length * TIMING.typeDelay });
    }
  }

  if (beat.select) {
    const loc = page.locator(sel(beat.select.target)).first();
    await moveTo(page, loc);
    await page.waitForTimeout(TIMING.dwellBeforeClick);
    await pulse(await loc.boundingBox());
    await loc.selectOption(beat.select.value);
  }

  if (beat.upload) {
    // El <input type=file> suele estar oculto: el cursor va al control visible
    // que lo contiene (el botón de subir), que es lo que una persona tocaría.
    const loc = page.locator(sel(beat.upload.target)).first();
    await moveTo(page, loc);
    await page.waitForTimeout(TIMING.dwellBeforeClick);
    await pulse(await visibleBox(loc));
    const file = resolve(dirname(demoPath), beat.upload.file);
    // Un botón que abre el selector de archivos sin un <input> en el DOM (lo crea al
    // tocarlo, como el "Agregar foto" de una app web): se toca y se contesta el selector.
    const isInput = await loc.evaluate((el) => el instanceof HTMLInputElement && el.type === "file");
    if (isInput) await loc.setInputFiles(file);
    else {
      const [chooser] = await Promise.all([page.waitForEvent("filechooser"), loc.click()]);
      await chooser.setFiles(file);
    }
  }

  if (beat.scroll) {
    await scrollTo(page, page.locator(sel(beat.scroll)).first());
    await page.waitForTimeout(TIMING.scrollSettle); // frena antes del cue
  }

  if (beat.highlight) {
    const loc = page.locator(sel(beat.highlight)).first();
    // Un recuadro rojo fuera de cuadro no destaca nada.
    await scrollTo(page, loc);
    await loc.evaluate((el) => {
      const prev = el.style.boxShadow;
      el.style.transition = "box-shadow 200ms ease";
      el.style.boxShadow = "0 0 0 4px rgba(255,50,50,.55)";
      setTimeout(() => { el.style.boxShadow = prev; }, 1600);
    }).catch(() => {});
    await page.waitForTimeout(1600);
  }

  if (beat.wait) await page.waitForTimeout(parseDuration(beat.wait));

  // La consecuencia declarada. Reemplaza a networkidle y es lo que hace que una
  // demo rota falle en segundos en vez de grabar una pantalla congelada.
  if (beat.awaits) {
    await page.locator(sel(beat.awaits)).first()
      .waitFor({ state: "visible", timeout: TIMING.awaitTimeout })
      .catch(() => {
        throw new Error(
          `No apareció '${beat.awaits}' después de la acción. La demo se corta acá en vez de grabar una pantalla rota.`,
        );
      });
  }

  if (beat.shot && outDir) {
    const file = join(outDir, "shots", `${beat.shot}.png`);
    mkdirSync(dirname(file), { recursive: true });
    await page.screenshot({ path: file });
    shots?.push(file);
  }
}

/**
 * Lleva el target al centro de la pantalla con un scroll animado, y devuelve
 * cuánto duró la animación.
 *
 * El salto instantáneo de `scrollIntoViewIfNeeded()` era la peor transición del
 * video: la pantalla cambia entera de un cuadro al siguiente y el que mira no
 * sabe si bajó, si navegó o si se le rompió algo. Animado, el recorrido cuenta
 * dónde está esa sección dentro de la página, que es información que el guion no
 * tiene que narrar.
 *
 * La duración sale de la distancia a velocidad constante, con piso y techo: una
 * sección contigua no se arrastra y una a diez pantallas no se come dos segundos
 * de más. Se anima el ancestro scrolleable, no siempre la ventana, porque un
 * panel con overflow propio no se mueve tocando `window`.
 */
async function scrollTo(page, locator) {
  const ms = await locator
    .evaluate(
      (target, [speed, min, max]) =>
        new Promise((done) => {
          // Un elemento sin caja (un input oculto) se ubica por su ancestro visible.
          let el = target;
          while (el.parentElement && el.getBoundingClientRect().height === 0) el = el.parentElement;

          let scroller = document.scrollingElement ?? document.documentElement;
          for (let n = el.parentElement; n; n = n.parentElement) {
            const overflow = getComputedStyle(n).overflowY;
            if (/(auto|scroll)/.test(overflow) && n.scrollHeight > n.clientHeight + 1) {
              scroller = n;
              break;
            }
          }

          const isRoot = scroller === document.scrollingElement || scroller === document.documentElement;
          const viewport = isRoot ? window.innerHeight : scroller.clientHeight;
          const originTop = isRoot ? 0 : scroller.getBoundingClientRect().top;
          const rect = el.getBoundingClientRect();

          const from = scroller.scrollTop;
          const centred = from + (rect.top - originTop) - (viewport - Math.min(rect.height, viewport)) / 2;
          const to = Math.max(0, Math.min(centred, scroller.scrollHeight - viewport));
          const distance = to - from;
          if (Math.abs(distance) < 4) return done(0);

          const duration = Math.min(max, Math.max(min, (Math.abs(distance) / speed) * 1000));
          const started = performance.now();
          // easeInOutQuad: arranca y frena suave, así el principio y el final del
          // recorrido no se leen como dos cortes.
          const ease = (p) => (p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2);
          const step = (t) => {
            const p = Math.min(1, (t - started) / duration);
            scroller.scrollTop = from + distance * ease(p);
            if (p < 1) requestAnimationFrame(step);
            else done(duration);
          };
          requestAnimationFrame(step);
        }),
      [TIMING.scrollSpeed, TIMING.scrollMin, TIMING.scrollMax],
    )
    .catch(() => 0);
  if (ms) await page.waitForTimeout(ms + 60);
  return ms;
}

/**
 * ¿Está el elemento en la franja cómoda de la pantalla? Entre el 16% y el 74%
 * del alto: por encima quedan los encabezados sticky y el pill del capítulo; por
 * debajo, el subtítulo y las barras de guardar sticky. "Visible" no alcanzaba:
 * un campo pegado al borde inferior estaba técnicamente en cuadro y tapado.
 */
async function inComfortBand(locator) {
  return locator
    .evaluate((target) => {
      let el = target;
      while (el.parentElement && el.getBoundingClientRect().height === 0) el = el.parentElement;
      // Algo sticky o fixed (la barra de "Guardar" al pie) ya está donde va a
      // estar: scrollear no lo mueve, sólo arrastra el contenido de abajo y saca
      // de cuadro lo que el beat anterior había dejado a la vista.
      for (let n = el; n && n !== document.body && n.tagName !== "DIALOG"; n = n.parentElement) {
        if (/^(sticky|fixed)$/.test(getComputedStyle(n).position)) return true;
      }
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight;
      if (r.height > vh * 0.58) return r.top >= 0 && r.top <= vh * 0.3;
      return r.top >= vh * 0.16 && r.bottom <= vh * 0.74;
    })
    .catch(() => true);
}

/** La caja del elemento o, si está oculto, la de su control visible. */
async function visibleBox(locator) {
  const box = await locator.boundingBox().catch(() => null);
  if (box && box.width && box.height) return box;
  return locator
    .evaluate((target) => {
      for (let el = target.parentElement; el; el = el.parentElement) {
        const ctl = el.querySelector("button, label, [role=button]");
        const pick = ctl && ctl.getBoundingClientRect().height ? ctl : el;
        const r = pick.getBoundingClientRect();
        if (r.width && r.height) return { x: r.x, y: r.y, width: r.width, height: r.height };
      }
      return null;
    })
    .catch(() => null);
}

/** Mueve el cursor con pasos intermedios para que el ojo pueda seguirlo.
 *  Heredado de mira/runner/post-task-review.sh. */
async function moveTo(page, locator) {
  // Playwright también scrollea solo antes de un click, pero de un salto. Si el
  // target no está en la franja cómoda se lo trae al centro, animado, y se deja
  // un instante quieto ANTES de mover el cursor: si no, el puntero viaja a una
  // posición que la pantalla todavía no muestra, o se tipea en un campo tapado.
  await locator.waitFor({ state: "attached" }).catch(() => {});
  if (!(await inComfortBand(locator))) {
    const ms = await scrollTo(page, locator);
    if (ms) await page.waitForTimeout(TIMING.intoViewSettle);
  }

  const box = await visibleBox(locator);
  if (!box) return;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y, { steps: TIMING.cursorSteps });
  // El listener de mousemove cubre el caso normal; este evaluate cubre el que no:
  // después de un scroll el mouse no se movió pero el elemento debajo sí.
  // `?.` + catch porque preflight.mjs reusa esto sin overlay montado.
  await page.evaluate(([px, py]) => window.__demo?.cursor(px, py), [x, y]).catch(() => {});
}

// ── identidad ────────────────────────────────────────────────────────────────

/**
 * Cambia de persona SIN abrir otro contexto (eso produciría un segundo .webm).
 *
 * La pantalla se tapa lo justo para que no se vea el reload ni el borrado de
 * cookies, y **sin texto encima**. Antes se pintaba una placa de marca con
 * "Ahora, <nombre>": ocupaba el cuadro entero durante casi un segundo, sacaba al
 * producto de cámara justo en la bisagra de la historia, y encima salía en
 * castellano en una demo hablada en inglés porque el texto por defecto estaba
 * escrito en el motor. Quién entra ahora lo dice la locución, que puede
 * explicarlo sin apagar la imagen — y el lint exige ese `say` (`as` sin `say`).
 *
 * El destino del beat (`goTo`) se navega ACÁ ATRÁS, no después, y el telón no
 * levanta hasta que lo que el beat espera (`awaitsCss`) está pintado. Recargando
 * la URL de quien se fue, el telón levantaba sobre su pantalla mientras la nueva
 * recién empezaba a cargar: la locución —que arranca con el telón— hablaba del
 * plan de Marion mientras se veía la página pública del vecino. El beat corre
 * después sin su `go`, igual que el de apertura.
 */
async function switchIdentity(page, demo, as, baseURL, demoPath, { goTo, awaitsCss, keepSession = false } = {}) {
  const person = demo.cast.find((c) => c.as === as);
  if (!person) throw new Error(`'${as}' no está en cast`);

  await page.evaluate((fade) => window.__demo.cover("black", { fade }), TIMING.fade);
  await page.waitForTimeout(TIMING.identitySwap);

  // Volver a quien ya tenía la sesión de este contexto (después de una escena
  // en el teléfono) no la borra: no tiene por qué volver a loguearse.
  if (!keepSession) {
    await page.context().clearCookies();
    await authenticate(page, person, baseURL, demoPath);
  }
  if (goTo) await page.goto(await expandVars(goTo), { waitUntil: "domcontentloaded" });
  else await page.reload({ waitUntil: "domcontentloaded" });
  await applyMask(page, demo);
  // Si el target no está en selectors.yml no se falla acá: runAction levanta el
  // error con el nombre del target, que es el mensaje que sirve.
  if (awaitsCss) await page.waitForSelector(awaitsCss, { state: "visible", timeout: 15000 });

  await page.evaluate((fade) => window.__demo.cover("hidden", { fade }), TIMING.fade);
  await page.waitForTimeout(TIMING.fade);
}

/**
 * Entra a una persona con `device:`. El video de escritorio queda tapado por el
 * telón mientras se arma, después muestra el marco de teléfono; la persona actúa
 * en SU contexto (viewport, dsf, touch y UA de teléfono), que graba su propio
 * webm. El flash de calibración se repite en el teléfono: build.mjs lo busca en
 * ese webm para saber qué cuadro corresponde a cada instante del principal.
 */
/**
 * El contexto del teléfono (uno solo para toda la demo). Se abre la primera vez que
 * entra una persona con `device:`, o antes, detrás del telón de apertura, para
 * precalentarlo: sin eso, la primera entrada al teléfono dejaba 4–8 s de negro
 * mientras la app web arrancaba en frío.
 */
async function openPhone(page, phone, { demo, person, device, tmpDir, demoPath, baseURL }) {
  const dir = join(tmpDir, "device");
  mkdirSync(dir, { recursive: true });
  phone.ctx = await page.context().browser().newContext({
    ...device,
    locale: person.locale ?? demo.locale ?? "es-AR",
    timezoneId: person.timezone ?? demo.timezone ?? "America/Argentina/Buenos_Aires",
    colorScheme: "light",
    // `geolocation:` en el cast: el teléfono "está" ahí y ya dio el permiso, así un
    // "Cerca de ti" funciona sin el diálogo del navegador (que no se graba).
    ...(person.geolocation ? { geolocation: person.geolocation, permissions: ["geolocation"] } : {}),
    // El video va al tamaño del viewport en px CSS. Pedirlo a 2x (dsf) NO da
    // más resolución: el screencast igual llega en px CSS y Playwright lo pega
    // arriba a la izquierda de un lienzo gris del doble — un cuarto de imagen.
    recordVideo: { dir, size: { ...device.viewport } },
  });
  await installOverlay(phone.ctx, demo);
  phone.page = await phone.ctx.newPage();
  phone.page.setDefaultTimeout(TIMING.actionTimeout);
  // Una app desplegada puede tardar más que un click en cargar en frío: la
  // navegación tiene su propio margen, sin aflojar el fail-fast de las acciones.
  phone.page.setDefaultNavigationTimeout(TIMING.navigationTimeout);
  await installFixtures(phone.page, demo, demoPath);
  await authenticate(phone.page, person, baseURL, demoPath);
}

async function enterDevice(page, phone, { demo, person, device, vp, tmpDir, demoPath, baseURL, goTo, awaitsSel, t0 }) {
  // The phone loads its destination BEFORE the desktop goes black: its frames until the
  // flash below are never used, and the desktop stays on screen meanwhile. Loading it
  // behind the black curtain left 3–4 s of black in every phone scene.
  if (!phone.ctx) await openPhone(page, phone, { demo, person, device, tmpDir, demoPath, baseURL });
  const p = phone.page;
  if (goTo) await p.goto(await expandVars(goTo), { waitUntil: "domcontentloaded" });
  await applyMask(p, demo);
  // Un margen corto: si el destino no pintó a tiempo, el `awaits` del beat (con la
  // locución ya sonando) espera el resto y se ve la app abriendo, no negro mudo.
  const ready = awaitsSel
    ? await p.locator(awaitsSel).first().waitFor({ state: "visible", timeout: TIMING.deviceSettle }).then(() => true, () => false)
    : false;
  await p.waitForTimeout(ready ? 400 : TIMING.openingSettle);

  await page.evaluate((fade) => window.__demo.cover("black", { fade }), TIMING.fade);
  await page.waitForTimeout(TIMING.fade);

  phone.screen = stageScreen(device, vp.viewport);
  phone.device = device;
  await page.evaluate(
    ([screen, label]) => window.__demo.stage(true, { screen, label }),
    [phone.screen, person.label ?? person.name ?? ""],
  );

  await p.evaluate(() => window.__demo.cover("flash"));
  await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  phone.flashAt = now() - t0;
  await p.waitForTimeout(TIMING.clapFlash);
  await p.evaluate(() => window.__demo.cover("hidden", { fade: 0 }));
  await p.waitForTimeout(120);

  phone.segStart = now() - t0;
  // Igual que en el contexto principal: un `go` del teléfono a OTRO origen (sin el
  // estado del telón en su sessionStorage) arrancaba con el telón negro y el resto
  // de la escena se grababa a oscuras. Ya se abrió: de acá en adelante, sin telón.
  if (!phone.coverHidden) {
    await phone.ctx.addInitScript(() => { window.__demoCoverStart = "hidden"; });
    phone.coverHidden = true;
  }
  await page.evaluate((fade) => window.__demo.cover("hidden", { fade }), TIMING.fade);
  await page.waitForTimeout(TIMING.fade);
  return p;
}

async function authenticate(page, person, baseURL, demoPath) {
  const auth = person.auth ?? { via: "none" };
  if (auth.via === "none") return;

  if (auth.via === "storageState") {
    const file = resolve(dirname(demoPath), auth.file);
    if (!existsSync(file)) throw new Error(`No existe el storageState ${file}. Corré el seed primero.`);
    const state = JSON.parse(readFileSync(file, "utf8"));
    const cookies = state.cookies ?? [];
    // Grabando contra el origen de la app (sin la CDN de adelante) el host cambia: las
    // cookies de la sesión se copian también a ese host, si no, la consola pide login.
    const host = new URL(baseURL).hostname;
    const extra = cookies.filter((c) => c.domain.replace(/^\./, "") !== host).map((c) => ({ ...c, domain: host }));
    await page.context().addCookies([...cookies, ...extra]);
    return;
  }

  // via: api — el login por request deja la cookie en el contexto sin gastar
  // segundos de video en un formulario que no es la demo.
  const email = expand(auth.email);
  const password = expand(auth.password);
  const endpoint = auth.endpoint ?? "/api/auth/login";
  for (let i = 1; i <= 3; i++) {
    const res = await page.request.post(`${baseURL}${endpoint}`, { data: { email, password } });
    if (res.ok()) return;
    if (i === 3) throw new Error(`Login de '${person.as}' falló con ${res.status()} después de 3 intentos.`);
    await page.waitForTimeout(1000 * i);
  }
}

/** ${VAR} → process.env.VAR. Las credenciales nunca van hardcodeadas en el guion. */
function expand(v) {
  if (!v) return v;
  return String(v).replace(/\$\{([A-Z0-9_]+)\}/g, (_, name) => {
    const val = seedVars()[name] ?? process.env[name];
    if (!val) die(`Falta la variable de entorno ${name}, referenciada en el guion.`);
    return val;
  });
}

/**
 * Los valores que deja el seed. demo.sh le pasa al seed `DEMO_VARS`, la ruta de
 * un archivo `KEY=VALUE` (600, en el directorio temporal de la corrida), y el
 * seed escribe ahí lo que el guion necesita y no se conoce de antemano: el link
 * de una invitación recién creada, el id de algo que se crea en cámara.
 *
 * Se relee en cada uso, no una vez al arrancar, porque un valor puede llegar
 * TARDE: si el seed deja un proceso mirando la base, el id de una marca creada
 * en la escena 2 recién existe cuando la escena 2 terminó. El archivo gana sobre
 * el entorno: el seed de esta corrida es la fuente de verdad, y una variable
 * exportada de una corrida anterior apunta a un mundo que ya se borró.
 */
function seedVars() {
  const file = process.env.DEMO_VARS;
  if (!file || !existsSync(file)) return {};
  const out = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2];
  }
  return out;
}

/** Como expand(), pero espera hasta `LATE_VAR_WAIT` a un valor que el seed
 *  todavía no escribió, en vez de abortar en el acto. */
async function expandVars(v) {
  if (!v || !/\$\{[A-Z0-9_]+\}/.test(String(v))) return v;
  const deadline = Date.now() + LATE_VAR_WAIT;
  for (;;) {
    const names = [...String(v).matchAll(/\$\{([A-Z0-9_]+)\}/g)].map((m) => m[1]);
    const vars = seedVars();
    if (names.every((n) => vars[n] ?? process.env[n]) || Date.now() > deadline) return expand(v);
    await new Promise((r) => setTimeout(r, 250));
  }
}
const LATE_VAR_WAIT = 20_000;

/**
 * El user agent de un Chrome normal. El headless se anuncia como
 * "HeadlessChrome/…", y varios CDN de audio y video (SomaFM, entre otros)
 * contestan 403 a eso: el reproductor de la demo quedaba mudo o en error sin que
 * la app tuviera nada que ver. `userAgent:` en el guion lo pisa.
 */
function demoUserAgent(browser, demo) {
  if (demo?.userAgent) return demo.userAgent;
  return `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${browser.version()} Safari/537.36`;
}

async function applyMask(page, demo) {
  await page.evaluate(
    ({ hide, redact }) => window.__demo.mask(hide, redact),
    { hide: demo.hide ?? DEFAULT_HIDE, redact: demo.redact ?? [] },
  );
}

// Ruido que aparece en casi toda app nuestra y que en cámara delata que es dev.
const DEFAULT_HIDE = [
  "nextjs-portal",
  "#__next-build-watcher",
  "[data-nextjs-toast]",
  "[data-vercel-toolbar]",
  ".splash-screen",
  "#crisp-chatbox",
  ".intercom-lightweight-app",
];

export function die(msg) {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
}

export { authenticate, moveTo, demoUserAgent, installOverlay, expandVars };

// Sólo graba cuando se lo invoca directamente: preflight.mjs importa runAction
// de acá para que las dos etapas ejecuten EXACTAMENTE las mismas acciones. Si
// divergieran, `--check` podría pasar y la grabación fallar igual.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => die(e.stack ?? e.message));
}
