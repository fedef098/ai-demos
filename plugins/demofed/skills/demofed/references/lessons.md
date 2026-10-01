# Lecciones de grabar demos de verdad

Fallas concretas que costaron una regrabación cada una, con el arreglo. Vienen de
producir demos reales, no de imaginar qué podría salir mal.

Muchas de las originales **ya no existen**: el motor las resolvió de raíz y están
al final, en "Lo que dejó de ser un problema". Lo que sigue acá arriba son reglas
de autoría — ningún linter las puede ver.

## Un login por video

No partas un recorrido en varios videos para después concatenarlos: cada
grabación vuelve a loguearse, así que el video final se loguea N veces. Una sola
demo continua que entra una vez y navega.

Y el login mismo no se muestra: `auth: { via: api }` deja la sesión puesta antes
del primer frame. Un formulario de login no le prueba nada a nadie, y son 8
segundos.

## Campos con debounce se pisan entre sí

Llenar nombre y después título guardaba **sólo el título**: el patch debounceado
reemplaza al que estaba pendiente. Entre dos campos con debounce hay que dejar
pasar el flush (~1,7 s en la app donde lo vimos).

Se declara, no se duerme: poné en el beat un `awaits` sobre la señal de guardado
("Guardado", el toast, el check) antes de tocar el campo siguiente. Si la app no
muestra ninguna señal, eso es un hallazgo de producto.

## Una respuesta asincrónica no entra en un beat

Un asistente que streamea —o cualquier respuesta lenta— tarda más que una línea
de locución, y el input suele quedar **deshabilitado mientras responde**, así que
tampoco podés mandar varias preguntas adelantadas. Naïvemente "escribo, espero,
sigo" desincroniza: cuando termina de renderizar la respuesta N, la voz ya va por
la N+1.

Dos partes:

1. **Pipeline de a uno.** Mandá cada pregunta al **final del beat anterior** y
   esperá la respuesta al principio del beat que la describe. Así la respuesta ya
   está en pantalla cuando su locución arranca.
2. **Locución larga.** Dale al beat del asistente un `say` que cubra el tiempo de
   respuesta aun con el modelo lento. La regla del ritmo hace el resto: el beat
   dura lo que dure la voz.

Detectá el final con la respuesta real (`awaits` sobre lo que aparece), nunca con
un sleep.

## Modales que se cierran solos

Agregar un ítem a veces cierra su propio modal. El beat siguiente que hace click
en la "X" espera un botón que ya no existe. Antes de escribir el cierre, mirá si
ese modal se autocierra; si se autocierra, el beat de cierre sobra.

## Paneles colapsados

Un control dentro de un acordeón cerrado no es clickeable aunque el selector
resuelva. Necesita su propio beat que lo abra, con `awaits` sobre lo que queda
adentro.

Relacionado: entre secciones de un editor, `scroll` al tope primero, o el click
siguiente cae fuera del viewport y en el video no se ve qué se tocó.

## No digas lo que todavía no está en pantalla

La falla más común y la más difícil de ver escribiendo: la frase anuncia algo que
está más abajo y el ojo no lo encuentra. "Y abajo de todo, el muro de tributos,
que es el corazón de la página" mientras en pantalla se ven las donaciones — el
que mira se pasa esos tres segundos buscando un muro que no está.

La regla es literal: **cada `say` tiene que ser verdad de lo que se ve en ese
instante**. Si lo que vas a nombrar está más abajo, el beat scrollea primero y lo
dice después; si está en otra sección, es otro beat. Vale también al revés: no
narres algo que ya se fue de pantalla.

**`awaits` no alcanza como prueba de que algo está en cámara**, y es la forma en
que esta regla se cuela igual habiendo leído la regla. `awaits` espera a que el
nodo exista en el DOM y no scrollea: un `go` abre la página arriba, así que un
beat con `awaits: tarjeta-de-tributo` seguido del `say` del remate narraba la
aparición del mensaje **sobre el encabezado**, con la tarjeta fuera de plano y
todo verde. El beat se parte en dos: `go` + `awaits` para llegar, y un `scroll`
al mismo target que es el que lleva el `say`.

