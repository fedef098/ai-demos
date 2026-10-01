# ai-demos — los guiones de demo de cada producto

Acá viven **las demos**, una carpeta por producto bajo `demos/`, y el **motor**
que las graba, bajo `engine/`. Grabar no necesita el checkout de la app: se corre
contra una URL desplegada y el seed habla HTTP.

## Qué hay

```
bin/demo               encuentra el motor y le pasa los argumentos
engine/                el motor de grabación
  runner/              el pipeline (lint → narrate → record → build → page)
  templates/           ejemplos para arrancar un producto nuevo
  archetypes/          cinco arquetipos de demo listos para copiar
  references/          el detalle por tema (setup, storytelling, storage…)
  GUIDE.md             cómo se escribe y se graba una demo
demos/
  <producto>/          un workspace por producto
    README.md          contra qué entorno y con qué cuenta se graba este producto
    .env.example       los NOMBRES de sus variables — nunca los valores
    <slug>.demo.yml    la historia
    selectors.yml      target con nombre → selector, de este producto
    capabilities.yml   qué sabe hacer este producto, para el catálogo de cobertura
    seeds/<slug>.mjs   preparación idempotente, por HTTP
    assets/            imágenes que el guion le da al producto (entradas, no salida)
    <slug>/run.json    duración, capítulos, commit, sha256 y URL pública del video
```

## Setup

Una vez por máquina (el motor no trae dependencias: las toma de acá):

```bash
npm audit && npm ci
npx playwright install ffmpeg      # NO es el ffmpeg del sistema — sin él no hay video, y no avisa
engine/runner/setup-voice.sh       # el venv de la voz en off

npm run doctor                     # ¿quedó todo? no necesita guion ni URL
```

`npm run doctor` también dice si falta el venv de la voz, y con qué comando se
crea.

## Grabar

`DEMOS_DIR` es lo que apunta el motor al workspace de un producto. **El README de
cada workspace dice contra qué URL y con qué cuenta se graba**: eso cambia por
producto y no se adivina.

```bash
DEMOS_DIR=demos/<producto> DEMO_BASE_URL=https://qa.ejemplo.com bin/demo <slug> --check  # ~20 s, no graba
DEMOS_DIR=demos/<producto> DEMO_BASE_URL=https://qa.ejemplo.com bin/demo <slug>          # graba (queda local)
DEMOS_DIR=demos/<producto> bin/demo --catalog                                            # qué NO está cubierto
DEMOS_DIR=demos/<producto> bin/demo --page                                               # sólo regenerar el HTML
```

Un producto nuevo es una carpeta, no una instalación: copiá
`selectors.example.yml` y `capabilities.example.yml` desde `engine/templates/`, y
escribile su `README.md` y su `.env.example`.

## Cómo se escribe una demo

El detalle está en `engine/GUIDE.md` y en `engine/references/`: reconocé la
sección, entrevistá sobre alcance, audiencia y datos, y **mostrá el guion para
aprobación antes de grabar nada**.

Lo único que conviene saber de entrada:

- **El guion es el artefacto.** `<slug>.demo.yml` cuenta la historia en lenguaje
  llano y **no tiene selectores**; ésos viven una sola vez en `selectors.yml`. El
  relato se revisa en el PR; los selectores los arregla un dev en 20 segundos
  cuando la UI se mueve.
- **El video queda local y no se sube a ningún lado.** El `demo.mp4`, el poster y
  la página quedan en `demos/<producto>/<slug>/`, para mirarlos o bajarlos. En git
  no va ningún binario (git no deltifica H.264); sí va el `run.json`.
- **Nunca contra un dev server.** Se graba contra una app desplegada.
