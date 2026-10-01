# Los guiones de demo, un workspace por producto

Cada demo es un **guion versionado** que se ejecuta con Playwright y produce un
video con subtítulos, un `.vtt` y una página navegable. Se regenera con un comando
cuando la UI cambia.

Grabar **no lee el checkout de la app**: se graba contra una URL desplegada y el
seed habla HTTP, así que no hace falta tener el código al lado.

La doctrina (cómo se cuenta la historia, el ritmo, el determinismo) está en
`../engine/GUIDE.md` y `../engine/references/`. Acá está sólo lo operativo.

## Estructura

```
demos/
└── <producto>/
    ├── README.md              contra qué entorno se graba y con qué cuenta
    ├── .env.example           los NOMBRES de las variables del producto (nunca los valores)
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
        └── run.json            duración, escenas, commit, hash
```

**El `demo.mp4` y el `poster.jpg` NO se commitean** y **no se suben a ningún
lado**: quedan locales, para mirarlos en la página o bajarlos. Git no deltifica
H.264: cada regrabación dejaría un blob permanente.

## Correr

El motor es uno solo, en `../engine/runner/`, y `bin/demo` lo encuentra. `DEMOS_DIR`
es lo que lo apunta al workspace:

```bash
bin/demo --doctor                                                        # ¿la máquina está lista?
DEMOS_DIR=demos/<producto> DEMO_BASE_URL=https://qa.ejemplo.com bin/demo <slug> --check
DEMOS_DIR=demos/<producto> DEMO_BASE_URL=https://qa.ejemplo.com bin/demo <slug>
DEMOS_DIR=demos/<producto> bin/demo --catalog                            # qué NO tenemos para mostrar
DEMOS_DIR=demos/<producto> bin/demo --page                               # sólo regenerar el HTML
```

Setup por máquina y variables comunes: `../engine/references/setup.md`. **Las de
un producto —su URL, su API, su cuenta— están en el README y el `.env.example` de
su workspace**, porque son distintas en cada uno y nadie las adivina.

## Escribir una demo

1. **Copiá un arquetipo** de `../engine/archetypes/` a
   `demos/<producto>/<slug>.demo.yml` y rellenalo. No se heredan ni se mergean: se
   copian, para que el PR muestre la historia completa.
2. **Escribí el seed** en `demos/<producto>/seeds/<slug>.mjs`. Idempotente y por
   API. Si no se puede sembrar dos veces seguidas sin ensuciar nada, la demo no
   existe.
3. **Iterá con `--check`** hasta que pase (no graba, tarda ~20 s).
4. **Grabá** cuando el check esté verde.
5. **Mirá y escuchá el video entero antes de compartirlo.** Ningún lint ve píxeles
   ni oye audio: un dato sensible, un mail real o un nombre mal pronunciado sólo
   los ves vos. Lo que pronuncia mal el TTS se arregla con `voice:` en el beat.

## Cuentas

Cada demo usa **su propia cuenta**, creada para ella. Una cuenta compartida se
rompe sola: alguien le cambia la clave, o el estado que dejó otra demo contradice
el guion.

## Trampas

- **Un valor sin comillas que contiene `": "`** rompe el YAML: se lee como una
  clave anidada. `say: "El cierre: el beat más fuerte"` — con comillas.
- **La demo se graba contra una URL desplegada**, nunca contra `next dev`. En una
  VPS compartida un dev server dispara el OOM killer y se lleva servicios de
  otros; el preflight aborta si hay menos de 3 GB de RAM libre.
- **Un popup parte el video en dos.** `recordVideo` escribe un archivo por página.
  El runner aborta con un mensaje claro; reescribí ese paso para que navegue en la
  misma pestaña.
- **Si el video sale sin sonido y sin subtítulos quemados**, no falta ffmpeg del
  sistema: falta el helper de Playwright (`npx playwright install ffmpeg`).