Y partirlo en dos tampoco alcanzaba, porque **el orden dentro del beat también
cuenta**: el motor pintaba el subtítulo y recién después scrolleaba, así que el
remate se decía con el encabezado todavía llenando la pantalla y la tarjeta
viajando. Un beat cuya única acción es `scroll` (o `highlight`, que también
scrollea) ahora scrollea **antes** del cue, y su costo se suma aparte en vez de
entrar en `actionCost`: la locución tiene que caer sobre la sección **ya quieta**.
Mezclado con un `go` o un `click` no se adelanta —scrollearía una pantalla que el
beat todavía no abrió—, y el lint ya rechaza esos beats por la regla de una
acción por beat.

Corolario del mismo caso: **un `scrollIntoViewIfNeeded()` instantáneo no es una
transición, es un corte**. El ojo aterriza en una sección sin saber de dónde vino
ni qué había en el medio, que se lee como un salto abrupto aunque el destino sea
el correcto. El scroll se anima a velocidad de lectura (~1500 px/s, con piso y
techo para que una sección lejana no se arrastre) y frena antes del cue.

## No narres una funcionalidad sobre su estado vacío

"Una galería de fotos, los momentos que una familia más quiere conservar" sobre un
recuadro punteado que dice "todavía no hay fotos" prueba justo lo contrario de lo
que dice. Igual con una bandeja de moderación: si la frase es "nada se publica sin
que la familia lo apruebe", en pantalla tiene que estar el tributo **pendiente**;
si el panel todavía está cargando, la escena no probó nada.

Dos arreglos, en orden: sembrar el dato, o mover la frase al beat donde el dato ya
está. Nunca dejarla colgada sobre el vacío.

Y una variante que engaña más, porque el dato **sí** estaba: la API devolvía la
foto en la galería, pero la pestaña decía **"On this page (0)"** — contaba sólo lo
subido ahí, y lo que llegaba del plan se listaba en la pestaña de al lado. El seed
estaba bien, el producto estaba bien, y la frase igual se narraba sobre un
recuadro punteado vacío. **Antes de narrar un número, mirá qué cuenta ese número**;
si el beat necesita que se vea, el beat tiene que ir a la pantalla donde se ve.

Y la misma trampa una segunda vez, en el mismo guion: la única foto del plan no
aparecía en la galería de la página pública. Parecía un dato que se perdía, y no:
esa foto es la **portada**, y la galería excluye a propósito la que ya corona el
encabezado para no dibujarla dos veces. El guion estaba scrolleando hasta la
galería —vacía, correctamente vacía— para hablar de una foto que estaba arriba de
todo. Regla, ya como reflejo: **cuando un dato "falta", leé dónde lo pone el
producto antes de tocar el seed**. Dos de dos veces el defecto estuvo en el guion,
no en la aplicación.

## Los widgets de terceros en modo test se ven

Un captcha en modo prueba pinta un cartel de "For testing only — report to site
owner" arriba del formulario. En una demo que mira un cliente, eso es peor que el
captcha real. Todo lo de terceros —captcha, pagos sandbox, chat widgets, banner de
cookies— va a `hide:` desde el primer borrador, no cuando alguien lo nota en el
video terminado.

## Datos: ni vacío ni acumulado

- **Ni vacío**: gráficos y embudos sin datos no muestran nada. El seed tiene que
  dejar volumen creíble en pantalla.
- **Ni acumulado**: las acciones que persisten se suman entre regrabaciones y a
  la tercera toma la lista está llena de duplicados de las tomas anteriores. Por
  eso el seed es **idempotente**: limpia lo suyo antes de sembrar.

## Mirá el artefacto final, no el editor

Varias regrabaciones no fueron por sincronía sino por "el flujo corrió pero el
resultado se ve mal": secciones vacías, imágenes placeholder, un fondo que sólo
se rompe en la página pública renderizada. Lo que la demo promete es el
resultado; miralo renderizado antes de publicar.

## Lo que se saca suele estar haciendo un segundo trabajo

La placa de apertura duraba 3 s y nadie los había declarado como parte del
arranque de la app — pero eso hacían. Al poner `titleCard: false` el video pasó a
abrir sobre el skeleton y sobre el splash blanco: la apertura sólo esperaba
`domcontentloaded` y las fuentes, y hasta entonces la placa venía tapando el
resto.

El arreglo no es devolver la placa: es esperar, **antes de la claqueta**, la
misma señal que el primer beat ya declara en su `awaits`. Todo lo anterior al
flash cuesta cero video, así que esperar ahí es gratis.

