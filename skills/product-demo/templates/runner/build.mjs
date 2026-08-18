// RUNNER_VERSION 1
//
// Post-proceso: webm crudo + timeline → demo.mp4, demo.vtt, demo.chapters.vtt,
// poster.jpg, narration.md y run.json.
//
//   node .runner/build.mjs /tmp/demo-<slug>-<pid>/timeline.json
//
// Las dos cosas no obvias que pasan acá:
//
// 1. SIEMPRE se transcodifica. El .webm de Playwright se muxea en streaming y
//    queda sin Duration en el header y sin cues: el browser no puede saltar a un
//    capítulo y ffprobe tiene que escanear el archivo entero. Una página de demo
//    donde no podés saltar a un capítulo no sirve. Además MP4/H.264 anda en
//    Safari, iOS, Keynote y Slack; VP8 no siempre.
//
// 2. La línea de tiempo se CALIBRA contra el video real. Los cues se midieron con
//    un reloj de Node; el video arrancó antes, en un instante que la API no
//    expone. Buscamos el flash blanco de la claqueta dentro del video y aplicamos
//    una corrección afín.
//
// 3. La locución se mezcla ACÁ, en el tiempo ya calibrado (pasada 3 de 3: la 1 es
//    narrate.mjs, que sintetiza antes de grabar; la 2 es record.mjs, que le da a
//    cada beat al menos lo que dura su voz). Cada wav se pega en at(cue.start),
//    así que no hay deriva que corregir ni bucle de re-grabar hasta que sincronice.

import { readFileSync, writeFileSync, mkdirSync, statSync, renameSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname, resolve } from "node:path";
import { createHash } from "node:crypto";
import { formatVttTime } from "./pacing.mjs";
import { loadDemo } from "./lint.mjs";
import { publish } from "./publish.mjs";

