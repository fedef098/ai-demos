# El bucket de demos de Adavance

Cuenta **396633054847**, bucket **`adavance-demos`**, región `us-east-1`.

Estos comandos los tiene que correr alguien con admin en esa cuenta: las
credenciales que hay hoy (`wig-backups-uploader`) están scopeadas a backups y
`s3:CreateBucket` les da `AccessDenied`.

**Ese usuario NO se amplía.** Sus claves viven en el Secret `backup-s3` del
cluster y corren los CronJobs de backup de Postgres. Sumarle permisos de demos
une dos cosas que no tienen por qué compartir radio de explosión: una filtración
de las claves del backup pasaría a alcanzar las demos, y al revés.

## 0 · Alternativa: un usuario que se arranca solo

Si preferís tocar la consola una sola vez, creá `demo-publisher` con esta policy
en lugar de correr los pasos 1–4 vos. `s3:CreateBucket` acepta restricción por
ARN, así que el permiso de bootstrap alcanza a **un solo nombre de bucket** — con
otro nombre, este usuario no puede hacer nada.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    { "Sid": "BootstrapDemosBucket",
      "Effect": "Allow",
      "Action": [
        "s3:CreateBucket",
        "s3:PutBucketPolicy", "s3:GetBucketPolicy",
        "s3:PutBucketPublicAccessBlock", "s3:GetBucketPublicAccessBlock",
        "s3:GetBucketLocation", "s3:ListBucket"
      ],
      "Resource": "arn:aws:s3:::adavance-demos" },
    { "Sid": "PublishDemos",
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject"],
      "Resource": "arn:aws:s3:::adavance-demos/*" }
  ]
}
```

Por consola: **IAM → Users → Create user** (`demo-publisher`, sin acceso a la
consola) → **Attach policies directly → Create inline policy → JSON**, pegás eso
→ y después **Security credentials → Create access key** (caso de uso: *CLI*).

Sigue sin tener `Delete*`: publicar es aditivo, y borrar un video que alguien ya
compartió por link no debería poder pasar por accidente.

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

Y las variables que lee el runner:

```bash
export AWS_PROFILE=adavance-demos
export AWS_REGION=us-east-1
export DEMO_S3_BUCKET=adavance-demos
export DEMO_S3_PREFIX=demos                    # los videos
export DEMO_CATALOG_PREFIX=c/eBKGMNYwAjEY1F8Z  # el índice, en ruta impredecible
```

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
