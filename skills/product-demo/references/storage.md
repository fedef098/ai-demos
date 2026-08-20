# Almacenamiento de los binarios

## Por qué nada de esto se versiona

Git **no deltifica H.264**: dos grabaciones de la misma pantalla no comparten
nada a nivel de objeto, así que cada regrabación suma un blob entero y
**permanente**. `git rm` no lo saca — sigue en los packs y se clona igual;
sacarlo de verdad exige reescribir la historia y que todo el equipo re-clone. Un
repo que se recontamina cada vez que alguien regraba no tiene arreglo incremental
— por eso la regla es cero binarios, sin umbral.

A git van el guion, `selectors.yml`, los seeds, los `.vtt`, `narration.md`,
`run.json`, `catalog.json` y el `index.html`. A S3 van `demo.mp4` y `poster.jpg`.

## Configurar el bucket (S3)

| Variable | Obligatoria | Para qué |
|---|---|---|
| `DEMO_S3_BUCKET` | **sí** (para publicar) | Bucket destino. Sin ella no se publica: el mp4 queda local y `run.json` lo marca `pending`. |
| `DEMO_S3_PREFIX` | no | Prefijo de los videos. Default `demos`. |
| `DEMO_CATALOG_PREFIX` | no | Prefijo del catálogo (`index.json` + el sitio HTML). Default: el mismo que los videos. |
| `AWS_REGION` | no | Región del bucket. Default `us-east-1`. Se pasa explícita al CLI. |
| `DEMO_AWS_PROFILE` | no | Perfil de `~/.aws/credentials` a usar **sólo para publicar**. Sin ella se usan las credenciales por default del CLI. |
| `DEMO_PUBLIC_URL` | no | Base pública (CloudFront). Sin ella se usa `https://<bucket>.s3.<region>.amazonaws.com`. |

Credenciales: las del AWS CLI (`aws sts get-caller-identity` tiene que andar).
Si el bucket vive en una cuenta distinta de la default, usá `DEMO_AWS_PROFILE` y
no `AWS_PROFILE`: la segunda la mira **todo** comando `aws` de la máquina, así que
dejarla exportada para publicar demos reapunta cualquier otra tarea de AWS de esa
misma sesión. `DEMO_AWS_PROFILE` se traduce a un `--profile` en estas subidas y
en ningún otro lado.
Destildá `BlockPublicPolicy` / `RestrictPublicBuckets` o esta policy de **sólo
lectura pública** no toma efecto (el bucket es sólo para demos, nada más adentro):

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "PublicReadDemos",
    "Effect": "Allow",
    "Principal": "*",
    "Action": "s3:GetObject",
    "Resource": "arn:aws:s3:::demos-miempresa/*"
  }]
}
```

**`s3:GetObject` sí, `s3:ListBucket` nunca.** Es la diferencia entre "quien tiene
el link mira el video" y "cualquiera se baja el inventario completo". Sin
`ListBucket` público el bucket no se puede recorrer: hay que saber la clave, y
las claves llevan el sha del contenido.

## Por qué el catálogo va en otro prefijo

Los mp4 no se adivinan (`…/<demo-id>/<sha8>/demo.mp4`), pero el catálogo enumera
**todo**: features que todavía no anunciaste, para qué cliente grabaste cada
demo, y la sección de cobertura que dice qué le falta al producto. Un
`demos/index.html` es una ruta que alguien prueba.

Por eso `DEMO_CATALOG_PREFIX` puede llevar un token impredecible:

```bash
export DEMO_S3_PREFIX=demos                       # los videos
export DEMO_CATALOG_PREFIX=c/$(openssl rand -hex 8)   # el índice
```

Sigue siendo un link que le pasás a quien quieras — deja de ser algo que se
encuentra. Si el catálogo es público a propósito, no la definas y todo queda
junto.

## Publicar el sitio del catálogo

```bash
node .runner/publish.mjs demos/<slug>     # el video de UNA demo
node .runner/publish.mjs --catalog demos/ # la galería + la página de cada demo
```

`--catalog` regenera el HTML en un temporal con `page.mjs --remote` (el `<video>`
apunta a la URL publicada), le copia al lado el `poster.jpg` y los `.vtt` que
referencia, y sube todo. **No toca el HTML de `demos/`**: ese tiene que seguir
prefiriendo el mp4 local, que es lo que te deja mirar una demo recién grabada sin
red. Una demo sin publicar queda fuera del sitio con un warning — no hay nada que
reproducir.

A diferencia de los binarios, estas claves se re-suben siempre: el índice cambia
en cada publicación, y saltearlas porque "la clave ya existe" dejaría el catálogo
congelado.

CloudFront es opcional (dominio propio + latencia): origen = el bucket y
`DEMO_PUBLIC_URL=https://cdn.miempresa.com`. Como las claves son inmutables,
**nunca hace falta invalidar** la cache.

## Esquema de claves

```
<prefix>/<product-slug>/<demo-id>/<sha8>/demo.mp4
<prefix>/<product-slug>/<demo-id>/<sha8>/poster.jpg
<prefix>/index.json
```

`sha8` = primeros 8 chars del `sha256` del mp4. Content-addressed: regrabar
escribe en **otra** clave y no pisa nada, así que todo link ya compartido (un
email, un Slack, un deck) sigue mostrando el video que el destinatario esperaba.
De paso hace la publicación idempotente — si la clave existe, el contenido es bit
a bit el mismo y no se re-sube — y permite servir con `Cache-Control: immutable`.

## Recuperar una demo vieja

`<prefix>/index.json` es el manifiesto acumulativo: una entrada por demo (la
última publicada), ordenadas por `recordedAt` desc, con `video`, `poster`,
`durationMs`, `commit`, `bytes` y `sha256`.

```bash
curl -s https://cdn.miempresa.com/demos/index.json | jq '.demos[] | {id, recordedAt, video}'
```

Guarda sólo la versión **actual** de cada demo. Las anteriores siguen
en el bucket bajo su propio `sha8`: si el link viejo se perdió, listalas con
`aws s3 ls --recursive s3://<bucket>/demos/<product-slug>/<demo-id>/`, y usá el
`sha256` del `run.json` de esa grabación (ese sí está en git) para saber cuál es.
