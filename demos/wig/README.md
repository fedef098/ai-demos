# When I Go — workspace de demos

Producto: **When I Go** (WIG), planificación de funeral y memorial.
Repo del producto: `WIG25/frontend`. Acá no hay código de la app: sólo el guion,
los selectores y el seed. Grabar no lee el checkout — se graba contra una URL
desplegada y el seed habla HTTP.

| Demo | Qué cuenta |
|---|---|
| `memorial-pages` | Lo que Marion puso en su plan se publica como memorial page, y nada aterriza ahí sin que ella lo acepte. |

## Contra qué se graba

| Entorno | `DEMO_BASE_URL` | `WIG_DEMO_API_URL` |
|---|---|---|
| bb-merge (contra el que se grabó) | `https://bb-merge.forwhenigo.com` | `https://bb-merge-api.forwhenigo.com` |
| QA | `https://qa.forwhenigo.com` | `https://api-qa.forwhenigo.com` |

Ojo con el nombre del host de la API: en bb-merge el prefijo va **atrás**
(`bb-merge-api`) y en QA **adelante** (`api-qa`). Verificá con
`curl <host>/health` → `{"status":"ok"}` antes de correr el seed.

**Nunca contra producción, y nunca contra un `next dev`.** El front y el back son
dos servicios distintos, por eso son dos URLs: el guion navega el front y el seed
escribe por la API.

## Variables

Los nombres están en `.env.example`. **El motor no lee ningún `.env`** — se
exportan en la terminal o viven en el keychain. El archivo documenta los nombres,
nunca los valores.

```bash
export DEMO_BASE_URL=https://bb-merge.forwhenigo.com
export WIG_DEMO_API_URL=https://bb-merge-api.forwhenigo.com
export WIG_DEMO_EMAIL='…+test@gmail.com'
export WIG_DEMO_PASSWORD='…'

R=skills/product-demo/templates/runner        # desde la raíz del repo
DEMOS_DIR=demos/wig "$R/demo.sh" memorial-pages --check
DEMOS_DIR=demos/wig "$R/demo.sh" memorial-pages
```

Sin `WIG_DEMO_*` el seed aborta antes de tocar nada, con el nombre de la que
falta.

## La cuenta

La demo tiene **su propia cuenta**, no una compartida: una cuenta que usan varias
personas termina con la clave cambiada o con estado que contradice el guion.

Va con alias **`+test@`** — no es cosmético. WIG marca `isTestAccount = true` a
todo signup `+test@`, y ese flag es lo que mantiene la actividad interna afuera
del panel de métricas del admin. Sin él, la cuenta de la demo aparece como un
usuario real en las conversiones.

## El seed

`seeds/memorial-pages.mjs` deja el mundo exactamente como el guion lo asume, y
nada más: el plan de Marion ya tiene su historia de vida, su foto y su canción
—se muestran cruzando a la página, así que tienen que existir **antes** de
grabar— y todavía no tiene memorial page, para que el flujo de creación esté
disponible y el slug `marion-ellis` esté libre.

Es **idempotente**: la segunda corrida sólo borra la página que dejó la anterior.
Escribe por la API del producto con la sesión de Marion, nunca contra la base.

También deja la sesión en `.auth/owner.json`, que está gitignoreado porque **es
una credencial**.