Y esperarla **una** vez no alcanza en una app que hidrata: el HTML servido ya
trae el elemento, la espera vuelve enseguida y un segundo después el cliente
desmonta el contenido para montarlo hidratado — el video abría con la región
central en negro varios segundos. Se espera dos veces con `TIMING.openingSettle`
en el medio; estable dos veces sí significa cargada.

De la misma vuelta salió otra: la navegación de apertura y el `go:` del primer
beat son la misma URL, así que el beat **recargaba la app entera en cámara** —
volvía el skeleton y se perdía la máscara de ruido junto con el documento. Por
eso `record.mjs` guarda el beat de apertura y le saltea el `go`, y la máscara se
instala con `addInitScript` para reponerse en cada documento.

> **Regla general: cuando sacás algo y aparece un defecto nuevo, lo que se rompió
> suele ser una función implícita de lo que sacaste, no lo que sacaste.** Buscá
> qué estaba tapando antes de dar marcha atrás.

Y una tercera vuelta de lo mismo: "todo lo anterior a la claqueta cuesta cero
video" era **falso**. La grabación arranca cuando se crea la página, así que todo
el arranque —navegación, fuentes, la doble espera del `awaits`— quedaba grabado
como cover negro. No se notaba porque duraba 0,4 s… hasta una corrida donde la
app tardó y fueron **2,4 s de negro** antes del primer cuadro. El mismo guion, el
mismo motor, el arranque del video atado a cómo venía la red ese día.

Ahora `build.mjs` **recorta el mp4 en el fin del flash**: el primer cuadro es el
fundido a la app, siempre, y el origen del timeline queda en `-clapFlash` en vez
de buscarse otra vez en el video ya cortado. Cortar en el flash mismo abriría con
un cuadro blanco; cortar antes es justo lo que se quiere sacar.

> **Un instante que depende de la red no puede ser el primer cuadro.** Si algo
> del arranque no es determinista, no se acorta: se corta.

## Dos bugs que se tapaban entre sí (el video en negro a mitad de la apertura)

Síntoma: el video abría bien sobre la app, y a los ~2,6 s la región central se
ponía **negra** durante seis segundos, con el header y el sidebar intactos
encima. La app no tenía nada que ver — abrir la misma URL con Playwright sin el
overlay daba luminancia constante de punta a punta. Era el motor, y eran dos
defectos que sólo juntos producían ese cuadro:

1. **`all:initial` estaba último** en el `cssText` del host del overlay. Es una
   declaración como cualquier otra: pisaba a `position:fixed`, `inset:0`,
   `z-index:2147483647` y `pointer-events:none`. El overlay se seguía viendo
   —sus hijos son `position:fixed`— pero sin contexto de apilado propio, así que
   se pintaba **por orden de DOM**.
2. **`cover("hidden")` no borraba el `opacity` inline** que le habían escrito
   `flash`/`black`/`brand`. Un inline le gana siempre a la regla
   `[data-state="hidden"]{opacity:0}` de la hoja, así que el cover quedaba opaco
   desde la claqueta hasta el final del video.

Por separado ninguno se ve. Con (1) roto, el cover opaco de (2) quedaba
**debajo** de la app y no molestaba… hasta que la app tocó el `<body>`, el
`MutationObserver` que repone el host lo re-anexó al final, el orden de pintado
se dio vuelta y el cover —que nunca se había ocultado— tapó todo menos lo que
tuviera `z-index` propio. De ahí el cuadro exacto: negro salvo header, sidebar y
modal.

Dos reglas: **en un `cssText`, `all:initial` va primero o no va**; y **un estado
"apagado" que se expresa en la hoja tiene que limpiar el inline, no escribir el
valor contrario** — si no, el primer estado que escriba inline gana para
siempre.

Y una de método: el negro *parecía* de la app (hidratación, skeleton). Lo que
cerró el caso en un minuto fue **abrir la misma URL sin overlay y medir**. Antes
de arreglar en el motor, comprobá que el defecto no esté en el producto — y al
revés.

## La máscara tiraba a document-start y se llevaba puesto el arranque

Síntoma: el banner de cookies aparecía en cámara **a partir de la mitad del
video** — en los primeros beats no estaba. Un `hide:` que funciona a veces parece
un problema de timing; era otra cosa.

