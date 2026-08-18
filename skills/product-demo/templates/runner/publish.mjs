// RUNNER_VERSION 1
//
// Publicación: sube los binarios de una demo (demo.mp4 + poster.jpg) a S3 y
// mantiene un manifiesto acumulativo con todas las demos publicadas.
//
//   node .runner/publish.mjs demos/<slug>              # lee run.json de ahí
//   node .runner/publish.mjs demos/<slug> --dry-run    # imprime, no sube
//
// Las tres decisiones no obvias:
//
// 1. NINGÚN binario va a git. Git no deltifica H.264: cada regrabación suma un
//    blob entero y permanente al historial y `git rm` no lo saca. Antes había un
//    umbral de peso ("si pesa poco, commitealo"); no existe más, porque el
//    problema no es el tamaño de UN video sino el crecimiento monótono del repo.
//
// 2. Las claves son content-addressed: .../<demo-id>/<sha8>/demo.mp4, con los
//    primeros 8 chars del sha256 del mp4. Una regrabación escribe en OTRA clave,
//    así que jamás pisa la anterior y todo link ya compartido (un email, un
//    Slack, un deck) sigue vivo apuntando al video que el destinatario esperaba.
//    Como el contenido de una clave nunca cambia, se sirve con cache immutable.
//
// 3. El manifiesto (<prefix>/index.json) es la fuente de verdad de "qué demos
//    hay". Vive en el bucket y no en git a propósito: se publica desde cualquier
//    máquina/CI sin abrir un PR, y sobrevive a que alguien borre el directorio
//    local de la demo. Se mergea por `id` en vez de appendear, para que
//    regrabar no deje dos entradas de la misma demo.

import { readFileSync, existsSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve, extname, basename } from "node:path";
import { createHash } from "node:crypto";

const CONTENT_TYPES = {
  ".mp4": "video/mp4",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".vtt": "text/vtt",     // los .vtt NO se suben (son texto y van a git); está acá
  ".json": "application/json", //  por si alguna vez se publica un bundle completo.
};

/** El contenido de una clave content-addressed nunca cambia: cachear para siempre. */
const CACHE_IMMUTABLE = "public, max-age=31536000, immutable";
/** El manifiesto sí cambia en cada publicación: TTL corto o el índice queda viejo. */
const CACHE_MANIFEST = "public, max-age=60";

/**
 * Sube los artefactos binarios de una demo ya construida.
 *
 * @param {string} outDir Directorio de la demo (el que tiene demo.mp4 y run.json).
 * @param {object} run    El run.json ya parseado (id, product, video.sha256, …).
 * @returns {Promise<{video: string, poster: string|null, manifest: string}|null>}
 *   URLs públicas, o `null` si no hay `DEMO_S3_BUCKET` configurado. El `null` NO
 *   es un error: significa "el mp4 quedó sólo local y no se commitea", y el que
 *   llama debe escribir `video.url = null` y `video.pending = true` en run.json
 *   para que quede registrado que ese run está sin publicar.
 */
export async function publish(outDir, run) {
  const cfg = config();
  if (!cfg) {
    warnNoBucket(outDir);
    return null;
  }

  requireAwsCli();

  const mp4 = join(outDir, "demo.mp4");
  if (!existsSync(mp4)) die(`No encontré ${mp4}. Corré build.mjs antes de publicar.`);

  // El sha lo calcula build.mjs; si falta (run.json viejo o publicación a mano)
  // lo recalculamos en vez de abortar — es barato y evita una clase de fricción.
  const sha256 = run.video?.sha256 ?? sha256Of(mp4);
  const sha8 = sha256.slice(0, 8);
  const dir = `${cfg.prefix}/${slugify(run.product ?? "producto")}/${slugify(run.id)}/${sha8}`;

  const videoUrl = putObject(cfg, mp4, `${dir}/demo.mp4`, CACHE_IMMUTABLE);

  const posterFile = join(outDir, "poster.jpg");
  const posterUrl = existsSync(posterFile)
    ? putObject(cfg, posterFile, `${dir}/poster.jpg`, CACHE_IMMUTABLE)
    : null;

  const entry = {
    id: run.id,
    title: run.title ?? null,
    product: run.product ?? null,
    promise: run.promise ?? null,
    recordedAt: run.recordedAt ?? new Date().toISOString(),
    commit: run.commit ?? null,
    durationMs: run.durationMs ?? null,
    video: videoUrl,
    poster: posterUrl,
    bytes: statSync(mp4).size,
    sha256,
  };
  const manifestUrl = updateManifest(cfg, entry);

  console.log(`✓ publicado ${run.id} · ${videoUrl}`);
  return { video: videoUrl, poster: posterUrl, manifest: manifestUrl };
}

