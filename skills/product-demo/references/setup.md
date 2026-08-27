# Setup

## Una vez por máquina, en el repo de la herramienta

El motor es **uno solo** y vive acá; no se copia a ningún proyecto. Grabar no lee
el checkout de la app: se graba contra una URL desplegada y el seed habla HTTP.

```bash
npm audit && npm ci                # es política del repo: audit ANTES de instalar
npx playwright install ffmpeg
skills/product-demo/templates/runner/setup-voice.sh   # el venv de la voz en off

skills/product-demo/templates/runner/demo.sh --doctor  # ¿quedó todo?
```

`--doctor` chequea node, las dependencias, ffmpeg del sistema, el helper ffmpeg
de Playwright, Chrome, el venv de la voz, la RAM y el disco — **sin guion y sin
`DEMO_BASE_URL`**, que es lo que hace falta cuando acabás de clonar el repo y
todavía no tenés nada configurado. Es el mismo bloque que corre el preflight
antes de cada grabación, así que no hay dos listas que se desincronicen.

## Abrir el workspace de un producto nuevo

```bash
TPL=skills/product-demo/templates
mkdir -p demos/<producto>/seeds demos/<producto>/assets
cp "$TPL/selectors.example.yml"    demos/<producto>/selectors.yml
cp "$TPL/capabilities.example.yml" demos/<producto>/capabilities.yml
```

`capabilities.yml` es opcional pero conviene desde el día uno: es el inventario de
lo que el producto sabe hacer, y sin él el catálogo puede decir qué está cubierto
pero no **qué falta**. Ver la sección "Cobertura" de SKILL.md.

`DEMOS_DIR` apunta el motor al workspace:

```bash
R=skills/product-demo/templates/runner
DEMOS_DIR=demos/<producto> DEMO_BASE_URL=https://qa.ejemplo.com "$R/demo.sh" <slug> --check
```

Sin la variable, `demo.sh` toma como workspace el directorio que lo contiene —así
que una instalación vieja con el motor vendoreado en `demos/.runner/` sigue
funcionando sin cambios.

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
| las del producto | sí | La API contra la que escribe el seed y las credenciales de su cuenta. **Los nombres los elige cada workspace** y están en su `demos/<producto>/.env.example` (WIG: `WIG_DEMO_API_URL`, `WIG_DEMO_EMAIL`, `WIG_DEMO_PASSWORD`). |
| `DEMO_S3_BUCKET` | para publicar | Bucket donde termina el mp4. Sin ella el video queda local y `run.json` lo marca `pending`. Ver [storage.md](storage.md). |
| `DEMO_S3_PREFIX` | no | Prefijo raíz en el bucket. Default `demos`. |
| `DEMO_CATALOG_PREFIX` | no | Prefijo del catálogo (`index.json` + sitio HTML). Default: el mismo que los videos. |
| `AWS_REGION` | no | Región del bucket. Default `us-east-1`. |
| `DEMO_AWS_PROFILE` | no | Perfil de `~/.aws/credentials` para publicar. No uses `AWS_PROFILE`: esa la mira todo comando `aws` de la máquina. |
| `DEMO_PUBLIC_URL` | no | Base pública (CloudFront) con la que el HTML referencia el video. |
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

Dos lugares, según la variable:

| Qué | Dónde | Por qué |
|---|---|---|
| Destino: `DEMO_S3_BUCKET`, `DEMO_S3_PREFIX`, `DEMO_CATALOG_PREFIX`, `AWS_REGION`, `DEMO_AWS_PROFILE` | bloque `env` de `~/.claude/settings.json` | No son secretos y no cambian por proyecto. Ahí las hereda **todo comando que corre la skill**, sin depender de que alguien se acuerde de exportarlas en la terminal correcta. |
| Secretos y lo que cambia por producto: claves AWS, la URL de la API y las credenciales de la cuenta de cada demo | `~/.aws/credentials` y el keychain/shell, nunca en `settings.json` | `settings.json` se comparte y se commitea en algunos setups; las claves AWS ya tienen su archivo propio, y las credenciales de la app son por proyecto. |

```json
// ~/.claude/settings.json
{
  "env": {
    "DEMO_AWS_PROFILE": "adavance-demos",
    "DEMO_S3_BUCKET": "adavance-demos",
    "DEMO_S3_PREFIX": "demos",
    "DEMO_CATALOG_PREFIX": "c/<token>",
    "AWS_REGION": "us-east-1"
  }
}
```

Los cambios en `settings.json` toman efecto en una **sesión nueva**. Para probar
en la sesión actual, exportalas a mano en el comando.

## Por qué nunca contra un dev server

`DEMO_BASE_URL` tiene que apuntar a un entorno desplegado. Dos razones:

1. **RAM.** En una VPS compartida un `next dev` o un `next build` consumen 2-4 GB
   y disparan el OOM killer, que se lleva servicios de otra gente. El preflight
   aborta si hay menos de 3 GB libres.
2. **Reproducibilidad.** Una demo grabada contra el working tree de alguien no se
   puede regenerar igual desde otra máquina.

## Dónde termina el video

**En git no va ningún binario, sin umbral.** El mp4 y el poster se suben a S3 y
`run.json` — que sí se commitea — guarda la URL, el `sha256`, los bytes y la
duración. El porqué, el esquema de claves y cómo recuperar una grabación vieja
están en [storage.md](storage.md).

El HTML usa el archivo local **si existe** y si no la URL, así podés ver la demo
mientras la iterás sin depender de la red.

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

**No hay nada que copiar**: el motor es uno solo y vive en este repo, así que
actualizarlo es un `git pull`. Corre con el `@playwright/test` de acá —pinneado
en `package.json`— y no con el de ningún proyecto.

Antes se vendorizaba a `<proyecto>/demos/.runner/`, 18 archivos por app
sincronizados a mano. El argumento era usar el Playwright del repo que lo
hospedaba; el costo era un mirror que driftea. Cada archivo todavía declara
`RUNNER_VERSION` en la cabecera, que es lo que permite reconocer una instalación
vieja si aparece una.

Después de tocar el motor, corré `npm test` y `--check` sobre **cada** guion
antes de darlo por bueno: `--check` no graba y tarda ~20 s.
