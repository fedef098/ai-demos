---
name: product-demo
description: >
  Demos de producto guionadas y grabadas con Playwright: cómo se cuenta una
  historia de usuario para que funcione en video, un formato de guion versionado
  que se revisa en PR, y un motor que lo ejecuta simulando a una persona usando
  la interfaz — con subtítulos quemados en el video, un .vtt sidecar, voz en off
  neuronal sincronizada y una página HTML navegable con capítulos. Lleva además un
  catálogo de qué capacidad del producto está demoable y cuál no, y publica los
  videos en S3 (en git no queda ningún binario). Trae cinco arquetipos de demo
  listos para copiar (onboarding, CRUD, búsqueda, panel admin, checkout).
  Arranca SIEMPRE reconociendo la sección en el código y entrevistando sobre
  alcance, audiencia y datos, y muestra el guion para aprobación antes de grabar.
  Usala cuando pidan una demo para un cliente o una release, cuando haya que
  actualizar una demo existente, cuando quieran grabar un flujo de la app, o
  cuando pregunten qué está cubierto por una demo y qué no.
allowed-tools: Read, Edit, Write, Glob, Grep, Bash(node *), Bash(npx *), Bash(npm *), Bash(pnpm *), Bash(ffmpeg *), Bash(ffprobe *), Bash(./demos/*), Bash(aws s3 *), Bash(aws s3api *), Bash(aws sts get-caller-identity)
argument-hint: [qué demo hay que grabar o actualizar]
---

# Demos de producto

Una demo es **una historia contada en video**, no un recorrido por la interfaz.
Esta skill trae las dos mitades que hacen falta: cómo se escribe esa historia, y
un motor que la ejecuta y la graba.

El problema que resuelve: hoy cada demo se re-improvisa, sale distinta cada vez y
envejece en cuanto cambia la UI. Con un guion versionado, la demo se regenera con
un comando y se revisa en un PR como cualquier otro cambio.

> **Esto NO es un test.** No valida nada, no corre en CI y nunca bloquea un
> merge. Si empieza a usarse para verificar comportamiento, se convierte en un
> E2E mal escrito que nadie mantiene. Lo único que corre en CI es el lint del
> guion, que tarda un segundo.

---

## El flujo

Grabar es el último paso, no el primero. En orden:

0. **Mirá el catálogo** (`demo.sh --catalog`): puede que la capacidad que te
   piden ya esté cubierta, o que convenga cubrir de paso otra del mismo hueco.
1. **Reconocé la sección y entrevistá.** Obligatorio, y va antes de escribir
   nada — el detalle está en la sección siguiente.
2. **Definí la promesa.** Una frase sobre qué cambia *para el que mira*. Si no
   la podés escribir, la demo todavía no existe.
3. **Elegí el arquetipo** de `archetypes/` que más se parezca y **copialo** a
   `demos/<slug>.demo.yml`. Se copian, no se heredan.
4. **Escribí el guion** completo, con la persona, las escenas y los subtítulos.
   Sin selectores todavía: sólo la historia. Cada escena declara qué capacidades
   del inventario cubre (`covers:`).
5. **Mostrá el guion y esperá el sí.** Sin aprobación explícita no se graba.
6. **Mapeá los targets** en `demos/selectors.yml`.
7. **Escribí el seed** idempotente.
8. **Iterá con `--check`** (no graba, ~20 s) hasta que resuelvan todos los targets.
9. **Abrí el PR con el guion.** La discusión sobre el relato pasa acá, en texto,
   no mirando un video de tres minutos.
10. **Escuchá la locución** (`narrate.mjs`, no graba) y arreglá lo que el TTS
    pronuncie mal con `voice:`.
11. **Recién ahí, grabá.**
12. **Mirá el video entero antes de publicarlo.** Ningún lint ve píxeles ni oye
    audio.

## Antes de escribir el guion: reconocer y preguntar

**Cuando te piden una demo de algo, no empieces a escribir el guion.** Nadie pide
"una demo de la sección X" y quiere toda la sección X: quiere un recorte, para
alguien, con un objetivo — y casi nunca lo tiene explícito todavía. La secuencia
es siempre la misma, sin saltos.

**A. Reconocé la sección primero.** Leé el código **antes** de preguntar nada, o
las preguntas salen genéricas y las respuestas también. Anotá: las rutas y pasos
del flujo (son las escenas candidatas), los estados vacíos, qué es premium o
gated, qué necesita datos para verse, qué acciones persisten o son destructivas,
qué widgets de terceros van a estorbar, y qué cubren ya otros guiones. De ahí sale
un inventario en tres montones: **lo que se muestra bien**, **lo que necesita
datos o una cuenta especial**, y **lo que conviene dejar afuera** (con el porqué).

**B. Preguntá con ese inventario en la mano**, en tandas de hasta cuatro y con
opciones concretas. Lo que ya te dijeron en el pedido no se vuelve a preguntar:

1. **Quién mira y qué tiene que pasar después.** Un cliente evaluando, un usuario
   que ya compró, un inversor, el equipo interno. Define el vocabulario, qué se
   da por sabido y cuál es el final.
2. **Qué entra y qué queda afuera**, ofreciendo el inventario del paso A como
   opciones. Es la pregunta que más tiempo ahorra: nadie termina una demo de
   cuatro minutos con doce pantallas, y quien la pidió tiene tres que le importan.
3. **Cuál es el momento que prueba** —el "mirá esto" que justifica el video— y
   **qué objeción** hay que enfrentar. De ahí sale la escena `objection: true`.
4. **Contra qué se graba**: entorno (nunca un dev server), con qué usuario, qué se
   puede sembrar y qué **no** se puede tocar.
5. **Forma**: duración objetivo, idioma, con voz o muda.

**C. Mostrá el guion y esperá el sí.** El `.demo.yml` completo, con los subtítulos
tal cual se van a escuchar, la duración que estima el lint y las capacidades que
cubre. Corregir una frase en el YAML es gratis; descubrirla en el video son
cuatro minutos de grabación más la locución entera y otra vuelta de revisión.

El detalle —qué buscar en el código, y por qué cada paso saltado se paga en el
siguiente— está en `references/intake.md`.

### Instalar el motor en un proyecto

```bash
mkdir -p demos/.runner demos/seeds
cp -r <skill>/templates/runner/* demos/.runner/
cp <skill>/templates/demos.README.md demos/README.md
cp <skill>/templates/selectors.example.yml demos/selectors.yml
cp <skill>/templates/capabilities.example.yml demos/capabilities.yml
cat <skill>/templates/demos.gitignore >> .gitignore
chmod +x demos/.runner/demo.sh demos/.runner/setup-voice.sh
npm i -D yaml @playwright/test
npx playwright install ffmpeg      # ⚠ imprescindible, ver "Trampas"
./demos/.runner/setup-voice.sh     # una vez por máquina: el venv de la voz
```

```bash
DEMO_BASE_URL=https://qa.ejemplo.com ./demos/.runner/demo.sh <slug> --check
DEMO_BASE_URL=https://qa.ejemplo.com ./demos/.runner/demo.sh <slug>
./demos/.runner/demo.sh --catalog          # qué está demoable y qué no
```

---

## 1. Cómo se cuenta la historia

Esta es la mitad que no se puede automatizar, y la que decide si la demo sirve.
Detalle completo, con ejemplos y antipatrones, en
**`references/storytelling.md`**. El resumen operativo:

**Cinco partes:**

1. **La promesa** — qué cambia para el que mira. Va en la placa de apertura.
   *"Un vecino reporta un bache desde el sillón y el municipio lo cierra con
   constancia. Dos minutos."* No: *"gestión integral de reclamos"*.
2. **El protagonista y el estado del mundo** — nombre, rol y contexto concretos,
   y qué existe ya cuando arranca el video. Esto **es** la fixture, y se escribe
   antes que los pasos.
3. **Las escenas** — una capacidad cada una, en tensión creciente. Máximo 7.
4. **El giro** — al menos una escena muestra el producto haciendo **lo difícil**:
   el error manejado, el permiso denegado. Sin eso es un folleto, y el lint la
   rechaza (`objection: true`).
5. **El cierre** — el beat más fuerte, no un resumen.

**La regla del subtítulo, que es la que más se incumple:**

> El subtítulo **nunca describe el click**; enuncia la consecuencia o lo que está
> en juego.
>
> - ✖ *"Hacemos click en Guardar."*
> - ✓ *"El reclamo queda asignado a Obras Públicas y el vecino se lleva su número."*

Presente, tercera persona, ≤ 90 caracteres, una idea por escena. El lint marca
los que arrancan con `hacemos click`, `click en`, `ahora vamos a`.

**Reglas duras:**

- **Una demo, una promesa.** Si hay dos, son dos demos.
- **Una persona con nombre y datos concretos.** `test@test.com` mata la demo; lo
  específico es lo que la vuelve una historia.
- **Una escena = una cosa que el producto hace y el competidor no.** Dos escenas
  que prueban lo mismo se fusionan.
- **60-180 segundos.** Arriba de 4 minutos el lint falla.
- **Nada se configura en cámara.** Si hay que preparar algo, va en el seed.

---

## 2. El formato del guion: dos capas

El requisito es contradictorio — tiene que poder revisarlo alguien que no
programa, **y** tiene que tener selectores. Se resuelve separándolos:

| Archivo | Qué es | Quién lo revisa |
|---|---|---|
| `demos/<slug>.demo.yml` | La historia. **Ni un selector**: las acciones apuntan a *targets con nombre*. | Producto / diseño |
| `demos/selectors.yml` | El mapa nombre → selector. | Un dev |

Un PR que toca sólo el primero es una discusión sobre el relato; uno que toca el
segundo es mantenimiento. Y los targets con nombre son lo que hace que los
arquetipos se puedan instanciar en cualquier producto.

```yaml
scenes:
  - id: alta
    title: "El reclamo entra en 40 segundos"
    proves: Formularios dinámicos por tipo de trámite, con ubicación en mapa.
    covers: [reclamo-alta, formulario-dinamico]
    watch: El formulario lo define el municipio desde el admin, no está hardcodeado.
    beats:
      - as: vecina
        go: /portal/tramites
        awaits: lista-propia
        say: Lucía entra al portal del municipio desde el celular. No instaló nada.
      - click: boton-enviar
        awaits: identificador
        say: Se lleva un número de seguimiento y el aviso le llega por mail.
        voice: Se lleva el número de seguimiento uno-cuatro-cero-dos y el aviso le llega por mail.
```

- `title` va **en pantalla**; `proves` va a la **tabla de cobertura**; `covers`
  engancha la escena con `capabilities.yml`; `watch` es la nota de dirección y va
  **al HTML**, no al video.
- `voice` es lo que se locuta cuando difiere del subtítulo: sirve para que en
  pantalla se lea corto y la voz diga el número completo, o para arreglar una
  palabra que el TTS pronuncia mal.
- `awaits` declara la consecuencia de la acción. Es obligatorio en la práctica:
  es lo que reemplaza a `networkidle` y lo que hace que una demo rota falle en
  segundos en vez de grabar una pantalla congelada.
- **Sin tiempos.** Los calcula el motor. Sólo `hold: 3s` para forzar un remate.

`templates/ejemplo.demo.yml` es un guion real y completo que pasa el lint tal
cual; leelo entero antes de escribir el primero.

---

## 3. Los arquetipos

Cinco esqueletos con los `say`, `title` y `proves` ya escritos y targets de
nombre canónico. **Se copian y se rellenan** — no hay herencia ni merge en
runtime: un guion que se resuelve al ejecutarse es imposible de revisar en un PR.

| Arquetipo | La escena que lo define |
|---|---|
| `login-onboarding` | **El primer valor entregado** — no el dashboard vacío |
| `crud` | **Aparece del otro lado**, en la bandeja de quien lo atiende |
| `search-filter` | **El volumen en pantalla** ("4.812 registros") antes de filtrar |
| `admin-panel` | **El efecto del lado del usuario**, no sólo el panel |
| `checkout` | **Lo que se desbloquea**, no el formulario de pago |

`archetype:` queda en el guion como metadato: el lint lo usa para avisar si falta
la escena que ese arquetipo espera.

---

## 4. Qué produce

```
demos/
├── catalog.json      qué capacidad está cubierta, guionada o sin cubrir
├── index.html        la galería, con la sección de cobertura
└── <slug>/
    ├── index.html        página navegable: video + capítulos clicables + transcript
    ├── demo.mp4          H.264 con la voz en off mezclada, faststart (seekable)
    ├── demo.vtt          subtítulos sidecar
    ├── demo.chapters.vtt capítulos
    ├── poster.jpg
    ├── narration.md      el texto y los tiempos, por si alguien lo locuta
    └── run.json          duración, escenas, commit, hash y URL pública del video
```

Los subtítulos van **dos veces**: quemados en el video (los pinta el propio
browser que se está grabando, así que **no se pueden desincronizar**) y como
`.vtt` para el player, el transcript y la accesibilidad.

La página tiene **capítulos clicables** y un **transcript sincronizado** que
resalta el cue activo — eso es lo que la hace navegable. Y una **tabla de
cobertura** capacidad → escena.

**En git no va ningún binario, sin umbral.** El `demo.mp4` y el `poster.jpg` se
publican en S3 bajo una clave content-addressed, y lo que se commitea es el
`run.json` con la URL y el `sha256`. La razón es que git **no deltifica H.264**:
cada regrabación suma un blob entero y **permanente** que `git rm` no saca. Un
repo que se recontamina cada vez que alguien regraba no tiene arreglo incremental,
así que la única política sostenible es cero. Detalle en `references/storage.md`.

---

## 5. La voz en off

Está prendida por default y la sintetiza **Kokoro**, un TTS neuronal que corre
local: el guion no sale de la máquina y no hay costo por uso.

Lo único que hay que entender es **el orden**, porque es lo que hace que el audio
nunca se desincronice:

| Pasada | Cuándo | Qué hace |
|---|---|---|
| 1 · `narrate.mjs` | antes de grabar | Sintetiza todos los cues y mide cada uno |
| 2 · `record.mjs` | grabando | Cada beat dura al menos lo que dura su locución |
| 3 · `build.mjs` | montando | Pega cada clip en su instante ya calibrado |

Sintetizar **después** de grabar es la trampa obvia: la locución no entra en el
hueco que quedó y hay que estirarla, acelerarla o regrabar hasta que dé. Con este
orden no existe el bucle de sincronización.

La síntesis se cachea por hash del texto, así que iterar el guion es barato:
cambiar una frase re-sintetiza esa frase.

`narration: false` en el guion apaga la voz para una demo puntual.

**Escuchá el video entero antes de publicarlo.** Un TTS que pronuncia mal un
nombre propio arruina la demo, y eso no lo ve ningún lint.

---

## 6. El catálogo: qué está demoable y qué no

La pregunta que importa antes de una reunión no es "¿qué demos tenemos?" sino
**"¿qué NO tenemos para mostrar?"**. `catalog.mjs` la contesta cruzando tres
cosas:

| Fuente | Qué aporta |
|---|---|
| `demos/capabilities.yml` | Lo que el producto sabe hacer (existe aunque no haya un solo video) |
| `demos/*.demo.yml` | Lo que está guionado (`covers:`) |
| `demos/<slug>/run.json` | Lo que está efectivamente grabado |

De ahí salen tres estados: **cubierta** (hay video, con link al segundo exacto),
**guionada** (falta grabarla) y **sin cubrir** (nadie la menciona). El panel de
huecos va destacado arriba de la tabla en la galería, ordenado por prioridad.

El catálogo también marca las demos **desactualizadas**: si el `.demo.yml` o
`selectors.yml` se commitearon después de la grabación, el video muestra una UI
que ya cambió. Es la forma real en que una demo envejece.

Sin `capabilities.yml` el catálogo funciona igual, pero sólo puede listar lo
cubierto: no tiene contra qué medir los huecos.

---

## 7. Trampas

- ⚠ **`npx playwright install ffmpeg` no es opcional.** El ffmpeg que Playwright
  usa para grabar **no es el del sistema**: es un helper propio que se instala
  aparte del browser. Sin él **`recordVideo` no produce nada y no avisa** — la
  corrida "funciona" y al final no hay video. Es el error nº1 al arrancar, y por
  eso el preflight lo chequea.
- ⚠ **El `.webm` de Playwright no es seekable.** Se muxea en streaming y queda
  sin duración en el header: el browser no puede saltar a un capítulo. Por eso el
  motor **siempre transcodifica a MP4** y el `.webm` es un intermedio que nunca
  se publica.
- ⚠ **Un valor sin comillas que contiene `": "` rompe el YAML** (se lee como una
  clave anidada). `say: "El cierre: el beat más fuerte"` — con comillas.
- ⚠ **Un popup parte el video en dos.** `recordVideo` escribe un archivo por
  página. El runner aborta con un mensaje claro.
- ⚠ **Nunca contra un dev server.** La demo se graba contra una URL desplegada.
  En la VPS compartida un `next dev` dispara el OOM killer y se lleva servicios
  de otros; el preflight aborta con menos de 3 GB de RAM libre.
- ⚠ **Mockear un endpoint de escritura está prohibido.** La demo tiene que
  mostrar el producto funcionando de verdad. Un `GET` mockeado para que los datos
  sean lindos se permite, **se declara** en `fixtures:`, y la página lo muestra
  como "datos de demostración". Honestidad por construcción.

Más, y con el síntoma de cada una, en `references/troubleshooting.md`.

---

## 8. Tests y checks antes de cada push

El motor tiene sus propios tests y no son opcionales: `pacing.mjs` decide cuánto
dura cada cosa y `subtitles.mjs` cómo se parte cada cartel; un bug ahí produce
subtítulos que se cortan antes de poder leerse — algo que sólo se nota mirando el
video, que es tarde.

```bash
node --test demos/.runner/          # sin dependencias
npx vitest run demos/.runner/       # si el proyecto ya tiene Vitest
```

`templates/runner/pacing.test.mjs` cubre las funciones **puras** (lectura, ritmo,
timestamps, estimación, partido de subtítulos). Es lo único del motor verificable
sin abrir un browser, y por eso entra en el pre-push; lo demás lo cubre `--check`.

Un caso que vale la pena entender, porque explica la forma de los tests: el
reparto de tiempo entre las frases de un subtítulo tiene que sumar **exactamente**
la duración del cue. Si sobra o falta un milisegundo por frase, la deriva se
acumula y para el final del video el texto va corrido de la voz. Eso es una
invariante, no un detalle, y está testeada como tal.

### El hook

`templates/pre-push` corre typecheck, lint, tests, un escaneo de credenciales y
**el lint de cada guion de demo** antes de dejar salir nada.

```bash
mkdir -p .githooks
cp <skill>/templates/pre-push .githooks/pre-push
chmod +x .githooks/pre-push
git config core.hooksPath .githooks     # así el hook se versiona y lo tiene el equipo
```

Dos decisiones deliberadas:

- **Grabar nunca bloquea un push.** En el pre-push sólo corre `lint.mjs` sobre
  los guiones: valida estructura, reglas narrativas y targets huérfanos en menos
  de un segundo, sin browser. Una demo se regraba cuando hace falta, no en cada
  push.
- **No corre builds pesados.** `next build` se come 2-4 GB y en una VPS
  compartida dispara el OOM killer. El build es el gate del deploy, no el del push.

Y una honesta: el hook **se saltea con `--no-verify`**, y está bien que se pueda.
Es para el feedback rápido —20 segundos ahora en vez de 4 minutos de CI— no una
barrera de seguridad. Los mismos checks tienen que correr en el PR.

## Referencias

| Archivo | Cuándo leerlo |
|---|---|
| `references/storytelling.md` | Antes de escribir el primer guion. La doctrina completa, con antipatrones y cómo migrar un `DEMO_SCRIPT.md` manual. |
| `references/pacing.md` | Si el video se siente apurado o eterno. La fórmula del ritmo y por qué nada de `networkidle`. |
| `references/determinism.md` | Si la demo sale distinta cada vez. Seed vs fixtures, congelar el reloj, `hide`/`redact`. |
| `references/intake.md` | **Apenas te piden una demo.** Qué reconocer en el código y qué preguntar antes de escribir una línea de guion. |
| `references/setup.md` | Al instalar el motor en un proyecto nuevo, o al configurar la voz. |
| `references/lessons.md` | Antes de grabar algo con debounce, un asistente que streamea, o un editor por secciones. Fallas reales y su regla. |
| `references/storage.md` | Al configurar el bucket, o para recuperar el video de una demo vieja. |
| `references/troubleshooting.md` | Cuando algo falla. Ordenado por síntoma. |

## Checklist antes de publicar una demo

- [ ] Hubo entrevista antes del guion, y el guion se aprobó antes de grabar.
- [ ] La promesa se puede decir en una frase, y está en la placa de apertura.
- [ ] Ningún `say` habla de algo que todavía no está en pantalla: si está más
      abajo, el beat scrollea **antes** de decirlo.
- [ ] Ninguna frase narra una funcionalidad sobre su estado vacío.
- [ ] La persona tiene nombre, rol y contexto concretos.
- [ ] Hay una escena con `objection: true` que muestra lo difícil.
- [ ] Ningún subtítulo describe un click; todos dicen la consecuencia.
- [ ] Ningún subtítulo pasa los 90 caracteres.
- [ ] Cada escena declara qué capacidades cubre (`covers:`), y el catálogo las
      reconoce (sin `covers` la demo no suma cobertura).
- [ ] **Escuchaste la locución entera**: ningún nombre propio mal pronunciado.
- [ ] El seed es idempotente: corrés la demo dos veces y sale igual.
- [ ] Ninguna credencial hardcodeada en el guion (todas como `${VAR}`).
- [ ] `--check` pasa sin errores.
- [ ] Los datos sensibles están en `redact:`.
- [ ] **Miraste el video entero**, con los subtítulos y el audio, antes de publicarlo.
- [ ] `run.json` no quedó en `pending`: el video se subió al bucket.
- [ ] Si usa `fixtures:`, la página lo declara y estás de acuerdo con eso.
- [ ] El hook `pre-push` está instalado y `node --test demos/.runner/` pasa.