// ── Config ───────────────────────────────────────────────────────────────────

/** Devuelve la config de publicación, o null si no hay bucket (caso "sólo local"). */
function config() {
  const bucket = process.env.DEMO_S3_BUCKET;
  if (!bucket) return null;
  return {
    bucket,
    prefix: (process.env.DEMO_S3_PREFIX ?? "demos").replace(/^\/+|\/+$/g, ""),
    // La región se pasa SIEMPRE explícita al CLI: `AWS_REGION` la lee el CLI v2
    // pero el v1 sólo mira `AWS_DEFAULT_REGION`, y ese desajuste da un error
    // ("you must specify a region") que no se parece en nada a su causa.
    region: process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? "us-east-1",
    // Base pública opcional (CloudFront). Sin ella se arma la URL directa de S3,
    // que sirve igual pero sin CDN ni dominio propio.
    publicBase: (process.env.DEMO_PUBLIC_URL ?? "").replace(/\/+$/, "") || null,
    dryRun: process.argv.includes("--dry-run") || process.env.DEMO_PUBLISH_DRY_RUN === "1",
  };
}

function warnNoBucket(outDir) {
  console.warn(
    `\n  ⚠ No hay DEMO_S3_BUCKET: el video queda SÓLO en ${outDir} y NO se commitea.\n` +
      "    Ningún binario entra a git (ver demos/.gitignore), así que este mp4 no\n" +
      "    existe para nadie más que vos y se pierde al limpiar el working tree.\n" +
      "    Para publicarlo: export DEMO_S3_BUCKET=<bucket> [DEMO_S3_PREFIX] [AWS_REGION]\n" +
      "    [DEMO_PUBLIC_URL] y volvé a correr `node .runner/publish.mjs <dir>`.\n",
  );
}

/** Sin AWS CLI no hay publicación posible: mejor fallar con el comando exacto. */
function requireAwsCli() {
  try {
    execFileSync("aws", ["--version"], { stdio: "ignore" });
  } catch {
    die(
      "DEMO_S3_BUCKET está seteado pero `aws` no está en el PATH.\n" +
        "  Instalá el AWS CLI v2 (https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html)\n" +
        "  y verificá credenciales con `aws sts get-caller-identity`.",
    );
  }
}

// ── S3 ───────────────────────────────────────────────────────────────────────

/** Sube un archivo si no está ya. Devuelve la URL pública. */
function putObject(cfg, file, key, cacheControl) {
  const url = publicUrl(cfg, key);
  const label = basename(file);

  if (cfg.dryRun) {
    console.log(`· [dry-run] ${label} → s3://${cfg.bucket}/${key}`);
    return url;
  }

  // Idempotencia: la clave lleva el sha del contenido, así que si el objeto ya
  // existe es BIT A BIT el mismo. Re-subir sólo gastaría ancho de banda.
  if (headObject(cfg, key)) {
    console.log(`· ${label} ya publicado · ${url}`);
    return url;
  }

  aws(cfg, [
    "s3", "cp", file, `s3://${cfg.bucket}/${key}`,
    "--content-type", contentTypeOf(file),
    "--cache-control", cacheControl,
    "--only-show-errors",
  ]);
  console.log(`· ${label} → ${url}`);
  return url;
}

