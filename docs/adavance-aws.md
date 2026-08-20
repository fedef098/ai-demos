# El bucket de demos de Adavance

Cuenta **396633054847**, bucket **`adavance-demos`**, región `us-east-1`.

Estos comandos los tiene que correr alguien con admin en esa cuenta: las
credenciales que hay hoy (`wig-backups-uploader`) están scopeadas a backups y
`s3:CreateBucket` les da `AccessDenied`.

**Ese usuario NO se amplía.** Sus claves viven en el Secret `backup-s3` del
cluster y corren los CronJobs de backup de Postgres. Sumarle permisos de demos
une dos cosas que no tienen por qué compartir radio de explosión: una filtración
de las claves del backup pasaría a alcanzar las demos, y al revés.

## 0 · El camino corto: un usuario que se arranca solo

Tocás la consola una vez y los pasos 1–4 los corre la herramienta. La policy
completa está en **[`demo-publisher-policy.json`](./demo-publisher-policy.json)**
— se pega tal cual.

Por consola: **IAM → Users → Create user** (`demo-publisher`, sin acceso a la
consola) → **Attach policies directly → Create inline policy → JSON**, pegás el
archivo → **Security credentials → Create access key**, caso de uso *CLI*.

Los tres statements y por qué cada uno:

| Statement | Alcance | Para qué |
|---|---|---|
| `ManageOnlyTheDemosBucket` | `arn:aws:s3:::adavance-demos` | Crear el bucket y configurarlo: public-access-block, bucket policy, lifecycle, CORS, tags. |
| `PublishDemoArtifacts` | `…/adavance-demos/*` | Subir y leer objetos. `AbortMultipartUpload` no es opcional: un mp4 de 30 MB **se sube multipart**, y sin eso una subida cortada deja partes colgadas que nadie puede limpiar. |
| `NeverDeleteAPublishedDemo` | ambos | `Deny` explícito sobre `Delete*`. |

Dos cosas que hacen que esto sea acotado de verdad:

**`s3:CreateBucket` acepta restricción por ARN.** El permiso de bootstrap alcanza
a **un solo nombre de bucket**: si el bucket se llamara distinto, este usuario no
puede crear absolutamente nada. No es "permiso de crear buckets", es "permiso de
crear *ese* bucket".

**El `Deny` explícito es a propósito.** Alcanzaba con no incluir `Delete*` en los
Allow, pero un `Deny` no se puede pisar con un Allow posterior: si dentro de seis
meses alguien le adjunta `AmazonS3FullAccess` a este usuario, el borrado sigue
bloqueado. Publicar es aditivo — borrar un video que alguien ya compartió por
link no debería poder pasar por accidente.

> El nombre del bucket está **hardcodeado en los tres statements**. Si tenés que
> usar otro (ver la nota de `BucketAlreadyExists` abajo), cambialo en el JSON
> antes de pegarlo o la policy no aplica a nada.

### Cómo pasar la access key

**No la pegues en un chat.** Escribila directo en `~/.aws/credentials` como el
perfil `adavance-demos` (formato en el paso 5). Una clave que pasa por una
conversación queda en el historial y hay que rotarla después — ya nos pasó con
`wig-backups-admin`.

> Si `create-bucket` responde `BucketAlreadyExists`, el nombre lo tomó otra
> cuenta de AWS (son globales). Probá `adavance-product-demos` y cambiá el nombre
> en todo lo que sigue.

## 1 · Crear el bucket

```bash
export AWS_PROFILE=<perfil-admin-adavance>   # ojo: cuenta 396633054847
export B=adavance-demos

aws s3api create-bucket --bucket "$B" --region us-east-1
```

## 2 · Dejar que la policy pública tome efecto

Las ACLs públicas siguen bloqueadas — el acceso lo da **sólo** la bucket policy
del paso 3, que es explícita y auditable.

```bash
aws s3api put-public-access-block --bucket "$B" \
  --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=false,RestrictPublicBuckets=false
```

## 3 · Lectura pública de objetos, sin listado

`s3:GetObject` sí, `s3:ListBucket` **no**. Esa es la diferencia entre "quien
tiene el link mira el video" y "cualquiera se baja el inventario entero". Las
claves llevan el sha256 del contenido, así que sin listado no se adivinan.

```bash
aws s3api put-bucket-policy --bucket "$B" --policy "$(cat <<JSON
{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "PublicReadDemos",
    "Effect": "Allow",
    "Principal": "*",
    "Action": "s3:GetObject",
    "Resource": "arn:aws:s3:::$B/*"
  }]
}
JSON
)"
```