`addInitScript` corre **a document-start, sobre un documento completamente
vacío**: no hay `<body>`, y tampoco `<head>` ni `<html>`. La máscara hacía
`document.head.appendChild(style)` y tiraba `Cannot read properties of null`. Como
corría en la misma pasada que el `boot()` del overlay, la excepción se llevaba a
**los dos**, y el `MutationObserver` que repone la máscara en cada documento nunca
se instalaba.

Lo que tapaba el bug: cada método del overlay llama a `build()` de forma
perezosa, así que el overlay igual aparecía. Y `record.mjs` re-aplica la máscara
explícitamente después de la navegación de apertura y del cambio de identidad —
por eso los primeros beats se veían limpios y todo lo que venía después de un
`go:` no. Un arreglo que sólo funciona donde alguien lo llama a mano no es un
arreglo.

Regla: **a document-start no hay ningún nodo, ni siquiera `documentElement`**. Se
observa `document`, se espera al nodo que hace falta y recién ahí se anexa. Y el
chequeo de idempotencia no sobra: entre el diferido y el anexado, el runner pudo
haber re-aplicado la máscara, y quedarían dos `<style>` con el mismo id de los que
`unmask()` saca uno solo.

## `!important` no gana solo: hay que ganar la especificidad

Con la máscara ya instalada y el selector matcheando, el banner **seguía
visible**: `getComputedStyle` decía `display: flex`. La app traía su propio
`.cc-window { display: flex !important }` — misma especificidad que el
`.cc-window { display: none !important }` del motor, y **ante dos declaraciones
important de igual especificidad gana la que va después**. La hoja de la app
siempre va después de la nuestra.

El arreglo es genérico y vale para cualquier `hide:`/`redact:`: el motor le
agrega `:not(#\9)` a cada selector del guion. Suma la especificidad de un id sin
poder matchear nada — `#\9` es el id formado por un tab — así que le gana a
cualquier regla de clases o atributos sin obligar a nadie a escribir el selector
más específico a mano. No se aplica a selectores con pseudo-elemento, donde
`:not()` iría después de `::` y sería sintaxis inválida.

Regla: **una hoja que tiene que tapar a la de la app no puede empatar**. Y el
método otra vez: el defecto *parecía* que la máscara no se aplicaba; lo que lo
cerró fue abrir la misma URL en Playwright y **leer el `display` computado**, no
mirar más frames.

## Un fundido es una rampa, no un borde: el video abría en gris

El video se graba desde que se crea la página, así que antes de la claqueta queda
grabado todo el arranque —navegación, fuentes, el `awaits` de apertura— tapado por
el cover. Dura lo que tarde la app ese día: medimos 0,4 s, 2,4 s y 4,6 s en tres
corridas del mismo guion. Eso es lo primero que ve quien abre el video, así que
`build.mjs` lo recorta.

El recorte se buscaba por luminancia, y **falló dos veces seguidas por la misma
razón de fondo**. Primero sumándole `clapFlash` al inicio del flash: abría en
blanco. Después tomando el primer cuadro por debajo de un umbral de brillo: abría
en un gris plano —un PNG de 4 kB, un rectángulo liso— porque ese cuadro cae **en
medio** de la transición blanco→negro. El error no era el número del umbral: era
el método. **El final de un fundido no es un borde, es una rampa, y no hay umbral
que lo encuentre.** El *inicio* del flash sí es un borde: un cuadro oscuro seguido
de uno blanco, el instante más brillante del video.

El arreglo es repartir el trabajo entre quien puede saber cada mitad:
`record.mjs` anota en `openAt` el instante en que la app queda a la vista —lo sabe
con certeza porque lo acaba de producir él— y `build.mjs` sólo busca en la imagen
el **inicio** del flash, que es lo único inequívoco, y lo usa para anclar el reloj
del grabador contra el video. Nada se deduce de un fundido.

Dos cosas para llevarse, más allá del bug: **cuando estés afinando un número por
tercera vez, el que está mal es el método** — y ninguna medición de brillo
reemplaza mirar el cuadro. Blanco (YAVG 235) y gris (YAVG 174) los dos pasan
cualquier chequeo de "no es negro"; lo que cerró el caso fue extraer los PNG y
abrirlos.

## La placa que presentaba a la persona era un agujero en el video

Cuando cambiaba de identidad, el motor tapaba la pantalla con una placa del color
de la marca y el nombre de quien entraba: *"Ahora, Marion Ellis"*, tres segundos.
Dos problemas, y el segundo es el que importa.

