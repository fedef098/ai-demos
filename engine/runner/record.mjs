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
import { TIMING, beatDuration, captionHold, actionCost, splitForTyping, parseDuration } from "./pacing.mjs";
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

// ── reloj monotónico, en ms desde el arranque del proceso ────────────────────
const now = () => Number(process.hrtime.bigint() / 1000n) / 1000;

async function main() {
  const demoPath = process.argv[2];
  if (!demoPath) die("Uso: node <runner>/record.mjs demos/<producto>/<slug>.demo.yml");

  const { demo, selectors, capabilities } = loadDemo(demoPath);
  const { errors } = lint(demo, selectors, capabilities);
  if (errors.length) die(`El guion no pasa el lint:\n${errors.map((e) => `  ✖ ${e}`).join("\n")}`);

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
  });

  const context = await browser.newContext({
    ...vp,
    baseURL,
    locale: demo.locale ?? "es-AR",
    timezoneId: demo.timezone ?? "America/Argentina/Buenos_Aires",
    colorScheme: "light",
    deviceScaleFactor: 1, // dsf 2 no sube la resolución del video y cuadruplica el render
    recordVideo: { dir: tmpDir, size: vp.viewport },
  });

  // La máscara antes que el overlay: el overlay la lee al arrancar y así queda
  // puesta en CADA documento, no sólo en el primero.
  await context.addInitScript(
    (m) => { window.__demoMask = m; },
    { hide: demo.hide ?? DEFAULT_HIDE, redact: demo.redact ?? [] },
  );

  // El overlay ANTES de cualquier navegación: pinta el cover negro a
  // document-start, así el video no arranca mostrando el redirect a /login.
  await context.addInitScript({ path: OVERLAY });

  const page = await context.newPage();
  page.setDefaultTimeout(TIMING.actionTimeout);

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

  for (const f of demo.fixtures ?? []) {
    const body = readFileSync(resolve(dirname(demoPath), f.body), "utf8");
    await page.route(f.route, (route) =>
      route.request().method() === (f.method ?? "GET")
        ? route.fulfill({ status: f.status ?? 200, contentType: "application/json", body })
        : route.continue(),
    );
  }

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
  await authenticate(page, first, baseURL, demoPath);
  current = first.as;
  // Esta navegación ES la del primer beat, adelantada detrás del cover. Se guarda
  // el beat para no repetirla en cámara: volver a `goto` la misma URL recarga la
  // app entera y el video abre sobre el skeleton, que es justo lo que el cover
  // estaba tapando.
  const openingBeat = demo.scenes[0].beats.find((b) => b.go) ?? null;
  await page.goto(openingBeat?.go ?? "/", { waitUntil: "domcontentloaded" });
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

  // ── Escenas ────────────────────────────────────────────────────────────────
  for (const scene of demo.scenes) {
    chapters.push({ t: now() - t0, id: scene.id, title: scene.title, proves: scene.proves, watch: scene.watch });
    await page.evaluate((t) => window.__demo.chapter(t), scene.title);

    for (const [beatIndex, beat] of scene.beats.entries()) {
      // El beat de apertura y el que cambia de persona ya navegaron detrás del
      // telón: acá corren sin su `go` para no volver a cargar la misma pantalla.
      let action = beat === openingBeat ? { ...beat, go: null } : beat;

      if (beat.as && beat.as !== current) {
        await switchIdentity(page, demo, beat.as, baseURL, demoPath, {
          goTo: beat.go,
          awaitsCss: beat.awaits ? selectors[beat.awaits] : null,
        });
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
        await runAction(page, { scroll: preScroll }, selectors, demoPath, outDir, shots);
        if (action.scroll) action = { ...action, scroll: null };
      }

      // El beat dura lo que tarde MÁS: leer el subtítulo, ejecutar la acción o
      // decir la locución. Se calcula ANTES de actuar porque de esa duración
      // sale el reparto de las frases del subtítulo.
      const target = beatDuration({ caption: beat.say, actionMs: actionCost(action), voiceMs: clip?.ms ?? 0 });

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
        await page.evaluate((ph) => window.__demo.sayQueue(ph), phrases);
      }

      const started = now();
      await runAction(page, action, selectors, demoPath, outDir, shots);

      const spent = now() - started;
      if (spent < target) await page.waitForTimeout(target - spent);

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
  const video = page.video();
  await context.close();          // recién acá se materializa el .webm
  await browser.close();

  const webm = await video.path();
  writeFileSync(
    join(tmpDir, "timeline.json"),
    JSON.stringify({ demo: demo.id, webm, tEnd, openAt, cues, chapters, shots, outDir, demoPath }, null, 2),
  );
  console.log(`✓ grabado: ${webm}\n  timeline: ${join(tmpDir, "timeline.json")}`);
  process.stdout.write(`${join(tmpDir, "timeline.json")}\n`);
}

// ── acciones ─────────────────────────────────────────────────────────────────

/** Acciones que tienen que ocurrir ANTES de un scroll: cambian qué hay para
 *  scrollear. Si el beat trae alguna, el scroll no se puede adelantar. */
const ACTIONS_BEFORE_SCROLL = ["go", "click", "type", "select", "hover", "wait"];

export const isOnlyScroll = (beat) => !ACTIONS_BEFORE_SCROLL.some((k) => beat[k]);

