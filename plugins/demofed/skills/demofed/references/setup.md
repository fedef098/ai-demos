# Setup

## Una vez por máquina, en este repo

El motor vive en `plugins/demofed/skills/demofed/`. Grabar no lee el checkout de la app: se graba contra
una URL desplegada y el seed habla HTTP.

**Sus dos dependencias externas se instalan en la raíz del repo.** El motor las
busca —en este orden— en su propia ubicación, en `DEMOS_DIR` y en el cwd. Ver
`plugins/demofed/skills/demofed/runner/deps.mjs`.

```bash
R=plugins/demofed/skills/demofed/runner

npm audit && npm i -D yaml @playwright/test   # audit ANTES de instalar, es política
npx playwright install ffmpeg
"$R/setup-voice.sh"                           # el venv de la voz en off

"$R/demo.sh" --doctor                         # ¿quedó todo?
```

`--doctor` chequea node, las dependencias, ffmpeg del sistema, el helper ffmpeg
de Playwright, Chrome, el venv de la voz, la RAM y el disco — **sin guion y sin
`DEMO_BASE_URL`**, que es lo que hace falta cuando acabás de clonar el repo y
todavía no tenés nada configurado. Es el mismo bloque que corre el preflight
antes de cada grabación, así que no hay dos listas que se desincronicen.

## Abrir el workspace de un producto nuevo

```bash
mkdir -p demos/<producto>/seeds demos/<producto>/assets
cp plugins/demofed/skills/demofed/templates/selectors.example.yml    demos/<producto>/selectors.yml
cp plugins/demofed/skills/demofed/templates/capabilities.example.yml demos/<producto>/capabilities.yml
```

`capabilities.yml` es opcional pero conviene desde el día uno: es el inventario de
lo que el producto sabe hacer, y sin él el catálogo puede decir qué está cubierto
pero no **qué falta**. Ver la sección "Cobertura" de GUIDE.md.

`DEMOS_DIR` apunta el motor al workspace:

```bash
DEMOS_DIR=demos/<producto> DEMO_BASE_URL=https://qa.ejemplo.com "$R/demo.sh" <slug> --check
```

Sin la variable, `demo.sh` toma como workspace el directorio que lo contiene.

### ⚠ `npx playwright install ffmpeg` no es opcional

El ffmpeg que Playwright usa para grabar **no es el del sistema**: es un helper
propio, distribuido aparte del browser en su registro de descargas. Tener
`ffmpeg` instalado en el sistema **no alcanza**.

Sin él, **`recordVideo` no produce ningún archivo y no emite ningún error**: la
corrida termina "bien" y al final no hay video. Es el error nº1 al arrancar, y por
eso `demo.sh` lo chequea en el preflight y aborta con el comando exacto.

Verificar a mano:

```bash
ls ~/.cache/ms-playwright | grep -i ffmpeg   # tiene que devolver algo
```

### Browser

El motor usa **el Chrome del sistema** (`channel: "chrome"`) para no bajar ~170 MB
de Chromium. Si el Chrome instalado da problemas (una versión muy vieja o muy
nueva respecto del Playwright del proyecto):

```bash
npx playwright install chromium
DEMO_BROWSER=chromium DEMOS_DIR=demos/<producto> "$R/demo.sh" <slug>
```

## Variables de entorno

| Variable | Obligatoria | Para qué |
|---|---|---|
| `DEMO_BASE_URL` | **sí** | La app **ya desplegada** (QA/staging). El grabador nunca levanta un dev server. |
| las del producto | sí | La API contra la que escribe el seed y las credenciales de su cuenta. **Los nombres los elige cada workspace** y están en su `demos/<producto>/.env.example` (p. ej. `APP_DEMO_API_URL`, `APP_DEMO_EMAIL`, `APP_DEMO_PASSWORD`). |
| `DEMO_TTS_VOICE` | no | Voz del TTS. Default `ef_dora`. Se puede fijar por guion con `narration.voice`. |
| `DEMO_TTS_PROVIDER` | no | `kokoro` (default) o `espeak` para un smoke test. |
| `DEMO_VOICE_VENV` | no | Dónde vive el venv de Kokoro. Default `~/.cache/demo-voice-venv`. |
| `DEMO_BROWSER` | no | `chromium` para no usar el Chrome del sistema. |