El chico: **el texto salía en castellano en una demo en inglés**. Nada del guion
lo decía —`locale: en-US`, todos los `say` en inglés, el lint verde— porque la
frase no está en el guion: la arma el motor. Regla: **los literales del motor son
parte del idioma de la demo**, y son los únicos que ningún lint del guion puede
ver. Si el motor escribe en pantalla, escribe en el idioma del guion o no escribe.

El grande: **una placa que tapa el producto es un agujero**. Tres segundos por
cada cambio de persona, en un video de dos minutos, son tres segundos en los que
lo que se está vendiendo no está en cámara — y la información que da ("ahora entra
Marion") la locución la da mejor, sin sacar al producto de plano. Ahora el telón
baja sólo lo que tarde el swap, sin una letra encima, y **quién entra lo dice el
`say` de ese beat**. Está escrito así en los arquetipos y en el ejemplo desde
siempre; el motor era el que no lo cumplía.

Vale para la placa de apertura igual: `titleCard: false` y el video abre sobre la
aplicación. El título y la promesa se leen con tiempo en la página de la demo, en
el catálogo y en el `run.json` — no sobre negro, donde nadie los termina.

## El telón tiene que levantar sobre la pantalla de destino, no antes

Arreglada la placa, quedó una desincronía peor de encontrar porque el video no
tenía ni un cuadro mal: al cambiar de identidad el motor recargaba **la URL de
quien se iba**, levantaba el telón y recién entonces corría el `go` del beat. O
sea que el telón subía sobre la página pública del vecino mientras la locución
—que arranca con el telón— ya estaba diciendo *"de vuelta en el plan de Marion"*.
Un segundo hablando de una pantalla que todavía no estaba.

El destino se navega **detrás del telón**, y el telón no sube hasta que lo que el
beat declara en `awaits` está pintado. Regla general: **todo lo que el espectador
no tiene que ver ocurre tapado, y el telón levanta sobre el estado final, no sobre
el camino**.

Y el método, otra vez: esto no lo encontró ningún check. Salió de extraer cuadros
sueltos alrededor del swap y mirarlos. **Exit 0 no es una revisión** — el
pipeline entero puede estar verde y el video contar otra cosa.

## Una demo no puede depender de una cuenta compartida

El seed empezó a fallar con un `401` contra una cuenta que estaba sana: confirmada,
premium, sin bloqueos. El hash no validaba la contraseña del guion, y `last_signed_in`
tenía dos milisegundos de diferencia con `updated_at` — el backend sólo escribe
`lastSignedIn` **después** de un compare exitoso, así que alguien le había cambiado
la clave y había entrado con la nueva.

No es un bug: es lo que pasa cuando una demo automatizada comparte cuenta con
personas en un entorno compartido. **La demo se lleva su propia cuenta, creada para
eso y de nadie más** — y con el alias `+test@` que corresponde, para que no
contamine las métricas. Pisar la clave de la cuenta de otro para desbloquearse es
la reacción obvia y la equivocada.

Lo mismo con lo que la demo deja atrás: la corrida anterior ya había publicado la
página en la dirección que la nueva necesita libre. Se resolvió **renombrando** la
vieja, no borrándola. Un seed idempotente tiene que poder recuperar el mundo sin
destruir nada que no haya creado él.

## Lo que dejó de ser un problema

Vale conocerlas: si alguna vez ves el síntoma, es que algo del motor no corrió.

| Síntoma histórico | Por qué ya no pasa |
|---|---|
| Desincronía progresiva: un beat lento atrasaba todo el resto del video | La locución se mide **antes** de grabar y es un piso del beat (`pacing.md`) |
| El bucle de regrabar hasta que dieran los tiempos (`minSlot`, `sync-report.json`) | El mismo pipeline de tres pasadas lo elimina: no hay hueco que rellenar |
| Un click colgado 30 s inflando el video | `page.setDefaultTimeout(5000)` + `awaits`: falla la corrida en vez de grabar una pantalla congelada |
| Subtítulo de 4 líneas tapando la UI | `subtitles.mjs` parte en frases de una línea |
| El login comiéndose el primer beat | `auth: { via: api }` |
| `.env` sourceado como shell: un valor con espacios sin comillas dejaba la var vacía y el video entero era la pantalla de login | No hay `.env`: las credenciales son `${VAR}` del entorno y la corrida aborta si falta alguna |
