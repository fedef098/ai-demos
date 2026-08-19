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

## No narres una funcionalidad sobre su estado vacío

"Una galería de fotos, los momentos que una familia más quiere conservar" sobre un
recuadro punteado que dice "todavía no hay fotos" prueba justo lo contrario de lo
que dice. Igual con una bandeja de moderación: si la frase es "nada se publica sin
que la familia lo apruebe", en pantalla tiene que estar el tributo **pendiente**;
si el panel todavía está cargando, la escena no probó nada.

Dos arreglos, en orden: sembrar el dato, o mover la frase al beat donde el dato ya
está. Nunca dejarla colgada sobre el vacío.

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
| Videos publicados que no se reproducían inline | `publish.mjs` fija el `Content-Type` al subir |
