# ai-demos — demos de producto guionadas

Este repo tiene dos cosas: la skill **demofed** (el motor que graba demos de
producto con Playwright, bajo `plugins/demofed/`) y **las demos** de cada producto
(bajo `demos/`, una carpeta por producto). Grabar no necesita el checkout de la
app: se corre contra una URL desplegada y el seed habla HTTP. **El video queda
local**, no se sube a ningún lado.

## Instalar la skill (Claude Code)

```
/plugin marketplace add fedef098/ai-demos
/plugin install demofed@fedef-demos
```

Una vez instalada, pedile a Claude *"grabá una demo de \<lo que sea\>"* desde el
repo del producto o desde este: la skill te entrevista, escribe el guion, lo
muestra para aprobación y recién ahí graba.

> El repo también funciona sin instalar nada: `bin/demo` encuentra el motor en la
> copia local de `plugins/demofed/`.

## Setup de la máquina (una vez)

```bash
npm ci                             # instala yaml y @playwright/test
npx playwright install ffmpeg      # NO es el ffmpeg del sistema — sin él no hay video, y no avisa
npm run setup-voice                # el venv de la voz en off (Kokoro)

npm run doctor                     # ¿quedó todo? chequea node, ffmpeg, Chrome, voz, RAM
```

`npm run doctor` te dice qué falta. Necesitás además Node ≥20, `ffmpeg`/`ffprobe`
del sistema y Google Chrome.

## Grabar

`DEMOS_DIR` apunta el motor al workspace de un producto. **El README de cada
workspace dice contra qué URL y con qué cuenta se graba.**

```bash
DEMOS_DIR=demos/<producto> DEMO_BASE_URL=https://qa.ejemplo.com bin/demo <slug> --check  # ~20 s, no graba
DEMOS_DIR=demos/<producto> DEMO_BASE_URL=https://qa.ejemplo.com bin/demo <slug>          # graba (queda local)
DEMOS_DIR=demos/<producto> bin/demo --catalog                                            # qué NO está cubierto
DEMOS_DIR=demos/<producto> bin/demo --page                                               # sólo regenerar el HTML
```

El video queda en `demos/<producto>/<slug>/` (`demo.mp4` + `index.html`
navegable). Un producto nuevo es una carpeta: ver `demos/README.md`.

## Qué hay

```
bin/demo                           encuentra el motor y le pasa los argumentos
plugins/demofed/                   la skill instalable
  skills/demofed/
    SKILL.md                       cómo se escribe y se graba una demo
    runner/                        el pipeline (lint → narrate → record → build → page)
    templates/ · archetypes/       plantillas y arquetipos para arrancar
    references/                    el detalle por tema (setup, storytelling, determinismo…)
demos/
  <producto>/                      un workspace por producto (ver demos/README.md)
```

## Cómo se escribe una demo

El detalle está en `plugins/demofed/skills/demofed/SKILL.md` y sus `references/`.
Lo esencial:

- **El guion es el artefacto.** `<slug>.demo.yml` cuenta la historia en lenguaje
  llano y **no tiene selectores**; ésos viven una sola vez en `selectors.yml`.
- **El video queda local y no se sube a ningún lado.** En git no va ningún binario
  (git no deltifica H.264); sí va el `run.json`.
- **Nunca contra un dev server.** Se graba contra una app desplegada.
