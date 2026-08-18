# Determinismo

Una demo que sale distinta cada vez no se puede regenerar, y si no se puede
regenerar vas a terminar grabándola a mano — que es de donde veníamos.

Hay cuatro fuentes de variación: los datos, el tiempo, las animaciones y el
ruido de la interfaz.

## Datos: tres niveles, en orden de preferencia

### 1. `seed:` por API — el default

Un script idempotente que deja el mundo en el estado que la historia necesita.
Producto real, backend real, escrituras reales.

```js
// demos/seeds/reclamo-end-to-end.mjs
// Idempotente: correrlo diez veces seguidas tiene que dejar el mismo estado.
const api = (path, init) => fetch(`${process.env.DEMO_BASE_URL}${path}`, {
  ...init,
  headers: { "Content-Type": "application/json", ...auth, ...init?.headers },
});

// 1. Limpiar lo que dejó la corrida anterior.
for (const t of await listarTramitesDe(usuario)) await api(`/tramites/${t.id}`, { method: "DELETE" });

// 2. Garantizar las precondiciones (upsert, nunca create a secas).
await api("/tipos-tramite", { method: "PUT", body: JSON.stringify({ slug: "reclamo-ubicacion", enabled: true }) });
```

**Idempotente quiere decir que la segunda corrida sale igual que la primera.** El
error más común: sembrar sin limpiar, y que la demo de onboarding arranque con la
cuenta ya configurada.

### 2. `fixtures:` con `page.route` — para que los datos sean lindos

Interceptar lecturas y devolver un JSON fijo. Sirve cuando el entorno de demo no
puede tener los datos que la historia necesita (un ranking con 4.812 registros,
una métrica que da un número redondo).

```yaml
fixtures:
  - route: "**/api/ranking**"
    method: GET
    body: ./fixtures/ranking.json
```

> **Regla dura: mockear un endpoint de escritura está prohibido.** La demo tiene
> que mostrar el producto **funcionando**. Un `POST` mockeado convierte la demo en
> una maqueta, y si alguien lo descubre pierde credibilidad todo lo demás. El
> lint rechaza cualquier `method` que no sea `GET` o `HEAD`.

Y lo que se mockea **se declara**: la página HTML muestra un aviso de "datos de
demostración" con la lista de endpoints. Honestidad por construcción — así nadie
tiene que acordarse de aclararlo.

### 3. Snapshot congelado de toda la base

No. Se desactualiza, nadie sabe cómo se regenera, y termina mostrando una versión
del producto que ya no existe.

## Autenticación

**Login por API**, no por formulario: veinte segundos de tipear un mail no cuentan
nada (salvo que el login *sea* la demo).

Si el proyecto tiene rate limit de logins —y varios lo tienen, 5 por minuto es
típico— conviene cachear el `storageState` con **TTL de 55 minutos**: los JWT
suelen durar una hora, así que 55 minutos reusa la sesión sin que expire a mitad
de la grabación. Es el patrón de `civis/web/e2e/global-setup.ts`.

**Las credenciales nunca van en el guion.** Se referencian como `${VAR}` y el
lint rechaza una password hardcodeada.

## Tiempo

```yaml
freezeTime: 2026-03-10T14:30:00-03:00
```

El motor usa **`page.clock.setFixedTime()`**, no `clock.install()`. La diferencia
importa:

- `setFixedTime` congela `Date.now()` — así "hace 2 horas" y "vence el viernes"
  salen igual en cada corrida — pero **deja correr los timers**.
- `install()` congela también los timers, y con eso se mueren el polling, los
  debounces y las transiciones CSS: **la app parece muerta en el video**.

## Animaciones

**No** uses `reducedMotion: "reduce"` globalmente. Las animaciones son buena parte
de lo que hace que un producto se vea vivo y cuidado; apagarlas para "estabilizar"
la grabación te deja un video que parece un prototipo.

Lo que se apaga es el **ruido**, con la lista `hide:`. Los defaults cubren lo que
aparece en casi toda app nuestra:

```
nextjs-portal, #__next-build-watcher, [data-nextjs-toast], [data-vercel-toolbar],
.splash-screen, #crisp-chatbox, .intercom-lightweight-app
```

Un indicador de build de Next en la esquina delata que es un entorno de
desarrollo y ensucia una demo que por lo demás es impecable.

## Datos sensibles

```yaml
redact: ['[data-testid="user-email"]', '[data-testid="card-number"]']
```

Aplica `filter: blur(7px)`. Es lo **único** que el overlay toca del DOM real de la
app, y se remueve al terminar.

Usalo para mails reales, números de tarjeta (aunque sean de prueba: un número de
16 dígitos en un video que circula por Slack es una conversación que no querés
tener), nombres de otros clientes y cualquier identificador de otro tenant.

> **Ningún lint ve píxeles.** `redact` cubre lo que sabés de antemano; el resto
> sólo lo encontrás mirando el video entero antes de publicarlo.

## Verificar que es determinista

Grabá dos veces seguidas y compará `run.json`:

```bash
./demos/.runner/demo.sh <slug> && cp demos/<slug>/run.json /tmp/a.json
./demos/.runner/demo.sh <slug> && cp demos/<slug>/run.json /tmp/b.json
diff <(jq '.scenes[].startMs' /tmp/a.json) <(jq '.scenes[].startMs' /tmp/b.json)
```

Las duraciones por escena no deberían diferir más de un 5%. Si difieren mucho:
falta un `awaits` en algún lado y el motor está esperando por timeout en vez de
por la consecuencia.
