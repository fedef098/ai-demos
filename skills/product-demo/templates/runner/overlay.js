// RUNNER_VERSION 1
//
// Overlay de la demo: portada, subtítulo, cursor sintético y cortinas.
// Se registra con `context.addInitScript({ path: 'overlay.js' })`.
//
// ── Por qué addInitScript y no addStyleTag ────────────────────────────────────
// addInitScript corre ANTES de los scripts de la página, EN CADA DOCUMENTO NUEVO.
// Sobrevive a todo goto sin una sola línea en el driver. El motor de Mira
// (runner/post-task-review.sh) usa addStyleTag + evaluate, que se pierden en cada
// navegación — por eso tiene que llamar injectCursor(page) a mano después de cada
// paso `navigate`, y por eso el cursor desaparece si alguien olvida hacerlo.
//
// ── Por qué el shadow root es CERRADO ─────────────────────────────────────────
// Playwright ATRAVIESA los shadow roots abiertos en sus selectores CSS y de texto.
// Con mode:'open', un `text=Enviar` del propio guion podría matchear el subtítulo
// en vez del botón, y cualquier test del proyecto vería nuestros nodos. Cerrado,
// el overlay es literalmente inalcanzable para los locators.
//
// El estado se comunica por window.__demo (el driver lo llama con page.evaluate).

