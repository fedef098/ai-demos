# Cómo se cuenta una historia de usuario para que funcione en video

Esta es la parte que no se automatiza. Un motor de grabación impecable ejecutando
un guion malo produce un video malo, más rápido.

## Por qué no usamos "Como X quiero Y para Z"

En ningún repo nuestro se escribe así (lo verifiqué: cero ocurrencias). Y con
razón: ese formato sirve para **acordar alcance** con un equipo, no para
**convencer a alguien que está mirando**. "Como usuario quiero filtrar reclamos
para encontrarlos más rápido" describe una funcionalidad; no hace que nadie
quiera el producto.

Lo que sí funcionó fue el `DEMO_SCRIPT.md` de WIG. Vale la pena entender **por
qué** funcionó, porque de ahí sale todo lo demás:

1. Hay **una persona con vida propia** — Eleanor Rose Whitfield, 72 años, nacida
   en Savannah — no "usuario A".
2. Cada bloque tiene un **título que es una afirmación en el idioma del cliente**
   (*"It won't make things up"*), no un nombre de feature.
3. Cada bloque declara **qué capacidad prueba**, y eso se cruza en una tabla al
   final para verificar que no quedó nada afuera.
4. Hay una línea de **dirección** (`Show:`) que dice a dónde tiene que mirar el ojo.
5. **La fixture se prepara antes.** Nada se configura en cámara.
6. **Cierra en el beat más fuerte**, marcado explícitamente como tal.

Lo que le faltaba: tiempos, texto de narración, y que alguien pudiera ejecutarlo.
Eso es lo que agrega esta skill.

---

## Las cinco partes

### 1. La promesa

Una frase sobre **qué cambia para el que mira**. Es lo primero que se escribe y
lo último que se negocia: si no la podés escribir, la demo todavía no existe.

- ✓ *"Un vecino reporta un bache desde el sillón y el municipio lo cierra con
  constancia. Dos minutos."*
- ✖ *"Gestión integral de reclamos con trazabilidad end-to-end."*

La diferencia: la primera describe **lo que le pasa a una persona**; la segunda
describe **lo que hace el software**. Nadie mira un video de tres minutos para
enterarse de lo segundo.

Va en `promise:` y se muestra en la placa de apertura.

### 2. El protagonista y el estado del mundo

Nombre, rol, contexto y por qué le importa. **Lo concreto es lo que convierte una
lista de features en una historia.** Que Eleanor tenga 72 años y haya nacido en
Savannah no aporta ninguna información técnica, y es exactamente por eso que
funciona: el que mira deja de ver una demo y empieza a ver a alguien.

```yaml
cast:
  - as: vecina
    name: Lucía Fernández
    context: 34 años, San Jorge. Trabaja todo el día y no puede ir al municipio.
```

Y con la persona viene **el estado del mundo**: qué existe ya cuando arranca el
video. Eso **es** la fixture, y se escribe antes que los pasos.

> **Si la fixture no se puede sembrar de forma idempotente, la demo no existe.**
> Va a salir distinta cada vez y vas a terminar grabándola a mano, que es de
> donde venimos.

### 3. Las escenas

Una capacidad cada una, en tensión creciente. Máximo 7 — el lint lo enforcea.

> **Regla de oro: una escena = una cosa que el producto hace y el competidor no.**

Si dos escenas prueban lo mismo, se fusionan. Si una escena no prueba nada
(`proves` vacío), no va.

Cada escena lleva tres campos con tres destinos distintos, y conviene tenerlos
claros porque es fácil mezclarlos:

| Campo | Qué es | A dónde va |
|---|---|---|
| `title` | Una afirmación en el idioma del cliente | **En pantalla**, durante la escena |
| `proves` | La capacidad técnica que demuestra | A la **tabla de cobertura** del HTML |
| `watch` | A dónde tiene que mirar el ojo | Al **HTML**, junto al capítulo |

`watch` es el `Show:` de WIG. No entra en el video —no hay lugar— pero es lo que
permite que otra persona entienda por qué esa escena está ahí.

### 4. El giro

**Al menos una escena tiene que mostrar el producto haciendo lo difícil.** El
caso borde, el error manejado, el permiso denegado, el "no me lo invento".