function sh(cmd, args) {
  return execFileSync(cmd, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
}

async function main() {
  const timelinePath = process.argv[2];
  if (!timelinePath) die("Uso: node .runner/build.mjs <timeline.json>");

  const tl = JSON.parse(readFileSync(timelinePath, "utf8"));
  const { demo } = loadDemo(tl.demoPath);
  const outDir = tl.outDir;
  const tmpDir = dirname(resolve(timelinePath));
  mkdirSync(outDir, { recursive: true });

  // ── 1. Transcodificar ──────────────────────────────────────────────────────
  // Queda sin audio y en el temporal: recién después de calibrar sabemos en qué
  // milisegundo va cada clip de voz, y el mux final es un `-c:v copy` gratis.
  const mp4 = join(outDir, "demo.mp4");
  const silent = join(tmpDir, "video-only.mp4");
  console.log("· transcodificando a mp4 (faststart, seekable)…");
  sh("nice", [
    "-n", "10", "ffmpeg", "-y", "-i", tl.webm,
    "-c:v", "libx264", "-crf", "24", "-preset", "veryfast",
    "-pix_fmt", "yuv420p", "-g", "50",
    "-movflags", "+faststart",   // el índice al principio: permite seek sin bajar todo
    "-threads", "2",             // VPS compartida: no monopolizar
    "-an", silent,
  ]);

  const duration = Number(
    sh("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", silent]).trim(),
  ) * 1000;

  // ── 2. Calibrar ────────────────────────────────────────────────────────────
  const clapAt = findClap(silent);
  const measured = tl.tEnd;                 // duración medida en Node desde el clap
  const real = duration - clapAt;           // duración real del contenido en el video
  let scale = measured > 0 ? real / measured : 1;

  if (!Number.isFinite(scale) || Math.abs(scale - 1) > 0.02) {
    console.warn(
      `  ⚠ factor de escala ${scale.toFixed(4)} fuera de [0.98, 1.02] — probablemente se dropearon frames. Uso 1.`,
    );
    scale = 1;
  }
  const at = (t) => clapAt + t * scale;

  console.log(
    `· claqueta en ${clapAt.toFixed(0)}ms · duración ${(duration / 1000).toFixed(1)}s · escala ${scale.toFixed(4)}`,
  );

  // ── 3. Subtítulos y capítulos ──────────────────────────────────────────────
  const cues = pairCues(tl.cues, tl.tEnd);
  writeFileSync(join(outDir, "demo.vtt"), toVtt(cues.map((c) => ({ ...c, start: at(c.start), end: at(c.end) }))));

  const chapters = tl.chapters.map((c, i, arr) => ({
    text: c.title,
    start: at(c.t),
    end: at(i + 1 < arr.length ? arr[i + 1].t : tl.tEnd),
  }));
  writeFileSync(join(outDir, "demo.chapters.vtt"), toVtt(chapters));

  // ── 4. Locución: cada clip en su milisegundo calibrado ─────────────────────
  const voiced = mixVoice({ silent, mp4, cues: tl.cues, at, durationMs: duration });

  // ── 5. Poster: un frame del primer capítulo, no de la placa negra ──────────
  const posterAt = ((chapters[0]?.start ?? clapAt) + 1500) / 1000;
  sh("ffmpeg", ["-y", "-ss", String(posterAt), "-i", mp4, "-frames:v", "1", "-q:v", "3", join(outDir, "poster.jpg")]);

  // ── 6. Guion de locución, para que alguien lo grabe con su voz ─────────────
  writeFileSync(join(outDir, "narration.md"), toNarration(demo, tl, at));

  // ── 7. Publicar ────────────────────────────────────────────────────────────
  // En git no va NINGÚN binario, sin umbral: git no deltifica H.264, así que cada
  // regrabación deja un blob permanente que ni `git rm` saca del historial.
  const bytes = statSync(mp4).size;
  const sha256 = createHash("sha256").update(readFileSync(mp4)).digest("hex");

  const run = {
    id: demo.id,
    title: demo.title,
    promise: demo.promise,
    product: demo.product,
    recordedAt: new Date().toISOString(),
    commit: gitCommit(),
    baseUrl: process.env.DEMO_BASE_URL ?? null,
    durationMs: Math.round(duration),
    // `pending: true` hasta que publish() confirme; la página lo usa para mostrar
    // "sin subir" en vez de un <video> roto.
    video: { url: null, poster: null, pending: true, narrated: voiced, bytes, sha256 },
    usedFixtures: (demo.fixtures ?? []).map((f) => f.route),
    scenes: tl.chapters.map((c, i, arr) => ({
      id: c.id,
      title: c.title,
      proves: c.proves,
      watch: c.watch ?? null,
      startMs: Math.round(at(c.t)),
      endMs: Math.round(at(i + 1 < arr.length ? arr[i + 1].t : tl.tEnd)),
    })),
  };
  const runPath = join(outDir, "run.json");
  writeFileSync(runPath, `${JSON.stringify(run, null, 2)}\n`);

  const published = await publish(outDir, run);
  if (published) {
    run.video.url = published.video;
    run.video.poster = published.poster;
    run.video.pending = false;
    run.manifest = published.manifest;
    writeFileSync(runPath, `${JSON.stringify(run, null, 2)}\n`);
  }

  console.log(`✓ ${outDir}: demo.mp4 (${mb(bytes)}), demo.vtt, demo.chapters.vtt, poster.jpg, run.json`);
  if (run.usedFixtures.length)
    console.log(`  nota: la demo usa ${run.usedFixtures.length} fixture(s); la página lo va a declarar.`);
}

/**
 * Busca el flash blanco de la claqueta: el primer frame cuya luminancia media se
 * dispara. Escalamos a 2x2 para que sea barato — sólo nos importa el promedio.
 */
function findClap(mp4) {
  let out = "";
  try {
    out = execFileSync(
      "ffmpeg",
      ["-i", mp4, "-vf", "scale=2:2,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-", "-f", "null", "-"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 },
    );
  } catch {
    return 0;
  }
  // frame:0 pts_time:0.04\nlavfi.signalstats.YAVG=16.0
  const re = /pts_time:([\d.]+)[\s\S]*?YAVG=([\d.]+)/g;
  let m;
  while ((m = re.exec(out))) {
    if (Number(m[2]) > 200) return Number(m[1]) * 1000;
  }
  console.warn("  ⚠ no encontré el flash de la claqueta; asumo que el video arranca en 0.");
  return 0;
}

