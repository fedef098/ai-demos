# Ritmo

Un video a velocidad de test no se entiende: los clicks pasan antes de que el ojo
llegue. Uno con sleeps generosos "por las dudas" es interminable. El motor apunta
al medio, y todo sale de una regla.

## La regla

> **Un beat dura `max(tiempo de lectura del subtítulo, tiempo de la acción, tiempo de la locución)`.**

El subtítulo nunca desaparece antes de que se pueda leer, y nunca queda colgado
después de que la UI ya siguió. Está implementada en `pacing.mjs` como funciones
puras, así que se puede testear con `node --test` sin abrir un browser.

### Lectura

```
hold = clamp(0.6s + caracteres / 16, 1.6s, 6s)
```

**16 caracteres por segundo** es velocidad de lectura cómoda en español. Netflix
usa 17 como máximo tolerable; 20 ya obliga a releer. El piso de 1.6 s evita que un
subtítulo corto parpadee; el techo de 6 s obliga a partir los largos en dos beats
en vez de dejar un cartel eterno.

De ahí sale el límite de **90 caracteres** por subtítulo: es lo que entra en dos
líneas de 45 y se lee en ~5,5 s.

### Locución

La voz manda por encima de los otros dos: el audio **nunca** se acelera ni se
estira. Si la locución de un beat dura 5,2 s, el beat dura al menos 5,2 s.

Eso sólo se puede cumplir si la duración se conoce **antes** de grabar, y es la
razón del pipeline de tres pasadas:

| Pasada | Quién | Qué hace |
|---|---|---|
| 1 | `narrate.mjs` | Sintetiza todos los cues y mide cada wav con `ffprobe` → `voices.json` |
| 2 | `record.mjs` | Le pasa ese `voiceMs` a `beatDuration()` como un piso más |
| 3 | `build.mjs` | Pega cada wav en su instante ya **calibrado** contra el video |

Sintetizar después de grabar es la trampa obvia y no funciona: la locución no
entra en el hueco que quedó, y "arreglarlo" es o deformar la voz o volver a grabar
hasta que dé. Con este orden **no hay bucle de sincronización**, ni una sola
regrabación por audio.

### Subtítulos de una línea

Un `say` de 90 caracteres es un cartel de dos líneas: tapa un tercio del alto útil
—justo la parte de la UI que la escena quiere mostrar— y aparece entero de golpe,
así que el ojo lo lee en 1 s y se queda 4 s mirando texto ya leído.

La respuesta no es escribir subtítulos más pobres: `subtitles.mjs` parte el mismo
texto en frases de una línea (46 caracteres, el ancho de la `.caption`) que van
pasando, cortando donde ya hay puntuación. El reparto del tiempo es proporcional a
la longitud de cada frase, y la suma es exactamente la duración del cue: sin esa
invariante la deriva se acumularía y para el final del video el texto iría
corriéndose de la voz.

La locución **no** se parte: se sintetiza el texto completo de una, porque la
prosodia de una frase entera es mucho mejor que la de tres pedazos pegados.

## La tabla

| Momento | Tiempo | Por qué |
|---|---|---|
| Viaje del cursor | `steps: 18` ≈ 360 ms | El ojo tiene que poder seguir al puntero hasta el destino |
| Dwell antes del click | 250 ms | El ojo llega **antes** que el click, no después |
| Después del click | ≥ 600 ms + la consecuencia | Sin esto no se registra que algo pasó |
| Tipeo | `delay: 45ms` (~22 cps) | Rápido, pero se lee como alguien escribiendo |
| Tipeo > 60 caracteres | híbrido: 80% de una, se tipea el 20% final | Tipear 200 caracteres son 9 s de video muerto |
| Scroll | suave, frena 200 ms antes del cue | Un `scrollBy` instantáneo no se lee |
| Entre escenas | 700 ms con subtítulo vacío | El ojo se resetea |
| Placa de portada / cierre | 3 s / 2 s | Se lee la promesa; se sostiene el remate |
| Cortina al cambiar de persona | 700 ms | Tapa el flash del reload y marca el corte narrativo |

**Total objetivo: 90-180 s.** Cada escena entre 8 y 20 s. Arriba de 4 minutos el
lint falla; abajo de 45 s advierte que probablemente no alcanza a contar nada.

`lint.mjs` estima la duración **sin grabar**, así que sabés que la demo se fue de
largo antes de gastar una corrida.

## Feedback de click

El cursor sintético se mueve y hace click, pero en video **un click sin
retroalimentación no se ve**: el puntero está quieto y de golpe la pantalla
cambió. Por eso el overlay dibuja un anillo que pulsa 250 ms en el punto del
click. Es la diferencia entre "pasó algo" y "no entendí qué hizo".

## Por qué está prohibido `networkidle`

`waitUntil: "networkidle"` espera a que no haya requests en vuelo por 500 ms.
**En una app con websockets, long-polling, analytics o un chat widget, eso no
pasa nunca**, así que el wait se come su timeout entero —15 segundos en el motor
de Mira— y el video queda congelado en esa pantalla.

En su lugar, cada beat declara **su consecuencia**:

```yaml
- click: boton-enviar
  awaits: identificador        # el número de expediente que prueba que se creó
  say: Se lleva un número de seguimiento y el aviso le llega por mail.
```

El motor hace `waitFor({ state: "visible" })` con 6 s. Si no aparece, **la
corrida falla** en vez de seguir grabando una pantalla rota.

Esto tiene un efecto secundario bueno: te obliga a nombrar, para cada acción, qué
prueba que funcionó. Que es exactamente lo que la demo tiene que mostrar.

## Fail fast

`page.setDefaultTimeout(5000)`, y cualquier paso que falle **aborta la demo
entera**.

Viene de una lección textual del motor de Mira:

> *"Fail fast on missing elements — a broken demo shouldn't burn 30s per click
> (that produced 4-minute videos of a frozen page)."*

Media demo rota es peor que ninguna: parece que funciona hasta que alguien la
mira. Y para no descubrirlo durante la grabación, `--check` resuelve **todos** los
targets antes, en 20 segundos y sin encoder de video.

## Si la demo se siente mal

| Síntoma | Causa habitual |
|---|---|
| Apurada, no se llega a leer | Subtítulos largos con acciones cortas: partilos en dos beats |
| Eterna, se hace pesada | Demasiadas escenas, o subtítulos de 90 caracteres en todas |
| Se salta cosas | Falta `awaits`: el motor no espera la consecuencia |
| Los clicks no se entienden | El elemento está fuera de viewport al hacer click: agregá un `scroll` antes |
| Hay silencios largos raros | Un beat sin `say` después de uno largo: o le ponés texto o lo fusionás |
| La voz dice mal un nombre | `voice:` en el beat, escrito como se pronuncia; el subtítulo no cambia |
| La voz va adelantada o atrasada | No debería poder pasar: revisá que `narrate.mjs` haya corrido antes de `record.mjs` |