WIG tenía dos (*"It won't make things up"* y el cierre de accesos delegados) y
por eso no parecía un folleto. Una demo donde todo sale bien a la primera se lee
como un video de marketing, y el que mira lo descuenta entero.

Se marca con `objection: true`, y **el lint falla si no hay ninguna**.

Ejemplos que funcionan:

- Un usuario de otra área **ni siquiera ve** el registro — no es un botón gris.
- Un pago **rechazado**, con un mensaje que dice qué pasó y deja seguir.
- Una búsqueda **sin resultados** que ofrece la salida.
- Una validación que **impide** romper el dato.

### 5. El cierre

El beat más fuerte, no un resumen. Se termina en la pantalla que mejor prueba el
valor, con unos segundos de silencio (`hold: 3s`).

Nada de "y esto fue todo lo que Producto X puede hacer por vos".

---

## La regla del subtítulo

Es la que más se incumple y la que más daño hace.

> **El subtítulo nunca describe el click. Enuncia la consecuencia o lo que está
> en juego.**

| ✖ | ✓ |
|---|---|
| "Hacemos click en Guardar." | "El reclamo queda asignado a Obras Públicas y el vecino se lleva su número." |
| "Ahora vamos a la pantalla de configuración." | "La regla la cambia una persona de negocio, sin ticket ni deploy." |
| "Seleccionamos el tipo de trámite." | "El formulario lo arma el municipio desde su panel. Cambia según el trámite." |

La razón es simple: **el click ya se ve**. El video muestra el mecanismo; el
subtítulo tiene que aportar lo que el video no puede mostrar — el sentido.

Restricciones formales:

- **Presente, tercera persona.**
- **≤ 90 caracteres** (2 líneas × 45, el estándar de subtitulado). El lint lo
  rechaza y el motor no lo podría sostener el tiempo suficiente igual.
- **Una idea por escena.** Si necesitás dos, son dos beats.
- No todos los beats necesitan subtítulo. Un click intermedio evidente puede ir
  mudo; el silencio también es ritmo.

El lint marca los que arrancan con `hacemos click`, `click en`, `ahora vamos a`,
`seleccionamos`, `presionamos`.

---

## Antipatrones

Todos los marca el lint salvo el último, que sólo lo ve una persona.

| Antipatrón | Por qué |
|---|---|
| **Login en cámara** | 20 segundos de tipear un mail no cuentan nada. La sesión se inyecta. Excepción: si el login *es* la demo (SSO, biometría). |
| **Estados vacíos** | Un dashboard sin datos no demuestra nada. Es lo que el seed tiene que evitar. |
| **Lorem ipsum** | Delata que es una maqueta y mata la credibilidad de todo lo demás. |
| **Tour de menú** | "Acá está Configuración, acá Reportes…" no es una historia. |
| **Más de 7 escenas** | Se pierde el hilo. Si no entra en 7, son dos demos. |
| **Escenas sin `proves`** | Si no podés decir qué capacidad demuestra, sobra. |
| **Todo sale bien** | Sin `objection`, es un folleto. |
| **Datos de otro cliente en cámara** | Ningún lint ve píxeles. Hay que mirar el video. |

---

## Migrar un guion manual existente

Si ya hay un `DEMO_SCRIPT.md` o equivalente:

1. **La Part 1 (fixture) → `world.seed`.** Lo que hoy es una tabla de "cargá esto
   antes de grabar" tiene que volverse un script idempotente. Es el trabajo más
   grande de la migración y el que más valor tiene: es lo que hace que la demo se
   pueda regenerar.
2. **Cada bloque → una escena.** El título del bloque ya es tu `title`; el
   blockquote de capacidad es tu `proves`; la línea `Show:` es tu `watch`.
3. **Los prompts/pasos literales → `beats`.** Los selectores van a
   `selectors.yml`, no al guion.
4. **La narración implícita → `say`.** Es la parte que hay que *escribir*: los
   guiones manuales casi nunca tienen texto de narración, sólo notas de dirección
   para el operador. Aplicá la regla del subtítulo a cada una.
5. **La tabla de cobertura → los `proves:`.** Se genera sola en el HTML.
6. **Buscá el giro.** Si el guion original no tenía ninguna escena mostrando lo
   difícil, agregala: es la que más va a mejorar la demo.
