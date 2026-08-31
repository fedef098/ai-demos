# ai-demos — los guiones de demo de cada producto

Acá viven **las demos**, una carpeta por producto bajo `demos/`. No viven en el
repo de cada producto: la demo es de la empresa —por eso el video se publica en
el bucket de la empresa— y el producto es un consumidor más. Grabar tampoco
necesita el checkout de la app: se corre contra una URL desplegada y el seed
habla HTTP.

**El motor no está en este repo.** Es el plugin `product-demo` del marketplace
`adavance-skills` (repo [`adavance-it/skills`](https://github.com/adavance-it/skills)).
Una sola copia, mantenida en un solo lado, instalada como plugin de Claude Code.

## Qué hay

```
bin/demo               encuentra el motor instalado y le pasa los argumentos
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
docs/                  el bucket de S3 y la política del publicador
```

## Setup

Una vez, el motor:

```
/plugin marketplace add adavance-it/skills
/plugin install product-demo@adavance-skills
```

Una vez, este repo (el motor **no trae dependencias**: las toma de acá):

```bash
npm audit && npm ci
npx playwright install ffmpeg      # NO es el ffmpeg del sistema — sin él no hay video, y no avisa

npm run doctor                     # ¿quedó todo? no necesita guion ni URL
```

`npm run doctor` también dice si falta el venv de la voz, y con qué comando se
crea (`setup-voice.sh`, que viaja en el plugin).

## Grabar

`DEMOS_DIR` es lo que apunta el motor al workspace de un producto. **El README de
cada workspace dice contra qué URL y con qué cuenta se graba**: eso cambia por
producto y no se adivina.

```bash
DEMOS_DIR=demos/wig DEMO_BASE_URL=https://qa.ejemplo.com bin/demo <slug> --check  # ~20 s, no graba
DEMOS_DIR=demos/wig DEMO_BASE_URL=https://qa.ejemplo.com bin/demo <slug>          # graba y publica
DEMOS_DIR=demos/wig bin/demo --catalog                                            # qué NO está cubierto
DEMOS_DIR=demos/wig bin/demo --page                                               # sólo regenerar el HTML
```

Un producto nuevo es una carpeta, no una instalación: copiá
`selectors.example.yml` y `capabilities.example.yml` desde
`<plugin>/skills/product-demo/templates/`, y escribile su `README.md` y su
`.env.example`.

## Cómo se escribe una demo

Está en la skill, no acá: con el plugin habilitado, pedile a Claude *"grabá una
demo de \<feature\>"* y sigue `SKILL.md` — reconoce la sección, te entrevista
sobre alcance, audiencia y datos, y **te muestra el guion para que lo apruebes
antes de grabar nada**.

Lo único que conviene saber de entrada:

- **El guion es el artefacto.** `<slug>.demo.yml` cuenta la historia en lenguaje
  llano y **no tiene selectores**; ésos viven una sola vez en `selectors.yml`. El
  relato se revisa en el PR; los selectores los arregla un dev en 20 segundos
  cuando la UI se mueve.
- **En git no va ningún binario.** El mp4 se sube a S3 con una clave por
  contenido y `run.json` guarda la URL. Sin bucket configurado la corrida queda
  local y marcada `pending`, y se publica después sin regrabar.
- **Nunca contra un dev server.** Se graba contra una app desplegada.