(() => {
  if (window.__demo) return; // ya instalado en este documento

  const CUE_KEY = "__demo_cue__";
  const HOST_TAG = "demo-overlay";

  let root = null;   // el shadow root cerrado
  let els = null;    // referencias a los nodos internos
  let queueTimer = null; // avance de las frases de un mismo cue

  const CSS = `
    :host { all: initial; }
    .layer {
      position: fixed; inset: 0; pointer-events: none;
      font-family: Inter, system-ui, -apple-system, sans-serif;
      -webkit-font-smoothing: antialiased;
    }
    /* Cover: arranca NEGRO OPACO para que el video no empiece mostrando el
       redirect a /login, el skeleton ni el FOUT. */
    .cover {
      position: fixed; inset: 0; background: #000; opacity: 1;
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      gap: 18px; text-align: center; padding: 8vw;
      transition: opacity var(--fade, 400ms) ease, background-color 120ms linear;
    }
    .cover[data-state="hidden"] { opacity: 0; }
    /* El flash de calibración tiene que ser INSTANTÁNEO y blanco puro: build.mjs
       lo busca en el video midiendo luminancia media (YAVG > 200). Con la
       transición heredada, el cover se desvanece hacia el blanco y a 25fps no
       llega nunca a saturar — la claqueta no se detecta y los subtítulos
       quedan anclados en 0. */
    .cover[data-state="flash"]  { background: #fff; transition: none; }
    .cover-title {
      color: #fff; font-size: 40px; line-height: 1.15; font-weight: 700;
      letter-spacing: -0.03em; max-width: 20ch;
    }
    .cover-promise {
      color: rgba(255,255,255,.82); font-size: 20px; line-height: 1.5;
      font-weight: 400; max-width: 46ch;
    }
    /* Subtítulo. Su transición vive acá adentro, así que el
       "animation-duration: 0s !important" que la app pueda tener no lo alcanza. */
    .caption {
      position: fixed; left: 50%; bottom: 6%; transform: translateX(-50%);
      max-width: min(46ch, 86vw); box-sizing: border-box;
      padding: 14px 22px; border-radius: 12px;
      background: rgba(12,14,16,.86); color: #fff;
      font-size: 22px; line-height: 1.38; font-weight: 500; letter-spacing: -0.01em;
      text-align: center; text-wrap: balance;
      opacity: 0; transition: opacity 220ms ease;
      box-shadow: 0 8px 32px rgba(0,0,0,.35);
    }
    .caption[data-on="1"] { opacity: 1; }
    /* Pill con el título de la escena, arriba a la izquierda. */
    .chapter {
      position: fixed; top: 22px; left: 22px;
      padding: 8px 16px; border-radius: 999px;
      background: rgba(12,14,16,.72); color: #fff;
      font-size: 14px; font-weight: 600; letter-spacing: -0.01em;
      opacity: 0; transition: opacity 220ms ease;
    }
    .chapter[data-on="1"] { opacity: 1; }
    /* Cursor sintético. Heredado de mira/runner/post-task-review.sh, pero acá
       adentro: el original lo dibujaba en body::after, que rompe cualquier app
       que ya use ese pseudo-elemento. */
    .cursor {
      position: fixed; width: 20px; height: 20px; border-radius: 50%;
      background: rgba(255,50,50,.8);
      box-shadow: 0 0 12px 4px rgba(255,50,50,.5), 0 0 4px 2px rgba(255,255,255,.8);
      transform: translate(-50%,-50%); left: -100px; top: -100px;
      transition: left 50ms ease-out, top 50ms ease-out;
    }
    /* Anillo de click: sin esto, en video no se entiende que pasó algo. */
    .pulse {
      position: fixed; width: 20px; height: 20px; border-radius: 50%;
      border: 2px solid rgba(255,50,50,.9);
      transform: translate(-50%,-50%) scale(1); opacity: 0;
      pointer-events: none;
    }
    .pulse[data-on="1"] { animation: pulse 250ms ease-out; }
    @keyframes pulse {
      from { opacity: .9; transform: translate(-50%,-50%) scale(1); }
      to   { opacity: 0;  transform: translate(-50%,-50%) scale(3.2); }
    }
  `;

  function build() {
    if (root && document.documentElement.contains(root.host)) return;

    const host = document.createElement(HOST_TAG);
    host.setAttribute("data-demo-overlay", "");
    // aria-hidden lo saca de getByRole/getByText; pointer-events:none evita que
    // intercepte un click destinado a la app.
    host.setAttribute("aria-hidden", "true");
    host.style.cssText =
      "position:fixed;inset:0;z-index:2147483647;pointer-events:none;all:initial;";

    root = host.attachShadow({ mode: "closed" });
    root.innerHTML = `
      <style>${CSS}</style>
      <div class="layer">
        <!-- Arranca NEGRO Y OPACO a propósito: el video empieza a grabar en
             cuanto se crea la página, así que sin esto los primeros segundos
             muestran el redirect a /login, el skeleton y el FOUT. -->
        <div class="cover" data-state="shown">
          <div class="cover-title"></div>
          <div class="cover-promise"></div>
        </div>
        <div class="chapter" data-on="0"></div>
        <div class="caption" data-on="0"></div>
        <div class="cursor"></div>
        <div class="pulse"></div>
      </div>`;

    els = {
      cover: root.querySelector(".cover"),
      coverTitle: root.querySelector(".cover-title"),
      coverPromise: root.querySelector(".cover-promise"),
      chapter: root.querySelector(".chapter"),
      caption: root.querySelector(".caption"),
      cursor: root.querySelector(".cursor"),
      pulse: root.querySelector(".pulse"),
    };

    document.body.appendChild(host);

    // Un SPA puede vaciar el body al hidratar. Si nos borra, volvemos.
    new MutationObserver(() => {
      if (!document.body.contains(host)) document.body.appendChild(host);
    }).observe(document.body, { childList: true });

    restoreCue();
  }

  // A document-start `document.body` todavía no existe.
  function boot() {
    if (document.body) return build();
    new MutationObserver((_, obs) => {
      if (document.body) {
        obs.disconnect();
        build();
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
  }

  // Una navegación dura pierde el estado JS. Persistimos el cue y lo restauramos
  // a document-start, así el subtítulo ya está pintado en el PRIMER FRAME del
  // documento nuevo: en el video no queda un hueco al navegar.
  function restoreCue() {
    try {
      const raw = sessionStorage.getItem(CUE_KEY);
      if (!raw) return;
      const { caption, chapter, queue } = JSON.parse(raw);
      if (chapter) api.chapter(chapter);
      // Si el cue tenía frases pendientes, se retoman desde donde estaba. Se
      // pierde lo transcurrido de la frase actual, que es menos malo que
      // congelar el subtítulo a mitad del cue o comerse las que faltan.
      if (queue && queue.phrases?.length) api.sayQueue(queue.phrases.slice(queue.index));
      else if (caption) api.say(caption);
    } catch {}
  }

  // Estado de la cola vigente, para que un chapter() en el medio no lo pise.
  let currentQueue = null;

  function persistCue(caption, chapter, queue = currentQueue) {
    currentQueue = queue ?? null;
    try {
      sessionStorage.setItem(CUE_KEY, JSON.stringify({ caption, chapter, queue: currentQueue }));
    } catch {}
  }

  function stopQueue() {
    if (queueTimer) clearTimeout(queueTimer);
    queueTimer = null;
  }

  function paint(text) {
    const on = Boolean(text && text.trim());
    els.caption.textContent = text ?? "";
    els.caption.setAttribute("data-on", on ? "1" : "0");
  }

  const api = {
    say(text) {
      build();
      stopQueue();
      paint(text);
      persistCue(text, els.chapter.textContent, null);
    },

    /**
     * Muestra un mismo cue partido en frases de una línea, cada una durante sus
     * ms. La última NO se borra sola: queda hasta el próximo say/sayQueue, así
     * si la acción se estira más que la locución no queda un hueco mudo.
     *
     * El avance vive en la página y no en el driver porque el driver está
     * ocupado ejecutando la acción (click, tipeo, espera de la consecuencia): si
     * el subtítulo dependiera de él, no pasaría de frase hasta que la acción
     * termine, que es justo cuando ya no sirve.
     */
    sayQueue(phrases) {
      build();
      stopQueue();
      if (!phrases || !phrases.length) return api.say("");

      let i = 0;
      const step = () => {
        paint(phrases[i].text);
        persistCue(phrases[i].text, els.chapter.textContent, { phrases, index: i });
        if (i >= phrases.length - 1) return;
        const hold = phrases[i].ms;
        queueTimer = setTimeout(() => { i += 1; step(); }, hold);
      };
      step();
    },

    chapter(text) {
      build();
      els.chapter.textContent = text ?? "";
      els.chapter.setAttribute("data-on", text ? "1" : "0");
      persistCue(els.caption.textContent, text);
    },

    /** state: 'black' | 'hidden' | 'flash' | 'brand' */
    cover(state, { title = "", promise = "", fade = 400, color } = {}) {
      build();
      els.coverTitle.textContent = title;
      els.coverPromise.textContent = promise;
      els.cover.style.setProperty("--fade", `${fade}ms`);
      if (state === "brand") {
        els.cover.style.background = color || "#0369a1";
        els.cover.setAttribute("data-state", "shown");
        els.cover.style.opacity = "1";
      } else if (state === "flash") {
        els.cover.setAttribute("data-state", "flash");
        els.cover.style.opacity = "1";
      } else if (state === "hidden") {
        els.cover.setAttribute("data-state", "hidden");
      } else {
        els.cover.style.background = "#000";
        els.cover.setAttribute("data-state", "shown");
        els.cover.style.opacity = "1";
      }
    },

    cursor(x, y) {
      build();
      els.cursor.style.left = `${x}px`;
      els.cursor.style.top = `${y}px`;
    },

    click(x, y) {
      build();
      els.pulse.style.left = `${x}px`;
      els.pulse.style.top = `${y}px`;
      els.pulse.setAttribute("data-on", "0");
      void els.pulse.offsetWidth; // reinicia la animación
      els.pulse.setAttribute("data-on", "1");
    },

    /** Oculta ruido (badges de dev, widgets de chat) y difumina datos sensibles.
     *  Es lo ÚNICO que toca el light DOM de la app; se remueve en teardown. */
    mask(hide = [], redact = []) {
      const id = "__demo_mask__";
      document.getElementById(id)?.remove();
      if (!hide.length && !redact.length) return;
      const style = document.createElement("style");
      style.id = id;
      const rules = [];
      if (hide.length) rules.push(`${hide.join(",")}{display:none!important}`);
      if (redact.length)
        rules.push(`${redact.join(",")}{filter:blur(7px)!important;user-select:none!important}`);
      style.textContent = rules.join("\n");
      (document.head || document.documentElement).appendChild(style);
    },

    unmask() {
      document.getElementById("__demo_mask__")?.remove();
    },

    done() {
      try { sessionStorage.removeItem(CUE_KEY); } catch {}
    },
  };

  window.__demo = api;

  // El cursor sigue al mouse real de Playwright. En captura, para ganarle a una
  // app que haga stopPropagation. El driver además empuja la posición por
  // evaluate() — hace falta porque después de un scroll el mouse no se movió
  // pero el elemento debajo sí.
  window.addEventListener(
    "mousemove",
    (e) => api.cursor(e.clientX, e.clientY),
    { capture: true, passive: true },
  );

  boot();
})();