### Dónde setearlas

**El runner no lee ningún `.env`**: toma variables del entorno y aborta si falta
alguna que el guion referencia. Se probó lo otro y salió caro — un `.env`
sourceado como shell con un valor sin comillas dejaba la credencial vacía, y el
video entero terminaba siendo la pantalla de login (ver [lessons.md](lessons.md)).
El `demos/<producto>/.env.example` versionado sirve para **documentar los
nombres** — nunca los valores, y no se sourcea.

`DEMO_BASE_URL` y las variables del producto (la URL de la API y las credenciales
de la cuenta) se exportan en la terminal o en el keychain —son secretos o cambian
por producto—, nunca en un archivo versionado. El `demos/<producto>/.env.example`
sólo documenta los nombres.

## Por qué nunca contra un dev server

`DEMO_BASE_URL` tiene que apuntar a un entorno desplegado. Dos razones:

1. **RAM.** En una VPS compartida un `next dev` o un `next build` consumen 2-4 GB
   y disparan el OOM killer, que se lleva servicios de otra gente. El preflight
   aborta si hay menos de 3 GB libres.
2. **Reproducibilidad.** Una demo grabada contra el working tree de alguien no se
   puede regenerar igual desde otra máquina.

## Dónde termina el video

El `demo.mp4` y el `poster.jpg` quedan en `demos/<producto>/<slug>/`, al lado del
`run.json`. **No se suben a ningún lado**: los mirás en la página local o los
bajás. En git no va ningún binario, sin umbral — el porqué está en
[storage.md](storage.md).

## Narración por voz

Está **prendida por default** y usa [Kokoro](https://github.com/hexgrad/kokoro),
un TTS neuronal que corre local: no manda el guion a ninguna API y no cuesta por
uso. `setup-voice.sh` arma el venv una sola vez (baja ~700 MB de torch y, en la
primera síntesis, ~350 MB de pesos) fuera del repo, en `~/.cache/demo-voice-venv`.

```bash
"$R/setup-voice.sh"                                    # una vez por máquina
node "$R/narrate.mjs" demos/<producto>/<slug>.demo.yml  # escuchar antes de grabar
```

La voz se sintetiza **antes** de grabar y cada beat dura al menos lo que dura su
locución — por eso nunca hay que estirar el audio ni regrabar para que sincronice.
El detalle está en [pacing.md](pacing.md).

Se cachea por hash del texto: cambiar una frase re-sintetiza esa frase, no las 20.

Para apagarla en una demo puntual, `narration: false` en el guion. Para un smoke
test sin instalar nada, `DEMO_TTS_PROVIDER=espeak` — suena a robot, sirve para
verificar que el pipeline anda, **nunca** para publicar.

**Escuchá el video entero antes de publicarlo**: un TTS que pronuncia mal un
nombre propio arruina la demo. Se arregla con `voice:` en el beat, escribiendo
foneticamente lo que hay que decir sin tocar el subtítulo.

Siempre se emite `narration.md` con el texto y los tiempos, por si alguien
prefiere locutarla con su voz.

## Actualizar el motor

El motor vive en `plugins/demofed/skills/demofed/` y corre con el `@playwright/test` de la raíz del repo,
que es el único lugar donde se instalan sus dependencias. Cada archivo del runner
declara `RUNNER_VERSION` en la cabecera.

Después de tocar el motor, corré `npm test` y `--check` sobre **cada** guion
antes de darlo por bueno: `--check` no graba y tarda ~20 s.
