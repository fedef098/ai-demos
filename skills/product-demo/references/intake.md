# La entrevista previa

Nadie pide "una demo de Memorial Pages" y quiere *todo* Memorial Pages. Quiere
un recorte, para alguien, con un objetivo — y casi nunca lo tiene explícito
todavía. Escribir el guion sin preguntarlo es adivinar, y adivinar cuesta una
grabación entera de cuatro minutos.

Esta fase es **obligatoria y va antes de escribir una sola línea de guion**.

## Paso A — Reconocer antes de preguntar

Preguntar sin haber mirado el código produce preguntas inútiles ("¿qué
funcionalidades tiene la sección?" — eso lo tenés que averiguar vos). Primero se
lee, después se pregunta, y las preguntas se hacen **con opciones concretas
sacadas de lo que encontraste**.

Sobre la sección que te nombraron, buscá y anotá:

| Qué | Dónde suele estar | Para qué sirve después |
|---|---|---|
| Las rutas y los pasos del flujo | el router, el árbol de páginas | son las escenas candidatas |
| Los estados vacíos | los `EmptyState` / "no hay nada todavía" | son lo que NO hay que narrar sin datos |
| Qué es premium o gated | los guards, los checks de suscripción | define con qué cuenta hay que grabar |
| Qué necesita datos para verse | listas, galerías, dashboards | define el seed |
| Acciones destructivas o que persisten | borrar, publicar, enviar mails | define qué se puede repetir y qué no |
| Widgets de terceros | captcha, pagos, chat | van a `hide:` o rompen la grabación |
| Lo que ya está cubierto | `demos/capabilities.yml` + `covers:` de otros guiones | evita repetir una demo que ya existe |

De ahí sale un **inventario de candidatos** en tres montones: lo que se muestra
bien, lo que necesita datos o una cuenta especial, y lo que conviene dejar afuera
(y por qué). Ese inventario es lo que le mostrás a la persona.

## Paso B — Las preguntas

Van en tandas de hasta cuatro, con opciones, no a campo abierto. Las respuestas
que ya te dieron en el pedido no se vuelven a preguntar.

**1. Quién mira, y qué tiene que pasar después.**
Un cliente evaluando comprar, un usuario que ya compró y no encuentra la función,
un inversor, el equipo interno. Cambia todo: el vocabulario, qué se asume
sabido, y cuál es el final. "Qué tiene que pasar después de mirar" es la
promesa, y sin ella no hay demo.

**2. Qué entra y qué queda afuera.**
Acá va el inventario del paso A como opciones múltiples. Es la pregunta que más
tiempo ahorra: una demo de 4 minutos que muestra doce pantallas no la termina
nadie, y la persona que pidió la demo casi siempre tiene tres que le importan.

**3. Cuál es el momento que prueba, y qué objeción hay que enfrentar.**
El "mirá esto" — el instante que justifica el video entero. Y la duda que el que
mira ya tiene en la cabeza ("¿y esto quién lo puede ver?", "¿tengo que crear una
cuenta?"): la escena `objection: true` sale de acá.

**4. Contra qué se graba.**
Entorno (nunca un dev server), con qué usuario, qué datos se pueden sembrar y
qué **no** se puede tocar. Si la única cuenta disponible tiene datos reales de un
cliente, eso cambia el plan entero — mejor saberlo ahora que en el `redact:`.

**5. Forma.** Duración objetivo, idioma, si lleva voz en off o va muda.

## Paso C — El guion, antes de grabar

Escribís el `.demo.yml` completo y **lo mostrás**: las escenas con su `proves`,
los subtítulos tal cual se van a escuchar, la duración estimada por el lint, y
qué capacidades del catálogo cubre. Es texto, se lee en un minuto y se corrige en
otro.

**Nada se graba sin un sí explícito sobre ese guion.** Corregir una frase en el
YAML es gratis; descubrirla en el video son cuatro minutos de grabación, la
locución entera y otra vuelta de revisión.

Después sí: `--check`, `narrate`, grabar.

## Por qué el orden importa

Cada paso saltado se paga más caro en el siguiente:

- Sin **reconocimiento**, las preguntas son genéricas y las respuestas también.
- Sin **preguntas**, el guion muestra lo que vos creíste que importaba.
- Sin **aprobación del guion**, el primer feedback llega mirando un video, que es
  el formato más caro de corregir que existe.