## 4 · Usuario para el plugin

Un usuario propio, con permiso sobre este bucket y nada más. Que la herramienta
que graba demos no pueda tocar nada del resto de la cuenta.

```bash
aws iam create-user --user-name demo-publisher

aws iam put-user-policy --user-name demo-publisher \
  --policy-name demo-publisher-s3 --policy-document "$(cat <<JSON
{
  "Version": "2012-10-17",
  "Statement": [
    { "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject"],
      "Resource": "arn:aws:s3:::$B/*" },
    { "Effect": "Allow",
      "Action": ["s3:ListBucket"],
      "Resource": "arn:aws:s3:::$B" }
  ]
}
JSON
)"

aws iam create-access-key --user-name demo-publisher
```

`ListBucket` está sólo para recuperar una demo vieja (`aws s3 ls --recursive`).
No hay `DeleteObject` a propósito: publicar es aditivo, y borrar un video que
alguien ya compartió por link no debería poder pasar por accidente.

## 5 · Configuración local

El `create-access-key` devuelve un par de claves — **no van a git**.

```ini
# ~/.aws/credentials
[adavance-demos]
aws_access_key_id = AKIA...
aws_secret_access_key = ...
```

Y las variables que lee el runner. Van en el bloque `env` de
`~/.claude/settings.json` — no son secretas (el secreto está arriba, en
`~/.aws/credentials`) y así las hereda todo comando que corre la skill, sin
depender de que alguien las exporte en la terminal correcta:

```json
// ~/.claude/settings.json
{
  "env": {
    "DEMO_AWS_PROFILE": "adavance-demos",
    "DEMO_S3_BUCKET": "adavance-demos",
    "DEMO_S3_PREFIX": "demos",
    "DEMO_CATALOG_PREFIX": "c/eBKGMNYwAjEY1F8Z",
    "AWS_REGION": "us-east-1"
  }
}
```

**`DEMO_AWS_PROFILE`, no `AWS_PROFILE`.** La segunda la mira *todo* comando `aws`
de la máquina: dejarla fija para publicar demos reapunta silenciosamente
cualquier otra tarea de AWS de esa sesión — los backups de WIG viven en otra
cuenta. `DEMO_AWS_PROFILE` se traduce a un `--profile` que sólo aplica a estas
subidas.

Los cambios en `settings.json` toman efecto en una **sesión nueva**.

El token del catálogo no es un secreto criptográfico: es lo que evita que
`/demos/index.html` sea una ruta que alguien prueba. El índice lista features sin
anunciar, para qué cliente se grabó cada demo y qué le falta al producto. Los
videos son públicos por diseño; el inventario no tiene por qué serlo.

## 6 · Verificar

```bash
aws sts get-caller-identity                      # arn:...:user/demo-publisher
echo ok | aws s3 cp - "s3://$B/demos/_probe.txt" --content-type text/plain
curl -s "https://$B.s3.us-east-1.amazonaws.com/demos/_probe.txt"   # → ok
curl -s "https://$B.s3.us-east-1.amazonaws.com/"                   # → AccessDenied (no lista)
aws s3 rm "s3://$B/demos/_probe.txt"   # falla: el usuario no tiene DeleteObject
```

Ese último error es la prueba de que el scope quedó bien. Para limpiar la sonda,
borrala con el perfil admin.

## Después

```bash
node .runner/publish.mjs demos/<slug>      # sube el mp4 + poster
node .runner/publish.mjs --catalog demos/  # sube la galería HTML
```

Un dominio propio (`demos.adavance.com` vía CloudFront + CNAME en Cloudflare) es
opcional y se agrega después sin migrar nada: se setea `DEMO_PUBLIC_URL` y las
publicaciones nuevas salen con ese host. Como las claves son inmutables, nunca
hace falta invalidar la cache.

---

## Estado: creado y verificado (2026-08-20)

Bucket `adavance-demos` en us-east-1, cuenta 396633054847, usuario
`demo-publisher`. Perfil local: `adavance-demos`.

| Chequeo | Resultado |
|---|---|
| Objeto público por URL directa | HTTP 200 |
| Listar el bucket sin credenciales | `AccessDenied` |
| Borrar un objeto con `demo-publisher` | `AccessDenied` (el `Deny` explícito) |
| HTML servido como `text/html` | sí — se renderiza, no se descarga |

Quedan dos sondas que **no se pueden borrar** con este usuario (es a propósito):
`demos/_probe.txt` y `_selftest/probe.html`. Para limpiarlas hace falta el perfil
admin de la cuenta.
