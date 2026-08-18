# Setup

## Instalar el motor en un proyecto

```bash
mkdir -p demos/.runner demos/seeds
cp -r <ruta-a-la-skill>/templates/runner/* demos/.runner/
cp <ruta-a-la-skill>/templates/demos.README.md demos/README.md
cp <ruta-a-la-skill>/templates/selectors.example.yml demos/selectors.yml
cp <ruta-a-la-skill>/templates/capabilities.example.yml demos/capabilities.yml
cat <ruta-a-la-skill>/templates/demos.gitignore >> .gitignore
chmod +x demos/.runner/demo.sh demos/.runner/setup-voice.sh

npm i -D yaml @playwright/test     # corré `npm audit` antes, es política del repo
npx playwright install ffmpeg
./demos/.runner/setup-voice.sh     # una vez por máquina, para la voz en off
```

`capabilities.yml` es opcional pero conviene desde el día uno: es el inventario de
lo que el producto sabe hacer, y sin él el catálogo puede decir qué está cubierto
pero no **qué falta**. Ver la sección "Cobertura" de SKILL.md.

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
DEMO_BROWSER=chromium ./demos/.runner/demo.sh <slug>
```

## Variables de entorno

| Variable | Obligatoria | Para qué |
|---|---|---|
| `DEMO_BASE_URL` | **sí** | La app **ya desplegada** (QA/staging). El grabador nunca levanta un dev server. |
| `DEMO_*_EMAIL` / `DEMO_*_PW` | sí | Las credenciales que el guion referencia como `${VAR}`. Los nombres los elige cada guion. |
| `DEMO_S3_BUCKET` | para publicar | Bucket donde termina el mp4. Sin ella el video queda local y `run.json` lo marca `pending`. Ver [storage.md](storage.md). |
| `DEMO_S3_PREFIX` | no | Prefijo raíz en el bucket. Default `demos`. |
| `AWS_REGION` | no | Región del bucket. Default `us-east-1`. |
| `DEMO_PUBLIC_URL` | no | Base pública (CloudFront) con la que el HTML referencia el video. |
| `DEMO_TTS_VOICE` | no | Voz del TTS. Default `ef_dora`. Se puede fijar por guion con `narration.voice`. |
| `DEMO_TTS_PROVIDER` | no | `kokoro` (default) o `espeak` para un smoke test. |
| `DEMO_VOICE_VENV` | no | Dónde vive el venv de Kokoro. Default `~/.cache/demo-voice-venv`. |
| `DEMO_BROWSER` | no | `chromium` para no usar el Chrome del sistema. |

Conviene un `demos/.env.example` versionado con los nombres (nunca los valores) y
un `.env` local gitignoreado.

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
./demos/.runner/setup-voice.sh                     # una vez por máquina
node demos/.runner/narrate.mjs demos/<slug>.demo.yml   # escuchar antes de grabar
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

`.runner/` está **vendorizado** a propósito: corre con el `@playwright/test` del
proyecto, y las versiones difieren entre repos (1.59 a 1.62 en los nuestros).

Cada archivo declara `RUNNER_VERSION` en la cabecera. Para actualizar: copiá
`templates/runner/` encima y corré `--check` sobre **cada** demo antes de dar la
actualización por buena.
