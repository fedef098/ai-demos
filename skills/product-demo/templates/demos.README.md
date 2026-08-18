# Demos de producto

Cada demo es un **guion versionado** que se ejecuta con Playwright y produce un
video con subtítulos, un `.vtt` y una página navegable. Se regenera con un
comando cuando la UI cambia.

La doctrina (cómo se cuenta la historia, el ritmo, el determinismo) vive en la
skill `product-demo` del marketplace. Acá está sólo lo operativo.

## Estructura

```
demos/
├── .runner/                  el motor (vendorizado — ver "Actualizar el motor")
├── selectors.yml             el ÚNICO archivo con selectores
├── capabilities.yml          qué sabe hacer el producto (para medir cobertura)
├── <slug>.demo.yml           la historia; se revisa en el PR
├── seeds/<slug>.mjs          fixture idempotente, por API
├── catalog.json              qué está cubierto, guionado o sin cubrir
└── <slug>/                   salida
    ├── index.html            la página navegable
    ├── demo.mp4 · demo.vtt · demo.chapters.vtt · poster.jpg
    ├── narration.md          el texto y los tiempos de la locución
    └── run.json              duración, escenas, commit, hash y URL del video
```

**El `demo.mp4` y el `poster.jpg` NO se commitean** — van a S3 y `run.json` guarda
la URL. Git no deltifica H.264: cada regrabación dejaría un blob permanente.

## Setup, una vez

```bash
npm i -D yaml @playwright/test
npx playwright install ffmpeg        # ⚠ IMPRESCINDIBLE — ver abajo
./demos/.runner/setup-voice.sh       # el venv de la voz en off, una vez por máquina
```

> **`npx playwright install ffmpeg` no es opcional.** El ffmpeg que Playwright usa
> para grabar **no es el del sistema**: es un helper propio que se instala aparte
> del browser. Sin él `recordVideo` **no produce ningún archivo y no avisa** — la
> corrida "funciona" y al final no hay video. Es el error nº1 al arrancar.

Variables de entorno:

| Variable | Para qué |
|---|---|
| `DEMO_BASE_URL` | **Obligatoria.** La app ya desplegada (QA/staging). El grabador nunca levanta un dev server. |
| `DEMO_*_EMAIL` / `DEMO_*_PW` | Las credenciales que el guion referencia como `${VAR}`. Nunca hardcodeadas. |
| `DEMO_S3_BUCKET` / `DEMO_PUBLIC_URL` | Dónde se publica el video. Sin bucket queda local y `run.json` lo marca `pending`. |
| `DEMO_TTS_VOICE` | Voz del TTS (default `ef_dora`). También se fija por guion con `narration.voice`. |
| `DEMO_BROWSER=chromium` | Escape hatch si el Chrome del sistema da problemas. |

## Escribir una demo

1. **Copiá un arquetipo** de la skill a `demos/<slug>.demo.yml` y rellenalo. No se
   heredan ni se mergean: se copian, para que el PR muestre la historia completa.
2. **Escribí el seed** en `demos/seeds/<slug>.mjs`. Idempotente y por API. Si no
   se puede sembrar dos veces seguidas sin ensuciar nada, la demo no existe.
3. **Iterá con `--check`** hasta que pase (no graba, tarda ~20 s):

   ```bash
   DEMO_BASE_URL=https://qa.ejemplo.com ./demos/.runner/demo.sh <slug> --check
   ```

4. **Grabá** cuando el check esté verde:

   ```bash
   DEMO_BASE_URL=https://qa.ejemplo.com ./demos/.runner/demo.sh <slug>
   ```

5. **Mirá y escuchá el video entero antes de publicarlo.** Ningún lint ve píxeles
   ni oye audio: un dato de otro cliente, un mail real o un nombre mal pronunciado
   sólo los ves vos. Lo que pronuncia mal el TTS se arregla con `voice:` en el beat.

## Qué está cubierto y qué no

```bash
./demos/.runner/demo.sh --catalog
```

Cruza `capabilities.yml` (lo que el producto hace) con los `covers:` de los
guiones y con lo grabado, y lista **lo que no tenemos para mostrar**, ordenado por
prioridad. También marca las demos cuyo guion cambió después de la grabación.

## Regenerar sólo las páginas

```bash
./demos/.runner/demo.sh --page
```

## Tests del motor

```bash
node --test demos/.runner/       # o: npx vitest run demos/.runner/
```

Cubre las funciones puras de `pacing.mjs` y `subtitles.mjs` (lectura, ritmo,
timestamps, partido de subtítulos). Corre en el pre-push junto con el lint de cada
guion; **grabar nunca bloquea un push**.

## Trampas

- **Un valor sin comillas que contiene `": "`** rompe el YAML: se lee como una
  clave anidada. `say: "El cierre: el beat más fuerte"` — con comillas.
- **La demo se graba contra una URL desplegada**, nunca contra `next dev`. En la
  VPS compartida un dev server dispara el OOM killer y se lleva servicios de
  otros; el preflight aborta si hay menos de 3 GB de RAM libre.
- **Un popup parte el video en dos.** `recordVideo` escribe un archivo por
  página. El runner aborta con un mensaje claro; reescribí ese paso para que
  navegue en la misma pestaña.
- **Si el video sale sin sonido y sin subtítulos quemados**, no falta ffmpeg del
  sistema: falta el helper de Playwright (ver setup).

## Actualizar el motor

`.runner/` está **vendorizado**: corre con el `@playwright/test` de este repo, que
puede diferir del de otros proyectos. Cada archivo declara `RUNNER_VERSION` en su
cabecera. Cuando la skill del marketplace tenga una versión más nueva, copiá
`templates/runner/` encima y corré `--check` sobre cada demo antes de dar por
buena la actualización.