/** Los cues llegan como marcas de inicio/fin; los emparejamos en intervalos. */
function pairCues(marks, tEnd) {
  const out = [];
  let open = null;
  for (const m of marks) {
    if (m.kind === "cue") {
      if (open) { open.end = m.t; out.push(open); }
      open = { text: m.text, start: m.t, end: null, sceneId: m.sceneId };
    } else if (m.kind === "cue-end" && open) {
      open.end = m.t;
      out.push(open);
      open = null;
    }
  }
  if (open) { open.end = tEnd; out.push(open); }
  return out.filter((c) => c.end > c.start);
}

function toVtt(cues) {
  const body = cues
    .map((c, i) => `${i + 1}\n${formatVttTime(c.start)} --> ${formatVttTime(c.end)}\n${c.text}`)
    .join("\n\n");
  return `WEBVTT\n\n${body}\n`;
}

function toNarration(demo, tl, at) {
  const lines = [
    `# ${demo.title}`,
    "",
    `> ${demo.promise ?? ""}`,
    "",
    "Texto para locutar. Los tiempos son del video ya montado — si lo grabás con",
    "tu voz, respetalos o volvé a generar el video con `--voice` para que se ajuste.",
    "",
  ];
  for (const scene of demo.scenes) {
    const ch = tl.chapters.find((c) => c.id === scene.id);
    lines.push(`## ${scene.title}  \`${formatVttTime(at(ch?.t ?? 0))}\``, "");
    for (const beat of scene.beats) {
      if (beat.voice || beat.say) lines.push(`- ${beat.voice ?? beat.say}`);
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Pega cada clip de voz en su instante calibrado y muxea. Devuelve true si el
 * mp4 final tiene locución.
 *
 * El único trabajo real acá es el `adelay` por clip: la duración ya la negoció
 * record.mjs, que le dio a cada beat al menos lo que dura su voz. Por eso alcanza
 * con un `-c:v copy` — el video no se vuelve a comprimir.
 *
 * `apad` + `-shortest` deja el audio exactamente del largo del video: sin apad,
 * amix termina con el último clip y el mp4 quedaría cortado ahí.
 */
function mixVoice({ silent, mp4, cues, at, durationMs }) {
  const clips = (cues ?? [])
    .filter((c) => c.kind === "cue" && c.voice?.wav && existsSync(c.voice.wav))
    .map((c) => ({ wav: c.voice.wav, delay: Math.max(0, Math.round(at(c.t))) }));

  if (!clips.length) {
    renameSync(silent, mp4);
    return false;
  }

  const missing = (cues ?? []).filter((c) => c.kind === "cue" && c.voice?.wav && !existsSync(c.voice.wav)).length;
  if (missing) console.warn(`  ⚠ ${missing} clip(s) de voz ya no existen en el caché; van sin locución.`);

  const inputs = [];
  const filters = [];
  clips.forEach((c, i) => {
    inputs.push("-i", c.wav);
    // +1 porque la entrada 0 es el video.
    filters.push(`[${i + 1}:a]adelay=${c.delay}:all=1[v${i}]`);
  });
  const mixed = clips.map((_, i) => `[v${i}]`).join("");
  filters.push(`${mixed}amix=inputs=${clips.length}:normalize=0,apad[a]`);

  console.log(`· mezclando ${clips.length} clips de voz sobre ${(durationMs / 1000).toFixed(1)}s de video…`);
  sh("nice", [
    "-n", "10", "ffmpeg", "-y", "-i", silent, ...inputs,
    "-filter_complex", filters.join(";"),
    "-map", "0:v", "-map", "[a]",
    "-c:v", "copy", "-c:a", "aac", "-b:a", "128k",
    "-movflags", "+faststart", "-shortest", mp4,
  ]);
  return true;
}

function gitCommit() {
  try { return sh("git", ["rev-parse", "--short", "HEAD"]).trim(); } catch { return null; }
}

const mb = (b) => `${(b / 1024 / 1024).toFixed(1)} MB`;

function die(msg) {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
}

main().catch((e) => die(e.message));