export async function runAction(page, beat, selectors, demoPath, outDir, shots) {
  const sel = (name) => {
    const s = selectors[name];
    if (!s) throw new Error(`Target '${name}' no está en selectors.yml`);
    return s;
  };

  if (beat.go) {
    await page.goto(beat.go, { waitUntil: "domcontentloaded" });
    // Nada de networkidle: en apps con websockets o long-polling no dispara nunca
    // y te comés 15 s de video congelado por navegación.
  }

  if (beat.click) {
    const css = sel(beat.click);
    const loc = page.locator(css).first();
    await moveTo(page, loc, css);
    await page.waitForTimeout(TIMING.dwellBeforeClick);
    const box = await loc.boundingBox();
    // El `?.` y el catch: preflight.mjs reusa esta función SIN overlay montado.
    if (box)
      await page
        .evaluate(([x, y]) => window.__demo?.click(x, y), [box.x + box.width / 2, box.y + box.height / 2])
        .catch(() => {});
    await loc.click();
  }

  if (beat.hover) {
    const css = sel(beat.hover);
    const loc = page.locator(css).first();
    await moveTo(page, loc, css);
    await loc.hover();
  }

  if (beat.type) {
    const css = sel(beat.type.target);
    const loc = page.locator(css).first();
    await moveTo(page, loc, css);
    await loc.click();
    // Tipear 200 caracteres enteros son 9 segundos de video muerto. El ojo sólo
    // necesita ver escribirse el final.
    const { instant, typed } = splitForTyping(beat.type.text);
    if (instant) await loc.fill(instant);
    await loc.pressSequentially(typed, { delay: TIMING.typeDelay });
  }

  if (beat.select) {
    await page.locator(sel(beat.select.target)).first().selectOption(beat.select.value);
  }

  if (beat.upload) {
    await page.locator(sel(beat.upload.target)).first()
      .setInputFiles(resolve(dirname(demoPath), beat.upload.file));
  }

  if (beat.scroll) {
    await scrollTo(page, sel(beat.scroll));
    await page.waitForTimeout(TIMING.scrollSettle); // frena antes del cue
  }

  if (beat.highlight) {
    const s = sel(beat.highlight);
    // Un recuadro rojo fuera de cuadro no destaca nada.
    await scrollTo(page, s);
    await page.evaluate((css) => {
      const el = document.querySelector(css);
      if (!el) return;
      const prev = el.style.boxShadow;
      el.style.transition = "box-shadow 200ms ease";
      el.style.boxShadow = "0 0 0 4px rgba(255,50,50,.55)";
      setTimeout(() => { el.style.boxShadow = prev; }, 1200);
    }, s);
    await page.waitForTimeout(1200);
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
async function scrollTo(page, css) {
  const ms = await page
    .evaluate(
      ([selector, speed, min, max]) =>
        new Promise((done) => {
          const el = document.querySelector(selector);
          if (!el) return done(0);

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
      [css, TIMING.scrollSpeed, TIMING.scrollMin, TIMING.scrollMax],
    )
    .catch(() => 0);
  if (ms) await page.waitForTimeout(ms + 60);
  return ms;
}

/** Mueve el cursor con pasos intermedios para que el ojo pueda seguirlo.
 *  Heredado de mira/runner/post-task-review.sh. */
async function moveTo(page, locator, css) {
  // Playwright también scrollea solo antes de un click, pero de un salto. Si el
  // target está fuera de cuadro se lo trae animado ANTES de mover el cursor: si
  // no, el puntero viaja a una posición que la pantalla todavía no muestra.
  if (css) {
    const visible = await locator
      .evaluate((el) => {
        const { top, bottom } = el.getBoundingClientRect();
        return top >= 0 && bottom <= window.innerHeight;
      })
      .catch(() => true);
    if (!visible) await scrollTo(page, css);
  }

  const box = await locator.boundingBox().catch(() => null);
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
async function switchIdentity(page, demo, as, baseURL, demoPath, { goTo, awaitsCss } = {}) {
  const person = demo.cast.find((c) => c.as === as);
  if (!person) throw new Error(`'${as}' no está en cast`);

  await page.evaluate((fade) => window.__demo.cover("black", { fade }), TIMING.fade);
  await page.waitForTimeout(TIMING.identitySwap);

  await page.context().clearCookies();
  await authenticate(page, person, baseURL, demoPath);
  if (goTo) await page.goto(goTo, { waitUntil: "domcontentloaded" });
  else await page.reload({ waitUntil: "domcontentloaded" });
  await applyMask(page, demo);
  // Si el target no está en selectors.yml no se falla acá: runAction levanta el
  // error con el nombre del target, que es el mensaje que sirve.
  if (awaitsCss) await page.waitForSelector(awaitsCss, { state: "visible", timeout: 15000 });

  await page.evaluate((fade) => window.__demo.cover("hidden", { fade }), TIMING.fade);
  await page.waitForTimeout(TIMING.fade);
}

async function authenticate(page, person, baseURL, demoPath) {
  const auth = person.auth ?? { via: "none" };
  if (auth.via === "none") return;

  if (auth.via === "storageState") {
    const file = resolve(dirname(demoPath), auth.file);
    if (!existsSync(file)) throw new Error(`No existe el storageState ${file}. Corré el seed primero.`);
    const state = JSON.parse(readFileSync(file, "utf8"));
    await page.context().addCookies(state.cookies ?? []);
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
    const val = process.env[name];
    if (!val) die(`Falta la variable de entorno ${name}, referenciada en el guion.`);
    return val;
  });
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

export { authenticate, moveTo };

// Sólo graba cuando se lo invoca directamente: preflight.mjs importa runAction
// de acá para que las dos etapas ejecuten EXACTAMENTE las mismas acciones. Si
// divergieran, `--check` podría pasar y la grabación fallar igual.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => die(e.stack ?? e.message));
}
