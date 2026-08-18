# Troubleshooting

Ordenado por síntoma.

## La corrida termina bien pero no hay video

**Falta el helper ffmpeg de Playwright.** No es el ffmpeg del sistema: es un
binario propio que se instala aparte del browser, y sin él `recordVideo` no
escribe nada **y no emite ningún error**.

```bash
npx playwright install ffmpeg
ls ~/.cache/ms-playwright | grep -i ffmpeg   # tiene que devolver algo
```

El preflight lo chequea, así que sólo deberías ver esto si corriste `record.mjs`
a mano.

## Los subtítulos van corridos respecto de la imagen

Los quemados **no se pueden desincronizar** (los pinta el mismo browser que se
está grabando). Si lo que se corre es el `.vtt`, es la calibración.

Mirá la salida de `build.mjs`:

```
· claqueta en 412ms · duración 96.4s · escala 1.0031
```

- **`claqueta en 0ms`** con un warning: no encontró el flash blanco de
  calibración. Suele pasar si la app pinta algo muy claro a pantalla completa al
  arrancar. Los cues quedan corridos por el lead-in del encoder (100-600 ms).
- **escala fuera de `[0.98, 1.02]`**: se dropearon frames, casi siempre por
  carga de la máquina. El motor descarta la corrección y avisa. Regrabá con la
  máquina más tranquila.

## `Nested mappings are not allowed in compact mappings`

Un valor **sin comillas que contiene `": "`**. YAML lo lee como una clave
anidada.

```yaml
say: El cierre: el beat más fuerte      # ✖ rompe
say: "El cierre: el beat más fuerte"    # ✓
```

El linter traduce este error, pero si lo ves crudo es esto.

## `La demo abrió un popup`

`recordVideo` escribe **un archivo por página**, así que un popup parte la línea
de tiempo en dos `.webm` que no se pueden recomponer.

Reescribí ese paso para que navegue en la misma pestaña. Si el flujo depende
genuinamente de una ventana nueva (un OAuth de terceros), sacalo de la demo:
inyectá la sesión resultante en el seed y mostrá lo que viene después.

## `No apareció '<target>' después de la acción`

La consecuencia declarada en `awaits` no se materializó en 6 segundos. Tres
causas, en orden de frecuencia:

1. **El selector cambió.** Corré `--check`: te dice exactamente cuál.
2. **La acción no hizo lo que creías** (validación que falló, permiso que faltaba).
   Es un hallazgo, no un problema del motor.
3. **La app tarda genuinamente más de 6 s.** Es una demo: si algo tarda más de
   6 segundos, el problema es el producto, no la demo.

## `--check` pasa pero la grabación falla

`--check` resuelve targets con `state: "attached"`; la grabación hace click, que
exige `visible` y sin nada encima. Casos típicos:

- El elemento está **fuera del viewport**: agregá un beat `scroll` antes.
- Algo lo **tapa** (un banner de cookies, un toast): sumalo a `hide:`.
- Aparece **después de una animación**: declaralo con `awaits` en el beat anterior.

## El cursor rojo desaparece a mitad del video

No debería: el overlay se inyecta con `addInitScript`, que corre en cada
documento nuevo. Si pasa:

- El motor está **desactualizado** — una versión vieja usaba `addStyleTag`, que
  se pierde en cada navegación. Verificá `RUNNER_VERSION` en `.runner/overlay.js`.
- La app **reemplaza `document.body`** de una forma que el `MutationObserver` no
  cubre. Abrí un issue con el caso; es un bug del overlay.

## El video arranca mostrando el login o un skeleton

El cover negro no se pintó a tiempo. Suele ser porque la app hace un redirect
duro antes de que el init script corra. Probá autenticando con
`via: storageState` en vez de `via: api`, así la primera navegación ya llega
autenticada.

## La demo sale distinta en cada corrida

Ver `determinism.md`. Los tres sospechosos, en orden:

1. **El seed no es idempotente** — no limpia lo que dejó la corrida anterior.
2. **Falta `freezeTime`** y hay fechas relativas en pantalla.
3. **Falta algún `awaits`** y el motor espera por timeout en vez de por la
   consecuencia, lo que hace variar las duraciones.

## `Sólo N MB de RAM disponible`

El preflight aborta con menos de 3 GB libres. Es una VPS compartida: grabar con
la memoria justa dispara el OOM killer y se lleva servicios de otra gente.

Esperá, o grabá desde otra máquina. **No bajes el umbral.**

## El repo empezó a pesar

Alguien commiteó videos. `git rm` no los saca del historial.

Prevención: no tocar las reglas de `demos/**/*.mp4` del `.gitignore`. La política
es **cero binarios en git**, sin umbral, y el porqué está en `storage.md`. Si ya
pasó, la limpieza es un `git filter-repo` coordinado con todo el equipo — no algo
que se hace de un lado.

## `run.json` quedó en `pending: true`

El video se montó bien pero no se subió: falta `DEMO_S3_BUCKET`, o el AWS CLI no
tiene credenciales (`aws sts get-caller-identity` tiene que andar). El mp4 está
local y no se pierde nada; cuando el bucket esté configurado, subilo sin regrabar:

```bash
node demos/.runner/publish.mjs demos/<slug>
```

## La voz no coincide con lo que muestra la pantalla

Casi siempre es que `narrate.mjs` no corrió antes de `record.mjs` — la grabación
no supo cuánto duraba cada locución y le dio a los beats el tiempo de lectura.
Corré el pipeline completo con `demo.sh`, que ya ordena las etapas.

Si en cambio la voz **dice mal una palabra**, no es un problema de sincronía: es
el TTS. Se arregla con `voice:` en ese beat, escribiendo cómo se pronuncia, sin
tocar el subtítulo.

## El TTS no arranca

`setup-voice.sh` no corrió en esta máquina, o corrió antes de instalar
`espeak-ng` (Kokoro lo usa para fonemizar y sin él importa pero no produce audio).
Volvé a correrlo: es idempotente.

Para una demo puntual sin voz, `narration: false` en el guion.

## La demo quedó vieja

Es el riesgo estructural de grabar sólo a demanda. El catálogo la marca como
desactualizada cuando el guion o `selectors.yml` se commitearon **después** de la
grabación, y la página estampa el commit con el que se grabó:

> ⚠ el guion cambió después de la grabación (reclamos.demo.yml, 2026-08-18 23:00
> vs. grabada el 2026-08-18 14:42)

Regenerar es `./demos/.runner/demo.sh <slug>`. Si los selectores cambiaron,
`--check` te dice cuáles en 20 segundos.

Para verlas todas de una: `./demos/.runner/demo.sh --catalog`.