function headObject(cfg, key) {
  try {
    aws(cfg, ["s3api", "head-object", "--bucket", cfg.bucket, "--key", key], "ignore");
    return true;
  } catch {
    return false; // 404 (o sin permiso de HEAD): tratamos como "no está" y subimos.
  }
}

/**
 * Lee el manifiesto, reemplaza la entrada de esta demo y lo vuelve a subir.
 * Es read-modify-write sin locking: dos publicaciones EXACTAMENTE simultáneas
 * podrían pisarse. Se acepta a propósito — publicar una demo es un acto manual,
 * y el costo de perder una entrada es volver a correr publish, no perder el video
 * (que ya está subido bajo su propia clave inmutable).
 */
function updateManifest(cfg, entry) {
  const key = `${cfg.prefix}/index.json`;
  const url = publicUrl(cfg, key);

  if (cfg.dryRun) {
    console.log(`· [dry-run] mergear "${entry.id}" en s3://${cfg.bucket}/${key}`);
    return url;
  }

  const demos = fetchManifest(cfg, key)
    .filter((d) => d.id !== entry.id) // regrabar reemplaza, no duplica
    .concat(entry)
    .sort((a, b) => String(b.recordedAt ?? "").localeCompare(String(a.recordedAt ?? "")));

  const body = `${JSON.stringify({ updatedAt: new Date().toISOString(), demos }, null, 2)}\n`;
  // Se sube desde stdin para no dejar un temporal a medio escribir si esto falla.
  aws(
    cfg,
    ["s3", "cp", "-", `s3://${cfg.bucket}/${key}`,
      "--content-type", "application/json",
      "--cache-control", CACHE_MANIFEST,
      "--only-show-errors"],
    "pipe",
    body,
  );
  console.log(`· manifiesto: ${demos.length} demo(s) · ${url}`);
  return url;
}

function fetchManifest(cfg, key) {
  let raw;
  try {
    raw = aws(cfg, ["s3", "cp", `s3://${cfg.bucket}/${key}`, "-", "--only-show-errors"]);
  } catch {
    return []; // primera publicación en este bucket
  }
  try {
    const parsed = JSON.parse(raw);
    // Se tolera la forma array por si el manifiesto lo escribió otra herramienta.
    return Array.isArray(parsed) ? parsed : (parsed.demos ?? []);
  } catch {
    console.warn("  ⚠ el index.json remoto no es JSON válido; lo reescribo desde cero.");
    return [];
  }
}

function aws(cfg, args, stdio = "pipe", input) {
  return execFileSync("aws", [...args, "--region", cfg.region], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: stdio === "ignore" ? "ignore" : ["pipe", "pipe", "pipe"],
    input,
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function publicUrl(cfg, key) {
  if (cfg.publicBase) return `${cfg.publicBase}/${key}`;
  return `https://${cfg.bucket}.s3.${cfg.region}.amazonaws.com/${key}`;
}

const contentTypeOf = (file) => CONTENT_TYPES[extname(file).toLowerCase()] ?? "application/octet-stream";

/** Las claves van en la URL pública: sin acentos, espacios ni mayúsculas. */
const slugify = (s) =>
  String(s)
    .normalize("NFD").replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "demo";

const sha256Of = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");

function die(msg) {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
}

// ── CLI ──────────────────────────────────────────────────────────────────────

// Ejecutable directo además de importable: publicar un run viejo (o reintentar
// uno que quedó `pending`) no debería obligar a regrabar la demo entera.
if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  const outDir = process.argv[2];
  if (!outDir) die("Uso: node .runner/publish.mjs <outDir> [--dry-run]");
  const runPath = join(outDir, "run.json");
  if (!existsSync(runPath)) die(`No encontré ${runPath}. Corré build.mjs antes de publicar.`);
  publish(outDir, JSON.parse(readFileSync(runPath, "utf8"))).catch((e) => die(e.stack ?? e.message));
}
