# Los guiones de demo, un workspace por producto

Cada demo es un **guion versionado** que se ejecuta con Playwright y produce un
video con subtítulos, un `.vtt` y una página navegable. Se regenera con un comando
cuando la UI cambia.

**Viven acá y no en el repo del producto.** La herramienta es de la empresa —por
eso el video se publica en el bucket de la empresa— y cada producto es un
consumidor. Además grabar **no lee el checkout de la app**: se graba contra una
URL desplegada y el seed habla HTTP, así que no hay nada que ganar teniéndolos al
lado del código.

La doctrina (cómo se cuenta la historia, el ritmo, el determinismo) está en
`../skills/product-demo/`. Acá está sólo lo operativo.

## Estructura

```
demos/
└── <producto>/
    ├── selectors.yml           el ÚNICO archivo con selectores
    ├── capabilities.yml        qué sabe hacer el producto (para medir cobertura)
    ├── <slug>.demo.yml         la historia; se revisa en el PR
    ├── seeds/<slug>.mjs        fixture idempotente, por API
    ├── assets/                 imágenes que el guion le da al producto (son ENTRADA)
    ├── catalog.json            qué está cubierto, guionado o sin cubrir
    └── <slug>/                 salida
        ├── index.html          la página navegable
        ├── demo.mp4 · demo.vtt · demo.chapters.vtt · poster.jpg
        ├── narration.md        el texto y los tiempos de la locución
        └── run.json            duración, escenas, commit, hash y URL del video
```

**El `demo.mp4` y el `poster.jpg` NO se commitean** — van a S3 y `run.json` guarda
la URL. Git no deltifica H.264: cada regrabación dejaría un blob permanente.

## Correr

El motor es uno solo, en `../skills/product-demo/templates/runner/`, y `DEMOS_DIR`
es lo que lo apunta al workspace:

```bash
R=skills/product-demo/templates/runner        # desde la raíz del repo

DEMOS_DIR=demos/<producto> DEMO_BASE_URL=https://qa.ejemplo.com "$R/demo.sh" <slug> --check
DEMOS_DIR=demos/<producto> DEMO_BASE_URL=https://qa.ejemplo.com "$R/demo.sh" <slug>
DEMOS_DIR=demos/<producto> "$R/demo.sh" --catalog   # qué NO tenemos para mostrar
DEMOS_DIR=demos/<producto> "$R/demo.sh" --page      # sólo regenerar el HTML
```

Setup por máquina y variables de entorno: `../skills/product-demo/references/setup.md`.

## Escribir una demo

1. **Copiá un arquetipo** de la skill a `demos/<producto>/<slug>.demo.yml` y
   rellenalo. No se heredan ni se mergean: se copian, para que el PR muestre la
   historia completa.
2. **Escribí el seed** en `demos/<producto>/seeds/<slug>.mjs`. Idempotente y por
   API. Si no se puede sembrar dos veces seguidas sin ensuciar nada, la demo no
   existe.
3. **Iterá con `--check`** hasta que pase (no graba, tarda ~20 s).
4. **Grabá** cuando el check esté verde.
5. **Mirá y escuchá el video entero antes de publicarlo.** Ningún lint ve píxeles
   ni oye audio: un dato de otro cliente, un mail real o un nombre mal pronunciado
   sólo los ves vos. Lo que pronuncia mal el TTS se arregla con `voice:` en el beat.

## Cuentas

Cada demo usa **su propia cuenta**, creada para ella y con alias `+test@` para que
no ensucie las métricas del producto. Una cuenta compartida se rompe sola: alguien
le cambia la clave, o el estado que dejó otra demo contradice el guion.

## Trampas

- **Un valor sin comillas que contiene `": "`** rompe el YAML: se lee como una
  clave anidada. `say: "El cierre: el beat más fuerte"` — con comillas.
- **La demo se graba contra una URL desplegada**, nunca contra `next dev`. En la
  VPS compartida un dev server dispara el OOM killer y se lleva servicios de
  otros; el preflight aborta si hay menos de 3 GB de RAM libre.
- **Un popup parte el video en dos.** `recordVideo` escribe un archivo por página.
  El runner aborta con un mensaje claro; reescribí ese paso para que navegue en la
  misma pestaña.
- **Si el video sale sin sonido y sin subtítulos quemados**, no falta ffmpeg del
  sistema: falta el helper de Playwright (`npx playwright install ffmpeg`).
